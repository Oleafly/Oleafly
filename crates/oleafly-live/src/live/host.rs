use super::moves::RemovedPayload;
use super::payloads::{
    AccountChangedPayload, DocPendingPayload, DownloadProgress, FolderChange, KeptPayload,
    OverleafMembersPayload, PresenceLeftPayload, PresencePayload, RemoteEditPayload, RolePayload,
    StatusPayload, UploadsPayload, WrittenPayload,
};
use super::unwritten::UnwrittenPayload;
use crate::overleaf::notices::OverleafNoticePayload;
use crate::overleaf::tree_events::TreeNotice;

pub trait DiskHost: Send + Sync + 'static {
    fn status(&self, _payload: StatusPayload) {}
    fn role(&self, _payload: RolePayload) {}
    fn presence(&self, _payload: PresencePayload) {}
    fn presence_left(&self, _payload: PresenceLeftPayload) {}
    fn folder_changed(&self, _change: FolderChange) {}
    fn removed(&self, _payload: RemovedPayload) {}
    fn kept(&self, _payload: KeptPayload) {}
    fn uploads(&self, _payload: UploadsPayload) {}
    fn download_progress(&self, _payload: DownloadProgress) {}
    fn unwritten(&self, _payload: UnwrittenPayload) {}
    fn written(&self, _payload: WrittenPayload) {}
    fn account_changed(&self, _payload: AccountChangedPayload) {}
    fn doc_pending(&self, _payload: DocPendingPayload) {}
    fn overleaf_notice(&self, _payload: OverleafNoticePayload) {}
    fn overleaf_members(&self, _payload: OverleafMembersPayload) {}
    fn overleaf_tree(&self, _notice: TreeNotice) {}
    fn remote_edit(&self, _payload: RemoteEditPayload) {}
    fn note_written(&self, _project_id: &str, _text: &str) {}
}
