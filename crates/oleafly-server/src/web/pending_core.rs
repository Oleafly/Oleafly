use oleafly_collab::chat::MAX_CHAT_PAGE;
use oleafly_collab::doc::{DocChanges, ProjectDoc};
use oleafly_collab::ot::TextOperation;
use oleafly_collab::CollabError;
use oleafly_collab_protocol::ids::{AccountId, ChatMessageId, DeviceId, SuggestionId};
use oleafly_collab_protocol::projects::{project_role_allows, ProjectAction, ProjectRole};
use serde::Serialize;
use serde_json::Value;

use crate::web::frames::EditMode;
use crate::web::Refusal;

pub const SUGGESTIONS_READY: bool = true;
pub const CHAT_READY: bool = true;

pub fn may_comment(role: ProjectRole) -> bool {
    project_role_allows(role, ProjectAction::Comment)
}

pub fn may_suggest(role: ProjectRole) -> bool {
    project_role_allows(role, ProjectAction::Suggest)
}

pub fn may_resolve(role: ProjectRole) -> bool {
    project_role_allows(role, ProjectAction::Resolve)
}

pub fn may_choose_mode(role: ProjectRole) -> bool {
    project_role_allows(role, ProjectAction::Edit)
}

pub fn may_chat(role: ProjectRole) -> bool {
    project_role_allows(role, ProjectAction::Chat)
}

pub fn always_suggests(role: ProjectRole) -> bool {
    role == ProjectRole::Reviewer
}

pub fn chosen_mode(mode: EditMode) -> Result<&'static str, Refusal> {
    match mode {
        EditMode::Editing => Ok(crate::web_sessions::EDITING),
        EditMode::Suggesting => Ok(crate::web_sessions::SUGGESTING),
    }
}

fn values<T: Serialize>(items: Vec<T>) -> Vec<Value> {
    items
        .into_iter()
        .filter_map(|item| serde_json::to_value(item).ok())
        .collect()
}

fn suggestion_refusal(error: &CollabError) -> Refusal {
    match error {
        CollabError::Api { code, message, .. }
            if code == "too_large" || code == "suggestion_too_long" =>
        {
            Refusal::new("too_large", message)
        }
        CollabError::Api { code, message, .. } if code == "suggestion_changed" => {
            Refusal::new("conflict", message)
        }
        _ => Refusal::from_collab(error),
    }
}

fn chat_refusal(error: &CollabError) -> Refusal {
    match error {
        CollabError::Api { code, message, .. } if code == "too_large" => {
            Refusal::new("too_large", message)
        }
        CollabError::Api { code, message, .. } if code == "not_yours" => {
            Refusal::new("forbidden", message)
        }
        _ => Refusal::from_collab(error),
    }
}

fn gone() -> Refusal {
    Refusal::new(
        "suggestion_not_found",
        "That suggestion was already handled.",
    )
}

fn ids_of(ids: &[String]) -> Result<Vec<SuggestionId>, Refusal> {
    ids.iter()
        .map(|id| id.parse::<SuggestionId>().map_err(|_| gone()))
        .collect()
}

fn known_file(doc: &ProjectDoc, file_id: &str) -> Result<(), Refusal> {
    if doc.contains(file_id) {
        Ok(())
    } else {
        Err(Refusal::new(
            "not_found",
            "This file is not in the project.",
        ))
    }
}

pub fn suggest_operation(
    doc: &mut ProjectDoc,
    file_id: &str,
    operation: &TextOperation,
    author: AccountId,
    device: DeviceId,
    now: i64,
) -> Result<(), Refusal> {
    doc.suggest_operation(file_id, operation, author, Some(device), now)
        .map_err(|error| suggestion_refusal(&error))
}

pub fn edit_operation(
    doc: &mut ProjectDoc,
    file_id: &str,
    operation: &TextOperation,
) -> Result<(), Refusal> {
    doc.apply_operation(file_id, operation)
        .and_then(|()| doc.drop_empty_suggestions(file_id).map(drop))
        .map_err(|_| Refusal::server())
}

pub fn suggestions(doc: &ProjectDoc, file_id: &str) -> Vec<Value> {
    doc.suggestions(file_id).map(values).unwrap_or_default()
}

pub fn suggestion_files(doc: &ProjectDoc, changes: &DocChanges) -> Vec<String> {
    if changes.suggestions.is_empty() {
        return Vec::new();
    }
    doc.files_of_suggestions(&changes.suggestions)
        .into_iter()
        .collect()
}

pub fn accept_suggestions(doc: &mut ProjectDoc, ids: &[String]) -> Result<Vec<String>, Refusal> {
    let ids = ids_of(ids)?;
    doc.accept_suggestions(&ids)
        .map(|files| files.into_iter().collect())
        .map_err(|error| suggestion_refusal(&error))
}

pub fn reject_suggestions(doc: &mut ProjectDoc, ids: &[String]) -> Result<Vec<String>, Refusal> {
    let ids = ids_of(ids)?;
    doc.reject_suggestions(&ids)
        .map(|files| files.into_iter().collect())
        .map_err(|error| suggestion_refusal(&error))
}

pub fn withdraw_suggestions(
    doc: &mut ProjectDoc,
    ids: &[String],
    by: AccountId,
) -> Result<Vec<String>, Refusal> {
    let ids = ids_of(ids)?;
    doc.withdraw_suggestions(&ids, by)
        .map(|files| files.into_iter().collect())
        .map_err(|error| suggestion_refusal(&error))
}

pub fn accept_file_suggestions(
    doc: &mut ProjectDoc,
    file_id: &str,
) -> Result<Vec<String>, Refusal> {
    known_file(doc, file_id)?;
    doc.accept_file_suggestions(file_id)
        .map(|_| vec![file_id.to_string()])
        .map_err(|error| suggestion_refusal(&error))
}

pub fn reject_file_suggestions(
    doc: &mut ProjectDoc,
    file_id: &str,
) -> Result<Vec<String>, Refusal> {
    known_file(doc, file_id)?;
    doc.reject_file_suggestions(file_id)
        .map(|_| vec![file_id.to_string()])
        .map_err(|error| suggestion_refusal(&error))
}

pub fn chat_messages(doc: &ProjectDoc) -> Vec<Value> {
    values(doc.chat_messages(None, MAX_CHAT_PAGE))
}

pub fn chat_changed(changes: &DocChanges) -> bool {
    changes.chat
}

pub fn send_chat(
    doc: &mut ProjectDoc,
    author: AccountId,
    at: i64,
    body: &str,
) -> Result<(), Refusal> {
    doc.send_chat(author, at, body)
        .map(drop)
        .map_err(|error| chat_refusal(&error))
}

pub fn delete_chat(doc: &mut ProjectDoc, id: &str, by: AccountId) -> Result<(), Refusal> {
    let id = id
        .parse::<ChatMessageId>()
        .map_err(|_| Refusal::new("not_found", "This message is gone."))?;
    doc.delete_chat(id, by)
        .map_err(|error| chat_refusal(&error))
}

pub fn clear_chat(doc: &mut ProjectDoc) -> Result<(), Refusal> {
    doc.clear_chat()
        .map(drop)
        .map_err(|error| chat_refusal(&error))
}

#[cfg(test)]
mod tests {
    use oleafly_collab::doc::NodeKind;

    use super::*;

    fn account(seed: u8) -> AccountId {
        format!("01920000-0000-7000-8000-0000000000{seed:02x}")
            .parse()
            .unwrap()
    }

    fn device() -> DeviceId {
        "01920000-0000-7000-8000-0000000000d1".parse().unwrap()
    }

    fn project() -> (ProjectDoc, String) {
        let mut doc = ProjectDoc::create().unwrap();
        let file = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "Hello world\n")
            .unwrap();
        (doc, file)
    }

    fn insert(doc: &ProjectDoc, file: &str, at: usize, text: &str) -> TextOperation {
        let length = doc.text(file).unwrap().encode_utf16().count();
        let mut operation = TextOperation::new();
        operation.retain(at).insert(text).retain(length - at);
        operation
    }

    #[test]
    fn roles_follow_the_review_matrix() {
        assert_eq!(chosen_mode(EditMode::Editing).unwrap(), "editing");
        assert_eq!(chosen_mode(EditMode::Suggesting).unwrap(), "suggesting");
        for role in [
            ProjectRole::Owner,
            ProjectRole::Editor,
            ProjectRole::Reviewer,
            ProjectRole::Commenter,
        ] {
            assert!(may_comment(role) && may_chat(role), "{role:?}");
        }
        assert!(!may_comment(ProjectRole::Viewer));
        assert!(!may_chat(ProjectRole::Viewer));
        assert!(may_suggest(ProjectRole::Reviewer));
        assert!(!may_suggest(ProjectRole::Commenter));
        assert!(may_resolve(ProjectRole::Editor));
        assert!(!may_resolve(ProjectRole::Reviewer));
        assert!(may_choose_mode(ProjectRole::Owner));
        assert!(!may_choose_mode(ProjectRole::Reviewer));
        assert!(always_suggests(ProjectRole::Reviewer));
        assert!(!always_suggests(ProjectRole::Editor));
    }

    #[test]
    fn a_suggested_change_lists_in_the_contract_shape_and_settles_by_id() {
        let (mut doc, file) = project();
        let operation = insert(&doc, &file, 5, ", dear");
        suggest_operation(&mut doc, &file, &operation, account(0xa1), device(), 7).unwrap();
        assert_eq!(doc.text(&file).unwrap(), "Hello, dear world\n");
        let listed = suggestions(&doc, &file);
        assert_eq!(listed.len(), 1);
        let shown = &listed[0];
        assert_eq!(shown["fileId"], file.as_str());
        assert_eq!(shown["kind"], "insert");
        assert_eq!(shown["author"], account(0xa1).to_string());
        assert_eq!(shown["createdAt"], 7);
        assert_eq!(
            (shown["from"].clone(), shown["to"].clone()),
            (5.into(), 11.into())
        );
        assert_eq!(shown["text"], ", dear");
        assert_eq!(shown["threadId"], Value::Null);
        let id = shown["id"].as_str().unwrap().to_string();
        assert_eq!(
            withdraw_suggestions(&mut doc, std::slice::from_ref(&id), account(0xa2))
                .unwrap_err()
                .code,
            "suggestion_not_yours"
        );
        assert_eq!(
            reject_suggestions(&mut doc, std::slice::from_ref(&id)).unwrap(),
            vec![file.clone()]
        );
        assert_eq!(doc.text(&file).unwrap(), "Hello world\n");
        assert_eq!(
            accept_suggestions(&mut doc, &[id]).unwrap_err().code,
            "suggestion_not_found"
        );
        assert_eq!(
            accept_suggestions(&mut doc, &["s1".to_string()])
                .unwrap_err()
                .code,
            "suggestion_not_found"
        );
        assert_eq!(
            accept_file_suggestions(&mut doc, "nowhere")
                .unwrap_err()
                .code,
            "not_found"
        );
    }

    #[test]
    fn a_suggested_deletion_over_the_limit_reads_as_too_large_and_changes_nothing() {
        let long = "x".repeat(oleafly_collab::suggestions::MAX_DELETED_CHARS + 5);
        let mut doc = ProjectDoc::create().unwrap();
        let file = doc
            .add_node(None, "main.tex", NodeKind::Text, None, &long)
            .unwrap();
        let mut operation = TextOperation::new();
        operation
            .insert("pasted")
            .delete(oleafly_collab::suggestions::MAX_DELETED_CHARS + 1)
            .retain(4);
        let refused =
            suggest_operation(&mut doc, &file, &operation, account(0xa1), device(), 1).unwrap_err();
        assert_eq!(refused.code, "too_large");
        assert_eq!(doc.text(&file).unwrap(), long);
        assert!(suggestions(&doc, &file).is_empty());
    }

    #[test]
    fn an_edit_that_empties_a_suggestion_drops_it() {
        let (mut doc, file) = project();
        let operation = insert(&doc, &file, 0, "Oh ");
        suggest_operation(&mut doc, &file, &operation, account(0xa1), device(), 1).unwrap();
        let mut removal = TextOperation::new();
        removal.delete(3).retain(12);
        edit_operation(&mut doc, &file, &removal).unwrap();
        assert!(suggestions(&doc, &file).is_empty());
    }

    #[test]
    fn chat_messages_send_delete_and_clear() {
        let (mut doc, _) = project();
        send_chat(&mut doc, account(1), 3, " Hi ").unwrap();
        let listed = chat_messages(&doc);
        assert_eq!(listed[0]["body"], "Hi");
        assert_eq!(listed[0]["at"], 3);
        let id = listed[0]["id"].as_str().unwrap().to_string();
        assert_eq!(
            delete_chat(&mut doc, &id, account(2)).unwrap_err().code,
            "forbidden"
        );
        assert_eq!(
            send_chat(&mut doc, account(1), 4, "  ").unwrap_err().code,
            "comment_empty"
        );
        assert_eq!(
            delete_chat(&mut doc, "later", account(1)).unwrap_err().code,
            "not_found"
        );
        delete_chat(&mut doc, &id, account(1)).unwrap();
        send_chat(&mut doc, account(2), 5, "Bye").unwrap();
        clear_chat(&mut doc).unwrap();
        assert!(chat_messages(&doc)
            .iter()
            .all(|message| message["deleted"] == true && message["body"] == ""));
    }
}
