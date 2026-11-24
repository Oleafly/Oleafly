use std::sync::Arc;

use oleafly_online::live::session::{ChatChange, ReviewChange};
use oleafly_online::realtime::events::ProjectEvent;

pub trait MirrorHooks: Send + Sync + 'static {
    fn owner_known(&self) -> bool {
        true
    }
    fn record_owner(&self) {}
    fn ended(self: Arc<Self>) {}
    fn role_known(&self) {}
    fn project_event(&self, _event: ProjectEvent) {}
    fn review_trouble(&self, _change: &ReviewChange) -> Vec<String> {
        Vec::new()
    }
    fn review_changed(&self, _change: ReviewChange) {}
    fn chat_trouble(&self, _change: &ChatChange) -> Option<String> {
        None
    }
    fn chat_changed(&self, _change: ChatChange) {}
}

impl MirrorHooks for () {}
