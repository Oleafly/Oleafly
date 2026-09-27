use crate::project::{rel_slash, FileEntry, MAX_WALK_DEPTH};
use std::collections::VecDeque;
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

pub(crate) const LINKED_LISTING_LIMIT: usize = 20_000;
const READ_ONLY_LINK_EXTENSIONS: [&str; 3] = ["bib", "sty", "cls"];

#[derive(Default)]
pub(crate) struct FolderListing {
    pub(crate) entries: Vec<FileEntry>,
    pub(crate) truncated: bool,
    pub(crate) unreadable: Vec<(String, String)>,
}

struct PendingFolder {
    path: PathBuf,
    entry: Option<usize>,
    depth: usize,
}

fn hidden_from_listing(name: &OsStr) -> bool {
    name.eq_ignore_ascii_case(".git")
        || name
            .to_str()
            .is_some_and(crate::checkpoint_capture::is_oleafly_owned)
}

fn has_resource_extension(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            READ_ONLY_LINK_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn outside_resource(root: &Path, link: &Path) -> Option<PathBuf> {
    let is_link =
        std::fs::symlink_metadata(link).is_ok_and(|metadata| metadata.file_type().is_symlink());
    if !is_link || !has_resource_extension(link) {
        return None;
    }
    let resolved = link.canonicalize().ok()?;
    let target = std::fs::metadata(&resolved).ok()?;
    (target.is_file() && has_resource_extension(&resolved) && !resolved.starts_with(root))
        .then_some(resolved)
}

pub(crate) fn outbound_resource_link(root: &Path, relative: &str) -> Option<PathBuf> {
    let relative_path = Path::new(relative);
    if relative.contains('\\')
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    let folder = match relative_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        Some(parent) => crate::sandbox::resolve_within(root, &parent.to_string_lossy()).ok()?,
        None => root.to_path_buf(),
    };
    let canonical = folder.canonicalize().ok()?;
    if canonical != folder || !canonical.starts_with(root) {
        return None;
    }
    outside_resource(root, &folder.join(relative_path.file_name()?))
}

pub(crate) fn list_linked_folder(root: &Path, limit: usize) -> Result<FolderListing, String> {
    let mut listing = FolderListing::default();
    let mut pending = VecDeque::from([PendingFolder {
        path: root.to_path_buf(),
        entry: None,
        depth: 0,
    }]);
    while let Some(folder) = pending.pop_front() {
        let entries = match std::fs::read_dir(&folder.path) {
            Ok(entries) => entries,
            Err(error) => match folder.entry {
                None => return Err(error.to_string()),
                Some(index) => {
                    let entry = &mut listing.entries[index];
                    entry.unreadable = true;
                    listing
                        .unreadable
                        .push((entry.path.clone(), error.to_string()));
                    continue;
                }
            },
        };
        let mut items: Vec<_> = entries.filter_map(Result::ok).collect();
        items.sort_by_key(std::fs::DirEntry::file_name);
        for item in items {
            let name = item.file_name();
            if hidden_from_listing(&name) {
                continue;
            }
            let file_type = item.file_type();
            let path = item.path();
            let read_only_link = match &file_type {
                Ok(file_type) if file_type.is_symlink() => {
                    if outside_resource(root, &path).is_none() {
                        continue;
                    }
                    true
                }
                Ok(file_type)
                    if file_type.is_dir() && oleafly_core::is_skipped_scan_directory(&name) =>
                {
                    continue;
                }
                _ => false,
            };
            if listing.entries.len() >= limit {
                listing.truncated = true;
                let unfinished = pending.iter().filter_map(|remaining| remaining.entry);
                for index in folder.entry.into_iter().chain(unfinished) {
                    listing.entries[index].partial = true;
                }
                return Ok(listing);
            }
            let relative = rel_slash(root, &path);
            if read_only_link {
                let mut entry = FileEntry::new(relative, false);
                entry.read_only = true;
                listing.entries.push(entry);
                continue;
            }
            let Ok(file_type) = file_type else {
                let mut entry = FileEntry::new(relative, false);
                entry.unreadable = true;
                listing.entries.push(entry);
                continue;
            };
            let mut entry = FileEntry::new(relative, file_type.is_dir());
            if !file_type.is_dir() {
                entry.placeholder = item
                    .metadata()
                    .is_ok_and(|metadata| crate::cloud_files::is_placeholder(&path, &metadata));
                listing.entries.push(entry);
                continue;
            }
            if folder.depth + 1 >= MAX_WALK_DEPTH {
                entry.partial = true;
                listing.entries.push(entry);
                listing.truncated = true;
                continue;
            }
            listing.entries.push(entry);
            pending.push_back(PendingFolder {
                path,
                entry: Some(listing.entries.len() - 1),
                depth: folder.depth + 1,
            });
        }
    }
    Ok(listing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listed(listing: &FolderListing) -> Vec<(&str, bool, bool)> {
        listing
            .entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.is_dir, entry.unreadable))
            .collect()
    }

    fn write(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn a_linked_listing_uses_the_shared_skip_list_and_hides_oleafly_scratch_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        write(&root, "main.tex", "\\documentclass{article}");
        write(&root, "chapters/intro.tex", "intro");
        write(&root, "node_modules/pkg/index.js", "x");
        write(&root, "build/main.pdf", "pdf");
        write(&root, "_minted-main/cache.pyg", "x");
        write(&root, ".git/config", "[core]");
        write(&root, ".oleafly/build/main.pdf", "pdf");
        write(&root, ".vscode/settings.json", "{}");
        write(&root, ".latexmkrc", "$pdf_mode = 1;");
        write(
            &root,
            ".main.tex.oleafly-42-7-00ff00ff00ff00ff.tmp",
            "partial",
        );
        std::fs::create_dir(root.join(".oleafly-import-42-0")).unwrap();

        let listing = list_linked_folder(&root, LINKED_LISTING_LIMIT).unwrap();

        assert_eq!(
            listed(&listing),
            [
                (".latexmkrc", false, false),
                ("chapters", true, false),
                ("main.tex", false, false),
                ("chapters/intro.tex", false, false),
            ]
        );
        assert!(!listing.truncated);
    }

    #[test]
    fn a_linked_listing_is_breadth_first_and_stops_at_its_bound() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        write(&root, "a/b/c/deep.tex", "deep");
        write(&root, "a/shallow.tex", "shallow");
        write(&root, "main.tex", "main");
        write(&root, "z.tex", "z");

        let listing = list_linked_folder(&root, 5).unwrap();

        assert_eq!(
            listed(&listing),
            [
                ("a", true, false),
                ("main.tex", false, false),
                ("z.tex", false, false),
                ("a/b", true, false),
                ("a/shallow.tex", false, false),
            ]
        );
        assert!(listing.truncated);

        let exact = list_linked_folder(&root, 7).unwrap();
        assert_eq!(exact.entries.len(), 7);
        assert!(!exact.truncated);
        assert!(exact.entries.iter().all(|entry| !entry.partial));
    }

    #[test]
    fn folders_the_bound_cut_short_are_flagged() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        write(&root, "a/one.tex", "one");
        write(&root, "a/two.tex", "two");
        write(&root, "b/three.tex", "three");
        write(&root, "c/four.tex", "four");
        write(&root, "main.tex", "main");

        let listing = list_linked_folder(&root, 5).unwrap();

        let flagged: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.partial))
            .collect();
        assert_eq!(
            flagged,
            [
                ("a", true),
                ("b", true),
                ("c", true),
                ("main.tex", false),
                ("a/one.tex", false),
            ]
        );
        assert!(listing.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_folder_is_listed_as_an_unreadable_node() {
        use std::os::unix::fs::PermissionsExt as _;
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        write(&root, "main.tex", "main");
        write(&root, "locked/secret.tex", "secret");
        write(&root, "open/notes.md", "notes");
        let locked = root.join("locked");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read_dir(&locked).is_ok() {
            std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
            eprintln!("skipping: this user can read a folder with mode 000");
            return;
        }

        let listing = list_linked_folder(&root, LINKED_LISTING_LIMIT);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
        let listing = listing.unwrap();

        assert_eq!(
            listed(&listing),
            [
                ("locked", true, true),
                ("main.tex", false, false),
                ("open", true, false),
                ("open/notes.md", false, false),
            ]
        );
        assert_eq!(listing.unreadable.len(), 1);
        assert_eq!(listing.unreadable[0].0, "locked");
    }

    #[test]
    fn a_cloud_placeholder_is_listed_and_flagged_without_being_opened() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        write(&root, "main.tex", "main");
        write(&root, "evicted.tex", "cloud");
        crate::cloud_files::test_support::mark(&root.join("evicted.tex"));

        let listing = list_linked_folder(&root, LINKED_LISTING_LIMIT).unwrap();

        let flagged: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.placeholder))
            .collect();
        assert_eq!(flagged, [("evicted.tex", true), ("main.tex", false)]);
    }

    #[cfg(unix)]
    #[test]
    fn an_outbound_bibliography_link_is_listed_read_only_and_other_links_stay_hidden() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let zotero = outside.path().canonicalize().unwrap();
        write(&zotero, "My Library.bib", "@misc{a}");
        write(&zotero, "theme.sty", "\\ProvidesPackage{theme}");
        write(&zotero, "notes.tex", "notes");
        write(&root, "local.bib", "@misc{b}");
        symlink(zotero.join("My Library.bib"), root.join("refs.bib")).unwrap();
        symlink(zotero.join("theme.sty"), root.join("theme.STY")).unwrap();
        symlink(zotero.join("notes.tex"), root.join("notes.tex")).unwrap();
        symlink(root.join("local.bib"), root.join("inside.bib")).unwrap();
        symlink(&zotero, root.join("shared")).unwrap();
        symlink(zotero.join("missing.bib"), root.join("dangling.bib")).unwrap();
        std::fs::create_dir(zotero.join("folder.bib")).unwrap();
        symlink(zotero.join("folder.bib"), root.join("folder.bib")).unwrap();

        let listing = list_linked_folder(&root, LINKED_LISTING_LIMIT).unwrap();

        let flagged: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.is_dir, entry.read_only))
            .collect();
        assert_eq!(
            flagged,
            [
                ("local.bib", false, false),
                ("refs.bib", false, true),
                ("theme.STY", false, true),
            ]
        );
        assert_eq!(
            outbound_resource_link(&root, "refs.bib"),
            Some(zotero.join("My Library.bib"))
        );
        for refused in [
            "notes.tex",
            "inside.bib",
            "shared",
            "dangling.bib",
            "folder.bib",
            "local.bib",
            "../refs.bib",
            "/refs.bib",
        ] {
            assert_eq!(outbound_resource_link(&root, refused), None, "{refused}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_only_a_resource_when_the_file_it_reaches_is_one() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let home = outside.path().canonicalize().unwrap();
        write(&home, ".ssh/id_ed25519", "secret key");
        write(&home, "notes.txt", "private");
        write(&home, "Zotero/My Library.bib", "@misc{a}");
        symlink(home.join(".ssh/id_ed25519"), home.join("alias.bib")).unwrap();
        symlink(home.join(".ssh/id_ed25519"), root.join("refs.bib")).unwrap();
        symlink(home.join("notes.txt"), root.join("theme.sty")).unwrap();
        symlink(home.join("alias.bib"), root.join("chain.bib")).unwrap();
        symlink(home.join("Zotero/My Library.bib"), root.join("zotero.bib")).unwrap();

        let listing = list_linked_folder(&root, LINKED_LISTING_LIMIT).unwrap();

        let listed: Vec<_> = listing
            .entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.read_only))
            .collect();
        assert_eq!(listed, [("zotero.bib", true)]);
        for refused in ["refs.bib", "theme.sty", "chain.bib"] {
            assert_eq!(outbound_resource_link(&root, refused), None, "{refused}");
        }
        assert_eq!(
            outbound_resource_link(&root, "zotero.bib"),
            Some(home.join("Zotero/My Library.bib"))
        );
    }

    #[test]
    fn a_missing_root_is_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("gone");
        assert!(list_linked_folder(&missing, LINKED_LISTING_LIMIT).is_err());
    }
}
