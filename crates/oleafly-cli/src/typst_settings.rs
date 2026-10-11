use crate::native::{path_tool_candidates, resolve_executable, run_command, CandidateResolution};
use oleafly_core::typst_toolchain::{
    typst_project_font_dirs, typst_shared_font_dirs, TypstCapabilities, TypstCompileFlag,
};
use oleafly_core::{Error, ErrorKind, TypstSpec};
use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

const TYPST_DATA_DIR: &str = "typst";
const PACKAGES_DIR: &str = "packages";
const PACKAGE_CACHE_DIR: &str = "packages-cache";
pub(crate) const VENDOR_DIR: &str = "typst-packages";
const PACKAGE_PATH_VARIABLE: &str = "TYPST_PACKAGE_PATH";
const PACKAGE_CACHE_PATH_VARIABLE: &str = "TYPST_PACKAGE_CACHE_PATH";
const SOURCE_DATE_EPOCH: &str = "SOURCE_DATE_EPOCH";
const OFFLINE_PROXY: &str = "http://127.0.0.1:9";
const PROXY_VARIABLES: [&str; 6] = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
];
const NO_PROXY_VARIABLES: [&str; 2] = ["NO_PROXY", "no_proxy"];
const GIT_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct PackageDirs {
    pub package_path: PathBuf,
    pub cache_path: PathBuf,
}

impl PackageDirs {
    pub(crate) fn resolve(data_root: &Path, project_root: &Path, vendor: bool) -> Self {
        let shared = data_root.join(TYPST_DATA_DIR);
        Self {
            package_path: if vendor {
                project_root.join(VENDOR_DIR)
            } else {
                shared.join(PACKAGES_DIR)
            },
            cache_path: shared.join(PACKAGE_CACHE_DIR),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct TypstSettings {
    pub packages: Option<PackageDirs>,
    pub font_dirs: Vec<PathBuf>,
    pub ignore_system_fonts: bool,
    pub inputs: Vec<(String, String)>,
    pub creation_timestamp: Option<u64>,
    pub offline: bool,
}

pub(crate) struct SettingsRequest<'a> {
    pub spec: Option<&'a TypstSpec>,
    pub project_root: &'a Path,
    pub data_root: Option<&'a Path>,
    pub variant: Option<&'a str>,
    pub offline: bool,
    pub commit_time: Option<u64>,
}

impl TypstSettings {
    pub(crate) fn resolve(request: &SettingsRequest<'_>) -> Self {
        let spec = request.spec;
        let reproducible = spec.is_some_and(|spec| spec.reproducible);
        let ignore_system_fonts = spec.is_some_and(TypstSpec::ignores_system_fonts);
        let mut font_dirs = typst_project_font_dirs(spec, request.project_root);
        if !ignore_system_fonts {
            if let Some(data_root) = request.data_root {
                for directory in typst_shared_font_dirs(&data_root.join("assets")) {
                    if !font_dirs.contains(&directory) {
                        font_dirs.push(directory);
                    }
                }
            }
        }
        Self {
            packages: request.data_root.map(|data_root| {
                PackageDirs::resolve(
                    data_root,
                    request.project_root,
                    spec.is_some_and(|spec| spec.vendor_packages),
                )
            }),
            font_dirs,
            ignore_system_fonts,
            inputs: spec
                .map(|spec| spec.inputs_for(request.variant))
                .unwrap_or_default(),
            creation_timestamp: reproducible.then(|| request.commit_time.unwrap_or(0)),
            offline: request.offline,
        }
    }

    pub(crate) fn compile_flags(&self, capabilities: &TypstCapabilities) -> Vec<TypstCompileFlag> {
        let mut flags: Vec<TypstCompileFlag> = Vec::new();
        if let Some(packages) = &self.packages {
            flags.push(TypstCompileFlag::PackagePath(packages.package_path.clone()));
            flags.push(TypstCompileFlag::PackageCachePath(
                packages.cache_path.clone(),
            ));
        }
        flags.extend(
            self.font_dirs
                .iter()
                .cloned()
                .map(TypstCompileFlag::FontPath),
        );
        if self.ignore_system_fonts {
            flags.push(TypstCompileFlag::IgnoreSystemFonts);
        }
        flags.extend(
            self.inputs
                .iter()
                .map(|(key, value)| TypstCompileFlag::Input {
                    key: key.clone(),
                    value: value.clone(),
                }),
        );
        if let Some(timestamp) = self.creation_timestamp {
            flags.push(TypstCompileFlag::CreationTimestamp(timestamp));
        }
        flags
            .into_iter()
            .filter(|flag| capabilities.supports_flag(flag.name()))
            .collect()
    }

    pub(crate) fn environment(&self) -> Vec<(&'static str, OsString)> {
        let mut environment: Vec<(&'static str, OsString)> = Vec::new();
        if let Some(packages) = &self.packages {
            environment.push((
                PACKAGE_PATH_VARIABLE,
                packages.package_path.as_os_str().to_owned(),
            ));
            environment.push((
                PACKAGE_CACHE_PATH_VARIABLE,
                packages.cache_path.as_os_str().to_owned(),
            ));
        }
        if let Some(timestamp) = self.creation_timestamp {
            environment.push((SOURCE_DATE_EPOCH, timestamp.to_string().into()));
        }
        if self.offline {
            environment.extend(
                PROXY_VARIABLES
                    .into_iter()
                    .map(|name| (name, OsString::from(OFFLINE_PROXY))),
            );
            environment.extend(
                NO_PROXY_VARIABLES
                    .into_iter()
                    .map(|name| (name, OsString::new())),
            );
        }
        environment
    }
}

pub(crate) fn chosen_variant(
    spec: Option<&TypstSpec>,
    requested: Option<&str>,
) -> Result<Option<String>, Error> {
    let Some(name) = requested.map(str::trim).filter(|name| !name.is_empty()) else {
        return Ok(None);
    };
    let variants = spec.map(|spec| &spec.variants);
    if variants.is_some_and(|variants| variants.contains_key(name)) {
        return Ok(Some(name.to_string()));
    }
    let available: Vec<&str> = variants
        .map(|variants| variants.keys().map(String::as_str).collect())
        .unwrap_or_default();
    let message = if available.is_empty() {
        format!("this project has no Typst variant named `{name}`. It defines no variants. Add them under typst.variants in project.json")
    } else {
        format!(
            "this project has no Typst variant named `{name}`. Available variants: {}",
            available.join(", ")
        )
    };
    Err(Error::new(ErrorKind::InvalidInput, message))
}

pub(crate) fn unsupported_settings(
    spec: Option<&TypstSpec>,
    capabilities: &TypstCapabilities,
    version: &str,
) -> Vec<String> {
    let Some(spec) = spec else {
        return Vec::new();
    };
    [
        (
            "system_fonts",
            !spec.system_fonts,
            &["--ignore-system-fonts"][..],
        ),
        (
            "reproducible",
            spec.reproducible,
            &["--ignore-system-fonts", "--creation-timestamp"][..],
        ),
        (
            "vendor_packages",
            spec.vendor_packages,
            &["--package-path"][..],
        ),
    ]
    .into_iter()
    .filter(|(_, active, _)| *active)
    .filter_map(|(setting, _, flags)| {
        let missing: Vec<&str> = flags
            .iter()
            .copied()
            .filter(|flag| !capabilities.supports_flag(flag))
            .collect();
        (!missing.is_empty()).then(|| {
            format!(
                "Typst {version} does not support {}, so typst.{setting} is not applied",
                missing.join(" or ")
            )
        })
    })
    .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct SettingsSummary {
    pub vendor_packages: bool,
    pub package_path: Option<PathBuf>,
    pub package_cache_path: Option<PathBuf>,
    pub font_dirs: Vec<PathBuf>,
    pub system_fonts: bool,
    pub reproducible: bool,
    pub inputs: BTreeMap<String, String>,
    pub variants: BTreeMap<String, BTreeMap<String, String>>,
}

impl SettingsSummary {
    pub(crate) fn of(
        spec: Option<&TypstSpec>,
        project_root: &Path,
        data_root: Option<&Path>,
    ) -> Self {
        let vendor_packages = spec.is_some_and(|spec| spec.vendor_packages);
        let packages = data_root
            .map(|data_root| PackageDirs::resolve(data_root, project_root, vendor_packages));
        Self {
            vendor_packages,
            package_path: packages.as_ref().map(|dirs| dirs.package_path.clone()),
            package_cache_path: packages.map(|dirs| dirs.cache_path),
            font_dirs: typst_project_font_dirs(spec, project_root),
            system_fonts: !spec.is_some_and(TypstSpec::ignores_system_fonts),
            reproducible: spec.is_some_and(|spec| spec.reproducible),
            inputs: spec.map(|spec| spec.inputs.clone()).unwrap_or_default(),
            variants: spec
                .map(|spec| {
                    spec.variants
                        .iter()
                        .map(|(name, variant)| (name.clone(), variant.inputs.clone()))
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

fn is_repository_marker(candidate: &Path) -> bool {
    match std::fs::symlink_metadata(candidate) {
        Ok(metadata) if metadata.is_dir() => candidate.join("HEAD").is_file(),
        Ok(metadata) if metadata.is_file() => {
            let mut prefix = [0_u8; 7];
            std::fs::File::open(candidate)
                .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut prefix))
                .is_ok()
                && &prefix == b"gitdir:"
        }
        _ => false,
    }
}

fn find_git(project_root: &Path) -> Option<PathBuf> {
    path_tool_candidates("git")
        .into_iter()
        .find_map(
            |candidate| match resolve_executable(candidate, project_root) {
                CandidateResolution::Safe(path) => Some(path),
                CandidateResolution::Missing | CandidateResolution::ProjectLocal(_) => None,
            },
        )
}

fn git_arguments() -> Vec<OsString> {
    [
        "-c",
        "core.fsmonitor=false",
        "-c",
        &format!("core.hooksPath={NULL_DEVICE}"),
        "-c",
        "log.showSignature=false",
        "log",
        "-1",
        "--format=%ct",
        "HEAD",
    ]
    .into_iter()
    .map(OsString::from)
    .collect()
}

pub(crate) fn parse_commit_time(output: &str) -> Option<u64> {
    output.lines().next()?.trim().parse().ok()
}

pub(crate) async fn head_commit_time(project_root: &Path) -> Option<u64> {
    let project_root = dunce::simplified(project_root);
    let marker = project_root.join(".git");
    if !is_repository_marker(&marker) {
        return None;
    }
    let git = find_git(project_root)?;
    let environment = [
        ("GIT_DIR", marker.into_os_string()),
        ("GIT_WORK_TREE", project_root.as_os_str().to_owned()),
    ];
    let (output, status) = run_command(
        &git,
        &git_arguments(),
        project_root,
        &environment,
        GIT_TIMEOUT,
        &crate::native::CompilerLog::default(),
    )
    .await
    .ok()?;
    (status == Some(0))
        .then(|| parse_commit_time(&output))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_core::typst_toolchain::capabilities_for;
    use serde_json::json;
    use tempfile::TempDir;

    fn spec(value: serde_json::Value) -> TypstSpec {
        serde_json::from_value(value).unwrap()
    }

    fn names(flags: &[TypstCompileFlag]) -> Vec<&'static str> {
        flags.iter().map(TypstCompileFlag::name).collect()
    }

    fn project_with_fonts() -> (TempDir, PathBuf) {
        let directory = TempDir::new().unwrap();
        for folder in ["fonts", "assets/type"] {
            std::fs::create_dir_all(directory.path().join(folder)).unwrap();
        }
        let root = directory.path().canonicalize().unwrap();
        (directory, root)
    }

    fn every_setting() -> TypstSpec {
        spec(json!({
            "version": "0.15.1",
            "vendor_packages": true,
            "font_paths": ["assets/type", "../outside", "missing"],
            "system_fonts": false,
            "reproducible": true,
            "inputs": {"draft": "true", "anonymous": "false"},
            "variants": {"review": {"inputs": {"anonymous": "true"}}}
        }))
    }

    #[test]
    fn every_project_setting_maps_to_its_typst_flag() {
        let (_directory, root) = project_with_fonts();
        let spec = every_setting();
        let data = Path::new("/data");
        let settings = TypstSettings::resolve(&SettingsRequest {
            spec: Some(&spec),
            project_root: &root,
            data_root: Some(data),
            variant: Some("review"),
            offline: false,
            commit_time: Some(1_700_000_000),
        });
        assert_eq!(
            settings.packages,
            Some(PackageDirs {
                package_path: root.join("typst-packages"),
                cache_path: data.join("typst").join("packages-cache"),
            })
        );
        assert_eq!(
            settings.font_dirs,
            [root.join("fonts"), root.join("assets").join("type")]
        );
        assert_eq!(
            settings.inputs,
            [
                ("anonymous".to_string(), "true".to_string()),
                ("draft".to_string(), "true".to_string()),
            ]
        );
        let flags = settings.compile_flags(capabilities_for("0.15.1"));
        assert_eq!(
            names(&flags),
            [
                "--package-path",
                "--package-cache-path",
                "--font-path",
                "--font-path",
                "--ignore-system-fonts",
                "--input",
                "--input",
                "--creation-timestamp",
            ]
        );
        assert!(flags.contains(&TypstCompileFlag::CreationTimestamp(1_700_000_000)));
        let old = settings.compile_flags(capabilities_for("0.11.1"));
        assert_eq!(
            names(&old),
            ["--font-path", "--font-path", "--input", "--input"]
        );
    }

    #[test]
    fn shared_package_folders_and_a_reproducible_date_of_zero_without_git() {
        let (_directory, root) = project_with_fonts();
        let spec = spec(json!({"reproducible": true}));
        let settings = TypstSettings::resolve(&SettingsRequest {
            spec: Some(&spec),
            project_root: &root,
            data_root: Some(Path::new("/data")),
            variant: None,
            offline: true,
            commit_time: None,
        });
        assert_eq!(
            settings.packages.as_ref().unwrap().package_path,
            Path::new("/data").join("typst").join("packages")
        );
        assert!(settings.ignore_system_fonts);
        assert_eq!(settings.creation_timestamp, Some(0));
        let environment: BTreeMap<&str, String> = settings
            .environment()
            .into_iter()
            .map(|(name, value)| (name, value.to_string_lossy().into_owned()))
            .collect();
        assert_eq!(environment["SOURCE_DATE_EPOCH"], "0");
        assert_eq!(environment["HTTPS_PROXY"], "http://127.0.0.1:9");
        assert_eq!(environment["all_proxy"], "http://127.0.0.1:9");
        assert_eq!(environment["NO_PROXY"], "");
        assert_eq!(
            PathBuf::from(&environment["TYPST_PACKAGE_CACHE_PATH"]),
            Path::new("/data").join("typst").join("packages-cache")
        );

        let plain = TypstSettings::resolve(&SettingsRequest {
            spec: None,
            project_root: &root,
            data_root: None,
            variant: None,
            offline: false,
            commit_time: Some(5),
        });
        assert_eq!(plain.creation_timestamp, None);
        assert_eq!(plain.font_dirs, [root.join("fonts")]);
        assert!(plain.environment().is_empty());
    }

    #[test]
    fn an_unknown_variant_names_the_ones_that_exist() {
        let spec = every_setting();
        assert_eq!(
            chosen_variant(Some(&spec), Some(" review ")).unwrap(),
            Some("review".into())
        );
        assert_eq!(chosen_variant(Some(&spec), Some("  ")).unwrap(), None);
        assert_eq!(chosen_variant(None, None).unwrap(), None);
        let error = chosen_variant(Some(&spec), Some("final")).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
        assert_eq!(
            error.message(),
            "this project has no Typst variant named `final`. Available variants: review"
        );
        let none = chosen_variant(None, Some("final")).unwrap_err();
        assert!(none.message().contains("defines no variants"), "{none}");
        for message in [error.message(), none.message()] {
            assert!(!message.contains(';') && !message.contains('\u{2014}'));
        }
    }

    #[test]
    fn settings_an_old_typst_cannot_apply_get_one_note_each() {
        let spec = every_setting();
        assert_eq!(
            unsupported_settings(Some(&spec), capabilities_for("0.11.1"), "0.11.1"),
            [
                "Typst 0.11.1 does not support --ignore-system-fonts, so typst.system_fonts is not applied",
                "Typst 0.11.1 does not support --ignore-system-fonts or --creation-timestamp, so typst.reproducible is not applied",
                "Typst 0.11.1 does not support --package-path, so typst.vendor_packages is not applied",
            ]
        );
        assert!(unsupported_settings(Some(&spec), capabilities_for("0.12.0"), "0.12.0").is_empty());
        assert!(unsupported_settings(None, capabilities_for("0.11.1"), "0.11.1").is_empty());
        assert!(unsupported_settings(
            Some(&TypstSpec::default()),
            capabilities_for("0.11.1"),
            "0.11.1"
        )
        .is_empty());
    }

    #[test]
    fn the_summary_lists_what_a_build_would_use() {
        let (_directory, root) = project_with_fonts();
        let spec = every_setting();
        let summary = SettingsSummary::of(Some(&spec), &root, Some(Path::new("/data")));
        let value = serde_json::to_value(&summary).unwrap();
        assert_eq!(value["vendor_packages"], true);
        assert_eq!(value["system_fonts"], false);
        assert_eq!(value["reproducible"], true);
        assert_eq!(
            value["inputs"],
            json!({"anonymous": "false", "draft": "true"})
        );
        assert_eq!(value["variants"], json!({"review": {"anonymous": "true"}}));
        assert_eq!(value["font_dirs"].as_array().unwrap().len(), 2);
        assert_eq!(summary.package_path, Some(root.join("typst-packages")));
        let empty = SettingsSummary::of(None, &root, None);
        assert!(empty.system_fonts && !empty.vendor_packages && empty.package_path.is_none());
    }

    #[test]
    fn commit_times_come_from_the_first_line_only() {
        assert_eq!(parse_commit_time("1700000000\n"), Some(1_700_000_000));
        assert_eq!(parse_commit_time(" 42 \nwarning: x"), Some(42));
        assert_eq!(parse_commit_time("fatal: no HEAD\n"), None);
        assert_eq!(parse_commit_time(""), None);
    }

    #[test]
    fn only_a_git_folder_or_gitdir_file_marks_a_repository() {
        let directory = TempDir::new().unwrap();
        let marker = directory.path().join(".git");
        assert!(!is_repository_marker(&marker));
        std::fs::write(&marker, "not a git file").unwrap();
        assert!(!is_repository_marker(&marker));
        std::fs::write(&marker, "gitdir: /elsewhere/.git/worktrees/x\n").unwrap();
        assert!(is_repository_marker(&marker));
        std::fs::remove_file(&marker).unwrap();
        std::fs::create_dir(&marker).unwrap();
        assert!(!is_repository_marker(&marker));
        std::fs::write(marker.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert!(is_repository_marker(&marker));
    }

    #[tokio::test]
    async fn a_folder_outside_git_has_no_commit_time() {
        let directory = TempDir::new().unwrap();
        assert_eq!(head_commit_time(directory.path()).await, None);
    }

    #[tokio::test]
    async fn the_last_commit_time_of_a_real_repository_is_read() {
        let Some(git) = find_git(Path::new("/nonexistent-project-root")) else {
            return;
        };
        let directory = TempDir::new().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let git_command = |arguments: &[&str]| {
            let status = std::process::Command::new(&git)
                .args(arguments)
                .current_dir(&root)
                .env_remove("GIT_DIR")
                .env_remove("GIT_WORK_TREE")
                .env_remove("GIT_INDEX_FILE")
                .env("GIT_AUTHOR_NAME", "Ada")
                .env("GIT_AUTHOR_EMAIL", "ada@example.com")
                .env("GIT_COMMITTER_NAME", "Ada")
                .env("GIT_COMMITTER_EMAIL", "ada@example.com")
                .env("GIT_AUTHOR_DATE", "@1700000000 +0000")
                .env("GIT_COMMITTER_DATE", "@1700000000 +0000")
                .output()
                .unwrap();
            assert!(status.status.success(), "{status:?}");
        };
        git_command(&["init", "-q"]);
        assert_eq!(head_commit_time(&root).await, None);
        git_command(&[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "First",
        ]);
        assert_eq!(head_commit_time(&root).await, Some(1_700_000_000));
    }

    #[test]
    fn installed_typst_font_packs_join_the_compile_like_the_app() {
        let project = TempDir::new().unwrap();
        let data = TempDir::new().unwrap();
        let pack = data.path().join("assets/typst-fonts/typst-text");
        std::fs::create_dir_all(&pack).unwrap();
        let request = |spec: Option<&TypstSpec>| {
            TypstSettings::resolve(&SettingsRequest {
                spec,
                project_root: project.path(),
                data_root: Some(data.path()),
                variant: None,
                offline: true,
                commit_time: None,
            })
        };
        let pack = pack.canonicalize().unwrap();
        assert!(request(None).font_dirs.contains(&pack));
        let sealed = spec(json!({"system_fonts": false}));
        assert!(!request(Some(&sealed)).font_dirs.contains(&pack));
    }
}
