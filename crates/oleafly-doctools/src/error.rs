#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocError {
    pub code: &'static str,
    pub message: String,
    pub params: Vec<(&'static str, String)>,
}

impl DocError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            params: Vec::new(),
        }
    }

    pub fn param(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.params.push((key, value.into()));
        self
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self::new("doc.failed", message)
    }
}

impl std::fmt::Display for DocError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for DocError {}

impl From<String> for DocError {
    fn from(message: String) -> Self {
        Self::other(message)
    }
}

impl From<&str> for DocError {
    fn from(message: &str) -> Self {
        Self::other(message)
    }
}

impl From<std::io::Error> for DocError {
    fn from(error: std::io::Error) -> Self {
        Self::other(error.to_string())
    }
}
