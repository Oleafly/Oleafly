use std::collections::HashMap;
use std::time::Duration;

use ::url::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use oleafly_collab_protocol::capabilities::ProviderKind;
use oleafly_collab_protocol::page::{document, escape, status, Tone};

use crate::CollabError;

const MAX_REQUEST_BYTES: usize = 8192;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CallbackOutcome {
    Code(String),
    Error {
        code: String,
        description: Option<String>,
    },
}

pub(crate) struct LoopbackListener {
    listener: TcpListener,
    port: u16,
    pages: Pages,
}

pub(crate) struct Callback {
    pub(crate) outcome: CallbackOutcome,
    reply: Option<HeldReply>,
}

struct HeldReply {
    stream: TcpStream,
    pages: Pages,
}

impl Callback {
    pub(crate) async fn answer(self, result: Result<(), &CollabError>) {
        let Some(HeldReply { mut stream, pages }) = self.reply else {
            return;
        };
        let page = match result {
            Ok(()) => pages.signed_in(),
            Err(error) => pages.not_finished(error),
        };
        respond(&mut stream, "200 OK", &page).await;
    }
}

struct Pages {
    server: String,
    provider: String,
    by_email: bool,
}

impl Pages {
    fn card(tone: Tone, heading: &str, reason: &str, next: Option<&str>) -> String {
        let next = next
            .map(|text| format!("<p class=\"next\">{text}</p>"))
            .unwrap_or_default();
        format!("{}<h1>{heading}</h1><p>{reason}</p>{next}", status(tone))
    }

    fn page(&self, title: &str, card: String) -> String {
        document(title, &card, Some(&self.server))
    }

    fn signed_in(&self) -> String {
        let server = escape(&self.server);
        self.page(
            "You're signed in",
            Pages::card(
                Tone::Success,
                "You're signed in",
                &format!("Oleafly is now connected to {server}."),
                Some("Go back to Oleafly to keep going. You can close this tab."),
            ),
        )
    }

    fn refused(&self, code: &str, account: Option<&str>) -> String {
        let server = escape(&self.server);
        let provider = escape(&self.provider);
        let (title, card) = match code {
            "not_admitted" if self.by_email => {
                let reason = match account {
                    Some(account) => format!(
                        "You signed in with <strong>{}</strong>, and that address isn't on this server's list.",
                        escape(account)
                    ),
                    None => "That email address isn't on this server's list.".to_string(),
                };
                (
                    format!("Not allowed on {}", self.server),
                    Pages::card(
                        Tone::Problem,
                        &format!("{server} didn't let you in"),
                        &reason,
                        Some("Ask the server's admin to add it, or start again in Oleafly with an address they added."),
                    ),
                )
            }
            "not_admitted" => {
                let reason = match account {
                    Some(account) => format!(
                        "You signed in to {provider} as <strong>{}</strong>, and that account isn't on this server's list.",
                        escape(account)
                    ),
                    None => format!("Your {provider} account isn't on this server's list."),
                };
                (
                    format!("Not allowed on {}", self.server),
                    Pages::card(
                        Tone::Problem,
                        &format!("{server} didn't let you in"),
                        &reason,
                        Some(&format!(
                            "Ask the server's admin to add you. To use a different account, sign out of {provider} in this browser, then try again in Oleafly."
                        )),
                    ),
                )
            }
            "sign_in_cancelled" => (
                "Sign-in cancelled".to_string(),
                Pages::card(
                    Tone::Notice,
                    "Sign-in cancelled",
                    &format!("You didn't let {server} use your {provider} account."),
                    Some("Go back to Oleafly if you want to try again."),
                ),
            ),
            "setup_code_invalid" => (
                "The setup code didn't work".to_string(),
                Pages::card(
                    Tone::Problem,
                    "The setup code didn't work",
                    "It's wrong, or someone already used it.",
                    Some("Copy the newest Setup code line from the server's log, then try again in Oleafly."),
                ),
            ),
            "provider_failed" => (
                "Sign-in didn't finish".to_string(),
                Pages::card(
                    Tone::Problem,
                    &format!("{provider} didn't finish signing you in"),
                    &format!("The sign-in stopped before {server} heard back from {provider}."),
                    Some("Go back to Oleafly and try again. If it keeps happening, tell the server's admin."),
                ),
            ),
            "invalid_code" | "expired_nonce" => (
                "This sign-in expired".to_string(),
                Pages::card(
                    Tone::Problem,
                    "This sign-in expired",
                    "It took too long, or it was already used.",
                    Some("Go back to Oleafly and start signing in again."),
                ),
            ),
            "device_in_use" => (
                "Linked to another account".to_string(),
                Pages::card(
                    Tone::Problem,
                    "This computer is linked to another account",
                    &format!("{server} has this computer on another person's account."),
                    Some("Go back to Oleafly and sign in again. Your next try sets this computer up for you."),
                ),
            ),
            "unknown_provider" => (
                "This sign-in option is off".to_string(),
                Pages::card(
                    Tone::Problem,
                    "This sign-in option is off",
                    &format!("{server} doesn't offer {provider} sign-in any more."),
                    Some("Go back to Oleafly and choose another way to sign in."),
                ),
            ),
            _ => (
                "Sign-in didn't finish".to_string(),
                Pages::card(
                    Tone::Problem,
                    "Sign-in didn't finish",
                    &format!("{server} stopped the sign-in before it was done."),
                    Some("Go back to Oleafly and try again."),
                ),
            ),
        };
        self.page(&title, card)
    }

    fn not_finished(&self, error: &CollabError) -> String {
        match error {
            CollabError::NotAdmitted => self.refused("not_admitted", None),
            CollabError::SignInCancelled => self.refused("sign_in_cancelled", None),
            CollabError::Api { code, .. } => self.refused(code, None),
            _ => self.unfinished(),
        }
    }

    fn out_of_date(&self) -> String {
        self.page(
            "This sign-in is out of date",
            Pages::card(
                Tone::Problem,
                "This sign-in is out of date",
                "This page belongs to an earlier sign-in.",
                Some("Go back to Oleafly and start signing in again."),
            ),
        )
    }

    fn unfinished(&self) -> String {
        self.refused("", None)
    }

    fn elsewhere(&self) -> String {
        self.page(
            "Oleafly sign-in",
            Pages::card(
                Tone::Notice,
                "Nothing to show here",
                "Oleafly uses this address only while you sign in to a collaboration server.",
                None,
            ),
        )
    }
}

impl LoopbackListener {
    pub(crate) async fn bind() -> Result<LoopbackListener, CollabError> {
        LoopbackListener::bind_to(("127.0.0.1", 0)).await
    }

    pub(crate) async fn bind_to(address: (&str, u16)) -> Result<LoopbackListener, CollabError> {
        let listener = TcpListener::bind(address)
            .await
            .map_err(|_| CollabError::SignInTimedOut)?;
        let port = listener
            .local_addr()
            .map_err(|error| CollabError::Io(error.to_string()))?
            .port();
        Ok(LoopbackListener {
            listener,
            port,
            pages: Pages {
                server: "the server".to_string(),
                provider: "your sign-in provider".to_string(),
                by_email: false,
            },
        })
    }

    pub(crate) fn describing(
        mut self,
        server: &str,
        provider: &str,
        kind: ProviderKind,
    ) -> LoopbackListener {
        self.pages = Pages {
            server: server.to_string(),
            provider: provider.to_string(),
            by_email: kind == ProviderKind::EmailLink,
        };
        self
    }

    pub(crate) fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    pub(crate) async fn wait(
        self,
        expected_state: &str,
        timeout: Duration,
    ) -> Result<Callback, CollabError> {
        let served = tokio::time::timeout(timeout, self.serve(expected_state)).await;
        let LoopbackListener {
            listener, pages, ..
        } = self;
        drop(listener);
        let (outcome, held) = match served {
            Ok(served) => served?,
            Err(_) => return Err(CollabError::SignInTimedOut),
        };
        Ok(Callback {
            outcome,
            reply: held.map(|stream| HeldReply { stream, pages }),
        })
    }

    async fn serve(
        &self,
        expected_state: &str,
    ) -> Result<(CallbackOutcome, Option<TcpStream>), CollabError> {
        loop {
            let (mut stream, _) = self
                .listener
                .accept()
                .await
                .map_err(|error| CollabError::Io(error.to_string()))?;
            let Some(target) = read_target(&mut stream).await else {
                continue;
            };
            if target.path() != "/callback" {
                respond(&mut stream, "404 Not Found", &self.pages.elsewhere()).await;
                continue;
            }
            let query: HashMap<String, String> = target.query_pairs().into_owned().collect();
            if query.get("state").map(String::as_str) != Some(expected_state) {
                respond(&mut stream, "400 Bad Request", &self.pages.out_of_date()).await;
                return Err(CollabError::Unauthorized);
            }
            if let Some(code) = query.get("error") {
                let account = query
                    .get("account")
                    .map(String::as_str)
                    .filter(|account| !account.is_empty());
                respond(&mut stream, "200 OK", &self.pages.refused(code, account)).await;
                return Ok((
                    CallbackOutcome::Error {
                        code: code.clone(),
                        description: query.get("error_description").cloned(),
                    },
                    None,
                ));
            }
            return match query.get("code").filter(|code| !code.is_empty()) {
                Some(code) => Ok((CallbackOutcome::Code(code.clone()), Some(stream))),
                None => {
                    respond(&mut stream, "400 Bad Request", &self.pages.unfinished()).await;
                    Err(CollabError::Unauthorized)
                }
            };
        }
    }
}

async fn read_target(stream: &mut TcpStream) -> Option<Url> {
    let mut head = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let reading = async {
        loop {
            let count = stream.read(&mut chunk).await.ok()?;
            if count == 0 {
                return None;
            }
            head.extend_from_slice(&chunk[..count]);
            if head.windows(4).any(|window| window == b"\r\n\r\n") {
                return Some(());
            }
            if head.len() > MAX_REQUEST_BYTES {
                return None;
            }
        }
    };
    tokio::time::timeout(READ_TIMEOUT, reading).await.ok()??;
    let text = String::from_utf8_lossy(&head);
    let mut parts = text.lines().next()?.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" || !target.starts_with('/') {
        return None;
    }
    Url::parse(&format!("http://127.0.0.1{target}")).ok()
}

async fn respond(stream: &mut TcpStream, status: &str, page: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port_of(listener: &LoopbackListener) -> u16 {
        Url::parse(&listener.redirect_uri())
            .expect("redirect")
            .port()
            .expect("port")
    }

    async fn get(url: String) -> reqwest::Response {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client")
            .get(url)
            .send()
            .await
            .expect("response")
    }

    async fn port_is_closed(port: u16) -> bool {
        TcpStream::connect(("127.0.0.1", port)).await.is_err()
    }

    #[tokio::test]
    async fn redirect_uri_is_a_loopback_callback() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let redirect = listener.redirect_uri();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        assert!(redirect.ends_with("/callback"));
    }

    #[tokio::test]
    async fn matching_state_returns_the_code_and_frees_the_port() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let port = port_of(&listener);
        let url = format!("{}?code=abc&state=s1", listener.redirect_uri());
        let browser = tokio::spawn(get(url));
        let callback = listener
            .wait("s1", Duration::from_secs(5))
            .await
            .expect("callback");
        assert_eq!(callback.outcome, CallbackOutcome::Code("abc".to_string()));
        assert!(port_is_closed(port).await);
        callback.answer(Ok(())).await;
        let response = browser.await.expect("browser");
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert!(response
            .text()
            .await
            .expect("body")
            .contains("<title>You&#39;re signed in</title>"));
    }

    async fn answered_page(
        listener: LoopbackListener,
        query: &str,
        result: Result<(), &CollabError>,
    ) -> String {
        let url = format!("{}?{query}", listener.redirect_uri());
        let browser = tokio::spawn(get(url));
        if let Ok(callback) = listener.wait("s1", Duration::from_secs(5)).await {
            callback.answer(result).await;
        }
        browser.await.expect("browser").text().await.expect("body")
    }

    async fn page_after(listener: LoopbackListener, query: &str) -> String {
        answered_page(listener, query, Ok(())).await
    }

    #[tokio::test]
    async fn the_browser_hears_nothing_until_the_app_has_its_session() {
        let listener = lab().await;
        let url = format!("{}?code=abc&state=s1", listener.redirect_uri());
        let mut browser = tokio::spawn(get(url));
        let callback = listener
            .wait("s1", Duration::from_secs(5))
            .await
            .expect("callback");
        assert!(
            tokio::time::timeout(Duration::from_millis(300), &mut browser)
                .await
                .is_err(),
            "the browser got a page before the token exchange finished"
        );
        callback.answer(Ok(())).await;
        let page = browser.await.expect("browser").text().await.expect("body");
        assert!(page.contains("<h1>You're signed in</h1>"), "{page}");
    }

    #[tokio::test]
    async fn a_refused_token_exchange_shows_why_instead_of_signed_in() {
        let refused = CollabError::Api {
            status: 409,
            code: "device_in_use".to_string(),
            message: "This device is signed in to another account on this server.".to_string(),
        };
        let page = answered_page(lab().await, "code=abc&state=s1", Err(&refused)).await;
        assert!(!page.contains("You're signed in"), "{page}");
        assert!(page.contains("class=\"status problem\""), "{page}");
        assert!(page.contains("<h1>This computer is linked to another account</h1>"));
        assert!(page.contains("Oleafly Lab has this computer on another person's account."));
        assert!(page.contains("Go back to Oleafly and sign in again."));
        let unreachable = CollabError::Network("connection reset".to_string());
        let page = answered_page(lab().await, "code=abc&state=s1", Err(&unreachable)).await;
        assert!(!page.contains("You're signed in"), "{page}");
        assert!(page.contains("<h1>Sign-in didn't finish</h1>"), "{page}");
        let page = answered_page(
            lab().await,
            "code=abc&state=s1",
            Err(&CollabError::NotAdmitted),
        )
        .await;
        assert!(page.contains("didn't let you in"), "{page}");
    }

    async fn lab() -> LoopbackListener {
        LoopbackListener::bind().await.expect("bind").describing(
            "Oleafly Lab",
            "GitHub",
            ProviderKind::Github,
        )
    }

    async fn lab_by_email() -> LoopbackListener {
        LoopbackListener::bind().await.expect("bind").describing(
            "Oleafly Lab",
            "Email",
            ProviderKind::EmailLink,
        )
    }

    #[tokio::test]
    async fn an_email_refusal_names_the_address_and_never_says_sign_out() {
        let page = page_after(
            lab_by_email().await,
            "error=not_admitted&account=dave%40example.edu&state=s1",
        )
        .await;
        assert!(
            page.contains("<h1>Oleafly Lab didn't let you in</h1>"),
            "{page}"
        );
        assert!(page.contains(
            "You signed in with <strong>dave@example.edu</strong>, and that address isn't on this server's list."
        ));
        assert!(page.contains("start again in Oleafly with an address they added"));
        assert!(!page.contains("sign out"));
        assert!(!page.contains("Email account"));
    }

    #[tokio::test]
    async fn a_finished_sign_in_says_where_you_are_signed_in() {
        let page = page_after(lab().await, "code=abc&state=s1").await;
        assert!(page.contains("class=\"brand\""), "{page}");
        assert!(page.contains("class=\"status success\""));
        assert!(page.contains("<h1>You're signed in</h1>"));
        assert!(page.contains("Oleafly is now connected to Oleafly Lab."));
        assert!(page.contains("You can close this tab."));
    }

    #[tokio::test]
    async fn a_refused_sign_in_names_the_account_and_says_what_to_do() {
        let page = page_after(lab().await, "error=not_admitted&account=%40carol&state=s1").await;
        assert!(page.contains("class=\"status problem\""), "{page}");
        assert!(page.contains("<h1>Oleafly Lab didn't let you in</h1>"));
        assert!(page.contains("You signed in to GitHub as <strong>@carol</strong>"));
        assert!(page.contains("Ask the server's admin to add you."));
        assert!(page.contains("sign out of GitHub in this browser"));
    }

    #[tokio::test]
    async fn a_refusal_without_an_account_still_gives_the_reason() {
        let page = page_after(lab().await, "error=not_admitted&state=s1").await;
        assert!(
            page.contains("Your GitHub account isn't on this server's list."),
            "{page}"
        );
    }

    #[tokio::test]
    async fn the_account_name_cannot_add_markup_to_the_page() {
        let page = page_after(
            lab().await,
            "error=not_admitted&account=%3Cscript%3Ex%3C%2Fscript%3E&state=s1",
        )
        .await;
        assert!(page.contains("&lt;script&gt;x&lt;/script&gt;"), "{page}");
        assert!(!page.contains("<script>"));
    }

    #[tokio::test]
    async fn a_cancelled_sign_in_reads_as_a_choice_not_a_failure() {
        let page = page_after(lab().await, "error=sign_in_cancelled&state=s1").await;
        assert!(page.contains("class=\"status notice\""), "{page}");
        assert!(page.contains("<h1>Sign-in cancelled</h1>"));
    }

    #[tokio::test]
    async fn a_bad_setup_code_says_where_to_find_a_good_one() {
        let page = page_after(lab().await, "error=setup_code_invalid&state=s1").await;
        assert!(
            page.contains("<h1>The setup code didn't work</h1>"),
            "{page}"
        );
        assert!(page.contains("Setup code"));
    }

    #[tokio::test]
    async fn any_other_failure_still_explains_the_next_step() {
        let page = page_after(lab().await, "error=revoked&state=s1").await;
        assert!(page.contains("class=\"status problem\""), "{page}");
        assert!(page.contains("Go back to Oleafly"));
    }

    #[tokio::test]
    async fn mismatched_state_is_refused_and_frees_the_port() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let port = port_of(&listener);
        let url = format!("{}?code=abc&state=forged", listener.redirect_uri());
        let (outcome, response) =
            tokio::join!(listener.wait("s1", Duration::from_secs(5)), get(url));
        assert!(matches!(outcome, Err(CollabError::Unauthorized)));
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn server_error_is_reported_with_its_code() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let url = format!(
            "{}?error=not_admitted&error_description=nope&state=s1",
            listener.redirect_uri()
        );
        let (outcome, _) = tokio::join!(listener.wait("s1", Duration::from_secs(5)), get(url));
        assert_eq!(
            outcome.expect("outcome").outcome,
            CallbackOutcome::Error {
                code: "not_admitted".to_string(),
                description: Some("nope".to_string()),
            }
        );
    }

    #[tokio::test]
    async fn a_port_that_cannot_be_opened_reads_as_a_browser_that_never_came_back() {
        let outcome = LoopbackListener::bind_to(("192.0.2.1", 0)).await;
        assert!(matches!(outcome, Err(CollabError::SignInTimedOut)));
    }

    #[tokio::test]
    async fn silence_times_out_and_frees_the_port() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let port = port_of(&listener);
        let outcome = listener.wait("s1", Duration::from_millis(100)).await;
        assert!(matches!(outcome, Err(CollabError::SignInTimedOut)));
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn other_paths_get_not_found_and_the_wait_continues() {
        let listener = LoopbackListener::bind().await.expect("bind");
        let base = format!("http://127.0.0.1:{}", port_of(&listener));
        let callback = format!("{}?code=xyz&state=s1", listener.redirect_uri());
        let requests = tokio::spawn(async move {
            let favicon = get(format!("{base}/favicon.ico")).await;
            let done = get(callback).await;
            (favicon.status(), done.status())
        });
        let outcome = listener
            .wait("s1", Duration::from_secs(5))
            .await
            .expect("callback");
        assert_eq!(outcome.outcome, CallbackOutcome::Code("xyz".to_string()));
        outcome.answer(Ok(())).await;
        let (favicon, done) = requests.await.expect("requests");
        assert_eq!(favicon, reqwest::StatusCode::NOT_FOUND);
        assert_eq!(done, reqwest::StatusCode::OK);
    }
}
