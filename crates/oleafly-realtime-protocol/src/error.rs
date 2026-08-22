use std::fmt::{Display, Formatter};

pub type Result<T> = std::result::Result<T, ContractError>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContractError {
    InvalidIdentity { kind: &'static str, value: String },
    InvalidAuthoringDoc(String),
    InvalidCanonicalManifest(String),
    InvalidControl(String),
    InvalidFrame(String),
    InvalidMutation(String),
    InvalidUpdate(String),
}

impl Display for ContractError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidIdentity { kind, value } => {
                write!(formatter, "invalid {kind}: {value}")
            }
            Self::InvalidAuthoringDoc(message) => formatter.write_str(message),
            Self::InvalidCanonicalManifest(message) => formatter.write_str(message),
            Self::InvalidControl(message) => formatter.write_str(message),
            Self::InvalidFrame(message) => formatter.write_str(message),
            Self::InvalidMutation(message) => formatter.write_str(message),
            Self::InvalidUpdate(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ContractError {}
