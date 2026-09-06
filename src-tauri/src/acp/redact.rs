use serde_json::Value;

pub struct Redactor {
    secrets: Vec<String>,
}

impl Redactor {
    pub fn new(extra: &[Value]) -> Self {
        let mut secrets: Vec<String> = std::env::vars()
            .filter(|(name, value)| sensitive_key(name) && value.len() >= 6)
            .map(|(_, value)| value)
            .collect();
        fn collect(value: &Value, secrets: &mut Vec<String>) {
            match value {
                Value::Object(map) => {
                    for (name, value) in map {
                        if sensitive_key(name) || name == "value" {
                            if let Some(text) = value.as_str() {
                                if text.len() >= 6 {
                                    secrets.push(text.into());
                                    if text.get(..7).is_some_and(|prefix| {
                                        prefix.eq_ignore_ascii_case("Bearer ")
                                    }) {
                                        secrets.push(text[7..].into());
                                    }
                                }
                            }
                        }
                        collect(value, secrets);
                    }
                }
                Value::Array(values) => {
                    for value in values {
                        collect(value, secrets);
                    }
                }
                _ => {}
            }
        }
        for value in extra {
            collect(value, &mut secrets);
        }
        secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
        secrets.dedup();
        Self { secrets }
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
        for secret in &self.secrets {
            output = output.replace(secret, "[credential omitted]");
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
        self.secrets.zeroize();
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
