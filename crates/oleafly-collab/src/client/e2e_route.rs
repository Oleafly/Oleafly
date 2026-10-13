use std::net::SocketAddr;
use std::sync::LazyLock;

pub const ROUTE_ENV: &str = "OLEAFLY_E2E_ROUTE";

static ROUTE: LazyLock<Option<(String, SocketAddr)>> =
    LazyLock::new(|| std::env::var(ROUTE_ENV).ok().as_deref().and_then(parse));

pub(crate) fn parse(text: &str) -> Option<(String, SocketAddr)> {
    let (host, address) = text.split_once('=')?;
    let host = host.trim().to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    Some((host, address.trim().parse().ok()?))
}

pub(crate) fn route_for(host: &str) -> Option<SocketAddr> {
    matching(ROUTE.as_ref(), host)
}

fn matching(route: Option<&(String, SocketAddr)>, host: &str) -> Option<SocketAddr> {
    route
        .filter(|(known, _)| known.eq_ignore_ascii_case(host))
        .map(|(_, address)| *address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_route_sends_one_host_to_a_local_relay() {
        let route = parse(" Oleafly.CodeHQ.pro = 127.0.0.1:9443 ").unwrap();
        assert_eq!(route.0, "oleafly.codehq.pro");
        assert_eq!(route.1, "127.0.0.1:9443".parse::<SocketAddr>().unwrap());
        assert_eq!(matching(Some(&route), "OLEAFLY.codehq.pro"), Some(route.1));
        assert_eq!(matching(Some(&route), "other.codehq.pro"), None);
        assert_eq!(matching(None, "oleafly.codehq.pro"), None);
        assert_eq!(parse("oleafly.codehq.pro"), None);
        assert_eq!(parse("=127.0.0.1:9443"), None);
        assert_eq!(parse("oleafly.codehq.pro=localhost"), None);
    }
}
