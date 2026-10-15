use axum::http::header::{COOKIE, ORIGIN};
use axum::http::{HeaderMap, HeaderValue};

use crate::auth::split_token::constant_time_eq;
use crate::config::ServerConfig;
use crate::tokens::random_token;

pub const COOKIE_NAME: &str = "oleafly_csrf";
const TOKEN_LENGTH: usize = 43;
const MAX_AGE_SECS: u32 = 60 * 60;

fn presented_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE_NAME)
        .map(|(_, value)| value.trim().to_string())
}

fn well_formed(value: &str) -> bool {
    value.len() == TOKEN_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn token(headers: &HeaderMap) -> String {
    presented_cookie(headers)
        .filter(|value| well_formed(value))
        .unwrap_or_else(random_token)
}

pub fn cookie(config: &ServerConfig, token: &str) -> HeaderValue {
    let secure = if config.public_url.scheme() == "https" {
        "; Secure"
    } else {
        ""
    };
    let path = format!("{}/auth", config.path_prefix());
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; Path={path}; Max-Age={MAX_AGE_SECS}; HttpOnly; SameSite=Strict{secure}"
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("oleafly_csrf=; Max-Age=0"))
}

fn same_site(headers: &HeaderMap, config: &ServerConfig) -> bool {
    let fetch_site = headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("same-origin");
    if fetch_site == "cross-site" {
        return false;
    }
    match headers.get(ORIGIN).map(|value| value.to_str()) {
        None => true,
        Some(Ok(origin)) => origin == config.public_url.origin().ascii_serialization(),
        Some(Err(_)) => false,
    }
}

pub fn verify(headers: &HeaderMap, config: &ServerConfig, presented: &str) -> bool {
    let Some(expected) = presented_cookie(headers).filter(|value| well_formed(value)) else {
        return false;
    };
    same_site(headers, config) && constant_time_eq(expected.as_bytes(), presented.as_bytes())
}

#[cfg(test)]
mod tests {
    use axum::http::header::{COOKIE, ORIGIN};

    use super::*;
    use crate::test_support::test_config;
    use crate::tokens::random_token;

    fn with_cookie(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&format!("theme=dark; {COOKIE_NAME}={value}")).unwrap(),
        );
        headers
    }

    #[test]
    fn a_well_formed_cookie_is_kept_and_anything_else_is_replaced() {
        let existing = random_token();
        assert_eq!(token(&with_cookie(&existing)), existing);
        let fresh = token(&with_cookie("short"));
        assert_eq!(fresh.len(), 43);
        assert_ne!(token(&HeaderMap::new()), token(&HeaderMap::new()));
    }

    #[test]
    fn the_cookie_is_strict_http_only_scoped_to_sign_in_and_secure_over_https() {
        let mut config = test_config();
        let secure = cookie(&config, "abc");
        let text = secure.to_str().unwrap();
        assert!(text.starts_with(&format!("{COOKIE_NAME}=abc;")), "{text}");
        for part in ["HttpOnly", "SameSite=Strict", "Path=/auth", "Secure"] {
            assert!(text.contains(part), "{text} lacks {part}");
        }
        config.public_url = url::Url::parse("http://127.0.0.1:8787/oleafly/").unwrap();
        let plain = cookie(&config, "abc");
        let text = plain.to_str().unwrap();
        assert!(text.contains("Path=/oleafly/auth"), "{text}");
        assert!(!text.contains("Secure"), "{text}");
    }

    #[test]
    fn a_form_passes_only_with_its_own_cookie_and_from_this_server() {
        let config = test_config();
        let value = random_token();
        assert!(verify(&with_cookie(&value), &config, &value));
        assert!(!verify(&with_cookie(&value), &config, &random_token()));
        assert!(!verify(&HeaderMap::new(), &config, &value));
        assert!(!verify(&with_cookie(""), &config, ""));
        let mut same_origin = with_cookie(&value);
        same_origin.insert(ORIGIN, HeaderValue::from_static("https://collab.test"));
        assert!(verify(&same_origin, &config, &value));
        let mut foreign = with_cookie(&value);
        foreign.insert(ORIGIN, HeaderValue::from_static("https://evil.example"));
        assert!(!verify(&foreign, &config, &value));
        let mut cross_site = with_cookie(&value);
        cross_site.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(!verify(&cross_site, &config, &value));
    }
}
