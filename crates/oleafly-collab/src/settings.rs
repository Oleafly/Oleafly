use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};

use loro::{LoroMap, LoroValue, ValueOrContainer};
use oleafly_collab_protocol::ids::{AccountId, FileId};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::doc::ProjectDoc;
use crate::live::LiveProject;
use crate::CollabError;

pub const SETTINGS: &str = "compile";
pub const MAX_VALUE_CHARS: usize = 64 * 1024;
pub const MAX_NAME_CHARS: usize = 64;
const LEGACY_MAIN_DOC: &str = "main_doc";
const LEGACY_ENGINE: &str = "engine";
const AUTO_FLAVOR: &str = "auto";
const ENGINE_EXTRA: &[char] = &['-', '_', '.'];
const FLAVOR_EXTRA: &[char] = &['-', '_'];
const LOCALE_EXTRA: &[char] = &['_', '-'];
const VERSION_EXTRA: &[char] = &['.', '-', '+'];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Setting {
    MainDoc,
    Engine,
    TexFlavor,
    DictionaryLocale,
    TypstVersion,
    TypstVendorPackages,
    TypstSystemFonts,
    TypstReproducible,
    TypstFontPaths,
    TypstInputs,
    TypstVariants,
}

impl Setting {
    pub const ALL: [Setting; 11] = [
        Setting::MainDoc,
        Setting::Engine,
        Setting::TexFlavor,
        Setting::DictionaryLocale,
        Setting::TypstVersion,
        Setting::TypstVendorPackages,
        Setting::TypstSystemFonts,
        Setting::TypstReproducible,
        Setting::TypstFontPaths,
        Setting::TypstInputs,
        Setting::TypstVariants,
    ];

    pub const fn key(self) -> &'static str {
        match self {
            Setting::MainDoc => "main_doc",
            Setting::Engine => "engine",
            Setting::TexFlavor => "tex_flavor",
            Setting::DictionaryLocale => "dictionary_locale",
            Setting::TypstVersion => "typst_version",
            Setting::TypstVendorPackages => "typst_vendor_packages",
            Setting::TypstSystemFonts => "typst_system_fonts",
            Setting::TypstReproducible => "typst_reproducible",
            Setting::TypstFontPaths => "typst_font_paths",
            Setting::TypstInputs => "typst_inputs",
            Setting::TypstVariants => "typst_variants",
        }
    }

    pub fn from_key(key: &str) -> Option<Setting> {
        Setting::ALL
            .into_iter()
            .find(|setting| setting.key() == key)
    }
}

fn plain(value: &str, extra: &[char]) -> Option<String> {
    let value = value.trim();
    let fits = !value.is_empty()
        && value.chars().count() <= MAX_NAME_CHARS
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || extra.contains(&character));
    fits.then(|| value.to_owned())
}

fn optional(value: &str, extra: &[char]) -> Option<Option<String>> {
    if value.trim().is_empty() {
        return Some(None);
    }
    plain(value, extra).map(Some)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Engine(String);

impl Engine {
    pub fn parse(value: &str) -> Option<Engine> {
        plain(value, ENGINE_EXTRA).map(Engine)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TexFlavor {
    Auto,
    Compiler(String),
}

impl TexFlavor {
    pub fn parse(value: &str) -> Option<TexFlavor> {
        match value.trim() {
            "" | AUTO_FLAVOR => Some(TexFlavor::Auto),
            named => plain(named, FLAVOR_EXTRA).map(TexFlavor::Compiler),
        }
    }

    pub fn of(flavor: Option<&str>) -> Option<TexFlavor> {
        flavor.map_or(Some(TexFlavor::Auto), TexFlavor::parse)
    }

    pub fn name(&self) -> Option<&str> {
        match self {
            TexFlavor::Auto => None,
            TexFlavor::Compiler(name) => Some(name.as_str()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DictionaryLocale(Option<String>);

impl DictionaryLocale {
    pub fn parse(value: &str) -> Option<DictionaryLocale> {
        optional(value, LOCALE_EXTRA).map(DictionaryLocale)
    }

    pub fn of(locale: Option<&str>) -> Option<DictionaryLocale> {
        locale.map_or(Some(DictionaryLocale(None)), DictionaryLocale::parse)
    }

    pub fn name(&self) -> Option<&str> {
        self.0.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstVersion(Option<String>);

impl TypstVersion {
    pub fn parse(value: &str) -> Option<TypstVersion> {
        optional(value, VERSION_EXTRA).map(TypstVersion)
    }

    pub fn of(version: Option<&str>) -> Option<TypstVersion> {
        version.map_or(Some(TypstVersion(None)), TypstVersion::parse)
    }

    pub fn pin(&self) -> Option<&str> {
        self.0.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ProjectPath(String);

impl ProjectPath {
    pub fn parse(path: &str) -> Option<ProjectPath> {
        let trimmed = path.trim().replace('\\', "/");
        let relative = Path::new(&trimmed);
        let inside = !trimmed.is_empty()
            && !relative.has_root()
            && !trimmed.contains(':')
            && relative
                .components()
                .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));
        inside.then_some(ProjectPath(trimmed))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub type TypstInputs = BTreeMap<String, String>;
pub type TypstVariants = BTreeMap<String, TypstInputs>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettingValue {
    MainDoc(FileId),
    Engine(Engine),
    TexFlavor(TexFlavor),
    DictionaryLocale(DictionaryLocale),
    TypstVersion(TypstVersion),
    TypstVendorPackages(bool),
    TypstSystemFonts(bool),
    TypstReproducible(bool),
    TypstFontPaths(Vec<ProjectPath>),
    TypstInputs(TypstInputs),
    TypstVariants(TypstVariants),
}

fn flag(raw: &str) -> Option<bool> {
    match raw {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn font_paths(raw: &str) -> Option<Vec<ProjectPath>> {
    serde_json::from_str::<Vec<String>>(raw)
        .ok()?
        .into_iter()
        .map(|path| ProjectPath::parse(&path))
        .collect()
}

fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

impl SettingValue {
    pub fn setting(&self) -> Setting {
        match self {
            SettingValue::MainDoc(_) => Setting::MainDoc,
            SettingValue::Engine(_) => Setting::Engine,
            SettingValue::TexFlavor(_) => Setting::TexFlavor,
            SettingValue::DictionaryLocale(_) => Setting::DictionaryLocale,
            SettingValue::TypstVersion(_) => Setting::TypstVersion,
            SettingValue::TypstVendorPackages(_) => Setting::TypstVendorPackages,
            SettingValue::TypstSystemFonts(_) => Setting::TypstSystemFonts,
            SettingValue::TypstReproducible(_) => Setting::TypstReproducible,
            SettingValue::TypstFontPaths(_) => Setting::TypstFontPaths,
            SettingValue::TypstInputs(_) => Setting::TypstInputs,
            SettingValue::TypstVariants(_) => Setting::TypstVariants,
        }
    }

    pub fn parse(setting: Setting, raw: &str) -> Option<SettingValue> {
        if raw.chars().count() > MAX_VALUE_CHARS {
            return None;
        }
        match setting {
            Setting::MainDoc => raw.parse().ok().map(SettingValue::MainDoc),
            Setting::Engine => Engine::parse(raw).map(SettingValue::Engine),
            Setting::TexFlavor => TexFlavor::parse(raw).map(SettingValue::TexFlavor),
            Setting::DictionaryLocale => {
                DictionaryLocale::parse(raw).map(SettingValue::DictionaryLocale)
            }
            Setting::TypstVersion => TypstVersion::parse(raw).map(SettingValue::TypstVersion),
            Setting::TypstVendorPackages => flag(raw).map(SettingValue::TypstVendorPackages),
            Setting::TypstSystemFonts => flag(raw).map(SettingValue::TypstSystemFonts),
            Setting::TypstReproducible => flag(raw).map(SettingValue::TypstReproducible),
            Setting::TypstFontPaths => font_paths(raw).map(SettingValue::TypstFontPaths),
            Setting::TypstInputs => serde_json::from_str(raw)
                .ok()
                .map(SettingValue::TypstInputs),
            Setting::TypstVariants => serde_json::from_str(raw)
                .ok()
                .map(SettingValue::TypstVariants),
        }
    }

    pub fn encode(&self) -> String {
        match self {
            SettingValue::MainDoc(id) => id.to_string(),
            SettingValue::Engine(engine) => engine.as_str().to_owned(),
            SettingValue::TexFlavor(flavor) => flavor.name().unwrap_or_default().to_owned(),
            SettingValue::DictionaryLocale(locale) => locale.name().unwrap_or_default().to_owned(),
            SettingValue::TypstVersion(version) => version.pin().unwrap_or_default().to_owned(),
            SettingValue::TypstVendorPackages(on)
            | SettingValue::TypstSystemFonts(on)
            | SettingValue::TypstReproducible(on) => on.to_string(),
            SettingValue::TypstFontPaths(paths) => {
                json(&paths.iter().map(ProjectPath::as_str).collect::<Vec<&str>>())
            }
            SettingValue::TypstInputs(inputs) => json(inputs),
            SettingValue::TypstVariants(variants) => json(variants),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Settings(BTreeMap<Setting, SettingValue>);

impl Settings {
    pub fn new() -> Settings {
        Settings::default()
    }

    pub fn insert(&mut self, value: SettingValue) -> Option<SettingValue> {
        self.0.insert(value.setting(), value)
    }

    pub fn get(&self, setting: Setting) -> Option<&SettingValue> {
        self.0.get(&setting)
    }

    pub fn remove(&mut self, setting: Setting) -> Option<SettingValue> {
        self.0.remove(&setting)
    }

    pub fn contains(&self, setting: Setting) -> bool {
        self.0.contains_key(&setting)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn keys(&self) -> impl Iterator<Item = Setting> + '_ {
        self.0.keys().copied()
    }

    pub fn values(&self) -> impl Iterator<Item = &SettingValue> {
        self.0.values()
    }

    pub fn main_doc(&self) -> Option<FileId> {
        match self.get(Setting::MainDoc) {
            Some(SettingValue::MainDoc(id)) => Some(*id),
            _ => None,
        }
    }

    pub fn engine(&self) -> Option<&Engine> {
        match self.get(Setting::Engine) {
            Some(SettingValue::Engine(engine)) => Some(engine),
            _ => None,
        }
    }

    pub fn tex_flavor(&self) -> Option<&TexFlavor> {
        match self.get(Setting::TexFlavor) {
            Some(SettingValue::TexFlavor(flavor)) => Some(flavor),
            _ => None,
        }
    }

    pub fn dictionary_locale(&self) -> Option<&DictionaryLocale> {
        match self.get(Setting::DictionaryLocale) {
            Some(SettingValue::DictionaryLocale(locale)) => Some(locale),
            _ => None,
        }
    }

    pub fn typst_version(&self) -> Option<&TypstVersion> {
        match self.get(Setting::TypstVersion) {
            Some(SettingValue::TypstVersion(version)) => Some(version),
            _ => None,
        }
    }

    pub fn typst_vendor_packages(&self) -> Option<bool> {
        match self.get(Setting::TypstVendorPackages) {
            Some(SettingValue::TypstVendorPackages(on)) => Some(*on),
            _ => None,
        }
    }

    pub fn typst_system_fonts(&self) -> Option<bool> {
        match self.get(Setting::TypstSystemFonts) {
            Some(SettingValue::TypstSystemFonts(on)) => Some(*on),
            _ => None,
        }
    }

    pub fn typst_reproducible(&self) -> Option<bool> {
        match self.get(Setting::TypstReproducible) {
            Some(SettingValue::TypstReproducible(on)) => Some(*on),
            _ => None,
        }
    }

    pub fn typst_font_paths(&self) -> Option<&[ProjectPath]> {
        match self.get(Setting::TypstFontPaths) {
            Some(SettingValue::TypstFontPaths(paths)) => Some(paths),
            _ => None,
        }
    }

    pub fn typst_inputs(&self) -> Option<&TypstInputs> {
        match self.get(Setting::TypstInputs) {
            Some(SettingValue::TypstInputs(inputs)) => Some(inputs),
            _ => None,
        }
    }

    pub fn typst_variants(&self) -> Option<&TypstVariants> {
        match self.get(Setting::TypstVariants) {
            Some(SettingValue::TypstVariants(variants)) => Some(variants),
            _ => None,
        }
    }
}

impl FromIterator<SettingValue> for Settings {
    fn from_iter<I: IntoIterator<Item = SettingValue>>(values: I) -> Settings {
        let mut settings = Settings::new();
        for value in values {
            settings.insert(value);
        }
        settings
    }
}

impl Serialize for Settings {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (setting, value) in &self.0 {
            map.serialize_entry(setting.key(), &value.encode())?;
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for Settings {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Settings, D::Error> {
        let stored = BTreeMap::<String, serde_json::Value>::deserialize(deserializer)?;
        Ok(stored
            .iter()
            .filter_map(|(key, raw)| SettingValue::parse(Setting::from_key(key)?, raw.as_str()?))
            .collect())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LegacySettings {
    pub main_doc: Option<ProjectPath>,
    pub engine: Option<Engine>,
}

enum Stored {
    Missing,
    Readable(SettingValue),
    Unreadable,
}

fn stored(map: &LoroMap, setting: Setting) -> Stored {
    match map.get(setting.key()) {
        None => Stored::Missing,
        Some(ValueOrContainer::Value(LoroValue::String(raw))) => {
            SettingValue::parse(setting, &raw).map_or(Stored::Unreadable, Stored::Readable)
        }
        Some(_) => Stored::Unreadable,
    }
}

impl ProjectDoc {
    pub fn settings(&self) -> Settings {
        let map = self.loro().get_map(SETTINGS);
        Setting::ALL
            .into_iter()
            .filter_map(|setting| match stored(&map, setting) {
                Stored::Readable(value) => Some(value),
                Stored::Missing | Stored::Unreadable => None,
            })
            .collect()
    }

    pub fn unreadable_settings(&self) -> BTreeSet<Setting> {
        let map = self.loro().get_map(SETTINGS);
        Setting::ALL
            .into_iter()
            .filter(|setting| matches!(stored(&map, *setting), Stored::Unreadable))
            .collect()
    }

    pub fn set_settings(&mut self, settings: &Settings) -> Result<bool, CollabError> {
        let current = self.settings();
        let map = self.loro().get_map(SETTINGS);
        let mut changed = false;
        for value in settings.values() {
            let encoded = value.encode();
            if current.get(value.setting()) == Some(value)
                || encoded.chars().count() > MAX_VALUE_CHARS
            {
                continue;
            }
            map.insert(value.setting().key(), encoded.as_str())
                .map_err(|error| CollabError::Corrupt(format!("{error:?}")))?;
            changed = true;
        }
        if changed {
            self.loro().commit();
        }
        Ok(changed)
    }

    pub fn setting_writer(&self, setting: Setting) -> Option<u64> {
        self.loro().get_map(SETTINGS).get_last_editor(setting.key())
    }

    pub fn setting_author(&self, setting: Setting) -> Option<AccountId> {
        self.authors().account_of(self.setting_writer(setting)?)
    }

    pub fn legacy_settings(&self) -> LegacySettings {
        LegacySettings {
            main_doc: self
                .meta(LEGACY_MAIN_DOC)
                .as_deref()
                .and_then(ProjectPath::parse),
            engine: self.meta(LEGACY_ENGINE).as_deref().and_then(Engine::parse),
        }
    }

    pub fn set_legacy_settings(&mut self, legacy: &LegacySettings) -> Result<(), CollabError> {
        if let Some(main) = &legacy.main_doc {
            self.set_meta(LEGACY_MAIN_DOC, main.as_str())?;
        }
        if let Some(engine) = &legacy.engine {
            self.set_meta(LEGACY_ENGINE, engine.as_str())?;
        }
        Ok(())
    }
}

impl LiveProject {
    pub fn write_settings(&mut self, settings: &Settings) -> Result<bool, CollabError> {
        if !self.can_edit() || settings.is_empty() {
            return Ok(false);
        }
        self.doc_mut().set_settings(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::NodeKind;
    use oleafly_collab_protocol::projects::ProjectRole;

    fn pair() -> (ProjectDoc, ProjectDoc) {
        let mut owner = ProjectDoc::create().unwrap();
        owner
            .add_node(None, "main.tex", NodeKind::Text, None, "Hello\n")
            .unwrap();
        let joiner = ProjectDoc::load(&owner.snapshot().unwrap()).unwrap();
        (owner, joiner)
    }

    fn settings(entries: &[(Setting, &str)]) -> Settings {
        entries
            .iter()
            .map(|(setting, value)| {
                SettingValue::parse(*setting, value)
                    .unwrap_or_else(|| panic!("{value:?} is a readable {setting:?}"))
            })
            .collect()
    }

    fn wire(settings: &Settings, setting: Setting) -> Option<String> {
        settings.get(setting).map(SettingValue::encode)
    }

    fn raw(doc: &ProjectDoc, key: &str) -> Option<LoroValue> {
        doc.loro()
            .get_map(SETTINGS)
            .get(key)
            .and_then(|value| value.into_value().ok())
    }

    fn exchange(left: &mut ProjectDoc, right: &mut ProjectDoc) {
        let to_right = left.export_since(&right.version()).unwrap();
        let to_left = right.export_since(&left.version()).unwrap();
        right.import(&to_right).unwrap();
        left.import(&to_left).unwrap();
    }

    fn every_setting() -> Settings {
        let inputs: TypstInputs = [("draft".to_owned(), "true".to_owned())].into();
        let variants: TypstVariants = [(
            "camera".to_owned(),
            [("draft".to_owned(), "false".to_owned())].into(),
        )]
        .into();
        [
            SettingValue::MainDoc(FileId::new_v7()),
            SettingValue::Engine(Engine::parse("latexmk").unwrap()),
            SettingValue::TexFlavor(TexFlavor::Compiler("xelatex".to_owned())),
            SettingValue::DictionaryLocale(DictionaryLocale::of(Some("en_GB")).unwrap()),
            SettingValue::TypstVersion(TypstVersion::of(Some("0.13.1")).unwrap()),
            SettingValue::TypstVendorPackages(true),
            SettingValue::TypstSystemFonts(false),
            SettingValue::TypstReproducible(true),
            SettingValue::TypstFontPaths(vec![
                ProjectPath::parse("fonts").unwrap(),
                ProjectPath::parse("assets\\type").unwrap(),
            ]),
            SettingValue::TypstInputs(inputs),
            SettingValue::TypstVariants(variants),
        ]
        .into_iter()
        .collect()
    }

    #[test]
    fn compile_settings_travel_with_the_document_and_each_setting_keeps_its_last_writer() {
        let (mut alice, mut bob) = pair();
        assert!(alice
            .set_settings(&settings(&[
                (Setting::Engine, "latexmk"),
                (Setting::TexFlavor, "pdflatex"),
                (Setting::DictionaryLocale, "en_GB"),
            ]))
            .unwrap());
        assert!(!alice
            .set_settings(&settings(&[(Setting::Engine, "latexmk")]))
            .unwrap());
        exchange(&mut alice, &mut bob);
        assert_eq!(bob.settings(), alice.settings());
        assert_eq!(
            wire(&bob.settings(), Setting::TexFlavor).as_deref(),
            Some("pdflatex")
        );
        let loaded = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        assert_eq!(loaded.settings(), alice.settings());

        alice
            .set_settings(&settings(&[(Setting::TexFlavor, "xelatex")]))
            .unwrap();
        bob.set_settings(&settings(&[(Setting::DictionaryLocale, "de_DE")]))
            .unwrap();
        exchange(&mut alice, &mut bob);
        assert_eq!(alice.settings(), bob.settings());
        assert_eq!(
            wire(&alice.settings(), Setting::TexFlavor).as_deref(),
            Some("xelatex")
        );
        assert_eq!(
            wire(&alice.settings(), Setting::DictionaryLocale).as_deref(),
            Some("de_DE")
        );
        assert_eq!(
            alice.setting_writer(Setting::TexFlavor),
            Some(alice.peer_id())
        );
        assert_eq!(
            alice.setting_writer(Setting::DictionaryLocale),
            Some(bob.peer_id())
        );

        alice
            .set_settings(&settings(&[(Setting::Engine, "xetex")]))
            .unwrap();
        bob.set_settings(&settings(&[(Setting::Engine, "typst")]))
            .unwrap();
        exchange(&mut alice, &mut bob);
        assert_eq!(alice.settings(), bob.settings());
        assert_eq!(
            wire(&alice.settings(), Setting::TexFlavor).as_deref(),
            Some("xelatex")
        );
    }

    #[test]
    fn a_peer_cannot_slip_shell_escape_or_unknown_keys_into_the_settings() {
        let (mut alice, mut bob) = pair();
        let map = alice.loro().get_map(SETTINGS);
        map.insert("allow_shell_escape", "true").unwrap();
        map.insert("shell_escape", true).unwrap();
        map.insert("engine", 7).unwrap();
        map.insert("tex_flavor", "x".repeat(MAX_VALUE_CHARS + 1))
            .unwrap();
        map.insert("dictionary_locale", "fr_FR").unwrap();
        alice.loro().commit();
        exchange(&mut alice, &mut bob);
        assert_eq!(
            bob.settings(),
            settings(&[(Setting::DictionaryLocale, "fr_FR")])
        );
        assert_eq!(
            bob.unreadable_settings(),
            [Setting::Engine, Setting::TexFlavor].into()
        );
        assert!(Setting::ALL
            .iter()
            .all(|setting| !setting.key().contains("shell")));
    }

    #[test]
    fn values_this_version_cannot_read_are_ignored() {
        let (mut alice, mut bob) = pair();
        let map = alice.loro().get_map(SETTINGS);
        map.insert("main_doc", "../main.tex").unwrap();
        map.insert("engine", "latexmk; rm -rf /").unwrap();
        map.insert("tex_flavor", "../../bin/sh").unwrap();
        map.insert("dictionary_locale", "en GB").unwrap();
        map.insert("typst_version", "0.13 && curl").unwrap();
        map.insert("typst_vendor_packages", "yes").unwrap();
        map.insert("typst_system_fonts", "TRUE").unwrap();
        map.insert("typst_reproducible", true).unwrap();
        map.insert("typst_font_paths", r#"["fonts","/etc","../up"]"#)
            .unwrap();
        map.insert("typst_inputs", r#"{"draft":true}"#).unwrap();
        map.insert("typst_variants", r#"["camera"]"#).unwrap();
        alice.loro().commit();
        exchange(&mut alice, &mut bob);
        assert_eq!(bob.settings(), Settings::new());
        assert_eq!(
            bob.unreadable_settings(),
            Setting::ALL.into_iter().collect::<BTreeSet<Setting>>()
        );
    }

    #[test]
    fn keys_a_newer_release_adds_survive_this_release_writing_settings() {
        let (mut alice, mut bob) = pair();
        let map = alice.loro().get_map(SETTINGS);
        map.insert("typst_features", r#"["html"]"#).unwrap();
        map.insert("compile_dir", 3).unwrap();
        alice.loro().commit();
        exchange(&mut alice, &mut bob);
        bob.set_settings(&settings(&[(Setting::Engine, "latexmk")]))
            .unwrap();
        exchange(&mut alice, &mut bob);
        for doc in [&alice, &bob] {
            assert_eq!(
                raw(doc, "typst_features"),
                Some(LoroValue::from(r#"["html"]"#))
            );
            assert_eq!(raw(doc, "compile_dir"), Some(LoroValue::from(3)));
        }
    }

    #[test]
    fn every_setting_round_trips_as_a_typed_value() {
        let (mut alice, mut bob) = pair();
        let every = every_setting();
        assert_eq!(every.len(), Setting::ALL.len());
        for value in every.values() {
            assert_eq!(
                SettingValue::parse(value.setting(), &value.encode()).as_ref(),
                Some(value)
            );
        }
        assert!(alice.set_settings(&every).unwrap());
        assert!(!alice.set_settings(&every).unwrap());
        exchange(&mut alice, &mut bob);
        assert_eq!(bob.settings(), every);
        assert!(bob.unreadable_settings().is_empty());
        let loaded = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        assert_eq!(loaded.settings(), every);
        let stored: Settings =
            serde_json::from_str(&serde_json::to_string(&every).unwrap()).unwrap();
        assert_eq!(stored, every);
        assert_eq!(
            every
                .typst_font_paths()
                .map(|paths| paths.iter().map(ProjectPath::as_str).collect::<Vec<&str>>()),
            Some(vec!["fonts", "assets/type"])
        );
    }

    #[test]
    fn a_document_written_by_the_previous_release_reads_the_same() {
        let (mut alice, mut bob) = pair();
        let main = FileId::new_v7().to_string();
        let written = [
            ("main_doc", main.as_str()),
            ("engine", "latexmk"),
            ("tex_flavor", "xelatex"),
            ("dictionary_locale", "en_GB"),
            ("typst_version", "0.13.1"),
            ("typst_vendor_packages", "false"),
            ("typst_system_fonts", "false"),
            ("typst_reproducible", "true"),
            ("typst_font_paths", r#"["fonts"]"#),
            ("typst_inputs", r#"{"draft":"true"}"#),
            ("typst_variants", r#"{"camera":{"draft":"false"}}"#),
        ];
        let map = alice.loro().get_map(SETTINGS);
        for (key, value) in written {
            map.insert(key, value).unwrap();
        }
        alice.loro().commit();
        exchange(&mut alice, &mut bob);
        let read = bob.settings();
        assert_eq!(read.len(), Setting::ALL.len());
        assert_eq!(read.main_doc().map(|id| id.to_string()), Some(main.clone()));
        assert_eq!(read.engine().map(Engine::as_str), Some("latexmk"));
        assert_eq!(
            read.tex_flavor(),
            Some(&TexFlavor::Compiler("xelatex".to_owned()))
        );
        assert_eq!(
            read.dictionary_locale().and_then(DictionaryLocale::name),
            Some("en_GB")
        );
        assert_eq!(
            read.typst_version().and_then(TypstVersion::pin),
            Some("0.13.1")
        );
        assert_eq!(read.typst_vendor_packages(), Some(false));
        assert_eq!(read.typst_system_fonts(), Some(false));
        assert_eq!(read.typst_reproducible(), Some(true));
        assert_eq!(
            read.typst_font_paths(),
            Some(&[ProjectPath::parse("fonts").unwrap()][..])
        );
        assert_eq!(
            read.typst_inputs().map(|inputs| &inputs["draft"][..]),
            Some("true")
        );
        assert_eq!(
            read.typst_variants()
                .map(|variants| &variants["camera"]["draft"][..]),
            Some("false")
        );
        for (key, value) in written {
            let setting = Setting::from_key(key).unwrap();
            assert_eq!(wire(&read, setting).as_deref(), Some(value));
        }
        assert!(!bob.set_settings(&read).unwrap());

        let unset = [
            ("tex_flavor", ""),
            ("dictionary_locale", ""),
            ("typst_version", ""),
        ];
        let map = alice.loro().get_map(SETTINGS);
        for (key, value) in unset {
            map.insert(key, value).unwrap();
        }
        alice.loro().commit();
        exchange(&mut alice, &mut bob);
        let read = bob.settings();
        assert_eq!(read.tex_flavor(), Some(&TexFlavor::Auto));
        assert_eq!(
            read.dictionary_locale().map(DictionaryLocale::name),
            Some(None)
        );
        assert_eq!(read.typst_version().map(TypstVersion::pin), Some(None));
        for (key, value) in unset {
            assert_eq!(
                wire(&read, Setting::from_key(key).unwrap()).as_deref(),
                Some(value)
            );
        }
        assert!(!bob.set_settings(&read).unwrap());
    }

    #[test]
    fn the_settings_of_a_project_shared_before_they_travelled_are_read_safely() {
        let (mut alice, _) = pair();
        alice.set_meta("main_doc", "chapters/thesis.tex").unwrap();
        alice.set_meta("engine", "latexmk").unwrap();
        assert_eq!(
            alice.legacy_settings(),
            LegacySettings {
                main_doc: ProjectPath::parse("chapters/thesis.tex"),
                engine: Engine::parse("latexmk"),
            }
        );
        alice.set_meta("main_doc", "/etc/passwd").unwrap();
        alice.set_meta("engine", "rm -rf ~").unwrap();
        assert_eq!(alice.legacy_settings(), LegacySettings::default());
        alice
            .set_legacy_settings(&LegacySettings {
                main_doc: ProjectPath::parse("paper.tex"),
                engine: Engine::parse("typst"),
            })
            .unwrap();
        assert_eq!(alice.meta("main_doc").as_deref(), Some("paper.tex"));
        assert_eq!(alice.meta("engine").as_deref(), Some("typst"));
    }

    #[test]
    fn only_someone_who_can_edit_writes_the_shared_settings() {
        let (_, joiner) = pair();
        let mut viewer = LiveProject::new(joiner, 0, ProjectRole::Viewer);
        let before = viewer.doc().version();
        let change = settings(&[(Setting::Engine, "latexmk")]);
        assert!(!viewer.write_settings(&change).unwrap());
        assert_eq!(viewer.doc().version(), before);
        assert!(viewer.doc().settings().is_empty());
        viewer.set_role(ProjectRole::Editor);
        assert!(!viewer.write_settings(&Settings::new()).unwrap());
        assert!(viewer.write_settings(&change).unwrap());
        assert_eq!(viewer.doc().settings(), change);
    }

    #[test]
    fn a_setting_names_the_account_the_server_saw_write_it() {
        let (mut alice, bob) = pair();
        let mut bob = LiveProject::new(bob, 0, ProjectRole::Editor);
        let alice_account = AccountId::new_v7();
        let since = bob.doc().version();
        alice
            .set_settings(&settings(&[(Setting::Engine, "latexmk")]))
            .unwrap();
        bob.import_update_from(1, &alice.export_since(&since).unwrap(), Some(alice_account))
            .unwrap();
        assert_eq!(
            wire(&bob.doc().settings(), Setting::Engine).as_deref(),
            Some("latexmk")
        );
        assert_eq!(
            bob.doc().setting_author(Setting::Engine),
            Some(alice_account)
        );
        assert_eq!(bob.doc().setting_author(Setting::TexFlavor), None);
        bob.doc_mut()
            .set_settings(&settings(&[(Setting::Engine, "xetex")]))
            .unwrap();
        assert_eq!(
            bob.doc().setting_writer(Setting::Engine),
            Some(bob.doc().peer_id())
        );
        assert_eq!(bob.doc().setting_author(Setting::Engine), None);
    }
}
