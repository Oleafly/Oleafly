//! Public GitHub repository statistics (stars and forks) for the About page.
//! No account is needed; the repository name is checked before it reaches
//! the fixed GitHub API origin.
use serde::{Deserialize, Serialize};

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Oleafly")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct GitHubRepoStats {
    pub stars: u64,
    pub forks: u64,
}

#[derive(Deserialize)]
struct GitHubRepoStatsResponse {
    stargazers_count: u64,
    forks_count: u64,
}

fn validated_repository_name(full_name: &str) -> Result<(&str, &str), String> {
    let mut parts = full_name.split('/');
    let owner = parts.next().unwrap_or_default();
    let repository = parts.next().unwrap_or_default();
    let valid_part = |value: &str| {
        !value.is_empty()
            && value != "."
            && value != ".."
            && value.len() <= 100
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    if parts.next().is_some() || !valid_part(owner) || !valid_part(repository) {
        return Err("Choose a valid GitHub repository.".into());
    }
    Ok((owner, repository))
}

/// Load public repository metadata without requiring a connected GitHub
/// account. The repository name is validated before it is interpolated into
/// the fixed GitHub API origin.
#[tauri::command]
pub async fn gh_public_repo_stats(full_name: String) -> Result<GitHubRepoStats, String> {
    let (owner, repository) = validated_repository_name(&full_name)?;
    let client = http_client()?;
    let url = format!("https://api.github.com/repos/{owner}/{repository}");
    fetch_public_repo_stats(&client, &url).await
}

async fn fetch_public_repo_stats(
    client: &reqwest::Client,
    url: &str,
) -> Result<GitHubRepoStats, String> {
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| format!("network error: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Could not load repository statistics ({}).",
            response.status()
        ));
    }

    let stats = response
        .json::<GitHubRepoStatsResponse>()
        .await
        .map_err(|error| format!("invalid repository response: {error}"))?;
    Ok(GitHubRepoStats {
        stars: stats.stargazers_count,
        forks: stats.forks_count,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        fetch_public_repo_stats, http_client, validated_repository_name, GitHubRepoStats,
        GitHubRepoStatsResponse,
    };
    use std::io::{Read, Write};

    fn response(status: &str, body: &[u8]) -> Vec<u8> {
        let mut value = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        value.extend_from_slice(body);
        value
    }

    fn serve(responses: Vec<Vec<u8>>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 4096];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let read = match stream.read(&mut buffer) {
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        result => result.unwrap(),
                    };
                    assert!(read > 0, "request ended before its headers");
                    request.extend_from_slice(&buffer[..read]);
                    assert!(request.len() <= 16 * 1024, "request headers are too large");
                }
                stream.write_all(&response).unwrap();
            }
        });
        format!("http://{address}")
    }

    #[test]
    fn repository_names_accept_one_safe_owner_and_repo_pair() {
        assert_eq!(
            validated_repository_name("oleafly/paper-template.v2").unwrap(),
            ("oleafly", "paper-template.v2")
        );
        assert!(validated_repository_name("missing-repository").is_err());
        assert!(validated_repository_name("owner/repo/extra").is_err());
        assert!(validated_repository_name("owner/repo?ref=main").is_err());
        assert!(validated_repository_name("owner/..").is_err());
    }

    #[test]
    fn repository_stats_map_githubs_public_field_names() {
        let response: GitHubRepoStatsResponse = serde_json::from_value(serde_json::json!({
            "stargazers_count": 123,
            "forks_count": 9
        }))
        .unwrap();

        assert_eq!(
            GitHubRepoStats {
                stars: response.stargazers_count,
                forks: response.forks_count,
            },
            GitHubRepoStats {
                stars: 123,
                forks: 9
            }
        );
    }

    #[tokio::test]
    async fn public_repository_stats_map_success_and_provider_failures() {
        let client = http_client().unwrap();
        let base = serve(vec![response(
            "200 OK",
            br#"{"stargazers_count":45,"forks_count":7}"#,
        )]);
        assert_eq!(
            fetch_public_repo_stats(&client, &format!("{base}/repo"))
                .await
                .unwrap(),
            GitHubRepoStats {
                stars: 45,
                forks: 7
            }
        );

        let base = serve(vec![response("404 Not Found", b"missing")]);
        assert!(fetch_public_repo_stats(&client, &format!("{base}/repo"))
            .await
            .unwrap_err()
            .contains("404"));

        let base = serve(vec![response("200 OK", b"not json")]);
        assert!(fetch_public_repo_stats(&client, &format!("{base}/repo"))
            .await
            .unwrap_err()
            .contains("invalid repository response"));
    }
}
