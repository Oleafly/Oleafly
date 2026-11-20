use std::sync::PoisonError;

use oleafly_collab::chat::{ChatMessage, MAX_CHAT_PAGE};
use oleafly_collab::comments::{mentions_in, CommentMember};
use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::SharedLive;
use oleafly_collab::{load_binding, CollabError};
use oleafly_collab_protocol::ids::{AccountId, ChatMessageId};
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction, ProjectRole};
use serde::Serialize;
use tauri::Emitter;

use super::commands::{now_ms, CollabCommandError};
use super::comments::{load_switches, reactions_allowed, CommentSwitches};
use super::live::LiveHost;
use super::state::CollabState;
use super::suggesting::refused;

pub const CHAT_CHANGED_EVENT: &str = "collab://chat-changed";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatChangedPayload {
    pub project_id: String,
    pub local: bool,
    pub mentioned: Vec<ChatMentionedPayload>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMentionedPayload {
    pub message_id: ChatMessageId,
    pub author: AccountId,
}

fn role_refused() -> CollabError {
    refused(
        403,
        "chat_role",
        "your role in this project doesn't allow this in chat",
    )
}

pub(crate) fn announce(
    project_id: &str,
    live: &SharedLive,
    me: AccountId,
    host: &dyn LiveHost,
    local: bool,
) {
    let (changed, mentions) = {
        let mut live = live.lock().unwrap_or_else(PoisonError::into_inner);
        (live.take_chat_changes(), live.take_chat_mentions())
    };
    if changed {
        host.chat_changed(ChatChangedPayload {
            project_id: project_id.to_owned(),
            local,
            mentioned: mentions
                .into_iter()
                .filter(|mention| mention.author != me && mention.mentions.contains(&me))
                .map(|mention| ChatMentionedPayload {
                    message_id: mention.message_id,
                    author: mention.author,
                })
                .collect(),
        });
    }
}

pub(crate) fn send_in(
    live: &mut LiveProject,
    who: AccountId,
    body: &str,
    members: &[CommentMember],
    now: i64,
) -> Result<ChatMessage, CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Chat) {
        return Err(role_refused());
    }
    let mut sent = live
        .comment_doc()
        .send_chat(who, now, body, &mentions_in(body, members))?;
    live.mark_pending_chat(std::slice::from_mut(&mut sent));
    Ok(sent)
}

pub(crate) fn delete_in(
    live: &mut LiveProject,
    who: AccountId,
    id: ChatMessageId,
) -> Result<(), CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Chat) {
        return Err(role_refused());
    }
    live.comment_doc().delete_chat(id, who)
}

pub(crate) fn react_in(
    live: &mut LiveProject,
    who: AccountId,
    id: ChatMessageId,
    emoji: &str,
    on: bool,
    switches: CommentSwitches,
    now: i64,
) -> Result<(), CollabError> {
    if !project_role_allows(live.role(), ProjectAction::Chat) {
        return Err(role_refused());
    }
    reactions_allowed(switches)?;
    let doc = live.comment_doc();
    if on {
        doc.react_to_chat(id, emoji, who, now)
    } else {
        doc.unreact_to_chat(id, emoji, who)
    }
}

pub(crate) fn clear_in(live: &mut LiveProject) -> Result<usize, CollabError> {
    if live.role() != ProjectRole::Owner {
        return Err(role_refused());
    }
    live.comment_doc().clear_chat()
}

fn pending_page(
    live: &LiveProject,
    before: Option<ChatMessageId>,
    limit: usize,
) -> Vec<ChatMessage> {
    let mut page = live.doc().chat_messages(before, limit);
    live.mark_pending_chat(&mut page);
    page
}

pub async fn list_chat(
    state: &CollabState,
    project_id: &str,
    before: Option<ChatMessageId>,
    limit: usize,
) -> Result<Vec<ChatMessage>, CollabError> {
    let limit = limit.clamp(1, MAX_CHAT_PAGE);
    if let Some(listed) =
        super::live::read_live(project_id, |live| pending_page(live, before, limit))
    {
        return Ok(listed);
    }
    let paths = state.paths()?;
    load_binding(paths, project_id)?
        .ok_or_else(|| refused(404, "not_found", "this project is not shared"))?;
    let dir = paths.document_dir(project_id)?;
    tokio::task::spawn_blocking(move || {
        let saved = LiveProject::load(&dir, ProjectRole::Viewer)?;
        Ok(pending_page(&saved, before, limit))
    })
    .await
    .map_err(|error| CollabError::Io(error.to_string()))?
}

fn tell_local(app: &tauri::AppHandle, project_id: &str) {
    let _ = app.emit(
        CHAT_CHANGED_EVENT,
        ChatChangedPayload {
            project_id: project_id.to_owned(),
            local: true,
            mentioned: Vec::new(),
        },
    );
}

#[tauri::command]
pub async fn collab_chat_list(
    state: tauri::State<'_, CollabState>,
    project_id: String,
    before: Option<ChatMessageId>,
    limit: usize,
) -> Result<Vec<ChatMessage>, CollabCommandError> {
    list_chat(state.inner(), &project_id, before, limit)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_chat_send(
    app: tauri::AppHandle,
    project_id: String,
    body: String,
    members: Option<Vec<CommentMember>>,
) -> Result<ChatMessage, CollabCommandError> {
    let members = members.unwrap_or_default();
    let sent = super::live::comment_live(&project_id, |live, who| {
        send_in(live, who, &body, &members, now_ms())
    })
    .map_err(CollabCommandError::from)?;
    tell_local(&app, &project_id);
    Ok(sent)
}

#[tauri::command]
pub async fn collab_chat_delete(
    app: tauri::AppHandle,
    project_id: String,
    id: ChatMessageId,
) -> Result<(), CollabCommandError> {
    super::live::comment_live(&project_id, |live, who| delete_in(live, who, id))
        .map_err(CollabCommandError::from)?;
    tell_local(&app, &project_id);
    Ok(())
}

#[tauri::command]
pub async fn collab_chat_react(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    message_id: ChatMessageId,
    emoji: String,
    on: bool,
) -> Result<(), CollabCommandError> {
    let switches = load_switches(state.paths()?, &project_id);
    super::live::comment_live(&project_id, |live, who| {
        react_in(live, who, message_id, &emoji, on, switches, now_ms())
    })
    .map_err(CollabCommandError::from)?;
    tell_local(&app, &project_id);
    Ok(())
}

#[tauri::command]
pub async fn collab_chat_clear(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), CollabCommandError> {
    super::live::comment_live(&project_id, |live, _| clear_in(live).map(|_| ()))
        .map_err(CollabCommandError::from)?;
    tell_local(&app, &project_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use oleafly_collab::doc::ProjectDoc;

    use super::*;
    use crate::collab::live::{
        MergedPayload, NewDevicePayload, PresenceLeftPayload, PresencePayload, RolePayload,
        StatusPayload,
    };
    use crate::folder_watch::FolderChange;

    #[derive(Default)]
    struct Heard(Mutex<Vec<ChatChangedPayload>>);

    impl LiveHost for Heard {
        fn status(&self, _: StatusPayload) {}
        fn role(&self, _: RolePayload) {}
        fn merged(&self, _: MergedPayload) {}
        fn presence(&self, _: PresencePayload) {}
        fn presence_left(&self, _: PresenceLeftPayload) {}
        fn folder_changed(&self, _: FolderChange) {}
        fn new_device(&self, _: NewDevicePayload) {}
        fn chat_changed(&self, payload: ChatChangedPayload) {
            self.0.lock().unwrap().push(payload);
        }
    }

    fn code(error: CollabError) -> String {
        match error {
            CollabError::Api { code, .. } => code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    const ALLOWED: CommentSwitches = CommentSwitches {
        server: true,
        project: true,
        reactions: true,
    };

    #[test]
    fn a_reaction_is_refused_while_reactions_are_off_on_the_server() {
        let mut member = LiveProject::new(ProjectDoc::create().unwrap(), 0, ProjectRole::Editor);
        let account = AccountId::new_v7();
        let sent = send_in(&mut member, account, "hello", &[], 5).unwrap();
        for switches in [
            CommentSwitches {
                reactions: false,
                ..ALLOWED
            },
            CommentSwitches {
                server: false,
                ..ALLOWED
            },
        ] {
            let refused = react_in(&mut member, account, sent.id, "👍", true, switches, 6);
            assert_eq!(code(refused.unwrap_err()), "reactions_off");
        }
        assert!(member.doc().chat_messages(None, 10)[0].reactions.is_empty());
    }

    #[test]
    fn everyone_but_viewers_chats_and_only_the_owner_clears() {
        let doc = ProjectDoc::create().unwrap();
        let snapshot = doc.snapshot().unwrap();
        let mut owner = LiveProject::new(doc, 0, ProjectRole::Owner);
        let owner_account = AccountId::new_v7();
        for role in [
            ProjectRole::Editor,
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
        ] {
            let mut member = LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, role);
            let account = AccountId::new_v7();
            let sent = send_in(&mut member, account, "hello", &[], 5).unwrap();
            assert_eq!(sent.author, account);
            react_in(&mut member, account, sent.id, "👍", true, ALLOWED, 6).unwrap();
            assert_eq!(
                member.doc().chat_messages(None, 10)[0].reactions[0].by,
                vec![account]
            );
            react_in(&mut member, account, sent.id, "👍", false, ALLOWED, 7).unwrap();
            assert!(member.doc().chat_messages(None, 10)[0].reactions.is_empty());
            delete_in(&mut member, account, sent.id).unwrap();
            assert_eq!(code(clear_in(&mut member).unwrap_err()), "chat_role");
        }
        let mut viewer =
            LiveProject::new(ProjectDoc::load(&snapshot).unwrap(), 0, ProjectRole::Viewer);
        assert_eq!(
            code(send_in(&mut viewer, AccountId::new_v7(), "hello", &[], 5).unwrap_err()),
            "chat_role"
        );
        let kept = send_in(&mut owner, owner_account, "kept", &[], 6).unwrap();
        assert_eq!(
            code(
                react_in(
                    &mut viewer,
                    AccountId::new_v7(),
                    kept.id,
                    "👍",
                    true,
                    ALLOWED,
                    7
                )
                .unwrap_err()
            ),
            "chat_role"
        );
        assert_eq!(clear_in(&mut owner).unwrap(), 1);
    }

    #[test]
    fn a_message_from_someone_else_is_heard_once() {
        let doc = ProjectDoc::create().unwrap();
        let snapshot = doc.snapshot().unwrap();
        let owner: SharedLive = Arc::new(Mutex::new(LiveProject::new(doc, 0, ProjectRole::Owner)));
        let mut member = LiveProject::new(
            ProjectDoc::load(&snapshot).unwrap(),
            0,
            ProjectRole::Commenter,
        );
        send_in(&mut member, AccountId::new_v7(), "Ready?", &[], 5).unwrap();
        let outgoing = member.next_outgoing().unwrap().unwrap();
        owner
            .lock()
            .unwrap()
            .import_update(1, &outgoing.payload)
            .unwrap();
        let heard = Heard::default();
        announce("paper", &owner, AccountId::new_v7(), &heard, false);
        announce("paper", &owner, AccountId::new_v7(), &heard, false);
        assert_eq!(
            heard.0.lock().unwrap().clone(),
            vec![ChatChangedPayload {
                project_id: "paper".to_owned(),
                local: false,
                mentioned: Vec::new(),
            }]
        );
        member.acknowledged(outgoing.batch, 1);
        let me = AccountId::new_v7();
        let members = vec![CommentMember {
            account_id: me,
            display_name: "Owen Smith".to_owned(),
            login: None,
        }];
        let author = AccountId::new_v7();
        let mentioning = send_in(
            &mut member,
            author,
            "@Owen Smith look `@Owen Smith`",
            &members,
            6,
        )
        .unwrap();
        assert_eq!(mentioning.mentions, vec![me]);
        let outgoing = member.next_outgoing().unwrap().unwrap();
        owner
            .lock()
            .unwrap()
            .import_update(2, &outgoing.payload)
            .unwrap();
        announce("paper", &owner, me, &heard, false);
        assert_eq!(
            heard.0.lock().unwrap().last().unwrap().mentioned,
            vec![ChatMentionedPayload {
                message_id: mentioning.id,
                author,
            }]
        );
        let wire =
            serde_json::to_value(owner.lock().unwrap().doc().chat_messages(None, 10)).unwrap();
        for key in [
            "id",
            "author",
            "at",
            "body",
            "deleted",
            "verified",
            "reactions",
            "mentions",
        ] {
            assert!(wire[0].get(key).is_some(), "{key} in {wire}");
        }
    }
}
