use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use oleafly_net::MAX_MESSAGE_BYTES;
use reqwest::header::ACCEPT;
use reqwest::StatusCode;
use url::Url;

use super::events::LONGEST_SERVER_WAIT;
use crate::client::{self, BodyError, Http};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::html;
use crate::locked;
use crate::session::SessionHandle;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Meta {
    ws_url: Option<String>,
    csrf: Option<String>,
    max_doc_length: Option<u64>,
    max_reconnect_gracefully: Option<Duration>,
    user_id: Option<String>,
    track_changes_feature: bool,
    capabilities: Option<Vec<String>>,
    image_names: Vec<ImageChoice>,
    languages: Vec<SpellLanguage>,
    learned_words: Option<Vec<String>>,
    fallback: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageChoice {
    pub name: String,
    pub description: String,
    pub allowed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpellLanguage {
    pub code: String,
    pub name: String,
}

#[derive(Debug)]
pub struct ProjectPage {
    project_id: String,
    meta: Mutex<Meta>,
    #[cfg(test)]
    loads: AtomicUsize,
    websocket_failures: AtomicUsize,
}

const MAX_CHOICES: usize = 500;
pub const MAX_LEARNED_WORDS: usize = 20_000;
pub const MAX_LEARNED_BYTES: usize = 1024 * 1024;
pub const MAX_WORD_CHARS: usize = 256;

fn number(tags: &std::collections::HashMap<String, String>, name: &str) -> Option<u64> {
    html::meta_text(tags, name).and_then(|text| text.trim().parse().ok())
}

fn listed<T>(
    tags: &std::collections::HashMap<String, String>,
    name: &str,
    read: impl Fn(&serde_json::Value) -> Option<T>,
) -> Vec<T> {
    tags.get(name)
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw.trim()).ok())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .take(MAX_CHOICES)
        .filter_map(read)
        .collect()
}

fn field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= 200)
        .map(str::to_string)
}

fn image_choice(value: &serde_json::Value) -> Option<ImageChoice> {
    let name = field(value, "imageName")?;
    Some(ImageChoice {
        description: field(value, "imageDesc").unwrap_or_else(|| name.clone()),
        allowed: value
            .get("allowed")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
        name,
    })
}

fn spell_language(value: &serde_json::Value) -> Option<SpellLanguage> {
    let code = field(value, "code")?;
    Some(SpellLanguage {
        name: field(value, "name").unwrap_or_else(|| code.clone()),
        code,
    })
}

pub fn plain_word(word: &str) -> bool {
    !word.is_empty()
        && word.chars().count() <= MAX_WORD_CHARS
        && !word.chars().any(char::is_control)
}

fn learned_words(tags: &std::collections::HashMap<String, String>) -> Option<Vec<String>> {
    let raw = tags.get("ol-learnedWords")?.trim();
    if raw.len() > MAX_LEARNED_BYTES {
        return None;
    }
    let listed = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    let listed = listed.as_array()?;
    if listed.len() > MAX_LEARNED_WORDS {
        return None;
    }
    let mut words: Vec<String> = listed
        .iter()
        .filter_map(serde_json::Value::as_str)
        .filter(|word| plain_word(word))
        .map(str::to_string)
        .collect();
    words.sort();
    words.dedup();
    Some(words)
}

fn same_site(base: &Url, target: &Url) -> bool {
    let (Some(home), Some(host)) = (base.host_str(), target.host_str()) else {
        return false;
    };
    let home = home.to_ascii_lowercase();
    let host = host.to_ascii_lowercase();
    let site = home.strip_prefix("www.").unwrap_or(&home);
    target.scheme() == base.scheme()
        && (host == home || host == site || host.ends_with(&format!(".{site}")))
}

fn read_meta(http: &Http, page: &str, fallback: bool) -> Meta {
    let tags = html::meta_tags(page);
    let ws_url = html::meta_text(&tags, "ol-wsUrl")
        .filter(|_| !fallback)
        .and_then(|raw| {
            let base = Url::parse(&format!("{}/", http.base)).ok()?;
            let target = base.join(raw.trim()).ok()?;
            same_site(&base, &target).then(|| String::from(target))
        });
    Meta {
        ws_url,
        csrf: html::meta_text(&tags, "ol-csrfToken"),
        max_doc_length: number(&tags, "ol-maxDocLength"),
        max_reconnect_gracefully: number(&tags, "ol-maxReconnectGracefullyIntervalMs")
            .map(|wait| Duration::from_millis(wait).min(LONGEST_SERVER_WAIT)),
        user_id: html::meta_text(&tags, "ol-user_id"),
        track_changes_feature: tags
            .get("ol-hasTrackChangesFeature")
            .is_some_and(|content| content.trim() != "false"),
        capabilities: tags
            .get("ol-capabilities")
            .and_then(|content| serde_json::from_str::<Vec<String>>(content.trim()).ok()),
        image_names: listed(&tags, "ol-imageNames", image_choice),
        languages: listed(&tags, "ol-languages", spell_language),
        learned_words: learned_words(&tags),
        fallback,
    }
}

impl ProjectPage {
    pub async fn load(
        http: &Http,
        session: &SessionHandle,
        project_id: &str,
        fallback: bool,
    ) -> Result<ProjectPage, OnlineError> {
        let page = ProjectPage::unloaded(project_id)?;
        page.reload(http, session, fallback).await?;
        Ok(page)
    }

    pub fn unloaded(project_id: &str) -> Result<ProjectPage, OnlineError> {
        if !client::valid_project_id(project_id) {
            return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
        }
        Ok(ProjectPage {
            project_id: project_id.to_string(),
            meta: Mutex::new(Meta::default()),
            #[cfg(test)]
            loads: AtomicUsize::new(0),
            websocket_failures: AtomicUsize::new(0),
        })
    }

    pub async fn reload(
        &self,
        http: &Http,
        session: &SessionHandle,
        fallback: bool,
    ) -> Result<(), OnlineError> {
        let path = if fallback {
            format!("/project/{}?ws=fallback", self.project_id)
        } else {
            format!("/project/{}", self.project_id)
        };
        #[cfg(test)]
        self.loads.fetch_add(1, Ordering::Relaxed);
        let response = http
            .send_public(
                http.get(&path, &session.cookie())
                    .header(ACCEPT, "text/html"),
            )
            .await?;
        session.absorb_headers(response.headers());
        match response.status() {
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => {
                return Err(OnlineError::new(OnlineErrorKind::ProjectUnavailable));
            }
            StatusCode::UNAUTHORIZED => return Err(client::expired()),
            _ => http.classify(&response)?,
        }
        let body = client::text_capped(response, MAX_MESSAGE_BYTES)
            .await
            .map_err(|error| {
                let kind = match error {
                    BodyError::TooLarge(_) => OnlineErrorKind::Unrecognized,
                    BodyError::Read(_) => OnlineErrorKind::Unreachable,
                };
                OnlineError::new(kind).detail(error)
            })?;
        let meta = read_meta(http, &body, fallback);
        if meta.user_id.is_none() {
            return Err(client::expired());
        }
        *locked(&self.meta) = meta;
        Ok(())
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn ws_url(&self) -> Option<String> {
        locked(&self.meta).ws_url.clone()
    }

    pub fn is_fallback(&self) -> bool {
        locked(&self.meta).fallback
    }

    pub fn csrf(&self) -> Option<String> {
        locked(&self.meta).csrf.clone()
    }

    pub fn max_doc_length(&self) -> Option<u64> {
        locked(&self.meta).max_doc_length
    }

    pub fn max_reconnect_gracefully(&self) -> Option<Duration> {
        locked(&self.meta).max_reconnect_gracefully
    }

    pub fn user_id(&self) -> Option<String> {
        locked(&self.meta).user_id.clone()
    }

    pub fn has_track_changes_feature(&self) -> bool {
        locked(&self.meta).track_changes_feature
    }

    pub fn capability(&self, name: &str) -> Option<bool> {
        locked(&self.meta)
            .capabilities
            .as_ref()
            .map(|capabilities| capabilities.iter().any(|known| known == name))
    }

    pub fn image_names(&self) -> Vec<ImageChoice> {
        locked(&self.meta).image_names.clone()
    }

    pub fn languages(&self) -> Vec<SpellLanguage> {
        locked(&self.meta).languages.clone()
    }

    pub fn learned_words(&self) -> Option<Vec<String>> {
        locked(&self.meta).learned_words.clone()
    }

    #[cfg(test)]
    pub fn loads(&self) -> usize {
        self.loads.load(Ordering::Relaxed)
    }

    pub(crate) fn websocket_failures(&self) -> usize {
        self.websocket_failures.load(Ordering::Relaxed)
    }

    pub(crate) fn note_websocket_failure(&self) {
        self.websocket_failures.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn give_up_websockets(&self) {
        self.websocket_failures
            .store(u32::MAX as usize, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::Session;
    use crate::test_support::streaming_server;

    fn page(name: &str, content: &str) -> String {
        format!("<meta name=\"{name}\" content=\"{content}\">")
    }

    #[test]
    fn an_absolute_socket_address_must_stay_on_the_service() {
        let http = Http::new("https://www.latex.example", "Oleafly/test").unwrap();
        let socket = |raw: &str| read_meta(&http, &page("ol-wsUrl", raw), false).ws_url;
        for (raw, expected) in [
            ("/socket.io", "https://www.latex.example/socket.io"),
            (
                "https://www.latex.example/rt/socket.io",
                "https://www.latex.example/rt/socket.io",
            ),
            (
                "https://rt.latex.example/socket.io",
                "https://rt.latex.example/socket.io",
            ),
            (
                "https://latex.example/socket.io",
                "https://latex.example/socket.io",
            ),
        ] {
            assert_eq!(socket(raw).as_deref(), Some(expected), "{raw}");
        }
        for refused in [
            "http://www.latex.example/socket.io",
            "wss://www.latex.example/socket.io",
            "https://elsewhere.example/socket.io",
            "https://latex.example.elsewhere.example/socket.io",
            "https://notlatex.example/socket.io",
            "//elsewhere.example/socket.io",
        ] {
            assert_eq!(socket(refused), None, "{refused}");
        }
        let hosted = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let socket = |raw: &str| read_meta(&hosted, &page("ol-wsUrl", raw), false).ws_url;
        assert!(socket("https://rt.latex.uni.edu/socket.io").is_some());
        assert_eq!(socket("https://uni.edu/socket.io"), None);
        assert_eq!(socket("https://other.uni.edu/socket.io"), None);
    }

    #[test]
    fn the_reconnect_window_from_the_page_is_capped() {
        let http = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let huge = u64::MAX.to_string();
        for (raw, expected) in [
            ("100000000000000000000", None),
            ("1000000000000", Some(LONGEST_SERVER_WAIT)),
            (huge.as_str(), Some(LONGEST_SERVER_WAIT)),
            ("0", Some(Duration::ZERO)),
            ("30000", Some(Duration::from_secs(30))),
        ] {
            let meta = read_meta(
                &http,
                &page("ol-maxReconnectGracefullyIntervalMs", raw),
                false,
            );
            assert_eq!(meta.max_reconnect_gracefully, expected, "{raw}");
        }
    }

    #[test]
    fn the_track_changes_feature_is_on_only_when_its_boolean_meta_has_content() {
        let http = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let feature = |tag: &str| read_meta(&http, tag, false).track_changes_feature;
        let name = "ol-hasTrackChangesFeature";
        assert!(feature(&format!(
            "<meta name=\"{name}\" data-type=\"boolean\" content>"
        )));
        assert!(feature(&format!(
            "<meta name=\"{name}\" data-type=\"boolean\" content=\"\">"
        )));
        assert!(feature(&format!("<meta name=\"{name}\" content=\"true\">")));
        assert!(!feature(&format!(
            "<meta name=\"{name}\" data-type=\"boolean\">"
        )));
        assert!(!feature(&format!(
            "<meta name=\"{name}\" content=\"false\">"
        )));
        assert!(!feature("<meta name=\"ol-user_id\" content=\"u1\">"));
    }

    #[test]
    fn capabilities_come_from_their_json_meta_and_stay_unknown_without_it() {
        let http = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let chat = |tag: &str| {
            read_meta(&http, tag, false)
                .capabilities
                .map(|capabilities| capabilities.iter().any(|known| known == "chat"))
        };
        assert_eq!(
            chat("<meta name=\"ol-capabilities\" data-type=\"json\" content=\"[&quot;chat&quot;,&quot;link-sharing&quot;]\">"),
            Some(true)
        );
        assert_eq!(
            chat("<meta name=\"ol-capabilities\" data-type=\"json\" content=\"[&quot;link-sharing&quot;]\">"),
            Some(false)
        );
        assert_eq!(
            chat("<meta name=\"ol-capabilities\" content=\"chat\">"),
            None
        );
        assert_eq!(chat("<meta name=\"ol-user_id\" content=\"u1\">"), None);
    }

    #[test]
    fn image_and_language_choices_come_from_the_page() {
        let http = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let tags = concat!(
            "<meta name=\"ol-imageNames\" data-type=\"json\" content=\"[",
            "{&quot;imageName&quot;:&quot;texlive-full:2025.1&quot;,&quot;imageDesc&quot;:&quot;TeX Live 2025&quot;,&quot;allowed&quot;:true},",
            "{&quot;imageName&quot;:&quot;texlive-full:2026.1&quot;,&quot;imageDesc&quot;:&quot;TeX Live 2026&quot;,&quot;allowed&quot;:false},",
            "{&quot;imageDesc&quot;:&quot;no name&quot;}]\">",
            "<meta name=\"ol-languages\" data-type=\"json\" content=\"[",
            "{&quot;code&quot;:&quot;en_US&quot;,&quot;name&quot;:&quot;English (American)&quot;},",
            "{&quot;code&quot;:&quot;de&quot;,&quot;name&quot;:&quot;German&quot;},{&quot;name&quot;:&quot;none&quot;}]\">",
        );
        let meta = read_meta(&http, tags, false);
        assert_eq!(
            meta.image_names,
            vec![
                ImageChoice {
                    name: "texlive-full:2025.1".into(),
                    description: "TeX Live 2025".into(),
                    allowed: true,
                },
                ImageChoice {
                    name: "texlive-full:2026.1".into(),
                    description: "TeX Live 2026".into(),
                    allowed: false,
                },
            ]
        );
        assert_eq!(
            meta.languages
                .iter()
                .map(|language| language.code.as_str())
                .collect::<Vec<_>>(),
            ["en_US", "de"]
        );
        let none = read_meta(&http, &page("ol-imageNames", "not json"), false);
        assert!(none.image_names.is_empty() && none.languages.is_empty());
    }

    #[test]
    fn learned_words_come_from_their_json_meta_with_caps_and_stay_unknown_when_odd() {
        let http = Http::new("https://latex.uni.edu", "Oleafly/test").unwrap();
        let words = |content: &str| {
            read_meta(
                &http,
                &format!(
                    "<meta name=\"ol-learnedWords\" data-type=\"json\" content=\"{}\">",
                    content.replace('&', "&amp;").replace('"', "&quot;")
                ),
                false,
            )
            .learned_words
        };
        assert_eq!(
            words(
                r#"["Oleaflyish","oleaflyish","Größenordnungsx","two words","Oleaflyish",7,null,{"w":"x"},"","a\u0000b"]"#
            ),
            Some(vec![
                "Größenordnungsx".to_string(),
                "Oleaflyish".to_string(),
                "oleaflyish".to_string(),
                "two words".to_string(),
            ])
        );
        assert_eq!(words("[]"), Some(Vec::new()));
        let long = format!("[\"{}\",\"ok\"]", "x".repeat(MAX_WORD_CHARS + 1));
        assert_eq!(words(&long), Some(vec!["ok".to_string()]));
        for odd in ["not json", "{\"words\":[]}", "\"word\"", "null"] {
            assert_eq!(words(odd), None, "{odd}");
        }
        let many = serde_json::to_string(&vec!["w"; MAX_LEARNED_WORDS + 1]).unwrap();
        assert_eq!(words(&many), None);
        let fits = serde_json::to_string(&vec!["w"; MAX_LEARNED_WORDS]).unwrap();
        assert_eq!(words(&fits), Some(vec!["w".to_string()]));
        let heavy = serde_json::to_string(&vec!["x".repeat(200); 6_000]).unwrap();
        assert!(heavy.len() > MAX_LEARNED_BYTES);
        assert_eq!(words(&heavy), None);
        assert_eq!(
            read_meta(&http, "<meta name=\"ol-user_id\" content=\"u1\">", false).learned_words,
            None
        );
    }

    #[tokio::test]
    async fn an_editor_page_that_never_ends_is_refused() {
        let base = streaming_server(None, None, Duration::ZERO).await;
        let http = Http::new(&base, "Oleafly/test").unwrap();
        let session = SessionHandle::new(
            &base,
            Session {
                cookie: "overleaf.sid=s".into(),
                user_id: "u1".into(),
                email: String::new(),
                saved_by: None,
            },
            None,
        );
        let error = ProjectPage::load(&http, &session, "p1", false)
            .await
            .unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::Unrecognized);
        assert!(
            error
                .detail
                .as_deref()
                .unwrap_or_default()
                .contains("larger than"),
            "{error:?}"
        );
    }
}
