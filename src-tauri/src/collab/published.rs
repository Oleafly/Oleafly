use std::sync::Arc;

use oleafly_collab_protocol::published::{
    AdminPublishedNote, PublishNote, PublishedNote, PublishedNotes,
};

use super::commands::{authed, parse_id, AppHost, CollabCommandError};
use super::state::CollabState;

#[tauri::command]
pub async fn collab_published_notes(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<PublishedNotes, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    authed(
        state.inner(),
        &AppHost::new(app),
        server,
        |client, access| Box::pin(client.published_notes(access)),
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_publish_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    source: String,
    title: String,
    html: String,
) -> Result<PublishedNote, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    let note = Arc::new(PublishNote {
        source,
        title,
        html,
    });
    authed(
        state.inner(),
        &AppHost::new(app),
        server,
        move |client, access| {
            let note = Arc::clone(&note);
            Box::pin(async move { client.publish_note(access, &note).await })
        },
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_unpublish_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    note_id: String,
) -> Result<(), CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    authed(
        state.inner(),
        &AppHost::new(app),
        server,
        move |client, access| {
            let note_id = note_id.clone();
            Box::pin(async move { client.unpublish_note(access, &note_id).await })
        },
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_published_notes(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
) -> Result<Vec<AdminPublishedNote>, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    authed(
        state.inner(),
        &AppHost::new(app),
        server,
        |client, access| Box::pin(client.admin_published_notes(access)),
    )
    .await
    .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_admin_set_note_taken_down(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    server_id: String,
    note_id: String,
    taken_down: bool,
) -> Result<AdminPublishedNote, CollabCommandError> {
    let server = parse_id(&server_id, "server")?;
    authed(
        state.inner(),
        &AppHost::new(app),
        server,
        move |client, access| {
            let note_id = note_id.clone();
            Box::pin(async move {
                client
                    .admin_set_note_taken_down(access, &note_id, taken_down)
                    .await
            })
        },
    )
    .await
    .map_err(CollabCommandError::from)
}
