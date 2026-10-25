//! The CLI reports the app's version (it ships inside the app) and the
//! engines it would build with.
use std::collections::BTreeMap;
use std::path::PathBuf;

use oleafly_core::pandoc::{pandoc_version_supported, parse_pandoc_version};
use oleafly_core::process_probe::{probe_output, PROBE_TIMEOUT};
use serde::Serialize;

use crate::native::BuildTools;
use crate::typst::TypstInventory;

/// The desktop app's version (`src-tauri/tauri.conf.json`).
pub const APP_VERSION: &str = env!("OLEAFLY_APP_VERSION");

/// The commit this CLI was built from, when known.
pub const COMMIT: Option<&str> = match option_env!("OLEAFLY_COMMIT") {
    Some(commit) if !commit.is_empty() => Some(commit),
    _ => None,
};

/// `0.4.8 (abc1234def56)` or `0.4.8 (dev)`.
pub const VERSION_LINE: &str = concat!(
    env!("OLEAFLY_APP_VERSION"),
    " (",
    env!("OLEAFLY_COMMIT_LABEL"),
    ")"
);

/// The Rust target triple this CLI was built for.
pub const TARGET: &str = env!("OLEAFLY_BUILD_TARGET");

const VERSION_OUTPUT_BYTES: u64 = 64 * 1024;

/// One engine as `oleafly version` and `oleafly doctor` describe it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolReport {
    pub path: PathBuf,
    pub version: Option<String>,
    /// `override`, `bundled`, `path`, `tex`, `system` or `downloaded`.
    pub source: &'static str,
    /// For Pandoc: whether it is 2.19 or newer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported: Option<bool>,
}

fn first_line_word_after(text: &str, marker: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let index = line.find(marker)?;
        line[index + marker.len()..]
            .split_whitespace()
            .next()
            .map(str::to_owned)
    })
}

/// `Tectonic 0.15.0` → `0.15.0`.
pub(crate) fn tectonic_version(output: &str) -> Option<String> {
    let line = output.lines().next()?;
    let mut words = line.split_whitespace();
    words
        .next()
        .filter(|word| word.eq_ignore_ascii_case("tectonic"))?;
    words.next().map(str::to_owned)
}

/// `Latexmk, John Collins, 7 Jan. 2025. Version 4.86a` → `4.86a`.
pub(crate) fn latexmk_version(output: &str) -> Option<String> {
    first_line_word_after(output, "Version ")
}

fn probe_text(path: &std::path::Path, args: &[&str]) -> Option<String> {
    let output = probe_output(path, args, PROBE_TIMEOUT, VERSION_OUTPUT_BYTES)?;
    output
        .success
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Each engine's path, version and source, probed in parallel (each at
/// most 5 seconds). Missing engines are `None`.
pub(crate) fn engine_reports(
    tools: &BuildTools,
    inventory: &TypstInventory,
) -> BTreeMap<&'static str, Option<ToolReport>> {
    let source = |name: &str| tools.sources.get(name).copied().unwrap_or("path");
    std::thread::scope(|scope| {
        let tectonic = tools.tectonic.clone().map(|path| {
            scope.spawn(move || {
                let version = probe_text(&path, &["--version"])
                    .as_deref()
                    .and_then(tectonic_version);
                (path, version)
            })
        });
        let latexmk = tools.latexmk.clone().map(|path| {
            scope.spawn(move || {
                let version = probe_text(&path, &["-v"])
                    .as_deref()
                    .and_then(latexmk_version);
                (path, version)
            })
        });
        let pandoc = tools.pandoc.clone().map(|path| {
            scope.spawn(move || {
                let output =
                    probe_output(&path, &["--version"], PROBE_TIMEOUT, VERSION_OUTPUT_BYTES);
                let version = output
                    .as_ref()
                    .and_then(|output| parse_pandoc_version(&output.stdout));
                let supported = output
                    .as_ref()
                    .map(|output| pandoc_version_supported(&output.stdout));
                (path, version, supported)
            })
        });
        let mut reports = BTreeMap::new();
        reports.insert(
            "tectonic",
            tectonic
                .and_then(|handle| handle.join().ok())
                .map(|(path, version)| ToolReport {
                    path,
                    version,
                    source: source("tectonic"),
                    supported: None,
                }),
        );
        reports.insert(
            "latexmk",
            latexmk
                .and_then(|handle| handle.join().ok())
                .map(|(path, version)| ToolReport {
                    path,
                    version,
                    source: source("latexmk"),
                    supported: None,
                }),
        );
        reports.insert(
            "pandoc",
            pandoc
                .and_then(|handle| handle.join().ok())
                .map(|(path, version, supported)| ToolReport {
                    path,
                    version: version.or_else(|| tools.pandoc_version.clone()),
                    source: source("pandoc"),
                    supported,
                }),
        );
        reports.insert(
            "typst",
            tools.typst.clone().map(|path| {
                let found = inventory.find(&path);
                ToolReport {
                    version: found
                        .and_then(|found| found.version.as_ref().map(ToString::to_string))
                        .or_else(|| tools.typst_version().map(ToString::to_string)),
                    source: found
                        .map_or_else(|| source("typst"), |found| found.source.report_label()),
                    path,
                    supported: None,
                }
            }),
        );
        reports
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cli_reports_the_app_version() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../src-tauri/tauri.conf.json")).unwrap();
        assert_eq!(APP_VERSION, config["version"].as_str().unwrap());
    }

    #[test]
    fn version_line_names_the_commit_or_dev() {
        assert!(VERSION_LINE.starts_with(APP_VERSION));
        assert!(VERSION_LINE.ends_with(')'));
        match COMMIT {
            Some(commit) => assert!(VERSION_LINE.contains(commit)),
            None => assert!(VERSION_LINE.contains("(dev)")),
        }
    }

    #[test]
    fn engine_versions_are_read_from_their_banners() {
        assert_eq!(
            tectonic_version("Tectonic 0.15.0\n").as_deref(),
            Some("0.15.0")
        );
        assert_eq!(tectonic_version("something else"), None);
        assert_eq!(
            latexmk_version("Latexmk, John Collins, 7 Jan. 2025. Version 4.86a\n").as_deref(),
            Some("4.86a")
        );
    }
}
