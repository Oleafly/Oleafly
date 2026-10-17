use std::collections::HashMap;
use std::time::Duration;

use ::url::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use oleafly_collab_protocol::capabilities::ProviderKind;
use oleafly_collab_protocol::page::{document_in, escape, status, Tone};

use super::loopback_text::{Language, Text};
use super::ServerUrl;
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
    issuer: ServerUrl,
}

pub(crate) struct Callback {
    pub(crate) outcome: CallbackOutcome,
    reply: Option<HeldReply>,
}

struct HeldReply {
    stream: TcpStream,
    pages: Pages,
    language: Language,
}

impl Callback {
    pub(crate) async fn answer(self, result: Result<(), &CollabError>) {
        let Some(HeldReply {
            mut stream,
            pages,
            language,
        }) = self.reply
        else {
            return;
        };
        let speaking = pages.speaking(language);
        let page = match result {
            Ok(()) => speaking.signed_in(),
            Err(error) => speaking.not_finished(error),
        };
        respond(&mut stream, "200 OK", &page).await;
    }
}

enum Issuer {
    Here,
    Unnamed,
    Elsewhere,
}

struct Pages {
    server: Option<String>,
    provider: Option<String>,
    by_email: bool,
}

impl Pages {
    fn speaking(&self, language: Language) -> Speaking {
        Speaking {
            language,
            server: self
                .server
                .clone()
                .unwrap_or_else(|| language.text(Text::DefaultServer).to_owned()),
            provider: self
                .provider
                .clone()
                .unwrap_or_else(|| language.text(Text::DefaultProvider).to_owned()),
            by_email: self.by_email,
        }
    }
}

struct Speaking {
    language: Language,
    server: String,
    provider: String,
    by_email: bool,
}

impl Speaking {
    fn html(&self, text: Text) -> String {
        self.with_account(text, None)
    }

    fn with_account(&self, text: Text, account: Option<&str>) -> String {
        let server = escape(&self.server);
        let provider = escape(&self.provider);
        let account = account
            .map(|account| format!("<strong>{}</strong>", escape(account)))
            .unwrap_or_default();
        self.language.html(
            text,
            &[
                ("server", &server),
                ("provider", &provider),
                ("account", &account),
            ],
        )
    }

    fn page(
        &self,
        title: Text,
        tone: Tone,
        heading: Text,
        reason: String,
        next: Option<Text>,
    ) -> String {
        let title = self.language.plain(
            title,
            &[("server", &self.server), ("provider", &self.provider)],
        );
        let next = next
            .map(|text| format!("<p class=\"next\">{}</p>", self.html(text)))
            .unwrap_or_default();
        let card = format!(
            "{}<h1>{}</h1><p>{reason}</p>{next}",
            status(tone),
            self.html(heading)
        );
        document_in(self.language.tag(), &title, &card, Some(&self.server))
    }

    fn signed_in(&self) -> String {
        self.page(
            Text::SignedInTitle,
            Tone::Success,
            Text::SignedInTitle,
            self.html(Text::SignedInBody),
            Some(Text::SignedInNext),
        )
    }

    fn not_admitted(&self, account: Option<&str>) -> String {
        let (with_account, without, next) = if self.by_email {
            (
                Text::RefusedEmailAccount,
                Text::RefusedEmail,
                Text::RefusedEmailNext,
            )
        } else {
            (
                Text::RefusedProviderAccount,
                Text::RefusedProvider,
                Text::RefusedProviderNext,
            )
        };
        let reason = match account {
            Some(account) => self.with_account(with_account, Some(account)),
            None => self.html(without),
        };
        self.page(
            Text::RefusedTitle,
            Tone::Problem,
            Text::RefusedHeading,
            reason,
            Some(next),
        )
    }

    fn refused(&self, code: &str, account: Option<&str>) -> String {
        let (title, tone, heading, reason, next) = match code {
            "not_admitted" => return self.not_admitted(account),
            "sign_in_cancelled" => (
                Text::CancelledTitle,
                Tone::Notice,
                Text::CancelledTitle,
                Text::CancelledBody,
                Text::CancelledNext,
            ),
            "setup_code_invalid" => (
                Text::SetupCodeTitle,
                Tone::Problem,
                Text::SetupCodeTitle,
                Text::SetupCodeBody,
                Text::SetupCodeNext,
            ),
            "provider_failed" => (
                Text::UnfinishedTitle,
                Tone::Problem,
                Text::ProviderFailedHeading,
                Text::ProviderFailedBody,
                Text::ProviderFailedNext,
            ),
            "invalid_code" | "expired_nonce" => (
                Text::ExpiredTitle,
                Tone::Problem,
                Text::ExpiredTitle,
                Text::ExpiredBody,
                Text::StartAgain,
            ),
            "device_in_use" => (
                Text::DeviceInUseTitle,
                Tone::Problem,
                Text::DeviceInUseHeading,
                Text::DeviceInUseBody,
                Text::DeviceInUseNext,
            ),
            "unknown_provider" => (
                Text::OptionOffTitle,
                Tone::Problem,
                Text::OptionOffTitle,
                Text::OptionOffBody,
                Text::OptionOffNext,
            ),
            _ => (
                Text::UnfinishedTitle,
                Tone::Problem,
                Text::UnfinishedTitle,
                Text::UnfinishedBody,
                Text::UnfinishedNext,
            ),
        };
        self.page(title, tone, heading, self.html(reason), Some(next))
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
            Text::OutOfDateTitle,
            Tone::Problem,
            Text::OutOfDateTitle,
            self.html(Text::OutOfDateBody),
            Some(Text::StartAgain),
        )
    }

    fn old_server(&self) -> String {
        self.page(
            Text::OldServerTitle,
            Tone::Problem,
            Text::OldServerTitle,
            self.html(Text::OldServerBody),
            Some(Text::OldServerNext),
        )
    }

    fn other_server(&self) -> String {
        self.page(
            Text::OtherServerTitle,
            Tone::Problem,
            Text::OtherServerTitle,
            self.html(Text::OtherServerBody),
            Some(Text::OtherServerNext),
        )
    }

    fn unfinished(&self) -> String {
        self.refused("", None)
    }

    fn elsewhere(&self) -> String {
        self.page(
            Text::ElsewhereTitle,
            Tone::Notice,
            Text::ElsewhereHeading,
            self.html(Text::ElsewhereBody),
            None,
        )
    }
}

struct Request {
    target: Url,
    language: Language,
}

impl LoopbackListener {
    // A callback counts only when its `iss` names `issuer`, the server the
    // sign-in started with (RFC 9207), so a code from any other server that
    // the browser was bounced to is never sent anywhere.
    pub(crate) async fn bind(issuer: ServerUrl) -> Result<LoopbackListener, CollabError> {
        LoopbackListener::bind_to(("127.0.0.1", 0), issuer).await
    }

    pub(crate) async fn bind_to(
        address: (&str, u16),
        issuer: ServerUrl,
    ) -> Result<LoopbackListener, CollabError> {
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
                server: None,
                provider: None,
                by_email: false,
            },
            issuer,
        })
    }

    fn issuer_of(&self, target: &Url) -> Issuer {
        let mut named = target
            .query_pairs()
            .filter(|(name, _)| name == "iss")
            .map(|(_, value)| ServerUrl::parse(&value));
        match (named.next(), named.next()) {
            (Some(Ok(issuer)), None) if issuer.as_str() == self.issuer.as_str() => Issuer::Here,
            // Servers from before the issuer check never send one. That is an
            // update for the admin, not a sign of another server.
            (None, _) => Issuer::Unnamed,
            _ => Issuer::Elsewhere,
        }
    }

    pub(crate) fn describing(
        mut self,
        server: &str,
        provider: &str,
        kind: ProviderKind,
    ) -> LoopbackListener {
        self.pages = Pages {
            server: Some(server.to_string()),
            provider: Some(provider.to_string()),
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
            reply: held.map(|(stream, language)| HeldReply {
                stream,
                pages,
                language,
            }),
        })
    }

    async fn serve(
        &self,
        expected_state: &str,
    ) -> Result<(CallbackOutcome, Option<(TcpStream, Language)>), CollabError> {
        loop {
            let (mut stream, _) = self
                .listener
                .accept()
                .await
                .map_err(|error| CollabError::Io(error.to_string()))?;
            let Some(Request { target, language }) = read_request(&mut stream).await else {
                continue;
            };
            let speaking = self.pages.speaking(language);
            if target.path() != "/callback" {
                respond(&mut stream, "404 Not Found", &speaking.elsewhere()).await;
                continue;
            }
            let query: HashMap<String, String> = target.query_pairs().into_owned().collect();
            if query.get("state").map(String::as_str) != Some(expected_state) {
                respond(&mut stream, "400 Bad Request", &speaking.out_of_date()).await;
                return Err(CollabError::Unauthorized);
            }
            match self.issuer_of(&target) {
                Issuer::Here => {}
                Issuer::Unnamed => {
                    respond(&mut stream, "400 Bad Request", &speaking.old_server()).await;
                    continue;
                }
                Issuer::Elsewhere => {
                    respond(&mut stream, "400 Bad Request", &speaking.other_server()).await;
                    continue;
                }
            }
            if let Some(code) = query.get("error") {
                let account = query
                    .get("account")
                    .map(String::as_str)
                    .filter(|account| !account.is_empty());
                respond(&mut stream, "200 OK", &speaking.refused(code, account)).await;
                return Ok((
                    CallbackOutcome::Error {
                        code: code.clone(),
                        description: query.get("error_description").cloned(),
                    },
                    None,
                ));
            }
            return match query.get("code").filter(|code| !code.is_empty()) {
                Some(code) => Ok((
                    CallbackOutcome::Code(code.clone()),
                    Some((stream, language)),
                )),
                None => {
                    respond(&mut stream, "400 Bad Request", &speaking.unfinished()).await;
                    Err(CollabError::Unauthorized)
                }
            };
        }
    }
}

fn accept_language<'a>(headers: impl Iterator<Item = &'a str>) -> String {
    headers
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.trim().eq_ignore_ascii_case("accept-language"))
        .map(|(_, value)| value.trim())
        .collect::<Vec<&str>>()
        .join(",")
}

async fn read_request(stream: &mut TcpStream) -> Option<Request> {
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
    let mut lines = text.lines();
    let mut parts = lines.next()?.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" || !target.starts_with('/') {
        return None;
    }
    Some(Request {
        target: Url::parse(&format!("http://127.0.0.1{target}")).ok()?,
        language: Language::of_request(&accept_language(lines)),
    })
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

    const LAB: &str = "https://lab.example.edu/oleafly";

    fn issuer() -> ServerUrl {
        ServerUrl::parse(LAB).expect("issuer")
    }

    fn issued(query: &str) -> String {
        let mut url = Url::parse("http://127.0.0.1/callback").expect("url");
        url.set_query(Some(query));
        url.query_pairs_mut().append_pair("iss", LAB);
        url.query().expect("query").to_owned()
    }

    #[tokio::test]
    async fn redirect_uri_is_a_loopback_callback() {
        let listener = LoopbackListener::bind(issuer()).await.expect("bind");
        let redirect = listener.redirect_uri();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        assert!(redirect.ends_with("/callback"));
    }

    #[tokio::test]
    async fn matching_state_returns_the_code_and_frees_the_port() {
        let listener = LoopbackListener::bind(issuer()).await.expect("bind");
        let port = port_of(&listener);
        let url = format!(
            "{}?{}",
            listener.redirect_uri(),
            issued("code=abc&state=s1")
        );
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
        let url = format!("{}?{}", listener.redirect_uri(), issued(query));
        let browser = tokio::spawn(get(url));
        if let Ok(callback) = listener.wait("s1", Duration::from_secs(5)).await {
            callback.answer(result).await;
        }
        readable(browser.await.expect("browser").text().await.expect("body"))
    }

    async fn page_after(listener: LoopbackListener, query: &str) -> String {
        answered_page(listener, query, Ok(())).await
    }

    #[tokio::test]
    async fn the_browser_hears_nothing_until_the_app_has_its_session() {
        let listener = lab().await;
        let url = format!(
            "{}?{}",
            listener.redirect_uri(),
            issued("code=abc&state=s1")
        );
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
        let page = readable(browser.await.expect("browser").text().await.expect("body"));
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
        assert!(page.contains("<h1>Access denied</h1>"), "{page}");
    }

    async fn lab() -> LoopbackListener {
        LoopbackListener::bind(issuer())
            .await
            .expect("bind")
            .describing("Oleafly Lab", "GitHub", ProviderKind::Github)
    }

    async fn lab_by_email() -> LoopbackListener {
        LoopbackListener::bind(issuer())
            .await
            .expect("bind")
            .describing("Oleafly Lab", "Email", ProviderKind::EmailLink)
    }

    async fn get_in(url: String, accept_language: String) -> reqwest::Response {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client")
            .get(url)
            .header(reqwest::header::ACCEPT_LANGUAGE, accept_language)
            .send()
            .await
            .expect("response")
    }

    async fn page_in(listener: LoopbackListener, query: &str, accept_language: &str) -> String {
        let url = format!("{}?{}", listener.redirect_uri(), issued(query));
        let browser = tokio::spawn(get_in(url, accept_language.to_owned()));
        if let Ok(callback) = listener.wait("s1", Duration::from_secs(5)).await {
            callback.answer(Ok(())).await;
        }
        readable(browser.await.expect("browser").text().await.expect("body"))
    }

    fn readable(page: String) -> String {
        page.replace("&#39;", "'")
    }

    fn heading(page: &str) -> &str {
        page.split_once("<h1>")
            .and_then(|(_, rest)| rest.split_once("</h1>"))
            .map_or("", |(heading, _)| heading)
    }

    #[tokio::test]
    async fn a_browser_in_another_language_reads_the_page_in_that_language() {
        let page = page_in(lab().await, "code=abc&state=s1", "de-DE,de;q=0.9,en;q=0.5").await;
        assert!(
            page.starts_with("<!doctype html><html lang=\"de\">"),
            "{page}"
        );
        assert!(page.contains("class=\"status success\""), "{page}");
        assert!(!heading(&page).is_empty());
        assert_ne!(heading(&page), "You're signed in");
        assert_eq!(
            heading(&page),
            readable(escape(Language::of_request("de").text(Text::SignedInTitle)))
        );
        assert!(page.contains("Oleafly Lab"), "{page}");
        let page = page_in(
            lab().await,
            "error=not_admitted&account=%40carol&state=s1",
            "zh-TW",
        )
        .await;
        assert!(
            page.starts_with("<!doctype html><html lang=\"zh-Hant\">"),
            "{page}"
        );
        assert!(page.contains("<strong>@carol</strong>"), "{page}");
        assert!(!page.contains("<h1>Access denied</h1>"), "{page}");
        let page = page_in(lab().await, "error=revoked&state=s1", "pt, en;q=0.1").await;
        assert!(
            page.starts_with("<!doctype html><html lang=\"pt-BR\">"),
            "{page}"
        );
        assert!(!page.contains("Sign-in didn't finish"), "{page}");
        let listener = lab().await;
        let elsewhere = format!("http://127.0.0.1:{}/favicon.ico", port_of(&listener));
        let callback = format!(
            "{}?{}",
            listener.redirect_uri(),
            issued("code=abc&state=s1")
        );
        let requests = tokio::spawn(async move {
            let page = get_in(elsewhere, "ja-JP".to_owned()).await;
            let page = readable(page.text().await.expect("body"));
            get(callback).await;
            page
        });
        if let Ok(callback) = listener.wait("s1", Duration::from_secs(5)).await {
            callback.answer(Ok(())).await;
        }
        let page = requests.await.expect("requests");
        assert!(
            page.starts_with("<!doctype html><html lang=\"ja\">"),
            "{page}"
        );
        assert_ne!(heading(&page), "Nothing to show here");
    }

    #[tokio::test]
    async fn a_browser_in_a_language_oleafly_does_not_speak_reads_english() {
        for accept_language in ["tlh-KL, xx;q=0.5", "", "*", "de;q=0"] {
            let page = page_in(lab().await, "code=abc&state=s1", accept_language).await;
            assert!(
                page.starts_with("<!doctype html><html lang=\"en\">"),
                "{accept_language:?}: {page}"
            );
            assert_eq!(heading(&page), "You're signed in", "{accept_language:?}");
            assert!(page.contains("Oleafly is now connected to Oleafly Lab."));
        }
    }

    #[tokio::test]
    async fn an_email_refusal_names_the_address_and_never_says_sign_out() {
        let page = page_after(
            lab_by_email().await,
            "error=not_admitted&account=dave%40example.edu&state=s1",
        )
        .await;
        assert!(page.contains("<h1>Access denied</h1>"), "{page}");
        assert!(
            page.contains("<strong>dave@example.edu</strong> doesn't have access to Oleafly Lab.")
        );
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
        assert!(page.contains("<h1>Access denied</h1>"));
        assert!(page.contains(
            "Your GitHub account <strong>@carol</strong> doesn't have access to Oleafly Lab."
        ));
        assert!(page.contains("Ask the Oleafly Lab admin to give you access."));
        assert!(page.contains("sign out of GitHub in this browser"));
    }

    #[tokio::test]
    async fn a_refusal_without_an_account_still_gives_the_reason() {
        let page = page_after(lab().await, "error=not_admitted&state=s1").await;
        assert!(
            page.contains("Your GitHub account doesn't have access to Oleafly Lab."),
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
        let listener = LoopbackListener::bind(issuer()).await.expect("bind");
        let port = port_of(&listener);
        let url = format!(
            "{}?{}",
            listener.redirect_uri(),
            issued("code=abc&state=forged")
        );
        let (outcome, response) =
            tokio::join!(listener.wait("s1", Duration::from_secs(5)), get(url));
        assert!(matches!(outcome, Err(CollabError::Unauthorized)));
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn server_error_is_reported_with_its_code() {
        let listener = LoopbackListener::bind(issuer()).await.expect("bind");
        let url = format!(
            "{}?{}",
            listener.redirect_uri(),
            issued("error=not_admitted&error_description=nope&state=s1")
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
        let outcome = LoopbackListener::bind_to(("192.0.2.1", 0), issuer()).await;
        assert!(matches!(outcome, Err(CollabError::SignInTimedOut)));
    }

    #[tokio::test]
    async fn silence_times_out_and_frees_the_port() {
        let listener = LoopbackListener::bind(issuer()).await.expect("bind");
        let port = port_of(&listener);
        let outcome = listener.wait("s1", Duration::from_millis(100)).await;
        assert!(matches!(outcome, Err(CollabError::SignInTimedOut)));
        assert!(port_is_closed(port).await);
    }

    #[tokio::test]
    async fn other_paths_get_not_found_and_the_wait_continues() {
        let listener = LoopbackListener::bind(issuer()).await.expect("bind");
        let base = format!("http://127.0.0.1:{}", port_of(&listener));
        let callback = format!(
            "{}?{}",
            listener.redirect_uri(),
            issued("code=xyz&state=s1")
        );
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

    fn callback_from(listener: &LoopbackListener, code: &str, issuer: &str) -> String {
        let mut url = Url::parse(&listener.redirect_uri()).expect("url");
        url.query_pairs_mut()
            .append_pair("code", code)
            .append_pair("state", "s1")
            .append_pair("iss", issuer);
        url.to_string()
    }

    #[tokio::test]
    async fn a_callback_that_does_not_name_the_server_the_sign_in_started_with_is_refused() {
        let listener = lab().await;
        let refusals = [
            callback_from(&listener, "from-elsewhere", "https://evil.example"),
            callback_from(&listener, "from-a-prefix", "https://lab.example.edu"),
            format!("{}?code=unnamed&state=s1", listener.redirect_uri()),
            format!(
                "{}?{}&iss=https%3A%2F%2Fevil.example",
                listener.redirect_uri(),
                issued("code=twice&state=s1")
            ),
        ];
        let right = callback_from(&listener, "good", "https://LAB.example.edu/oleafly/");
        let requests = tokio::spawn(async move {
            let mut refused = Vec::new();
            for url in refusals {
                let response = get(url).await;
                let status = response.status();
                refused.push((status, readable(response.text().await.expect("body"))));
            }
            (refused, get(right).await.status())
        });
        let callback = listener
            .wait("s1", Duration::from_secs(20))
            .await
            .expect("the right callback still arrives");
        assert_eq!(callback.outcome, CallbackOutcome::Code("good".to_string()));
        callback.answer(Ok(())).await;
        let (refused, finished) = requests.await.expect("requests");
        assert_eq!(refused.len(), 4);
        // No issuer at all comes from a server older than the check, which is
        // an update for its admin; a different one is stopped.
        let expected = [
            "Sign-in stopped",
            "Sign-in stopped",
            "Oleafly Lab needs an update",
            "Sign-in stopped",
        ];
        for ((status, page), heading_text) in refused.into_iter().zip(expected) {
            assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
            assert_eq!(heading(&page), heading_text, "{page}");
            assert!(page.contains("Ask the Oleafly Lab admin to"), "{page}");
            assert!(page.contains("class=\"status problem\""), "{page}");
        }
        assert_eq!(finished, reqwest::StatusCode::OK);
    }
}
