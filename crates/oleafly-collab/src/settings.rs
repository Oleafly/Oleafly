use std::collections::BTreeMap;

use loro::{LoroValue, ValueOrContainer};
use oleafly_collab_protocol::ids::AccountId;
use serde::{Deserialize, Serialize};

use crate::doc::ProjectDoc;
use crate::CollabError;

pub const SETTINGS: &str = "compile";
pub const MAX_VALUE_CHARS: usize = 64 * 1024;

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
}

pub type Settings = BTreeMap<Setting, String>;

fn readable(value: &str) -> bool {
    value.chars().count() <= MAX_VALUE_CHARS
}

impl ProjectDoc {
    pub fn settings(&self) -> Settings {
        let map = self.loro().get_map(SETTINGS);
        Setting::ALL
            .into_iter()
            .filter_map(|setting| match map.get(setting.key()) {
                Some(ValueOrContainer::Value(LoroValue::String(value))) if readable(&value) => {
                    Some((setting, value.to_string()))
                }
                _ => None,
            })
            .collect()
    }

    pub fn set_settings(&mut self, settings: &Settings) -> Result<bool, CollabError> {
        let current = self.settings();
        let map = self.loro().get_map(SETTINGS);
        let mut changed = false;
        for (setting, value) in settings {
            if current.get(setting) == Some(value) || !readable(value) {
                continue;
            }
            map.insert(setting.key(), value.as_str())
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::NodeKind;
    use crate::live::LiveProject;
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
            .map(|(setting, value)| (*setting, (*value).to_owned()))
            .collect()
    }

    fn exchange(left: &mut ProjectDoc, right: &mut ProjectDoc) {
        let to_right = left.export_since(&right.version()).unwrap();
        let to_left = right.export_since(&left.version()).unwrap();
        right.import(&to_right).unwrap();
        left.import(&to_left).unwrap();
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
        assert_eq!(bob.settings()[&Setting::TexFlavor], "pdflatex");
        let loaded = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
        assert_eq!(loaded.settings(), alice.settings());

        alice
            .set_settings(&settings(&[(Setting::TexFlavor, "xelatex")]))
            .unwrap();
        bob.set_settings(&settings(&[(Setting::DictionaryLocale, "de_DE")]))
            .unwrap();
        exchange(&mut alice, &mut bob);
        assert_eq!(alice.settings(), bob.settings());
        assert_eq!(alice.settings()[&Setting::TexFlavor], "xelatex");
        assert_eq!(alice.settings()[&Setting::DictionaryLocale], "de_DE");
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
        assert_eq!(alice.settings()[&Setting::TexFlavor], "xelatex");
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
        assert!(Setting::ALL
            .iter()
            .all(|setting| !setting.key().contains("shell")));
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
        assert_eq!(bob.doc().settings()[&Setting::Engine], "latexmk");
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
