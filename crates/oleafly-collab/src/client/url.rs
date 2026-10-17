use std::fmt;
use std::net::{Ipv4Addr, Ipv6Addr};

use ::url::{Host, Url};
use oleafly_collab_protocol::capabilities::WELL_KNOWN_PATH;

use crate::CollabError;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ServerUrl {
    base: Url,
    prefix: String,
    normalized: String,
}

impl ServerUrl {
    pub fn parse(input: &str) -> Result<ServerUrl, CollabError> {
        let trimmed = input.trim();
        let candidate = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            format!("https://{trimmed}")
        };
        let mut base = Url::parse(&candidate)
            .map_err(|error| CollabError::Network(format!("not a server address: {error}")))?;
        if base.host().is_none() {
            return Err(CollabError::Network("not a server address".to_string()));
        }
        let allowed = match base.scheme() {
            "https" => true,
            "http" => is_loopback(&base),
            _ => false,
        };
        if !allowed {
            return Err(CollabError::NotHttps);
        }
        let _ = base.set_username("");
        let _ = base.set_password(None);
        base.set_query(None);
        base.set_fragment(None);
        let mut prefix = base.path().trim_end_matches('/').to_string();
        if let Some(stripped) = prefix.strip_suffix(WELL_KNOWN_PATH) {
            prefix = stripped.trim_end_matches('/').to_string();
        }
        base.set_path(&prefix);
        let normalized = base.as_str().trim_end_matches('/').to_string();
        Ok(ServerUrl {
            base,
            prefix,
            normalized,
        })
    }

    pub fn as_str(&self) -> &str {
        &self.normalized
    }

    pub fn endpoint(&self, path: &str) -> Url {
        let mut url = self.base.clone();
        url.set_path(&format!("{}/{}", self.prefix, path.trim_start_matches('/')));
        url
    }

    pub fn websocket(&self) -> Url {
        let mut url = self.endpoint("ws");
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        let _ = url.set_scheme(scheme);
        url
    }

    pub fn is_loopback(&self) -> bool {
        is_loopback(&self.base)
    }
}

impl fmt::Display for ServerUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.normalized)
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(address)) => address == Ipv4Addr::LOCALHOST,
        Some(Host::Ipv6(address)) => address == Ipv6Addr::LOCALHOST,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(input: &str) -> ServerUrl {
        ServerUrl::parse(input).expect("valid server address")
    }

    #[test]
    fn prefix_trailing_slash_and_case_name_one_server() {
        let plain = parsed("https://uni.edu/oleafly");
        assert_eq!(plain, parsed("https://uni.edu/oleafly/"));
        assert_eq!(plain, parsed("HTTPS://Uni.edu/oleafly"));
        assert_eq!(plain.as_str(), "https://uni.edu/oleafly");
        assert_eq!(plain.to_string(), "https://uni.edu/oleafly");
    }

    #[test]
    fn endpoints_keep_the_path_prefix() {
        let server = parsed("https://uni.edu/oleafly/");
        assert_eq!(
            server.endpoint("auth/token").as_str(),
            "https://uni.edu/oleafly/auth/token"
        );
        assert_eq!(
            server.endpoint("/auth/token").as_str(),
            "https://uni.edu/oleafly/auth/token"
        );
        assert_eq!(
            server.endpoint(WELL_KNOWN_PATH).as_str(),
            "https://uni.edu/oleafly/.well-known/oleafly-server"
        );
        assert_eq!(
            parsed("https://uni.edu").endpoint("auth/token").as_str(),
            "https://uni.edu/auth/token"
        );
    }

    #[test]
    fn websocket_follows_the_scheme_and_prefix() {
        assert_eq!(
            parsed("https://uni.edu/oleafly").websocket().as_str(),
            "wss://uni.edu/oleafly/ws"
        );
        assert_eq!(
            parsed("http://127.0.0.1:8080").websocket().as_str(),
            "ws://127.0.0.1:8080/ws"
        );
    }

    #[test]
    fn plain_http_is_refused_except_on_loopback() {
        for refused in [
            "http://uni.edu/oleafly",
            "http://127.0.0.2:8080",
            "ftp://uni.edu",
        ] {
            assert!(
                matches!(ServerUrl::parse(refused), Err(CollabError::NotHttps)),
                "{refused}"
            );
        }
        assert_eq!(
            parsed("http://127.0.0.1:8080/").as_str(),
            "http://127.0.0.1:8080"
        );
        assert_eq!(parsed("http://[::1]:8080").as_str(), "http://[::1]:8080");
        assert_eq!(
            parsed("http://LOCALHOST:8080/").as_str(),
            "http://localhost:8080"
        );
        assert!(parsed("http://localhost:8080").is_loopback());
        assert!(!parsed("https://uni.edu").is_loopback());
    }

    #[test]
    fn bare_host_defaults_to_https() {
        assert_eq!(
            parsed("uni.edu/oleafly").as_str(),
            "https://uni.edu/oleafly"
        );
        assert_eq!(parsed("  uni.edu  ").as_str(), "https://uni.edu");
    }

    #[test]
    fn credentials_query_fragment_default_port_and_manifest_path_are_dropped() {
        assert_eq!(
            parsed("https://bob:secret@uni.edu:443/oleafly/.well-known/oleafly-server?x=1#top")
                .as_str(),
            "https://uni.edu/oleafly"
        );
    }

    #[test]
    fn text_that_is_not_an_address_is_refused() {
        for input in ["", "not a url", "https://"] {
            assert!(
                matches!(ServerUrl::parse(input), Err(CollabError::Network(_))),
                "{input:?}"
            );
        }
    }
}
