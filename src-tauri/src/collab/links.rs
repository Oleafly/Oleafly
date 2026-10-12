use std::ffi::OsStr;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Emitter, Runtime};

pub const OPEN_LINK_EVENT: &str = "collab-open-link";
pub const SCHEME: &str = "oleafly";
const MAX_LINK_LENGTH: usize = 2_048;
const MAX_PENDING: usize = 16;

static PENDING: LazyLock<Mutex<Vec<String>>> = LazyLock::new(|| Mutex::new(Vec::new()));

#[cfg(test)]
pub(crate) static QUEUE_TEST_LOCK: Mutex<()> = Mutex::new(());

fn pending() -> MutexGuard<'static, Vec<String>> {
    PENDING.lock().unwrap_or_else(PoisonError::into_inner)
}

fn cleaned(text: &str) -> Option<&str> {
    let link = text.trim_matches(|c: char| c.is_whitespace() || c == '"' || c == '\'');
    let link = if link.contains('?') {
        link.trim_end_matches('/')
    } else {
        link
    };
    let scheme = link.get(..SCHEME.len())?;
    let rest = link.get(SCHEME.len()..)?;
    (link.len() <= MAX_LINK_LENGTH
        && scheme.eq_ignore_ascii_case(SCHEME)
        && rest.starts_with("://"))
    .then_some(link)
}

pub fn is_link(text: &str) -> bool {
    cleaned(text).is_some()
}

pub fn add_server_url(link: &str) -> Option<String> {
    let url = tauri::Url::parse(cleaned(link)?).ok()?;
    let host = url.host_str()?;
    if !host.eq_ignore_ascii_case("server") || url.path().trim_end_matches('/') != "/add" {
        return None;
    }
    url.query_pairs()
        .find(|(name, _)| name == "url")
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub fn links_in<I>(arguments: I) -> Vec<String>
where
    I: IntoIterator,
    I::Item: AsRef<OsStr>,
{
    arguments
        .into_iter()
        .filter_map(|argument| {
            argument
                .as_ref()
                .to_str()
                .and_then(cleaned)
                .map(str::to_owned)
        })
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
        let _queue = QUEUE_TEST_LOCK
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
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

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";

    fn link(server: &str) -> String {
        format!("oleafly://open?server={server}&project={PROJECT}")
    }

    fn server_and_project(link: &str) -> (String, String) {
        let url = tauri::Url::parse(link).unwrap();
        assert_eq!(url.scheme(), "oleafly", "{link}");
        let pairs: std::collections::HashMap<String, String> =
            url.query_pairs().into_owned().collect();
        (pairs["server"].clone(), pairs["project"].clone())
    }

    #[test]
    fn links_arrive_clean_in_the_forms_windows_and_linux_launch_them() {
        let plain = link("https%3A%2F%2Fwww.cs.uni.edu%2Foleafly");
        let spaced = link("https%3a%2f%2funi.edu%2Fcollab%20lab");
        let slashed = format!("oleafly://open/?server=https%3A%2F%2Funi.edu&project={PROJECT}");
        let shouted = format!("OLEAFLY://open?server=https%3A%2F%2Funi.edu&project={PROJECT}");
        let arguments = [
            (plain.clone(), plain.clone()),
            (format!("\"{plain}\""), plain.clone()),
            (format!("{plain}\""), plain.clone()),
            (format!("'{plain}'"), plain.clone()),
            (format!(" {plain}\r\n"), plain.clone()),
            (format!("{plain}/"), plain.clone()),
            (format!("\"{plain}/\""), plain.clone()),
            (spaced.clone(), spaced.clone()),
            (slashed.clone(), slashed.clone()),
            (shouted.clone(), shouted.clone()),
        ];
        for (raw, _) in &arguments {
            assert!(is_link(raw), "{raw}");
        }
        let found = links_in(arguments.iter().map(|(raw, _)| raw.clone()));
        let expected: Vec<String> = arguments.iter().map(|(_, clean)| clean.clone()).collect();
        assert_eq!(found, expected);
        for clean in &found {
            let (_, project) = server_and_project(clean);
            assert_eq!(project, PROJECT, "{clean}");
        }
        assert_eq!(
            server_and_project(&found[0]).0,
            "https://www.cs.uni.edu/oleafly"
        );
        assert_eq!(server_and_project(&spaced).0, "https://uni.edu/collab lab");
        assert_eq!(server_and_project(&slashed).0, "https://uni.edu");
    }

    #[test]
    fn an_add_server_link_names_the_server_to_add() {
        assert_eq!(
            add_server_url("oleafly://server/add?url=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly")
                .as_deref(),
            Some("https://www.cs.uni.edu/oleafly")
        );
        assert_eq!(
            add_server_url(" \"OLEAFLY://server/add/?url=https%3A%2F%2Funi.edu\" ").as_deref(),
            Some("https://uni.edu")
        );
        for other in [
            "oleafly://server/add",
            "oleafly://server/add?url=",
            "oleafly://server/remove?url=https%3A%2F%2Funi.edu",
            "oleafly://open?server=https%3A%2F%2Funi.edu&project=x",
            "https://server/add?url=https%3A%2F%2Funi.edu",
        ] {
            assert_eq!(add_server_url(other), None, "{other}");
        }
        assert!(links_in(["oleafly://server/add?url=https%3A%2F%2Funi.edu"]).len() == 1);
    }

    #[test]
    fn launch_arguments_that_are_not_app_links_are_ignored() {
        let unrelated = [
            r"C:\Program Files\Oleafly\oleafly.exe",
            "/usr/bin/oleafly-desktop",
            "--open-folder",
            "/srv/thesis",
            r"D:\notes",
            "%U",
            "",
            "\"\"",
            "''",
            "https://uni.edu/p/01920000-0000-7000-8000-0000000000aa",
            "file:///srv/thesis",
            "oleafly:open?server=x",
            "oleaflyx://open?server=x",
            "xoleafly://open?server=x",
        ];
        for argument in unrelated {
            assert!(!is_link(argument), "{argument}");
        }
        assert!(links_in(unrelated.map(str::to_owned)).is_empty());
        let long = format!("oleafly://open?n={}", "x".repeat(MAX_LINK_LENGTH));
        assert!(!is_link(&long));
        assert!(!is_link(&format!("\"{long}\"")));
    }

    #[cfg(unix)]
    #[test]
    fn launch_arguments_that_are_not_unicode_are_skipped() {
        use std::os::unix::ffi::OsStringExt;
        let clean = link("https%3A%2F%2Funi.edu");
        let found = links_in([
            std::ffi::OsString::from("/usr/bin/oleafly-desktop"),
            std::ffi::OsString::from_vec(vec![b'/', b't', b'h', 0xe8, b's']),
            std::ffi::OsString::from(&clean),
        ]);
        assert_eq!(found, [clean]);
    }

    #[cfg(windows)]
    #[test]
    fn launch_arguments_that_are_not_unicode_are_skipped() {
        use std::os::windows::ffi::OsStringExt;
        let clean = link("https%3A%2F%2Funi.edu");
        let found = links_in([
            std::ffi::OsString::from(r"C:\Program Files\Oleafly\oleafly.exe"),
            std::ffi::OsString::from_wide(&[0x0044, 0x003a, 0xd800]),
            std::ffi::OsString::from(&clean),
        ]);
        assert_eq!(found, [clean]);
    }
}
