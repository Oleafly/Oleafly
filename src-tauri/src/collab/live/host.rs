use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::ids::ServerId;
use tauri::Emitter;

use super::moves::{RemovedPayload, LIVE_REMOVED_EVENT};
use super::payloads::{
    ChangeSkippedPayload, MembersPayload, MergedPayload, NewDevicePayload, PresenceLeftPayload,
    PresencePayload, ProjectFullPayload, RolePayload, StatusPayload, WrittenPayload,
    CHANGE_SKIPPED_EVENT, LIVE_MEMBERS_EVENT, LIVE_MERGED_EVENT, LIVE_NEW_DEVICE_EVENT,
    LIVE_ROLE_EVENT, LIVE_STATUS_EVENT, LIVE_WRITTEN_EVENT, PRESENCE_EVENT, PRESENCE_LEFT_EVENT,
    PROJECT_FULL_EVENT,
};
use super::{kept, unwritten, uploads};
use crate::collab::state::CollabState;
use crate::folder_watch::FolderChange;

pub trait LiveHost: Send + Sync + 'static {
    fn status(&self, payload: StatusPayload);
    fn role(&self, payload: RolePayload);
    fn merged(&self, payload: MergedPayload);
    fn presence(&self, payload: PresencePayload);
    fn presence_left(&self, payload: PresenceLeftPayload);
    fn folder_changed(&self, change: FolderChange);
    fn new_device(&self, payload: NewDevicePayload);
    fn renamed(&self, _payload: crate::collab::tree::RenamedPayload) {}
    fn comments_changed(&self, _payload: crate::collab::comments::CommentsChangedPayload) {}
    fn comments_not_sent(&self, _payload: crate::collab::comments::CommentsNotSentPayload) {}
    fn comments_status(&self, _payload: crate::collab::comments::CommentsStatusPayload) {}
    fn suggestions_changed(&self, _payload: crate::collab::suggesting::SuggestionsChangedPayload) {}
    fn suggestion_refused(&self, _payload: crate::collab::suggesting::SuggestionRefusedPayload) {}
    fn chat_changed(&self, _payload: crate::collab::chat::ChatChangedPayload) {}
    fn members(&self, _payload: MembersPayload) {}
    fn change_skipped(&self, _payload: ChangeSkippedPayload) {}
    fn project_full(&self, _payload: ProjectFullPayload) {}
    fn session_ended(&self, _server: ServerId, _reason: SessionEndReason) {}
    fn removed(&self, _payload: RemovedPayload) {}
    fn kept(&self, _payload: kept::KeptPayload) {}
    fn uploads(&self, _payload: uploads::UploadsPayload) {}
    fn upload_progress(&self, _payload: uploads::UploadProgress) {}
    fn unwritten(&self, _payload: unwritten::UnwrittenPayload) {}
    fn settings_changed(&self, _applied: crate::collab::settings::Applied) {}
    fn written(&self, _payload: WrittenPayload) {}
    fn app(&self) -> Option<tauri::AppHandle> {
        None
    }
}

pub struct AppLiveHost {
    app: tauri::AppHandle,
}

impl AppLiveHost {
    pub fn new(app: tauri::AppHandle) -> AppLiveHost {
        AppLiveHost { app }
    }
}

impl LiveHost for AppLiveHost {
    fn status(&self, payload: StatusPayload) {
        let _ = self.app.emit(LIVE_STATUS_EVENT, payload);
    }

    fn role(&self, payload: RolePayload) {
        let _ = self.app.emit(LIVE_ROLE_EVENT, payload);
    }

    fn merged(&self, payload: MergedPayload) {
        let _ = self.app.emit(LIVE_MERGED_EVENT, payload);
    }

    fn presence(&self, payload: PresencePayload) {
        let _ = self.app.emit(PRESENCE_EVENT, payload);
    }

    fn presence_left(&self, payload: PresenceLeftPayload) {
        let _ = self.app.emit(PRESENCE_LEFT_EVENT, payload);
    }

    fn folder_changed(&self, change: FolderChange) {
        let _ = self
            .app
            .emit(crate::folder_watch::FOLDER_CHANGED_EVENT, change);
    }

    fn new_device(&self, payload: NewDevicePayload) {
        let _ = self.app.emit(LIVE_NEW_DEVICE_EVENT, payload);
    }

    fn renamed(&self, payload: crate::collab::tree::RenamedPayload) {
        let _ = self
            .app
            .emit(crate::collab::tree::LIVE_RENAMED_EVENT, payload);
    }

    fn comments_changed(&self, payload: crate::collab::comments::CommentsChangedPayload) {
        let _ = self
            .app
            .emit(crate::collab::comments::COMMENTS_CHANGED_EVENT, payload);
    }

    fn comments_not_sent(&self, payload: crate::collab::comments::CommentsNotSentPayload) {
        let _ = self
            .app
            .emit(crate::collab::comments::COMMENTS_NOT_SENT_EVENT, payload);
    }

    fn comments_status(&self, payload: crate::collab::comments::CommentsStatusPayload) {
        let _ = self
            .app
            .emit(crate::collab::comments::COMMENTS_STATUS_EVENT, payload);
    }

    fn suggestions_changed(&self, payload: crate::collab::suggesting::SuggestionsChangedPayload) {
        let _ = self.app.emit(
            crate::collab::suggesting::SUGGESTIONS_CHANGED_EVENT,
            payload,
        );
    }

    fn suggestion_refused(&self, payload: crate::collab::suggesting::SuggestionRefusedPayload) {
        let _ = self
            .app
            .emit(crate::collab::suggesting::SUGGESTION_REFUSED_EVENT, payload);
    }

    fn chat_changed(&self, payload: crate::collab::chat::ChatChangedPayload) {
        let _ = self
            .app
            .emit(crate::collab::chat::CHAT_CHANGED_EVENT, payload);
    }

    fn members(&self, payload: MembersPayload) {
        let _ = self.app.emit(LIVE_MEMBERS_EVENT, payload);
    }

    fn change_skipped(&self, payload: ChangeSkippedPayload) {
        let _ = self.app.emit(CHANGE_SKIPPED_EVENT, payload);
    }

    fn project_full(&self, payload: ProjectFullPayload) {
        let _ = self.app.emit(PROJECT_FULL_EVENT, payload);
    }

    fn removed(&self, payload: RemovedPayload) {
        let _ = self.app.emit(LIVE_REMOVED_EVENT, payload);
    }

    fn kept(&self, payload: kept::KeptPayload) {
        let _ = self.app.emit(kept::LIVE_KEPT_EVENT, payload);
    }

    fn uploads(&self, payload: uploads::UploadsPayload) {
        let _ = self.app.emit(uploads::LIVE_UPLOADS_EVENT, payload);
    }

    fn upload_progress(&self, payload: uploads::UploadProgress) {
        let _ = self.app.emit(uploads::UPLOAD_PROGRESS_EVENT, payload);
    }

    fn unwritten(&self, payload: unwritten::UnwrittenPayload) {
        let _ = self.app.emit(unwritten::LIVE_UNWRITTEN_EVENT, payload);
    }

    fn settings_changed(&self, applied: crate::collab::settings::Applied) {
        use tauri::Manager;
        let state = self.app.try_state::<crate::state::AppState>();
        if let (Some(meta), Some(state)) = (applied.meta, state) {
            let _ = crate::project::publish_project_state_changed(
                &self.app,
                state.inner(),
                &applied.project_id,
                meta,
                "collab-settings-changed",
                false,
                crate::project::project_mutation_generation(applied.project_id.clone()).ok(),
            );
        }
        for payload in applied.notices {
            let _ = self
                .app
                .emit(crate::collab::settings::LIVE_SETTINGS_EVENT, payload);
        }
    }

    fn written(&self, payload: WrittenPayload) {
        let _ = self.app.emit(LIVE_WRITTEN_EVENT, payload);
    }

    fn app(&self) -> Option<tauri::AppHandle> {
        Some(self.app.clone())
    }

    fn session_ended(&self, server: ServerId, reason: SessionEndReason) {
        use tauri::Manager;
        let state = self.app.state::<CollabState>();
        let host = crate::collab::commands::AppHost::new(self.app.clone());
        let _ = crate::collab::commands::note_session_end(state.inner(), &host, server, reason);
    }
}
