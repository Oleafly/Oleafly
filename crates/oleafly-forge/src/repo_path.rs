//! Repository paths (`owner/repo`, or GitLab's `group/sub/repo`) and new
//! repository names, checked before they reach a URL.
use crate::{ForgeError, ForgeKind};

/// GitLab nests groups up to 20 levels deep, plus the project.
const GITLAB_MAX_SEGMENTS: usize = 21;
const SEGMENT_MAX_LEN: usize = 255;
const NAME_MAX_LEN: usize = 100;

fn plain_name_bytes(text: &str) -> bool {
    text.bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepoPath {
    segments: Vec<String>,
}

impl RepoPath {
    /// GitHub and Gitea take exactly `owner/repo`; GitLab takes two to 21
    /// segments. Each segment is 1 to 255 letters, digits, dots, dashes or
    /// underscores, never `.` or `..`, never ending in `.git` or `.atom`.
    pub fn parse(kind: ForgeKind, full_name: &str) -> Result<RepoPath, ForgeError> {
        let segments: Vec<&str> = full_name.split('/').collect();
        let count_ok = match kind {
            ForgeKind::GitHub | ForgeKind::Gitea => segments.len() == 2,
            ForgeKind::GitLab => (2..=GITLAB_MAX_SEGMENTS).contains(&segments.len()),
        };
        let segment_ok = |segment: &&str| {
            !segment.is_empty()
                && segment.len() <= SEGMENT_MAX_LEN
                && *segment != "."
                && *segment != ".."
                && !segment.ends_with(".git")
                && !segment.ends_with(".atom")
                && plain_name_bytes(segment)
        };
        if !count_ok || !segments.iter().all(segment_ok) {
            return Err(ForgeError::InvalidRepository);
        }
        Ok(RepoPath {
            segments: segments.into_iter().map(str::to_string).collect(),
        })
    }

    pub fn full_name(&self) -> String {
        self.segments.join("/")
    }

    /// The repository's own name, the last segment.
    pub fn name(&self) -> &str {
        self.segments.last().map(String::as_str).unwrap_or_default()
    }

    pub fn segments(&self) -> &[String] {
        &self.segments
    }
}

/// A name for a new repository: 1 to 100 letters, digits, dots, dashes or
/// underscores, not `.` or `..`, not ending in `.git`.
pub fn valid_repo_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= NAME_MAX_LEN
        && name != "."
        && name != ".."
        && !name.ends_with(".git")
        && plain_name_bytes(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_paths_accept_nested_groups_only_on_gitlab() {
        let nested = RepoPath::parse(ForgeKind::GitLab, "group/sub/paper").unwrap();
        assert_eq!(nested.full_name(), "group/sub/paper");
        assert_eq!(nested.name(), "paper");
        for kind in [ForgeKind::GitHub, ForgeKind::Gitea] {
            assert!(RepoPath::parse(kind, "group/sub/paper").is_err());
            assert!(RepoPath::parse(kind, "owner/paper.v2").is_ok());
        }
        for bad in [
            "owner/..",
            "owner/repo?x",
            "owner/repo.git",
            "owner/",
            "/repo",
            "owner",
            "a/b c",
        ] {
            assert!(RepoPath::parse(ForgeKind::GitLab, bad).is_err(), "{bad}");
        }
        let deep = vec!["g"; 22].join("/");
        assert!(RepoPath::parse(ForgeKind::GitLab, &deep).is_err());
        let deepest = vec!["g"; 21].join("/");
        assert!(RepoPath::parse(ForgeKind::GitLab, &deepest).is_ok());
    }

    #[test]
    fn new_repository_names_are_plain() {
        for good in ["paper", "thesis-2026", "my_paper.v2"] {
            assert!(valid_repo_name(good), "{good}");
        }
        let long = "a".repeat(101);
        for bad in ["", ".", "..", "paper.git", "my paper", "a/b", long.as_str()] {
            assert!(!valid_repo_name(bad), "{bad}");
        }
    }
}
