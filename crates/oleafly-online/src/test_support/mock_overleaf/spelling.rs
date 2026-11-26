use std::collections::HashMap;

use serde_json::{json, Value};

use super::{json_reply, text_reply, MockOverleaf, Reply, State, WithStatus};

pub(super) const DICTIONARY_BYTES: usize = 1024 * 1024;

fn invalid(detail: &str) -> Reply {
    json_reply(&json!({ "error": format!("Validation error: {detail}"), "statusCode": 400 }))
        .with_status(400)
}

fn word_of(body: &[u8]) -> Result<String, Reply> {
    let Ok(Value::Object(request)) = serde_json::from_slice::<Value>(body) else {
        return Err(invalid("Expected object"));
    };
    if let Some(extra) = request.keys().find(|key| *key != "word") {
        return Err(invalid(&format!(
            "Unrecognized key: \"{extra}\" at \"body\""
        )));
    }
    match request.get("word").and_then(Value::as_str) {
        Some(word) if !word.is_empty() => Ok(word.to_string()),
        Some(_) => Err(invalid(
            "Too small: expected string to have >=1 characters at \"body.word\"",
        )),
        None => Err(invalid(
            "Invalid input: expected string, received undefined at \"body.word\"",
        )),
    }
}

impl State {
    pub(super) fn learned_meta(&self, user: &str) -> (&'static str, &'static str, String) {
        let words = self.learned.get(user).cloned().unwrap_or_default();
        ("ol-learnedWords", "json", json!(words).to_string())
    }

    pub(super) fn spelling_route(
        &mut self,
        method: &str,
        path: &str,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> Option<Reply> {
        let learn = match (method, path) {
            ("POST", "/spelling/learn") => true,
            ("POST", "/spelling/unlearn") => false,
            (_, "/spelling/learn" | "/spelling/unlearn") => return Some(Reply::status(404)),
            _ => return None,
        };
        if headers.get("x-csrf-token") != Some(&self.csrf) {
            return Some(text_reply(403, "Forbidden"));
        }
        let Some(user) = self.user_for(headers) else {
            return Some(text_reply(403, "Forbidden"));
        };
        let word = match word_of(body) {
            Ok(word) => word,
            Err(refused) => return Some(refused),
        };
        let limit = self.config.dictionary_bytes;
        let words = self.learned.entry(user).or_default();
        if learn {
            let size: usize = words.iter().map(String::len).sum();
            if size + word.len() > limit {
                return Some(text_reply(400, "Max dictionary size reached"));
            }
            if !words.contains(&word) {
                words.push(word);
            }
        } else {
            words.retain(|known| *known != word);
        }
        Some(Reply::status(204))
    }
}

impl MockOverleaf {
    pub fn learned_words(&self, name: &str) -> Vec<String> {
        let user = self.user(name).id;
        self.state().learned.get(&user).cloned().unwrap_or_default()
    }

    pub fn set_learned_words(&self, name: &str, words: &[&str]) {
        let user = self.user(name).id;
        self.state()
            .learned
            .insert(user, words.iter().map(|word| (*word).to_string()).collect());
    }
}
