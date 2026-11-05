use std::path::Path;

use clap::ValueEnum;
use oleafly_core::tex_distro::{host_os_release, linux_package_command};
use oleafly_core::typst_toolchain::bundled_typst_version;
use oleafly_core::{Engine, TexFlavor};
use serde_json::{json, Value};

use crate::contract::{Context, LogMode};
use crate::engine::ProjectOrigin;
use crate::native::{BuildError, BuildResult, BuildTools};

pub const JSON_LOG_TAIL_BYTES: usize = 16 * 1024;
pub const HUMAN_LOG_TAIL_LINES: usize = 40;
const LOG_TRUNCATION_MARKER: &str = "[Oleafly: compiler output truncated]";
const TINYTEX_IN_THE_APP: &str =
    "Install TinyTeX in Oleafly under Settings › Engines › LaTeX › Manage TeX distributions.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum CliEngine {
    #[value(alias = "xetex", alias = "latex")]
    Tectonic,
    Latexmk,
    Typst,
    #[value(alias = "pandoc", alias = "md")]
    Markdown,
}

impl From<CliEngine> for Engine {
    fn from(value: CliEngine) -> Self {
        match value {
            CliEngine::Tectonic => Self::Tectonic,
            CliEngine::Latexmk => Self::Latexmk,
            CliEngine::Typst => Self::Typst,
            CliEngine::Markdown => Self::Markdown,
        }
    }
}

/// The LaTeX compiler latexmk runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum CliCompiler {
    Pdflatex,
    Xelatex,
    Lualatex,
    Uplatex,
    Platex,
}

impl From<CliCompiler> for TexFlavor {
    fn from(value: CliCompiler) -> Self {
        match value {
            CliCompiler::Pdflatex => Self::Pdflatex,
            CliCompiler::Xelatex => Self::Xelatex,
            CliCompiler::Lualatex => Self::Lualatex,
            CliCompiler::Uplatex => Self::Uplatex,
            CliCompiler::Platex => Self::Platex,
        }
    }
}

fn linux_install_command(tool: &str, os_release: &str) -> Option<String> {
    match tool {
        "latexmk" => linux_package_command(
            "latexmk",
            "latexmk",
            "texlive-latex texlive-binextra",
            os_release,
        ),
        "pandoc" => linux_package_command("pandoc", "pandoc", "pandoc-cli", os_release),
        _ => None,
    }
}

fn install_source(
    tool: &str,
    os: &str,
    os_release: &str,
) -> Option<(Option<String>, &'static str)> {
    let (macos, windows, home) = match tool {
        "tectonic" => (
            Some("brew install tectonic"),
            None,
            "https://tectonic-typesetting.github.io/en-US/install.html",
        ),
        "typst" => (
            Some("brew install typst"),
            Some("winget install Typst.Typst"),
            "https://github.com/typst/typst/releases",
        ),
        "pandoc" => (
            Some("brew install pandoc"),
            Some("winget install JohnMacFarlane.Pandoc"),
            "https://pandoc.org/installing.html",
        ),
        "latexmk" if os == "windows" => (None, None, "https://www.tug.org/texlive/windows.html"),
        "latexmk" => (
            Some("brew install texlive"),
            None,
            "https://www.tug.org/texlive/acquire.html",
        ),
        _ => return None,
    };
    let command = match os {
        "macos" => macos.map(str::to_owned),
        "windows" => windows.map(str::to_owned),
        _ => linux_install_command(tool, os_release),
    };
    Some((command, home))
}

fn install_hint_for(tool: &str, os: &str, os_release: &str) -> Option<String> {
    let (command, home) = install_source(tool, os, os_release)?;
    Some(match (command, tool) {
        (Some(command), "typst") => format!(
            "Run `oleafly typst install {}`, install it with `{command}`, or see {home}",
            bundled_typst_version()
        ),
        (None, "typst") => format!(
            "Run `oleafly typst install {}`, or see {home}",
            bundled_typst_version()
        ),
        (Some(command), _) => format!("Install it with `{command}`, or see {home}"),
        (None, _) => format!("Install it with the steps at {home}"),
    })
}

pub fn install_hint(tool: &str) -> Option<String> {
    install_hint_for(tool, std::env::consts::OS, &host_os_release())
}

fn tex_install_hint_for(
    app_found: bool,
    fallback: Option<&str>,
    os: &str,
    os_release: &str,
) -> String {
    let source = install_source("latexmk", os, os_release);
    let yourself = match source.filter(|_| app_found) {
        Some((Some(command), home)) => {
            format!("Or install TeX yourself with `{command}`, or see {home}.")
        }
        Some((None, home)) => format!("Or install TeX yourself with the steps at {home}."),
        None => format!(
            "{}.",
            install_hint_for("latexmk", os, os_release).unwrap_or_default()
        ),
    };
    let app = app_found.then_some(TINYTEX_IN_THE_APP);
    app.into_iter()
        .chain(std::iter::once(yourself.as_str()))
        .chain(fallback)
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn tex_install_hint(app_found: bool, fallback: Option<&str>) -> String {
    tex_install_hint_for(
        app_found,
        fallback,
        std::env::consts::OS,
        &host_os_release(),
    )
}

pub fn engine_install_hint(
    tool: &str,
    tools: &BuildTools,
    fallback: Option<&str>,
) -> Option<String> {
    if tool == "latexmk" {
        let fallback = fallback.filter(|_| tools.tectonic.is_some());
        return Some(tex_install_hint(tools.app_found(), fallback));
    }
    install_hint(tool)
}

pub fn tectonic_fallback(origin: &ProjectOrigin, compiler_flag: bool) -> &'static str {
    match origin {
        ProjectOrigin::Detected if compiler_flag => {
            "To use the built-in engine instead, leave out --compiler."
        }
        ProjectOrigin::Detected => {
            "To use the built-in engine instead, run `oleafly config set latex.default_engine tectonic`."
        }
        _ => "To use the built-in engine instead, run `oleafly config set engine tectonic`.",
    }
}

pub fn appimage_engines_note(appimage: &Path) -> String {
    format!(
        "Your Oleafly AppImage ({}) keeps its engines inside the image, so they only work from Oleafly's built-in terminal. Install tectonic, typst and pandoc, or use the .deb or .rpm package.",
        appimage.display()
    )
}

pub fn log_tail_bytes(log: &str, max_bytes: usize) -> (String, bool) {
    if log.len() <= max_bytes {
        return (log.to_string(), false);
    }
    let mut start = log.len() - max_bytes;
    while !log.is_char_boundary(start) {
        start += 1;
    }
    let window = &log[start..];
    let window = match window.find('\n') {
        Some(newline) if newline + 1 < window.len() => &window[newline + 1..],
        _ => window,
    };
    (window.to_string(), true)
}

fn last_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

pub fn build_json(result: &BuildResult, mode: LogMode) -> Value {
    let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
    let Some(fields) = value.as_object_mut() else {
        return value;
    };
    match mode {
        LogMode::None => {
            fields.remove("log");
            fields.insert("log_truncated".into(), json!(false));
        }
        LogMode::Tail => {
            let (tail, truncated) = log_tail_bytes(&result.log, JSON_LOG_TAIL_BYTES);
            fields.insert("log".into(), json!(tail));
            fields.insert(
                "log_truncated".into(),
                json!(truncated || result.log.contains(LOG_TRUNCATION_MARKER)),
            );
        }
        LogMode::Full => {
            fields.insert(
                "log_truncated".into(),
                json!(result.log.contains(LOG_TRUNCATION_MARKER)),
            );
        }
    }
    value
}

fn location(file: Option<&str>, line: Option<u32>) -> String {
    match (file, line) {
        (Some(file), Some(line)) => format!("{file}:{line}: "),
        (Some(file), None) => format!("{file}: "),
        (None, Some(line)) => format!("line {line}: "),
        (None, None) => String::new(),
    }
}

fn error_details(error: &BuildError) -> Vec<String> {
    error
        .explanation
        .iter()
        .chain(&error.hints)
        .map(|text| format!("  {text}"))
        .collect()
}

pub fn print_build(ctx: &Context, result: &BuildResult, streamed: bool) {
    if ctx.json() {
        return;
    }
    if result.ok {
        if let Some(output) = &result.output {
            let shown = result.copied_to.as_ref().unwrap_or(output);
            if ctx.quiet() {
                ctx.say(shown.display().to_string());
            } else {
                ctx.say(format!(
                    "Built {} in {} ms",
                    shown.display(),
                    result.compile_time_ms
                ));
                if result.copied_to.is_some() {
                    ctx.note(format!("The build folder keeps {} too.", output.display()));
                }
            }
        }
        return;
    }
    if !streamed && ctx.log_mode() == LogMode::Tail && !ctx.quiet() {
        let tail = last_lines(&result.log, HUMAN_LOG_TAIL_LINES);
        if !tail.trim().is_empty() {
            crate::human::stderr_line(&tail);
        }
    }
    crate::human::error(&format!("Build failed in {} ms", result.compile_time_ms));
    for error in result
        .errors
        .iter()
        .filter(|error| error.kind == "error")
        .take(20)
    {
        crate::human::stderr_line(&format!(
            "{}{}",
            location(error.file.as_deref(), error.line),
            error.message
        ));
        if !ctx.quiet() {
            for detail in error_details(error) {
                crate::human::stderr_line(&detail);
            }
        }
    }
    if let Some(previous) = &result.previous_output {
        if !ctx.quiet() {
            ctx.note(format!(
                "The last good PDF is still at {}.",
                previous.display()
            ));
        }
    }
}

pub fn listed(items: Vec<String>) -> String {
    if items.is_empty() {
        "none".to_string()
    } else {
        items.join(", ")
    }
}

pub fn assignments(inputs: &std::collections::BTreeMap<String, String>) -> Vec<String> {
    inputs
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect()
}

pub fn on_off(value: bool) -> String {
    if value { "on" } else { "off" }.to_string()
}

pub fn display_path(path: &Path, base: &Path) -> String {
    path.strip_prefix(base).map_or_else(
        |_| path.display().to_string(),
        |relative| relative.display().to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_engine_tool_has_an_install_hint() {
        for tool in ["tectonic", "latexmk", "typst", "pandoc"] {
            let hint = install_hint(tool).unwrap_or_else(|| panic!("no install hint for {tool}"));
            assert!(
                hint.contains("https://"),
                "the {tool} hint must name a source: {hint}"
            );
        }
        assert!(install_hint("not-a-compiler").is_none());
    }

    #[test]
    fn the_typst_hint_starts_with_oleaflys_own_install() {
        let hint = install_hint("typst").unwrap();
        let own = format!("Run `oleafly typst install {}`", bundled_typst_version());
        assert!(hint.starts_with(&own), "{hint}");
        assert!(
            hint.contains("https://github.com/typst/typst/releases"),
            "{hint}"
        );
        assert!(install_hint("tectonic")
            .unwrap()
            .starts_with("Install it with"));
    }

    const UBUNTU: &str = "NAME=\"Ubuntu\"\nID=ubuntu\nID_LIKE=debian\n";
    const FEDORA: &str = "NAME=\"Fedora Linux\"\nID=fedora\n";
    const MANJARO: &str = "ID=manjaro\nID_LIKE=arch\n";
    const VOID: &str = "ID=void\n";

    #[test]
    fn hints_name_the_package_manager_of_this_linux() {
        let hint = |tool, os_release| install_hint_for(tool, "linux", os_release).unwrap();
        assert!(hint("latexmk", UBUNTU).contains("`sudo apt install latexmk`"));
        assert!(hint("latexmk", FEDORA).contains("`sudo dnf install latexmk`"));
        assert!(
            hint("latexmk", MANJARO).contains("`sudo pacman -S texlive-latex texlive-binextra`")
        );
        assert!(hint("pandoc", UBUNTU).contains("`sudo apt install pandoc`"));
        assert!(hint("pandoc", FEDORA).contains("`sudo dnf install pandoc`"));
        assert!(hint("pandoc", MANJARO).contains("`sudo pacman -S pandoc-cli`"));
        for tool in ["latexmk", "pandoc", "tectonic"] {
            let text = hint(tool, VOID);
            assert!(
                text.starts_with("Install it with the steps at https://"),
                "{text}"
            );
            assert!(!text.contains("apt"), "{text}");
        }
    }

    #[test]
    fn no_hint_asks_for_a_rust_toolchain_or_a_missing_winget_package() {
        for tool in ["tectonic", "typst", "pandoc", "latexmk"] {
            for os in ["macos", "windows", "linux"] {
                let text = install_hint_for(tool, os, UBUNTU).unwrap();
                assert!(!text.contains("cargo install"), "{text}");
                assert!(!text.contains("TectonicTypesetting"), "{text}");
                assert!(text.contains("https://"), "{text}");
            }
        }
        assert!(install_hint_for("not-a-compiler", "linux", UBUNTU).is_none());
    }

    #[test]
    fn typst_hints_start_with_oleaflys_own_install_on_every_system() {
        let own = format!("Run `oleafly typst install {}`", bundled_typst_version());
        for (os, command) in [
            ("macos", Some("brew install typst")),
            ("windows", Some("winget install Typst.Typst")),
            ("linux", None),
        ] {
            let text = install_hint_for("typst", os, UBUNTU).unwrap();
            assert!(text.starts_with(&own), "{text}");
            match command {
                Some(command) => assert!(text.contains(command), "{text}"),
                None => assert!(text.contains(", or see https://"), "{text}"),
            }
        }
    }

    #[test]
    fn windows_gets_a_real_tex_live_page() {
        let text = install_hint_for("latexmk", "windows", "").unwrap();
        assert!(
            text.contains("https://www.tug.org/texlive/windows.html"),
            "{text}"
        );
    }

    #[test]
    fn the_tex_hint_only_offers_what_this_machine_has() {
        let fallback = tectonic_fallback(&ProjectOrigin::Manifest, false);
        let full = tex_install_hint_for(true, Some(fallback), "linux", UBUNTU);
        assert!(
            full.starts_with("Install TinyTeX in Oleafly under Settings"),
            "{full}"
        );
        assert!(
            full.contains("Or install TeX yourself with `sudo apt install latexmk`"),
            "{full}"
        );
        assert!(
            full.ends_with("`oleafly config set engine tectonic`."),
            "{full}"
        );

        let standalone = tex_install_hint_for(false, None, "linux", UBUNTU);
        assert!(!standalone.contains("TinyTeX"), "{standalone}");
        assert!(!standalone.contains("Settings"), "{standalone}");
        assert!(!standalone.contains("tectonic"), "{standalone}");
        assert!(
            standalone.starts_with("Install it with `sudo apt install latexmk`"),
            "{standalone}"
        );

        let windows = tex_install_hint_for(true, None, "windows", "");
        assert!(windows.contains("Or install TeX yourself with the steps at https://www.tug.org/texlive/windows.html."), "{windows}");
    }

    #[test]
    fn the_way_back_to_tectonic_fits_how_the_project_was_opened() {
        assert!(tectonic_fallback(&ProjectOrigin::Manifest, false)
            .contains("`oleafly config set engine tectonic`"));
        assert!(tectonic_fallback(&ProjectOrigin::Detected, true).contains("--compiler"));
        assert!(tectonic_fallback(&ProjectOrigin::Detected, false)
            .contains("`oleafly config set latex.default_engine tectonic`"));
    }

    #[test]
    fn engine_hints_offer_tectonic_only_when_it_is_there() {
        let fallback = Some("Fallback line.");
        let bare = BuildTools::default();
        assert!(!engine_install_hint("latexmk", &bare, fallback)
            .unwrap()
            .contains("Fallback line."));
        let mut with_tectonic = BuildTools::default();
        with_tectonic.tectonic = Some("/bin/tectonic".into());
        assert!(engine_install_hint("latexmk", &with_tectonic, fallback)
            .unwrap()
            .ends_with("Fallback line."));
        assert_eq!(
            engine_install_hint("pandoc", &bare, fallback),
            install_hint("pandoc")
        );
    }

    #[test]
    fn explanations_and_hints_print_under_their_error() {
        let error = BuildError {
            line: None,
            file: None,
            message: "Font not found".into(),
            kind: "error".into(),
            column: None,
            hints: vec!["Install the font.".into(), "Or use XeLaTeX.".into()],
            explanation: Some("Tectonic crashed while loading it.".into()),
            code: None,
        };
        assert_eq!(
            error_details(&error),
            [
                "  Tectonic crashed while loading it.",
                "  Install the font.",
                "  Or use XeLaTeX."
            ]
        );
        let plain = BuildError {
            hints: Vec::new(),
            explanation: None,
            ..error
        };
        assert!(error_details(&plain).is_empty());
    }

    #[test]
    fn log_tails_start_at_a_line() {
        let log = (0..5_000)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (tail, truncated) = log_tail_bytes(&log, JSON_LOG_TAIL_BYTES);
        assert!(truncated);
        assert!(tail.len() <= JSON_LOG_TAIL_BYTES);
        assert!(tail.starts_with("line "));
        assert!(tail.ends_with("line 4999"));
    }
}
