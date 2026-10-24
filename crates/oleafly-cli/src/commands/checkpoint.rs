//! `oleafly checkpoint list|show|diff|restore`: the app's checkpoints of a
//! project, read-only. `restore` copies a checkpoint into a new folder;
//! restoring over the project stays in the app, which can undo it.
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use clap::{Args, Subcommand};
use oleafly_history::{
    Checkpoint, CheckpointFile, ContentHash, SnapshotRoot, Store, DETACHED_MANIFEST_PATH,
};
use serde_json::{json, Value};

use super::CommandModule;
use crate::app_paths::ProjectIdentity;
use crate::contract::{path_arg, CliError, Context, ErrorKind, Outcome};

/// Short ids show this many hex characters; a prefix needs at least 8.
const SHORT_ID: usize = 12;
const MIN_PREFIX: usize = 8;
const MAX_TREE_FILES: usize = 20_000;
const MAX_PATCH_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// List and compare the app's checkpoints of this project
    #[command(subcommand)]
    Checkpoint(CheckpointCommand),
}

#[derive(Debug, Subcommand)]
pub enum CheckpointCommand {
    /// List checkpoints, newest first
    List,
    /// Show a checkpoint and its files
    Show(IdArgs),
    /// Compare a checkpoint with the project, or with another checkpoint
    Diff(DiffArgs),
    /// Copy a checkpoint into a new folder (or preview a restore with --dry-run)
    Restore(RestoreArgs),
}

#[derive(Debug, Args)]
pub struct IdArgs {
    #[arg(
        value_name = "ID",
        help = "A checkpoint id (at least 8 characters of it)"
    )]
    pub id: String,
}

#[derive(Debug, Args)]
pub struct DiffArgs {
    #[arg(value_name = "ID")]
    pub id: String,
    #[arg(
        value_name = "OTHER",
        help = "Compare with this checkpoint instead of the project"
    )]
    pub other: Option<String>,
    #[arg(long, help = "Show line-by-line changes of text files")]
    pub patch: bool,
}

#[derive(Debug, Args)]
pub struct RestoreArgs {
    #[arg(value_name = "ID")]
    pub id: String,
    #[arg(long, value_name = "DIR", value_parser = path_arg, conflicts_with = "dry_run", help = "Copy the checkpoint into this new folder")]
    pub to: Option<PathBuf>,
    #[arg(long, help = "Show what restoring over the project would change")]
    pub dry_run: bool,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Checkpoint(CheckpointCommand::List) => "checkpoint list",
            Self::Checkpoint(CheckpointCommand::Show(_)) => "checkpoint show",
            Self::Checkpoint(CheckpointCommand::Diff(_)) => "checkpoint diff",
            Self::Checkpoint(CheckpointCommand::Restore(_)) => "checkpoint restore",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        let Self::Checkpoint(command) = self;
        // The store is SQLite and file reads; run them off the async workers.
        tokio::task::block_in_place(|| run_blocking(ctx, command))
    }
}

fn run_blocking(ctx: &Context, command: CheckpointCommand) -> Result<Outcome, CliError> {
    let opened = crate::engine::open_project(ctx.project(), None, None)?;
    let root = opened.workspace.root().to_path_buf();
    let Some((store, identity)) = open_store(ctx, &root)? else {
        return match command {
            CheckpointCommand::List => {
                ctx.warn(
                    "checkpoint.not_in_app",
                    "The Oleafly app has no checkpoints of this folder.",
                );
                Ok(Outcome::success(json!({"checkpoints": []})))
            }
            _ => Err(CliError::new(
                ErrorKind::InvalidInput,
                "checkpoint.none",
                "The Oleafly app has no checkpoints of this folder.",
            )
            .hint(
                "Open the folder in Oleafly; it saves a checkpoint after each successful build.",
            )),
        };
    };
    let prepared = Prepared {
        store,
        root,
        linked: matches!(identity, ProjectIdentity::Linked { .. }),
    };
    match command {
        CheckpointCommand::List => run_list(ctx, &prepared),
        CheckpointCommand::Show(args) => run_show(ctx, &prepared, &args),
        CheckpointCommand::Diff(args) => run_diff(ctx, &prepared, &args),
        CheckpointCommand::Restore(args) => run_restore(ctx, &prepared, &args),
    }
}

struct Prepared {
    store: Store,
    root: PathBuf,
    linked: bool,
}

fn history_error(error: oleafly_history::HistoryError) -> CliError {
    CliError::new(
        ErrorKind::Io,
        "checkpoint.unreadable",
        format!("Oleafly couldn't read the checkpoints: {error}"),
    )
}

/// The app's checkpoint store of the project at `root`, read-only.
fn open_store(ctx: &Context, root: &Path) -> Result<Option<(Store, ProjectIdentity)>, CliError> {
    let Some(data_root) = ctx.data_root() else {
        return Ok(None);
    };
    let Some(identity) = crate::app_paths::project_identity(root, data_root) else {
        return Ok(None);
    };
    let Some(path) = crate::app_paths::existing_checkpoint_store(data_root, identity.id())? else {
        return Ok(None);
    };
    let store = Store::open_existing(&path).map_err(history_error)?;
    Ok(store.map(|store| (store, identity)))
}

fn short_id(root: &SnapshotRoot) -> String {
    root.as_hex().chars().take(SHORT_ID).collect()
}

/// The checkpoint a hex prefix names.
fn resolve(store: &Store, id: &str) -> Result<Checkpoint, CliError> {
    let wanted = id.trim().to_ascii_lowercase();
    if wanted.len() < MIN_PREFIX || !wanted.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CliError::usage(format!(
            "{id} isn't a checkpoint id. Use at least {MIN_PREFIX} characters of one."
        )));
    }
    let mut matches: Vec<Checkpoint> = store
        .list()
        .map_err(history_error)?
        .into_iter()
        .filter(|checkpoint| checkpoint.snapshot_root.as_hex().starts_with(&wanted))
        .collect();
    match matches.len() {
        0 => Err(CliError::new(
            ErrorKind::InvalidInput,
            "checkpoint.not_found",
            format!("No checkpoint starts with {wanted}."),
        )
        .hint("List them with `oleafly checkpoint list`.")),
        1 => Ok(matches.remove(0)),
        count => Err(CliError::usage(format!(
            "{count} checkpoints start with {wanted}. Use more of the id."
        ))),
    }
}

/// `2026-10-19 14:03 UTC` from Unix milliseconds.
fn utc_time(ms: i64) -> String {
    let seconds = ms.div_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let of_day = seconds.rem_euclid(86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02} UTC",
        of_day / 3600,
        (of_day % 3600) / 60
    )
}

fn checkpoint_json(checkpoint: &Checkpoint) -> Value {
    json!({
        "id": short_id(&checkpoint.snapshot_root),
        "snapshot_root": checkpoint.snapshot_root.as_hex(),
        "completed_at_ms": checkpoint.completed_at_unix_ms,
        "label": checkpoint.label,
        "engine": checkpoint.engine,
        "main_document": checkpoint.main_document,
        "files": checkpoint.file_count,
        "bytes": checkpoint.logical_bytes,
    })
}

fn run_list(ctx: &Context, prepared: &Prepared) -> Result<Outcome, CliError> {
    let mut checkpoints = prepared.store.list().map_err(history_error)?;
    checkpoints.sort_by_key(|checkpoint| std::cmp::Reverse(checkpoint.completed_at_unix_ms));
    if !ctx.json() {
        if checkpoints.is_empty() {
            ctx.note(
                "No checkpoints yet. Oleafly saves one after each successful build in the app.",
            );
        }
        for checkpoint in &checkpoints {
            if ctx.quiet() {
                ctx.say(short_id(&checkpoint.snapshot_root));
                continue;
            }
            let label = checkpoint
                .label
                .as_deref()
                .map(|label| format!("  {label}"))
                .unwrap_or_default();
            ctx.say(format!(
                "{}  {}  {} files{label}",
                short_id(&checkpoint.snapshot_root),
                utc_time(checkpoint.completed_at_unix_ms),
                checkpoint.file_count
            ));
        }
    }
    Ok(Outcome::success(
        json!({"checkpoints": checkpoints.iter().map(checkpoint_json).collect::<Vec<_>>()}),
    ))
}

fn checkpoint_files(
    store: &Store,
    checkpoint: &Checkpoint,
) -> Result<Vec<CheckpointFile>, CliError> {
    store
        .checkpoint_files(&checkpoint.snapshot_root)
        .map_err(history_error)?
        .ok_or_else(|| {
            CliError::new(
                ErrorKind::InvalidInput,
                "checkpoint.not_found",
                "That checkpoint is gone.",
            )
        })
}

fn run_show(ctx: &Context, prepared: &Prepared, args: &IdArgs) -> Result<Outcome, CliError> {
    let checkpoint = resolve(&prepared.store, &args.id)?;
    let files = checkpoint_files(&prepared.store, &checkpoint)?;
    if !ctx.json() {
        ctx.say(format!(
            "Checkpoint {}",
            short_id(&checkpoint.snapshot_root)
        ));
        ctx.say(format!(
            "  Saved: {}",
            utc_time(checkpoint.completed_at_unix_ms)
        ));
        if let Some(label) = &checkpoint.label {
            ctx.say(format!("  Label: {label}"));
        }
        ctx.say(format!(
            "  Built: {} with {}",
            checkpoint.main_document, checkpoint.engine
        ));
        for file in &files {
            ctx.say(format!(
                "  {:>10}  {}",
                file.logical_bytes, file.relative_path
            ));
        }
    }
    let files_json: Vec<Value> = files
        .iter()
        .map(|file| json!({"path": file.relative_path, "bytes": file.logical_bytes, "hash": file.content_hash.to_hex().chars().take(SHORT_ID).collect::<String>(), "stored": file.stored}))
        .collect();
    Ok(Outcome::success(
        json!({"checkpoint": checkpoint_json(&checkpoint), "files": files_json}),
    ))
}

fn portable(relative: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        parts.push(part.to_str()?.to_string());
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// The project's files as the app captures them, with their hashes. For a
/// linked folder that follows the app's capture rules: OS metadata,
/// Oleafly's names, links, reparse points and cloud placeholders (never
/// opened, so never downloaded) are left out, and so are files over 25 MiB
/// unless `captured` (the checkpoint compared with) holds them.
fn walk_tree(
    root: &Path,
    linked: bool,
    captured: &BTreeMap<String, ContentHash>,
) -> Result<BTreeMap<String, ContentHash>, CliError> {
    use oleafly_core::linked_capture;
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(folder) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if oleafly_core::exclude::is_capture_excluded_component(&name)
                || (linked && linked_capture::is_left_out_quietly(&name))
            {
                continue;
            }
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.file_type().is_symlink()
                || (linked && linked_capture::is_never_read(&metadata))
            {
                continue;
            }
            let path = entry.path();
            if metadata.is_dir() {
                if linked && linked_capture::is_skipped_directory(&name) {
                    continue;
                }
                pending.push(path);
            } else if metadata.is_file() {
                if files.len() >= MAX_TREE_FILES {
                    return Err(CliError::new(
                        ErrorKind::InvalidInput,
                        "checkpoint.too_many_files",
                        format!("The project has more than {MAX_TREE_FILES} files, so Oleafly won't compare it."),
                    ));
                }
                let Some(relative) = path.strip_prefix(root).ok().and_then(portable) else {
                    continue;
                };
                if linked
                    && linked_capture::is_large(metadata.len())
                    && !captured.contains_key(&relative)
                {
                    continue;
                }
                let hash = ContentHash::digest_file(&path).map_err(CliError::from)?;
                files.insert(relative, hash);
            }
        }
    }
    Ok(files)
}

#[derive(Default)]
struct Changes {
    modified: Vec<String>,
    added: Vec<String>,
    removed: Vec<String>,
    unchanged: usize,
}

/// What changed from `before` to `after`.
fn compare(
    before: &BTreeMap<String, ContentHash>,
    after: &BTreeMap<String, ContentHash>,
) -> Changes {
    let mut changes = Changes::default();
    for (path, hash) in before {
        match after.get(path) {
            Some(now) if now == hash => changes.unchanged += 1,
            Some(_) => changes.modified.push(path.clone()),
            None => changes.removed.push(path.clone()),
        }
    }
    changes.added = after
        .keys()
        .filter(|path| !before.contains_key(*path))
        .cloned()
        .collect();
    changes
}

fn file_map(files: &[CheckpointFile]) -> BTreeMap<String, ContentHash> {
    files
        .iter()
        .filter(|file| file.relative_path != DETACHED_MANIFEST_PATH)
        .map(|file| (file.relative_path.clone(), file.content_hash))
        .collect()
}

fn readable_text(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_PATCH_BYTES {
        return None;
    }
    String::from_utf8(std::fs::read(path).ok()?).ok()
}

/// The project's copy of `path` for a patch: only a file the walk hashed,
/// and only while it is a regular file. A path that became a link since is
/// shown as removed, and the link's target is never read.
fn project_file(
    root: &Path,
    path: &str,
    hashed: &BTreeMap<String, ContentHash>,
) -> Option<PathBuf> {
    let file = root.join(path);
    (hashed.contains_key(path)
        && std::fs::symlink_metadata(&file).is_ok_and(|metadata| metadata.is_file()))
    .then_some(file)
}

/// A unified diff of one file, or `None` for binary and large files.
fn file_patch(path: &str, old: Option<&Path>, new: Option<&Path>) -> Option<String> {
    let old_text = match old {
        Some(file) => readable_text(file)?,
        None => String::new(),
    };
    let new_text = match new {
        Some(file) => readable_text(file)?,
        None => String::new(),
    };
    let diff = similar::TextDiff::from_lines(&old_text, &new_text);
    Some(
        diff.unified_diff()
            .context_radius(3)
            .header(&format!("a/{path}"), &format!("b/{path}"))
            .to_string(),
    )
}

fn run_diff(ctx: &Context, prepared: &Prepared, args: &DiffArgs) -> Result<Outcome, CliError> {
    let first = resolve(&prepared.store, &args.id)?;
    let before = file_map(&checkpoint_files(&prepared.store, &first)?);
    let second = args
        .other
        .as_deref()
        .map(|other| resolve(&prepared.store, other))
        .transpose()?;
    let after = match &second {
        Some(checkpoint) => file_map(&checkpoint_files(&prepared.store, checkpoint)?),
        None => walk_tree(&prepared.root, prepared.linked, &before)?,
    };
    let changes = compare(&before, &after);
    let mut patches = Vec::new();
    if args.patch
        && (!changes.modified.is_empty()
            || !changes.added.is_empty()
            || !changes.removed.is_empty())
    {
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-checkpoint-")
            .tempdir()
            .map_err(CliError::from)?;
        let old_root = scratch.path().join("before");
        prepared
            .store
            .materialize(&first.snapshot_root, &old_root)
            .map_err(history_error)?;
        let new_root = match &second {
            Some(checkpoint) => {
                let root = scratch.path().join("after");
                prepared
                    .store
                    .materialize(&checkpoint.snapshot_root, &root)
                    .map_err(history_error)?;
                root
            }
            None => prepared.root.clone(),
        };
        let all = changes
            .modified
            .iter()
            .chain(&changes.added)
            .chain(&changes.removed);
        for path in all {
            let old = Some(old_root.join(path)).filter(|file| file.is_file());
            let new = match second {
                Some(_) => Some(new_root.join(path)).filter(|file| file.is_file()),
                None => project_file(&new_root, path, &after),
            };
            let patch = file_patch(path, old.as_deref(), new.as_deref());
            patches.push(json!({"path": path, "patch": patch, "binary": patch.is_none()}));
        }
    }
    if !ctx.json() {
        let against = second.as_ref().map_or_else(
            || "the project".to_string(),
            |checkpoint| short_id(&checkpoint.snapshot_root),
        );
        if !ctx.quiet() {
            ctx.say(format!(
                "{} → {against}: {} changed, {} added, {} removed",
                short_id(&first.snapshot_root),
                changes.modified.len(),
                changes.added.len(),
                changes.removed.len()
            ));
        }
        for path in &changes.modified {
            ctx.say(format!("  M {path}"));
        }
        for path in &changes.added {
            ctx.say(format!("  A {path}"));
        }
        for path in &changes.removed {
            ctx.say(format!("  D {path}"));
        }
        for patch in &patches {
            match patch["patch"].as_str() {
                Some(text) => ctx.say(text.trim_end()),
                None => ctx.say(format!(
                    "Binary or large file differs: {}",
                    patch["path"].as_str().unwrap_or("")
                )),
            }
        }
    }
    let mut fields = json!({
        "from": checkpoint_json(&first),
        "to": second.as_ref().map(checkpoint_json),
        "modified": changes.modified,
        "added": changes.added,
        "removed": changes.removed,
        "unchanged": changes.unchanged,
    });
    if args.patch {
        fields["patches"] = json!(patches);
    }
    Ok(Outcome::success(fields))
}

/// Files a restore writes keep the checkpoint store's owner-only modes. A copy
/// for people gets the modes this user's own new folders and files get (0o777
/// and 0o666 less their umask), so a strict umask stays strict.
#[cfg(unix)]
fn relax_permissions(folder: &Path) {
    use std::fs::Permissions;
    use std::os::unix::fs::PermissionsExt;
    let Some(folder_mode) = new_folder_mode(folder) else {
        return;
    };
    let file_mode = folder_mode & 0o666;
    let mut pending = vec![folder.to_path_buf()];
    while let Some(current) = pending.pop() {
        let _ = std::fs::set_permissions(&current, Permissions::from_mode(folder_mode));
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => pending.push(entry.path()),
                Ok(kind) if kind.is_file() => {
                    let _ =
                        std::fs::set_permissions(entry.path(), Permissions::from_mode(file_mode));
                }
                _ => {}
            }
        }
    }
}

/// The mode a new folder gets in `folder`, read from a probe: the umask can
/// only be read by changing it, which every other thread would see.
#[cfg(unix)]
fn new_folder_mode(folder: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    let probe = folder.join(format!(".oleafly-mode-probe-{}", std::process::id()));
    std::fs::create_dir(&probe).ok()?;
    let mode = std::fs::metadata(&probe).map(|metadata| metadata.permissions().mode() & 0o777);
    let _ = std::fs::remove_dir(&probe);
    mode.ok()
}

#[cfg(not(unix))]
fn relax_permissions(_folder: &Path) {}

fn run_restore(
    ctx: &Context,
    prepared: &Prepared,
    args: &RestoreArgs,
) -> Result<Outcome, CliError> {
    let checkpoint = resolve(&prepared.store, &args.id)?;
    if args.dry_run {
        let after = file_map(&checkpoint_files(&prepared.store, &checkpoint)?);
        let before = walk_tree(&prepared.root, prepared.linked, &after)?;
        let changes = compare(&before, &after);
        if !ctx.json() {
            ctx.say(format!(
                "Restoring {} would change {} files and bring back {}. {} files are newer than the checkpoint.",
                short_id(&checkpoint.snapshot_root),
                changes.modified.len(),
                changes.added.len(),
                changes.removed.len()
            ));
            ctx.note("Restore in the Oleafly app (Checkpoints), which keeps a checkpoint of the current state first.");
        }
        return Ok(Outcome::success(json!({
            "checkpoint": checkpoint_json(&checkpoint),
            "would_change": changes.modified,
            "would_restore": changes.added,
            "newer_files": changes.removed,
        })));
    }
    let Some(destination) = args.to.as_deref() else {
        return Err(CliError::usage("oleafly restores a checkpoint into a new folder only.")
            .hint("Pass --to <new folder>, or restore over the project in the Oleafly app's Checkpoints panel."));
    };
    if destination.exists() {
        return Err(CliError::usage(format!(
            "{} already exists. Pick a new folder.",
            destination.display()
        )));
    }
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(CliError::usage(format!(
            "The folder {} doesn't exist.",
            parent.display()
        )));
    }
    let materialized = prepared
        .store
        .materialize(&checkpoint.snapshot_root, destination)
        .map_err(history_error)?;
    relax_permissions(destination);
    for omitted in &materialized.omitted {
        ctx.warn(
            "checkpoint.file_not_stored",
            format!("{omitted} wasn't saved in the checkpoint, so it isn't in the copy."),
        );
    }
    if !ctx.json() {
        if ctx.quiet() {
            ctx.say(destination.display().to_string());
        } else {
            ctx.say(format!(
                "Copied checkpoint {} ({} files) to {}",
                short_id(&checkpoint.snapshot_root),
                materialized.file_count,
                destination.display()
            ));
        }
    }
    let outcome = Outcome::success(json!({
        "checkpoint": checkpoint_json(&checkpoint),
        "destination": destination,
        "files": materialized.file_count,
        "bytes": materialized.logical_bytes,
        "omitted": materialized.omitted,
    }));
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_print_in_utc() {
        assert_eq!(utc_time(0), "1970-01-01 00:00 UTC");
        assert_eq!(utc_time(1_760_882_580_000), "2025-10-19 14:03 UTC");
        assert_eq!(utc_time(951_782_400_000), "2000-02-29 00:00 UTC");
    }

    #[test]
    fn comparisons_split_changed_added_and_removed() {
        let hash = |text: &str| ContentHash::digest(text.as_bytes());
        let before = BTreeMap::from([
            ("main.tex".to_string(), hash("a")),
            ("old.tex".to_string(), hash("o")),
            ("same.tex".to_string(), hash("s")),
        ]);
        let after = BTreeMap::from([
            ("main.tex".to_string(), hash("b")),
            ("new.tex".to_string(), hash("n")),
            ("same.tex".to_string(), hash("s")),
        ]);
        let changes = compare(&before, &after);
        assert_eq!(changes.modified, ["main.tex"]);
        assert_eq!(changes.added, ["new.tex"]);
        assert_eq!(changes.removed, ["old.tex"]);
        assert_eq!(changes.unchanged, 1);
    }

    #[test]
    fn patches_cover_text_and_skip_binary_files() {
        let folder = tempfile::tempdir().unwrap();
        let old = folder.path().join("old.tex");
        let new = folder.path().join("new.tex");
        std::fs::write(&old, "one\ntwo\n").unwrap();
        std::fs::write(&new, "one\nthree\n").unwrap();
        let patch = file_patch("main.tex", Some(&old), Some(&new)).unwrap();
        assert!(
            patch.contains("--- a/main.tex") && patch.contains("-two") && patch.contains("+three"),
            "{patch}"
        );
        let binary = folder.path().join("figure.png");
        std::fs::write(&binary, [0xff_u8, 0xfe, 0x00, 0x81]).unwrap();
        assert!(file_patch("figure.png", Some(&binary), Some(&binary)).is_none());
        let added = file_patch("new.tex", None, Some(&new)).unwrap();
        assert!(added.contains("+three"));
    }

    #[test]
    fn the_tree_walk_skips_what_checkpoints_skip() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".oleafly/build")).unwrap();
        std::fs::create_dir_all(root.path().join("build")).unwrap();
        std::fs::write(root.path().join(".oleafly/build/out.pdf"), "pdf").unwrap();
        std::fs::write(root.path().join("build/out.log"), "log").unwrap();
        std::fs::write(root.path().join("main.tex"), "x").unwrap();
        let library = walk_tree(root.path(), false, &BTreeMap::new()).unwrap();
        assert!(
            library.contains_key("main.tex")
                && library.contains_key("build/out.log")
                && !library.contains_key(".oleafly/build/out.pdf")
        );
        let linked = walk_tree(root.path(), true, &BTreeMap::new()).unwrap();
        assert_eq!(linked.keys().collect::<Vec<_>>(), ["main.tex"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_patch_never_reads_through_a_link_in_the_project() {
        let root = tempfile::tempdir().unwrap();
        let secret = tempfile::tempdir().unwrap();
        std::fs::write(secret.path().join("id_ed25519"), "PRIVATE KEY").unwrap();
        std::os::unix::fs::symlink(
            secret.path().join("id_ed25519"),
            root.path().join("notes.md"),
        )
        .unwrap();
        std::fs::write(root.path().join("main.tex"), "x").unwrap();
        let hashed = walk_tree(root.path(), false, &BTreeMap::new()).unwrap();
        assert!(!hashed.contains_key("notes.md"));
        assert_eq!(project_file(root.path(), "notes.md", &hashed), None);
        assert!(project_file(root.path(), "main.tex", &hashed).is_some());
    }

    #[test]
    fn a_linked_walk_leaves_out_os_metadata_and_large_files_as_captures_do() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("main.tex"), "x").unwrap();
        std::fs::write(root.path().join(".DS_Store"), "junk").unwrap();
        std::fs::write(root.path().join("._main.tex"), "junk").unwrap();
        let large = std::fs::File::create(root.path().join("data.csv")).unwrap();
        large
            .set_len(oleafly_core::linked_capture::LARGE_FILE_BYTES + 1)
            .unwrap();
        let linked = walk_tree(root.path(), true, &BTreeMap::new()).unwrap();
        assert_eq!(linked.keys().collect::<Vec<_>>(), ["main.tex"]);
        // A large file the checkpoint holds (named by the build) is compared.
        let captured = BTreeMap::from([("data.csv".to_string(), linked["main.tex"])]);
        let linked = walk_tree(root.path(), true, &captured).unwrap();
        assert!(linked.contains_key("data.csv"));
    }

    #[cfg(unix)]
    #[test]
    fn a_restored_copy_gets_the_modes_new_files_get() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        let copy = tempfile::tempdir().unwrap();
        let folder = copy.path().join("sources");
        let file = folder.join("main.tex");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(&file, "x").unwrap();
        // What the checkpoint store leaves behind.
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        // What this user's umask gives a new folder and a new file.
        let reference = tempfile::tempdir().unwrap();
        let new_folder = reference.path().join("folder");
        std::fs::create_dir(&new_folder).unwrap();
        let new_file = reference.path().join("file");
        std::fs::write(&new_file, "").unwrap();

        relax_permissions(copy.path());

        assert_eq!(mode(copy.path()), mode(&new_folder));
        assert_eq!(mode(&folder), mode(&new_folder));
        assert_eq!(mode(&file), mode(&new_file));
        let names: Vec<_> = std::fs::read_dir(copy.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["sources"], "the probe folder is gone");
    }
}
