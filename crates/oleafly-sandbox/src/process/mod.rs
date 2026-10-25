//! Process-tree containment and process identity, shared by the app, the
//! CLI and the daemon.
#[cfg(unix)]
mod hangup;
pub mod identity;
mod jobs;
mod tree;

#[cfg(unix)]
pub use hangup::signal_process_group;
#[cfg(windows)]
pub use jobs::process_image_name;
#[cfg(unix)]
pub use jobs::process_name;
pub use tree::{
    contain_process_tree, isolate_process_tree, isolate_std_process_tree, ProcessTreeGuard,
};
