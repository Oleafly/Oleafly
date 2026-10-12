use axum::http::header::COOKIE;
use axum::http::{HeaderMap, HeaderValue};
use oleafly_collab_protocol::crypto::pkce_s256;

use crate::auth::pending::PENDING_TTL_MS;
use crate::auth::split_token::constant_time_eq;
use crate::config::ServerConfig;
use crate::tokens::random_token;

pub const COOKIE_NAME: &str = "oleafly_device_flow";
pub const HOST_COOKIE_NAME: &str = "__Host-oleafly_device_flow";
const SECRET_LENGTH: usize = 43;

fn host_only(config: &ServerConfig) -> bool {
    config.public_url.scheme() == "https" && config.path_prefix().is_empty()
}

pub fn cookie_name(config: &ServerConfig) -> &'static str {
    if host_only(config) {
        HOST_COOKIE_NAME
    } else {
        COOKIE_NAME
    }
}

fn well_formed(value: &str) -> bool {
    value.len() == SECRET_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn presented<'a>(headers: &'a HeaderMap, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .filter(move |(found, _)| *found == name)
        .map(|(_, value)| value.trim())
        .filter(|value| well_formed(value))
}

pub fn secret(headers: &HeaderMap, config: &ServerConfig) -> String {
    presented(headers, cookie_name(config))
        .last()
        .map_or_else(random_token, str::to_owned)
}

pub fn challenge(secret: &str) -> String {
    pkce_s256(secret)
}

pub fn holds(headers: &HeaderMap, config: &ServerConfig, bound: &str) -> bool {
    !bound.is_empty()
        && presented(headers, cookie_name(config))
            .any(|value| constant_time_eq(challenge(value).as_bytes(), bound.as_bytes()))
}

pub fn cookie(config: &ServerConfig, secret: &str) -> HeaderValue {
    let (path, secure) = if host_only(config) {
        ("/".to_owned(), "; Secure")
    } else if config.public_url.scheme() == "https" {
        (format!("{}/auth", config.path_prefix()), "; Secure")
    } else {
        (format!("{}/auth", config.path_prefix()), "")
    };
    let max_age = PENDING_TTL_MS / 1000;
    HeaderValue::from_str(&format!(
        "{}={secret}; Path={path}; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}",
        cookie_name(config)
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("oleafly_device_flow=; Max-Age=0"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_config;
    use crate::tokens::random_token;

    fn presenting(name: &str, value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&format!("theme=dark; {name}={value}")).unwrap(),
        );
        headers
    }

    #[test]
    fn at_an_https_root_the_cookie_is_host_only_and_survives_the_provider_redirect() {
        let config = test_config();
        let header = cookie(&config, "abc");
        let text = header.to_str().unwrap();
        assert!(
            text.starts_with("__Host-oleafly_device_flow=abc;"),
            "{text}"
        );
        for part in [
            "HttpOnly",
            "SameSite=Lax",
            "Path=/;",
            "Secure",
            "Max-Age=600",
        ] {
            assert!(text.contains(part), "{text} lacks {part}");
        }
        assert!(!text.contains("Domain"), "{text}");
    }

    #[test]
    fn under_a_path_or_over_http_the_cookie_is_scoped_to_sign_in() {
        let mut config = test_config();
        config.public_url = url::Url::parse("https://www.cs.uni.edu/oleafly/").unwrap();
        let text = cookie(&config, "abc").to_str().unwrap().to_owned();
        assert!(text.starts_with("oleafly_device_flow=abc;"), "{text}");
        assert!(text.contains("Path=/oleafly/auth;"), "{text}");
        assert!(text.contains("Secure"), "{text}");
        assert!(text.contains("SameSite=Lax"), "{text}");
        config.public_url = url::Url::parse("http://127.0.0.1:8787/").unwrap();
        let text = cookie(&config, "abc").to_str().unwrap().to_owned();
        assert!(text.starts_with("oleafly_device_flow=abc;"), "{text}");
        assert!(text.contains("Path=/auth;"), "{text}");
        assert!(!text.contains("Secure"), "{text}");
    }

    #[test]
    fn a_well_formed_secret_is_kept_and_anything_else_is_replaced() {
        let config = test_config();
        let existing = random_token();
        assert_eq!(
            secret(
                &presenting("__Host-oleafly_device_flow", &existing),
                &config
            ),
            existing
        );
        let fresh = secret(&presenting("__Host-oleafly_device_flow", "short"), &config);
        assert_eq!(fresh.len(), 43);
        assert_ne!(
            secret(&HeaderMap::new(), &config),
            secret(&HeaderMap::new(), &config)
        );
    }

    #[test]
    fn only_the_browser_holding_the_secret_matches_the_challenge() {
        let config = test_config();
        let held = random_token();
        let bound = challenge(&held);
        assert!(holds(
            &presenting("__Host-oleafly_device_flow", &held),
            &config,
            &bound
        ));
        assert!(!holds(
            &presenting("__Host-oleafly_device_flow", &random_token()),
            &config,
            &bound
        ));
        assert!(!holds(&HeaderMap::new(), &config, &bound));
        assert!(!holds(
            &presenting("oleafly_device_flow", &held),
            &config,
            &bound
        ));
        assert!(!holds(
            &presenting("__Host-oleafly_device_flow", ""),
            &config,
            &challenge("")
        ));
        assert!(!holds(
            &presenting("__Host-oleafly_device_flow", &held),
            &config,
            ""
        ));
    }

    #[test]
    fn a_planted_cookie_beside_the_real_one_does_not_hide_it() {
        let config = test_config();
        let held = random_token();
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&format!(
                "__Host-oleafly_device_flow={}; __Host-oleafly_device_flow={held}",
                random_token()
            ))
            .unwrap(),
        );
        assert!(holds(&headers, &config, &challenge(&held)));
    }
}
