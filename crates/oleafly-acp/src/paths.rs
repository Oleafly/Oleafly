//! Which paths a permission request may touch, and file URIs for
//! `resource_link` prompt blocks.
use std::path::{Component, Path};

use serde_json::Value;

pub fn equivalent_path_prefixes(left: std::path::Prefix<'_>, right: std::path::Prefix<'_>) -> bool {
    use std::path::Prefix;
    match (left, right) {
        (
            Prefix::Disk(left) | Prefix::VerbatimDisk(left),
            Prefix::Disk(right) | Prefix::VerbatimDisk(right),
        ) => left.eq_ignore_ascii_case(&right),
        (
            Prefix::UNC(left_server, left_share) | Prefix::VerbatimUNC(left_server, left_share),
            Prefix::UNC(right_server, right_share) | Prefix::VerbatimUNC(right_server, right_share),
        ) => {
            left_server.eq_ignore_ascii_case(right_server)
                && left_share.eq_ignore_ascii_case(right_share)
        }
        (left, right) => left == right,
    }
}

fn lexical_path_within(path: &Path, root: &Path) -> bool {
    let mut components = path.components();
    root.components()
        .all(|root_component| match (components.next(), root_component) {
            (Some(Component::Prefix(path)), Component::Prefix(root)) => {
                equivalent_path_prefixes(path.kind(), root.kind())
            }
            (Some(path), root) => path == root,
            (None, _) => false,
        })
}

/// Every path a permission request names: its locations and the usual path
/// fields of its raw input.
pub fn permission_paths(tool: &Value) -> impl Iterator<Item = &str> {
    tool["locations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value["path"].as_str())
        .chain(
            ["path", "file_path", "filePath", "cwd", "directory"]
                .iter()
                .filter_map(|key| tool["rawInput"][key].as_str()),
        )
}

/// Whether every path of a permission request is inside the canonical
/// `root` (the agent may spell it as `spelled_root`, for example a mapped
/// drive letter).
pub fn permission_paths_allowed(root: &Path, spelled_root: &Path, tool: &Value) -> bool {
    permission_paths(tool).all(|path| path_within(root, spelled_root, Path::new(path)))
}

/// Whether a request only reads inside the skill folder attached to the
/// turn (`folder` as the skill block names it): its kind is `read` or
/// `search` and it names at least one path, every one absolute and really
/// inside the folder (links out of it do not count).
pub fn skill_read_allowed(
    folder: &Path,
    spelled_folder: &Path,
    kind: Option<&str>,
    tool: &Value,
) -> bool {
    if !matches!(kind, Some("read" | "search")) {
        return false;
    }
    let Ok(root) = folder.canonicalize() else {
        return false;
    };
    let mut paths = permission_paths(tool).peekable();
    paths.peek().is_some()
        && paths.all(|path| {
            let path = Path::new(path);
            path.is_absolute() && path_within(&root, spelled_folder, path)
        })
}

/// Whether `path` (relative ones are joined to `root`) leads inside the
/// canonical `root`, spelled either as `root` or as `spelled`.
pub fn path_within(root: &Path, spelled: &Path, path: &Path) -> bool {
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return false;
    }
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let mut existing = candidate.as_path();
    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            return false;
        };
        existing = parent;
    }
    if !existing
        .canonicalize()
        .is_ok_and(|path| path.starts_with(root))
    {
        return false;
    }
    // The agent was started in the launch root (for example a mapped drive
    // letter), so its paths may use that spelling.
    if lexical_path_within(&candidate, root) || lexical_path_within(&candidate, spelled) {
        return true;
    }
    #[cfg(windows)]
    {
        let Some(expanded) = oleafly_core::long_path_name(existing) else {
            return false;
        };
        candidate
            .strip_prefix(existing)
            .is_ok_and(|suffix| lexical_path_within(&expanded.join(suffix), root))
    }
    #[cfg(not(windows))]
    false
}

/// A `file://` URI for an absolute path, percent-encoded, without the
/// Windows `\\?\` prefix.
pub fn file_uri(path: &Path) -> Result<String, String> {
    let plain = oleafly_core::plain_path(path);
    if !plain.is_absolute() {
        return Err("The attachment path is not absolute.".into());
    }
    url::Url::from_file_path(&plain)
        .map(|url| url.to_string())
        .map_err(|_| "The attachment path is not absolute.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parent_traversal_is_never_within() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        assert!(!path_within(&root, &root, Path::new("../x")));
        assert!(!path_within(&root, &root, Path::new("a/../../x")));
        assert!(path_within(&root, &root, Path::new("chapter/intro.tex")));
    }

    #[test]
    fn permission_paths_cover_locations_and_raw_input() {
        let tool = json!({"locations": [{"path": "a.tex"}], "rawInput": {"file_path": "b.tex", "cwd": "."}});
        let paths: Vec<&str> = permission_paths(&tool).collect();
        assert_eq!(paths, vec!["a.tex", "b.tex", "."]);
    }

    #[cfg(unix)]
    #[test]
    fn file_uris_on_unix() {
        assert_eq!(
            file_uri(Path::new("/home/a b/é.pdf")).unwrap(),
            "file:///home/a%20b/%C3%A9.pdf"
        );
        assert!(file_uri(Path::new("relative.pdf")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn file_uris_on_windows() {
        assert_eq!(
            file_uri(Path::new(r"C:\Users\A B\paper.pdf")).unwrap(),
            "file:///C:/Users/A%20B/paper.pdf"
        );
        assert_eq!(
            file_uri(Path::new(r"\\server\share\x.pdf")).unwrap(),
            "file://server/share/x.pdf"
        );
        assert_eq!(
            file_uri(Path::new(r"\\?\D:\t\é.pdf")).unwrap(),
            "file:///D:/t/%C3%A9.pdf"
        );
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_and_plain_drive_prefixes_are_the_same_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let plain = oleafly_core::plain_path(&root);
        std::fs::create_dir(root.join("ch 1")).unwrap();
        assert!(path_within(
            &root,
            &plain,
            &plain.join("ch 1").join("é.tex")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn a_unc_root_matches_its_verbatim_form() {
        use std::path::Prefix;
        let verbatim = Path::new(r"\\?\UNC\server\share\p");
        let plain = Path::new(r"\\server\share\p");
        let (Some(Component::Prefix(left)), Some(Component::Prefix(right))) =
            (verbatim.components().next(), plain.components().next())
        else {
            panic!("UNC paths have prefixes");
        };
        assert!(matches!(left.kind(), Prefix::VerbatimUNC(..)));
        assert!(equivalent_path_prefixes(left.kind(), right.kind()));
    }
}
