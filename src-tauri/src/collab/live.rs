pub mod commands;
pub mod write;

pub use oleafly_live::live::unwritten;
use oleafly_live::live::{bases, disk_pass, live_disk};

mod downloads;
mod editor;
mod host;
mod import;
mod kept;
mod lifecycle;
mod live_tree;
pub mod local_copy;
mod local_events;
mod moves;
pub(crate) mod overleaf;
mod owed;
mod pacing;
mod payloads;
mod pump;
mod session;
mod settings;
mod sync_hold;
mod unsent;
pub mod uploads;

pub use editor::document_snapshot;
pub(super) use editor::{comment_live, edit_live, live_root, read_live, review_live};
pub use host::LiveHost;
pub use lifecycle::{finish_for_quit, forget, resumed_if_failed, stop, window_focused, QUIT_WAIT};
pub use local_events::{app_wrote, folder_changed, wants_local_events};
pub(crate) use local_events::{known_content, shared_files, KnownContent};
pub(crate) use moves::{deleting, dismiss_notice, lost_notices, renaming, restored, RemovedFile};
pub use session::{
    active_for, announce_renames, live_for, note_fresh_join, Active, Live, LiveDisk,
};
pub(crate) use sync_hold::{outside_change, root_returned};
pub(crate) use unsent::{
    detach_projects, keep_local_copies, unsent_changes, UnsentProject, SIGN_OUT_WAIT,
};

use bases::{initial_bases, merged_onto, nearest, WrittenTexts};
use disk_pass::checked;
use import::{by_path, ensure_dir, name_of, parent_of, read_local_changes, LocalImport};
use session::{guard, lock, not_live, WriterSignal, ACTIVE};

pub fn app_host(app: tauri::AppHandle) -> std::sync::Arc<dyn LiveHost> {
    std::sync::Arc::new(host::AppLiveHost::new(app))
}

#[cfg(test)]
pub use lifecycle::start;
#[cfg(test)]
pub use payloads::{
    ChangeSkippedPayload, MembersPayload, MergeMarks, MergedAuthor, MergedFile, MergedPayload,
    NewDevicePayload, PresenceLeftPayload, PresencePayload, RolePayload, StatusPayload,
};

#[cfg(test)]
use crate::collab::disk::sha256_hex;
#[cfg(test)]
use disk_pass::{apply_to_disk, writable, DiskPass, DiskTexts};
#[cfg(test)]
use import::apply_local_import;
#[cfg(test)]
use live_disk::writer_loop;
#[cfg(test)]
use pump::pump;

#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod outside_tests;
#[cfg(test)]
mod session_tests;
