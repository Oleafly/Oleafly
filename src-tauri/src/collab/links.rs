use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Emitter, Runtime};

pub const OPEN_LINK_EVENT: &str = "collab-open-link";
const MAX_LINK_LENGTH: usize = 2_048;
const MAX_PENDING: usize = 16;

static PENDING: LazyLock<Mutex<Vec<String>>> = LazyLock::new(|| Mutex::new(Vec::new()));

fn pending() -> MutexGuard<'static, Vec<String>> {
    PENDING.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn is_link(text: &str) -> bool {
    text.len() <= MAX_LINK_LENGTH
        && text
            .get(..10)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("oleafly://"))
}

pub fn links_in<I: IntoIterator<Item = String>>(arguments: I) -> Vec<String> {
    arguments
        .into_iter()
        .filter(|argument| is_link(argument))
        .collect()
}

pub fn remember(links: Vec<String>) -> bool {
    if links.is_empty() {
        return false;
    }
    let mut queue = pending();
    queue.extend(links);
    let overflow = queue.len().saturating_sub(MAX_PENDING);
    queue.drain(..overflow);
    true
}

pub fn take() -> Vec<String> {
    std::mem::take(&mut *pending())
}

pub fn arrive<R: Runtime>(app: &AppHandle<R>, links: Vec<String>) {
    if remember(links) {
        crate::single_instance::reveal_main_window(app);
        let _ = app.emit(OPEN_LINK_EVENT, ());
    }
}

#[tauri::command]
pub fn collab_pending_links() -> Vec<String> {
    take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_app_links_are_kept_and_the_queue_stays_small() {
        let found = links_in(
            [
                "--open-folder",
                "/srv/thesis",
                "OLEAFLY://open?server=https%3A%2F%2Funi.edu&project=x",
                "https://uni.edu/p/x",
            ]
            .map(str::to_owned),
        );
        assert_eq!(found.len(), 1);
        assert!(!is_link(&format!(
            "oleafly://{}",
            "x".repeat(MAX_LINK_LENGTH)
        )));
        take();
        assert!(remember(found));
        assert!(!remember(Vec::new()));
        remember(
            (0..40)
                .map(|index| format!("oleafly://open?n={index}"))
                .collect(),
        );
        let queued = take();
        assert_eq!(queued.len(), MAX_PENDING);
        assert_eq!(
            queued.last().map(String::as_str),
            Some("oleafly://open?n=39")
        );
        assert!(take().is_empty());
    }
}
