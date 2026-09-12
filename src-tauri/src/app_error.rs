use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

pub const PREFIX: &str = "@oleafly/error:";

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub params: BTreeMap<String, String>,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
            detail: None,
        }
    }

    pub fn param(mut self, name: &str, value: impl ToString) -> Self {
        self.params.insert(name.to_string(), value.to_string());
        self
    }

    pub fn detail(mut self, detail: impl ToString) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let json = serde_json::to_string(self).map_err(|_| fmt::Error)?;
        write!(f, "{PREFIX}{json}")
    }
}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_the_frontend_prefix() {
        let text: String = AppError::new("project.name_conflict")
            .param("name", "Thesis")
            .detail("existing folder")
            .into();
        assert!(text.starts_with(PREFIX));
        let json: serde_json::Value = serde_json::from_str(&text[PREFIX.len()..]).unwrap();
        assert_eq!(json["code"], "project.name_conflict");
        assert_eq!(json["params"]["name"], "Thesis");
        assert_eq!(json["detail"], "existing folder");
    }

    #[test]
    fn escapes_untrusted_params() {
        let text: String = AppError::new("x").param("v", "a\"b\\c\n").into();
        assert!(serde_json::from_str::<serde_json::Value>(&text[PREFIX.len()..]).is_ok());
    }
}
