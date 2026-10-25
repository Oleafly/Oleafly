//! `server comments`: read and write comment threads on a shared project.
//! Writing goes through a short live session of the command line's own
//! device and its own document copy (`<data>/collab-cli/<shared id>`), so
//! it never writes into the app's copy. A comment that isn't acknowledged
//! in time stays in that copy and goes out with the next command.
use std::collections::BTreeMap;
use std::io::Read as _;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use clap::{Args, Subcommand};
use oleafly_collab::comments::{mentions_in, CommentMember, CommentThread};
use oleafly_collab::devices::DeviceRegistry;
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::snapshots::fetch_verified;
use oleafly_collab::sync::{spawn_live, EndReason, LiveEvent, LiveLink, LiveStatus, SharedLive};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::projects::{
    project_role_allows, ProjectAction, ProjectMember, ProjectRole,
};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedReceiver;

use super::account::{CliCollab, ServerLink};
use super::target::SharedTarget;
use crate::auth::shared::{from_collab, now_ms, one_line, plain_text, Report};
use crate::contract::{path_arg, CliError, ErrorKind};

/// How long to wait to connect and catch up, and again for the server to
/// take a change.
const LIVE_WAIT: Duration = Duration::from_secs(30);
/// The longest comment text read from a file or standard input.
const MAX_BODY: u64 = 64 * 1024;

#[derive(Debug, Subcommand)]
pub enum CommentsAction {
    /// List comment threads
    List(ListArgs),
    /// Start a thread on a line or on quoted text
    Add {
        #[arg(long, value_name = "PATH", help = "File in the shared project")]
        file: String,
        #[arg(
            long,
            value_name = "N or N-M",
            help = "Line or line range to comment on"
        )]
        line: Option<String>,
        #[arg(long, value_name = "TEXT", help = "Exact text to comment on")]
        quote: Option<String>,
        #[command(flatten)]
        body: BodyArgs,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
    /// Reply to a thread
    Reply {
        #[arg(
            value_name = "THREAD",
            help = "Thread ID, or its last 8 characters (the first ones are a timestamp threads share)"
        )]
        thread: String,
        #[command(flatten)]
        body: BodyArgs,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
    /// Mark a thread resolved
    Resolve {
        #[arg(
            value_name = "THREAD",
            help = "Thread ID, or its last 8 characters (the first ones are a timestamp threads share)"
        )]
        thread: String,
        #[arg(long, help = "Show what would change without changing anything")]
        dry_run: bool,
    },
}

impl CommentsAction {
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::List(_) => "server comments list",
            Self::Add { .. } => "server comments add",
            Self::Reply { .. } => "server comments reply",
            Self::Resolve { .. } => "server comments resolve",
        }
    }
}

#[derive(Debug, Default, Args)]
pub struct ListArgs {
    #[arg(long, value_name = "PATH", help = "File in the shared project")]
    pub file: Option<String>,
    #[arg(long, help = "Include resolved threads")]
    pub all: bool,
    #[arg(long, help = "Read comments saved on this computer without connecting")]
    pub offline: bool,
}

#[derive(Debug, Default, Args)]
pub struct BodyArgs {
    #[arg(
        long,
        group = "body_source",
        value_name = "TEXT",
        help = "Comment text"
    )]
    pub body: Option<String>,
    #[arg(long, group = "body_source", value_name = "FILE or -", value_parser = path_arg, help = "Read the comment text from a file, or - for standard input")]
    pub body_file: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Delivery {
    Sent,
    Pending,
}

fn lock(live: &SharedLive) -> MutexGuard<'_, LiveProject> {
    live.lock().unwrap_or_else(PoisonError::into_inner)
}

// ---------------------------------------------------------------------------
// Text positions (UTF-16 code units, as the shared document counts them)

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Lines `first..=last` (1-based) as UTF-16 offsets; the end stops before
/// the line break (`\n` or `\r\n`).
pub(crate) fn line_range_utf16(text: &str, first: usize, last: usize) -> Option<(usize, usize)> {
    if first == 0 || last < first {
        return None;
    }
    let mut offset = 0;
    let mut start = None;
    for (index, line) in text.split('\n').enumerate() {
        let number = index + 1;
        let content = line.strip_suffix('\r').unwrap_or(line);
        if number == first {
            start = Some(offset);
        }
        if number == last {
            return start.map(|start| (start, offset + utf16_len(content)));
        }
        offset += utf16_len(line) + 1;
    }
    None
}

/// The first place `quote` appears (inside `within` when given).
pub(crate) fn quote_range_utf16(
    text: &str,
    quote: &str,
    within: Option<(usize, usize)>,
) -> Option<(usize, usize)> {
    if quote.is_empty() {
        return None;
    }
    let mut from_byte = 0;
    while let Some(found) = text[from_byte..].find(quote) {
        let byte = from_byte + found;
        let start = utf16_len(&text[..byte]);
        let end = start + utf16_len(quote);
        match within {
            Some((low, high)) if start < low || end > high => {}
            _ => return Some((start, end)),
        }
        from_byte = byte + quote.chars().next().map_or(1, char::len_utf8);
    }
    None
}

/// The 1-based line holding a UTF-16 offset.
pub(crate) fn line_of_utf16(text: &str, offset: usize) -> usize {
    let mut line = 1;
    for (seen, unit) in text.encode_utf16().enumerate() {
        if seen >= offset {
            break;
        }
        if unit == u16::from(b'\n') {
            line += 1;
        }
    }
    line
}

fn parse_lines(value: &str) -> Result<(usize, usize), CliError> {
    let invalid = || {
        CliError::new(
            ErrorKind::Usage,
            "server.invalid_line",
            format!("\"{value}\" isn't a line or a range like 12-15."),
        )
    };
    let number = |text: &str| {
        text.trim()
            .parse::<usize>()
            .ok()
            .filter(|number| *number > 0)
    };
    match value.split_once('-') {
        Some((first, last)) => {
            let (first, last) = (
                number(first).ok_or_else(invalid)?,
                number(last).ok_or_else(invalid)?,
            );
            if last < first {
                return Err(invalid());
            }
            Ok((first, last))
        }
        None => number(value).map(|line| (line, line)).ok_or_else(invalid),
    }
}

// ---------------------------------------------------------------------------
// The shared document

fn layout_of(doc: &ProjectDoc) -> materialize::Layout {
    doc.nodes()
        .map(|nodes| materialize::layout(&nodes))
        .unwrap_or_default()
}

fn file_missing(path: &str) -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "server.file_missing",
        format!("{path} isn't in the shared project."),
    )
}

/// The text file at `path`.
fn file_at(doc: &ProjectDoc, path: &str) -> Result<String, CliError> {
    let path = path.trim().trim_start_matches("./").replace('\\', "/");
    layout_of(doc)
        .into_iter()
        .find(|(_, placed)| placed.path == path && placed.kind == NodeKind::Text)
        .map(|(id, _)| id)
        .ok_or_else(|| file_missing(&path))
}

/// The thread whose ID is `thread`, or starts or ends with it (8
/// characters or more). IDs are UUIDv7: their first characters are a
/// timestamp that threads made the same minute share, their last ones
/// random, so the end is the part worth typing.
pub(crate) fn find_thread(
    doc: &ProjectDoc,
    thread: &str,
) -> Result<(String, CommentThread), CliError> {
    let wanted = thread.trim().to_ascii_lowercase();
    let mut found = Vec::new();
    if wanted.len() >= 8 {
        for file in doc.commented_files() {
            let Ok(threads) = doc.comment_threads(&file) else {
                continue;
            };
            for candidate in threads {
                let id = candidate.id.to_string().to_ascii_lowercase();
                if id.starts_with(&wanted) || id.ends_with(&wanted) {
                    found.push((file.clone(), candidate));
                }
            }
        }
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(CliError::new(
            ErrorKind::InvalidInput,
            "server.no_such_thread",
            format!("There's no comment thread {thread} in this project."),
        )),
        _ => Err(CliError::new(
            ErrorKind::Usage,
            "server.ambiguous_thread",
            format!("More than one thread starts with {thread}."),
        )
        .hint("Use more of the thread's ID.")),
    }
}

fn person_names(members: &[ProjectMember]) -> BTreeMap<AccountId, String> {
    members
        .iter()
        .map(|member| (member.person.account_id, member.person.display_name.clone()))
        .collect()
}

fn thread_json(
    thread: &CommentThread,
    path: &str,
    text: &str,
    names: &BTreeMap<AccountId, String>,
) -> Value {
    let messages: Vec<Value> = thread
        .messages
        .iter()
        .map(|message| {
            let mut row = json!({
                "id": message.id.to_string(),
                "author": message.author.to_string(),
                "at": message.at,
                "body": message.body,
                "edited": message.edited_at.is_some(),
                "deleted": message.deleted,
            });
            if let Some(name) = names.get(&message.author) {
                row["authorName"] = json!(name);
            }
            row
        })
        .collect();
    let mut row = json!({
        "id": thread.id.to_string(),
        "file": path,
        "quote": thread.anchor.quote,
        "createdBy": thread.created_by.to_string(),
        "createdAt": thread.created_at,
        "messages": messages,
    });
    if let Some(range) = thread.anchor.range {
        row["line"] = json!(line_of_utf16(text, range.from));
    }
    if let Some(resolved) = &thread.resolved {
        row["resolved"] = json!({"by": resolved.by.to_string(), "at": resolved.at});
    }
    row
}

/// Every thread in `doc` (open ones unless `all`), optionally of one file.
fn threads_in(
    doc: &ProjectDoc,
    file: Option<&str>,
    all: bool,
    names: &BTreeMap<AccountId, String>,
) -> Result<(Vec<Value>, Vec<String>), CliError> {
    let layout = layout_of(doc);
    let only = match file {
        Some(path) => Some(file_at(doc, path)?),
        None => None,
    };
    let mut rows = Vec::new();
    let mut lines = Vec::new();
    for file_id in doc.commented_files() {
        if only.as_ref().is_some_and(|only| *only != file_id) {
            continue;
        }
        let Some(placed) = layout.get(&file_id) else {
            continue;
        };
        let text = doc.text(&file_id).unwrap_or_default();
        let threads = doc
            .comment_threads(&file_id)
            .map_err(|error| from_collab(&error, "this computer"))?;
        for thread in threads
            .iter()
            .filter(|thread| all || thread.resolved.is_none())
        {
            let row = thread_json(thread, &placed.path, &text, names);
            let path = one_line(&placed.path);
            let place = match row["line"].as_u64() {
                Some(line) => format!("{path}:{line}"),
                None => path,
            };
            let state = if thread.resolved.is_some() {
                " [resolved]"
            } else {
                ""
            };
            // The quote and the comments are other people's text: nothing in
            // them can steer the terminal or pass as a line of its own.
            lines.push(format!(
                "{place}  \"{}\"  ({}){state}",
                one_line(thread.anchor.quote.lines().next().unwrap_or_default()),
                thread.id
            ));
            for message in thread.messages.iter().filter(|message| !message.deleted) {
                let author = names
                    .get(&message.author)
                    .cloned()
                    .unwrap_or_else(|| message.author.to_string());
                lines.push(format!(
                    "  {}: {}",
                    one_line(&author),
                    plain_text(&message.body).replace('\n', "\n    ")
                ));
            }
            rows.push(row);
        }
    }
    Ok((rows, lines))
}

// ---------------------------------------------------------------------------
// A live session of this device

struct LiveSession {
    link: ServerLink,
    live: SharedLive,
    events: UnboundedReceiver<LiveEvent>,
    handle: oleafly_collab::sync::LiveHandle,
    dir: PathBuf,
    account: AccountId,
}

fn ended(reason: EndReason, server: &str) -> CliError {
    match reason {
        EndReason::SignedOut => CliError::new(
            ErrorKind::Auth,
            "server.signed_out",
            format!("This command line isn't signed in to {server}."),
        )
        .hint(format!("Run oleafly server sign-in {server}.")),
        EndReason::Removed | EndReason::AccessEnded | EndReason::AccountSuspended => CliError::new(
            ErrorKind::Auth,
            "server.forbidden",
            "You don't have access to that.".to_string(),
        ),
        EndReason::Archived => CliError::new(
            ErrorKind::InvalidInput,
            "server.archived",
            "This shared project was archived.".to_string(),
        ),
        EndReason::ClientTooOld => CliError::new(
            ErrorKind::MissingTool,
            "server.client_too_old",
            "This server needs a newer Oleafly.".to_string(),
        )
        .hint("Update Oleafly, then try again."),
        EndReason::ServerTooOld => CliError::new(
            ErrorKind::MissingTool,
            "server.server_too_old",
            "This server is too old for this version of Oleafly.".to_string(),
        ),
        EndReason::ServerChanged => CliError::new(
            ErrorKind::Auth,
            "server.changed",
            format!("The server at {server} isn't the one you signed in to before."),
        ),
        EndReason::Stopped | EndReason::Failed | EndReason::EngineSpent => CliError::new(
            ErrorKind::Internal,
            "server.session_failed",
            "The live session stopped unexpectedly.".to_string(),
        ),
    }
}

impl LiveSession {
    /// Opens this device's copy (fetching it the first time) and connects.
    async fn open(
        collab: &CliCollab,
        target: &SharedTarget,
        role: ProjectRole,
    ) -> Result<LiveSession, CliError> {
        let link = collab.link_to(target.entry.clone())?;
        let server_id = link.entry.server_id;
        let tokens = link
            .sessions
            .tokens(server_id)
            .map_err(|error| collab.local(&error))?
            .ok_or_else(|| ended(EndReason::SignedOut, &link.entry.url))?;
        let shared = target.shared;
        let dir = collab
            .paths
            .document_dir(&shared.to_string())
            .map_err(|error| collab.local(&error))?;
        let mut live = if LiveProject::exists(&dir) {
            LiveProject::load(&dir, role).map_err(|error| collab.local(&error))?
        } else {
            let verified = link
                .call(|client, access| async move {
                    fetch_verified(&client, &access, shared, &DeviceRegistry::default()).await
                })
                .await?;
            let doc =
                ProjectDoc::load_contained(&verified.bytes).map_err(|error| link.error(&error))?;
            let mut live = LiveProject::new(doc, verified.seq, role);
            if let Some(listed) = verified.listed {
                live.pin_devices(listed);
            }
            match link
                .call(|client, access| async move { client.project_peers(&access, shared).await })
                .await
            {
                Ok(peers) => live.pin_peers(peers),
                Err(_) => live.await_writers(),
            }
            live
        };
        live.set_role(role);
        let name = link
            .entry
            .account
            .as_ref()
            .map(|account| account.display_name.clone())
            .unwrap_or_default();
        live.doc_mut()
            .set_author(&tokens.account_id.to_string(), &name);
        let key = link
            .sessions
            .device_key(server_id)
            .map_err(|error| collab.local(&error))?;
        let live: SharedLive = Arc::new(Mutex::new(live));
        let (sender, events) = tokio::sync::mpsc::unbounded_channel();
        let handle = spawn_live(
            LiveLink {
                client: Arc::clone(&link.client),
                server_id,
                project: shared,
                device_id: tokens.device_id,
                key,
                sessions: Arc::clone(&link.sessions),
            },
            Arc::clone(&live),
            sender,
        );
        Ok(LiveSession {
            link,
            live,
            events,
            handle,
            dir,
            account: tokens.account_id,
        })
    }

    /// Waits until the session is online and has every change up to
    /// `head`. False when it isn't in time.
    async fn caught_up(&mut self, head: u64, wait: Duration) -> Result<bool, CliError> {
        let deadline = tokio::time::Instant::now() + wait;
        let mut online = false;
        loop {
            let at_head = lock(&self.live).last_seq() >= head;
            if online && at_head {
                return Ok(true);
            }
            match tokio::time::timeout_at(deadline, self.events.recv()).await {
                Err(_) | Ok(None) => return Ok(false),
                Ok(Some(LiveEvent::Status(LiveStatus::Online))) => online = true,
                Ok(Some(LiveEvent::Status(LiveStatus::Ended { reason }))) => {
                    return Err(ended(reason, &self.link.entry.url))
                }
                Ok(Some(_)) => {}
            }
        }
    }

    /// Sends what this copy holds and waits for the server to take it.
    async fn delivered(&mut self, wait: Duration) -> Result<Delivery, CliError> {
        self.handle.flush();
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let pending = lock(&self.live).pending_changes();
            if pending == 0 {
                return Ok(Delivery::Sent);
            }
            match tokio::time::timeout_at(deadline, self.events.recv()).await {
                Err(_) | Ok(None) => return Ok(Delivery::Pending),
                Ok(Some(LiveEvent::CommentsNotSent(_))) => {
                    return Err(CliError::new(
                        ErrorKind::InvalidInput,
                        "server.comments_off",
                        "Comments are turned off for this project.",
                    ))
                }
                Ok(Some(LiveEvent::Status(LiveStatus::Ended { .. }))) => {
                    return Ok(Delivery::Pending)
                }
                Ok(Some(_)) => {}
            }
        }
    }

    /// Saves this device's copy (so a change not yet taken survives) and
    /// ends the session.
    async fn close(self) -> Result<(), CliError> {
        let saved = lock(&self.live).save(&self.dir);
        self.handle.stopped().await;
        saved.map_err(|error| from_collab(&error, "this computer"))
    }
}

/// Runs `work` on the project as this device and sends the result. `work`
/// learns whether the copy caught up with the server's head (a copy that
/// didn't is this computer's saved one, however long the wait), and so
/// does the caller.
async fn with_cli_live_checked<T: Send>(
    collab: &CliCollab,
    target: &SharedTarget,
    role: ProjectRole,
    head: u64,
    wait: Duration,
    work: impl FnOnce(&mut LiveProject, AccountId, bool) -> Result<T, CliError> + Send,
) -> Result<(T, Delivery, bool), CliError> {
    let mut session = LiveSession::open(collab, target, role).await?;
    let outcome = async {
        let caught_up = session.caught_up(head, wait).await?;
        let account = session.account;
        let done = {
            let mut live = lock(&session.live);
            work(&mut live, account, caught_up)?
        };
        let delivery = session.delivered(wait).await?;
        Ok::<_, CliError>((done, delivery, caught_up))
    }
    .await;
    let closed = session.close().await;
    let outcome = outcome?;
    closed?;
    Ok(outcome)
}

// ---------------------------------------------------------------------------
// Commands

fn read_body(body: &BodyArgs) -> Result<String, CliError> {
    let text = match (&body.body, &body.body_file) {
        (Some(text), _) => text.clone(),
        (None, Some(file)) => {
            let mut bytes = Vec::new();
            let read = if file.as_os_str() == "-" {
                std::io::stdin().take(MAX_BODY + 1).read_to_end(&mut bytes)
            } else {
                std::fs::File::open(file)
                    .and_then(|opened| opened.take(MAX_BODY + 1).read_to_end(&mut bytes))
            };
            read.map_err(CliError::from)?;
            if bytes.len() as u64 > MAX_BODY {
                return Err(CliError::new(
                    ErrorKind::Usage,
                    "server.body_too_long",
                    "The comment is longer than 64 KB.",
                ));
            }
            String::from_utf8(bytes).map_err(|_| {
                CliError::new(
                    ErrorKind::Usage,
                    "server.body_not_text",
                    "The comment isn't plain text.",
                )
            })?
        }
        (None, None) => {
            return Err(CliError::new(
                ErrorKind::Usage,
                "server.body_missing",
                "Write the comment with --body or --body-file.",
            ))
        }
    };
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(CliError::new(
            ErrorKind::Usage,
            "server.body_missing",
            "The comment is empty.",
        ));
    }
    Ok(text)
}

/// Where a new thread goes: `--line`, `--quote` (within `--line`), or the
/// first line.
fn anchor_in(
    text: &str,
    path: &str,
    line: Option<&str>,
    quote: Option<&str>,
) -> Result<(usize, usize), CliError> {
    let lines = match line {
        Some(value) => {
            let (first, last) = parse_lines(value)?;
            Some(line_range_utf16(text, first, last).ok_or_else(|| {
                CliError::new(
                    ErrorKind::InvalidInput,
                    "server.line_missing",
                    format!("{path} has no line {value}."),
                )
            })?)
        }
        None => None,
    };
    let range = match quote {
        Some(quote) => quote_range_utf16(text, quote, lines).ok_or_else(|| {
            CliError::new(
                ErrorKind::InvalidInput,
                "server.quote_missing",
                format!("The quoted text isn't in {path}."),
            )
        })?,
        None => match lines {
            Some(range) => range,
            None => line_range_utf16(text, 1, 1).unwrap_or((0, 0)),
        },
    };
    if range.0 >= range.1 {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "server.empty_anchor",
            "That line is empty.",
        )
        .hint("Choose a line with text with --line, or quote some text with --quote."));
    }
    Ok(range)
}

fn comment_members(members: &[ProjectMember]) -> Vec<CommentMember> {
    members
        .iter()
        .map(|member| CommentMember {
            account_id: member.person.account_id,
            display_name: member.person.display_name.clone(),
            login: member.person.login.clone(),
        })
        .collect()
}

/// The freshest copy on this computer without connecting: this device's,
/// else the app's.
fn saved_copy(collab: &CliCollab, target: &SharedTarget) -> Result<Option<LiveProject>, CliError> {
    let mine = collab
        .paths
        .document_dir(&target.shared.to_string())
        .map_err(|error| collab.local(&error))?;
    if LiveProject::exists(&mine) {
        return LiveProject::load(&mine, ProjectRole::Viewer)
            .map(Some)
            .map_err(|error| collab.local(&error));
    }
    if let Some(local) = &target.local_project_id {
        let app = collab
            .app_paths
            .document_dir(local)
            .map_err(|error| collab.local(&error))?;
        if LiveProject::exists(&app) {
            return LiveProject::load(&app, ProjectRole::Viewer)
                .map(Some)
                .map_err(|error| collab.local(&error));
        }
    }
    Ok(None)
}

fn no_saved_copy() -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "server.no_saved_copy",
        "There's no saved copy of this project on this computer.",
    )
    .hint("Run the command without --offline.")
}

async fn list(
    collab: &CliCollab,
    target: &SharedTarget,
    args: ListArgs,
) -> Result<Report, CliError> {
    let signed_in = collab.cli_signed_in(target.entry.server_id)?;
    if args.offline || !signed_in {
        let live = saved_copy(collab, target)?.ok_or_else(no_saved_copy)?;
        let (rows, lines) =
            threads_in(live.doc(), args.file.as_deref(), args.all, &BTreeMap::new())?;
        let heading = format!("{} (saved copy)", thread_count(rows.len(), args.all));
        let mut report = Report::new(json!({"source": "saved", "threads": rows}))
            .line(heading)
            .lines(lines);
        if !signed_in && !args.offline {
            report = report.warning("server.saved_copy", "This command line isn't signed in to the server, so these are the comments saved on this computer.");
        }
        return Ok(report);
    }
    let link = collab.link_to(target.entry.clone())?;
    let shared = target.shared;
    let summary = link
        .call(|client, access| async move { client.project(&access, shared).await })
        .await?;
    let members = link
        .call(|client, access| async move { client.members(&access, shared).await })
        .await
        .unwrap_or_default();
    let names = person_names(&members);
    let file = args.file.clone();
    let all = args.all;
    let (listed, delivery, current) = with_cli_live_checked(
        collab,
        target,
        summary.role,
        summary.head_seq,
        LIVE_WAIT,
        move |live, _, _| threads_in(live.doc(), file.as_deref(), all, &names),
    )
    .await?;
    let (rows, lines) = listed;
    Ok(live_listing(rows, lines, args.all, delivery, current))
}

/// The threads of a live session. A session that never caught up with the
/// server shows this computer's saved copy, and says so.
fn live_listing(
    rows: Vec<Value>,
    lines: Vec<String>,
    all: bool,
    delivery: Delivery,
    current: bool,
) -> Report {
    let count = thread_count(rows.len(), all);
    let (source, heading) = if current {
        ("live", count)
    } else {
        ("saved", format!("{count} (saved copy)"))
    };
    let mut report = Report::new(json!({"source": source, "threads": rows}))
        .line(heading)
        .lines(lines);
    if !current {
        report = report.warning(
            "server.not_caught_up",
            "The server didn't answer in time, so these are the comments saved on this computer.",
        );
    }
    if delivery == Delivery::Pending {
        report = report.warning("server.not_sent", "A comment saved earlier on this computer wasn't sent yet. Run the command again when you're online.");
    }
    report
}

fn thread_count(count: usize, all: bool) -> String {
    let kind = if all {
        "comment thread"
    } else {
        "open comment thread"
    };
    if count == 1 {
        format!("1 {kind}")
    } else {
        format!("{count} {kind}s")
    }
}

fn may_comment(
    summary: &oleafly_collab_protocol::projects::ProjectSummary,
) -> Result<(), CliError> {
    if !summary.comments_enabled {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "server.comments_off",
            "Comments are turned off for this project.",
        ));
    }
    if !project_role_allows(summary.role, ProjectAction::Edit) {
        return Err(CliError::new(
            ErrorKind::Auth,
            "server.viewer",
            "Viewers can read comments but not write them.",
        ));
    }
    Ok(())
}

fn not_sent(report: Report, delivery: Delivery, caught_up: bool) -> Report {
    let report = if caught_up {
        report
    } else {
        report.warning(
            "server.not_caught_up",
            "The server didn't answer in time, so this went into the copy saved on this computer, which may be out of date.",
        )
    };
    match delivery {
        Delivery::Sent => report,
        Delivery::Pending => report.warning("server.not_sent", "The comment is saved on this computer but wasn't sent yet. Run the command again when you're online."),
    }
}

/// A line number counted on a copy that hasn't caught up may name another
/// line than the one meant.
fn stale_line(line: Option<&str>, quote: Option<&str>, caught_up: bool) -> Result<(), CliError> {
    if caught_up || line.is_none() || quote.is_some() {
        return Ok(());
    }
    Err(CliError::new(
        ErrorKind::Conflict,
        "server.not_caught_up",
        "The server didn't answer in time, so line numbers would be counted on the copy saved on this computer.",
    )
    .hint("Try again, or point at the text with --quote.")
    .retryable())
}

/// `add`, `reply` and `resolve` (and their dry runs).
async fn write(
    collab: &CliCollab,
    target: &SharedTarget,
    action: CommentsAction,
) -> Result<Report, CliError> {
    let link = collab.link_to(target.entry.clone())?;
    let shared = target.shared;
    let summary = link
        .call(|client, access| async move { client.project(&access, shared).await })
        .await?;
    may_comment(&summary)?;
    let members = link
        .call(|client, access| async move { client.members(&access, shared).await })
        .await?;
    let members = comment_members(&members);
    let dry_run = matches!(
        action,
        CommentsAction::Add { dry_run: true, .. }
            | CommentsAction::Reply { dry_run: true, .. }
            | CommentsAction::Resolve { dry_run: true, .. }
    );
    if dry_run {
        return dry_run_report(collab, target, &action);
    }
    match action {
        CommentsAction::Add {
            file,
            line,
            quote,
            body,
            ..
        } => {
            let body = read_body(&body)?;
            let mentions_from = members.clone();
            let ((thread, place), delivery, caught_up) = with_cli_live_checked(
                collab,
                target,
                summary.role,
                summary.head_seq,
                LIVE_WAIT,
                move |live, account, caught_up| {
                    stale_line(line.as_deref(), quote.as_deref(), caught_up)?;
                    let file_id = file_at(live.doc(), &file)?;
                    let text = live
                        .doc()
                        .text(&file_id)
                        .map_err(|error| from_collab(&error, "this computer"))?;
                    let (from, to) = anchor_in(&text, &file, line.as_deref(), quote.as_deref())?;
                    let mentions = mentions_in(&body, &mentions_from);
                    let thread = live
                        .comment_doc()
                        .create_comment_thread(
                            &file_id,
                            from,
                            to,
                            account,
                            now_ms(),
                            &body,
                            &mentions,
                        )
                        .map_err(|error| from_collab(&error, "this computer"))?;
                    Ok((thread, format!("{file}:{}", line_of_utf16(&text, from))))
                },
            )
            .await?;
            let report = Report::new(
                json!({"thread": thread.id.to_string(), "delivery": delivery, "dryRun": false}),
            )
            .line(format!("Comment added on {place}."));
            Ok(not_sent(report, delivery, caught_up))
        }
        CommentsAction::Reply { thread, body, .. } => {
            let body = read_body(&body)?;
            let (thread_id, delivery, caught_up) = with_cli_live_checked(
                collab,
                target,
                summary.role,
                summary.head_seq,
                LIVE_WAIT,
                move |live, account, _| {
                    let (file_id, found) = find_thread(live.doc(), &thread)?;
                    let mentions = mentions_in(&body, &members);
                    live.comment_doc()
                        .reply_to_comment(&file_id, found.id, account, now_ms(), &body, &mentions)
                        .map_err(|error| from_collab(&error, "this computer"))?;
                    Ok(found.id)
                },
            )
            .await?;
            let report = Report::new(
                json!({"thread": thread_id.to_string(), "delivery": delivery, "dryRun": false}),
            )
            .line("Reply added.");
            Ok(not_sent(report, delivery, caught_up))
        }
        CommentsAction::Resolve { thread, .. } => {
            let (thread_id, delivery, caught_up) = with_cli_live_checked(
                collab,
                target,
                summary.role,
                summary.head_seq,
                LIVE_WAIT,
                move |live, account, _| {
                    let (file_id, found) = find_thread(live.doc(), &thread)?;
                    live.comment_doc()
                        .resolve_comment_thread(&file_id, found.id, account, now_ms())
                        .map_err(|error| from_collab(&error, "this computer"))?;
                    Ok(found.id)
                },
            )
            .await?;
            let report = Report::new(
                json!({"thread": thread_id.to_string(), "delivery": delivery, "dryRun": false}),
            )
            .line("Thread resolved.");
            Ok(not_sent(report, delivery, caught_up))
        }
        CommentsAction::List(_) => unreachable!("list is not a write"),
    }
}

/// Checks the file, anchor or thread against the freshest saved copy;
/// nothing connects or changes.
fn dry_run_report(
    collab: &CliCollab,
    target: &SharedTarget,
    action: &CommentsAction,
) -> Result<Report, CliError> {
    let live = saved_copy(collab, target)?.ok_or_else(no_saved_copy)?;
    let doc = live.doc();
    match action {
        CommentsAction::Add {
            file,
            line,
            quote,
            body,
            ..
        } => {
            read_body(body)?;
            let file_id = file_at(doc, file)?;
            let text = doc.text(&file_id).map_err(|error| collab.local(&error))?;
            let (from, to) = anchor_in(&text, file, line.as_deref(), quote.as_deref())?;
            let quoted = String::from_utf16_lossy(
                &text
                    .encode_utf16()
                    .skip(from)
                    .take(to - from)
                    .collect::<Vec<u16>>(),
            );
            let place = format!("{file}:{}", line_of_utf16(&text, from));
            Ok(Report::new(json!({"thread": null, "file": file, "line": line_of_utf16(&text, from), "quote": quoted, "dryRun": true}))
                .line(format!("Dry run: would comment on {place} (\"{quoted}\"). Nothing was sent.")))
        }
        CommentsAction::Reply { thread, body, .. } => {
            read_body(body)?;
            let (_, found) = find_thread(doc, thread)?;
            Ok(
                Report::new(json!({"thread": found.id.to_string(), "dryRun": true})).line(format!(
                    "Dry run: would reply to thread {}. Nothing was sent.",
                    found.id
                )),
            )
        }
        CommentsAction::Resolve { thread, .. } => {
            let (_, found) = find_thread(doc, thread)?;
            Ok(
                Report::new(json!({"thread": found.id.to_string(), "dryRun": true})).line(format!(
                    "Dry run: would resolve thread {}. Nothing was sent.",
                    found.id
                )),
            )
        }
        CommentsAction::List(_) => unreachable!("list has no dry run"),
    }
}

pub(crate) async fn run(
    collab: &CliCollab,
    target: &SharedTarget,
    action: CommentsAction,
) -> Result<Report, CliError> {
    match action {
        CommentsAction::List(args) => list(collab, target, args).await,
        other => write(collab, target, other).await,
    }
}

#[cfg(test)]
mod tests {
    use oleafly_collab::{save_binding, ShareBinding};
    use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};

    use super::*;
    use crate::auth::test_env::env_at;

    #[test]
    fn line_and_quote_ranges_count_utf16_units() {
        let text = "a😀b\r\nsecond\nthird";
        assert_eq!(line_range_utf16(text, 1, 1), Some((0, 4)));
        assert_eq!(line_range_utf16(text, 2, 3), Some((6, 18)));
        assert_eq!(line_range_utf16(text, 4, 4), None);
        assert_eq!(quote_range_utf16(text, "cond", None), Some((8, 12)));
        assert_eq!(quote_range_utf16(text, "cond", Some((13, 18))), None);
        assert_eq!(line_of_utf16(text, 8), 2);
        assert_eq!(line_of_utf16(text, 0), 1);
    }

    #[test]
    fn lines_parse_as_one_number_or_a_range() {
        assert_eq!(parse_lines("12").unwrap(), (12, 12));
        assert_eq!(parse_lines("3-5").unwrap(), (3, 5));
        for bad in ["0", "5-3", "x", "-2", ""] {
            assert_eq!(
                parse_lines(bad).unwrap_err().code,
                "server.invalid_line",
                "{bad}"
            );
        }
    }

    #[test]
    fn anchors_refuse_missing_lines_quotes_and_empty_lines() {
        let text = "Hello world\n\nSecond line\n";
        assert_eq!(anchor_in(text, "main.tex", None, None).unwrap(), (0, 11));
        assert_eq!(
            anchor_in(text, "main.tex", Some("3"), Some("line")).unwrap(),
            (20, 24)
        );
        assert_eq!(
            anchor_in(text, "main.tex", Some("9"), None)
                .unwrap_err()
                .code,
            "server.line_missing"
        );
        assert_eq!(
            anchor_in(text, "main.tex", None, Some("absent"))
                .unwrap_err()
                .code,
            "server.quote_missing"
        );
        assert_eq!(
            anchor_in(text, "main.tex", Some("2"), None)
                .unwrap_err()
                .code,
            "server.empty_anchor"
        );
    }

    fn saved_project(collab: &CliCollab, local: &str) -> (SharedTarget, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let file = doc
            .add_node(
                None,
                "main.tex",
                NodeKind::Text,
                None,
                "Hello world\nSecond line\n",
            )
            .unwrap();
        let author = AccountId::new_v7();
        let open = doc
            .create_comment_thread(&file, 0, 5, author, 1, "Why?", &[])
            .unwrap();
        let closed = doc
            .create_comment_thread(&file, 12, 18, author, 2, "Done", &[])
            .unwrap();
        doc.resolve_comment_thread(&file, closed.id, author, 3)
            .unwrap();
        let mut live = LiveProject::new(doc, 0, ProjectRole::Owner);
        live.save(&collab.app_paths.document_dir(local).unwrap())
            .unwrap();
        let server = ServerId::new_v7();
        let shared = SharedProjectId::new_v7();
        save_binding(
            &collab.app_paths,
            local,
            &ShareBinding {
                server_url: "https://collab.uni.edu".into(),
                server_id: server,
                shared_project_id: shared,
                role: ProjectRole::Owner,
                created_at: 1,
            },
        )
        .unwrap();
        let target = SharedTarget {
            entry: oleafly_collab::ServerEntry {
                server_id: server,
                url: "https://collab.uni.edu".into(),
                name: "Lab".into(),
                icon_url: None,
                account: None,
                added_at: 1,
            },
            shared,
            local_project_id: Some(local.into()),
            saved_role: Some(ProjectRole::Owner),
        };
        (target, open.id.to_string())
    }

    #[tokio::test]
    async fn listing_offline_reads_the_app_saved_document() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let (target, open_id) = saved_project(&collab, "abc");
        let report = list(
            &collab,
            &target,
            ListArgs {
                offline: true,
                ..ListArgs::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(report.data["source"], "saved");
        let threads = report.data["threads"].as_array().unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(
            (
                threads[0]["id"].clone(),
                threads[0]["line"].clone(),
                threads[0]["quote"].clone()
            ),
            (json!(open_id), json!(1), json!("Hello"))
        );
        let all = list(
            &collab,
            &target,
            ListArgs {
                offline: true,
                all: true,
                ..ListArgs::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(all.data["threads"].as_array().unwrap().len(), 2);
        let signed_out = list(&collab, &target, ListArgs::default()).await.unwrap();
        assert_eq!(signed_out.warnings[0].code, "server.saved_copy");
    }

    #[test]
    fn a_session_that_never_caught_up_lists_the_saved_copy_as_saved() {
        let current = live_listing(Vec::new(), Vec::new(), false, Delivery::Sent, true);
        assert_eq!(current.data["source"], "live");
        assert!(current.warnings.is_empty());
        let stale = live_listing(Vec::new(), Vec::new(), false, Delivery::Sent, false);
        assert_eq!(stale.data["source"], "saved");
        assert_eq!(stale.lines[0], "0 open comment threads (saved copy)");
        assert_eq!(stale.warnings[0].code, "server.not_caught_up");
        let both = live_listing(Vec::new(), Vec::new(), false, Delivery::Pending, false);
        assert_eq!(both.warnings.len(), 2);
    }

    #[test]
    fn a_collaborators_comment_cannot_steer_the_terminal_or_forge_lines() {
        let mut doc = ProjectDoc::create().unwrap();
        let file = doc
            .add_node(
                None,
                "main.tex",
                NodeKind::Text,
                None,
                "Hi \u{1b}]0;pwned\u{7}there\n",
            )
            .unwrap();
        let author = AccountId::new_v7();
        doc.create_comment_thread(
            &file,
            0,
            18,
            author,
            1,
            "ok\n  Mallory: forged\u{1b}[2J\r",
            &[],
        )
        .unwrap();
        let (_, lines) = threads_in(&doc, None, true, &BTreeMap::new()).unwrap();
        assert_eq!(lines.len(), 2, "{lines:?}");
        for line in &lines {
            assert!(!line.contains(['\u{1b}', '\u{7}', '\r']), "{line:?}");
        }
        // A line break in the body stays under its author, so the next line
        // can't pass as another person's comment.
        assert!(
            lines[1].ends_with(": ok\n      Mallory: forged[2J"),
            "{lines:?}"
        );
    }

    #[test]
    fn a_line_on_a_copy_that_never_caught_up_is_refused_and_writes_warn() {
        assert_eq!(
            stale_line(Some("120"), None, false).unwrap_err().code,
            "server.not_caught_up"
        );
        assert!(stale_line(Some("120"), Some("cite?"), false).is_ok());
        assert!(stale_line(None, None, false).is_ok());
        assert!(stale_line(Some("120"), None, true).is_ok());
        let stale = not_sent(Report::new(json!({})), Delivery::Sent, false);
        assert_eq!(stale.warnings[0].code, "server.not_caught_up");
        assert!(not_sent(Report::new(json!({})), Delivery::Sent, true)
            .warnings
            .is_empty());
    }

    #[test]
    fn threads_are_found_by_a_unique_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_at(dir.path());
        let collab = CliCollab::open(&env);
        let (target, open_id) = saved_project(&collab, "abc");
        let live = saved_copy(&collab, &target).unwrap().unwrap();
        // Thread ids are time-ordered (UUIDv7): two made in the same minute
        // share their first characters, so the prefix reaches the random part.
        let (_, found) = find_thread(live.doc(), &open_id[..open_id.len() - 4]).unwrap();
        assert_eq!(found.id.to_string(), open_id);
        // The random end is enough on its own.
        let (_, found) = find_thread(live.doc(), &open_id[open_id.len() - 8..]).unwrap();
        assert_eq!(found.id.to_string(), open_id);
        assert_eq!(
            find_thread(live.doc(), "0000").unwrap_err().code,
            "server.no_such_thread"
        );
        let dry = dry_run_report(
            &collab,
            &target,
            &CommentsAction::Add {
                file: "main.tex".into(),
                line: Some("2".into()),
                quote: None,
                body: BodyArgs {
                    body: Some("Looks good".into()),
                    body_file: None,
                },
                dry_run: true,
            },
        )
        .unwrap();
        assert_eq!(
            (
                dry.data["line"].clone(),
                dry.data["quote"].clone(),
                dry.data["dryRun"].clone()
            ),
            (json!(2), json!("Second line"), json!(true))
        );
        let missing = dry_run_report(
            &collab,
            &target,
            &CommentsAction::Add {
                file: "main.tex".into(),
                line: None,
                quote: Some("absent".into()),
                body: BodyArgs {
                    body: Some("x".into()),
                    body_file: None,
                },
                dry_run: true,
            },
        )
        .unwrap_err();
        assert_eq!(missing.code, "server.quote_missing");
    }
}
