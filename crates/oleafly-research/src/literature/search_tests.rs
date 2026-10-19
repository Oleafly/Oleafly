use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::*;
use crate::host::NoSecrets;

struct Fake {
    id: LiteratureSourceId,
    answer: Result<Vec<LiteratureRecord>, String>,
}

#[async_trait::async_trait]
impl LiteratureSource for Fake {
    fn id(&self) -> LiteratureSourceId {
        self.id
    }

    async fn search(&self, _query: &LiteratureQuery) -> Result<Vec<LiteratureRecord>, String> {
        self.answer.clone()
    }
}

fn work(source: LiteratureSourceId, id: &str, title: &str) -> LiteratureRecord {
    LiteratureRecord {
        id: format!("{}:{id}", source.as_str()),
        title: title.into(),
        sources: vec![source],
        source_ids: [(source.as_str().to_owned(), id.to_owned())]
            .into_iter()
            .collect(),
        ..LiteratureRecord::default()
    }
}

#[tokio::test]
async fn one_failing_or_oversized_source_keeps_the_others() {
    let temp = tempfile::tempdir().unwrap();
    let client = LiteratureClient::new(temp.path().join("cache.sqlite3"));
    let extra: Vec<Arc<dyn LiteratureSource>> = vec![
        Arc::new(Fake {
            id: LiteratureSourceId::Openalex,
            answer: Ok(vec![work(
                LiteratureSourceId::Openalex,
                "W1",
                "Graph networks",
            )]),
        }),
        Arc::new(Fake {
            id: LiteratureSourceId::SemanticScholar,
            answer: Err("Semantic Scholar returned more than 2 MB of data.".into()),
        }),
    ];
    let results = search_all(
        &client,
        &NoSecrets,
        LiteratureQuery {
            query: "graph networks".into(),
            sources: vec![
                LiteratureSourceId::Openalex,
                LiteratureSourceId::SemanticScholar,
            ],
            ..LiteratureQuery::default()
        },
        &extra,
    )
    .await
    .unwrap();
    assert_eq!(results.records.len(), 1);
    assert_eq!(results.failures.len(), 1);
    assert_eq!(
        results.failures[0].source,
        LiteratureSourceId::SemanticScholar
    );
    assert!(results.failures[0].message.contains("more than 2 MB"));
}

#[tokio::test]
async fn an_empty_query_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let client = LiteratureClient::new(temp.path().join("cache.sqlite3"));
    assert_eq!(
        search_all(&client, &NoSecrets, LiteratureQuery::default(), &[])
            .await
            .unwrap_err(),
        LiteratureError::QueryEmpty
    );
}

#[tokio::test]
async fn rate_limits_are_retried_with_retry_after() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let seen = requests.clone();
    std::thread::spawn(move || {
        for (index, stream) in listener.incoming().take(2).enumerate() {
            let mut stream = stream.unwrap();
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer);
            seen.fetch_add(1, Ordering::SeqCst);
            let reply = if index == 0 {
                "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned()
            } else {
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_owned()
            };
            let _ = stream.write_all(reply.as_bytes());
        }
    });
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    let started = Instant::now();
    let body = response_text("Test", http.get(format!("http://{address}/search")))
        .await
        .unwrap();
    assert_eq!(body, "ok");
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    assert!(started.elapsed() >= Duration::from_secs(1));
}

#[test]
fn results_are_cached_for_a_day() {
    let temp = tempfile::tempdir().unwrap();
    let cache = cache::LiteratureCache::new(temp.path().join("cache.sqlite3"));
    let key = cache::cache_key("openalex", "  Graph Networks ", 10, None, false);
    assert_eq!(
        key,
        cache::cache_key("openalex", "graph networks", 10, None, false)
    );
    cache.put(&key, "{\"results\":[]}", now_ms());
    assert_eq!(
        cache.get(&key, now_ms()).as_deref(),
        Some("{\"results\":[]}")
    );
    cache.age(&key, 25 * 60 * 60 * 1000);
    assert_eq!(cache.get(&key, now_ms()), None);
}
