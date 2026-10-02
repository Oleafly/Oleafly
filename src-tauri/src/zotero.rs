use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, RETRY_AFTER};
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::Value;

use crate::app_error::AppError;

const UA: &str = "Oleafly/0.2 (https://github.com/Oleafly/Oleafly; Zotero import)";
const API_BASE: &str = "https://api.zotero.org";
const API_VERSION: &str = "3";
const EXPORT_FORMAT: &str = "bibtex";
const PAGE_SIZE: usize = 100;
const MAX_ITEMS: usize = 5_000;
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_LIBRARY_BYTES: usize = 32 * 1024 * 1024;
const MAX_WAIT_SECS: u64 = 30;
const DEFAULT_WAIT_SECS: u64 = 5;
const MAX_USER_ID_LEN: usize = 20;
const MAX_API_KEY_LEN: usize = 128;
const USER_ID_SECRET: &str = "zotero-user-id";
const API_KEY_SECRET: &str = "zotero-api-key";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroAccount {
    pub user_id: String,
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroLibraryExport {
    pub bibtex: String,
    pub count: usize,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UserId(String);

impl UserId {
    fn parse(raw: &str) -> Result<Self, AppError> {
        if is_valid_user_id(raw) {
            Ok(Self(raw.to_string()))
        } else {
            Err(AppError::new("zotero.invalid_user_id"))
        }
    }

    fn same_account(&self, other: &str) -> bool {
        self.0.trim_start_matches('0') == other.trim_start_matches('0')
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct KeyInfo {
    user_id: String,
    username: String,
    library: bool,
}

struct Page {
    body: String,
    total: Option<usize>,
    backoff: Option<u64>,
}

#[derive(Debug, Default)]
struct WaitBudget {
    used: bool,
}

impl WaitBudget {
    fn take(&mut self, seconds: u64) -> Result<Duration, AppError> {
        if self.used || seconds > MAX_WAIT_SECS {
            return Err(AppError::new("zotero.rate_limited"));
        }
        self.used = true;
        Ok(Duration::from_secs(seconds))
    }
}

fn is_valid_user_id(user_id: &str) -> bool {
    !user_id.is_empty()
        && user_id.len() <= MAX_USER_ID_LEN
        && user_id.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_valid_api_key(api_key: &str) -> bool {
    !api_key.is_empty()
        && api_key.len() <= MAX_API_KEY_LEN
        && api_key.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn keys_url() -> String {
    format!("{API_BASE}/keys/current")
}

fn items_url(user_id: &UserId, start: usize) -> String {
    format!(
        "{API_BASE}/users/{}/items/top?format={EXPORT_FORMAT}&limit={PAGE_SIZE}&start={start}&sort=dateAdded&direction=asc",
        user_id.0
    )
}

fn parse_key_info(body: &str) -> Result<KeyInfo, AppError> {
    let value: Value =
        serde_json::from_str(body).map_err(|_| AppError::new("zotero.invalid_response"))?;
    let user_id = match value.get("userID") {
        Some(Value::Number(number)) => number.as_u64().map(|id| id.to_string()),
        Some(Value::String(text)) => Some(text.trim().to_string()),
        _ => None,
    }
    .filter(|id| is_valid_user_id(id))
    .ok_or_else(|| AppError::new("zotero.invalid_response"))?;
    let username = value
        .get("username")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    let library = value
        .pointer("/access/user/library")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(KeyInfo {
        user_id,
        username,
        library,
    })
}

fn account_for(info: KeyInfo, expected: Option<&UserId>) -> Result<ZoteroAccount, AppError> {
    if !info.library {
        return Err(AppError::new("zotero.library_not_readable"));
    }
    if let Some(expected) = expected {
        if !expected.same_account(&info.user_id) {
            return Err(AppError::new("zotero.user_mismatch")
                .param("keyUserId", &info.user_id)
                .param("userId", &expected.0));
        }
    }
    Ok(ZoteroAccount {
        user_id: info.user_id,
        username: info.username,
    })
}

fn stored_credentials(secrets: &HashMap<String, String>) -> Result<(UserId, String), AppError> {
    let stored = |name: &str| {
        secrets
            .get(name)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
    };
    let (Some(user_id), Some(api_key)) = (stored(USER_ID_SECRET), stored(API_KEY_SECRET)) else {
        return Err(AppError::new("zotero.not_connected"));
    };
    let user_id = UserId::parse(user_id)?;
    if !is_valid_api_key(api_key) {
        return Err(AppError::new("zotero.key_rejected"));
    }
    Ok((user_id, api_key.to_string()))
}

fn status_error(status: StatusCode) -> AppError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => {
            AppError::new("zotero.key_rejected")
        }
        StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE => {
            AppError::new("zotero.rate_limited")
        }
        _ => AppError::new("zotero.http_error").param("status", status.as_u16()),
    }
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn wait_seconds(value: Option<&str>) -> Option<u64> {
    value.and_then(|text| text.trim().parse::<u64>().ok())
}

fn retry_wait(headers: &HeaderMap) -> u64 {
    wait_seconds(header_text(headers, RETRY_AFTER.as_str()))
        .or_else(|| wait_seconds(header_text(headers, "Backoff")))
        .unwrap_or(DEFAULT_WAIT_SECS)
}

fn parse_total_results(value: Option<&str>) -> Option<usize> {
    value.and_then(|text| text.trim().parse::<usize>().ok())
}

fn next_start(start: usize, total: Option<usize>, page_has_entries: bool) -> Option<usize> {
    let limit = match total {
        Some(total) => total.min(MAX_ITEMS),
        None if page_has_entries => MAX_ITEMS,
        None => return None,
    };
    let next = start.saturating_add(PAGE_SIZE);
    (next < limit).then_some(next)
}

fn items_on_page(start: usize, total: Option<usize>, entries: usize) -> usize {
    match total {
        Some(total) => total.saturating_sub(start).min(PAGE_SIZE),
        None => entries.min(PAGE_SIZE),
    }
}

fn count_entries(bibtex: &str) -> usize {
    bibtex
        .lines()
        .filter(|line| {
            let mut chars = line.trim_start().chars();
            chars.next() == Some('@') && chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        })
        .count()
}

fn append_page(bibtex: &mut String, page: &str) {
    let page = page.trim();
    if page.is_empty() {
        return;
    }
    if !bibtex.is_empty() {
        bibtex.push_str("\n\n");
    }
    bibtex.push_str(page);
}

fn client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent(UA)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::new("zotero.unreachable"))
}

async fn read_body(response: reqwest::Response) -> Result<String, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PAGE_BYTES as u64)
    {
        return Err(AppError::new("zotero.too_large"));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::new("zotero.unreachable"))?;
        if body.len().saturating_add(chunk.len()) > MAX_PAGE_BYTES {
            return Err(AppError::new("zotero.too_large"));
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| AppError::new("zotero.invalid_response"))
}

async fn get_page(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    budget: &mut WaitBudget,
) -> Result<Page, AppError> {
    loop {
        let response = client
            .get(url)
            .header("Zotero-API-Key", api_key)
            .header("Zotero-API-Version", API_VERSION)
            .send()
            .await
            .map_err(|_| AppError::new("zotero.unreachable"))?;
        let status = response.status();
        let headers = response.headers();
        if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE {
            let wait = budget.take(retry_wait(headers))?;
            tokio::time::sleep(wait).await;
            continue;
        }
        if !status.is_success() {
            return Err(status_error(status));
        }
        let total = parse_total_results(header_text(headers, "Total-Results"));
        let backoff = wait_seconds(header_text(headers, "Backoff"));
        let body = read_body(response).await?;
        return Ok(Page {
            body,
            total,
            backoff,
        });
    }
}

async fn verify(user_id: &str, api_key: &str) -> Result<ZoteroAccount, AppError> {
    let expected = if user_id.is_empty() {
        None
    } else {
        Some(UserId::parse(user_id)?)
    };
    if !is_valid_api_key(api_key) {
        return Err(AppError::new("zotero.key_rejected"));
    }
    let client = client()?;
    let page = get_page(&client, &keys_url(), api_key, &mut WaitBudget::default()).await?;
    account_for(parse_key_info(&page.body)?, expected.as_ref())
}

async fn export_library(user_id: &UserId, api_key: &str) -> Result<ZoteroLibraryExport, AppError> {
    let client = client()?;
    let mut budget = WaitBudget::default();
    let mut bibtex = String::new();
    let mut total = None;
    let mut count = 0;
    let mut start = 0;
    loop {
        let page = get_page(&client, &items_url(user_id, start), api_key, &mut budget).await?;
        total = total.or(page.total);
        let entries = count_entries(&page.body);
        count += items_on_page(start, total, entries);
        append_page(&mut bibtex, &page.body);
        if bibtex.len() > MAX_LIBRARY_BYTES {
            return Err(AppError::new("zotero.too_large"));
        }
        let Some(next) = next_start(start, total, entries > 0) else {
            break;
        };
        if let Some(seconds) = page.backoff {
            tokio::time::sleep(budget.take(seconds)?).await;
        }
        start = next;
    }
    Ok(ZoteroLibraryExport {
        bibtex,
        count,
        total: total.unwrap_or(count),
    })
}

#[tauri::command]
pub async fn zotero_verify(user_id: String, api_key: String) -> Result<ZoteroAccount, String> {
    verify(user_id.trim(), api_key.trim())
        .await
        .map_err(String::from)
}

#[tauri::command]
pub async fn zotero_library_bibtex() -> Result<ZoteroLibraryExport, String> {
    let secrets = crate::secrets::read_connector_secrets()?;
    let (user_id, api_key) = stored_credentials(&secrets)?;
    export_library(&user_id, &api_key)
        .await
        .map_err(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(error: AppError) -> &'static str {
        error.code
    }

    fn starts(total: Option<usize>) -> Vec<usize> {
        let mut pages = vec![0];
        while let Some(next) = next_start(*pages.last().unwrap(), total, true) {
            pages.push(next);
        }
        pages
    }

    fn fetched(total: usize) -> usize {
        starts(Some(total))
            .into_iter()
            .map(|start| items_on_page(start, Some(total), 0))
            .sum()
    }

    #[test]
    fn user_ids_are_ascii_digits_only() {
        assert!(is_valid_user_id("475425"));
        assert!(is_valid_user_id("0"));
        assert!(!is_valid_user_id(""));
        assert!(!is_valid_user_id(" 475425"));
        assert!(!is_valid_user_id("4754a5"));
        assert!(!is_valid_user_id("../keys"));
        assert!(!is_valid_user_id("１２３"));
        assert!(!is_valid_user_id("-12"));
        assert!(!is_valid_user_id(&"9".repeat(MAX_USER_ID_LEN + 1)));
        assert_eq!(
            code(UserId::parse("12/34").unwrap_err()),
            "zotero.invalid_user_id"
        );
        assert_eq!(UserId::parse("12345").unwrap(), UserId("12345".to_string()));
    }

    #[test]
    fn api_keys_must_be_plain_alphanumerics() {
        assert!(is_valid_api_key("P9NiFoyLeZu2bZNvvuQPDWsd"));
        assert!(!is_valid_api_key(""));
        assert!(!is_valid_api_key("abc def"));
        assert!(!is_valid_api_key("abc\r\nX-Evil: 1"));
        assert!(!is_valid_api_key(&"a".repeat(MAX_API_KEY_LEN + 1)));
    }

    #[test]
    fn builds_the_zotero_urls() {
        assert_eq!(keys_url(), "https://api.zotero.org/keys/current");
        let user = UserId::parse("475425").unwrap();
        assert_eq!(
            items_url(&user, 0),
            "https://api.zotero.org/users/475425/items/top?format=bibtex&limit=100&start=0&sort=dateAdded&direction=asc"
        );
        assert!(items_url(&user, 4_900).contains("&start=4900&"));
    }

    #[test]
    fn reads_the_key_owner_and_library_access() {
        let body = r#"{
            "key": "P9NiFoyLeZu2bZNvvuQPDWsd",
            "userID": 475425,
            "username": " ada ",
            "displayName": "Ada",
            "access": { "user": { "library": true, "files": true, "notes": true } }
        }"#;
        assert_eq!(
            parse_key_info(body).unwrap(),
            KeyInfo {
                user_id: "475425".to_string(),
                username: "ada".to_string(),
                library: true,
            }
        );
        let string_id = r#"{"userID":"12","access":{"user":{"library":false}}}"#;
        let info = parse_key_info(string_id).unwrap();
        assert_eq!(info.user_id, "12");
        assert_eq!(info.username, "");
        assert!(!info.library);
        let no_user_access = r#"{"userID":12,"access":{"groups":{"all":{"library":true}}}}"#;
        assert!(!parse_key_info(no_user_access).unwrap().library);
    }

    #[test]
    fn rejects_unreadable_key_replies_without_echoing_them() {
        for body in [
            "",
            "not json",
            r#"{"key":"SECRETKEY123","username":"ada"}"#,
            r#"{"key":"SECRETKEY123","userID":-4}"#,
            r#"{"key":"SECRETKEY123","userID":"12a"}"#,
        ] {
            let error = parse_key_info(body).unwrap_err();
            assert_eq!(error.code, "zotero.invalid_response");
            assert!(!String::from(error).contains("SECRETKEY123"));
        }
    }

    #[test]
    fn checks_library_access_and_the_typed_user_id() {
        let info = |library| KeyInfo {
            user_id: "475425".to_string(),
            username: "ada".to_string(),
            library,
        };
        assert_eq!(
            account_for(info(true), None).unwrap(),
            ZoteroAccount {
                user_id: "475425".to_string(),
                username: "ada".to_string(),
            }
        );
        let same = UserId::parse("0475425").unwrap();
        assert!(account_for(info(true), Some(&same)).is_ok());
        assert_eq!(
            code(account_for(info(false), Some(&same)).unwrap_err()),
            "zotero.library_not_readable"
        );
        let other = UserId::parse("999").unwrap();
        let mismatch = account_for(info(true), Some(&other)).unwrap_err();
        assert_eq!(mismatch.code, "zotero.user_mismatch");
        assert_eq!(mismatch.params["keyUserId"], "475425");
        assert_eq!(mismatch.params["userId"], "999");
    }

    #[test]
    fn reads_saved_credentials() {
        let secrets = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect::<HashMap<_, _>>()
        };
        assert_eq!(
            code(stored_credentials(&secrets(&[])).unwrap_err()),
            "zotero.not_connected"
        );
        assert_eq!(
            code(stored_credentials(&secrets(&[(API_KEY_SECRET, "abc")])).unwrap_err()),
            "zotero.not_connected"
        );
        assert_eq!(
            code(
                stored_credentials(&secrets(&[(USER_ID_SECRET, " "), (API_KEY_SECRET, "abc")]))
                    .unwrap_err()
            ),
            "zotero.not_connected"
        );
        assert_eq!(
            code(
                stored_credentials(&secrets(&[
                    (USER_ID_SECRET, "12x"),
                    (API_KEY_SECRET, "abc")
                ]))
                .unwrap_err()
            ),
            "zotero.invalid_user_id"
        );
        assert_eq!(
            code(
                stored_credentials(&secrets(&[(USER_ID_SECRET, "12"), (API_KEY_SECRET, "a b")]))
                    .unwrap_err()
            ),
            "zotero.key_rejected"
        );
        let (user, key) = stored_credentials(&secrets(&[
            (USER_ID_SECRET, " 12 "),
            (API_KEY_SECRET, " abc "),
        ]))
        .unwrap();
        assert_eq!(user, UserId("12".to_string()));
        assert_eq!(key, "abc");
    }

    #[test]
    fn maps_http_statuses_to_error_codes() {
        assert_eq!(
            code(status_error(StatusCode::FORBIDDEN)),
            "zotero.key_rejected"
        );
        assert_eq!(
            code(status_error(StatusCode::NOT_FOUND)),
            "zotero.key_rejected"
        );
        assert_eq!(
            code(status_error(StatusCode::UNAUTHORIZED)),
            "zotero.key_rejected"
        );
        assert_eq!(
            code(status_error(StatusCode::TOO_MANY_REQUESTS)),
            "zotero.rate_limited"
        );
        let server = status_error(StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(server.code, "zotero.http_error");
        assert_eq!(server.params["status"], "500");
        assert_eq!(code(status_error(StatusCode::FOUND)), "zotero.http_error");
    }

    #[test]
    fn pages_through_total_results() {
        assert_eq!(parse_total_results(Some(" 250 ")), Some(250));
        assert_eq!(parse_total_results(Some("lots")), None);
        assert_eq!(parse_total_results(None), None);
        assert_eq!(starts(Some(0)), vec![0]);
        assert_eq!(starts(Some(1)), vec![0]);
        assert_eq!(starts(Some(100)), vec![0]);
        assert_eq!(starts(Some(101)), vec![0, 100]);
        assert_eq!(starts(Some(250)), vec![0, 100, 200]);
        assert_eq!(fetched(0), 0);
        assert_eq!(fetched(1), 1);
        assert_eq!(fetched(250), 250);
        assert_eq!(items_on_page(200, Some(250), 7), 50);
    }

    #[test]
    fn stops_at_the_item_cap() {
        let capped = starts(Some(7_000));
        assert_eq!(capped.len(), MAX_ITEMS / PAGE_SIZE);
        assert_eq!(capped.last(), Some(&(MAX_ITEMS - PAGE_SIZE)));
        assert_eq!(fetched(7_000), MAX_ITEMS);
        assert_eq!(fetched(MAX_ITEMS), MAX_ITEMS);
        assert_eq!(next_start(usize::MAX - 1, Some(usize::MAX), true), None);
    }

    #[test]
    fn pages_until_empty_without_a_total() {
        assert_eq!(next_start(0, None, true), Some(100));
        assert_eq!(next_start(100, None, false), None);
        assert_eq!(starts(None).len(), MAX_ITEMS / PAGE_SIZE);
        assert_eq!(items_on_page(0, None, 42), 42);
    }

    #[test]
    fn waits_once_and_only_briefly() {
        let mut budget = WaitBudget::default();
        assert_eq!(budget.take(5).unwrap(), Duration::from_secs(5));
        assert_eq!(code(budget.take(1).unwrap_err()), "zotero.rate_limited");
        let mut long = WaitBudget::default();
        assert_eq!(
            code(long.take(MAX_WAIT_SECS + 1).unwrap_err()),
            "zotero.rate_limited"
        );
        assert!(long.take(MAX_WAIT_SECS).is_ok());
    }

    #[test]
    fn reads_wait_headers() {
        let mut headers = HeaderMap::new();
        assert_eq!(retry_wait(&headers), DEFAULT_WAIT_SECS);
        headers.insert("Backoff", "12".parse().unwrap());
        assert_eq!(retry_wait(&headers), 12);
        headers.insert(RETRY_AFTER, " 7 ".parse().unwrap());
        assert_eq!(retry_wait(&headers), 7);
        headers.insert(
            RETRY_AFTER,
            "Wed, 21 Oct 2026 07:28:00 GMT".parse().unwrap(),
        );
        assert_eq!(retry_wait(&headers), 12);
        assert_eq!(wait_seconds(Some("-3")), None);
    }

    #[test]
    fn joins_pages_and_counts_entries() {
        let first =
            "\n@article{smith_2020,\n\ttitle = {A},\n}\n\n@book{doe_2019,\n\ttitle = {B},\n}\n";
        let second = "  @inproceedings{lee_2021,\n\ttitle = {@home},\n}\n";
        assert_eq!(count_entries(first), 2);
        assert_eq!(count_entries(second), 1);
        assert_eq!(count_entries("@ not an entry\n email@example.com"), 0);
        let mut joined = String::new();
        append_page(&mut joined, first);
        append_page(&mut joined, "  \n");
        append_page(&mut joined, second);
        assert!(joined.starts_with("@article{smith_2020,"));
        assert!(joined.contains("}\n\n@inproceedings{lee_2021,"));
        assert_eq!(count_entries(&joined), 3);
    }

    #[test]
    fn serializes_camel_case_results() {
        let account = serde_json::to_value(ZoteroAccount {
            user_id: "12".to_string(),
            username: "ada".to_string(),
        })
        .unwrap();
        assert_eq!(
            account,
            serde_json::json!({ "userId": "12", "username": "ada" })
        );
        let export = serde_json::to_value(ZoteroLibraryExport {
            bibtex: String::new(),
            count: 1,
            total: 2,
        })
        .unwrap();
        assert_eq!(
            export,
            serde_json::json!({ "bibtex": "", "count": 1, "total": 2 })
        );
    }

    #[test]
    fn every_error_code_has_english_text() {
        for code in [
            "zotero.invalid_user_id",
            "zotero.key_rejected",
            "zotero.library_not_readable",
            "zotero.not_connected",
            "zotero.rate_limited",
            "zotero.unreachable",
            "zotero.invalid_response",
            "zotero.too_large",
        ] {
            let text: String = AppError::new(code).into();
            assert!(crate::app_error::english(&text).is_some(), "{code}");
        }
        let mismatch: String = AppError::new("zotero.user_mismatch")
            .param("keyUserId", "475425")
            .param("userId", "999")
            .into();
        let english = crate::app_error::english(&mismatch).unwrap();
        assert!(english.contains("475425") && english.contains("999"));
        let http: String = AppError::new("zotero.http_error")
            .param("status", 502)
            .into();
        assert!(crate::app_error::english(&http).unwrap().contains("502"));
    }
}
