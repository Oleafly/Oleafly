//! `oleafly config`, `oleafly projects` and `oleafly skills`.
//!
//! `config` reads and changes a project's `project.json` (by default) or a
//! short allow-list of the app's settings (`--global`). Secrets and the MCP
//! settings are never shown or changed here.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::{Args, Subcommand};
use oleafly_core::{Engine, ProjectManifest, TexFlavor, Workspace};
use serde_json::{json, Map, Value};

use super::CommandModule;
use crate::app_paths::ProjectIdentity;
use crate::contract::{CliError, Context, ErrorKind, Outcome};
use crate::skills_read::{read_skills, valid_skill_id, SkillEntry};

const LOCK_BUDGET: Duration = Duration::from_secs(10);
const MAX_PROJECTS: usize = 10_000;

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Read and change project or app settings
    #[command(subcommand)]
    Config(ConfigCommand),
    /// List the projects the Oleafly app knows
    #[command(subcommand)]
    Projects(ProjectsCommand),
    /// List the skills the app's assistant and agents can load
    #[command(subcommand)]
    Skills(SkillsCommand),
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    /// Show every setting
    List(ScopeArgs),
    /// Show one setting
    Get(KeyArgs),
    /// Change a setting
    Set(SetArgs),
    /// Remove a setting (back to its default)
    Unset(KeyArgs),
}

#[derive(Debug, Args)]
pub struct ScopeArgs {
    #[arg(long, help = "The app's settings instead of the project's")]
    pub global: bool,
}

#[derive(Debug, Args)]
pub struct KeyArgs {
    #[arg(value_name = "KEY")]
    pub key: String,
    #[arg(long, help = "The app's settings instead of the project's")]
    pub global: bool,
}

#[derive(Debug, Args)]
pub struct SetArgs {
    #[arg(value_name = "KEY")]
    pub key: String,
    #[arg(value_name = "VALUE")]
    pub value: String,
    #[arg(long, help = "The app's settings instead of the project's")]
    pub global: bool,
}

#[derive(Debug, Subcommand)]
pub enum ProjectsCommand {
    /// List library projects and folders opened in place
    List,
}

#[derive(Debug, Subcommand)]
pub enum SkillsCommand {
    /// List installed skills
    List,
    /// Print the skills folder, or one skill's folder
    Path(SkillPathArgs),
}

#[derive(Debug, Args)]
pub struct SkillPathArgs {
    #[arg(value_name = "ID")]
    pub id: Option<String>,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Config(ConfigCommand::List(_)) => "config list",
            Self::Config(ConfigCommand::Get(_)) => "config get",
            Self::Config(ConfigCommand::Set(_)) => "config set",
            Self::Config(ConfigCommand::Unset(_)) => "config unset",
            Self::Projects(ProjectsCommand::List) => "projects list",
            Self::Skills(SkillsCommand::List) => "skills list",
            Self::Skills(SkillsCommand::Path(_)) => "skills path",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        tokio::task::block_in_place(|| match self {
            Self::Config(ConfigCommand::List(args)) => config_list(ctx, args.global),
            Self::Config(ConfigCommand::Get(args)) => config_get(ctx, &args.key, args.global),
            Self::Config(ConfigCommand::Set(args)) => {
                config_set(ctx, &args.key, Some(&args.value), args.global)
            }
            Self::Config(ConfigCommand::Unset(args)) => {
                config_set(ctx, &args.key, None, args.global)
            }
            Self::Projects(ProjectsCommand::List) => projects_list(ctx),
            Self::Skills(SkillsCommand::List) => skills_list(ctx),
            Self::Skills(SkillsCommand::Path(args)) => skills_path(ctx, args.id.as_deref()),
        })
    }
}

// ------------------------------------------------------- global settings

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyKind {
    Bool,
    TypstVersion,
    LatexEngine,
    Locale,
    /// Shown, but changed only in the app.
    ReadOnly,
}

/// The app settings the CLI shows: CLI name, `config.json` key, kind.
/// The app's counter of CLI changes to [`APP_SAVED_KEYS`].
const CLI_REVISION_KEY: &str = "cli_settings_revision";
/// Settings the app saves from its settings views as part of the whole
/// config (the others it keeps as stored, or changes on their own).
const APP_SAVED_KEYS: [&str; 5] = [
    "checkpoints_enabled",
    "checkpoint_notifications",
    "git_auto_init",
    "skills_share_with_agents",
    "ui_locale",
];

pub const GLOBAL_KEYS: &[(&str, &str, KeyKind)] = &[
    (
        "typst.default_version",
        "typst_default_version",
        KeyKind::TypstVersion,
    ),
    (
        "latex.default_engine",
        "latex_default_engine",
        KeyKind::LatexEngine,
    ),
    ("checkpoints.enabled", "checkpoints_enabled", KeyKind::Bool),
    (
        "checkpoints.notifications",
        "checkpoint_notifications",
        KeyKind::Bool,
    ),
    ("git.auto_init", "git_auto_init", KeyKind::Bool),
    (
        "skills.share_with_agents",
        "skills_share_with_agents",
        KeyKind::Bool,
    ),
    ("live_collaboration", "live_collaboration", KeyKind::Bool),
    ("ui.locale", "ui_locale", KeyKind::Locale),
    ("mcp.enabled", "mcp_enabled", KeyKind::ReadOnly),
    ("mcp.port", "mcp_port", KeyKind::ReadOnly),
    ("mcp.read_only", "mcp_read_only", KeyKind::ReadOnly),
    (
        "mcp.approval_policy",
        "mcp_approval_policy",
        KeyKind::ReadOnly,
    ),
];

fn looks_secret(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "key",
        "secret",
        "password",
        "mcp_servers",
        "mcp.servers",
    ]
    .iter()
    .any(|word| key.contains(word))
}

fn global_key(key: &str) -> Result<(&'static str, &'static str, KeyKind), CliError> {
    if let Some(found) = GLOBAL_KEYS.iter().find(|(name, _, _)| *name == key) {
        return Ok(*found);
    }
    if looks_secret(key) {
        return Err(CliError::new(
            ErrorKind::Usage,
            "config.secret_key",
            "The CLI doesn't show or change secrets.",
        )
        .hint("Change keys and tokens in the Oleafly app's Settings."));
    }
    Err(
        CliError::usage(format!("{key} isn't a setting the CLI can use.")).details(
            json!({"keys": GLOBAL_KEYS.iter().map(|(name, _, _)| *name).collect::<Vec<_>>()}),
        ),
    )
}

fn data_root(ctx: &Context) -> Result<PathBuf, CliError> {
    ctx.data_root().map(Path::to_path_buf).ok_or_else(|| {
        CliError::new(
            ErrorKind::InvalidInput,
            "environment.no_data_folder",
            "Oleafly couldn't find its data folder.",
        )
        .hint("Set OLEAFLY_DATA_DIR, or HOME (USERPROFILE on Windows).")
    })
}

/// A setting's value as the app would use it (its default when unset).
fn global_value(config: &Map<String, Value>, file_key: &str, kind: KeyKind) -> Value {
    match (config.get(file_key), kind) {
        (Some(value), _) if !value.is_null() => value.clone(),
        (_, KeyKind::TypstVersion) => json!(oleafly_downloads::typst::bundled_version()),
        (_, KeyKind::LatexEngine) => json!("tectonic"),
        (_, KeyKind::Locale) => json!("system"),
        (_, KeyKind::Bool) => json!(!matches!(file_key, "live_collaboration")),
        (_, KeyKind::ReadOnly) => Value::Null,
    }
}

fn valid_locale(value: &str) -> bool {
    if value == "system" {
        return true;
    }
    let (language, region) = match value.split_once('-') {
        Some((language, region)) => (language, Some(region)),
        None => (value, None),
    };
    (2..=3).contains(&language.len())
        && language.bytes().all(|byte| byte.is_ascii_lowercase())
        && region.is_none_or(|region| {
            (2..=4).contains(&region.len()) && region.bytes().all(|byte| byte.is_ascii_alphabetic())
        })
}

/// The JSON a global setting stores, or `None` to remove it.
fn global_setting(
    ctx: &Context,
    name: &str,
    kind: KeyKind,
    value: Option<&str>,
) -> Result<Option<Value>, CliError> {
    let Some(value) = value.map(str::trim) else {
        return Ok(None);
    };
    match kind {
        KeyKind::ReadOnly => Err(CliError::usage(format!(
            "{name} can only be changed in the app."
        ))
        .hint("Change MCP settings in the app.")),
        KeyKind::Bool => match value.to_ascii_lowercase().as_str() {
            "true" | "on" | "yes" | "1" => Ok(Some(json!(true))),
            "false" | "off" | "no" | "0" => Ok(Some(json!(false))),
            _ => Err(CliError::usage(format!("{name} takes true or false."))),
        },
        KeyKind::LatexEngine => match value {
            crate::app_config::LATEXMK_ENGINE => Ok(Some(json!(crate::app_config::LATEXMK_ENGINE))),
            "tectonic" | "xetex" => Ok(None),
            _ => Err(CliError::usage(
                "latex.default_engine takes latexmk or tectonic.",
            )),
        },
        KeyKind::Locale => {
            if valid_locale(value) {
                Ok(Some(json!(value)))
            } else {
                Err(CliError::usage(
                    "ui.locale takes system or a language tag such as de or pt-BR.",
                ))
            }
        }
        KeyKind::TypstVersion => {
            let data_root = data_root(ctx)?;
            let discovery = crate::native::Discovery::from_env(ctx.project());
            let bundled = discovery
                .bundled_candidates("typst")
                .into_iter()
                .find(|path| path.is_file());
            let toolchain = oleafly_downloads::typst::TypstToolchain::new(
                data_root.clone(),
                oleafly_core::typst_toolchain::host_target(),
                bundled,
                crate::app_config::typst_default_choice(&data_root),
                oleafly_downloads::typst::SystemLookup::Cached,
            );
            Ok(toolchain
                .default_choice_for(Some(value))
                .map_err(super::typst_cmd::typst_error)?
                .map(Value::from))
        }
    }
}

fn global_list(ctx: &Context) -> Result<Vec<(String, Value)>, CliError> {
    let config = ctx
        .data_root()
        .and_then(crate::app_config::read_app_config)
        .unwrap_or_default();
    Ok(GLOBAL_KEYS
        .iter()
        .map(|(name, file_key, kind)| (name.to_string(), global_value(&config, file_key, *kind)))
        .collect())
}

// ------------------------------------------------------ project settings

const PROJECT_KEYS: &[&str] = &[
    "name",
    "main",
    "engine",
    "compiler",
    "typst.version",
    "compile_dir",
];

/// The project folder `-C` names (its `project.json` must exist).
fn project_root(ctx: &Context) -> Result<PathBuf, CliError> {
    let opened = crate::engine::open_project(ctx.project(), None, None)?;
    let root = opened.workspace.root().to_path_buf();
    if !root.join("project.json").is_file() {
        let error = CliError::new(
            ErrorKind::InvalidInput,
            "config.no_project_json",
            "This folder has no project.json.",
        );
        return Err(match opened.origin {
            crate::engine::ProjectOrigin::Linked { .. } => {
                error.hint("The app keeps this folder's settings itself. Change them in the app.")
            }
            _ => error.hint("Run `oleafly init` to create one."),
        });
    }
    Ok(root)
}

fn read_project_json(root: &Path) -> Result<Map<String, Value>, CliError> {
    let path = root.join("project.json");
    let metadata = std::fs::metadata(&path).map_err(CliError::from)?;
    if metadata.len() > oleafly_core::MAX_MANIFEST_BYTES {
        return Err(CliError::new(
            ErrorKind::InvalidManifest,
            "project.invalid_manifest",
            "project.json is too large.",
        ));
    }
    match serde_json::from_slice::<Value>(&std::fs::read(&path).map_err(CliError::from)?) {
        Ok(Value::Object(fields)) => Ok(fields),
        _ => Err(CliError::new(
            ErrorKind::InvalidManifest,
            "project.invalid_manifest",
            "project.json isn't a JSON object.",
        )),
    }
}

fn project_value(manifest: &ProjectManifest, key: &str) -> Value {
    match key {
        "name" => json!(manifest.name),
        "main" => json!(manifest.main_doc),
        "engine" => json!(manifest
            .engine()
            .map(|engine| engine.canonical_name())
            .unwrap_or(manifest.engine.as_str())),
        "compiler" => json!(manifest.tex_flavor),
        "typst.version" => json!(manifest.typst_version_pin()),
        "compile_dir" => json!(manifest.compile_dir),
        _ => Value::Null,
    }
}

/// Applies one project setting to `project.json`'s fields.
fn apply_project_setting(
    root: &Path,
    fields: &mut Map<String, Value>,
    key: &str,
    value: Option<&str>,
) -> Result<(), CliError> {
    let value = value.map(str::trim);
    match key {
        "name" => match value {
            Some(name) if !name.is_empty() => {
                fields.insert("name".into(), json!(name));
            }
            _ => return Err(CliError::usage("A project needs a name.")),
        },
        "main" => {
            let Some(main) = value.filter(|main| !main.is_empty()) else {
                return Err(CliError::usage("A project needs a main document."));
            };
            let main = main.trim_start_matches("./");
            let file = oleafly_core::resolve_project_path(root, main).map_err(|_| {
                CliError::new(
                    ErrorKind::UnsafePath,
                    "project.unsafe_path",
                    format!("{main} isn't a path inside the project."),
                )
            })?;
            if !file.is_file() {
                return Err(CliError::new(
                    ErrorKind::InvalidInput,
                    "project.invalid_input",
                    format!("{main} doesn't exist in this project."),
                ));
            }
            fields.insert("main_doc".into(), json!(main));
            match oleafly_core::compile_dir_for(root, main) {
                Some(dir) => fields.insert("compile_dir".into(), json!(dir)),
                None => fields.remove("compile_dir"),
            };
        }
        "engine" => {
            let engine = value.and_then(Engine::named).ok_or_else(|| {
                CliError::usage("engine takes tectonic, latexmk, typst or markdown.")
            })?;
            fields.insert("engine".into(), json!(engine.manifest_name()));
            if engine != Engine::Latexmk {
                fields.remove("tex_flavor");
            }
        }
        "compiler" => match value {
            Some(flavor) => {
                let flavor = TexFlavor::parse(flavor).ok_or_else(|| {
                    CliError::usage(
                        "compiler takes pdflatex, xelatex, lualatex, uplatex or platex.",
                    )
                })?;
                fields.insert("tex_flavor".into(), json!(flavor.as_str()));
            }
            None => {
                fields.remove("tex_flavor");
            }
        },
        "typst.version" => {
            let typst = fields.entry("typst").or_insert_with(|| json!({}));
            let Some(object) = typst.as_object_mut() else {
                return Err(CliError::new(
                    ErrorKind::InvalidManifest,
                    "project.invalid_manifest",
                    "project.json's typst setting isn't an object.",
                ));
            };
            match value {
                Some(version) => {
                    let parsed = oleafly_downloads::typst::parse_version(version)
                        .map_err(super::typst_cmd::typst_error)?;
                    object.insert("version".into(), json!(parsed.to_string()));
                }
                None => {
                    object.remove("version");
                }
            }
        }
        "compile_dir" => match value {
            Some(dir) => {
                let path = oleafly_core::resolve_project_path(root, dir).map_err(|_| {
                    CliError::new(
                        ErrorKind::UnsafePath,
                        "project.unsafe_path",
                        format!("{dir} isn't a folder inside the project."),
                    )
                })?;
                if !path.is_dir() {
                    return Err(CliError::new(
                        ErrorKind::InvalidInput,
                        "project.invalid_input",
                        format!("{dir} isn't a folder in this project."),
                    ));
                }
                fields.insert("compile_dir".into(), json!(dir.trim_end_matches('/')));
            }
            None => {
                fields.remove("compile_dir");
            }
        },
        _ => {
            return Err(CliError::usage(format!("{key} isn't a project setting."))
                .details(json!({"keys": PROJECT_KEYS})));
        }
    }
    Ok(())
}

/// The app's lock on a project it knows (writes wait for the app).
fn project_lock(ctx: &Context, root: &Path) -> Result<Option<std::fs::File>, CliError> {
    let Some(data_root) = ctx.data_root() else {
        return Ok(None);
    };
    let Some(identity) = crate::app_paths::project_identity(root, data_root) else {
        return Ok(None);
    };
    if crate::app_paths::restore_pending(root, &identity) {
        return Err(CliError::new(
            ErrorKind::Conflict,
            "conflict.restore_pending",
            "The app is restoring a checkpoint of this project.",
        )
        .hint("Open the project in Oleafly to finish the restore, then try again.")
        .retryable());
    }
    crate::app_paths::worktree_lock(data_root, identity.id(), LOCK_BUDGET).map(Some)
}

fn write_project_json(
    root: &Path,
    fields: Map<String, Value>,
) -> Result<ProjectManifest, CliError> {
    let manifest: ProjectManifest =
        serde_json::from_value(Value::Object(fields.clone())).map_err(|error| {
            CliError::new(
                ErrorKind::InvalidManifest,
                "project.invalid_manifest",
                format!("project.json would be invalid: {error}"),
            )
        })?;
    Workspace::from_manifest(root, manifest.clone())?;
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(fields))
        .map_err(|error| CliError::internal(error.to_string()))?;
    bytes.push(b'\n');
    oleafly_core::atomic::write_atomic(&root.join("project.json"), &bytes)
        .map_err(CliError::from)?;
    Ok(manifest)
}

// --------------------------------------------------------------- commands

fn config_list(ctx: &Context, global: bool) -> Result<Outcome, CliError> {
    let entries: Vec<(String, Value)> = if global {
        global_list(ctx)?
    } else {
        let manifest = Workspace::open(project_root(ctx)?)?.manifest().clone();
        PROJECT_KEYS
            .iter()
            .map(|key| (key.to_string(), project_value(&manifest, key)))
            .collect()
    };
    if !ctx.json() {
        for (key, value) in &entries {
            let shown = match value {
                Value::Null => "-".to_string(),
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            ctx.say(format!("{key} = {shown}"));
        }
    }
    let settings: Map<String, Value> = entries.into_iter().collect();
    Ok(Outcome::success(
        json!({"scope": if global { "global" } else { "project" }, "settings": settings}),
    ))
}

fn config_get(ctx: &Context, key: &str, global: bool) -> Result<Outcome, CliError> {
    let value = if global {
        let (_, file_key, kind) = global_key(key)?;
        let config = ctx
            .data_root()
            .and_then(crate::app_config::read_app_config)
            .unwrap_or_default();
        global_value(&config, file_key, kind)
    } else {
        if !PROJECT_KEYS.contains(&key) {
            if GLOBAL_KEYS.iter().any(|(name, _, _)| *name == key) {
                return Err(CliError::usage(format!("{key} is an app setting."))
                    .hint(format!("Use `oleafly config get {key} --global`.")));
            }
            return Err(CliError::usage(format!("{key} isn't a project setting."))
                .details(json!({"keys": PROJECT_KEYS})));
        }
        let manifest = Workspace::open(project_root(ctx)?)?.manifest().clone();
        project_value(&manifest, key)
    };
    if !ctx.json() {
        ctx.say(match &value {
            Value::Null => String::new(),
            Value::String(text) => text.clone(),
            other => other.to_string(),
        });
    }
    Ok(Outcome::success(json!({"key": key, "value": value})))
}

fn config_set(
    ctx: &Context,
    key: &str,
    value: Option<&str>,
    global: bool,
) -> Result<Outcome, CliError> {
    if global {
        let (name, file_key, kind) = global_key(key)?;
        if kind == KeyKind::ReadOnly {
            return Err(
                CliError::usage(format!("{name} can only be changed in the app."))
                    .hint("Change MCP settings in the app."),
            );
        }
        let stored = global_setting(ctx, name, kind, value)?;
        let data_root = data_root(ctx)?;
        let to_store = stored.clone();
        crate::app_config::update_app_config(&data_root, move |config| {
            let before = config.get(file_key).cloned();
            match to_store {
                Some(value) => {
                    config.insert(file_key.into(), value);
                }
                None => {
                    config.remove(file_key);
                }
            }
            // A settings view of the open app that read its copy before
            // this keeps what the CLI set when it saves (the app compares
            // revisions).
            if config.get(file_key) != before.as_ref() && APP_SAVED_KEYS.contains(&file_key) {
                let revision = config
                    .get(CLI_REVISION_KEY)
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                config.insert(CLI_REVISION_KEY.into(), json!(revision.saturating_add(1)));
            }
            Ok(())
        })?;
        let config = crate::app_config::read_app_config(&data_root).unwrap_or_default();
        let effective = global_value(&config, file_key, kind);
        if !ctx.json() {
            ctx.say(format!(
                "{name} = {}",
                effective
                    .as_str()
                    .map_or_else(|| effective.to_string(), str::to_string)
            ));
            ctx.note("If the Oleafly app is open, restart it to pick this up.");
        }
        return Ok(Outcome::success(
            json!({"key": name, "value": effective, "scope": "global"}),
        ));
    }
    if !PROJECT_KEYS.contains(&key) {
        if GLOBAL_KEYS.iter().any(|(name, _, _)| *name == key) {
            return Err(
                CliError::usage(format!("{key} is an app setting.")).hint(format!(
                    "Add --global: `oleafly config set {key} <value> --global`."
                )),
            );
        }
        if looks_secret(key) {
            return Err(CliError::new(
                ErrorKind::Usage,
                "config.secret_key",
                "The CLI doesn't show or change secrets.",
            ));
        }
        return Err(CliError::usage(format!("{key} isn't a project setting."))
            .details(json!({"keys": PROJECT_KEYS})));
    }
    if key == "typst.version" {
        if let Some(version) = value.map(str::trim).filter(|version| !version.is_empty()) {
            accepted_typst_pin(ctx, version)?;
        }
    }
    let root = project_root(ctx)?;
    let _lock = project_lock(ctx, &root)?;
    let mut fields = read_project_json(&root)?;
    apply_project_setting(&root, &mut fields, key, value)?;
    let manifest = write_project_json(&root, fields)?;
    let effective = project_value(&manifest, key);
    if !ctx.json() {
        let shown = match &effective {
            Value::Null => "(unset)".to_string(),
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        ctx.say(format!("{key} = {shown}"));
    }
    Ok(Outcome::success(
        json!({"key": key, "value": effective, "scope": "project"}),
    ))
}

/// Refuses a Typst version the app wouldn't accept as a pin: one the
/// catalog doesn't list that is neither bundled nor the system's (a typo
/// would make every build fail).
fn accepted_typst_pin(ctx: &Context, version: &str) -> Result<(), CliError> {
    let bundled = crate::native::Discovery::from_env(ctx.project())
        .bundled_candidates("typst")
        .into_iter()
        .find(|path| path.is_file());
    let (data_root, lookup) = match ctx.data_root() {
        Some(root) => (
            root.to_path_buf(),
            oleafly_downloads::typst::SystemLookup::Cached,
        ),
        None => (PathBuf::new(), oleafly_downloads::typst::SystemLookup::Lazy),
    };
    let default_choice = ctx
        .data_root()
        .and_then(crate::app_config::typst_default_choice);
    oleafly_downloads::typst::TypstToolchain::new(
        data_root,
        oleafly_core::typst_toolchain::host_target(),
        bundled,
        default_choice,
        lookup,
    )
    .accepted_pin(version)
    .map(|_| ())
    .map_err(super::typst_cmd::typst_error)
}

fn read_manifest_at(path: &Path) -> Option<ProjectManifest> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > oleafly_core::MAX_MANIFEST_BYTES {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn library_opened_at(data_root: &Path) -> BTreeMap<String, u64> {
    #[derive(serde::Deserialize)]
    struct Recents {
        #[serde(default)]
        version: u32,
        #[serde(default)]
        opened: BTreeMap<String, u64>,
    }
    let path = data_root.join("recent-projects.json");
    std::fs::metadata(&path)
        .ok()
        .filter(|metadata| metadata.is_file() && metadata.len() <= 256 * 1024)
        .and_then(|_| std::fs::read(&path).ok())
        .and_then(|bytes| serde_json::from_slice::<Recents>(&bytes).ok())
        .filter(|recents| recents.version == 1)
        .map(|recents| recents.opened)
        .unwrap_or_default()
}

fn projects_list(ctx: &Context) -> Result<Outcome, CliError> {
    let Some(data_root) = ctx.data_root().filter(|root| root.is_dir()) else {
        if !ctx.json() {
            ctx.note("The Oleafly app has no projects on this computer yet.");
        }
        return Ok(Outcome::success(json!({"projects": []})));
    };
    let opened = library_opened_at(data_root);
    let linked = crate::desktop_link::links(data_root);
    let linked_ids: std::collections::HashSet<String> =
        linked.iter().map(|(info, _)| info.id.clone()).collect();
    let mut projects: Vec<Value> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(data_root.join("projects")) {
        for entry in entries.flatten().take(MAX_PROJECTS) {
            let Ok(id) = entry.file_name().into_string() else {
                continue;
            };
            if id.starts_with('.')
                || linked_ids.contains(&id)
                || !entry.file_type().is_ok_and(|kind| kind.is_dir())
            {
                continue;
            }
            if crate::app_paths::project_identity(&entry.path(), data_root)
                .is_none_or(|identity| !matches!(identity, ProjectIdentity::Library { .. }))
            {
                continue;
            }
            let Some(manifest) = read_manifest_at(&entry.path().join("project.json")) else {
                continue;
            };
            projects.push(json!({
                "id": id,
                "kind": "library",
                "name": manifest.name,
                "path": entry.path(),
                "engine": manifest.engine().map(|engine| engine.canonical_name()).unwrap_or("unknown"),
                "main_document": manifest.main_doc,
                "last_opened_ms": opened.get(&id),
                "hidden": manifest.hidden,
            }));
        }
    }
    for (info, folder) in linked {
        let saved = read_manifest_at(&folder.join("project.json"))
            .or_else(|| read_manifest_at(&info.state_dir.join("project.json")));
        let name = info
            .display_name
            .clone()
            .or_else(|| {
                saved
                    .as_ref()
                    .map(|manifest| manifest.name.clone())
                    .filter(|name| !name.is_empty())
            })
            .unwrap_or_else(|| {
                folder
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            });
        projects.push(json!({
            "id": info.id,
            "kind": "folder",
            "name": name,
            "path": folder,
            "engine": saved.as_ref().and_then(|manifest| manifest.engine().ok()).map(|engine| engine.canonical_name()),
            "main_document": saved.as_ref().map(|manifest| manifest.main_doc.clone()),
            "last_opened_ms": info.last_opened_at,
            "hidden": false,
        }));
    }
    projects.sort_by(|a, b| {
        let opened = |value: &Value| value["last_opened_ms"].as_u64().unwrap_or(0);
        opened(b).cmp(&opened(a)).then_with(|| {
            a["name"]
                .as_str()
                .unwrap_or("")
                .cmp(b["name"].as_str().unwrap_or(""))
        })
    });
    if !ctx.json() {
        for project in projects
            .iter()
            .filter(|project| project["hidden"] != json!(true))
        {
            if ctx.quiet() {
                ctx.say(project["path"].as_str().unwrap_or(""));
            } else {
                ctx.say(format!(
                    "{:<32} {:<8} {}",
                    project["name"].as_str().unwrap_or(""),
                    project["kind"].as_str().unwrap_or(""),
                    project["path"].as_str().unwrap_or("")
                ));
            }
        }
    }
    Ok(Outcome::success(json!({"projects": projects})))
}

// ------------------------------------------------------------------ skills

/// The skills folder: `<data>/skills`, else the installed app's bundled set.
fn skills_root(ctx: &Context) -> Option<PathBuf> {
    let data = ctx
        .data_root()
        .map(|root| root.join("skills"))
        .filter(|dir| dir.is_dir());
    data.or_else(|| {
        crate::app_paths::installed_app()
            .and_then(|app| app.resources_dir)
            .map(|dir| dir.join("skills"))
            .filter(|dir| dir.is_dir())
    })
}

fn skill_json(skill: &SkillEntry) -> Value {
    json!({"id": skill.id, "name": skill.name, "description": skill.description, "path": skill.path, "source": skill.source})
}

fn skills_list(ctx: &Context) -> Result<Outcome, CliError> {
    let skills = skills_root(ctx)
        .map(|root| read_skills(&root))
        .unwrap_or_default();
    if !ctx.json() {
        if skills.is_empty() {
            ctx.note(
                "No skills are installed. The Oleafly app installs its skills on first launch.",
            );
        }
        for skill in &skills {
            if ctx.quiet() {
                ctx.say(&skill.id);
            } else {
                let description: String = skill.description.chars().take(80).collect();
                ctx.say(format!("{:<32} {description}", skill.id));
            }
        }
    }
    Ok(Outcome::success(
        json!({"skills": skills.iter().map(skill_json).collect::<Vec<_>>()}),
    ))
}

fn skills_path(ctx: &Context, id: Option<&str>) -> Result<Outcome, CliError> {
    let root = skills_root(ctx).ok_or_else(|| {
        CliError::new(
            ErrorKind::InvalidInput,
            "skills.none",
            "No skills are installed.",
        )
        .hint("Open the Oleafly app once to install its skills.")
    })?;
    let path = match id {
        None => root,
        Some(id) => {
            if !valid_skill_id(id) {
                return Err(CliError::new(
                    ErrorKind::UnsafePath,
                    "project.unsafe_path",
                    format!("{id} isn't a skill id."),
                ));
            }
            let folder = root.join(id);
            if !folder.join("SKILL.md").is_file() {
                return Err(CliError::new(
                    ErrorKind::InvalidInput,
                    "skills.unknown",
                    format!("There is no skill {id}."),
                )
                .hint("See them with `oleafly skills list`."));
            }
            folder
        }
    };
    if !ctx.json() {
        ctx.say(path.display().to_string());
    }
    Ok(Outcome::success(json!({"path": path})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::ContextOptions;

    fn context(project: &Path, data: &Path) -> Context {
        Context::for_test(ContextOptions {
            project: project.to_path_buf(),
            data_root: Some(data.to_path_buf()),
            ..Default::default()
        })
    }

    #[test]
    fn secret_keys_are_refused_without_echoing_values() {
        for key in ["github_token", "ai_keys", "mcp_token", "mcp.servers"] {
            assert_eq!(
                global_key(key).unwrap_err().code,
                "config.secret_key",
                "{key}"
            );
        }
        assert_eq!(global_key("theme").unwrap_err().code, "usage.invalid");
        let data = tempfile::tempdir().unwrap();
        std::fs::write(
            data.path().join("config.json"),
            r#"{"github_token":"ghp_secret","ai_keys":{"openai":"sk-1"},"git_auto_init":false}"#,
        )
        .unwrap();
        let ctx = context(data.path(), data.path());
        let listed = global_list(&ctx).unwrap();
        let text = serde_json::to_string(&listed).unwrap();
        assert!(!text.contains("ghp_secret") && !text.contains("sk-1"));
        assert!(listed.contains(&("git.auto_init".to_string(), json!(false))));
    }

    #[test]
    fn setting_one_key_keeps_every_other_key() {
        let data = tempfile::tempdir().unwrap();
        let original = json!({"theme": "dark", "ai_keys": {"openai": "sk-1"}, "nested": {"a": [1, 2]}, "latex_default_engine": null});
        std::fs::write(data.path().join("config.json"), original.to_string()).unwrap();
        let ctx = context(data.path(), data.path());
        config_set(&ctx, "latex.default_engine", Some("latexmk"), true).unwrap();
        let saved: Value =
            serde_json::from_slice(&std::fs::read(data.path().join("config.json")).unwrap())
                .unwrap();
        let mut expected = original.clone();
        expected["latex_default_engine"] = json!("latexmk");
        assert_eq!(saved, expected);
        config_set(&ctx, "latex.default_engine", Some("tectonic"), true).unwrap();
        let saved: Value =
            serde_json::from_slice(&std::fs::read(data.path().join("config.json")).unwrap())
                .unwrap();
        assert!(saved.get("latex_default_engine").is_none());
        assert_eq!(
            config_set(&ctx, "mcp.enabled", Some("true"), true)
                .unwrap_err()
                .code,
            "usage.invalid"
        );
    }

    #[test]
    fn a_global_change_to_a_setting_the_app_saves_bumps_the_revision() {
        let data = tempfile::tempdir().unwrap();
        let ctx = context(data.path(), data.path());
        let revision = || -> Value {
            let saved: Value =
                serde_json::from_slice(&std::fs::read(data.path().join("config.json")).unwrap())
                    .unwrap();
            saved[CLI_REVISION_KEY].clone()
        };
        config_set(&ctx, "git.auto_init", Some("false"), true).unwrap();
        assert_eq!(revision(), json!(1));
        // The same value again changes nothing.
        config_set(&ctx, "git.auto_init", Some("false"), true).unwrap();
        assert_eq!(revision(), json!(1));
        config_set(&ctx, "ui.locale", Some("de"), true).unwrap();
        assert_eq!(revision(), json!(2));
        // The app keeps this one as stored anyway.
        config_set(&ctx, "latex.default_engine", Some("latexmk"), true).unwrap();
        assert_eq!(revision(), json!(2));
    }

    #[test]
    fn a_typst_pin_the_app_wouldnt_accept_is_refused() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.typ"), "= Hi\n").unwrap();
        std::fs::write(
            project.path().join("project.json"),
            r#"{"name":"P","main_doc":"main.typ","engine":"typst"}"#,
        )
        .unwrap();
        let ctx = context(project.path(), data.path());
        assert!(config_set(&ctx, "typst.version", Some("0.31.1"), false).is_err());
        let saved = std::fs::read_to_string(project.path().join("project.json")).unwrap();
        assert!(!saved.contains("0.31.1"), "{saved}");
        let bundled = oleafly_downloads::typst::bundled_version();
        config_set(&ctx, "typst.version", Some(&bundled), false).unwrap();
    }

    #[test]
    fn locales_are_checked() {
        for good in ["system", "de", "pt-BR", "zh-Hans", "fil"] {
            assert!(valid_locale(good), "{good}");
        }
        for bad in ["", "DE", "english", "pt-", "zh-Hans-CN"] {
            assert!(!valid_locale(bad), "{bad}");
        }
    }

    #[test]
    fn project_settings_validate_and_keep_unknown_fields() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::create_dir(project.path().join("chapters")).unwrap();
        std::fs::write(project.path().join("main.tex"), "\\documentclass{article}").unwrap();
        // Its input resolves only beside it, so it compiles from there.
        std::fs::write(
            project.path().join("chapters/a.tex"),
            "\\documentclass{article}\n\\input{part}\n",
        )
        .unwrap();
        std::fs::write(project.path().join("chapters/part.tex"), "Part.").unwrap();
        std::fs::write(
            project.path().join("project.json"),
            r#"{"name":"P","main_doc":"main.tex","engine":"latexmk","color":"7","custom":{"x":1}}"#,
        )
        .unwrap();
        let ctx = context(project.path(), data.path());
        config_set(&ctx, "main", Some("chapters/a.tex"), false).unwrap();
        config_set(&ctx, "compiler", Some("lualatex"), false).unwrap();
        let saved: Value =
            serde_json::from_slice(&std::fs::read(project.path().join("project.json")).unwrap())
                .unwrap();
        assert_eq!(saved["main_doc"], "chapters/a.tex");
        assert_eq!(saved["compile_dir"], "chapters");
        assert_eq!(saved["tex_flavor"], "lualatex");
        assert_eq!(saved["custom"], json!({"x": 1}));
        assert_eq!(
            config_set(&ctx, "main", Some("missing.tex"), false)
                .unwrap_err()
                .exit(),
            crate::contract::Exit::Project
        );
        assert_eq!(
            config_set(&ctx, "main", Some("../x.tex"), false)
                .unwrap_err()
                .code,
            "project.unsafe_path"
        );
        config_set(&ctx, "engine", Some("typst"), false).unwrap_err();
    }

    #[test]
    fn skill_paths_take_single_names_only() {
        let data = tempfile::tempdir().unwrap();
        let skill = data.path().join("skills").join("a");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: A\n---\n").unwrap();
        let ctx = context(data.path(), data.path());
        let outcome = skills_path(&ctx, Some("a")).unwrap();
        assert_eq!(outcome.fields["path"], json!(skill));
        assert_eq!(
            skills_path(&ctx, Some("../x")).unwrap_err().code,
            "project.unsafe_path"
        );
    }
}
