use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub const TIMEOUT: Duration = Duration::from_secs(5);
pub const HEALTH_PATH: &str = "/readyz";

pub fn target(vars: &BTreeMap<String, String>) -> Result<SocketAddr, String> {
    let bind = match vars
        .get("OLEAFLY_BIND")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(raw) => raw
            .parse::<SocketAddr>()
            .map_err(|_| format!("OLEAFLY_BIND is not an address and port: {raw}"))?,
        None => SocketAddr::from(([0, 0, 0, 0], 8080)),
    };
    let ip = match bind.ip() {
        IpAddr::V4(address) if address.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(address) if address.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        other => other,
    };
    Ok(SocketAddr::new(ip, bind.port()))
}

pub async fn check(address: SocketAddr) -> Result<(), String> {
    tokio::time::timeout(TIMEOUT, probe(address))
        .await
        .unwrap_or_else(|_| Err(format!("no answer from {address} within 5 seconds")))
}

async fn probe(address: SocketAddr) -> Result<(), String> {
    let mut stream = TcpStream::connect(address)
        .await
        .map_err(|error| format!("could not connect to {address}: {error}"))?;
    let request =
        format!("GET {HEALTH_PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| format!("could not send the health request: {error}"))?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .map_err(|error| format!("could not read the health answer: {error}"))?;
    let status_line = response
        .split(|byte| *byte == b'\n')
        .next()
        .map(|line| String::from_utf8_lossy(line).trim().to_string())
        .unwrap_or_default();
    if status_line.split_whitespace().nth(1) == Some("200") {
        Ok(())
    } else {
        Err(format!("{HEALTH_PATH} answered {status_line}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn address(text: &str) -> SocketAddr {
        text.parse().expect("a valid socket address")
    }

    #[test]
    fn the_target_comes_from_the_bind_address_only() {
        assert_eq!(target(&vars(&[])), Ok(address("127.0.0.1:8080")));
        assert_eq!(
            target(&vars(&[("OLEAFLY_BIND", "")])),
            Ok(address("127.0.0.1:8080"))
        );
        assert_eq!(
            target(&vars(&[("OLEAFLY_BIND", "0.0.0.0:9000")])),
            Ok(address("127.0.0.1:9000"))
        );
        assert_eq!(
            target(&vars(&[("OLEAFLY_BIND", "[::]:9000")])),
            Ok(address("[::1]:9000"))
        );
        assert_eq!(
            target(&vars(&[("OLEAFLY_BIND", "10.1.2.3:80")])),
            Ok(address("10.1.2.3:80"))
        );
        assert_eq!(
            target(&vars(&[
                ("OLEAFLY_PUBLIC_URL", "not a url"),
                ("OLEAFLY_SMTP_URL_FILE", "/run/secrets/missing"),
            ])),
            Ok(address("127.0.0.1:8080"))
        );
        assert!(target(&vars(&[("OLEAFLY_BIND", "8080")]))
            .unwrap_err()
            .contains("OLEAFLY_BIND"));
    }
}
