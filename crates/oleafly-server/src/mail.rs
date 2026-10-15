pub mod messages;
pub mod notify;
pub mod preferences;

use std::fmt;
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use lettre::message::{Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::transport::smtp::extension::ClientId;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use oleafly_collab_protocol::email::EmailFailure;
use tokio::sync::{mpsc, Notify, Semaphore};
use url::{Host, Url};

use crate::clock::Clock;
use crate::config::ServerConfig;
use crate::error::ServerError;
use crate::tokens::random_token;

pub const QUEUE_CAPACITY: usize = 1_000;
pub const LINK_SLOTS: usize = 2;
pub const OTHER_SLOTS: usize = 3;
pub const MAX_RECIPIENTS: usize = 5;
const UNDELIVERABLE_DOMAINS: [&str; 1] = ["users.noreply.github.com"];
const HIDDEN: &str = "[hidden]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Security {
    Tls,
    StartTls,
    Plain,
}

#[derive(Clone, PartialEq, Eq)]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    pub security: Security,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl fmt::Debug for SmtpSettings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SmtpSettings")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("security", &self.security)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| HIDDEN))
            .finish()
    }
}

impl SmtpSettings {
    pub fn parse(raw: &str) -> Result<SmtpSettings, String> {
        let invalid = || {
            "OLEAFLY_SMTP_URL must look like smtps://user:password@smtp.example.edu:465."
                .to_string()
        };
        let url = Url::parse(raw).map_err(|_| invalid())?;
        let (host, address) = match url.host() {
            Some(Host::Domain(domain)) => (domain.to_string(), domain.parse::<IpAddr>().ok()),
            Some(Host::Ipv4(address)) => (address.to_string(), Some(IpAddr::V4(address))),
            Some(Host::Ipv6(address)) => (address.to_string(), Some(IpAddr::V6(address))),
            None => return Err(invalid()),
        };
        let loopback = host.eq_ignore_ascii_case("localhost")
            || address.is_some_and(|address| address.is_loopback());
        let nearby = match address {
            Some(IpAddr::V4(address)) => {
                address.is_loopback() || address.is_private() || address.is_link_local()
            }
            Some(IpAddr::V6(address)) => {
                address.is_loopback()
                    || address.is_unique_local()
                    || address.is_unicast_link_local()
            }
            None => loopback || !host.contains('.'),
        };
        let without_tls = match url.query_pairs().find(|(key, _)| key == "tls") {
            None => false,
            Some((_, value)) if value == "none" => true,
            Some(_) => {
                return Err(
                    "OLEAFLY_SMTP_URL only understands tls=none, for a mail relay on the same private network."
                        .to_string(),
                )
            }
        };
        let (security, default_port) = match url.scheme() {
            "smtps" if without_tls => {
                return Err("tls=none works only with smtp:// addresses, not smtps://.".to_string())
            }
            "smtps" => (Security::Tls, 465),
            "smtp" if loopback || without_tls => (Security::Plain, 587),
            "smtp" => (Security::StartTls, 587),
            _ => return Err(invalid()),
        };
        if without_tls && !nearby {
            return Err(format!(
                "OLEAFLY_SMTP_URL asks for tls=none, but {host} is not on this machine or a private network, so every email would cross the network unencrypted. Remove tls=none, and if the relay's certificate is the problem, add its certificate authority to the server instead."
            ));
        }
        let username = Some(percent_decode(url.username())).filter(|name| !name.is_empty());
        let password = url.password().map(percent_decode);
        if without_tls && (username.is_some() || password.is_some()) {
            return Err(
                "With tls=none, OLEAFLY_SMTP_URL can't hold a user name or password, because they would cross the network unencrypted."
                    .to_string(),
            );
        }
        Ok(SmtpSettings {
            host,
            port: url.port().unwrap_or(default_port),
            security,
            username,
            password,
        })
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let decoded = (bytes[index] == b'%')
            .then(|| bytes.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| std::str::from_utf8(hex).ok())
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match decoded {
            Some(byte) => {
                out.push(byte);
                index += 3;
            }
            None => {
                out.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn parse_from(raw: &str) -> Result<Mailbox, String> {
    raw.trim().parse::<Mailbox>().map_err(|_| {
        "OLEAFLY_MAIL_FROM must contain an email address, such as Smith Lab <lab@example.edu>."
            .to_string()
    })
}

pub fn deliverable(addresses: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for address in addresses {
        let address = address.trim().to_lowercase();
        let domain = address.rsplit_once('@').map(|(_, domain)| domain);
        let usable = domain.is_some_and(|domain| !UNDELIVERABLE_DOMAINS.contains(&domain))
            && address.parse::<lettre::Address>().is_ok();
        if usable && !kept.contains(&address) {
            kept.push(address);
        }
        if kept.len() == MAX_RECIPIENTS {
            break;
        }
    }
    kept
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryPolicy {
    pub delays: Vec<Duration>,
    pub attempt_timeout: Duration,
}

impl Default for RetryPolicy {
    fn default() -> RetryPolicy {
        RetryPolicy {
            delays: [30, 120, 600, 1_800, 7_200]
                .into_iter()
                .map(Duration::from_secs)
                .collect(),
            attempt_timeout: Duration::from_secs(20),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailKind {
    AddedToServer,
    SharedWithYou,
    NewSignIn,
    Test,
    GuestInvitation,
    SignInLink,
    Mention,
}

impl EmailKind {
    fn is_sign_in_link(self) -> bool {
        matches!(self, EmailKind::SignInLink)
    }

    pub fn label(self) -> &'static str {
        match self {
            EmailKind::AddedToServer => "added to the server",
            EmailKind::SharedWithYou => "shared with you",
            EmailKind::NewSignIn => "new sign-in",
            EmailKind::Test => "test",
            EmailKind::GuestInvitation => "guest invitation",
            EmailKind::SignInLink => "sign-in link",
            EmailKind::Mention => "mention",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingEmail {
    pub kind: EmailKind,
    pub to: Vec<String>,
    pub subject: String,
    pub text: String,
    pub html: String,
    pub expires_at: Option<i64>,
}

impl OutgoingEmail {
    pub fn new(kind: EmailKind, to: Vec<String>, content: messages::Content) -> OutgoingEmail {
        OutgoingEmail {
            kind,
            to,
            subject: content.subject,
            text: content.text,
            html: content.html,
            expires_at: None,
        }
    }

    pub fn expiring_at(mut self, expires_at: i64) -> OutgoingEmail {
        self.expires_at = Some(expires_at);
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MailStats {
    pub delivered: u64,
    pub failed_attempts: u64,
    pub abandoned: u64,
    pub dropped: u64,
    pub last_failure: Option<EmailFailure>,
}

#[derive(Default)]
struct Pending {
    count: AtomicUsize,
    idle: Notify,
}

pub struct Tracked(Arc<Pending>);

impl Drop for Tracked {
    fn drop(&mut self) {
        if self.0.count.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.idle.notify_waiters();
        }
    }
}

struct Job {
    email: OutgoingEmail,
    attempt: usize,
    _tracked: Tracked,
}

impl Job {
    fn expired_by(&self, moment: i64) -> bool {
        self.email
            .expires_at
            .is_some_and(|expires_at| expires_at <= moment)
    }
}

#[derive(Clone)]
struct Delivery {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
    domain: String,
    secret: Option<String>,
    timeout: Duration,
    stats: Arc<Mutex<MailStats>>,
    clock: Arc<dyn Clock>,
}

struct Inner {
    delivery: Delivery,
    links: mpsc::Sender<Job>,
    others: mpsc::Sender<Job>,
    from: String,
    pending: Arc<Pending>,
}

#[derive(Clone, Default)]
pub struct Mailer {
    inner: Option<Arc<Inner>>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn hello_name(public_url: &Url) -> ClientId {
    match public_url.host() {
        Some(Host::Domain(domain)) => ClientId::Domain(domain.to_string()),
        Some(Host::Ipv4(address)) => ClientId::Ipv4(address),
        Some(Host::Ipv6(address)) => ClientId::Ipv6(address),
        None => ClientId::Domain("localhost".to_string()),
    }
}

fn transport(
    settings: &SmtpSettings,
    hello: ClientId,
    timeout: Duration,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let parameters = || {
        TlsParameters::new(settings.host.clone())
            .map_err(|error| format!("could not prepare TLS for {}: {error}", settings.host))
    };
    let tls = match settings.security {
        Security::Tls => Tls::Wrapper(parameters()?),
        Security::StartTls => Tls::Required(parameters()?),
        Security::Plain => Tls::None,
    };
    let mut builder =
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(settings.host.clone())
            .port(settings.port)
            .tls(tls)
            .timeout(Some(timeout))
            .hello_name(hello);
    if let Some(username) = &settings.username {
        builder = builder.credentials(Credentials::new(
            username.clone(),
            settings.password.clone().unwrap_or_default(),
        ));
    }
    Ok(builder.build())
}

fn describe(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !message.contains(&text) {
            message.push_str(": ");
            message.push_str(&text);
        }
        source = cause.source();
    }
    message
}

fn spoken(delay: Duration) -> String {
    let seconds = delay.as_secs();
    if seconds >= 3_600 {
        format!("{} h", seconds / 3_600)
    } else if seconds >= 60 {
        format!("{} min", seconds / 60)
    } else if seconds > 0 {
        format!("{seconds} s")
    } else {
        format!("{} ms", delay.as_millis())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Failure {
    message: String,
    permanent: bool,
}

impl Delivery {
    fn scrub(&self, text: String) -> String {
        match self.secret.as_deref().filter(|secret| !secret.is_empty()) {
            Some(secret) => text.replace(secret, HIDDEN),
            None => text,
        }
    }

    fn message(&self, email: &OutgoingEmail) -> Result<Message, String> {
        let mut builder = Message::builder()
            .from(self.from.clone())
            .subject(email.subject.clone())
            .message_id(Some(format!("<{}@{}>", random_token(), self.domain)));
        for address in &email.to {
            let mailbox = address
                .parse::<Mailbox>()
                .map_err(|_| "a recipient address is not valid".to_string())?;
            builder = builder.to(mailbox);
        }
        builder
            .multipart(MultiPart::alternative_plain_html(
                email.text.clone(),
                email.html.clone(),
            ))
            .map_err(|error| format!("could not build the email: {error}"))
    }

    async fn deliver(&self, email: &OutgoingEmail) -> Result<(), Failure> {
        let outcome = match self.message(email) {
            Ok(message) => {
                match tokio::time::timeout(self.timeout, self.transport.send(message)).await {
                    Ok(Ok(_)) => Ok(()),
                    Ok(Err(error)) => Err(Failure {
                        permanent: error.is_permanent(),
                        message: self.scrub(describe(&error)),
                    }),
                    Err(_) => Err(Failure {
                        message: format!(
                            "the mail server did not answer within {}",
                            spoken(self.timeout)
                        ),
                        permanent: false,
                    }),
                }
            }
            Err(message) => Err(Failure {
                message,
                permanent: true,
            }),
        };
        let mut stats = locked(&self.stats);
        match &outcome {
            Ok(()) => stats.delivered += 1,
            Err(failure) => {
                stats.failed_attempts += 1;
                stats.last_failure = Some(EmailFailure {
                    at: self.clock.now_ms(),
                    message: failure.message.clone(),
                });
            }
        }
        outcome
    }
}

struct Lane {
    delivery: Delivery,
    retry: mpsc::WeakSender<Job>,
    policy: Arc<RetryPolicy>,
    waiting: Arc<Semaphore>,
}

fn give_up(stats: &Mutex<MailStats>, kind: &str) {
    locked(stats).abandoned += 1;
    tracing::warn!(
        "Gave up sending the {kind} email because it would arrive after its link stops working."
    );
}

impl Lane {
    async fn attempt(&self, mut job: Job) {
        let kind = job.email.kind.label();
        if job.expired_by(self.delivery.clock.now_ms()) {
            give_up(&self.delivery.stats, kind);
            return;
        }
        let Err(failure) = self.delivery.deliver(&job.email).await else {
            return;
        };
        let error = failure.message;
        if failure.permanent {
            locked(&self.delivery.stats).abandoned += 1;
            tracing::error!(
                "Gave up sending the {kind} email because it can't be sent as it is: {error}"
            );
            return;
        }
        let attempts = self.policy.delays.len() + 1;
        let attempt = job.attempt + 1;
        let Some(delay) = self.policy.delays.get(job.attempt).copied() else {
            locked(&self.delivery.stats).abandoned += 1;
            tracing::error!("Gave up sending the {kind} email after {attempts} attempts: {error}");
            return;
        };
        let next_try = self
            .delivery
            .clock
            .now_ms()
            .saturating_add(i64::try_from(delay.as_millis()).unwrap_or(i64::MAX));
        if job.expired_by(next_try) {
            tracing::warn!(
                "Could not send the {kind} email (attempt {attempt} of {attempts}): {error}."
            );
            give_up(&self.delivery.stats, kind);
            return;
        }
        tracing::warn!(
            "Could not send the {kind} email (attempt {attempt} of {attempts}): {error}. Trying again in {}.",
            spoken(delay)
        );
        let Ok(held) = Arc::clone(&self.waiting).try_acquire_owned() else {
            locked(&self.delivery.stats).dropped += 1;
            tracing::warn!(
                "Dropped the {kind} email because too many emails are already waiting to be tried again."
            );
            return;
        };
        job.attempt = attempt;
        let retry = self.retry.clone();
        let stats = Arc::clone(&self.delivery.stats);
        tokio::spawn(async move {
            let _held = held;
            tokio::time::sleep(delay).await;
            let queued = match retry.upgrade() {
                Some(queue) => queue.try_send(job).is_ok(),
                None => false,
            };
            if !queued {
                locked(&stats).dropped += 1;
                tracing::warn!(
                    "Dropped the {kind} email because the mail queue is full or closed."
                );
            }
        });
    }
}

async fn work(lane: Lane, mut receiver: mpsc::Receiver<Job>, slots: usize) {
    let lane = Arc::new(lane);
    let slots = Arc::new(Semaphore::new(slots));
    while let Some(job) = receiver.recv().await {
        let Ok(slot) = Arc::clone(&slots).acquire_owned().await else {
            return;
        };
        let lane = Arc::clone(&lane);
        tokio::spawn(async move {
            lane.attempt(job).await;
            drop(slot);
        });
    }
}

fn lane(delivery: &Delivery, policy: &Arc<RetryPolicy>, slots: usize) -> mpsc::Sender<Job> {
    let (queue, receiver) = mpsc::channel(QUEUE_CAPACITY);
    let lane = Lane {
        delivery: delivery.clone(),
        retry: queue.downgrade(),
        policy: Arc::clone(policy),
        waiting: Arc::new(Semaphore::new(QUEUE_CAPACITY)),
    };
    tokio::spawn(work(lane, receiver, slots));
    queue
}

impl Mailer {
    pub fn disabled() -> Mailer {
        Mailer { inner: None }
    }

    pub fn start(
        config: &ServerConfig,
        clock: Arc<dyn Clock>,
        policy: RetryPolicy,
    ) -> Result<Mailer, ServerError> {
        let (Some(smtp_url), Some(mail_from)) = (&config.smtp_url, &config.mail_from) else {
            return Ok(Mailer::disabled());
        };
        let settings = SmtpSettings::parse(smtp_url).map_err(ServerError::Internal)?;
        let from = parse_from(mail_from).map_err(ServerError::Internal)?;
        let transport = transport(
            &settings,
            hello_name(&config.public_url),
            policy.attempt_timeout,
        )
        .map_err(ServerError::Internal)?;
        let delivery = Delivery {
            transport,
            domain: from.email.domain().to_string(),
            from: from.clone(),
            secret: settings.password.clone(),
            timeout: policy.attempt_timeout,
            stats: Arc::new(Mutex::new(MailStats::default())),
            clock,
        };
        let policy = Arc::new(policy);
        let links = lane(&delivery, &policy, LINK_SLOTS);
        let others = lane(&delivery, &policy, OTHER_SLOTS);
        Ok(Mailer {
            inner: Some(Arc::new(Inner {
                delivery,
                links,
                others,
                from: from.to_string(),
                pending: Arc::new(Pending::default()),
            })),
        })
    }

    pub fn is_configured(&self) -> bool {
        self.inner.is_some()
    }

    pub fn from_address(&self) -> Option<String> {
        self.inner.as_ref().map(|inner| inner.from.clone())
    }

    pub fn stats(&self) -> MailStats {
        self.inner
            .as_ref()
            .map(|inner| locked(&inner.delivery.stats).clone())
            .unwrap_or_default()
    }

    pub fn track(&self) -> Option<Tracked> {
        let inner = self.inner.as_ref()?;
        inner.pending.count.fetch_add(1, Ordering::SeqCst);
        Some(Tracked(Arc::clone(&inner.pending)))
    }

    pub async fn settled(&self) {
        let Some(inner) = &self.inner else {
            return;
        };
        loop {
            let idle = inner.pending.idle.notified();
            if inner.pending.count.load(Ordering::SeqCst) == 0 {
                return;
            }
            idle.await;
        }
    }

    pub fn enqueue(&self, email: OutgoingEmail) {
        let (Some(inner), Some(tracked)) = (&self.inner, self.track()) else {
            return;
        };
        if email.to.is_empty() {
            return;
        }
        let kind = email.kind.label();
        let queue = if email.kind.is_sign_in_link() {
            &inner.links
        } else {
            &inner.others
        };
        let job = Job {
            email,
            attempt: 0,
            _tracked: tracked,
        };
        if queue.try_send(job).is_err() {
            locked(&inner.delivery.stats).dropped += 1;
            tracing::warn!("Dropped the {kind} email because the mail queue is full.");
        }
    }

    pub async fn send_now(&self, email: OutgoingEmail) -> Result<(), String> {
        match &self.inner {
            Some(inner) => inner
                .delivery
                .deliver(&email)
                .await
                .map_err(|failure| failure.message),
            None => Err("this server has no email settings".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;
    use crate::test_support::{mail_config, MockSmtp, MockSmtpFault, TEST_START_MS};

    const SLOW: &str = "slow@uni.edu";
    const LINK_LIFETIME_MS: i64 = 15 * 60 * 1000;

    fn hanging_for(timeout: Duration) -> RetryPolicy {
        RetryPolicy {
            delays: Vec::new(),
            attempt_timeout: timeout,
        }
    }

    fn mailer(smtp: &MockSmtp, clock: &Arc<ManualClock>, policy: RetryPolicy) -> Mailer {
        let clock: Arc<dyn Clock> = clock.clone();
        Mailer::start(&mail_config(smtp), clock, policy).expect("the mailer starts")
    }

    fn notification(to: &str) -> OutgoingEmail {
        OutgoingEmail::new(
            EmailKind::SharedWithYou,
            vec![to.to_string()],
            messages::test_message("Lab"),
        )
    }

    fn sign_in_link(to: &str, expires_at: i64) -> OutgoingEmail {
        OutgoingEmail::new(
            EmailKind::SignInLink,
            vec![to.to_string()],
            messages::test_message("Lab"),
        )
        .expiring_at(expires_at)
    }

    async fn settle(mailer: &Mailer, within: Duration) {
        tokio::time::timeout(within, mailer.settled())
            .await
            .expect("the mail queue settles");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_sign_in_link_does_not_wait_behind_notifications_to_a_hanging_mail_server() {
        let smtp = MockSmtp::start().await;
        smtp.stall_mail_to(SLOW);
        let clock = ManualClock::new(TEST_START_MS);
        let mailer = mailer(&smtp, &clock, hanging_for(Duration::from_secs(2)));
        for _ in 0..6 {
            mailer.enqueue(notification(SLOW));
        }
        let asked = tokio::time::Instant::now();
        mailer.enqueue(sign_in_link(
            "ada@uni.edu",
            TEST_START_MS + LINK_LIFETIME_MS,
        ));
        let sent = smtp.wait_for(1, Duration::from_secs(20)).await;
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].rcpt_to, ["ada@uni.edu"]);
        assert!(
            asked.elapsed() < Duration::from_millis(1_500),
            "{:?}",
            asked.elapsed()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn notifications_to_a_hanging_mail_server_are_tried_a_few_at_a_time() {
        let smtp = MockSmtp::start().await;
        smtp.stall_mail_to(SLOW);
        let clock = ManualClock::new(TEST_START_MS);
        let mailer = mailer(&smtp, &clock, hanging_for(Duration::from_secs(2)));
        for _ in 0..8 {
            mailer.enqueue(notification(SLOW));
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(smtp.sessions(), OTHER_SLOTS);
        settle(&mailer, Duration::from_secs(20)).await;
        let stats = mailer.stats();
        assert_eq!((stats.failed_attempts, stats.abandoned), (8, 8));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_sign_in_link_that_expires_while_it_waits_to_be_retried_is_dropped() {
        let smtp = MockSmtp::start().await;
        smtp.fail_next(1, MockSmtpFault::RejectMail);
        let clock = ManualClock::new(TEST_START_MS);
        let policy = RetryPolicy {
            delays: vec![Duration::from_millis(400); 3],
            attempt_timeout: Duration::from_secs(5),
        };
        let mailer = mailer(&smtp, &clock, policy);
        mailer.enqueue(sign_in_link(
            "ada@uni.edu",
            TEST_START_MS + LINK_LIFETIME_MS,
        ));
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while mailer.stats().failed_attempts == 0 {
            assert!(tokio::time::Instant::now() < deadline, "no first attempt");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        clock.advance(LINK_LIFETIME_MS);
        settle(&mailer, Duration::from_secs(10)).await;
        assert!(smtp.messages().is_empty());
        assert_eq!(smtp.sessions(), 1);
        assert_eq!(mailer.stats().abandoned, 1);
    }

    #[tokio::test]
    async fn a_sign_in_link_already_expired_is_never_sent() {
        let smtp = MockSmtp::start().await;
        let clock = ManualClock::new(TEST_START_MS);
        let mailer = mailer(&smtp, &clock, hanging_for(Duration::from_secs(5)));
        mailer.enqueue(sign_in_link("ada@uni.edu", TEST_START_MS));
        settle(&mailer, Duration::from_secs(5)).await;
        assert_eq!(smtp.sessions(), 0);
        assert_eq!(mailer.stats().abandoned, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn sign_in_links_stop_retrying_before_the_link_runs_out() {
        let smtp = MockSmtp::start().await;
        smtp.fail_next(10, MockSmtpFault::RejectMail);
        let clock = ManualClock::new(TEST_START_MS);
        let policy = RetryPolicy {
            delays: vec![
                Duration::from_millis(50),
                Duration::from_secs(16 * 60),
                Duration::from_millis(50),
            ],
            attempt_timeout: Duration::from_secs(5),
        };
        let mailer = mailer(&smtp, &clock, policy);
        mailer.enqueue(sign_in_link(
            "ada@uni.edu",
            TEST_START_MS + LINK_LIFETIME_MS,
        ));
        settle(&mailer, Duration::from_secs(5)).await;
        assert_eq!(smtp.sessions(), 2);
        assert_eq!(mailer.stats().abandoned, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_recipient_the_mail_server_refuses_for_good_is_tried_once() {
        let smtp = MockSmtp::start().await;
        smtp.fail_next(1, MockSmtpFault::RejectRecipient);
        let clock = ManualClock::new(TEST_START_MS);
        let policy = RetryPolicy {
            delays: vec![Duration::from_millis(20); 3],
            attempt_timeout: Duration::from_secs(5),
        };
        let mailer = mailer(&smtp, &clock, policy);
        mailer.enqueue(notification("typo@uni.edu"));
        settle(&mailer, Duration::from_secs(10)).await;
        assert_eq!(smtp.sessions(), 1);
        let stats = mailer.stats();
        assert_eq!(
            (stats.failed_attempts, stats.abandoned, stats.delivered),
            (1, 1, 0)
        );
        let failure = stats.last_failure.expect("the refusal is kept");
        assert!(failure.message.contains("550"), "{}", failure.message);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn an_email_that_cannot_be_built_is_never_retried() {
        let smtp = MockSmtp::start().await;
        let clock = ManualClock::new(TEST_START_MS);
        let policy = RetryPolicy {
            delays: vec![Duration::from_millis(20); 3],
            attempt_timeout: Duration::from_secs(5),
        };
        let mailer = mailer(&smtp, &clock, policy);
        mailer.enqueue(notification("not an address"));
        settle(&mailer, Duration::from_secs(10)).await;
        assert_eq!(smtp.sessions(), 0);
        let stats = mailer.stats();
        assert_eq!((stats.failed_attempts, stats.abandoned), (1, 1));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_mail_server_that_asks_to_try_later_is_tried_again() {
        let smtp = MockSmtp::start().await;
        smtp.fail_next(2, MockSmtpFault::RejectMail);
        let clock = ManualClock::new(TEST_START_MS);
        let policy = RetryPolicy {
            delays: vec![Duration::from_millis(20); 3],
            attempt_timeout: Duration::from_secs(5),
        };
        let mailer = mailer(&smtp, &clock, policy);
        mailer.enqueue(notification("ada@uni.edu"));
        settle(&mailer, Duration::from_secs(10)).await;
        assert_eq!(smtp.sessions(), 3);
        let stats = mailer.stats();
        assert_eq!((stats.failed_attempts, stats.delivered), (2, 1));
    }

    #[test]
    fn smtps_addresses_use_tls_and_port_465_with_decoded_credentials() {
        let settings =
            SmtpSettings::parse("smtps://oleafly%40uni.edu:p%40ss%3Aw%2Frd@smtp.uni.edu").unwrap();
        assert_eq!(settings.host, "smtp.uni.edu");
        assert_eq!(settings.port, 465);
        assert_eq!(settings.security, Security::Tls);
        assert_eq!(settings.username.as_deref(), Some("oleafly@uni.edu"));
        assert_eq!(settings.password.as_deref(), Some("p@ss:w/rd"));
        assert!(!format!("{settings:?}").contains("p@ss"));
    }

    #[test]
    fn smtp_addresses_need_starttls_except_on_this_machine() {
        let remote = SmtpSettings::parse("smtp://relay.uni.edu").unwrap();
        assert_eq!((remote.security, remote.port), (Security::StartTls, 587));
        assert_eq!(remote.username, None);
        let custom = SmtpSettings::parse("smtp://relay.uni.edu:2525").unwrap();
        assert_eq!(custom.port, 2525);
        for local in [
            "smtp://localhost:25",
            "smtp://127.0.0.1:1025",
            "smtp://[::1]:25",
        ] {
            assert_eq!(
                SmtpSettings::parse(local).unwrap().security,
                Security::Plain,
                "{local}"
            );
        }
        assert_eq!(
            SmtpSettings::parse("smtps://localhost").unwrap().security,
            Security::Tls
        );
        for bad in ["https://smtp.uni.edu", "smtp://", "not a url"] {
            assert!(SmtpSettings::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_relay_on_the_same_private_network_can_skip_tls_when_asked() {
        let relay = SmtpSettings::parse("smtp://mailpit:1025?tls=none").unwrap();
        assert_eq!(relay.host, "mailpit");
        assert_eq!((relay.port, relay.security), (1025, Security::Plain));
        assert_eq!(
            SmtpSettings::parse("smtp://mailpit:1025").unwrap().security,
            Security::StartTls
        );
        for refused in [
            "smtps://mailpit:1025?tls=none",
            "smtp://mailpit?tls=maybe",
            "smtp://lab:secret@mailpit:1025?tls=none",
            "smtp://lab@mailpit:1025?tls=none",
        ] {
            assert!(SmtpSettings::parse(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn tls_none_works_only_for_a_relay_on_this_machine_or_a_private_network() {
        for nearby in [
            "smtp://mailpit:1025?tls=none",
            "smtp://10.0.0.5?tls=none",
            "smtp://172.20.0.3:25?tls=none",
            "smtp://192.168.1.10?tls=none",
            "smtp://169.254.10.1?tls=none",
            "smtp://[fd00::25]:25?tls=none",
            "smtp://[fe80::1]?tls=none",
            "smtp://127.0.0.1:1025?tls=none",
            "smtp://localhost?tls=none",
        ] {
            let settings =
                SmtpSettings::parse(nearby).unwrap_or_else(|error| panic!("{nearby}: {error}"));
            assert_eq!(settings.security, Security::Plain, "{nearby}");
        }
        for far in [
            "smtp://smtp.example.org?tls=none",
            "smtp://203.0.113.5?tls=none",
            "smtp://relay.lab.internal?tls=none",
            "smtp://[2001:db8::25]?tls=none",
        ] {
            let error = SmtpSettings::parse(far).expect_err(far);
            let host = Url::parse(far)
                .unwrap()
                .host_str()
                .unwrap()
                .trim_matches(['[', ']'])
                .to_string();
            assert!(error.contains(&host), "{far}: {error}");
            assert!(error.contains("certificate authority"), "{far}: {error}");
        }
        assert_eq!(
            SmtpSettings::parse("smtp://smtp.example.org")
                .unwrap()
                .security,
            Security::StartTls
        );
    }

    #[test]
    fn the_from_address_may_carry_a_name() {
        let from = parse_from("Smith Lab <lab@uni.edu>").unwrap();
        assert_eq!(from.name.as_deref(), Some("Smith Lab"));
        assert_eq!(from.email.to_string(), "lab@uni.edu");
        assert!(parse_from("lab@uni.edu").is_ok());
        assert!(parse_from("Smith Lab").is_err());
        assert!(parse_from("Smith Lab <lab>").is_err());
    }

    #[test]
    fn only_real_distinct_addresses_receive_mail_and_never_too_many() {
        let addresses: Vec<String> = [
            "Ada@Uni.edu",
            "ada@uni.edu",
            "12345+ada@users.noreply.github.com",
            "not an address",
            "ada@lab.uni.edu",
        ]
        .iter()
        .map(|text| text.to_string())
        .collect();
        assert_eq!(
            deliverable(&addresses),
            ["ada@uni.edu".to_string(), "ada@lab.uni.edu".to_string()]
        );
        let many: Vec<String> = (0..20).map(|index| format!("p{index}@uni.edu")).collect();
        assert_eq!(deliverable(&many).len(), MAX_RECIPIENTS);
    }

    #[tokio::test]
    async fn a_mailer_without_settings_accepts_mail_and_sends_nothing() {
        let mailer = Mailer::disabled();
        assert!(!mailer.is_configured());
        assert_eq!(mailer.from_address(), None);
        assert!(mailer.track().is_none());
        mailer.enqueue(OutgoingEmail::new(
            EmailKind::Test,
            vec!["ada@uni.edu".to_string()],
            messages::test_message("Lab"),
        ));
        mailer.settled().await;
        assert_eq!(mailer.stats(), MailStats::default());
        assert!(mailer
            .send_now(OutgoingEmail::new(
                EmailKind::Test,
                vec!["ada@uni.edu".to_string()],
                messages::test_message("Lab"),
            ))
            .await
            .is_err());
    }
}
