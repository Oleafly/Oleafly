use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};
use oleafly_core::templates::{
    declared_template_engine, instantiate_from, is_valid_id, list_templates_in_roots,
    missing_font_packs, sort_templates, TemplateManifest,
};
use oleafly_core::{Engine, InitOptions, ProjectManifest, TypstSpec, Workspace};
use oleafly_downloads::template_packs::{
    catalog_from, packs_base_url, parse_index, refresh_catalog, v1_templates, CatalogPack,
    DownloadProgress, PackSource, PackTemplate,
};
use serde_json::{json, Value};

use super::common::CliEngine;
use super::CommandModule;
use crate::contract::{path_arg, CliError, Context, ErrorKind, Outcome};

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Create a project, empty or from a template
    New(NewArgs),
    /// List and inspect project templates
    #[command(subcommand)]
    Templates(TemplatesCommand),
}

#[derive(Debug, Args)]
pub struct NewArgs {
    #[arg(value_name = "DIR", value_parser = path_arg, help = "The new project's folder (it must be empty or not exist yet)")]
    pub dir: Option<PathBuf>,
    #[arg(
        long,
        value_name = "ID",
        help = "Start from this template (see `oleafly templates list --all`)"
    )]
    pub template: Option<String>,
    #[arg(long, help = "The project's display name")]
    pub name: Option<String>,
    #[arg(long, value_enum, help = "The document engine for an empty project")]
    pub engine: Option<CliEngine>,
    #[arg(long, help = "Don't create a Git repository")]
    pub no_git: bool,
}

#[derive(Debug, Subcommand)]
pub enum TemplatesCommand {
    /// List the installed templates
    List(ListArgs),
    /// Show a template's details and files
    Show(ShowArgs),
}

#[derive(Debug, Args)]
pub struct ListArgs {
    #[arg(long, help = "Also list templates that download on first use")]
    pub all: bool,
    #[arg(long, help = "Fetch the latest template catalog first")]
    pub refresh: bool,
}

#[derive(Debug, Args)]
pub struct ShowArgs {
    #[arg(value_name = "ID")]
    pub id: String,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::New(_) => "new",
            Self::Templates(TemplatesCommand::List(_)) => "templates list",
            Self::Templates(TemplatesCommand::Show(_)) => "templates show",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::New(args) => run_new(ctx, args).await,
            Self::Templates(TemplatesCommand::List(args)) => run_list(ctx, args).await,
            Self::Templates(TemplatesCommand::Show(args)) => run_show(ctx, args).await,
        }
    }
}

fn resources_dir() -> Option<PathBuf> {
    if let Some(dir) = crate::app_paths::installed_app().and_then(|app| app.resources_dir) {
        return Some(dir);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/resources");
    (cfg!(debug_assertions) && development.is_dir()).then_some(development)
}

fn templates_data(ctx: &Context) -> Option<PathBuf> {
    ctx.data_root().map(|root| root.join("templates"))
}

fn template_roots(ctx: &Context) -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Some(bundled) = resources_dir()
        .map(|dir| dir.join("templates"))
        .filter(|dir| dir.is_dir())
    {
        roots.push((bundled, "bundled"));
    }
    if let Some(data) = templates_data(ctx) {
        if let Ok(entries) = std::fs::read_dir(data.join("packs")) {
            let mut packs: Vec<PathBuf> = entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path())
                .collect();
            packs.sort();
            roots.extend(packs.into_iter().map(|pack| (pack, "pack")));
        }
        roots.push((data.join("custom"), "custom"));
    }
    roots
}

fn pack_catalog(ctx: &Context) -> Vec<CatalogPack> {
    let bundled = resources_dir()
        .map(|dir| dir.join("template-packs.json"))
        .filter(|path| path.is_file());
    catalog_from(
        templates_data(ctx).as_deref(),
        bundled.as_deref(),
        &packs_base_url(),
    )
    .unwrap_or_default()
}

fn cached_pack_templates(templates_root: &Path, pack: &CatalogPack) -> Vec<PackTemplate> {
    match &pack.source {
        PackSource::Files(_) => {
            v1_templates(pack, Some(&templates_root.join("packs").join(&pack.id)))
        }
        PackSource::Index(_) => {
            let cache =
                oleafly_downloads::template_packs::index_cache_path(templates_root, &pack.id);
            std::fs::read_to_string(cache)
                .ok()
                .and_then(|text| parse_index(&text, &pack.id, &packs_base_url()).ok())
                .unwrap_or_default()
        }
    }
}

fn engine_label(manifest: &TemplateManifest) -> &'static str {
    match Engine::named(&manifest.engine) {
        Some(Engine::Typst) => "typst",
        Some(Engine::Markdown) => "markdown",
        Some(Engine::Latexmk) => "latexmk",
        Some(Engine::Tectonic) => "latex",
        Some(Engine::Quarto) => "quarto",
        Some(Engine::Calepin) => "calepin",
        None => "unknown",
    }
}

fn installed_json(manifest: &TemplateManifest, source: &str) -> Value {
    json!({
        "id": manifest.id,
        "name": manifest.name,
        "description": manifest.description,
        "category": manifest.category,
        "engine": engine_label(manifest),
        "main_doc": manifest.main_doc,
        "source": source,
        "pack": Value::Null,
    })
}

fn available_json(template: &PackTemplate, pack: &CatalogPack) -> Value {
    let info = &template.info;
    json!({
        "id": info.id,
        "name": info.name,
        "description": info.description,
        "category": info.category,
        "engine": info.engine,
        "main_doc": Value::Null,
        "source": "available",
        "pack": pack.id,
    })
}

async fn run_list(ctx: &Context, args: ListArgs) -> Result<Outcome, CliError> {
    if args.refresh {
        refresh_everything(ctx).await;
    }
    let roots = template_roots(ctx);
    let mut installed = tokio::task::spawn_blocking(move || list_templates_in_roots(&roots))
        .await
        .map_err(|error| CliError::internal(error.to_string()))?;
    sort_templates(&mut installed);
    let mut rows: Vec<Value> = installed
        .iter()
        .map(|(manifest, _, source)| installed_json(manifest, source))
        .collect();
    if args.all || args.refresh {
        if let Some(data) = templates_data(ctx) {
            let have: std::collections::HashSet<String> = installed
                .iter()
                .map(|(manifest, _, _)| manifest.id.clone())
                .collect();
            let mut indexes_missing = false;
            for pack in pack_catalog(ctx) {
                let templates = cached_pack_templates(&data, &pack);
                if templates.is_empty() && matches!(pack.source, PackSource::Index(_)) {
                    indexes_missing = true;
                }
                for template in templates
                    .iter()
                    .filter(|template| !have.contains(&template.info.id))
                {
                    rows.push(available_json(template, &pack));
                }
            }
            if indexes_missing && !args.refresh {
                ctx.note("Some packs haven't been fetched yet. Run with --refresh to list their templates.");
            }
        }
    }
    if !ctx.json() {
        for row in &rows {
            let id = row["id"].as_str().unwrap_or("");
            if ctx.quiet() {
                ctx.say(id);
                continue;
            }
            let source = match row["source"].as_str() {
                Some("available") => format!("download, {}", row["pack"].as_str().unwrap_or("")),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            ctx.say(format!(
                "{id:<32} {:<10} {} ({source})",
                row["engine"].as_str().unwrap_or(""),
                row["name"].as_str().unwrap_or("")
            ));
        }
    }
    Ok(Outcome::success(json!({"templates": rows})))
}

async fn refresh_everything(ctx: &Context) {
    let Some(data) = templates_data(ctx) else {
        return;
    };
    if let Err(error) = refresh_catalog(&data, true).await {
        ctx.warn(
            "templates.refresh_failed",
            format!("Oleafly couldn't fetch the template catalog: {error}"),
        );
        return;
    }
    for pack in pack_catalog(ctx)
        .iter()
        .filter(|pack| matches!(pack.source, PackSource::Index(_)))
    {
        if let Err(error) =
            oleafly_downloads::template_packs::pack_templates_in(&data, pack, true).await
        {
            ctx.warn(
                "templates.refresh_failed",
                format!(
                    "Oleafly couldn't fetch the {} pack's list: {error}",
                    pack.id
                ),
            );
        }
    }
}

fn find_installed(ctx: &Context, id: &str) -> Option<(TemplateManifest, PathBuf, &'static str)> {
    list_templates_in_roots(&template_roots(ctx))
        .into_iter()
        .find(|(manifest, _, _)| manifest.id == id)
}

fn find_available(ctx: &Context, id: &str) -> Option<(CatalogPack, PackTemplate)> {
    let data = templates_data(ctx)?;
    pack_catalog(ctx).into_iter().find_map(|pack| {
        let template = cached_pack_templates(&data, &pack)
            .into_iter()
            .find(|template| template.info.id == id)?;
        Some((pack, template))
    })
}

fn unknown_template(id: &str) -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "templates.unknown",
        format!("There is no template {id}."),
    )
    .hint("See them with `oleafly templates list --all` (add --refresh for the latest packs).")
}

fn template_files(root: &Path) -> Vec<String> {
    fn walk(base: &Path, folder: &Path, depth: usize, out: &mut Vec<String>) {
        if depth > oleafly_core::templates::MAX_COPY_DEPTH || out.len() >= 500 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(folder) else {
            return;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                walk(base, &path, depth + 1, out);
            } else if let Ok(relative) = path.strip_prefix(base) {
                out.push(
                    relative
                        .components()
                        .map(|part| part.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, 0, &mut out);
    out
}

async fn run_show(ctx: &Context, args: ShowArgs) -> Result<Outcome, CliError> {
    if !is_valid_id(&args.id) {
        return Err(unknown_template(&args.id));
    }
    if let Some((manifest, dir, source)) = find_installed(ctx, &args.id) {
        let root = oleafly_core::templates::source_root(&dir, &manifest).unwrap_or(dir.clone());
        let skip_meta = manifest.files_dir.is_none();
        let files: Vec<String> = template_files(&root)
            .into_iter()
            .filter(|file| {
                !skip_meta || !oleafly_core::templates::META_FILES.contains(&file.as_str())
            })
            .collect();
        if !ctx.json() {
            ctx.say(format!("{} ({})", manifest.name, manifest.id));
            if !manifest.description.is_empty() {
                ctx.say(&manifest.description);
            }
            ctx.say(format!(
                "Engine: {}   Main document: {}   Source: {source}",
                engine_label(&manifest),
                manifest.main_doc
            ));
            if !manifest.requires.fonts.is_empty() {
                ctx.say(format!(
                    "Font packs: {}",
                    manifest.requires.fonts.join(", ")
                ));
            }
            if let Some(license) = &manifest.license {
                if !license.spdx.is_empty() {
                    ctx.say(format!("License: {}", license.spdx));
                }
            }
            for file in &files {
                ctx.say(format!("  {file}"));
            }
        }
        return Ok(Outcome::success(json!({
            "template": installed_json(&manifest, source),
            "manifest": manifest,
            "files": files,
            "path": dir,
        })));
    }
    let Some((pack, template)) = find_available(ctx, &args.id) else {
        return Err(unknown_template(&args.id));
    };
    let files: Vec<&str> = template
        .files
        .iter()
        .map(|file| file.name.as_str())
        .collect();
    if !ctx.json() {
        let info = available_json(&template, &pack);
        ctx.say(format!(
            "{} ({})",
            info["name"].as_str().unwrap_or(""),
            args.id
        ));
        ctx.say(format!(
            "Downloads from the {} pack on first use.",
            pack.label
        ));
        for file in &files {
            ctx.say(format!("  {file}"));
        }
    }
    Ok(Outcome::success(
        json!({"template": available_json(&template, &pack), "files": files}),
    ))
}

fn folder_is_empty(dir: &Path) -> Result<bool, CliError> {
    match std::fs::read_dir(dir) {
        Ok(mut entries) => Ok(entries.next().is_none()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error.into()),
    }
}

fn font_pack_dir(data_root: Option<&Path>, pack: &str) -> Option<PathBuf> {
    if !is_valid_id(pack) {
        return None;
    }
    let assets = data_root?.join("assets");
    [
        assets.join("fonts").join(pack),
        assets
            .join(oleafly_core::typst_toolchain::TYPST_FONT_PACKS_DIR)
            .join(pack),
    ]
    .into_iter()
    .find(|dir| std::fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_some()))
}

fn copy_font_pack(source: &Path, fonts: &Path) -> Result<(), CliError> {
    std::fs::create_dir_all(fonts).map_err(CliError::from)?;
    for entry in std::fs::read_dir(source).map_err(CliError::from)?.flatten() {
        if entry.file_type().is_ok_and(|kind| kind.is_file()) {
            std::fs::copy(entry.path(), fonts.join(entry.file_name())).map_err(CliError::from)?;
        }
    }
    Ok(())
}

fn inside_git_repository(dir: &Path) -> bool {
    let mut command = std::process::Command::new("git");
    crate::process::clear_inherited_git_env(&mut command);
    command
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--is-inside-work-tree"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .is_ok_and(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true"
        })
}

fn git_stdout(dir: &Path, args: &[&str]) -> Option<String> {
    let mut command = std::process::Command::new("git");
    crate::process::clear_inherited_git_env(&mut command);
    let output = command
        .arg("-C")
        .arg(dir)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn default_branch(dir: &Path) -> String {
    git_stdout(dir, &["config", "--get", "init.defaultBranch"])
        .filter(|branch| !branch.is_empty())
        .filter(|branch| git_stdout(dir, &["check-ref-format", "--branch", branch]).is_some())
        .unwrap_or_else(|| "main".to_string())
}

fn write_new_repository_excludes(dir: &Path) -> std::io::Result<()> {
    let exclude = dir.join(".git").join("info").join("exclude");
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let current = std::fs::read_to_string(&exclude).unwrap_or_default();
    let present: std::collections::HashSet<&str> = current.lines().map(str::trim).collect();
    let mut missing = String::new();
    if !current.is_empty() && !current.ends_with('\n') {
        missing.push('\n');
    }
    let mut added = false;
    for line in oleafly_core::exclude::new_repository_exclude_lines() {
        if !present.contains(line) {
            missing.push_str(line);
            missing.push('\n');
            added = true;
        }
    }
    if !added {
        return Ok(());
    }
    use std::io::Write;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude)?
        .write_all(missing.as_bytes())
}

fn initialize_git(ctx: &Context, dir: &Path, no_git: bool) -> bool {
    let auto_init = ctx
        .data_root()
        .and_then(crate::app_config::read_app_config)
        .and_then(|config| config.get("git_auto_init").and_then(Value::as_bool))
        .unwrap_or(true);
    if no_git || !auto_init || inside_git_repository(dir) {
        return false;
    }
    let branch = default_branch(dir);
    let mut command = std::process::Command::new("git");
    crate::process::clear_inherited_git_env(&mut command);
    let result = command
        .arg("-C")
        .arg(dir)
        .args(["init", "-q", "--initial-branch", &branch])
        .stdin(std::process::Stdio::null())
        .output();
    match result {
        Ok(output) if output.status.success() => {
            if let Err(error) = write_new_repository_excludes(dir) {
                ctx.warn(
                    "new.git_exclude_failed",
                    format!("Oleafly couldn't keep its build files out of Git: {error}"),
                );
            }
            true
        }
        Ok(output) => {
            ctx.warn(
                "new.git_failed",
                format!(
                    "Oleafly couldn't create a Git repository: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            );
            false
        }
        Err(error) => {
            ctx.warn(
                "new.git_failed",
                format!("Oleafly couldn't run git: {error}"),
            );
            false
        }
    }
}

fn write_project_json(dir: &Path, manifest: &ProjectManifest) -> Result<(), CliError> {
    use std::io::Write as _;
    let path = dir.join("project.json");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                CliError::new(
                    ErrorKind::InvalidInput,
                    "new.not_empty",
                    "The template already has a project.json.",
                )
            } else {
                CliError::from(error)
            }
        })?;
    let mut bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| CliError::internal(error.to_string()))?;
    bytes.push(b'\n');
    file.write_all(&bytes).map_err(CliError::from)
}

async fn download_template(
    ctx: &Context,
    pack: &CatalogPack,
    template: PackTemplate,
) -> Result<(), CliError> {
    let Some(data) = templates_data(ctx) else {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "environment.no_data_folder",
            "Oleafly couldn't find its data folder.",
        ));
    };
    ctx.note(format!(
        "Downloading {} from the {} pack…",
        template.info.id, pack.label
    ));
    let events = ctx.events();
    let report = move |progress: DownloadProgress| {
        if events {
            let line = json!({
                "schema_version": crate::contract::SCHEMA_VERSION,
                "type": "event",
                "command": "new",
                "event": "progress",
                "file": progress.file,
                "done": progress.done,
                "total": progress.total,
            });
            crate::human::out_line(&line.to_string());
        }
    };
    oleafly_downloads::template_packs::install_templates_in(&data, pack, vec![template], &report)
        .await
        .map_err(|message| download_error(&message))
}

fn download_error(message: &str) -> CliError {
    use oleafly_downloads::template_packs::{download_failure, DownloadFailure};
    let text = format!("Oleafly couldn't download the template: {message}");
    match download_failure(message) {
        DownloadFailure::Network => {
            CliError::new(ErrorKind::Network, "templates.download_failed", text)
                .hint("Check your internet connection, then try again.")
                .retryable()
        }
        DownloadFailure::Integrity => {
            CliError::new(ErrorKind::InvalidInput, "templates.download_invalid", text)
                .hint("The server sent something other than the template's files. Try again later.")
        }
        DownloadFailure::Storage => {
            CliError::new(ErrorKind::System, "templates.write_failed", text)
                .hint("Check that Oleafly's data folder has free space and can be written to.")
        }
    }
}

async fn run_new(ctx: &Context, args: NewArgs) -> Result<Outcome, CliError> {
    let dir = args
        .dir
        .clone()
        .unwrap_or_else(|| ctx.project().to_path_buf());
    if dir.exists() && !dir.is_dir() {
        return Err(CliError::usage(format!(
            "{} is a file, not a folder.",
            dir.display()
        )));
    }
    if !folder_is_empty(&dir)? {
        return Err(CliError::new(
            ErrorKind::Usage,
            "new.not_empty",
            format!("{} isn't empty.", dir.display()),
        )
        .hint("Pick a new folder, or run `oleafly init` to make this folder a project."));
    }
    let Some(template_id) = args.template.clone() else {
        let engine = args.engine.map(Engine::from).or_else(|| {
            ctx.data_root()
                .and_then(crate::app_config::latex_default_engine)
                .map(|_| Engine::Latexmk)
        });
        let workspace = Workspace::init(
            &dir,
            InitOptions {
                name: args.name.clone(),
                main_document: None,
                engine,
            },
        )?;
        let git = initialize_git(ctx, workspace.root(), args.no_git);
        let info = workspace.info()?;
        if !ctx.json() {
            ctx.say(format!(
                "Created {} at {}",
                info.name,
                workspace.root().display()
            ));
        }
        return Ok(Outcome::success(
            json!({"project": info, "template": Value::Null, "git": git}),
        ));
    };
    if !is_valid_id(&template_id) {
        return Err(unknown_template(&template_id));
    }
    if args.engine.is_some() {
        ctx.warn(
            "new.flag_ignored",
            "--engine is ignored with --template: the template picks the engine.",
        );
    }
    let found = match find_installed(ctx, &template_id) {
        Some(found) => found,
        None => {
            let (pack, template) =
                find_available(ctx, &template_id).ok_or_else(|| unknown_template(&template_id))?;
            download_template(ctx, &pack, template).await?;
            find_installed(ctx, &template_id).ok_or_else(|| {
                CliError::new(
                    ErrorKind::Build,
                    "templates.download_failed",
                    "The downloaded template isn't usable.",
                )
            })?
        }
    };
    let (template, template_dir, _) = found;
    let missing: Vec<String> = missing_font_packs(&template, |pack| {
        font_pack_dir(ctx.data_root(), pack).is_some()
    });
    if let Some(pack) = missing.first() {
        return Err(CliError::new(
            ErrorKind::MissingTool,
            "new.font_pack_missing",
            format!("The {} template needs the {pack} font pack.", template.id),
        )
        .hint(format!(
            "Install the {pack} font pack in Oleafly under Settings › Downloads."
        )));
    }
    let latex_default = ctx
        .data_root()
        .and_then(crate::app_config::latex_default_engine);
    let (engine, tex_flavor) = declared_template_engine(
        &template.engine,
        &template.main_doc,
        template.tex_flavor.as_deref(),
        latex_default.as_deref(),
    )
    .map_err(|message| CliError::new(ErrorKind::InvalidInput, "templates.invalid", message))?;
    let existed = dir.exists();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(CliError::from)?;
    let created = (|| -> Result<Value, CliError> {
        let manifest = instantiate_from(&template_dir, &dir)
            .map_err(|message| CliError::new(ErrorKind::Io, "templates.copy_failed", message))?;
        for pack in &manifest.requires.fonts {
            if let Some(source) = font_pack_dir(ctx.data_root(), pack) {
                copy_font_pack(&source, &dir.join("fonts"))?;
            }
        }
        let typst = (Engine::named(&engine) == Some(Engine::Typst)).then(|| TypstSpec {
            version: Some(
                ctx.data_root()
                    .and_then(crate::app_config::typst_default_choice)
                    .unwrap_or_else(oleafly_downloads::typst::bundled_version),
            ),
            ..TypstSpec::default()
        });
        let name = args.name.clone().unwrap_or_else(|| {
            dir.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| manifest.name.clone())
        });
        let project = ProjectManifest {
            name,
            main_doc: manifest.main_doc.clone(),
            engine: engine.clone(),
            tex_flavor: tex_flavor.clone(),
            typst,
            color: manifest.default_color.clone().unwrap_or_default(),
            kind: manifest.kind.clone().unwrap_or_default(),
            compile_dir: oleafly_core::compile_dir_for(&dir, &manifest.main_doc),
            ..ProjectManifest::default()
        };
        let workspace = Workspace::from_manifest(&dir, project.clone())?;
        write_project_json(&dir, &project)?;
        Ok(json!({"project": workspace.info()?, "template": manifest.id}))
    })();
    let mut fields = match created {
        Ok(fields) => fields,
        Err(error) => {
            if !existed {
                let _ = tokio::fs::remove_dir_all(&dir).await;
                return Err(error);
            }
            if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    let _ = if entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
                        tokio::fs::remove_dir_all(&path).await
                    } else {
                        tokio::fs::remove_file(&path).await
                    };
                }
            }
            return Err(error);
        }
    };
    let git = initialize_git(ctx, &dir, args.no_git);
    fields["git"] = json!(git);
    if !ctx.json() {
        if ctx.quiet() {
            ctx.say(dir.display().to_string());
        } else {
            ctx.say(format!(
                "Created {} from the {} template",
                dir.display(),
                template.id
            ));
            ctx.note(format!(
                "Build it with `oleafly -C {} build`.",
                shell_word(&dir)
            ));
        }
    }
    Ok(Outcome::success(fields))
}

fn shell_word(path: &Path) -> String {
    let text = path.display().to_string();
    if text
        .chars()
        .any(|character| character.is_whitespace() || matches!(character, '"' | '\'' | '$' | '`'))
    {
        format!("\"{}\"", text.replace('"', "\\\""))
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_disk_or_a_bad_checksum_is_not_a_network_problem() {
        let network = download_error("download failed: reset");
        assert_eq!(
            (network.kind, network.retryable),
            (ErrorKind::Network, true)
        );
        let checksum = download_error("download of https://x/a did not match its checksum");
        assert_eq!(
            (checksum.kind, checksum.retryable),
            (ErrorKind::InvalidInput, false)
        );
        let disk = download_error("No space left on device (os error 28)");
        assert_eq!(
            (disk.kind, disk.code.as_ref()),
            (ErrorKind::System, "templates.write_failed")
        );
    }
    use crate::contract::ContextOptions;

    fn context(project: &Path, data: &Path) -> Context {
        Context::for_test(ContextOptions {
            project: project.to_path_buf(),
            data_root: Some(data.to_path_buf()),
            ..Default::default()
        })
    }

    fn custom_template(data: &Path, id: &str, manifest: Value, files: &[(&str, &str)]) {
        let dir = data.join("templates/custom").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("template.json"), manifest.to_string()).unwrap();
        for (name, text) in files {
            let path = dir.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
    }

    #[tokio::test]
    async fn new_keeps_build_output_out_of_the_repository_it_creates() {
        let data = tempfile::tempdir().unwrap();
        let place = tempfile::tempdir().unwrap();
        custom_template(
            data.path(),
            "plain",
            json!({"id": "plain", "name": "Plain", "files_dir": "files"}),
            &[(
                "files/main.tex",
                "\\documentclass{article}\\begin{document}x\\end{document}",
            )],
        );
        let dir = place.path().join("paper");
        let ctx = context(place.path(), data.path());
        let args = NewArgs {
            dir: Some(dir.clone()),
            template: Some("plain".into()),
            name: None,
            engine: None,
            no_git: false,
        };
        assert!(run_new(&ctx, args).await.unwrap().ok);
        let exclude = std::fs::read_to_string(dir.join(".git/info/exclude")).unwrap();
        for line in [
            ".oleafly/",
            ".DS_Store",
            "_minted-*/",
            "*.aux",
            "*.synctex.gz",
        ] {
            assert_eq!(
                exclude.lines().filter(|entry| entry.trim() == line).count(),
                1,
                "{line} in:\n{exclude}"
            );
        }
        assert_eq!(
            git_stdout(&dir, &["symbolic-ref", "--short", "HEAD"]),
            Some(default_branch(&dir))
        );

        write_new_repository_excludes(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join(".git/info/exclude")).unwrap(),
            exclude
        );
    }

    #[tokio::test]
    async fn new_from_a_custom_template_creates_a_project() {
        let data = tempfile::tempdir().unwrap();
        let place = tempfile::tempdir().unwrap();
        custom_template(
            data.path(),
            "my-paper",
            json!({"id": "my-paper", "name": "My paper", "files_dir": "files", "tex_flavor": "pdflatex"}),
            &[(
                "files/main.tex",
                "\\documentclass{article}\\begin{document}x\\end{document}",
            )],
        );
        let dir = place.path().join("my thesis").join("論文");
        let ctx = context(place.path(), data.path());
        let args = NewArgs {
            dir: Some(dir.clone()),
            template: Some("my-paper".into()),
            name: None,
            engine: None,
            no_git: true,
        };
        let outcome = run_new(&ctx, args).await.unwrap();
        assert!(outcome.ok);
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(dir.join("project.json")).unwrap()).unwrap();
        assert_eq!(manifest["engine"], "latexmk");
        assert_eq!(manifest["tex_flavor"], "pdflatex");
        assert_eq!(manifest["name"], "論文");
        assert!(dir.join("main.tex").is_file());
        assert!(!dir.join("template.json").exists());
    }

    #[tokio::test]
    async fn new_refuses_a_folder_that_isnt_empty() {
        let data = tempfile::tempdir().unwrap();
        let place = tempfile::tempdir().unwrap();
        std::fs::write(place.path().join("notes.txt"), "x").unwrap();
        let ctx = context(place.path(), data.path());
        let args = NewArgs {
            dir: Some(place.path().to_path_buf()),
            template: None,
            name: None,
            engine: None,
            no_git: true,
        };
        assert_eq!(run_new(&ctx, args).await.unwrap_err().code, "new.not_empty");
    }

    #[tokio::test]
    async fn new_without_a_font_pack_names_the_pack() {
        let data = tempfile::tempdir().unwrap();
        let place = tempfile::tempdir().unwrap();
        custom_template(
            data.path(),
            "cv",
            json!({"id": "cv", "name": "CV", "requires": {"fonts": ["lato"]}}),
            &[("main.tex", "\\documentclass{article}")],
        );
        let ctx = context(place.path(), data.path());
        let args = NewArgs {
            dir: Some(place.path().join("cv")),
            template: Some("cv".into()),
            name: None,
            engine: None,
            no_git: true,
        };
        let error = run_new(&ctx, args).await.unwrap_err();
        assert_eq!(
            (error.code.as_ref(), error.exit()),
            ("new.font_pack_missing", crate::contract::Exit::Environment)
        );
        assert!(error.hint.unwrap().contains("lato"));
        assert!(!place.path().join("cv").join("project.json").exists());
    }

    #[tokio::test]
    async fn an_unknown_template_points_at_the_list() {
        let data = tempfile::tempdir().unwrap();
        let place = tempfile::tempdir().unwrap();
        let ctx = context(place.path(), data.path());
        let args = NewArgs {
            dir: Some(place.path().join("x")),
            template: Some("no-such-template".into()),
            name: None,
            engine: None,
            no_git: true,
        };
        assert_eq!(
            run_new(&ctx, args).await.unwrap_err().code,
            "templates.unknown"
        );
    }
}
