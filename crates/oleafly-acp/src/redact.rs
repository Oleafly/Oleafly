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
                let lower = line.to_ascii_lowercase();
                let assignment = [
                    "password",
                    "api_key",
                    "api-key",
                    "apikey",
                    "access_token",
                    "refresh_token",
                    "authorization",
                    "client_secret",
                ]
                .iter()
                .any(|key| lower.contains(key))
                    && (line.contains('=') || line.contains(':'));
                if assignment || lower.contains("bearer ") {
                    "[credential omitted]".to_owned()
                } else {
                    line.split_inclusive(char::is_whitespace)
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
                        .collect()
                }
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
    fn short_values_are_not_treated_as_secrets() {
        let redactor = Redactor::new(&[]);
        redactor.add_secret("abc");
        assert_eq!(redactor.text("abc"), "abc");
    }
}
