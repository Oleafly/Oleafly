//! Keeps credentials out of everything Oleafly stores or shows: the
//! environment's secrets, MCP server credentials and anything typed into
//! Oleafly for one request (an API-key sign-in, a provider key).
use std::sync::RwLock;

use serde_json::Value;

pub struct Redactor {
    secrets: RwLock<Vec<String>>,
}

/// The values of the environment's secret-looking variables. A variable whose
/// name or value is not valid Unicode is skipped: `std::env::vars` panics on
/// one.
fn environment_secrets(
    vars: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> Vec<String> {
    vars.filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)))
        .filter(|(name, value)| sensitive_key(name) && value.len() >= 6)
        .map(|(_, value)| value)
        .collect()
}

impl Redactor {
    pub fn new(extra: &[Value]) -> Self {
        let mut secrets = environment_secrets(std::env::vars_os());
        for value in extra {
            collect_secrets(value, &mut secrets);
        }
        secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
        secrets.dedup();
        Self {
            secrets: RwLock::new(secrets),
        }
    }

    /// Adds a secret typed into Oleafly for one request, so it is removed
    /// from everything the session stores from now on.
    pub fn add_secret(&self, secret: &str) {
        let Ok(mut secrets) = self.secrets.write() else {
            return;
        };
        push_secret(secret, &mut secrets);
        secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
        secrets.dedup();
    }

    /// The length of the longest secret it removes (0 without any).
    pub fn longest_secret(&self) -> usize {
        self.secrets
            .read()
            .map(|secrets| secrets.first().map_or(0, String::len))
            .unwrap_or(0)
    }

    pub fn opaque_id(&self, value: &str) -> Result<String, String> {
        if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
            return Err("The agent returned an invalid protocol identifier.".into());
        }
        if self.text(value) != value {
            return Err(
                "The agent included a credential in protocol metadata. The session was stopped."
                    .into(),
            );
        }
        Ok(value.into())
    }

    pub fn validate_metadata_ids(&self, value: &Value) -> Result<(), String> {
        match value {
            Value::Object(map) => {
                for (key, value) in map {
                    if matches!(
                        key.as_str(),
                        "id" | "sessionId"
                            | "modelId"
                            | "currentModelId"
                            | "currentValue"
                            | "value"
                            | "optionId"
                            | "toolCallId"
                    ) {
                        if let Some(text) = value.as_str() {
                            self.opaque_id(text)?;
                        }
                    }
                    self.validate_metadata_ids(value)?;
                }
            }
            Value::Array(values) => {
                for value in values {
                    self.validate_metadata_ids(value)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn text(&self, text: &str) -> String {
        let mut output = text.to_owned();
        if let Ok(secrets) = self.secrets.read() {
            for secret in secrets.iter() {
                output = output.replace(secret.as_str(), "[credential omitted]");
            }
        }
        output
            .lines()
            .map(|line| {
                redact_assignments(line)
                    .split_inclusive(char::is_whitespace)
                    .map(|part| {
                        let trimmed = part.trim_matches(|c: char| {
                            !c.is_ascii_alphanumeric() && c != '-' && c != '_'
                        });
                        if (trimmed.starts_with("sk-")
                            || trimmed.starts_with("sk_")
                            || trimmed.starts_with("ghp_")
                            || trimmed.starts_with("AIza"))
                            && trimmed.len() > 18
                        {
                            "[credential omitted] ".into()
                        } else {
                            part.to_owned()
                        }
                    })
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
            + if text.ends_with('\n') { "\n" } else { "" }
    }

    pub fn value(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.text(text)),
            Value::Array(values) => Value::Array(values.iter().map(|v| self.value(v)).collect()),
            Value::Object(values) => Value::Object(
                values
                    .iter()
                    .filter(|(key, _)| !matches!(key.as_str(), "rawInput" | "rawOutput" | "_meta"))
                    .map(|(key, value)| {
                        (
                            key.clone(),
                            if sensitive_key(key) {
                                Value::String("[credential omitted]".into())
                            } else {
                                self.value(value)
                            },
                        )
                    })
                    .collect(),
            ),
            other => other.clone(),
        }
    }
}

/// Words whose assigned value is a credential (`password = …`).
const ASSIGNMENT_KEYS: [&str; 8] = [
    "password",
    "api_key",
    "api-key",
    "apikey",
    "access_token",
    "refresh_token",
    "authorization",
    "client_secret",
];
/// A shorter assigned value is a word of prose, not a credential.
const MIN_ASSIGNED: usize = 6;
/// A bearer token is at least this long.
const MIN_BEARER: usize = 12;
const OMITTED: &str = "[credential omitted]";

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

fn skip_blanks(bytes: &[u8], mut index: usize) -> usize {
    while matches!(bytes.get(index), Some(b' ' | b'\t')) {
        index += 1;
    }
    index
}

/// Where the value that starts at `start` ends: at whitespace, a quote or a
/// separator.
fn value_end(line: &str, start: usize) -> usize {
    line[start..]
        .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';' | '`'))
        .map_or(line.len(), |offset| start + offset)
}

/// The value assigned after a key that ends at `key_end`: past an optional
/// closing quote, `=` or `:` (not `://`), an optional opening quote and a
/// `Bearer`, `Basic` or `Token` scheme.
fn assigned_value(line: &str, key_end: usize) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut at = key_end;
    if matches!(bytes.get(at), Some(b'"' | b'\'')) {
        at += 1;
    }
    at = skip_blanks(bytes, at);
    match bytes.get(at) {
        Some(b'=') => {}
        Some(b':') if !line[at..].starts_with("://") => {}
        _ => return None,
    }
    at = skip_blanks(bytes, at + 1);
    if matches!(bytes.get(at), Some(b'"' | b'\'')) {
        at += 1;
    }
    let mut end = value_end(line, at);
    if matches!(
        line[at..end].to_ascii_lowercase().as_str(),
        "bearer" | "basic" | "token"
    ) {
        at = skip_blanks(bytes, end);
        end = value_end(line, at);
    }
    (end - at >= MIN_ASSIGNED).then_some((at, end))
}

/// Replaces the values of credential assignments in one line (`password =
/// hunter22`, `"api_key": "sk-…"`, `Authorization: Bearer …`, `bearer …`)
/// and nothing else: prose that only mentions a password stays as written.
fn redact_assignments(line: &str) -> std::borrow::Cow<'_, str> {
    let bytes = line.as_bytes();
    let mut output = String::new();
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        if !is_word(bytes[index]) {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && is_word(bytes[index]) {
            index += 1;
        }
        let word = line[start..index].to_ascii_lowercase();
        let value = if word == "bearer" {
            Some(skip_blanks(bytes, index))
                .filter(|at| *at > index)
                .map(|at| (at, value_end(line, at)))
                .filter(|(at, end)| end - at >= MIN_BEARER)
        } else if ASSIGNMENT_KEYS.iter().any(|key| word.contains(key)) {
            assigned_value(line, index)
        } else {
            None
        };
        if let Some((at, end)) = value {
            output.push_str(&line[copied..at]);
            output.push_str(OMITTED);
            copied = end;
            index = end;
        }
    }
    if copied == 0 {
        std::borrow::Cow::Borrowed(line)
    } else {
        output.push_str(&line[copied..]);
        std::borrow::Cow::Owned(output)
    }
}

fn push_secret(text: &str, secrets: &mut Vec<String>) {
    if text.len() < 6 {
        return;
    }
    secrets.push(text.into());
    if text
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("Bearer "))
    {
        secrets.push(text[7..].into());
    }
}

fn collect_secrets(value: &Value, secrets: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (name, value) in map {
                if sensitive_key(name) || name == "value" {
                    if let Some(text) = value.as_str() {
                        push_secret(text, secrets);
                    }
                }
                collect_secrets(value, secrets);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_secrets(value, secrets);
            }
        }
        _ => {}
    }
}

fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("password")
        || key.contains("secret")
        || key.contains("api_key")
        || key.contains("apikey")
        || key.contains("authorization")
        || key.ends_with("token")
        || key == "token"
        || key == "credential"
}

impl Drop for Redactor {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        if let Ok(secrets) = self.secrets.get_mut() {
            secrets.zeroize();
        }
    }
}

pub fn clear_value(value: &mut Value) {
    use zeroize::Zeroize;
    match value {
        Value::String(text) => text.zeroize(),
        Value::Array(values) => {
            for value in values {
                clear_value(value);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                clear_value(value);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_secret_added_later_is_removed_from_text_and_values() {
        let redactor = Redactor::new(&[]);
        redactor.add_secret("typed-api-key-123456");
        assert_eq!(
            redactor.text("error: key typed-api-key-123456 rejected"),
            "error: key [credential omitted] rejected"
        );
        assert_eq!(
            redactor.value(&json!({"message": "typed-api-key-123456"})),
            json!({"message": "[credential omitted]"})
        );
    }

    #[test]
    fn environment_variables_that_are_not_unicode_are_skipped() {
        use std::ffi::OsString;
        let mut vars = vec![
            (
                OsString::from("OLEAFLY_TEST_API_KEY"),
                OsString::from("secret-value-123456"),
            ),
            (
                OsString::from("OLEAFLY_TEST_NOTE"),
                OsString::from("not a secret"),
            ),
        ];
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            vars.push((
                OsString::from("OLDPWD"),
                OsString::from_vec(b"/caf\xe9".to_vec()),
            ));
            vars.push((
                OsString::from_vec(b"BAD\xffNAME".to_vec()),
                OsString::from("value-of-a-bad-name"),
            ));
            vars.push((
                OsString::from("OLEAFLY_TEST_TOKEN"),
                OsString::from_vec(b"secret-\xe9-token".to_vec()),
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            // An unpaired surrogate is not valid Unicode.
            let lone: Vec<u16> = "secret-".encode_utf16().chain([0xD800]).collect();
            vars.push((
                OsString::from("OLEAFLY_TEST_TOKEN"),
                OsString::from_wide(&lone),
            ));
        }
        assert_eq!(
            environment_secrets(vars.into_iter()),
            vec!["secret-value-123456".to_string()]
        );
    }

    #[test]
    fn prose_that_mentions_a_password_is_kept() {
        let redactor = Redactor::new(&[]);
        for line in [
            "The login flow works as follows: the client sends the password to the server.",
            "Section 2: password hashing",
            "Open https://aistudio.google.com/apikey to make a key.",
            "Authorization: see chapter 3",
            "He was the bearer of bad news.",
        ] {
            assert_eq!(redactor.text(line), line);
        }
    }

    #[test]
    fn only_the_assigned_credential_is_replaced() {
        let redactor = Redactor::new(&[]);
        assert_eq!(
            redactor.text("Use password = hunter2222 to log in."),
            "Use password = [credential omitted] to log in."
        );
        assert_eq!(
            redactor.text(r#"{"api_key": "abc-live-0123456789", "user": "me"}"#),
            r#"{"api_key": "[credential omitted]", "user": "me"}"#
        );
        assert_eq!(
            redactor.text("OPENAI_API_KEY=abc0123456789xyz"),
            "OPENAI_API_KEY=[credential omitted]"
        );
        assert_eq!(
            redactor.text("Authorization: Bearer abcdef0123456789"),
            "Authorization: Bearer [credential omitted]"
        );
        assert_eq!(
            redactor.text("curl -H 'bearer abcdef0123456789' https://x"),
            "curl -H 'bearer [credential omitted]' https://x"
        );
        assert_eq!(
            redactor.text("https://x.example/y?api_key=abcdef12&q=1 then"),
            "https://x.example/y?api_key=[credential omitted] then"
        );
    }

    #[test]
    fn the_longest_secret_is_known() {
        let redactor = Redactor::new(&[]);
        let before = redactor.longest_secret();
        redactor.add_secret(&"k".repeat(before + 40));
        assert_eq!(redactor.longest_secret(), before + 40);
    }

    #[test]
    fn short_values_are_not_treated_as_secrets() {
        let redactor = Redactor::new(&[]);
        redactor.add_secret("abc");
        assert_eq!(redactor.text("abc"), "abc");
    }
}
