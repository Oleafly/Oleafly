use oleafly_acp::{AcpClient, Negotiated, NullHost};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::runtime::{
    build_agent_command, canonical_root, client_options, launch_root_for, redacted_auth_method,
    AcpRuntime,
};
use super::types::{
    new_id, now_ms, AgentSessionInfo, AgentSessionPage, AuthMethod, Capabilities, DeleteOutcome,
    SessionPage, SessionRecord, SessionSnapshot, SessionStatus, TurnCommit,
};

const TRANSIENT_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSIENT_IDLE: Duration = Duration::from_secs(30);
const MAX_IMPORT: usize = 50;
const MAX_COMMIT_PATHS: usize = 200;

pub(super) struct IdleTransient {
    key: (String, String, PathBuf),
    client: Arc<AcpClient>,
    negotiated: Negotiated,
    cwd: String,
}

impl AcpRuntime {
    pub fn session_page(
        &self,
        project_id: &str,
        query: Option<&str>,
        before: Option<u64>,
        before_id: Option<&str>,
        limit: Option<u32>,
    ) -> Result<SessionPage, String> {
        let limit = limit.map_or(50, |limit| limit.clamp(1, 200) as usize);
        let (sessions, has_more) = self
            .store
            .page(project_id, query, before, before_id, limit)?;
        Ok(SessionPage { sessions, has_more })
    }

    pub async fn rename_session(&self, id: &str, title: &str) -> Result<SessionRecord, String> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 120 || title.chars().any(char::is_control) {
            return Err("Use a title of 1 to 120 characters.".into());
        }
        if let Ok(session) = self.get_live(id).await {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.title = title.to_owned();
            state.record.title_locked = true;
            state.default_title = false;
            self.emit_locked(
                &session,
                &mut state,
                "session_info",
                json!({"title": title}),
            )?;
            return Ok(state.record.clone());
        }
        self.store.set_title(id, title, true)
    }

    pub async fn delete_session(
        self: &Arc<Self>,
        id: &str,
        from_agent: bool,
    ) -> Result<DeleteOutcome, String> {
        let record = self.store.get(id)?;
        if let Ok(session) = self.get_live(id).await {
            if self.copy_record(&session)?.status == SessionStatus::Running {
                return Err("Stop the agent's turn before deleting this conversation.".into());
            }
            self.close(id).await?;
        }
        let mut outcome = DeleteOutcome {
            agent_deleted: false,
            agent_error: None,
        };
        if from_agent && record.capabilities.delete && record.remote.is_none() {
            if let Some(native) = record.native_session_id.clone() {
                let root = canonical_root(Path::new(&record.project_path));
                let result = match root {
                    Ok(root) => {
                        self.with_transient(
                            &record.project_id,
                            &root,
                            &record.agent_id,
                            |client, _, _| {
                                let native = native.clone();
                                Box::pin(async move {
                                    client
                                        .delete_session(&native)
                                        .await
                                        .map_err(|error| error.to_string())
                                })
                            },
                        )
                        .await
                    }
                    Err(error) => Err(error),
                };
                match result {
                    Ok(()) => outcome.agent_deleted = true,
                    Err(error) => outcome.agent_error = Some(error),
                }
            }
        }
        self.store.delete_session(id)?;
        if record.remote.is_none() {
            let folder = super::attachments::attachment_dir(Path::new(&record.project_path), id);
            let _ = tokio::fs::remove_dir_all(folder).await;
        }
        Ok(outcome)
    }

    pub(super) async fn with_transient<T: Send + 'static>(
        self: &Arc<Self>,
        project_id: &str,
        root: &Path,
        agent_id: &str,
        work: impl for<'a> FnOnce(
                &'a AcpClient,
                &'a Negotiated,
                &'a str,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<T, String>> + Send + 'a>,
            > + Send,
    ) -> Result<T, String> {
        crate::trust::require_trusted(project_id, crate::trust::Capability::ExternalAgents)?;
        let _startup = self.begin_startup()?;
        let key = (
            project_id.to_owned(),
            agent_id.to_owned(),
            root.to_path_buf(),
        );
        let kept =
            self.idle_transient.lock().ok().and_then(|mut idle| {
                idle.take_if(|kept| kept.key == key && !kept.client.is_closed())
            });
        if let Some(kept) = kept {
            let result = tokio::time::timeout(
                TRANSIENT_TIMEOUT,
                work(&kept.client, &kept.negotiated, &kept.cwd),
            )
            .await
            .unwrap_or_else(|_| Err("The agent did not answer in time.".into()));
            self.keep_or_stop_transient(kept, result.is_ok()).await;
            return result;
        }
        let definition = self.definition(agent_id)?;
        let root = root.to_path_buf();
        let launch = {
            let acp_root = self.root.clone();
            let definition = definition.clone();
            let program = self.store.agent_program(agent_id)?;
            super::catalog::blocking(move || {
                super::catalog::plan(&acp_root, &definition, program.as_deref().map(Path::new))
                    .launch
            })
            .await??
        };
        let record = SessionRecord {
            id: new_id(),
            project_id: project_id.to_owned(),
            project_path: root.to_string_lossy().into_owned(),
            agent_id: agent_id.to_owned(),
            ..SessionRecord::default()
        };
        let cwd = launch_root_for(&root);
        let command =
            build_agent_command(&self.root, &record, &definition, &launch, &cwd, None, None)?;
        let client = AcpClient::spawn(command, Arc::new(NullHost)).await?;
        self.track_transient(&client, &launch.executable).await;
        let cwd_text = cwd.to_string_lossy().into_owned();
        let result = tokio::time::timeout(TRANSIENT_TIMEOUT, async {
            let negotiated = client
                .initialize(&client_options(false, false))
                .await
                .map_err(String::from)?;
            let result = work(&client, &negotiated, &cwd_text).await;
            Ok::<_, String>((negotiated, result))
        })
        .await
        .unwrap_or_else(|_| Err("The agent did not answer in time.".into()));
        match result {
            Ok((negotiated, result)) => {
                let kept = IdleTransient {
                    key,
                    client,
                    negotiated,
                    cwd: cwd_text,
                };
                self.keep_or_stop_transient(kept, result.is_ok()).await;
                result
            }
            Err(error) => {
                client.shutdown().await;
                self.untrack_transient(&client).await;
                Err(error)
            }
        }
    }

    async fn keep_or_stop_transient(self: &Arc<Self>, kept: IdleTransient, worked: bool) {
        if !worked || kept.client.is_closed() {
            kept.client.shutdown().await;
            self.untrack_transient(&kept.client).await;
            return;
        }
        let client = kept.client.clone();
        let replaced = self
            .idle_transient
            .lock()
            .ok()
            .and_then(|mut idle| idle.replace(kept));
        if let Some(replaced) = replaced {
            replaced.client.shutdown().await;
            self.untrack_transient(&replaced.client).await;
        }
        let runtime = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(TRANSIENT_IDLE).await;
            let Some(runtime) = runtime.upgrade() else {
                return;
            };
            let idle = runtime
                .idle_transient
                .lock()
                .ok()
                .and_then(|mut idle| idle.take_if(|kept| Arc::ptr_eq(&kept.client, &client)));
            if let Some(idle) = idle {
                idle.client.shutdown().await;
                runtime.untrack_transient(&idle.client).await;
            }
        });
    }

    pub async fn agent_sessions(
        self: &Arc<Self>,
        project_id: &str,
        agent_id: &str,
        cursor: Option<String>,
    ) -> Result<AgentSessionPage, String> {
        Ok(self
            .list_agent_sessions(project_id, agent_id, cursor)
            .await?
            .0)
    }

    async fn list_agent_sessions(
        self: &Arc<Self>,
        project_id: &str,
        agent_id: &str,
        cursor: Option<String>,
    ) -> Result<(AgentSessionPage, Capabilities, Vec<AuthMethod>), String> {
        let root = canonical_root(&crate::paths::project_dir(project_id)?)?;
        let roots = [root.clone(), launch_root_for(&root)];
        let (listed, next, capabilities, methods) = self
            .with_transient(
                project_id,
                &root,
                agent_id,
                move |client, negotiated, cwd| {
                    let cursor = cursor.clone();
                    let cwd = cwd.to_owned();
                    let can_list = negotiated.capabilities.list;
                    let capabilities = negotiated.capabilities.clone();
                    let methods = negotiated.auth_methods.clone();
                    Box::pin(async move {
                        if !can_list {
                            return Err("This agent cannot list its sessions.".to_string());
                        }
                        let answer = client
                            .list_sessions(Some(&cwd), cursor.as_deref())
                            .await
                            .map_err(|error| error.to_string())?;
                        Ok((
                            answer["sessions"].as_array().cloned().unwrap_or_default(),
                            answer["nextCursor"].as_str().map(str::to_owned),
                            capabilities,
                            methods,
                        ))
                    })
                },
            )
            .await?;
        let mut sessions = Vec::new();
        for entry in listed.iter().take(200) {
            let Some(native) = entry["sessionId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 512)
            else {
                continue;
            };
            let cwd = entry["cwd"].as_str().unwrap_or("");
            if !roots.iter().any(|root| same_folder(Path::new(cwd), root)) {
                continue;
            }
            sessions.push(AgentSessionInfo {
                native_session_id: native.to_owned(),
                title: entry["title"]
                    .as_str()
                    .map(|title| title.chars().take(120).collect()),
                updated_at: entry["updatedAt"].as_str().map(str::to_owned),
                cwd: cwd.to_owned(),
                imported: false,
            });
        }
        let natives: Vec<String> = sessions
            .iter()
            .map(|session| session.native_session_id.clone())
            .collect();
        let imported = self.imported_natives(project_id, agent_id, natives).await?;
        for session in &mut sessions {
            session.imported = imported.contains(&session.native_session_id);
        }
        let page = AgentSessionPage {
            sessions,
            next_cursor: next.filter(|cursor| cursor.len() <= 2048),
        };
        Ok((page, capabilities, methods))
    }

    async fn imported_natives(
        self: &Arc<Self>,
        project_id: &str,
        agent_id: &str,
        natives: Vec<String>,
    ) -> Result<std::collections::HashSet<String>, String> {
        let runtime = self.clone();
        let (project_id, agent_id) = (project_id.to_owned(), agent_id.to_owned());
        tokio::task::spawn_blocking(move || {
            let natives: Vec<&str> = natives.iter().map(String::as_str).collect();
            runtime
                .store
                .imported_natives(&project_id, &agent_id, &natives)
        })
        .await
        .map_err(|_| "The saved conversations could not be read.")?
    }

    pub async fn import_sessions(
        self: &Arc<Self>,
        project_id: &str,
        agent_id: &str,
        native_ids: Vec<String>,
    ) -> Result<Vec<SessionRecord>, String> {
        if native_ids.is_empty() || native_ids.len() > MAX_IMPORT {
            return Err("Choose 1 to 50 sessions to import.".into());
        }
        let root = canonical_root(&crate::paths::project_dir(project_id)?)?;
        self.definition(agent_id)?;
        let (page, capabilities, methods) =
            self.list_agent_sessions(project_id, agent_id, None).await?;
        let redactor = oleafly_acp::redact::Redactor::new(&[]);
        super::runtime::add_login_secrets(&redactor);
        let known = self
            .imported_natives(project_id, agent_id, native_ids.clone())
            .await?;
        let mut imported = Vec::new();
        for native in native_ids {
            if native.is_empty() || native.len() > 512 || native.chars().any(char::is_control) {
                continue;
            }
            if known.contains(&native) {
                continue;
            }
            let listed = page
                .sessions
                .iter()
                .find(|entry| entry.native_session_id == native);
            let time = now_ms();
            let record = SessionRecord {
                id: new_id(),
                project_id: project_id.to_owned(),
                project_path: root.to_string_lossy().into_owned(),
                agent_id: agent_id.to_owned(),
                native_session_id: Some(native.clone()),
                title: listed
                    .and_then(|entry| entry.title.clone())
                    .map(|title| redactor.text(&title))
                    .unwrap_or_else(|| "Imported conversation".into()),
                status: SessionStatus::Disconnected,
                created_at: time,
                updated_at: time,
                capabilities: capabilities.clone(),
                auth_methods: methods
                    .iter()
                    .map(|method| redacted_auth_method(&redactor, method))
                    .collect(),
                ..SessionRecord::default()
            };
            self.store.save(&record)?;
            imported.push(record);
        }
        Ok(imported)
    }

    pub async fn fork(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let record = self.copy_record(&session)?;
        if !record.capabilities.fork {
            return Err("This agent cannot fork conversations.".into());
        }
        if record.status != SessionStatus::Ready {
            return Err("Wait for this turn to finish before forking.".into());
        }
        let native = record
            .native_session_id
            .clone()
            .ok_or("The ACP session is not ready.")?;
        let (cwd, servers) = match &record.remote {
            Some(remote) => (remote.folder.clone(), Vec::new()),
            None => (
                launch_root_for(Path::new(&record.project_path))
                    .to_string_lossy()
                    .into_owned(),
                session
                    .mcp_servers
                    .lock()
                    .map_err(|_| "The ACP session is unavailable.")?
                    .clone(),
            ),
        };
        let forked = {
            let _operation = session
                .operation
                .try_lock()
                .map_err(|_| "Wait for this turn to finish before forking.")?;
            session.forking.store(true, Ordering::Release);
            let _forking = ForeignUpdatesIgnored(&session.forking);
            let answer = session
                .client
                .fork_session(&native, &cwd, &servers)
                .await
                .map_err(|error| session.redactor.text(&error.to_string()))?;
            let forked = answer["sessionId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 512)
                .ok_or("The agent did not return the forked session.")?;
            let forked = session.redactor.opaque_id(forked)?;
            if let Ok(mut known) = session.known_foreign.lock() {
                known.insert(forked.clone());
            }
            forked
        };
        if record.capabilities.close {
            let _ = session.client.close_session(&forked).await;
        }
        let time = now_ms();
        let copy = SessionRecord {
            id: new_id(),
            native_session_id: Some(forked),
            parent_session_id: None,
            task_id: None,
            title: format!("{} (fork)", record.title)
                .chars()
                .take(120)
                .collect(),
            title_locked: record.title_locked,
            status: SessionStatus::Disconnected,
            created_at: time,
            updated_at: time,
            turn_id: None,
            error: None,
            last_sequence: 0,
            commits: Vec::new(),
            forked_from: Some(record.id.clone()),
            fork_sequence: None,
            usage: None,
            routed_provider: None,
            ..record
        };
        self.store.save(&copy)?;
        let copied = self
            .store
            .copy_events(&copy.forked_from.clone().unwrap_or_default(), &copy.id)?;
        if copied > 0 {
            let mut saved = copy.clone();
            saved.last_sequence = copied;
            saved.fork_sequence = Some(copied);
            self.store.save(&saved)?;
        }
        self.reconnect_with_mcp(&copy.id, owner, mcp_servers).await
    }

    pub async fn commit_turn(
        &self,
        id: &str,
        turn_id: &str,
        message: &str,
        paths: Vec<String>,
    ) -> Result<TurnCommit, String> {
        let message = message.trim();
        if message.is_empty() || message.chars().count() > 2000 {
            return Err("Write a commit message of up to 2,000 characters.".into());
        }
        if paths.is_empty() || paths.len() > MAX_COMMIT_PATHS {
            return Err("Choose 1 to 200 files to commit.".into());
        }
        let record = self.store.get(id)?;
        if record.remote.is_some() {
            return Err(
                "Hermes on another machine changes files there; commit them on that machine."
                    .into(),
            );
        }
        let turn_files = self.turn_files(id, turn_id)?;
        if let Some(outside) = paths.iter().find(|path| !turn_files.contains(path)) {
            return Err(format!("{outside} was not changed in this turn."));
        }
        let project = record.project_id.clone();
        let commit_message = message.to_owned();
        let commit_paths = paths.clone();
        let commit = tauri::async_runtime::spawn_blocking(move || {
            crate::git::commit_paths_sync(&project, &commit_paths, &commit_message)
        })
        .await
        .map_err(|_| "The commit could not run.")??;
        let entry = TurnCommit {
            turn_id: turn_id.to_owned(),
            commit: commit.clone(),
            paths: paths.clone(),
            message: message.to_owned(),
            created_at: now_ms(),
        };
        if let Ok(session) = self.get_live(id).await {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.commits.push(entry.clone());
            self.emit_locked(
                &session,
                &mut state,
                "turn_commit",
                json!({"turnId": turn_id, "commit": commit, "paths": paths}),
            )?;
        } else {
            let mut stored = self.store.get(id)?;
            stored.commits.push(entry.clone());
            self.store.save(&stored)?;
        }
        Ok(entry)
    }

    fn turn_files(&self, id: &str, turn_id: &str) -> Result<Vec<String>, String> {
        let mut files = Vec::new();
        let mut after = 0;
        loop {
            let page = self.store.events(id, after, 500)?;
            for event in &page.events {
                after = event.sequence;
                if event.kind != "turn_changes" {
                    continue;
                }
                let matches_turn = event.turn_id.as_deref() == Some(turn_id)
                    || event.data["turnId"].as_str() == Some(turn_id);
                if !matches_turn {
                    continue;
                }
                for list in ["files", "changes", "paths"] {
                    for item in event.data[list].as_array().into_iter().flatten() {
                        if let Some(path) = item.as_str().or(item["path"].as_str()) {
                            files.push(path.to_owned());
                        }
                    }
                }
            }
            if !page.has_more {
                break;
            }
        }
        Ok(files)
    }
}

pub(super) struct ForeignUpdatesIgnored<'a>(pub(super) &'a AtomicBool);

impl Drop for ForeignUpdatesIgnored<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn same_folder(left: &Path, right: &Path) -> bool {
    if left.as_os_str().is_empty() {
        return false;
    }
    let canonical = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let (left, right): (PathBuf, PathBuf) = (canonical(left), canonical(right));
    if cfg!(windows) {
        left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
    } else {
        left == right
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn import_matches_project_cwd_case_insensitively() {
        assert!(same_folder(
            Path::new("c:\\Thesis"),
            Path::new("C:\\thesis")
        ));
    }

    #[test]
    fn empty_folders_never_match() {
        assert!(!same_folder(Path::new(""), Path::new("/")));
    }
}
