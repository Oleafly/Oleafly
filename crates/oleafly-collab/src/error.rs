use oleafly_collab_protocol::capabilities::VersionMismatch;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CollabError {
    #[error("file error: {0}")]
    Io(String),
    #[error("collaboration state is damaged: {0}")]
    Corrupt(String),
    #[error("secret store error: {0}")]
    Secret(String),
    #[error("cryptography error: {0}")]
    Crypto(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("the server address must use https")]
    NotHttps,
    #[error("protocol versions do not overlap: {0:?}")]
    ProtocolMismatch(VersionMismatch),
    #[error("server returned {status} {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
    },
    #[error("sign-in was cancelled")]
    SignInCancelled,
    #[error("sign-in timed out")]
    SignInTimedOut,
    #[error("this server has not admitted the account")]
    NotAdmitted,
    #[error("the session is no longer authorized")]
    Unauthorized,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_render_readable_messages() {
        assert_eq!(
            CollabError::Io("disk full".to_string()).to_string(),
            "file error: disk full"
        );
        assert_eq!(
            CollabError::ProtocolMismatch(VersionMismatch::ServerTooOld).to_string(),
            "protocol versions do not overlap: ServerTooOld"
        );
        assert_eq!(
            CollabError::Api {
                status: 403,
                code: "forbidden".to_string(),
                message: "no".to_string(),
            }
            .to_string(),
            "server returned 403 forbidden: no"
        );
        assert_eq!(
            CollabError::NotHttps.to_string(),
            "the server address must use https"
        );
    }

    #[test]
    fn errors_are_comparable_cloneable_and_boxable() {
        let error = CollabError::Corrupt("binding.json".to_string());
        assert_eq!(error.clone(), error);
        assert_ne!(error, CollabError::Corrupt("file-ids.json".to_string()));
        let boxed: Box<dyn std::error::Error + Send + Sync> = Box::new(CollabError::Unauthorized);
        assert_eq!(boxed.to_string(), "the session is no longer authorized");
    }
}
