#![allow(dead_code)]

use std::collections::BTreeMap;
use std::sync::Mutex;

use oleafly_collab_protocol::admin::{RuntimeSettingsPatch, SecurityEvent};
use oleafly_collab_protocol::auth::{
    challenge_message, ChallengePurpose, DeviceCodeRequest, DeviceCodeResponse, DevicePoll,
    DeviceTokenRequest,
};
use oleafly_server::security_log;
use oleafly_server::settings;
use oleafly_server::test_support::{
    api_error_code, challenge_nonce, no_redirect_client, TestDevice, TestServer,
};
use reqwest::header::{ACCEPT_LANGUAGE, COOKIE, LOCATION, SET_COOKIE, VARY};
use url::Url;

pub struct Page {
    pub url: Url,
    pub status: u16,
    pub location: Option<Url>,
    pub vary: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct Form {
    pub action: Url,
    pub fields: Vec<(String, String)>,
    pub label: String,
}

pub struct Browser {
    client: reqwest::Client,
    cookies: Mutex<BTreeMap<String, String>>,
    language: Option<String>,
    address: Option<String>,
}

impl Default for Browser {
    fn default() -> Self {
        Browser::new()
    }
}

impl Browser {
    pub fn new() -> Browser {
        Browser {
            client: no_redirect_client(),
            cookies: Mutex::new(BTreeMap::new()),
            language: None,
            address: None,
        }
    }

    pub fn from_address(address: &str) -> Browser {
        Browser {
            address: Some(address.to_owned()),
            ..Browser::new()
        }
    }

    pub fn speaking(accept_language: &str) -> Browser {
        Browser {
            language: Some(accept_language.to_owned()),
            ..Browser::new()
        }
    }

    pub fn forget_cookies(&self) {
        self.cookies.lock().expect("cookies").clear();
    }

    fn cookie_header(&self) -> Option<String> {
        let cookies = self.cookies.lock().expect("cookies");
        (!cookies.is_empty()).then(|| {
            cookies
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        })
    }

    async fn finish(&self, url: Url, response: reqwest::Response) -> Page {
        for value in response.headers().get_all(SET_COOKIE) {
            let text = value.to_str().expect("cookie text");
            let pair = text.split(';').next().unwrap_or_default();
            if let Some((name, value)) = pair.split_once('=') {
                self.cookies
                    .lock()
                    .expect("cookies")
                    .insert(name.trim().to_owned(), value.trim().to_owned());
            }
        }
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(|value| url.join(value).expect("location"));
        let vary = response
            .headers()
            .get(VARY)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let body = response.text().await.expect("page body");
        Page {
            url,
            status,
            location,
            vary,
            body,
        }
    }

    pub async fn get(&self, url: &Url) -> Page {
        let mut request = self.client.get(url.clone());
        if let Some(cookie) = self.cookie_header() {
            request = request.header(COOKIE, cookie);
        }
        if let Some(language) = &self.language {
            request = request.header(ACCEPT_LANGUAGE, language);
        }
        if let Some(address) = &self.address {
            request = request.header("x-forwarded-for", address);
        }
        let response = request.send().await.expect("get");
        self.finish(url.clone(), response).await
    }

    pub async fn post(&self, url: &Url, fields: &[(String, String)]) -> Page {
        let mut request = self.client.post(url.clone()).form(fields);
        if let Some(cookie) = self.cookie_header() {
            request = request.header(COOKIE, cookie);
        }
        if let Some(language) = &self.language {
            request = request.header(ACCEPT_LANGUAGE, language);
        }
        if let Some(address) = &self.address {
            request = request.header("x-forwarded-for", address);
        }
        let response = request.send().await.expect("post");
        self.finish(url.clone(), response).await
    }

    pub async fn submit(&self, form: &Form, extra: &[(&str, &str)]) -> Page {
        let mut fields = form.fields.clone();
        for (name, value) in extra {
            fields.retain(|(existing, _)| existing != name);
            fields.push(((*name).to_owned(), (*value).to_owned()));
        }
        self.post(&form.action, &fields).await
    }

    pub async fn follow(&self, mut page: Page, stop_at: &str) -> Page {
        for _ in 0..10 {
            let Some(next) = page.location.clone() else {
                return page;
            };
            if next.as_str().starts_with(stop_at) {
                return page;
            }
            page = self.get(&next).await;
        }
        page
    }
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=\"");
    let start = tag.find(&marker)? + marker.len();
    let end = tag[start..].find('"')? + start;
    Some(unescape(&tag[start..end]))
}

fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

pub fn forms(page: &Page) -> Vec<Form> {
    page.body
        .split("<form")
        .skip(1)
        .filter_map(|chunk| {
            let chunk = chunk.split("</form>").next()?;
            let head_end = chunk.find('>')?;
            let action = attribute(&chunk[..head_end], "action")?;
            let fields = chunk
                .split("<input")
                .skip(1)
                .filter_map(|input| {
                    let tag = &input[..input.find('>')?];
                    if attribute(tag, "type").as_deref() != Some("hidden") {
                        return None;
                    }
                    Some((attribute(tag, "name")?, attribute(tag, "value")?))
                })
                .collect();
            let label = chunk
                .split("<button")
                .nth(1)
                .and_then(|button| {
                    let start = button.find('>')? + 1;
                    let end = button.find("</button>")?;
                    Some(unescape(&button[start..end]))
                })
                .unwrap_or_default();
            Some(Form {
                action: page.url.join(&action).expect("form action"),
                fields,
                label,
            })
        })
        .collect()
}

pub fn form(page: &Page) -> Form {
    forms(page)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no form on the page: {}", page.body))
}

pub fn form_labelled(page: &Page, label: &str) -> Form {
    forms(page)
        .into_iter()
        .find(|form| form.label.contains(label))
        .unwrap_or_else(|| panic!("no form labelled {label}: {}", page.body))
}

pub fn text_of(page: &Page) -> String {
    let mut text = String::new();
    let mut inside = false;
    for character in page.body.chars() {
        match character {
            '<' => inside = true,
            '>' => {
                inside = false;
                text.push(' ');
            }
            _ if !inside => text.push(character),
            _ => {}
        }
    }
    unescape(&text.split_whitespace().collect::<Vec<_>>().join(" "))
}

pub async fn set_email_link(server: &TestServer, on: bool) {
    server
        .state()
        .db
        .call(move |conn| {
            settings::patch(
                conn,
                &RuntimeSettingsPatch {
                    email_link_sign_in: Some(on),
                    ..RuntimeSettingsPatch::default()
                },
            )
        })
        .await
        .expect("the setting changes");
}

pub async fn security_events(server: &TestServer) -> Vec<SecurityEvent> {
    server
        .state()
        .db
        .call(|conn| security_log::page(conn, None, 200))
        .await
        .expect("security log")
        .items
}

pub async fn request_code(
    server: &TestServer,
    device: &TestDevice,
    setup_code: Option<&str>,
) -> Result<DeviceCodeResponse, String> {
    request_code_as(
        server,
        DeviceCodeRequest {
            device_public_key: device.public_key_b64().to_owned(),
            device_name: "Lab PC".to_owned(),
            platform: "linux".to_owned(),
            setup_code: setup_code.map(str::to_owned),
        },
        None,
    )
    .await
}

pub async fn request_code_as(
    server: &TestServer,
    request: DeviceCodeRequest,
    from: Option<&str>,
) -> Result<DeviceCodeResponse, String> {
    let mut sent = reqwest::Client::new()
        .post(format!("{}/auth/device/code", server.url()))
        .json(&request);
    if let Some(address) = from {
        sent = sent.header("x-forwarded-for", address);
    }
    let response = sent.send().await.expect("device code request");
    if response.status().is_success() {
        Ok(response.json().await.expect("device code reply"))
    } else {
        Err(api_error_code(response).await)
    }
}

pub async fn poll(
    server: &TestServer,
    device: &TestDevice,
    device_code: &str,
) -> Result<DevicePoll, String> {
    let nonce = challenge_nonce(server).await;
    let message = challenge_message(ChallengePurpose::Token, server.state().server_id, &nonce);
    let response = reqwest::Client::new()
        .post(format!("{}/auth/device/token", server.url()))
        .json(&DeviceTokenRequest {
            device_code: device_code.to_owned(),
            signature: device.sign_b64(&message),
            nonce,
        })
        .send()
        .await
        .expect("device token request");
    if response.status().is_success() {
        Ok(response.json().await.expect("device poll reply"))
    } else {
        Err(api_error_code(response).await)
    }
}
