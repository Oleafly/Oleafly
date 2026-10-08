use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontFamily {
    pub name: String,
    pub monospace: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FaceTraits {
    monospace: bool,
    symbol_only: bool,
}

const PICTURE_FAMILIES: &[&str] = &[
    "Bodoni Ornaments",
    "Material Icons",
    "Material Symbols",
    "Symbol",
    "Webdings",
    "Wingdings",
];

const MONOSPACE_PROBE: [char; 7] = ['i', 'l', 'm', 'M', 'W', '0', ' '];

const MONOSPACE_MIN_GLYPHS: usize = 4;

fn listable(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.chars().any(char::is_control)
}

fn draws_pictures(name: &str) -> bool {
    PICTURE_FAMILIES.iter().any(|family| {
        name.get(..family.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(family))
            && name
                .get(family.len()..)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
    })
}

fn symbol_only_cmap(subtables: impl IntoIterator<Item = (u16, u16)>) -> bool {
    let mut symbol = false;
    for subtable in subtables {
        match subtable {
            (0, _) | (3, 1) | (3, 10) => return false,
            (3, 0) => symbol = true,
            _ => {}
        }
    }
    symbol
}

fn uniform_advances(advances: impl IntoIterator<Item = Option<u16>>) -> bool {
    let mut present = advances.into_iter().flatten();
    let Some(first) = present.next() else {
        return false;
    };
    let mut count = 1;
    for advance in present {
        if advance != first {
            return false;
        }
        count += 1;
    }
    first > 0 && count >= MONOSPACE_MIN_GLYPHS
}

fn monospace(flagged: bool, advances: impl IntoIterator<Item = Option<u16>>) -> bool {
    flagged || uniform_advances(advances)
}

fn face_traits(face: &ttf_parser::Face<'_>, flagged_monospace: bool) -> FaceTraits {
    let subtables = face
        .tables()
        .cmap
        .into_iter()
        .flat_map(|cmap| cmap.subtables)
        .map(|subtable| (subtable.platform_id as u16, subtable.encoding_id));
    let advances = MONOSPACE_PROBE.iter().map(|&character| {
        face.glyph_index(character)
            .filter(|glyph| glyph.0 != 0)
            .and_then(|glyph| face.glyph_hor_advance(glyph))
    });
    FaceTraits {
        monospace: monospace(flagged_monospace, advances),
        symbol_only: symbol_only_cmap(subtables),
    }
}

fn font_families<'a>(
    faces: impl IntoIterator<Item = (&'a str, FaceTraits)>,
) -> Vec<SystemFontFamily> {
    let mut families: BTreeMap<String, SystemFontFamily> = BTreeMap::new();
    for (name, traits) in faces {
        let name = name.trim();
        if !listable(name) || draws_pictures(name) || traits.symbol_only {
            continue;
        }
        families
            .entry(name.to_lowercase())
            .and_modify(|family| family.monospace &= traits.monospace)
            .or_insert_with(|| SystemFontFamily {
                name: name.to_owned(),
                monospace: traits.monospace,
            });
    }
    families.into_values().collect()
}

fn database_families(database: &fontdb::Database) -> Vec<SystemFontFamily> {
    font_families(database.faces().filter_map(|face| {
        let (name, _) = face.families.first()?;
        let traits = database
            .with_face_data(face.id, |data, index| {
                ttf_parser::Face::parse(data, index)
                    .ok()
                    .map(|parsed| face_traits(&parsed, face.monospaced))
            })
            .flatten()
            .unwrap_or(FaceTraits {
                monospace: face.monospaced,
                symbol_only: false,
            });
        Some((name.as_str(), traits))
    }))
}

fn system_database() -> fontdb::Database {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    database
}

fn installed_font_families() -> Vec<SystemFontFamily> {
    database_families(&system_database())
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

    fn text(monospace: bool) -> FaceTraits {
        FaceTraits {
            monospace,
            symbol_only: false,
        }
    }

    const SYMBOL: FaceTraits = FaceTraits {
        monospace: false,
        symbol_only: true,
    };

    #[test]
    fn each_family_is_listed_once_in_name_order() {
        let families = font_families([
            ("iA Writer Quattro S", text(false)),
            ("Fira Code", text(true)),
            ("iA Writer Quattro S", text(false)),
            ("Arial", text(false)),
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
            ("JetBrains Mono", text(true)),
            ("JetBrains Mono", text(true)),
            ("Mixed", text(true)),
            ("Mixed", text(false)),
        ]);
        assert_eq!(
            families,
            [family("JetBrains Mono", true), family("Mixed", false)]
        );
    }

    #[test]
    fn names_differing_only_in_case_share_one_entry() {
        let families =
            font_families([("IBM Plex Mono", text(true)), ("ibm plex mono", text(true))]);
        assert_eq!(families, [family("IBM Plex Mono", true)]);
    }

    #[test]
    fn hidden_blank_and_control_character_names_are_left_out() {
        let families = font_families([
            (".SF NS", text(false)),
            ("   ", text(false)),
            ("", text(true)),
            ("Bad\u{0}Name", text(false)),
            ("  Menlo  ", text(true)),
        ]);
        assert_eq!(families, [family("Menlo", true)]);
    }

    #[test]
    fn a_family_whose_only_face_is_symbol_encoded_is_left_out() {
        let families = font_families([
            ("Marlett", SYMBOL),
            ("Ornamented", SYMBOL),
            ("Ornamented", text(false)),
            ("Arial", text(false)),
        ]);
        assert_eq!(
            families,
            [family("Arial", false), family("Ornamented", false)]
        );
    }

    #[test]
    fn picture_families_are_left_out_whatever_their_case() {
        let families = font_families([
            ("Bodoni Ornaments", text(false)),
            ("WINGDINGS 2", text(false)),
            ("wingdings", text(false)),
            ("symbol", text(false)),
            ("Material Icons Outlined", text(false)),
            ("Symbola", text(false)),
            ("Bodoni 72", text(false)),
        ]);
        assert_eq!(
            families,
            [family("Bodoni 72", false), family("Symbola", false)]
        );
    }

    #[test]
    fn only_symbol_encoded_cmaps_without_unicode_subtables_count_as_symbol_only() {
        assert!(symbol_only_cmap([(1, 0), (3, 0)]));
        assert!(symbol_only_cmap([(3, 0)]));
        assert!(!symbol_only_cmap([(0, 3), (1, 0), (3, 0)]));
        assert!(!symbol_only_cmap([(3, 0), (3, 1)]));
        assert!(!symbol_only_cmap([(3, 0), (3, 10)]));
        assert!(!symbol_only_cmap([(1, 0)]));
        assert!(!symbol_only_cmap([]));
    }

    #[test]
    fn equal_advances_on_enough_probe_glyphs_count_as_monospace() {
        assert!(uniform_advances([
            Some(1229),
            Some(1229),
            Some(1229),
            Some(1229),
            Some(1229),
            Some(1229),
            Some(1229),
        ]));
        assert!(uniform_advances([
            Some(600),
            None,
            Some(600),
            None,
            Some(600),
            Some(600),
            None,
        ]));
        assert!(!uniform_advances([
            Some(560),
            Some(518),
            Some(1654),
            Some(1944),
            Some(2248),
            Some(1192),
            Some(500),
        ]));
        assert!(!uniform_advances([
            Some(600),
            Some(600),
            Some(600),
            None,
            None,
            None,
            None,
        ]));
        assert!(!uniform_advances([Some(0); 7]));
        assert!(!uniform_advances([None; 7]));
    }

    #[test]
    fn a_face_flagged_proportional_with_equal_advances_lists_as_monospace() {
        let hoefler = [560, 518, 1654, 1944, 2248, 1192, 500].map(Some);
        let families = font_families([
            ("Monaco", text(monospace(false, [Some(1229); 7]))),
            ("Hoefler Text", text(monospace(false, hoefler))),
            ("Menlo", text(monospace(true, hoefler))),
        ]);
        assert_eq!(
            families,
            [
                family("Hoefler Text", false),
                family("Menlo", true),
                family("Monaco", true),
            ]
        );
    }

    fn raw_family_names(database: &fontdb::Database) -> Vec<String> {
        database
            .faces()
            .filter_map(|face| face.families.first())
            .map(|(name, _)| name.trim().to_owned())
            .collect()
    }

    #[test]
    fn the_installed_list_is_sorted_and_free_of_hidden_families() {
        let families = installed_font_families();
        assert!(families.iter().all(|family| listable(&family.name)));
        assert!(families
            .windows(2)
            .all(|pair| pair[0].name.to_lowercase() < pair[1].name.to_lowercase()));
    }

    #[test]
    fn the_installed_list_drops_picture_fonts_and_finds_coding_fonts() {
        let database = system_database();
        let raw = raw_family_names(&database);
        let families = database_families(&database);
        let listed = |name: &str| {
            families
                .iter()
                .find(|family| family.name.eq_ignore_ascii_case(name))
        };
        assert!(families.iter().all(|family| !draws_pictures(&family.name)));
        for name in ["Webdings", "Wingdings"] {
            if raw
                .iter()
                .any(|raw_name| raw_name.eq_ignore_ascii_case(name))
            {
                assert!(listed(name).is_none(), "{name} should be left out");
            }
        }
        for name in ["Monaco", "Courier"] {
            if let Some(family) = listed(name) {
                assert!(family.monospace, "{name} should be monospace");
            }
        }
    }
}
