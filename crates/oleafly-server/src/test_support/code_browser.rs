use std::collections::BTreeMap;

use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use url::Url;

pub struct CodePage {
    pub status: u16,
    pub body: String,
}

struct Visit {
    url: Url,
    status: u16,
    location: Option<Url>,
    body: String,
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=\"");
    let start = tag.find(&marker)? + marker.len();
    let end = tag[start..].find('"')? + start;
    Some(
        tag[start..end]
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&"),
    )
}

fn form_with(visit: &Visit, label: &str) -> Option<(Url, Vec<(String, String)>)> {
    visit.body.split("<form").skip(1).find_map(|chunk| {
        let chunk = chunk.split("</form>").next()?;
        let button = chunk.split("<button").nth(1)?;
        if !button.contains(label) {
            return None;
        }
        let action = attribute(&chunk[..chunk.find('>')?], "action")?;
        let fields = chunk
            .split("<input")
            .skip(1)
            .filter_map(|input| {
                let tag = &input[..input.find('>')?];
                Some((attribute(tag, "name")?, attribute(tag, "value")?))
            })
            .collect();
        Some((visit.url.join(&action).ok()?, fields))
    })
}

struct CodeBrowser {
    client: reqwest::Client,
    cookies: BTreeMap<String, String>,
}

impl CodeBrowser {
    async fn send(&mut self, url: Url, form: Option<&[(String, String)]>) -> Result<Visit, String> {
        let mut request = match form {
            Some(fields) => self.client.post(url.clone()).form(fields),
            None => self.client.get(url.clone()),
        };
        if !self.cookies.is_empty() {
            let header = self
                .cookies
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ");
            request = request.header(COOKIE, header);
        }
        let response = request.send().await.map_err(|error| error.to_string())?;
        for value in response.headers().get_all(SET_COOKIE) {
            let pair = value.to_str().unwrap_or_default().split(';').next();
            if let Some((name, value)) = pair.and_then(|pair| pair.split_once('=')) {
                self.cookies
                    .insert(name.trim().to_string(), value.trim().to_string());
            }
        }
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| url.join(value).ok());
        let body = response.text().await.map_err(|error| error.to_string())?;
        Ok(Visit {
            url,
            status,
            location,
            body,
        })
    }

    async fn submit(&mut self, visit: &Visit, label: &str) -> Result<Visit, String> {
        let (action, fields) =
            form_with(visit, label).ok_or_else(|| format!("no {label} button: {}", visit.body))?;
        let mut visit = self.send(action, Some(&fields)).await?;
        for _ in 0..10 {
            let Some(next) = visit.location.clone() else {
                break;
            };
            visit = self.send(next, None).await?;
        }
        Ok(visit)
    }
}

pub async fn approve_code(
    verification_uri_complete: &str,
    provider_label: &str,
) -> Result<CodePage, String> {
    let mut browser = CodeBrowser {
        client: reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| error.to_string())?,
        cookies: BTreeMap::new(),
    };
    let start = Url::parse(verification_uri_complete).map_err(|error| error.to_string())?;
    // The link already carries the code, so it opens the page that names the
    // device and offers the ways to sign in.
    let confirm = browser.send(start, None).await?;
    let done = browser
        .submit(&confirm, &format!("Continue with {provider_label}"))
        .await?;
    Ok(CodePage {
        status: done.status,
        body: done.body,
    })
}
