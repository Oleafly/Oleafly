use std::path::{Component, Path};

pub const EXCLUDE_POLICY_VERSION: u32 = 1;
pub const MAX_SYNC_FILE_BYTES: u64 = 16 * 1024 * 1024 * 1024;

pub const BUILD_ARTIFACT_PATTERNS: &[&str] = &[
    "*.aux",
    "*.log",
    "*.out",
    "*.toc",
    "*.blg",
    "*.bcf",
    "*.run.xml",
    "*.fls",
    "*.fdb_latexmk",
    "*.synctex.gz",
    "*.synctex(busy)",
    "*.nav",
    "*.snm",
    "*.vrb",
    "*.lof",
    "*.lot",
    "*.idx",
    "*.ilg",
    "*.ind",
    "*.xdv",
];

const ENGINE_STATE_DIRECTORIES: [&str; 1] = [".quarto"];

const NOTEBOOK_FIGURES_SUFFIX: &str = "_files";

const NOTEBOOK_SOURCE_EXTENSIONS: [&str; 3] = ["qmd", "Rmd", "rmd"];

const OS_METADATA_FILES: [&str; 5] = [
    ".DS_Store",
    "Thumbs.db",
    "ehthumbs.db",
    "desktop.ini",
    "Icon\r",
];

pub fn starts_with_ignoring_case(name: &str, prefix: &str) -> bool {
    name.as_bytes()
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix.as_bytes()))
}

pub fn is_oleafly_owned_name(name: &str) -> bool {
    starts_with_ignoring_case(name, ".oleafly")
        || (name.starts_with('.') && name.ends_with(".tmp") && name.contains(".oleafly-"))
}

pub fn is_os_metadata_name(name: &str) -> bool {
    name.starts_with("._")
        || OS_METADATA_FILES
            .iter()
            .any(|junk| name.eq_ignore_ascii_case(junk))
}

pub fn is_editor_temp_name(name: &str) -> bool {
    name.ends_with(".swp")
        || name.ends_with('~')
        || name.starts_with(".#")
        || name.starts_with("~$")
        || (name.starts_with(".~lock.") && name.ends_with('#'))
}

pub fn is_cloud_client_artifact_name(name: &str) -> bool {
    name.contains(" (conflicted copy ")
        || name.contains(".sync-conflict-")
        || starts_with_ignoring_case(name, ".dropbox")
        || name.ends_with(".icloud")
}

pub fn is_quietly_ignored_name(name: &str) -> bool {
    is_oleafly_owned_name(name)
        || is_os_metadata_name(name)
        || is_editor_temp_name(name)
        || is_cloud_client_artifact_name(name)
}

pub fn is_engine_state_directory(name: &str) -> bool {
    ENGINE_STATE_DIRECTORIES
        .iter()
        .any(|directory| name.eq_ignore_ascii_case(directory))
}

pub fn is_notebook_figures_folder(relative_path: &str, has_sibling: impl Fn(&str) -> bool) -> bool {
    let normalized = relative_path.replace('\\', "/");
    let normalized = normalized.trim_matches('/');
    let (folder, name) = match normalized.rsplit_once('/') {
        Some((folder, name)) => (Some(folder), name),
        None => (None, normalized),
    };
    let Some(stem) = name
        .strip_suffix(NOTEBOOK_FIGURES_SUFFIX)
        .filter(|stem| !stem.is_empty())
    else {
        return false;
    };
    NOTEBOOK_SOURCE_EXTENSIONS.iter().any(|extension| {
        has_sibling(&match folder {
            Some(folder) => format!("{folder}/{stem}.{extension}"),
            None => format!("{stem}.{extension}"),
        })
    })
}

pub fn is_generated_folder(relative_path: &str, has_sibling: impl Fn(&str) -> bool) -> bool {
    let normalized = relative_path.replace('\\', "/");
    let name = normalized
        .trim_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default();
    is_engine_state_directory(name) || is_notebook_figures_folder(&normalized, has_sibling)
}

pub fn is_capture_excluded_component(component: &str) -> bool {
    if [".git", ".oleafly", "node_modules"]
        .iter()
        .any(|name| component.eq_ignore_ascii_case(name))
        || is_engine_state_directory(component)
    {
        return true;
    }
    ["_minted-", "pythontex-files-"].iter().any(|prefix| {
        let component = component.as_bytes();
        let prefix = prefix.as_bytes();
        component.len() > prefix.len() && component[..prefix.len()].eq_ignore_ascii_case(prefix)
    })
}

pub fn is_linked_skipped_directory(name: &str) -> bool {
    name.starts_with('.')
        || ["node_modules", "target", "build", "out", "__MACOSX"]
            .iter()
            .any(|skipped| name.eq_ignore_ascii_case(skipped))
        || ["_minted", "pythontex-files-"]
            .iter()
            .any(|prefix| starts_with_ignoring_case(name, prefix))
}

pub fn is_scan_skipped_directory(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "build" | "out" | "__MACOSX" | "svg-inkscape"
        )
        || name.starts_with("_minted")
        || name.starts_with("pythontex-files-")
}

pub fn is_build_artifact(relative_path: &str, has_sibling: impl Fn(&str) -> bool) -> bool {
    let normalized = relative_path.replace('\\', "/");
    let (folder, name) = match normalized.rsplit_once('/') {
        Some((folder, name)) => (Some(folder), name),
        None => (None, normalized.as_str()),
    };
    let lower = name.to_ascii_lowercase();
    if BUILD_ARTIFACT_PATTERNS.iter().any(|pattern| {
        pattern
            .strip_prefix('*')
            .is_some_and(|suffix| lower.ends_with(suffix))
    }) {
        return true;
    }
    let Some(stem) = name
        .len()
        .checked_sub(4)
        .filter(|_| lower.ends_with(".pdf"))
        .map(|end| &name[..end])
    else {
        return false;
    };
    ["tex", "typ"].into_iter().any(|extension| {
        has_sibling(&match folder {
            Some(folder) => format!("{folder}/{stem}.{extension}"),
            None => format!("{stem}.{extension}"),
        })
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntryInfo {
    pub kind: EntryKind,
    pub len: u64,
    pub placeholder: bool,
    pub git_tracked: bool,
    pub git_pointer_inside: Option<bool>,
}

impl EntryInfo {
    pub fn file(len: u64) -> Self {
        Self {
            kind: EntryKind::File,
            len,
            placeholder: false,
            git_tracked: false,
            git_pointer_inside: None,
        }
    }

    pub fn directory() -> Self {
        Self {
            kind: EntryKind::Directory,
            ..Self::file(0)
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PolicyFields<'a> {
    pub main_doc: &'a str,
    pub sync_include: &'a [String],
    pub sync_exclude: &'a [String],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SkipReason {
    BuildOutput,
    Reinstallable,
    ZipLeftovers,
    Symlink,
    SpecialFile,
    NonUtf8Name,
    TooLarge,
    ExcludedByUser,
    OutsideGitPointer,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Decision {
    Include,
    Ignore,
    Skip(SkipReason),
    Hold,
    Git,
}

fn listed(list: &[String], portable: &str) -> bool {
    list.iter().any(|entry| {
        let entry = entry.replace('\\', "/");
        let entry = entry.trim_matches('/');
        !entry.is_empty()
            && (portable == entry
                || portable
                    .strip_prefix(entry)
                    .is_some_and(|rest| rest.starts_with('/')))
    })
}

fn is_main_pdf(portable: &str, main_doc: &str) -> bool {
    let main_doc = main_doc.replace('\\', "/");
    let Some(stem) = main_doc.rsplit_once('.').map(|(stem, _)| stem) else {
        return false;
    };
    portable.len() == stem.len() + 4
        && portable.starts_with(stem)
        && portable[stem.len()..].eq_ignore_ascii_case(".pdf")
}

fn is_helper_output_component(name: &str) -> bool {
    starts_with_ignoring_case(name, "_minted-")
        || starts_with_ignoring_case(name, "pythontex-files-")
        || name.eq_ignore_ascii_case("svg-inkscape")
        || is_engine_state_directory(name)
}

pub fn decide(relative: &Path, entry: &EntryInfo, fields: &PolicyFields<'_>) -> Decision {
    decide_with_siblings(relative, entry, fields, |_| false)
}

pub fn decide_with_siblings(
    relative: &Path,
    entry: &EntryInfo,
    fields: &PolicyFields<'_>,
    has_sibling: impl Fn(&str) -> bool,
) -> Decision {
    let mut components: Vec<&str> = Vec::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Decision::Skip(SkipReason::NonUtf8Name);
        };
        let Some(part) = part.to_str() else {
            return if components
                .first()
                .is_some_and(|first| first.eq_ignore_ascii_case(".git"))
            {
                Decision::Git
            } else {
                Decision::Skip(SkipReason::NonUtf8Name)
            };
        };
        components.push(part);
    }
    if components.is_empty() {
        return Decision::Include;
    }
    let portable = components.join("/");
    let name = components[components.len() - 1];

    if name.eq_ignore_ascii_case(".git") && entry.kind == EntryKind::File {
        return match entry.git_pointer_inside {
            Some(true) => Decision::Include,
            _ => Decision::Skip(SkipReason::OutsideGitPointer),
        };
    }
    if components
        .iter()
        .any(|part| part.eq_ignore_ascii_case(".git"))
    {
        return Decision::Git;
    }
    if is_quietly_ignored_name(name) || components.iter().any(|part| is_oleafly_owned_name(part)) {
        return Decision::Ignore;
    }

    let overridden = entry.git_tracked || listed(fields.sync_include, &portable);
    if !overridden {
        let folders = if entry.kind == EntryKind::Directory {
            components.len()
        } else {
            components.len() - 1
        };
        let build_output = components
            .iter()
            .any(|part| is_helper_output_component(part))
            || (1..=folders).any(|end| {
                components[end - 1].ends_with(NOTEBOOK_FIGURES_SUFFIX)
                    && is_notebook_figures_folder(&components[..end].join("/"), &has_sibling)
            })
            || (entry.kind == EntryKind::File
                && (is_build_artifact(&portable, |_| false)
                    || is_main_pdf(&portable, fields.main_doc)));
        if build_output {
            return Decision::Skip(SkipReason::BuildOutput);
        }
        if components
            .iter()
            .any(|part| part.eq_ignore_ascii_case("node_modules"))
        {
            return Decision::Skip(SkipReason::Reinstallable);
        }
        if components
            .iter()
            .any(|part| part.eq_ignore_ascii_case("__MACOSX"))
        {
            return Decision::Skip(SkipReason::ZipLeftovers);
        }
    }

    match entry.kind {
        EntryKind::Symlink => return Decision::Skip(SkipReason::Symlink),
        EntryKind::Other => return Decision::Skip(SkipReason::SpecialFile),
        EntryKind::File | EntryKind::Directory => {}
    }
    if entry.kind == EntryKind::File && entry.len > MAX_SYNC_FILE_BYTES {
        return Decision::Skip(SkipReason::TooLarge);
    }
    if listed(fields.sync_exclude, &portable) {
        return Decision::Skip(SkipReason::ExcludedByUser);
    }
    if entry.placeholder {
        return Decision::Hold;
    }
    Decision::Include
}

#[cfg(test)]
mod tests {
    use super::{
        decide, decide_with_siblings, is_build_artifact, is_capture_excluded_component,
        is_generated_folder, is_linked_skipped_directory, is_notebook_figures_folder,
        is_scan_skipped_directory, Decision, EntryInfo, EntryKind, PolicyFields, SkipReason,
        MAX_SYNC_FILE_BYTES,
    };
    use std::path::Path;

    fn fields() -> PolicyFields<'static> {
        PolicyFields {
            main_doc: "chapters/main.tex",
            sync_include: &[],
            sync_exclude: &[],
        }
    }

    fn file(path: &str) -> Decision {
        decide(Path::new(path), &EntryInfo::file(10), &fields())
    }

    #[test]
    fn ordinary_and_dot_files_sync_and_git_goes_to_the_git_layer() {
        assert_eq!(file("main.tex"), Decision::Include);
        assert_eq!(file(".vscode/settings.json"), Decision::Include);
        assert_eq!(file(".latexmkrc"), Decision::Include);
        assert_eq!(file("refs.bbl"), Decision::Include);
        assert_eq!(file("figures/plot.pdf"), Decision::Include);
        assert_eq!(file("build-notes/plan.md"), Decision::Include);
        assert_eq!(
            decide(Path::new(".git"), &EntryInfo::directory(), &fields()),
            Decision::Git
        );
        assert_eq!(file(".git/config"), Decision::Git);
        assert_eq!(
            decide(
                Path::new("vendor/sub/.git"),
                &EntryInfo::directory(),
                &fields()
            ),
            Decision::Git
        );
        let inside = EntryInfo {
            git_pointer_inside: Some(true),
            ..EntryInfo::file(10)
        };
        assert_eq!(
            decide(Path::new("vendor/sub/.git"), &inside, &fields()),
            Decision::Include
        );
        let outside = EntryInfo {
            git_pointer_inside: Some(false),
            ..EntryInfo::file(10)
        };
        assert_eq!(
            decide(Path::new("vendor/sub/.git"), &outside, &fields()),
            Decision::Skip(SkipReason::OutsideGitPointer)
        );
        assert_eq!(
            decide(
                Path::new("vendor/sub/.git"),
                &EntryInfo::file(10),
                &fields()
            ),
            Decision::Skip(SkipReason::OutsideGitPointer)
        );
    }

    #[test]
    fn junk_is_ignored_quietly() {
        for path in [
            ".oleafly/build/main.aux",
            ".oleafly-staging",
            ".DS_Store",
            "._main.tex",
            "Thumbs.db",
            "main.tex~",
            "notes.swp",
            ".#main.tex",
            "~$report.docx",
            "paper (conflicted copy 2).tex",
            "paper.sync-conflict-2026.tex",
            ".dropbox.cache",
            "photo.icloud",
            ".main.oleafly-3.tmp",
        ] {
            assert_eq!(file(path), Decision::Ignore, "{path}");
        }
    }

    #[test]
    fn build_output_is_decided_from_the_project_settings_and_can_be_overridden() {
        assert_eq!(
            file("build/main.aux"),
            Decision::Skip(SkipReason::BuildOutput)
        );
        assert_eq!(file("build/custom.dat"), Decision::Include);
        assert_eq!(file("chapters/main.tex"), Decision::Include);
        assert_eq!(file("chapters/figures/plot.png"), Decision::Include);
        assert_eq!(file("main.log"), Decision::Skip(SkipReason::BuildOutput));
        assert_eq!(
            file("chapters/main.pdf"),
            Decision::Skip(SkipReason::BuildOutput)
        );
        assert_eq!(file("chapters/other.pdf"), Decision::Include);
        assert_eq!(
            file("_minted-main/highlight.py"),
            Decision::Skip(SkipReason::BuildOutput)
        );
        assert_eq!(
            file("svg-inkscape/fig.svg"),
            Decision::Skip(SkipReason::BuildOutput)
        );
        assert_eq!(file("buildings/photo.png"), Decision::Include);
        let tracked = EntryInfo {
            git_tracked: true,
            ..EntryInfo::file(10)
        };
        assert_eq!(
            decide(Path::new("build/out.pdf"), &tracked, &fields()),
            Decision::Include
        );
        let included = vec!["build/out.pdf".to_string(), "node_modules".to_string()];
        let base = fields();
        let fields = PolicyFields {
            sync_include: &included,
            ..base
        };
        assert_eq!(
            decide(Path::new("build/out.pdf"), &EntryInfo::file(10), &fields),
            Decision::Include
        );
        assert_eq!(
            decide(
                Path::new("node_modules/pkg/index.js"),
                &EntryInfo::file(10),
                &fields
            ),
            Decision::Include
        );
    }

    #[test]
    fn notebook_engine_folders_are_build_output_and_figure_folders_need_their_source() {
        assert_eq!(
            file(".quarto/xref/index.json"),
            Decision::Skip(SkipReason::BuildOutput)
        );
        for path in [
            ".calepin/calepin.typ",
            "chapters/.calepin/calepin.typ",
            ".Calepin/report/calepin.typ",
        ] {
            assert_eq!(file(path), Decision::Include, "{path}");
        }
        assert_eq!(
            decide(Path::new(".quarto"), &EntryInfo::directory(), &fields()),
            Decision::Skip(SkipReason::BuildOutput)
        );
        let sources = ["report.qmd", "notes/analysis.Rmd", "slides.rmd"];
        let has = |path: &str| sources.contains(&path);
        let beside = |path: &str, entry: EntryInfo| {
            decide_with_siblings(Path::new(path), &entry, &fields(), has)
        };
        for path in [
            "report_files/figure-html/plot.png",
            "notes/analysis_files/libs/quarto.js",
            "slides_files/figure-revealjs/a.svg",
        ] {
            assert_eq!(
                beside(path, EntryInfo::file(10)),
                Decision::Skip(SkipReason::BuildOutput),
                "{path}"
            );
        }
        assert_eq!(
            beside("report_files", EntryInfo::directory()),
            Decision::Skip(SkipReason::BuildOutput)
        );
        assert_eq!(
            beside("report_files", EntryInfo::file(10)),
            Decision::Include
        );
        assert_eq!(
            beside("data_files/raw.csv", EntryInfo::file(10)),
            Decision::Include
        );
        assert_eq!(
            beside("notes/report_files/a.png", EntryInfo::file(10)),
            Decision::Include
        );
        assert_eq!(
            beside("_files/a.png", EntryInfo::file(10)),
            Decision::Include
        );
        assert_eq!(file("report_files/figure-html/plot.png"), Decision::Include);
        let included = vec!["report_files".to_string()];
        let base = fields();
        let kept = PolicyFields {
            sync_include: &included,
            ..base
        };
        assert_eq!(
            decide_with_siblings(
                Path::new("report_files/figure-html/plot.png"),
                &EntryInfo::file(10),
                &kept,
                has
            ),
            Decision::Include
        );
        assert!(is_notebook_figures_folder("notes\\analysis_files\\", has));
        assert!(!is_notebook_figures_folder("report_files/figure-html", has));
        assert!(is_generated_folder(".quarto", |_| false));
        assert!(!is_generated_folder("deep/.CALEPIN", |_| false));
        assert!(is_generated_folder("report_files", has));
        assert!(!is_generated_folder("figures", has));
        assert!(is_capture_excluded_component(".quarto"));
        assert!(!is_capture_excluded_component(".Calepin"));
        assert!(!is_capture_excluded_component("quarto"));
    }

    #[test]
    fn skips_carry_their_reason_and_placeholders_hold() {
        assert_eq!(
            file("node_modules/pkg/index.js"),
            Decision::Skip(SkipReason::Reinstallable)
        );
        assert_eq!(
            file("__MACOSX/main.tex"),
            Decision::Skip(SkipReason::ZipLeftovers)
        );
        let link = EntryInfo {
            kind: EntryKind::Symlink,
            ..EntryInfo::file(0)
        };
        assert_eq!(
            decide(Path::new("link.tex"), &link, &fields()),
            Decision::Skip(SkipReason::Symlink)
        );
        let special = EntryInfo {
            kind: EntryKind::Other,
            ..EntryInfo::file(0)
        };
        assert_eq!(
            decide(Path::new("fifo"), &special, &fields()),
            Decision::Skip(SkipReason::SpecialFile)
        );
        assert_eq!(
            decide(
                Path::new("huge.bin"),
                &EntryInfo::file(MAX_SYNC_FILE_BYTES + 1),
                &fields()
            ),
            Decision::Skip(SkipReason::TooLarge)
        );
        assert_eq!(
            decide(
                Path::new("huge.bin"),
                &EntryInfo::file(MAX_SYNC_FILE_BYTES),
                &fields()
            ),
            Decision::Include
        );
        let excluded = vec!["data/raw".to_string()];
        let base = fields();
        let fields = PolicyFields {
            sync_exclude: &excluded,
            ..base
        };
        assert_eq!(
            decide(Path::new("data/raw/set.csv"), &EntryInfo::file(10), &fields),
            Decision::Skip(SkipReason::ExcludedByUser)
        );
        let held = EntryInfo {
            placeholder: true,
            ..EntryInfo::file(10)
        };
        assert_eq!(
            decide(Path::new("evicted.tex"), &held, &base),
            Decision::Hold
        );
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_names_are_skipped_with_their_reason() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt as _;
        let path = Path::new(OsStr::from_bytes(b"bad-\xff.tex"));
        assert_eq!(
            decide(path, &EntryInfo::file(10), &fields()),
            Decision::Skip(SkipReason::NonUtf8Name)
        );
    }

    #[test]
    fn legacy_classifications_keep_their_exact_meanings() {
        assert!(is_capture_excluded_component("_minted-main"));
        assert!(is_capture_excluded_component("_MINTED-Main"));
        assert!(is_capture_excluded_component("pythontex-files-main"));
        assert!(!is_capture_excluded_component("_minted-"));
        assert!(!is_capture_excluded_component("_minted"));
        assert!(!is_capture_excluded_component("figures"));
        assert!(is_linked_skipped_directory("_minted"));
        assert!(is_linked_skipped_directory("BUILD"));
        assert!(!is_linked_skipped_directory("svg-inkscape"));
        assert!(is_scan_skipped_directory("svg-inkscape"));
        assert!(!is_scan_skipped_directory("BUILD"));
    }

    #[test]
    fn build_artifacts_match_patterns_and_pdfs_beside_their_source() {
        let sources = ["main.tex", "chapters/intro.tex"];
        let has = |path: &str| sources.contains(&path);
        for path in [
            "main.aux",
            "main.LOG",
            "chapters/intro.synctex.gz",
            "main.pdf",
        ] {
            assert!(is_build_artifact(path, has), "{path}");
        }
        for path in ["main.tex", "main.bbl", "figures/plot.pdf"] {
            assert!(!is_build_artifact(path, has), "{path}");
        }
    }
}
