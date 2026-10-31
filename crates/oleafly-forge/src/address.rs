use crate::store::ForgeAccount;
use crate::ForgeError;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

const API_SUFFIXES: [&str; 3] = ["/api/v1", "/api/v3", "/api/v4"];
const HOSTED: [&str; 3] = ["github.com", "gitlab.com", "codeberg.org"];
const PRIVATE_SUFFIXES: [&str; 7] = [
    ".local",
    ".lan",
    ".home.arpa",
    ".internal",
    ".test",
    ".localhost",
    ".ts.net",
];

pub fn normalize_base_url(input: &str) -> Result<String, ForgeError> {
    let invalid = || ForgeError::InvalidBaseUrl {
        input: display_input(input),
    };
    let base = oleafly_secrets::accounts::normalize_forge_base(input).map_err(|_| invalid())?;
    let parsed = url::Url::parse(&base).map_err(|_| invalid())?;
    let host = parsed.host_str().ok_or_else(invalid)?.to_ascii_lowercase();
    if parsed.scheme() == "http" && !allows_plain_http(&host) {
        return Err(ForgeError::HttpsRequired);
    }
    let bare = host.strip_prefix("www.").unwrap_or(&host);
    if parsed.scheme() == "https" && parsed.port().is_none() && HOSTED.contains(&bare) {
        return Ok(format!("https://{bare}"));
    }
    let authority_start = base.find("://").map(|index| index + 3).unwrap_or(0);
    let path_start = base[authority_start..]
        .find('/')
        .map(|index| index + authority_start)
        .unwrap_or(base.len());
    let (origin, path) = base.split_at(path_start);
    let mut path = path.trim_end_matches('/');
    for suffix in API_SUFFIXES {
        if let Some(stripped) = path.strip_suffix(suffix) {
            path = stripped.trim_end_matches('/');
            break;
        }
    }
    Ok(format!("{origin}{path}"))
}

fn display_input(input: &str) -> String {
    let trimmed = input.trim();
    let (scheme, rest) = match trimmed.find("://") {
        Some(index) => trimmed.split_at(index + 3),
        None => ("", trimmed),
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let shown = match rest[..authority_end].rfind('@') {
        Some(at) => format!("{scheme}{}", &rest[at + 1..]),
        None => trimmed.to_string(),
    };
    shown.chars().take(200).collect()
}

/// Whether a server may be reached over plain `http://`: loopback, private
/// and link-local addresses, the CGNAT range Tailscale uses, single-label
/// names and names under suffixes that never resolve on the public internet.
pub fn allows_plain_http(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let bare = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(&host);
    if let Ok(address) = bare.parse::<IpAddr>() {
        return match address {
            IpAddr::V4(v4) => private_v4(v4),
            IpAddr::V6(v6) => private_v6(v6),
        };
    }
    if host.is_empty() {
        return false;
    }
    !host.contains('.')
        || host == "localhost"
        || PRIVATE_SUFFIXES.iter().any(|suffix| host.ends_with(suffix))
}

fn private_v4(address: Ipv4Addr) -> bool {
    let [first, second, ..] = address.octets();
    address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || (first == 100 && (64..=127).contains(&second))
}

fn private_v6(address: Ipv6Addr) -> bool {
    let first = address.segments()[0];
    address.is_loopback()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || address.to_ipv4_mapped().is_some_and(private_v4)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteProtocol {
    Https,
    Http,
    Ssh,
    Git,
}

/// A Git remote address: `https://`, `http://`, `ssh://`, `git://` or the
/// scp-like `user@host:path`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteAddress {
    pub protocol: RemoteProtocol,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
}

pub fn parse_remote(remote: &str) -> Option<RemoteAddress> {
    let text = remote.trim();
    if text.is_empty() {
        return None;
    }
    if let Some(index) = text.find("://") {
        let protocol = match text[..index].to_ascii_lowercase().as_str() {
            "https" => RemoteProtocol::Https,
            "http" => RemoteProtocol::Http,
            "ssh" => RemoteProtocol::Ssh,
            "git" => RemoteProtocol::Git,
            _ => return None,
        };
        let parsed = url::Url::parse(text).ok()?;
        let host = parsed.host_str()?.to_ascii_lowercase();
        if host.is_empty() {
            return None;
        }
        return Some(RemoteAddress {
            protocol,
            host,
            port: parsed.port(),
            path: clean_path(parsed.path()),
        });
    }
    let colon = text.find(':')?;
    let before = &text[..colon];
    if !before.contains('@') || before.contains('/') || before.contains('\\') {
        return None;
    }
    let host = &before[before.rfind('@')? + 1..];
    if host.chars().count() < 2 {
        return None;
    }
    Some(RemoteAddress {
        protocol: RemoteProtocol::Ssh,
        host: host.to_ascii_lowercase(),
        port: None,
        path: clean_path(&text[colon + 1..]),
    })
}

fn clean_path(path: &str) -> String {
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    path.trim_end_matches('/').to_string()
}

/// Whether an `http(s)` URL lies under `base`: same scheme, host and port,
/// and a path equal to the base path or below it segment by segment, the
/// way Git matches `credential.<url>` settings.
pub fn base_matches_url(base: &str, url: &str) -> bool {
    let (Ok(base), Ok(url)) = (url::Url::parse(base), url::Url::parse(url.trim())) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") || base.scheme() != url.scheme() {
        return false;
    }
    let lower = |parsed: &url::Url| parsed.host_str().map(str::to_ascii_lowercase);
    if lower(&base).is_none() || lower(&base) != lower(&url) {
        return false;
    }
    if base.port_or_known_default() != url.port_or_known_default() {
        return false;
    }
    let base_path = base.path().trim_end_matches('/');
    base_path.is_empty()
        || url.path() == base_path
        || url
            .path()
            .strip_prefix(base_path)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn base_path_len(base: &str) -> usize {
    url::Url::parse(base)
        .map(|parsed| parsed.path().trim_end_matches('/').len())
        .unwrap_or(0)
}

pub fn account_for_remote<'a>(
    accounts: &'a [ForgeAccount],
    remote: &str,
) -> Option<&'a ForgeAccount> {
    accounts
        .iter()
        .filter(|account| base_matches_url(&account.base, remote))
        .max_by_key(|account| base_path_len(&account.base))
}

pub fn clone_url(base: &str, full_name: &str) -> String {
    format!("{base}/{full_name}.git")
}

pub fn web_url(base: &str, full_name: &str) -> String {
    format!("{base}/{full_name}")
}

pub fn host_of(url_or_base: &str) -> Option<String> {
    let text = url_or_base.trim();
    if text.contains("://") {
        let parsed = url::Url::parse(text).ok()?;
        let host = parsed.host_str()?.to_ascii_lowercase();
        if host.is_empty() {
            return None;
        }
        return Some(match parsed.port() {
            Some(port) => format!("{host}:{port}"),
            None => host,
        });
    }
    parse_remote(text).map(|remote| remote.host)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuthMethod, ForgeKind};

    fn account(base: &str) -> ForgeAccount {
        ForgeAccount {
            base: base.to_string(),
            kind: ForgeKind::GitLab,
            flavor: None,
            login: "octo".into(),
            name: None,
            avatar_url: None,
            ca_file: None,
            auth: AuthMethod::Token,
            added_at: 0,
        }
    }

    #[test]
    fn base_urls_normalize_to_scheme_host_port_and_path() {
        for (input, want) in [
            ("gitlab.com", "https://gitlab.com"),
            ("https://GitLab.com/", "https://gitlab.com"),
            ("https://gitlab.com:443", "https://gitlab.com"),
            ("https://github.com/octocat/hello", "https://github.com"),
            ("www.github.com", "https://github.com"),
            ("https://codeberg.org/user/repo", "https://codeberg.org"),
            (
                "https://git.example.org/gitlab/",
                "https://git.example.org/gitlab",
            ),
            (
                "https://git.example.org/gitlab/api/v4",
                "https://git.example.org/gitlab",
            ),
            (
                "https://gitea.example.org/api/v1/",
                "https://gitea.example.org",
            ),
            ("https://ghe.example.org/api/v3", "https://ghe.example.org"),
            ("http://192.168.1.10:3000", "http://192.168.1.10:3000"),
            ("http://nas.local:3000/", "http://nas.local:3000"),
            ("https://bücher.example", "https://xn--bcher-kva.example"),
            (
                "  https://Git.Example.org:8443/Lab  ",
                "https://git.example.org:8443/Lab",
            ),
        ] {
            assert_eq!(normalize_base_url(input).unwrap(), want, "{input}");
        }
        for bad in [
            "",
            "   ",
            "ftp://x.org",
            "https://u:p@host.org",
            "https://host.org/?q=1",
            "https://host.org/#x",
            "file:///etc",
        ] {
            assert!(
                matches!(
                    normalize_base_url(bad),
                    Err(ForgeError::InvalidBaseUrl { .. })
                ),
                "{bad}"
            );
        }
        assert_eq!(
            normalize_base_url("http://gitlab.example.org"),
            Err(ForgeError::HttpsRequired)
        );
    }

    #[test]
    fn normalized_bases_are_fixed_points_of_the_secret_store_rule() {
        for input in [
            "www.github.com",
            "https://git.example.org/gitlab/api/v4",
            "http://[fd00::1]:3000/",
            "https://bücher.example/lab/",
        ] {
            let base = normalize_base_url(input).unwrap();
            assert_eq!(
                oleafly_secrets::accounts::normalize_forge_base(&base).unwrap(),
                base,
                "{input}"
            );
        }
    }

    #[test]
    fn rejected_addresses_never_echo_a_password() {
        let Err(ForgeError::InvalidBaseUrl { input }) =
            normalize_base_url("https://user:hunter2@host.org/x")
        else {
            panic!("a password in the address must be refused");
        };
        assert!(!input.contains("hunter2"), "{input}");
        assert!(!input.contains("user"), "{input}");
    }

    #[test]
    fn plain_http_is_allowed_only_on_private_networks() {
        for host in [
            "localhost",
            "127.0.0.1",
            "[::1]",
            "10.0.0.5",
            "172.16.4.2",
            "192.168.1.10",
            "100.64.0.1",
            "169.254.1.1",
            "[fd00::1]",
            "[fe80::1]",
            "nas",
            "nas.local",
            "git.lan",
            "srv.home.arpa",
            "gitea.internal",
            "box.test",
            "app.localhost",
            "box.tail1234.ts.net",
        ] {
            assert!(allows_plain_http(host), "{host}");
        }
        for host in [
            "gitlab.example.org",
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "[2001:db8::1]",
            "",
        ] {
            assert!(!allows_plain_http(host), "{host}");
        }
    }

    #[test]
    fn remotes_parse_https_ssh_scp_and_git_forms() {
        assert_eq!(
            parse_remote("https://user:pw@gitlab.com/g/p.git"),
            Some(RemoteAddress {
                protocol: RemoteProtocol::Https,
                host: "gitlab.com".into(),
                port: None,
                path: "g/p".into(),
            })
        );
        assert_eq!(
            parse_remote("git@gitlab.com:group/sub/paper.git"),
            Some(RemoteAddress {
                protocol: RemoteProtocol::Ssh,
                host: "gitlab.com".into(),
                port: None,
                path: "group/sub/paper".into(),
            })
        );
        let ssh = parse_remote("ssh://git@host.org:2222/o/r.git").unwrap();
        assert_eq!(ssh.protocol, RemoteProtocol::Ssh);
        assert_eq!(ssh.port, Some(2222));
        assert_eq!(ssh.path, "o/r");
        assert_eq!(
            parse_remote("git://host.org/o/r").unwrap().protocol,
            RemoteProtocol::Git
        );
        assert_eq!(
            parse_remote("https://GitHub.com:443/o/r/").unwrap().port,
            None
        );
    }

    #[test]
    fn windows_paths_are_not_remotes() {
        for path in [
            r"C:\Users\a@b\repo",
            "C:/Users/a@b/repo",
            r"\\srv\share@x:y",
            "relative/path",
            "ext::sh -c x",
            "",
        ] {
            assert!(parse_remote(path).is_none(), "{path}");
        }
    }

    const MATCH_TABLE: [(&str, &str, bool); 13] = [
        (
            "https://gitlab.com",
            "https://gitlab.com/group/sub/paper.git",
            true,
        ),
        (
            "https://gitlab.com",
            "https://GITLAB.com:443/group/paper.git",
            true,
        ),
        (
            "https://gitlab.com",
            "https://user:pw@gitlab.com/g/p.git",
            true,
        ),
        ("https://gitlab.com", "http://gitlab.com/g/p.git", false),
        (
            "https://gitlab.com",
            "https://gitlab.com.evil.org/g/p.git",
            false,
        ),
        (
            "https://gitlab.com",
            "https://evil.org/gitlab.com/g/p.git",
            false,
        ),
        (
            "https://example.org/gitlab",
            "https://example.org/gitlab/g/p.git",
            true,
        ),
        (
            "https://example.org/gitlab",
            "https://example.org/gitlab-old/g/p.git",
            false,
        ),
        (
            "https://example.org/gitlab",
            "https://example.org/g/p.git",
            false,
        ),
        (
            "http://192.168.1.10:3000",
            "http://192.168.1.10:3000/o/r.git",
            true,
        ),
        (
            "http://192.168.1.10:3000",
            "http://192.168.1.10/o/r.git",
            false,
        ),
        ("https://gitlab.com", "git@gitlab.com:g/p.git", false),
        (
            "https://example.org/gitlab",
            "ssh://git@example.org:2222/g/p.git",
            false,
        ),
    ];

    #[test]
    fn an_account_matches_only_remotes_under_its_base() {
        for (base, remote, credential) in MATCH_TABLE {
            assert_eq!(
                base_matches_url(base, remote),
                credential,
                "{base} {remote}"
            );
            let accounts = [account(base)];
            assert_eq!(
                account_for_remote(&accounts, remote).is_some(),
                credential,
                "{base} {remote}"
            );
        }
    }

    #[test]
    fn the_longest_matching_base_wins() {
        let accounts = [
            account("https://example.org"),
            account("https://example.org/gitlab"),
        ];
        assert_eq!(
            account_for_remote(&accounts, "https://example.org/gitlab/g/p.git")
                .unwrap()
                .base,
            "https://example.org/gitlab"
        );
        assert_eq!(
            account_for_remote(&accounts, "https://example.org/other/p.git")
                .unwrap()
                .base,
            "https://example.org"
        );
    }

    #[test]
    fn clone_and_web_urls_join_the_base_and_repository_path() {
        assert_eq!(
            clone_url("https://example.org/gitlab", "g/sub/p"),
            "https://example.org/gitlab/g/sub/p.git"
        );
        assert_eq!(
            web_url("https://example.org/gitlab", "g/sub/p"),
            "https://example.org/gitlab/g/sub/p"
        );
    }

    #[test]
    fn hosts_for_messages_keep_non_default_ports() {
        assert_eq!(
            host_of("https://git.example.org:8443/x").as_deref(),
            Some("git.example.org:8443")
        );
        assert_eq!(
            host_of("https://git.example.org:443/x").as_deref(),
            Some("git.example.org")
        );
        assert_eq!(
            host_of("git@gitlab.com:g/p.git").as_deref(),
            Some("gitlab.com")
        );
        assert_eq!(host_of("not a url"), None);
    }
}
