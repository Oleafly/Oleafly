use crate::app_error::AppError;
use crate::project_location::{ManifestSource, ProjectKind, ProjectLocation, MANIFEST_FILE};
use serde::de::{Deserializer, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{Map, Value};
use std::io::Write as _;
use std::path::Path;

const MAX_FOLDER_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_LOCALE_LENGTH: usize = 35;

#[cfg(test)]
pub(crate) const NX_PROJECT_JSON: &str = "{\n  \"name\": \"web\",\n  \"$schema\": \"../../node_modules/nx/schemas/project-schema.json\",\n  \"sourceRoot\": \"apps/web/src\",\n  \"projectType\": \"application\",\n  \"targets\": {\n    \"build\": {\n      \"executor\": \"@nx/vite:build\"\n    }\n  }\n}\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManifestHome {
    Library,
    Folder,
    Device,
    DeviceForeign,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct FolderFields {
    pub(crate) name: Option<String>,
    pub(crate) main_doc: String,
    pub(crate) engine: Option<String>,
    pub(crate) tex_flavor: Option<String>,
    pub(crate) dictionary_locale: Option<String>,
}

impl FolderFields {
    fn from_object(object: &Map<String, Value>) -> Option<Self> {
        Some(Self {
            name: trimmed(object, "name"),
            main_doc: object.get("main_doc")?.as_str()?.to_owned(),
            engine: object
                .get("engine")
                .and_then(Value::as_str)
                .and_then(oleafly_core::Engine::named)
                .map(|engine| engine.manifest_name().to_owned()),
            tex_flavor: trimmed(object, "tex_flavor"),
            dictionary_locale: trimmed(object, "dictionary_locale")
                .filter(|locale| locale_token(locale)),
        })
    }
}

fn trimmed(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn locale_token(value: &str) -> bool {
    value.len() <= MAX_LOCALE_LENGTH
        && value.split(['-', '_']).all(|part| {
            !part.is_empty()
                && part.len() <= 8
                && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FolderManifest {
    Absent,
    Foreign,
    Oleafly(FolderFields),
}

pub(crate) fn inspect_folder_manifest(root: &Path) -> FolderManifest {
    let path = root.join(MANIFEST_FILE);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return FolderManifest::Absent
        }
        Err(_) => return FolderManifest::Foreign,
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_FOLDER_MANIFEST_BYTES
    {
        return FolderManifest::Foreign;
    }
    let Ok(bytes) = std::fs::read(&path) else {
        return FolderManifest::Foreign;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return FolderManifest::Foreign;
    };
    if !oleafly_core::is_oleafly_manifest(&value) {
        return FolderManifest::Foreign;
    }
    value
        .as_object()
        .and_then(FolderFields::from_object)
        .map_or(FolderManifest::Foreign, FolderManifest::Oleafly)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Route {
    Library(ProjectLocation),
    Sidecar {
        location: ProjectLocation,
        foreign: bool,
    },
    Split {
        location: ProjectLocation,
        folder: FolderFields,
    },
}

impl Route {
    pub(crate) fn location(&self) -> &ProjectLocation {
        match self {
            Self::Library(location)
            | Self::Sidecar { location, .. }
            | Self::Split { location, .. } => location,
        }
    }

    pub(crate) fn home(&self) -> ManifestHome {
        match self {
            Self::Library(_) => ManifestHome::Library,
            Self::Split { .. } => ManifestHome::Folder,
            Self::Sidecar { foreign: false, .. } => ManifestHome::Device,
            Self::Sidecar { foreign: true, .. } => ManifestHome::DeviceForeign,
        }
    }

    pub(crate) fn root_file_is_managed(&self) -> bool {
        matches!(self, Self::Library(_) | Self::Split { .. })
    }
}

pub(crate) fn route(mut location: ProjectLocation) -> Route {
    if location.kind == ProjectKind::Library {
        return Route::Library(location);
    }
    match inspect_folder_manifest(&location.root) {
        FolderManifest::Oleafly(folder) => {
            location.manifest = ManifestSource::Split;
            Route::Split { location, folder }
        }
        FolderManifest::Absent => Route::Sidecar {
            location,
            foreign: false,
        },
        FolderManifest::Foreign => Route::Sidecar {
            location,
            foreign: true,
        },
    }
}

pub(crate) fn route_project(project_id: &str) -> Result<Route, String> {
    Ok(route(crate::project_location::locate(project_id)?))
}

fn is_manifest_name(normalized: &str) -> bool {
    normalized.eq_ignore_ascii_case(MANIFEST_FILE)
}

pub(crate) fn project_root_file_is_managed(
    project_id: &str,
    normalized: &str,
) -> Result<bool, String> {
    if !is_manifest_name(normalized) {
        return Ok(false);
    }
    if crate::project_location::kind_of(project_id)? == ProjectKind::Library {
        return Ok(true);
    }
    Ok(route_project(project_id)?.root_file_is_managed())
}

pub(crate) fn location_root_file_is_managed(location: &ProjectLocation, normalized: &str) -> bool {
    is_manifest_name(normalized) && route(location.clone()).root_file_is_managed()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FieldChange {
    Set(&'static str, String),
    Remove(&'static str),
}

impl FieldChange {
    fn key(&self) -> &'static str {
        match self {
            Self::Set(key, _) | Self::Remove(key) => key,
        }
    }
}

struct Entry {
    key: String,
    key_start: usize,
    value_start: usize,
    value_end: usize,
}

struct TopLevel<'a>(Vec<(&'a str, &'a RawValue)>);

impl<'de> Deserialize<'de> for TopLevel<'de> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct Entries;

        impl<'de> Visitor<'de> for Entries {
            type Value = TopLevel<'de>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut entries = Vec::new();
                while let Some(key) = map.next_key::<&'de str>()? {
                    entries.push((key, map.next_value::<&'de RawValue>()?));
                }
                Ok(TopLevel(entries))
            }
        }

        deserializer.deserialize_map(Entries)
    }
}

fn entries(text: &str) -> Option<Vec<Entry>> {
    let TopLevel(raw) = serde_json::from_str::<TopLevel<'_>>(text).ok()?;
    let base = text.as_ptr() as usize;
    raw.into_iter()
        .map(|(key, value)| {
            let key_start = (key.as_ptr() as usize).checked_sub(base)?.checked_sub(1)?;
            let value_start = (value.get().as_ptr() as usize).checked_sub(base)?;
            let value_end = value_start.checked_add(value.get().len())?;
            let spans_match = text.get(value_start..value_end) == Some(value.get())
                && text.as_bytes().get(key_start) == Some(&b'"');
            spans_match.then(|| Entry {
                key: key.to_owned(),
                key_start,
                value_start,
                value_end,
            })
        })
        .collect()
}

fn line_break(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn apply_change(text: &str, change: &FieldChange) -> Option<String> {
    let entries = entries(text)?;
    let position = entries.iter().rposition(|entry| entry.key == change.key());
    let mut next = text.to_owned();
    match (change, position) {
        (FieldChange::Set(_, value), Some(index)) => {
            let entry = &entries[index];
            let rendered = serde_json::to_string(value).ok()?;
            next.replace_range(entry.value_start..entry.value_end, &rendered);
        }
        (FieldChange::Set(key, value), None) => {
            let last = entries.last()?;
            let indent = text[..last.key_start]
                .rsplit_once('\n')
                .map(|(_, tail)| tail)
                .filter(|tail| {
                    tail.chars()
                        .all(|character| character == ' ' || character == '\t')
                });
            let key_text = serde_json::to_string(key).ok()?;
            let rendered = serde_json::to_string(value).ok()?;
            let newline = line_break(text);
            let inserted = match indent {
                Some(indent) => format!(",{newline}{indent}{key_text}: {rendered}"),
                None => format!(",{key_text}:{rendered}"),
            };
            next.insert_str(last.value_end, &inserted);
        }
        (FieldChange::Remove(_), Some(index)) => {
            let entry = &entries[index];
            let range = match (index.checked_sub(1), entries.get(index + 1)) {
                (_, Some(following)) => entry.key_start..following.key_start,
                (Some(previous), None) => entries[previous].value_end..entry.value_end,
                (None, None) => entry.key_start..entry.value_end,
            };
            next.replace_range(range, "");
            return apply_change(&next, change);
        }
        (FieldChange::Remove(_), None) => {}
    }
    Some(next)
}

pub(crate) fn splice_manifest(text: &str, changes: &[FieldChange]) -> Option<String> {
    let mut next = text.to_owned();
    for change in changes {
        next = apply_change(&next, change)?;
    }
    let value: Value = serde_json::from_str(&next).ok()?;
    let object = value.as_object()?;
    let applied = changes.iter().all(|change| match change {
        FieldChange::Set(key, expected) => {
            object.get(*key).and_then(Value::as_str) == Some(expected.as_str())
        }
        FieldChange::Remove(key) => !object.contains_key(*key),
    });
    (applied && oleafly_core::is_oleafly_manifest(&value)).then_some(next)
}

fn rewrite_manifest(text: &str, changes: &[FieldChange]) -> Option<String> {
    let mut value: Value = serde_json::from_str(text).ok()?;
    let object = value.as_object_mut()?;
    for change in changes {
        match change {
            FieldChange::Set(key, next) => {
                object.insert((*key).to_owned(), Value::String(next.clone()));
            }
            FieldChange::Remove(key) => {
                object.remove(*key);
            }
        }
    }
    if !oleafly_core::is_oleafly_manifest(&value) {
        return None;
    }
    let newline = line_break(text);
    let mut rendered = serde_json::to_string_pretty(&value)
        .ok()?
        .replace('\n', newline);
    if text.ends_with('\n') {
        rendered.push_str(newline);
    }
    Some(rendered)
}

pub(crate) fn write_folder_fields(root: &Path, changes: &[FieldChange]) -> Result<bool, String> {
    if !matches!(inspect_folder_manifest(root), FolderManifest::Oleafly(_)) {
        return Err("project.json in this folder changed before Oleafly could update it".into());
    }
    let path = root.join(MANIFEST_FILE);
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read project.json: {error}"))?;
    let current: Value =
        serde_json::from_str(&text).map_err(|error| format!("invalid project.json: {error}"))?;
    let pending: Vec<FieldChange> = changes
        .iter()
        .filter(|change| match change {
            FieldChange::Set(key, value) => {
                current.get(*key).and_then(Value::as_str) != Some(value.as_str())
            }
            FieldChange::Remove(key) => current.get(*key).is_some(),
        })
        .cloned()
        .collect();
    if pending.is_empty() {
        return Ok(false);
    }
    let next = splice_manifest(&text, &pending)
        .or_else(|| rewrite_manifest(&text, &pending))
        .ok_or_else(|| "project.json could not be updated".to_string())?;
    crate::sandbox::atomic_write(&path, next.as_bytes())
        .map_err(|error| format!("failed to write project.json: {error}"))?;
    Ok(true)
}

#[derive(Debug, Clone, Copy, Serialize)]
pub(crate) struct FolderSettings<'a> {
    pub(crate) name: &'a str,
    pub(crate) main_doc: &'a str,
    pub(crate) engine: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tex_flavor: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) dictionary_locale: Option<&'a str>,
}

fn settings_write_failed(detail: impl ToString) -> String {
    AppError::new("project.settings_write_failed")
        .detail(detail)
        .into()
}

pub(crate) fn create_folder_manifest(
    root: &Path,
    settings: &FolderSettings<'_>,
) -> Result<(), String> {
    let mut bytes = serde_json::to_vec_pretty(settings).map_err(settings_write_failed)?;
    bytes.push(b'\n');
    let value: Value = serde_json::from_slice(&bytes).map_err(settings_write_failed)?;
    if !oleafly_core::is_oleafly_manifest(&value) {
        return Err(AppError::new("project.settings_need_main").into());
    }
    let path = root.join(MANIFEST_FILE);
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err(AppError::new("project.settings_file_exists").into());
    }
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(AppError::new("project.settings_file_exists").into())
        }
        Err(error) => return Err(settings_write_failed(error)),
    };
    if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(settings_write_failed(error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn linked_at(root: &Path) -> ProjectLocation {
        ProjectLocation {
            id: format!("{}{:032x}", crate::linked_registry::LINKED_ID_PREFIX, 7),
            kind: ProjectKind::Linked,
            root: root.to_path_buf(),
            state_dir: root.join("unused-state"),
            manifest: ManifestSource::Sidecar,
            compile_dir: root.to_path_buf(),
        }
    }

    #[test]
    fn folder_manifests_are_sniffed_without_trusting_their_shape() {
        let folder = tempfile::tempdir().unwrap();
        let manifest = folder.path().join("project.json");
        assert_eq!(
            inspect_folder_manifest(folder.path()),
            FolderManifest::Absent
        );
        let foreign: [&[u8]; 6] = [
            NX_PROJECT_JSON.as_bytes(),
            b"{\"version\":\"1.0.0-*\",\"frameworks\":{\"netstandard1.6\":{}}}",
            b"{not json",
            b"[\"main.tex\"]",
            b"{\"main_doc\":\"main.pdf\"}",
            b"{\"main_doc\":\"main.tex\",\"engine\":\"pdflatex-custom\"}",
        ];
        for bytes in foreign {
            std::fs::write(&manifest, bytes).unwrap();
            assert_eq!(
                inspect_folder_manifest(folder.path()),
                FolderManifest::Foreign,
                "{}",
                String::from_utf8_lossy(bytes)
            );
        }
        let mut oversized = b"{\"main_doc\":\"main.tex\",\"pad\":\"".to_vec();
        oversized.resize(1024 * 1024 + 8, b'a');
        oversized.extend_from_slice(b"\"}");
        std::fs::write(&manifest, oversized).unwrap();
        assert_eq!(
            inspect_folder_manifest(folder.path()),
            FolderManifest::Foreign
        );
        std::fs::remove_file(&manifest).unwrap();
        std::fs::create_dir(&manifest).unwrap();
        assert_eq!(
            inspect_folder_manifest(folder.path()),
            FolderManifest::Foreign
        );
        std::fs::remove_dir(&manifest).unwrap();
        std::fs::write(
            &manifest,
            br#"{"name":" Paper ","main_doc":"paper/main.tex","engine":"Tectonic","tex_flavor":"xelatex","dictionary_locale":"../../etc","allow_shell_escape":true}"#,
        )
        .unwrap();
        assert_eq!(
            inspect_folder_manifest(folder.path()),
            FolderManifest::Oleafly(FolderFields {
                name: Some("Paper".into()),
                main_doc: "paper/main.tex".into(),
                engine: Some("xetex".into()),
                tex_flavor: Some("xelatex".into()),
                dictionary_locale: None,
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_manifest_is_never_followed() {
        let folder = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(
            outside.path().join("project.json"),
            br#"{"main_doc":"main.tex"}"#,
        )
        .unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("project.json"),
            folder.path().join("project.json"),
        )
        .unwrap();
        assert_eq!(
            inspect_folder_manifest(folder.path()),
            FolderManifest::Foreign
        );
    }

    #[test]
    fn only_linked_folders_route_through_their_own_manifest() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(
            folder.path().join("project.json"),
            br#"{"main_doc":"main.tex"}"#,
        )
        .unwrap();
        let library = ProjectLocation::library_at("paper", folder.path().to_path_buf());
        assert_eq!(route(library.clone()), Route::Library(library.clone()));
        assert!(location_root_file_is_managed(&library, "Project.json"));
        assert!(!location_root_file_is_managed(
            &library,
            "notes/project.json"
        ));

        let routed = route(linked_at(folder.path()));
        assert_eq!(routed.home(), ManifestHome::Folder);
        assert_eq!(routed.location().manifest, ManifestSource::Split);
        assert_eq!(
            routed.location().manifest_path(),
            folder.path().join("unused-state").join("project.json")
        );
        assert!(routed.root_file_is_managed());

        std::fs::write(folder.path().join("project.json"), NX_PROJECT_JSON).unwrap();
        assert_eq!(
            route(linked_at(folder.path())).home(),
            ManifestHome::DeviceForeign
        );
        assert!(!location_root_file_is_managed(
            &linked_at(folder.path()),
            "PROJECT.JSON"
        ));

        std::fs::remove_file(folder.path().join("project.json")).unwrap();
        assert_eq!(route(linked_at(folder.path())).home(), ManifestHome::Device);
    }

    const CLI_MANIFEST: &str = "{\n  \"name\": \"Thesis\",\n  \"main_doc\": \"main.tex\",\n  \"engine\": \"xetex\",\n  \"color\": \"\",\n  \"checkpoints\": {\n    \"mode\": \"engine_dependencies\"\n  }\n}\n";

    #[test]
    fn a_splice_changes_only_the_named_values_and_keeps_the_file_layout() {
        assert_eq!(
            splice_manifest(
                CLI_MANIFEST,
                &[FieldChange::Set("main_doc", "chapters/thesis.tex".into())]
            )
            .unwrap(),
            CLI_MANIFEST.replace("\"main.tex\"", "\"chapters/thesis.tex\"")
        );
        assert_eq!(
            splice_manifest(
                CLI_MANIFEST,
                &[FieldChange::Set("dictionary_locale", "de-DE".into())]
            )
            .unwrap(),
            CLI_MANIFEST.replace(
                "\n  }\n}\n",
                "\n  },\n  \"dictionary_locale\": \"de-DE\"\n}\n"
            )
        );
        let flavored = CLI_MANIFEST.replace(
            "\"engine\": \"xetex\",",
            "\"engine\": \"latexmk\",\n  \"tex_flavor\": \"xelatex\",",
        );
        assert_eq!(
            splice_manifest(&flavored, &[FieldChange::Remove("tex_flavor")]).unwrap(),
            CLI_MANIFEST.replace("xetex", "latexmk")
        );
        let crlf = "{\r\n    \"main_doc\": \"main.tex\",\r\n    \"targets\": {\"b\": 1}\r\n}\r\n";
        assert_eq!(
            splice_manifest(crlf, &[FieldChange::Set("tex_flavor", "xelatex".into())]).unwrap(),
            "{\r\n    \"main_doc\": \"main.tex\",\r\n    \"targets\": {\"b\": 1},\r\n    \"tex_flavor\": \"xelatex\"\r\n}\r\n"
        );
        assert_eq!(
            splice_manifest(
                r#"{"main_doc":"main.tex","name":"A"}"#,
                &[
                    FieldChange::Set("engine", "typst".into()),
                    FieldChange::Set("name", "B".into())
                ]
            )
            .unwrap(),
            r#"{"main_doc":"main.tex","name":"B","engine":"typst"}"#
        );
    }

    #[test]
    fn a_manifest_that_cannot_be_spliced_is_rewritten_and_a_broken_result_is_refused() {
        let escaped = "{\"main_doc\":\"main.tex\",\"na\\u006de\":\"A\"}\n";
        assert_eq!(
            splice_manifest(escaped, &[FieldChange::Set("engine", "xetex".into())]),
            None
        );
        let rewritten =
            rewrite_manifest(escaped, &[FieldChange::Set("engine", "xetex".into())]).unwrap();
        let value: Value = serde_json::from_str(&rewritten).unwrap();
        assert_eq!(
            (value["engine"].as_str(), value["name"].as_str()),
            (Some("xetex"), Some("A"))
        );
        assert!(rewritten.ends_with("}\n"));
        let broken = [FieldChange::Set("main_doc", "main.pdf".into())];
        assert_eq!(splice_manifest(CLI_MANIFEST, &broken), None);
        assert_eq!(rewrite_manifest(CLI_MANIFEST, &broken), None);
    }

    #[test]
    fn folder_writes_skip_values_that_already_match() {
        let folder = tempfile::tempdir().unwrap();
        let manifest = folder.path().join("project.json");
        std::fs::write(&manifest, CLI_MANIFEST).unwrap();
        assert!(!write_folder_fields(
            folder.path(),
            &[
                FieldChange::Set("main_doc", "main.tex".into()),
                FieldChange::Remove("tex_flavor")
            ]
        )
        .unwrap());
        assert_eq!(std::fs::read_to_string(&manifest).unwrap(), CLI_MANIFEST);
        assert!(
            write_folder_fields(folder.path(), &[FieldChange::Set("name", "Draft".into())])
                .unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(&manifest).unwrap(),
            CLI_MANIFEST.replace("Thesis", "Draft")
        );
        let names: Vec<_> = std::fs::read_dir(folder.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(names, [std::ffi::OsString::from("project.json")]);
        std::fs::write(&manifest, NX_PROJECT_JSON).unwrap();
        assert!(
            write_folder_fields(folder.path(), &[FieldChange::Set("name", "Draft".into())])
                .is_err()
        );
        assert_eq!(std::fs::read_to_string(&manifest).unwrap(), NX_PROJECT_JSON);
    }

    #[test]
    fn saved_settings_are_created_only_where_the_name_is_free() {
        let folder = tempfile::tempdir().unwrap();
        let settings = FolderSettings {
            name: "Thesis",
            main_doc: "thesis.tex",
            engine: "xetex",
            tex_flavor: None,
            dictionary_locale: Some("en-GB"),
        };
        create_folder_manifest(folder.path(), &settings).unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.path().join("project.json")).unwrap(),
            "{\n  \"name\": \"Thesis\",\n  \"main_doc\": \"thesis.tex\",\n  \"engine\": \"xetex\",\n  \"dictionary_locale\": \"en-GB\"\n}\n"
        );
        let error = create_folder_manifest(folder.path(), &settings).unwrap_err();
        assert!(error.contains("project.settings_file_exists"), "{error}");
        let other = tempfile::tempdir().unwrap();
        let error = create_folder_manifest(
            other.path(),
            &FolderSettings {
                main_doc: "notes",
                ..settings
            },
        )
        .unwrap_err();
        assert!(error.contains("project.settings_need_main"), "{error}");
        assert!(!other.path().join("project.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_refuses_the_write_reports_a_translatable_error() {
        use std::os::unix::fs::PermissionsExt as _;
        let folder = tempfile::tempdir().unwrap();
        let locked = folder.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        let writable = std::fs::File::create(locked.join("probe")).is_ok();
        let result = create_folder_manifest(
            &locked,
            &FolderSettings {
                name: "Thesis",
                main_doc: "thesis.tex",
                engine: "xetex",
                tex_flavor: None,
                dictionary_locale: None,
            },
        );
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        if writable {
            return;
        }
        let error = result.unwrap_err();
        assert!(error.contains("project.settings_write_failed"), "{error}");
        assert!(!locked.join("project.json").exists());
    }
}
