//! `oleafly doctor`: this computer's setup, and the project's when there is
//! one.
use std::path::{Path, PathBuf};
use std::time::Duration;

use oleafly_core::process_probe::{probe_output, PROBE_TIMEOUT};
use oleafly_core::{DoctorCheck, DoctorReport, DoctorStatus, Engine};
use serde_json::{json, Value};

use super::common::{assignments, install_hint, listed, on_off};
use super::CommandModule;
use crate::contract::{CliError, Context, Exit, Outcome};
use crate::engine::{
    build_tools, open_project, typst_project_pin, unapplied_settings, OpenedProject, ProjectOrigin,
};
use crate::human::{status_label, CheckStatus};
use crate::native::{rejected_override_message, BuildTools, Discovery};
use crate::typst::TypstInventory;
use crate::typst_settings::SettingsSummary;
use crate::version::{engine_reports, ToolReport, VERSION_LINE};

const MCP_PING: Duration = Duration::from_secs(1);

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Check this computer's setup, and the project's when there is one
    Doctor,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        "doctor"
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        run_doctor(ctx).await
    }
}

fn check(name: &str, status: DoctorStatus, message: impl Into<String>) -> DoctorCheck {
    DoctorCheck {
        name: name.to_string(),
        status,
        message: message.into(),
    }
}

/// The project to check: always with an explicit `-C`, else only when the
/// folder is (or looks like) a project.
fn project_scope(ctx: &Context) -> Result<Option<OpenedProject>, CliError> {
    match open_project(ctx.project(), None, None) {
        Ok(opened) => Ok(Some(opened)),
        Err(error)
            if !ctx.project_explicit()
                && matches!(
                    error.code.as_ref(),
                    "project.not_initialized" | "project.invalid_input"
                ) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

async fn run_doctor(ctx: &Context) -> Result<Outcome, CliError> {
    let project = project_scope(ctx)?;
    let root = match &project {
        Some(opened) => opened.workspace.root().to_path_buf(),
        None => std::env::current_dir().unwrap_or_default(),
    };
    let discovery = Discovery::from_env(&root);
    let engine = project
        .as_ref()
        .and_then(|opened| opened.workspace.manifest().engine().ok());
    let inventory = TypstInventory::discover_with(&discovery);
    let mut tools = match &project {
        Some(opened) => build_tools(&opened.workspace, &discovery, Some(&inventory)),
        None => BuildTools::discover_with(&discovery),
    };
    tools.resolve_pandoc(&discovery);
    let reports = engine_reports(&tools, &inventory);

    let mut report = match &project {
        Some(opened) => project_checks(opened, &tools, &inventory),
        None => DoctorReport {
            ok: true,
            checks: Vec::new(),
        },
    };
    report
        .checks
        .extend(global_checks(ctx, &discovery, &tools, &reports, engine, &root).await);
    report.ok = report
        .checks
        .iter()
        .all(|check| check.status != DoctorStatus::Fail);

    let mut fields = json!({
        "scope": if project.is_some() { "project" } else { "global" },
        "report": report,
    });
    let mut settings = None;
    if let Some(opened) = project.as_ref().filter(|_| engine == Some(Engine::Typst)) {
        let pin = typst_project_pin(&opened.workspace);
        let summary = SettingsSummary::of(
            opened.workspace.manifest().typst.as_ref(),
            opened.workspace.root(),
            discovery.data_root.as_deref(),
        );
        fields["typst"] = json!({"pinned": pin, "found": inventory.found, "settings": summary});
        settings = Some((pin.map(str::to_owned), summary));
    }
    if !ctx.json() {
        print_doctor(
            &report,
            (engine == Some(Engine::Typst)).then_some(&inventory),
        );
        if let Some((pin, summary)) = &settings {
            println!("Typst settings:");
            for line in typst_settings_lines(pin.as_deref(), summary) {
                println!("{line}");
            }
        }
    }
    Ok(if report.ok {
        Outcome::success(fields)
    } else {
        Outcome::failure(Exit::Environment, fields)
    })
}

fn project_checks(
    opened: &OpenedProject,
    tools: &BuildTools,
    inventory: &TypstInventory,
) -> DoctorReport {
    let workspace = &opened.workspace;
    let mut report = workspace.doctor();
    match &opened.origin {
        ProjectOrigin::Detected => {
            if let Some(check) = report
                .checks
                .iter_mut()
                .find(|check| check.name == "manifest")
            {
                check.status = DoctorStatus::Warning;
                check.message = format!(
                    "No Oleafly project.json here, so these checks use {}",
                    workspace.manifest().main_doc
                );
            }
        }
        ProjectOrigin::Linked { .. } => {
            if let Some(check) = report
                .checks
                .iter_mut()
                .find(|check| check.name == "manifest")
            {
                if check.status != DoctorStatus::Pass {
                    check.status = DoctorStatus::Pass;
                    check.message = format!(
                        "The Oleafly app opened this folder; it builds {}",
                        workspace.manifest().main_doc
                    );
                }
            }
            report.checks.push(check(
                "build_directory",
                DoctorStatus::Pass,
                format!(
                    "Builds go to the app's folder {}",
                    workspace.build_dir_path().display()
                ),
            ));
        }
        ProjectOrigin::Manifest => {}
    }
    let Ok(engine) = workspace.manifest().engine() else {
        return report;
    };
    for (name, path) in tools.required_for_engine(engine) {
        let rejected = tools.rejected_override(name);
        if let (None, Some(message)) = (path, tools.typst_pin_error().filter(|_| name == "typst")) {
            report.checks.push(check(
                &format!("compiler_{name}"),
                DoctorStatus::Fail,
                message,
            ));
            continue;
        }
        if let (None, Some(message)) = (
            path,
            tools.pandoc_too_old_message().filter(|_| name == "pandoc"),
        ) {
            report.checks.push(check(
                &format!("compiler_{name}"),
                DoctorStatus::Fail,
                message,
            ));
            continue;
        }
        let found = path.and_then(|path| inventory.find(path));
        report.checks.push(match (path, rejected) {
            (Some(path), Some((variable, rejected))) => check(
                &format!("compiler_{name}"),
                DoctorStatus::Warning,
                format!(
                    "Using {}. {}",
                    path.display(),
                    rejected_override_message(variable, rejected)
                ),
            ),
            (Some(path), None) => check(
                &format!("compiler_{name}"),
                DoctorStatus::Pass,
                match found {
                    Some(found) => format!("{} ({})", path.display(), found.describe()),
                    None => path.display().to_string(),
                },
            ),
            (None, Some((variable, rejected))) => check(
                &format!("compiler_{name}"),
                DoctorStatus::Fail,
                rejected_override_message(variable, rejected),
            ),
            (None, None) => check(
                &format!("compiler_{name}"),
                DoctorStatus::Fail,
                match install_hint(name) {
                    Some(hint) => format!("{name} was not found. {hint}"),
                    None => format!("{name} was not found"),
                },
            ),
        });
    }
    if engine == Engine::Typst {
        report.checks.push(typst_version_check(
            typst_project_pin(workspace),
            tools,
            inventory,
        ));
        let unapplied = unapplied_settings(workspace, tools);
        if !unapplied.is_empty() {
            report.checks.push(check(
                "typst_settings",
                DoctorStatus::Warning,
                unapplied.join(". "),
            ));
        }
    }
    report
}

fn typst_version_check(
    pin: Option<&str>,
    tools: &BuildTools,
    inventory: &TypstInventory,
) -> DoctorCheck {
    let resolved = tools.typst.as_deref().and_then(|path| inventory.find(path));
    let (status, message) = match (pin, tools.typst_pin_error()) {
        (Some(pin), Some(_)) => (
            DoctorStatus::Fail,
            format!("This project pins Typst {pin}, but no Typst {pin} was found"),
        ),
        (Some(pin), None) => (DoctorStatus::Pass, format!("This project pins Typst {pin}")),
        (None, Some(message)) => (DoctorStatus::Fail, message.to_string()),
        (None, None) => (
            DoctorStatus::Pass,
            match resolved.and_then(|found| found.version.as_ref()) {
                Some(version) => {
                    format!("No Typst version is pinned, so builds use Typst {version}")
                }
                None => "No Typst version is pinned".to_string(),
            },
        ),
    };
    check("typst_version", status, message)
}

fn engine_check(
    name: &'static str,
    report: Option<&ToolReport>,
    tools: &BuildTools,
    engine: Option<Engine>,
) -> DoctorCheck {
    let check_name = format!("engine_{name}");
    if let Some(report) = report {
        let version = report.version.as_deref().unwrap_or("unknown version");
        return check(
            &check_name,
            DoctorStatus::Pass,
            format!("{version} at {} ({})", report.path.display(), report.source),
        );
    }
    if name == "pandoc" {
        if let Some(message) = tools.pandoc_too_old_message() {
            let status = if engine == Some(Engine::Markdown) {
                DoctorStatus::Fail
            } else {
                DoctorStatus::Warning
            };
            return check(&check_name, status, message);
        }
    }
    let message = match install_hint(name) {
        Some(hint) => format!("{name} wasn't found. {hint}"),
        None => format!("{name} wasn't found."),
    };
    check(&check_name, DoctorStatus::Warning, message)
}

/// Where `oleafly` on PATH leads, if anywhere.
fn oleafly_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let name = crate::native::executable_name("oleafly");
    std::env::split_paths(&path)
        .filter(|folder| folder.is_absolute())
        .map(|folder| folder.join(&name))
        .find(|candidate| candidate.is_file())
}

fn cli_check(data_root: Option<&Path>) -> DoctorCheck {
    let own = crate::app_paths::own_executable();
    let own_text = own.as_deref().map_or_else(
        || "an unknown path".to_string(),
        |path| path.display().to_string(),
    );
    let shim = data_root.map(|root| {
        root.join("cli")
            .join("bin")
            .join(crate::native::executable_name("oleafly"))
    });
    match oleafly_on_path() {
        None => check(
            "cli",
            DoctorStatus::Pass,
            format!("oleafly {VERSION_LINE} at {own_text}. `oleafly` isn't on your PATH."),
        ),
        Some(found) => {
            let resolved = found.canonicalize().unwrap_or_else(|_| found.clone());
            let same = own.as_deref() == Some(resolved.as_path())
                || shim.as_deref().is_some_and(|shim| shim == found)
                || crate::launcher::is_this_command(&found, own.as_deref());
            if same {
                check(
                    "cli",
                    DoctorStatus::Pass,
                    format!("oleafly {VERSION_LINE} at {own_text}, the one on your PATH."),
                )
            } else {
                check(
                    "cli",
                    DoctorStatus::Warning,
                    format!(
                        "oleafly {VERSION_LINE} at {own_text}, but `oleafly` on your PATH is {}.",
                        found.display()
                    ),
                )
            }
        }
    }
}

fn data_root_check(data_root: Option<&Path>) -> DoctorCheck {
    let Some(root) = data_root else {
        return check(
            "data_root",
            DoctorStatus::Warning,
            "Oleafly couldn't find your home folder.",
        );
    };
    if !root.is_dir() {
        return check(
            "data_root",
            DoctorStatus::Warning,
            format!("Oleafly's data folder {} doesn't exist yet. The app creates it the first time it runs.", root.display()),
        );
    }
    let probe = root.join(format!(".oleafly-doctor-{}", std::process::id()));
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    if writable {
        check("data_root", DoctorStatus::Pass, root.display().to_string())
    } else {
        check(
            "data_root",
            DoctorStatus::Warning,
            format!("Oleafly can't write to its data folder {}.", root.display()),
        )
    }
}

fn git_check() -> DoctorCheck {
    match probe_output(Path::new("git"), &["--version"], PROBE_TIMEOUT, 4096) {
        Some(output) if output.success => check(
            "git",
            DoctorStatus::Pass,
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        ),
        _ => check(
            "git",
            DoctorStatus::Warning,
            "git wasn't found. Git sync and `oleafly context` need it.",
        ),
    }
}

async fn mcp_server_check(data_root: Option<&Path>) -> DoctorCheck {
    let Some(target) = data_root.and_then(crate::mcp::bridge::discover) else {
        return check("mcp_server", DoctorStatus::Pass, "off");
    };
    if crate::mcp::bridge::ping(&target, MCP_PING).await {
        check(
            "mcp_server",
            DoctorStatus::Pass,
            format!("running at {}", target.url),
        )
    } else {
        check(
            "mcp_server",
            DoctorStatus::Warning,
            format!(
                "The Oleafly app's MCP server didn't answer at {}. Is the app open?",
                target.url
            ),
        )
    }
}

fn mcp_clients_check(root: &Path) -> DoctorCheck {
    let env = crate::mcp::clients::ClientEnv::from_env();
    let configured = crate::mcp::clients::configured_clients(&env, Some(root));
    if configured.is_empty() {
        return check(
            "mcp_clients",
            DoctorStatus::Pass,
            "No AI client lists oleafly yet. Run `oleafly mcp config --client <name>` to add it.",
        );
    }
    let names: Vec<String> = configured
        .iter()
        .map(|(client, scope, _)| format!("{} ({})", client.label(), scope.label()))
        .collect();
    check(
        "mcp_clients",
        DoctorStatus::Pass,
        format!("oleafly is set up in {}", names.join(", ")),
    )
}

async fn global_checks(
    ctx: &Context,
    discovery: &Discovery,
    tools: &BuildTools,
    reports: &std::collections::BTreeMap<&'static str, Option<ToolReport>>,
    engine: Option<Engine>,
    root: &Path,
) -> Vec<DoctorCheck> {
    let data_root = ctx.data_root().or(discovery.data_root.as_deref());
    let mut checks = vec![cli_check(data_root)];
    checks.push(match &discovery.app {
        Some(app) => check(
            "app",
            DoctorStatus::Pass,
            app.executable.display().to_string(),
        ),
        None => check(
            "app",
            DoctorStatus::Warning,
            "The Oleafly app wasn't found. Builds still work with the engines on this computer.",
        ),
    });
    checks.push(data_root_check(data_root));
    for name in ["tectonic", "latexmk", "typst", "pandoc"] {
        checks.push(engine_check(
            name,
            reports.get(name).and_then(Option::as_ref),
            tools,
            engine,
        ));
    }
    let tinytex = data_root
        .map(|root| root.join("tinytex"))
        .filter(|folder| folder.is_dir());
    checks.push(match tinytex {
        Some(folder) => check(
            "tinytex",
            DoctorStatus::Pass,
            format!("Oleafly's TinyTeX is at {}", folder.display()),
        ),
        None => check(
            "tinytex",
            DoctorStatus::Pass,
            "Oleafly's TinyTeX isn't installed; latexmk projects use your TeX distribution.",
        ),
    });
    checks.push(git_check());
    checks.push(mcp_server_check(data_root).await);
    checks.push(mcp_clients_check(root));
    if cfg!(not(any(target_os = "macos", windows))) {
        if let Some(appimage) = crate::app_paths::recorded_appimage() {
            if tools.tectonic.is_none() || tools.typst.is_none() {
                checks.push(check(
                    "appimage",
                    DoctorStatus::Warning,
                    format!(
                        "Your Oleafly AppImage ({}) keeps its engines inside the image. Install tectonic, typst and pandoc, or use the .deb or .rpm package.",
                        appimage.display()
                    ),
                ));
            }
        }
    }
    checks.extend(command_line_tool_check());
    checks
}

#[cfg(windows)]
fn command_line_tool_check() -> Option<DoctorCheck> {
    Some(match crate::install::windows::status() {
        Ok(status) if status.on_path => {
            check("command_line_tool", DoctorStatus::Pass, format!("{} is on your PATH", status.bin_dir.display()))
        }
        Ok(_) => check(
            "command_line_tool",
            DoctorStatus::Warning,
            "`oleafly` isn't on your PATH. Turn on the terminal command in Oleafly's Settings › General.",
        ),
        Err(error) => check("command_line_tool", DoctorStatus::Warning, error.message),
    })
}

#[cfg(not(windows))]
fn command_line_tool_check() -> Option<DoctorCheck> {
    None
}

fn status_of(status: DoctorStatus) -> CheckStatus {
    match status {
        DoctorStatus::Pass => CheckStatus::Pass,
        DoctorStatus::Warning => CheckStatus::Warning,
        DoctorStatus::Fail => CheckStatus::Fail,
    }
}

fn print_doctor(report: &DoctorReport, inventory: Option<&TypstInventory>) {
    for check in &report.checks {
        anstream::println!(
            "{} {}: {}",
            status_label(status_of(check.status)),
            check.name,
            check.message
        );
    }
    let Some(inventory) = inventory else {
        return;
    };
    if inventory.found.is_empty() {
        println!("Typst found: none");
        return;
    }
    println!("Typst found:");
    for found in &inventory.found {
        let version = found
            .version
            .as_ref()
            .map_or_else(|| "unknown".to_string(), ToString::to_string);
        println!(
            "  {version:<12} {:<13} {}",
            found.source.label(),
            found.path.display()
        );
    }
}

pub(crate) fn typst_settings_lines(pin: Option<&str>, settings: &SettingsSummary) -> Vec<String> {
    let path = |path: &Option<PathBuf>| {
        path.as_ref()
            .map_or_else(|| "none".to_string(), |path| path.display().to_string())
    };
    let variants = settings
        .variants
        .iter()
        .map(|(name, inputs)| match assignments(inputs).as_slice() {
            [] => name.clone(),
            inputs => format!("{name} ({})", inputs.join(", ")),
        })
        .collect();
    [
        ("Version pin", pin.unwrap_or("none").to_string()),
        ("Vendored packages", on_off(settings.vendor_packages)),
        ("Package folder", path(&settings.package_path)),
        ("Package cache", path(&settings.package_cache_path)),
        (
            "Font folders",
            listed(
                settings
                    .font_dirs
                    .iter()
                    .map(|directory| directory.display().to_string())
                    .collect(),
            ),
        ),
        (
            "System fonts",
            if settings.system_fonts {
                "used"
            } else {
                "ignored"
            }
            .to_string(),
        ),
        ("Reproducible", on_off(settings.reproducible)),
        ("Inputs", listed(assignments(&settings.inputs))),
        ("Variants", listed(variants)),
    ]
    .into_iter()
    .map(|(label, value)| format!("  {label:<18} {value}"))
    .collect()
}

/// The doctor report as a value (the MCP `doctor` tool uses it).
pub(crate) async fn doctor_value(ctx: &Context) -> Result<Value, CliError> {
    match run_doctor(ctx).await {
        Ok(outcome) => Ok(Value::Object(outcome.fields)),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doctor_lists_the_effective_typst_settings() {
        let summary = SettingsSummary {
            vendor_packages: true,
            package_path: Some(PathBuf::from("/p/typst-packages")),
            package_cache_path: Some(PathBuf::from("/data/typst/packages-cache")),
            font_dirs: vec![PathBuf::from("/p/fonts"), PathBuf::from("/p/assets/type")],
            system_fonts: false,
            reproducible: true,
            inputs: [("draft".to_string(), "true".to_string())].into(),
            variants: [
                (
                    "review".to_string(),
                    [("anonymous".to_string(), "true".to_string())].into(),
                ),
                ("plain".to_string(), Default::default()),
            ]
            .into(),
        };
        let lines = typst_settings_lines(Some("0.13.1"), &summary);
        let value = |label: &str| {
            lines
                .iter()
                .find_map(|line| line.trim_start().strip_prefix(label))
                .map(str::trim)
                .unwrap_or_else(|| panic!("no {label} line in {lines:?}"))
                .to_string()
        };
        assert_eq!(value("Version pin"), "0.13.1");
        assert_eq!(value("Vendored packages"), "on");
        assert_eq!(value("Package folder"), "/p/typst-packages");
        assert_eq!(value("Font folders"), "/p/fonts, /p/assets/type");
        assert_eq!(value("System fonts"), "ignored");
        assert_eq!(value("Reproducible"), "on");
        assert_eq!(value("Inputs"), "draft=true");
        assert_eq!(value("Variants"), "plain, review (anonymous=true)");

        let empty = SettingsSummary::of(None, Path::new("/nowhere"), None);
        let lines = typst_settings_lines(None, &empty);
        for label in [
            "Version pin",
            "Package folder",
            "Font folders",
            "Inputs",
            "Variants",
        ] {
            assert!(
                lines
                    .iter()
                    .any(|line| line.trim_start().starts_with(label) && line.ends_with(" none")),
                "{label}: {lines:?}"
            );
        }
        assert!(lines.iter().any(|line| line.ends_with(" used")));
    }

    #[test]
    fn a_missing_engine_is_a_warning_outside_projects() {
        let tools = BuildTools::default();
        let missing = engine_check("tectonic", None, &tools, None);
        assert_eq!(missing.status, DoctorStatus::Warning);
        assert!(missing.message.contains("https://"));
    }
}
