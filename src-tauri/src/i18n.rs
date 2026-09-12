use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub const SUPPORTED: &[&str] = &["en", "zh-Hans"];
pub const DEFAULT: &str = "en";
pub const LOCALE_CHANGED_EVENT: &str = "i18n:locale-changed";

const SOURCES: &[(&str, &str)] = &[
    ("en", include_str!("../../src/i18n/locales/en/native.json")),
    (
        "zh-Hans",
        include_str!("../../src/i18n/locales/zh-Hans/native.json"),
    ),
];

type Catalog = HashMap<String, String>;

fn flatten(value: &Value, prefix: &str, out: &mut Catalog) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten(child, &path, out);
            }
        }
        Value::String(text) => {
            out.insert(prefix.to_string(), text.clone());
        }
        _ => {}
    }
}

fn catalogs() -> &'static HashMap<&'static str, Catalog> {
    static CATALOGS: OnceLock<HashMap<&'static str, Catalog>> = OnceLock::new();
    CATALOGS.get_or_init(|| {
        SOURCES
            .iter()
            .map(|(locale, source)| {
                let parsed: Value =
                    serde_json::from_str(source).expect("native catalog is valid JSON");
                let mut out = Catalog::new();
                flatten(&parsed, "", &mut out);
                (*locale, out)
            })
            .collect()
    })
}

pub fn catalog(locale: &str) -> &'static Catalog {
    catalogs()
        .get(locale)
        .unwrap_or_else(|| &catalogs()[DEFAULT])
}

pub fn resolve(tag: Option<&str>) -> &'static str {
    let Some(tag) = tag else { return DEFAULT };
    let lowered = tag.trim().to_lowercase();
    let stripped = lowered.split(['.', '@']).next().unwrap_or("");
    let parts: Vec<&str> = stripped
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .collect();
    let Some(language) = parts.first() else {
        return DEFAULT;
    };
    let canonical = if *language == "zh" {
        let traditional = parts[1..]
            .iter()
            .any(|part| matches!(*part, "hant" | "tw" | "hk" | "mo"));
        if traditional {
            "zh-Hant".to_string()
        } else {
            "zh-Hans".to_string()
        }
    } else {
        language.to_string()
    };
    let fallback = match canonical.as_str() {
        "zh-Hant" => Some("zh-Hans"),
        _ => None,
    };
    SUPPORTED
        .iter()
        .copied()
        .find(|supported| supported.eq_ignore_ascii_case(&canonical))
        .or_else(|| fallback.filter(|candidate| SUPPORTED.contains(candidate)))
        .unwrap_or(DEFAULT)
}

pub fn resolve_preference(preference: &str) -> &'static str {
    if preference == "system" {
        resolve(sys_locale::get_locale().as_deref())
    } else {
        resolve(Some(preference))
    }
}

fn current_cell() -> &'static RwLock<&'static str> {
    static CURRENT: OnceLock<RwLock<&'static str>> = OnceLock::new();
    CURRENT.get_or_init(|| RwLock::new(DEFAULT))
}

pub fn current() -> &'static str {
    *current_cell()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn set_current(locale: &str) {
    let resolved = resolve(Some(locale));
    *current_cell()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = resolved;
}

pub fn t_in(locale: &str, key: &str) -> String {
    catalog(locale)
        .get(key)
        .or_else(|| catalog(DEFAULT).get(key))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

pub fn t(key: &str) -> String {
    t_in(current(), key)
}

pub fn t_with_in(locale: &str, key: &str, params: &[(&str, &str)]) -> String {
    params
        .iter()
        .fold(t_in(locale, key), |text, (name, value)| {
            text.replace(&format!("{{{{{name}}}}}"), value)
        })
}

pub fn t_with(key: &str, params: &[(&str, &str)]) -> String {
    t_with_in(current(), key, params)
}

pub fn startup() {
    let preference = crate::config::read_config()
        .map(|config| config.ui_locale)
        .unwrap_or_else(|_| "system".to_string());
    set_current(resolve_preference(&preference));
}

fn valid_preference(preference: &str) -> bool {
    preference == "system" || SUPPORTED.contains(&preference)
}

#[tauri::command]
pub fn get_ui_locale() -> String {
    current().to_string()
}

#[tauri::command]
pub fn set_ui_locale(app: AppHandle, preference: String) -> Result<String, String> {
    if !valid_preference(&preference) {
        return Err(
            crate::app_error::AppError::new("settings.locale_unsupported")
                .param("locale", &preference)
                .into(),
        );
    }
    crate::config::update_config(|config| {
        config.ui_locale = preference.clone();
        Ok(())
    })?;
    let resolved = resolve_preference(&preference);
    set_current(resolved);
    crate::menu::rebuild(&app);
    let _ = app.emit(
        LOCALE_CHANGED_EVENT,
        serde_json::json!({ "locale": resolved, "preference": preference }),
    );
    Ok(resolved.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_locale_has_the_same_native_keys() {
        let mut expected: Vec<&String> = catalog("en").keys().collect();
        expected.sort();
        for locale in SUPPORTED {
            let mut actual: Vec<&String> = catalog(locale).keys().collect();
            actual.sort();
            assert_eq!(actual, expected, "native.json keys differ for {locale}");
        }
    }

    #[test]
    fn resolves_chinese_tags_like_the_frontend() {
        assert_eq!(resolve(Some("zh-CN")), "zh-Hans");
        assert_eq!(resolve(Some("zh_CN.UTF-8")), "zh-Hans");
        assert_eq!(resolve(Some("zh-Hant-TW")), "zh-Hans");
        assert_eq!(resolve(Some("en-GB")), "en");
        assert_eq!(resolve(Some("fr")), "en");
        assert_eq!(resolve(None), "en");
    }

    #[test]
    fn translates_with_fallback_and_params() {
        assert_eq!(t_in("zh-Hans", "menu.quit"), "退出 Oleafly");
        assert_eq!(t_in("en", "menu.quit"), "Quit Oleafly");
        assert_eq!(t_in("zh-Hans", "does.not.exist"), "does.not.exist");
        assert_eq!(
            t_with_in("en", "errors.menuItemUnavailable", &[("id", "about")]),
            "Menu item about is unavailable"
        );
    }

    #[test]
    fn validates_preferences() {
        assert!(valid_preference("system"));
        assert!(valid_preference("zh-Hans"));
        assert!(!valid_preference("zh"));
    }
}
