use serde_json::{json, Value};

use super::history::may_root;
use super::{restricted, text_reply, Privilege, Reply, State};

pub(super) const SAFE_COMPILERS: [&str; 4] = ["pdflatex", "latex", "xelatex", "lualatex"];

pub(super) fn default_languages() -> Vec<(String, String)> {
    [
        ("en", "English"),
        ("en_US", "English (American)"),
        ("en_GB", "English (British)"),
        ("de", "German"),
        ("fr", "French"),
        ("pt_BR", "Portuguese (Brazilian)"),
        ("no", "Norwegian"),
    ]
    .into_iter()
    .map(|(code, name)| (code.to_string(), name.to_string()))
    .collect()
}

fn invalid(what: &str) -> Reply {
    text_reply(500, &format!("invalid {what}"))
}

impl State {
    pub(super) fn settings_metas(&self) -> Vec<(&'static str, &'static str, String)> {
        let images: Vec<Value> = self
            .config
            .image_names
            .iter()
            .map(|(name, description)| json!({ "imageName": name, "imageDesc": description, "allowed": true }))
            .collect();
        let languages: Vec<Value> = self
            .config
            .languages
            .iter()
            .map(|(code, name)| json!({ "code": code, "name": name }))
            .collect();
        vec![
            ("ol-imageNames", "json", Value::Array(images).to_string()),
            ("ol-languages", "json", Value::Array(languages).to_string()),
        ]
    }

    fn doc_named(&self, id: &str) -> Option<&str> {
        self.docs.get(id).map(|doc| doc.name.as_str())
    }

    pub(super) fn update_settings(&mut self, body: &[u8], user: &str) -> Reply {
        let Ok(settings) = serde_json::from_slice::<Value>(body) else {
            return Reply::status(400);
        };
        let field = |key: &str| {
            settings
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let known = [
            "compiler",
            "imageName",
            "png2pdf",
            "name",
            "spellCheckLanguage",
            "rootDocId",
            "mainBibliographyDocId",
            "referenceFormat",
        ];
        if settings
            .as_object()
            .is_some_and(|keys| keys.keys().any(|key| !known.contains(&key.as_str())))
        {
            return text_reply(400, "unknown setting");
        }
        if settings.get("name").is_some() && self.privilege(user) != Some(Privilege::Owner) {
            return restricted();
        }
        if let Some(compiler) = field("compiler") {
            let normalized = compiler.to_ascii_lowercase();
            if !compiler.is_empty() && !SAFE_COMPILERS.contains(&normalized.as_str()) {
                return invalid("compiler");
            }
            if !compiler.is_empty() {
                self.compiler = normalized;
            }
            self.emit_room("compilerUpdated", &[json!(compiler)], None);
        }
        if let Some(image) = field("imageName") {
            let listed = self
                .config
                .image_names
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case(&image));
            if !self.config.image_names.is_empty() && !listed {
                return invalid("imageName");
            }
            self.image_name = Some(if listed {
                image.to_ascii_lowercase()
            } else {
                image.rsplit('/').next().unwrap_or_default().to_string()
            });
            self.emit_room("imageNameUpdated", &[json!(image)], None);
        }
        if let Some(name) = field("name") {
            self.project_name.clone_from(&name);
            self.emit_room("projectNameUpdated", &[json!(name)], None);
        }
        if let Some(language) = field("spellCheckLanguage") {
            let known = self
                .config
                .languages
                .iter()
                .any(|(code, _)| *code == language);
            if !language.is_empty() && !known {
                return invalid("languageCode");
            }
            self.spell_language.clone_from(&language);
            self.emit_room("spellCheckLanguageUpdated", &[json!(language)], None);
        }
        if let Some(doc) = field("rootDocId") {
            let Some(name) = self.doc_named(&doc) else {
                return Reply::status(404);
            };
            if !may_root(name) {
                return invalid("rootDocId");
            }
            self.root_doc = Some(doc.clone());
            self.emit_room("rootDocUpdated", &[json!(doc)], None);
        }
        if let Some(doc) = field("mainBibliographyDocId") {
            let bib = self
                .doc_named(&doc)
                .is_some_and(|name| name.to_ascii_lowercase().ends_with(".bib"));
            if !bib {
                return invalid("mainBibliographyDocId");
            }
            self.main_bibliography = Some(doc.clone());
            self.emit_room("mainBibliographyDocUpdated", &[json!(doc)], None);
        }
        for (key, event) in [
            ("png2pdf", "png2pdfUpdated"),
            ("referenceFormat", "referenceFormatUpdated"),
        ] {
            if let Some(value) = settings.get(key) {
                self.emit_room(event, std::slice::from_ref(value), None);
            }
        }
        Reply::status(204)
    }
}
