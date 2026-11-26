use serde_json::{Map, Value};

use super::{ProjectRest, RestError};
use crate::realtime::events::{plain_id, DocId};
use crate::realtime::{ImageChoice, SpellLanguage};
use crate::session::SessionHandle;

pub const COMPILERS: [&str; 4] = ["pdflatex", "latex", "xelatex", "lualatex"];
const MAX_SETTING_CHARS: usize = 200;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SettingsUpdate {
    pub root_doc: Option<DocId>,
    pub compiler: Option<String>,
    pub image: Option<String>,
    pub spelling: Option<String>,
    pub bibliography: Option<DocId>,
}

fn refused(message: &str) -> RestError {
    RestError::Refused {
        status: 400,
        message: message.to_string(),
    }
}

fn plain_value(value: &str) -> bool {
    value.chars().count() <= MAX_SETTING_CHARS && !value.chars().any(char::is_control)
}

impl SettingsUpdate {
    pub fn is_empty(&self) -> bool {
        *self == SettingsUpdate::default()
    }

    fn body(&self) -> Result<Value, RestError> {
        let mut body = Map::new();
        for (key, doc) in [
            ("rootDocId", &self.root_doc),
            ("mainBibliographyDocId", &self.bibliography),
        ] {
            if let Some(doc) = doc {
                if !plain_id(&doc.0) {
                    return Err(refused("a document id with unexpected characters"));
                }
                body.insert(key.into(), Value::String(doc.0.clone()));
            }
        }
        if let Some(compiler) = &self.compiler {
            if !COMPILERS.contains(&compiler.as_str()) {
                return Err(refused("a compiler Overleaf doesn't run"));
            }
            body.insert("compiler".into(), Value::String(compiler.clone()));
        }
        for (key, value) in [
            ("imageName", &self.image),
            ("spellCheckLanguage", &self.spelling),
        ] {
            if let Some(value) = value {
                if !plain_value(value) {
                    return Err(refused("a setting with unexpected characters"));
                }
                body.insert(key.into(), Value::String(value.clone()));
            }
        }
        Ok(Value::Object(body))
    }
}

impl ProjectRest {
    pub fn choices(&self) -> (Vec<ImageChoice>, Vec<SpellLanguage>) {
        (self.page.image_names(), self.page.languages())
    }

    pub async fn update_settings(
        &self,
        session: &SessionHandle,
        update: &SettingsUpdate,
    ) -> Result<(), RestError> {
        if update.is_empty() {
            return Ok(());
        }
        let body = update.body()?;
        let route = self.route("/settings");
        self.write(session, |cookie| self.http.post(&route, cookie).json(&body))
            .await
            .map(drop)
    }
}
