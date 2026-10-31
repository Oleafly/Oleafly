use std::sync::LazyLock;

use oleafly_preflight::messages::Catalog;

static EDITOR: LazyLock<Catalog> = LazyLock::new(|| {
    Catalog::from_json(
        include_str!("../../../src/i18n/locales/en/editor.json"),
        Some("package"),
    )
});

pub fn editor_catalog() -> &'static Catalog {
    &EDITOR
}
