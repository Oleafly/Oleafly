use crate::native::{
    bundled_tool_candidates, path_tool_candidates, resolve_executable, CandidateResolution,
};
use oleafly_core::typst_toolchain::{
    host_target, installed_typst_versions, typst_version_of, ToolchainVersion, TypstCapabilities,
    TypstToolchainCatalog, TYPST_VERSION_TIMEOUT,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub(crate) const TYPST_OVERRIDE: &str = "OLEAFLY_TYPST";
const SETTINGS_HINT: &str = "Settings > Engines > Typst";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TypstOrigin {
    Override,
    Downloaded,
    Bundled,
    System,
}

impl TypstOrigin {
    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Override => TYPST_OVERRIDE,
            Self::Downloaded => "downloaded",
            Self::Bundled => "bundled",
            Self::System => "PATH",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct FoundTypst {
    pub version: Option<ToolchainVersion>,
    pub source: TypstOrigin,
    pub path: PathBuf,
}

impl FoundTypst {
    pub(crate) fn describe(&self) -> String {
        match &self.version {
            Some(version) => format!("Typst {version}, {}", self.source.label()),
            None => format!("unknown Typst version, {}", self.source.label()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct TypstInventory {
    pub found: Vec<FoundTypst>,
}

impl TypstInventory {
    pub(crate) fn discover(workspace_root: &Path) -> Self {
        let mut inventory = Self::default();
        if let Some(value) = std::env::var_os(TYPST_OVERRIDE).filter(|value| !value.is_empty()) {
            inventory.add(
                PathBuf::from(value),
                TypstOrigin::Override,
                None,
                workspace_root,
            );
        }
        if let (Some(data_root), Some(target)) = (crate::desktop_link::data_root(), host_target()) {
            for installed in installed_typst_versions(&data_root, target) {
                inventory.add(
                    installed.path,
                    TypstOrigin::Downloaded,
                    Some(installed.version),
                    workspace_root,
                );
            }
        }
        for candidate in bundled_tool_candidates("typst") {
            inventory.add(candidate, TypstOrigin::Bundled, None, workspace_root);
        }
        for candidate in path_tool_candidates("typst") {
            inventory.add(candidate, TypstOrigin::System, None, workspace_root);
        }
        inventory
    }

    fn add(
        &mut self,
        candidate: PathBuf,
        source: TypstOrigin,
        version: Option<ToolchainVersion>,
        workspace_root: &Path,
    ) {
        let CandidateResolution::Safe(path) = resolve_executable(candidate, workspace_root) else {
            return;
        };
        if self.found.iter().any(|found| found.path == path) {
            return;
        }
        let version = version.or_else(|| typst_version_of(&path, TYPST_VERSION_TIMEOUT));
        self.found.push(FoundTypst {
            version,
            source,
            path,
        });
    }

    pub(crate) fn find(&self, path: &Path) -> Option<&FoundTypst> {
        self.found.iter().find(|found| found.path == path)
    }

    pub(crate) fn version_of(&self, path: &Path) -> Option<ToolchainVersion> {
        self.find(path).and_then(|found| found.version.clone())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PinnedTypst {
    pub path: PathBuf,
    pub capabilities: TypstCapabilities,
    pub version: ToolchainVersion,
}

pub(crate) fn resolve_pinned(pin: &str, inventory: &TypstInventory) -> Result<PinnedTypst, String> {
    let catalog = TypstToolchainCatalog::embedded();
    let Some(wanted) = ToolchainVersion::parse(pin) else {
        return Err(unknown_pin_message(pin));
    };
    if let Some(chosen) = inventory
        .found
        .iter()
        .find(|found| found.source == TypstOrigin::Override)
    {
        if chosen.version.as_ref() != Some(&wanted) {
            return Err(override_mismatch_message(chosen, &wanted));
        }
    }
    match inventory
        .found
        .iter()
        .find(|found| found.version.as_ref() == Some(&wanted))
    {
        Some(found) => Ok(PinnedTypst {
            path: found.path.clone(),
            capabilities: catalog.capabilities_for(&wanted.to_string()).clone(),
            version: wanted,
        }),
        None if catalog.typst_release(pin).is_some() => Err(format!(
            "this project pins Typst {wanted}, which is not installed. Install it in Oleafly under {SETTINGS_HINT}, or set {TYPST_OVERRIDE} to a Typst {wanted} binary"
        )),
        None => Err(unknown_pin_message(&wanted.to_string())),
    }
}

fn unknown_pin_message(pin: &str) -> String {
    format!(
        "this project pins Typst {pin}, which Oleafly does not offer and no Typst on PATH reports. Set {TYPST_OVERRIDE} to a Typst {pin} binary, or change the project's Typst version in Oleafly"
    )
}

fn override_mismatch_message(found: &FoundTypst, wanted: &ToolchainVersion) -> String {
    let actual = found.version.as_ref().map_or_else(
        || "does not report a Typst version".to_string(),
        |version| format!("is Typst {version}"),
    );
    format!(
        "{TYPST_OVERRIDE}={} {actual}, but this project pins Typst {wanted}. Point {TYPST_OVERRIDE} at a Typst {wanted} binary, or unset it",
        found.path.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(version: Option<&str>, source: TypstOrigin, path: &str) -> FoundTypst {
        FoundTypst {
            version: version.map(|value| ToolchainVersion::parse(value).unwrap()),
            source,
            path: PathBuf::from(path),
        }
    }

    fn inventory(found: Vec<FoundTypst>) -> TypstInventory {
        TypstInventory { found }
    }

    #[test]
    fn the_first_typst_of_the_pinned_version_wins_in_inventory_order() {
        let inventory = inventory(vec![
            found(
                Some("0.13.1"),
                TypstOrigin::Downloaded,
                "/data/0.13.1/typst",
            ),
            found(Some("0.15.1"), TypstOrigin::Bundled, "/app/typst"),
            found(None, TypstOrigin::System, "/broken/typst"),
            found(Some("0.13.1"), TypstOrigin::System, "/usr/bin/typst"),
        ]);
        let pinned = resolve_pinned("0.13.1", &inventory).unwrap();
        assert_eq!(pinned.path, PathBuf::from("/data/0.13.1/typst"));
        assert_eq!(pinned.version.to_string(), "0.13.1");
        assert_eq!(
            &pinned.capabilities,
            TypstToolchainCatalog::embedded().capabilities_for("0.13.1")
        );
        assert_eq!(
            resolve_pinned("0.15.1", &inventory).unwrap().path,
            PathBuf::from("/app/typst")
        );
    }

    #[test]
    fn an_unknown_newer_system_typst_uses_the_newest_capabilities() {
        let inventory = inventory(vec![found(
            Some("0.16.0-rc.1"),
            TypstOrigin::System,
            "/usr/local/bin/typst",
        )]);
        let pinned = resolve_pinned("0.16.0-rc.1", &inventory).unwrap();
        assert_eq!(
            &pinned.capabilities,
            TypstToolchainCatalog::embedded().capabilities_for("0.15.1")
        );
    }

    #[test]
    fn missing_pins_explain_what_to_do() {
        let inventory = inventory(vec![found(
            Some("0.15.1"),
            TypstOrigin::Bundled,
            "/app/typst",
        )]);
        let missing = resolve_pinned("0.12.0", &inventory).unwrap_err();
        assert!(
            missing.contains("Typst 0.12.0, which is not installed"),
            "{missing}"
        );
        assert!(missing.contains(SETTINGS_HINT), "{missing}");
        assert!(missing.contains(TYPST_OVERRIDE), "{missing}");
        assert!(!missing.contains(';') && !missing.contains('\u{2014}'));

        let unknown = resolve_pinned("0.99.0", &inventory).unwrap_err();
        assert!(unknown.contains("Typst 0.99.0"), "{unknown}");
        assert!(!unknown.contains(SETTINGS_HINT), "{unknown}");

        let garbage = resolve_pinned("latest", &inventory).unwrap_err();
        assert!(garbage.contains("Typst latest"), "{garbage}");
    }

    #[test]
    fn an_override_of_another_version_is_an_error_for_a_pinned_project() {
        let inventory = inventory(vec![
            found(Some("0.15.0"), TypstOrigin::Override, "/custom/typst"),
            found(Some("0.14.2"), TypstOrigin::System, "/usr/bin/typst"),
        ]);
        let error = resolve_pinned("0.14.2", &inventory).unwrap_err();
        assert!(
            error.starts_with("OLEAFLY_TYPST=/custom/typst is Typst 0.15.0"),
            "{error}"
        );
        assert!(error.contains("pins Typst 0.14.2"), "{error}");

        let silent = inventory_with_override(None);
        let error = resolve_pinned("0.14.2", &silent).unwrap_err();
        assert!(error.contains("does not report a Typst version"), "{error}");

        let matching = inventory_with_override(Some("0.14.2"));
        assert_eq!(
            resolve_pinned("0.14.2", &matching).unwrap().path,
            PathBuf::from("/custom/typst")
        );
    }

    fn inventory_with_override(version: Option<&str>) -> TypstInventory {
        inventory(vec![
            found(version, TypstOrigin::Override, "/custom/typst"),
            found(Some("0.14.2"), TypstOrigin::System, "/usr/bin/typst"),
        ])
    }

    #[test]
    fn found_typst_descriptions_name_version_and_source() {
        assert_eq!(
            found(Some("0.13.1"), TypstOrigin::Downloaded, "/x").describe(),
            "Typst 0.13.1, downloaded"
        );
        assert_eq!(
            found(None, TypstOrigin::System, "/x").describe(),
            "unknown Typst version, PATH"
        );
        assert_eq!(TypstOrigin::Override.label(), "OLEAFLY_TYPST");
        assert_eq!(
            serde_json::to_value(TypstOrigin::System).unwrap(),
            serde_json::json!("system")
        );
    }
}
