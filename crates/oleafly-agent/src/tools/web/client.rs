//! Which addresses the fetch client may reach: public hosts over https,
//! checked again after every DNS lookup and every redirect.
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::Url;

use super::{WebError, WebResult};

pub(crate) const MAX_URL_LEN: usize = 2_000;
pub(crate) const MAX_REDIRECTS: usize = 5;

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        // 100.64.0.0/10, carrier-grade NAT
        || (a == 100 && (b & 0xc0) == 64)
        // 192.0.0.0/24, protocol assignments
        || (a == 192 && b == 0 && c == 0)
        // 198.18.0.0/15, benchmarking
        || (a == 198 && (b == 18 || b == 19))
        // 240.0.0.0/4, reserved
        || a >= 240)
}

/// An address on the public internet. Loopback, private, link-local,
/// carrier-grade NAT, documentation, multicast and reserved ranges are not,
/// including their IPv4-mapped and NAT64 forms.
pub(crate) fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let segments = v6.segments();
            // 64:ff9b::/96, NAT64
            if segments[0] == 0x64 && segments[1] == 0xff9b && segments[2..6] == [0, 0, 0, 0] {
                let v4 = Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                return is_public_v4(v4);
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7, unique local
                || (segments[0] & 0xfe00) == 0xfc00
                // fe80::/10, link-local
                || (segments[0] & 0xffc0) == 0xfe80
                // 2001:db8::/32, documentation
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                // ::/96, IPv4-compatible
                || segments[0..6] == [0, 0, 0, 0, 0, 0])
        }
    }
}

fn local_name(domain: &str) -> bool {
    let domain = domain.trim_end_matches('.').to_ascii_lowercase();
    domain == "localhost"
        || domain.ends_with(".localhost")
        || domain.ends_with(".local")
        || domain.ends_with(".internal")
        || !domain.contains('.')
}

/// The rules every fetched URL meets: https, no credentials, a public host.
pub(crate) fn check_url(url: &Url) -> WebResult<()> {
    if url.as_str().len() > MAX_URL_LEN || url.scheme() != "https" {
        return Err(WebError::InvalidUrl(url.to_string()));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(WebError::NotAllowed(
            "Oleafly does not fetch URLs that carry a user name or password.".into(),
        ));
    }
    let private = || {
        WebError::NotAllowed("Oleafly does not fetch local or private network addresses.".into())
    };
    match url.host() {
        None => Err(WebError::InvalidUrl(url.to_string())),
        Some(url::Host::Domain(domain)) if local_name(domain) => Err(private()),
        Some(url::Host::Domain(_)) => Ok(()),
        Some(url::Host::Ipv4(ip)) if is_public_ip(IpAddr::V4(ip)) => Ok(()),
        Some(url::Host::Ipv6(ip)) if is_public_ip(IpAddr::V6(ip)) => Ok(()),
        Some(_) => Err(private()),
    }
}

/// Whether the fetch follows a redirect to `next` after `hops` requests.
pub(crate) fn redirect_allowed(next: &Url, hops: usize) -> bool {
    hops <= MAX_REDIRECTS && check_url(next).is_ok()
}

/// DNS that only returns public addresses, so a public name pointing at a
/// private address (or one that changes to one) is never reached.
pub(crate) struct PublicResolver;

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|address| is_public_ip(address.ip()))
                .collect();
            if addresses.is_empty() {
                return Err("the host has no public address".into());
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_special_addresses_are_not_public() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.20.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "64:ff9b::a9fe:a9fe",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "2606:4700::1111"] {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn urls_with_credentials_local_names_or_other_schemes_are_refused() {
        for raw in [
            "https://user:pw@example.com/",
            "file:///C:/Users/x",
            "ftp://example.com",
            "https://localhost/",
            "https://printer.local/",
            "https://10.0.0.5/",
            "https://[::1]/",
            "https://intranet/",
            "data:text/html,hi",
        ] {
            assert!(
                Url::parse(raw)
                    .map(|url| check_url(&url).is_err())
                    .unwrap_or(true),
                "{raw}"
            );
        }
        assert!(check_url(&Url::parse("https://en.wikipedia.org/wiki/X").unwrap()).is_ok());
    }

    #[test]
    fn redirects_stay_public_and_short() {
        let public = Url::parse("https://example.org/next").unwrap();
        assert!(redirect_allowed(&public, 1));
        assert!(!redirect_allowed(&public, MAX_REDIRECTS + 1));
        assert!(!redirect_allowed(
            &Url::parse("https://127.0.0.1/").unwrap(),
            1
        ));
        assert!(!redirect_allowed(
            &Url::parse("http://example.org/").unwrap(),
            1
        ));
    }
}
