use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontFamily {
    pub name: String,
    pub monospace: bool,
}

fn listable(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.chars().any(char::is_control)
}

fn font_families<'a>(faces: impl IntoIterator<Item = (&'a str, bool)>) -> Vec<SystemFontFamily> {
    let mut families: BTreeMap<String, SystemFontFamily> = BTreeMap::new();
    for (name, monospace) in faces {
        let name = name.trim();
        if !listable(name) {
            continue;
        }
        families
            .entry(name.to_lowercase())
            .and_modify(|family| family.monospace &= monospace)
            .or_insert_with(|| SystemFontFamily {
                name: name.to_owned(),
                monospace,
            });
    }
    families.into_values().collect()
}

fn installed_font_families() -> Vec<SystemFontFamily> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    font_families(database.faces().filter_map(|face| {
        face.families
            .first()
            .map(|(name, _)| (name.as_str(), face.monospaced))
    }))
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFontFamily>, String> {
    tauri::async_runtime::spawn_blocking(installed_font_families)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn family(name: &str, monospace: bool) -> SystemFontFamily {
        SystemFontFamily {
            name: name.to_owned(),
            monospace,
        }
    }

    #[test]
    fn each_family_is_listed_once_in_name_order() {
        let families = font_families([
            ("iA Writer Quattro S", false),
            ("Fira Code", true),
            ("iA Writer Quattro S", false),
            ("Arial", false),
        ]);
        assert_eq!(
            families,
            [
                family("Arial", false),
                family("Fira Code", true),
                family("iA Writer Quattro S", false),
            ]
        );
    }

    #[test]
    fn a_family_is_monospaced_only_when_every_face_is() {
        let families = font_families([
            ("JetBrains Mono", true),
            ("JetBrains Mono", true),
            ("Mixed", true),
            ("Mixed", false),
        ]);
        assert_eq!(
            families,
            [family("JetBrains Mono", true), family("Mixed", false)]
        );
    }

    #[test]
    fn names_differing_only_in_case_share_one_entry() {
        let families = font_families([("IBM Plex Mono", true), ("ibm plex mono", true)]);
        assert_eq!(families, [family("IBM Plex Mono", true)]);
    }

    #[test]
    fn hidden_blank_and_control_character_names_are_left_out() {
        let families = font_families([
            (".SF NS", false),
            ("   ", false),
            ("", true),
            ("Bad\u{0}Name", false),
            ("  Menlo  ", true),
        ]);
        assert_eq!(families, [family("Menlo", true)]);
    }

    #[test]
    fn the_installed_list_is_sorted_and_free_of_hidden_families() {
        let families = installed_font_families();
        assert!(families.iter().all(|family| listable(&family.name)));
        assert!(families
            .windows(2)
            .all(|pair| pair[0].name.to_lowercase() < pair[1].name.to_lowercase()));
    }
}
