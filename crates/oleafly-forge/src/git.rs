use std::path::Path;

pub const MIN_TOKEN_LEN: usize = 8;

pub fn valid_token(token: &str) -> bool {
    token.len() >= MIN_TOKEN_LEN && oleafly_secrets::accounts::valid_forge_token(token)
}

pub fn git_config_path(path: &Path) -> String {
    git_config_path_for(&path.to_string_lossy(), cfg!(windows))
}

/// Git for Windows reads `C:/dir/file` and `//server/share/file`; a
/// backslash in a `-c` value would need escaping, so Windows paths use
/// forward slashes. Other platforms keep the path as it is.
pub fn git_config_path_for(path: &str, windows: bool) -> String {
    if windows {
        path.replace('\\', "/")
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_with_spaces_quotes_or_control_characters_are_refused() {
        let hex40 = "0123456789abcdef0123456789abcdef01234567";
        for good in ["ghp_abc123DEF456", "glpat-AbCd_1234-xyz", hex40] {
            assert!(valid_token(good), "{good}");
        }
        let long = "a".repeat(4097);
        for bad in [
            "",
            "short",
            "a b c d e f",
            "tok\"en12",
            "tok'en12",
            "tok\\en12",
            "tok\nen12",
            long.as_str(),
        ] {
            assert!(!valid_token(bad), "{bad:?}");
        }
    }

    #[test]
    fn windows_git_config_paths_use_forward_slashes() {
        assert_eq!(
            git_config_path_for(r"C:\Users\Zoë Q\certs\corp ca.pem", true),
            "C:/Users/Zoë Q/certs/corp ca.pem"
        );
        assert_eq!(
            git_config_path_for(r"\\srv\share\corp ca.pem", true),
            "//srv/share/corp ca.pem"
        );
        assert_eq!(
            git_config_path_for("/home/zoë/certs/corp ca.pem", false),
            "/home/zoë/certs/corp ca.pem"
        );
    }
}
