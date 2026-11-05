use std::collections::BTreeMap;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_norway::Value;
use sha2::Digest as _;

use crate::app_error::AppError;

pub(super) const KEEP_AUX_METADATA: &str = "latex-clean:false";
const LEFT_BEHIND_FILE: &str = "quarto-left-behind.json";
const HELD_DIRECTORY: &str = "quarto-held";
const HELD_MANIFEST: &str = "held.json";
const HELD_KEY_LENGTH: usize = 16;
const TEX_UNSAFE: [char; 15] = [
    ' ', '<', '>', '(', ')', '|', ':', '&', ';', '#', '?', '*', '\'', '\\', '/',
];
const TEX_AUX: [&str; 19] = [
    "log", "idx", "aux", "bcf", "blg", "bbl", "fls", "out", "lof", "lot", "toc", "nav", "snm",
    "vrb", "ilg", "ind", "xwm", "brf", "run.xml",
];
const MISSING_FONT_LOG: &str = "missfont.log";
const LATEX_CLEAN_KEY: &str = "latex-clean";
const QUARTO_TEX_OPENING: &str = "% Options for packages loaded elsewhere";
const QUARTO_TYP_OPENING: &str = "// Simple numbering for non-book documents";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Route {
    Tex,
    Typst,
}

fn route(format: &str) -> Option<Route> {
    let lower = format.trim().to_ascii_lowercase();
    match lower.rsplit('-').next().unwrap_or(lower.as_str()) {
        "pdf" | "beamer" => Some(Route::Tex),
        "typst" => Some(Route::Typst),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Plan {
    directory: PathBuf,
    stem: String,
    route: Route,
}

pub(super) fn plan(input: &Path, format: &str) -> Option<Plan> {
    let route = route(format)?;
    let stem = input.file_stem()?.to_string_lossy().into_owned();
    Some(Plan {
        directory: input.parent()?.to_path_buf(),
        stem: match route {
            Route::Tex => stem.replace(TEX_UNSAFE, "-"),
            Route::Typst => stem,
        },
        route,
    })
}

impl Plan {
    fn source(&self) -> String {
        let extension = match self.route {
            Route::Tex => "tex",
            Route::Typst => "typ",
        };
        format!("{}.{extension}", self.stem)
    }

    fn derived(&self) -> Vec<String> {
        let mut names = vec![format!("{}.pdf", self.stem)];
        if self.route == Route::Tex {
            names.extend(TEX_AUX.iter().map(|aux| format!("{}.{aux}", self.stem)));
            names.push(MISSING_FONT_LOG.to_owned());
        }
        names
    }

    fn overwritten(&self) -> Vec<String> {
        let mut names = self.derived();
        names.push(self.source());
        names
    }

    fn keep_key(&self) -> &'static str {
        match self.route {
            Route::Tex => "keep-tex",
            Route::Typst => "keep-typ",
        }
    }

    fn opening(&self) -> &'static str {
        match self.route {
            Route::Tex => QUARTO_TEX_OPENING,
            Route::Typst => QUARTO_TYP_OPENING,
        }
    }

    fn opens_like_quarto(&self, path: &Path) -> bool {
        let opening = self.opening().as_bytes();
        let mut start = vec![0; opening.len()];
        std::fs::File::open(path)
            .and_then(|mut file| file.read_exact(&mut start))
            .is_ok()
            && start == opening
    }

    fn path(&self, name: &str) -> PathBuf {
        self.directory.join(name)
    }

    pub(super) fn tex_log(&self) -> Option<PathBuf> {
        (self.route == Route::Tex).then(|| self.path(&format!("{}.log", self.stem)))
    }

    fn held_folder(&self, out_dir: &Path) -> PathBuf {
        let mut hasher = sha2::Sha256::new();
        hasher.update(self.directory.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(self.stem.as_bytes());
        let key = format!("{:x}", hasher.finalize());
        state_folder(out_dir)
            .join(HELD_DIRECTORY)
            .join(&key[..HELD_KEY_LENGTH.min(key.len())])
    }
}

fn state_folder(out_dir: &Path) -> &Path {
    out_dir.parent().unwrap_or(out_dir)
}

fn target_value<'a>(
    mapping: &'a serde_norway::Mapping,
    format: &str,
    key: &str,
) -> Option<&'a Value> {
    mapping
        .get("format")
        .and_then(|formats| formats.get(format))
        .and_then(|options| options.get(key))
        .or_else(|| mapping.get(key))
}

fn declared(source: &str, yaml: &[String], format: &str, key: &str) -> Option<Value> {
    super::front_matter(source)
        .into_iter()
        .chain(yaml.iter().map(String::as_str))
        .filter_map(super::yaml_mapping)
        .find_map(|mapping| target_value(&mapping, format, key).cloned())
}

fn keeps_source(plan: &Plan, format: &str, source: &str, yaml: &[String]) -> bool {
    declared(source, yaml, format, plan.keep_key()).and_then(|value| value.as_bool()) == Some(true)
}

pub(super) fn keeps_aux_files(format: &str, source: &str, yaml: &[String]) -> bool {
    route(format) == Some(Route::Tex) && declared(source, yaml, format, LATEX_CLEAN_KEY).is_none()
}

fn file_hash(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = sha2::Sha256::new();
    std::io::copy(&mut file, &mut hasher).ok()?;
    Some(format!("{:x}", hasher.finalize()))
}

fn record_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn read_record(out_dir: &Path) -> BTreeMap<String, String> {
    std::fs::read(state_folder(out_dir).join(LEFT_BEHIND_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_record(out_dir: &Path, record: &BTreeMap<String, String>) {
    let path = state_folder(out_dir).join(LEFT_BEHIND_FILE);
    if record.is_empty() {
        let _ = std::fs::remove_file(&path);
        return;
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(record) {
        if let Err(error) = oleafly_core::atomic::write_atomic(&path, &bytes) {
            let _ = crate::project::append_app_log(format!(
                "Could not record the files Quarto left behind: {error}"
            ));
        }
    }
}

fn left_by_oleafly(path: &Path, record: &BTreeMap<String, String>) -> bool {
    file_hash(path).is_some_and(|hash| record.get(&record_key(path)) == Some(&hash))
}

fn project_relative(project_dir: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(project_dir).unwrap_or(path);
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn would_overwrite(file: impl ToString) -> String {
    AppError::new("notebook.would_overwrite")
        .param("file", file)
        .into()
}

pub(super) fn refuse_overwrite(
    project_dir: &Path,
    input: &Path,
    out_dir: &Path,
    format: &str,
    source: &str,
    yaml: &[String],
) -> Result<(), String> {
    let Some(plan) = plan(input, format) else {
        return Ok(());
    };
    let working_file = plan.path(&plan.source());
    let refused = match std::fs::symlink_metadata(&working_file) {
        Err(_) => false,
        Ok(metadata) if !metadata.is_file() => true,
        Ok(_) => {
            !keeps_source(&plan, format, source, yaml)
                && !plan.opens_like_quarto(&working_file)
                && !left_by_oleafly(&working_file, &read_record(out_dir))
        }
    };
    if refused {
        return Err(would_overwrite(project_relative(
            project_dir,
            &working_file,
        )));
    }
    for name in plan.derived() {
        let path = plan.path(&name);
        if std::fs::symlink_metadata(&path).is_ok_and(|metadata| !metadata.is_file()) {
            return Err(would_overwrite(project_relative(project_dir, &path)));
        }
    }
    Ok(())
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HeldManifest {
    files: Vec<String>,
}

fn same_bytes(first: &Path, second: &Path) -> bool {
    let sizes = std::fs::metadata(first)
        .ok()
        .zip(std::fs::metadata(second).ok());
    sizes.is_some_and(|(first, second)| first.len() == second.len())
        && file_hash(first).is_some()
        && file_hash(first) == file_hash(second)
}

fn restore_held(plan: &Plan, out_dir: &Path) -> std::io::Result<()> {
    let folder = plan.held_folder(out_dir);
    let manifest = folder.join(HELD_MANIFEST);
    let Some(held) = std::fs::read(&manifest)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<HeldManifest>(&bytes).ok())
    else {
        return match std::fs::remove_dir_all(&folder) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        };
    };
    let expected = plan.overwritten();
    for name in held.files.iter().filter(|name| expected.contains(name)) {
        let copy = folder.join(name);
        let original = plan.path(name);
        if !same_bytes(&copy, &original) {
            oleafly_core::atomic::copy_atomic(&copy, &original)?;
        }
    }
    std::fs::remove_file(&manifest)?;
    std::fs::remove_dir_all(&folder)?;
    if let Some(parent) = folder.parent() {
        let _ = std::fs::remove_dir(parent);
    }
    Ok(())
}

fn set_aside(plan: &Plan, out_dir: &Path, names: &[String]) -> std::io::Result<()> {
    let folder = plan.held_folder(out_dir);
    std::fs::create_dir_all(&folder)?;
    for name in names {
        std::fs::copy(plan.path(name), folder.join(name))?;
    }
    let manifest = HeldManifest {
        files: names.to_vec(),
    };
    oleafly_core::atomic::write_atomic(
        &folder.join(HELD_MANIFEST),
        &serde_json::to_vec(&manifest).map_err(std::io::Error::other)?,
    )
}

#[derive(Debug)]
pub(crate) struct SiblingHold {
    plan: Plan,
    out_dir: PathBuf,
    held: Vec<String>,
    remove_aux_on_success: bool,
    succeeded: bool,
}

pub(super) fn hold(
    input: &Path,
    format: &str,
    out_dir: &Path,
    remove_aux_on_success: bool,
    source: &str,
    yaml: &[String],
) -> Result<Option<SiblingHold>, String> {
    let Some(plan) = plan(input, format) else {
        return Ok(None);
    };
    restore_held(&plan, out_dir).map_err(|error| restore_failure(&plan, error))?;
    let record = read_record(out_dir);
    let mut held: Vec<String> = plan
        .derived()
        .into_iter()
        .filter(|name| {
            let path = plan.path(name);
            path.is_file() && !left_by_oleafly(&path, &record)
        })
        .collect();
    let working_file = plan.path(&plan.source());
    if plan.opens_like_quarto(&working_file)
        && !keeps_source(&plan, format, source, yaml)
        && !left_by_oleafly(&working_file, &record)
    {
        held.push(plan.source());
    }
    if !held.is_empty() {
        set_aside(&plan, out_dir, &held).map_err(|error| restore_failure(&plan, error))?;
    }
    Ok(Some(SiblingHold {
        plan,
        out_dir: out_dir.to_owned(),
        held,
        remove_aux_on_success,
        succeeded: false,
    }))
}

fn restore_failure(plan: &Plan, error: std::io::Error) -> String {
    let _ = crate::project::append_app_log(format!(
        "Could not set aside the files beside {}: {error}",
        plan.source()
    ));
    would_overwrite(plan.source())
}

impl SiblingHold {
    pub(crate) fn set_succeeded(&mut self, succeeded: bool) {
        self.succeeded = succeeded;
    }

    fn settle(&self) {
        if let Err(error) = restore_held(&self.plan, &self.out_dir) {
            let _ = crate::project::append_app_log(format!(
                "Could not put back the files beside {}: {error}",
                self.plan.source()
            ));
        }
        let source = self.plan.source();
        let mut record = read_record(&self.out_dir);
        for name in std::iter::once(source.clone()).chain(self.plan.derived()) {
            let path = self.plan.path(&name);
            record.remove(&record_key(&path));
            if self.held.contains(&name) || !path.is_file() {
                continue;
            }
            if self.succeeded && self.remove_aux_on_success && name != source {
                let _ = std::fs::remove_file(&path);
            } else if let Some(hash) = file_hash(&path) {
                record.insert(record_key(&path), hash);
            }
        }
        write_record(&self.out_dir, &record);
    }
}

impl Drop for SiblingHold {
    fn drop(&mut self) {
        self.settle();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Project {
        _temp: tempfile::TempDir,
        root: PathBuf,
        out: PathBuf,
    }

    impl Project {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("project");
            let out = temp.path().join("build");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::create_dir_all(&out).unwrap();
            Self {
                _temp: temp,
                root,
                out,
            }
        }

        fn write(&self, name: &str, text: &str) -> PathBuf {
            let path = self.root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, text).unwrap();
            path
        }

        fn read(&self, name: &str) -> Option<String> {
            std::fs::read_to_string(self.root.join(name)).ok()
        }

        fn refused(&self, input: &Path, format: &str, source: &str, yaml: &[String]) -> bool {
            refuse_overwrite(&self.root, input, &self.out, format, source, yaml).is_err()
        }

        fn hold(&self, input: &Path, format: &str, remove_aux: bool) -> SiblingHold {
            hold(input, format, &self.out, remove_aux, "", &[])
                .unwrap()
                .unwrap()
        }

        fn clear_build_folder(&self) {
            std::fs::remove_dir_all(&self.out).unwrap();
            std::fs::create_dir_all(&self.out).unwrap();
        }
    }

    fn names(plan: &Plan) -> (String, Vec<String>) {
        (plan.source(), plan.derived())
    }

    #[test]
    fn working_files_follow_quartos_names() {
        let tex = plan(Path::new("/work/my report.qmd"), "pdf").unwrap();
        let (source, derived) = names(&tex);
        assert_eq!(source, "my-report.tex");
        assert!(derived.contains(&"my-report.pdf".to_owned()));
        assert!(derived.contains(&"my-report.log".to_owned()));
        assert!(derived.contains(&"my-report.run.xml".to_owned()));
        assert!(derived.contains(&"missfont.log".to_owned()));
        assert_eq!(
            tex.tex_log(),
            Some(Path::new("/work").join("my-report.log"))
        );

        let typst = plan(Path::new("/work/my report.qmd"), "typst").unwrap();
        assert_eq!(
            names(&typst),
            ("my report.typ".to_owned(), vec!["my report.pdf".to_owned()])
        );
        assert_eq!(typst.tex_log(), None);

        assert_eq!(
            plan(Path::new("/work/a.qmd"), "beamer").unwrap().source(),
            "a.tex"
        );
        assert_eq!(
            plan(Path::new("/work/a.qmd"), "acm-pdf").unwrap().source(),
            "a.tex"
        );
        assert_eq!(
            plan(Path::new("/work/a.qmd"), "orange-typst")
                .unwrap()
                .source(),
            "a.typ"
        );
        for format in ["html", "revealjs", "docx", "dashboard"] {
            assert_eq!(plan(Path::new("/work/a.qmd"), format), None, "{format}");
        }
    }

    #[test]
    fn a_hand_written_file_stops_the_compile_and_is_named_from_the_project_root() {
        let project = Project::new();
        let input = project.write("chapters/report.qmd", "# Report\n");
        project.write("chapters/report.typ", "// mine\n");
        let refusal =
            refuse_overwrite(&project.root, &input, &project.out, "typst", "", &[]).unwrap_err();
        assert_eq!(
            crate::app_error::code(&refusal).as_deref(),
            Some("notebook.would_overwrite")
        );
        assert!(refusal.contains("chapters/report.typ"), "{refusal}");
        assert!(!project.refused(&input, "html", "", &[]));
        assert!(!project.refused(&input, "pdf", "", &[]));
        project.write("chapters/report.tex", "% mine\n");
        assert!(project.refused(&input, "pdf", "", &[]));
    }

    #[test]
    fn a_leftover_this_app_recorded_passes_until_someone_edits_it() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        let held = project.hold(&input, "typst", false);
        project.write("report.typ", "// generated\n");
        drop(held);
        assert!(!project.refused(&input, "typst", "", &[]));
        project.write("report.typ", "// edited by hand\n");
        assert!(project.refused(&input, "typst", "", &[]));
    }

    #[test]
    fn keep_tex_and_keep_typ_ask_quarto_to_write_the_file_there() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.tex", "% generated\n");
        project.write("report.typ", "// generated\n");
        let kept = "---\nformat:\n  pdf:\n    keep-tex: true\n---\n";
        assert!(!project.refused(&input, "pdf", kept, &[]));
        assert!(project.refused(&input, "typst", kept, &[]));
        assert!(project.refused(&input, "pdf", "---\nkeep-tex: false\n---\n", &[]));
        assert!(!project.refused(
            &input,
            "typst",
            "",
            &["format:\n  typst:\n    keep-typ: true\n".to_owned()],
        ));
    }

    #[test]
    fn keep_tex_counts_only_for_the_target_format_and_the_nearest_setting() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.tex", "% mine\n");

        let other_format = "---\nformat:\n  pdf: default\n  beamer:\n    keep-tex: true\n---\n";
        assert!(project.refused(&input, "pdf", other_format, &[]));
        assert!(!project.refused(&input, "beamer", other_format, &[]));

        let in_project = ["keep-tex: true\n".to_owned()];
        let turned_off = "---\nkeep-tex: false\n---\n";
        assert!(project.refused(&input, "pdf", turned_off, &in_project));
        assert!(!project.refused(&input, "pdf", "---\ntitle: A\n---\n", &in_project));

        let nearer_folder = [
            "keep-tex: false\n".to_owned(),
            "keep-tex: true\n".to_owned(),
        ];
        assert!(project.refused(&input, "pdf", "", &nearer_folder));

        let format_wins = "---\nkeep-tex: true\nformat:\n  pdf:\n    keep-tex: false\n---\n";
        assert!(project.refused(&input, "pdf", format_wins, &[]));
    }

    #[test]
    fn latex_clean_set_for_another_format_changes_nothing() {
        let beamer_only = "---\nformat:\n  pdf: default\n  beamer:\n    latex-clean: true\n---\n";
        assert!(keeps_aux_files("pdf", beamer_only, &[]));
        assert!(!keeps_aux_files("beamer", beamer_only, &[]));
    }

    #[test]
    fn a_leftover_quarto_wrote_before_any_record_is_set_aside_and_put_back() {
        for (format, name, opening) in [
            ("pdf", "report.tex", QUARTO_TEX_OPENING),
            ("typst", "report.typ", QUARTO_TYP_OPENING),
        ] {
            let project = Project::new();
            let input = project.write("report.qmd", "# Report\n");
            let leftover = format!("{opening}\n% changed by hand\n");
            project.write(name, &leftover);
            assert!(!project.refused(&input, format, "", &[]), "{format}");

            let mut held = project.hold(&input, format, false);
            assert_eq!(held.held, [name.to_owned()], "{format}");
            std::fs::remove_file(project.root.join(name)).unwrap();
            held.set_succeeded(true);
            drop(held);
            assert_eq!(project.read(name), Some(leftover.clone()), "{format}");
            assert!(!project.refused(&input, format, "", &[]), "{format}");

            let held = project.hold(&input, format, false);
            project.write(name, "half written");
            drop(held);
            assert_eq!(project.read(name), Some(leftover), "{format}");
        }
    }

    #[test]
    fn quartos_opening_alone_does_not_hold_a_file_the_run_may_replace() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.tex", &format!("{QUARTO_TEX_OPENING}\nold\n"));
        let kept = "---\nkeep-tex: true\n---\n";
        let held = hold(&input, "pdf", &project.out, false, kept, &[])
            .unwrap()
            .unwrap();
        assert!(held.held.is_empty());
        project.write("report.tex", &format!("{QUARTO_TEX_OPENING}\nfresh\n"));
        drop(held);

        let held = project.hold(&input, "pdf", false);
        assert!(held.held.is_empty());
        project.write("report.tex", "% replaced\n");
        drop(held);
        assert_eq!(project.read("report.tex").as_deref(), Some("% replaced\n"));
    }

    #[test]
    fn a_file_without_quartos_opening_is_still_refused() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.tex", &format!("% {QUARTO_TEX_OPENING}\n"));
        project.write("report.typ", QUARTO_TEX_OPENING);
        assert!(project.refused(&input, "pdf", "", &[]));
        assert!(project.refused(&input, "typst", "", &[]));
    }

    #[test]
    fn clearing_the_build_folder_loses_neither_the_record_nor_the_held_copies() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.pdf", "my pdf");

        let held = project.hold(&input, "pdf", false);
        project.write("report.tex", "\\documentclass{article}\n");
        drop(held);
        project.clear_build_folder();
        assert!(!project.refused(&input, "pdf", "", &[]));

        std::mem::forget(project.hold(&input, "pdf", false));
        std::fs::remove_file(project.root.join("report.pdf")).unwrap();
        project.clear_build_folder();
        drop(project.hold(&input, "pdf", false));
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
    }

    #[test]
    fn something_other_than_a_file_in_the_way_is_refused() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        std::fs::create_dir(project.root.join("report.pdf")).unwrap();
        assert!(project.refused(&input, "typst", "", &[]));
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        std::fs::create_dir(project.root.join("report.tex")).unwrap();
        assert!(project.refused(&input, "pdf", "---\nkeep-tex: true\n---\n", &[]));
    }

    #[test]
    fn files_quarto_deletes_or_overwrites_come_back_after_the_run() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.pdf", "my pdf");
        project.write("report.log", "my log");
        project.write("report.bbl", "my bbl");
        let mut held = project.hold(&input, "pdf", true);
        std::fs::remove_file(project.root.join("report.pdf")).unwrap();
        project.write("report.log", "generated log");
        std::fs::remove_file(project.root.join("report.bbl")).unwrap();
        project.write("report.aux", "generated aux");
        held.set_succeeded(true);
        drop(held);
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
        assert_eq!(project.read("report.log").as_deref(), Some("my log"));
        assert_eq!(project.read("report.bbl").as_deref(), Some("my bbl"));
        assert_eq!(project.read("report.aux"), None);
        assert!(!plan(&input, "pdf")
            .unwrap()
            .held_folder(&project.out)
            .exists());
    }

    #[test]
    fn a_failed_run_keeps_its_own_files_and_the_next_run_does_not_hold_them() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.pdf", "my pdf");
        let held = project.hold(&input, "pdf", true);
        project.write("report.tex", "% generated\n");
        project.write("report.log", "failed log");
        std::fs::remove_file(project.root.join("report.pdf")).unwrap();
        drop(held);
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
        assert_eq!(project.read("report.log").as_deref(), Some("failed log"));
        assert!(!project.refused(&input, "pdf", "", &[]));

        let mut second = project.hold(&input, "pdf", true);
        assert_eq!(second.held, ["report.pdf".to_owned()]);
        std::fs::remove_file(project.root.join("report.tex")).unwrap();
        project.write("report.log", "passing log");
        second.set_succeeded(true);
        drop(second);
        assert_eq!(project.read("report.log"), None);
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
    }

    #[test]
    fn a_run_that_crashed_is_put_back_before_the_next_one_starts() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.pdf", "my pdf");
        let held = project.hold(&input, "typst", false);
        std::mem::forget(held);
        project.write("report.pdf", "half written");
        let again = project.hold(&input, "typst", false);
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
        drop(again);
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
    }

    #[test]
    fn a_held_list_cannot_write_outside_the_documents_own_names() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        let plan = plan(&input, "typst").unwrap();
        let folder = plan.held_folder(&project.out);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("other.txt"), "planted").unwrap();
        std::fs::write(
            folder.join(HELD_MANIFEST),
            serde_json::to_vec(&HeldManifest {
                files: vec!["other.txt".to_owned()],
            })
            .unwrap(),
        )
        .unwrap();
        restore_held(&plan, &project.out).unwrap();
        assert_eq!(project.read("other.txt"), None);
    }

    #[test]
    fn an_unfinished_copy_is_dropped_without_touching_the_originals() {
        let project = Project::new();
        let input = project.write("report.qmd", "# Report\n");
        project.write("report.pdf", "my pdf");
        let plan = plan(&input, "typst").unwrap();
        let folder = plan.held_folder(&project.out);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("report.pdf"), "partial").unwrap();
        restore_held(&plan, &project.out).unwrap();
        assert_eq!(project.read("report.pdf").as_deref(), Some("my pdf"));
        assert!(!folder.exists());
    }

    #[test]
    fn aux_files_are_kept_only_for_latex_targets_that_leave_it_to_oleafly() {
        assert!(keeps_aux_files("pdf", "---\ntitle: A\n---\n", &[]));
        assert!(keeps_aux_files("beamer", "", &[]));
        assert!(!keeps_aux_files("typst", "", &[]));
        assert!(!keeps_aux_files("html", "", &[]));
        assert!(!keeps_aux_files(
            "pdf",
            "---\nlatex-clean: true\n---\n",
            &[]
        ));
        assert!(!keeps_aux_files(
            "pdf",
            "",
            &["format:\n  pdf:\n    latex-clean: false\n".to_owned()]
        ));
    }
}
