//! The helper's notifications: a task finished, has a plan ready, needs an
//! approval, stopped or used its budget (the texts research tasks use in
//! the app), and once when the helper starts working. The app binary passes
//! its localizer; `oleafly daemon run` uses the English texts.
//!
//! Notifications show on a thread of their own and never hold up the
//! helper. A click opens Oleafly (Linux and Windows; macOS opens the app
//! itself).
use std::path::PathBuf;
use std::sync::Arc;

use oleafly_research::host::{Notification, NotificationKind};

use super::serve::{AppLaunch, Localizer};

/// The English texts (the app's `native.json`).
pub const ENGLISH: &[(&str, &str)] = &[
    ("backgroundHelper.started.title", "Oleafly keeps working"),
    (
        "backgroundHelper.started.body",
        "Research tasks you marked to keep running continue in the background. Open Oleafly to see their progress.",
    ),
    ("researchTasks.notify.reviewReady.title", "Task ready for review"),
    ("researchTasks.notify.reviewReady.body", "{{title}}"),
    ("researchTasks.notify.planReady.title", "Plan ready to approve"),
    ("researchTasks.notify.planReady.body", "{{title}}"),
    ("researchTasks.notify.approvalNeeded.title", "A task needs your approval"),
    ("researchTasks.notify.approvalNeeded.body", "{{title}}"),
    ("researchTasks.notify.failed.title", "Task stopped"),
    ("researchTasks.notify.failed.body", "{{title}}"),
    ("researchTasks.notify.budgetReached.title", "Task budget used up"),
    ("researchTasks.notify.budgetReached.body", "{{title}}"),
];

/// The app's Windows identity (its Start Menu shortcut carries it).
pub const APP_AUMID: &str = "com.oleafly.app";
/// PowerShell's identity, which Windows always shows.
pub const POWERSHELL_AUMID: &str =
    r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const MAC_BUNDLE_ID: &str = "com.oleafly.app";

/// The identity Windows shows a notification under: the app's when its
/// Start Menu shortcut exists (Windows refuses unknown ids otherwise).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn windows_app_id(start_menu_shortcut_exists: bool) -> &'static str {
    if start_menu_shortcut_exists {
        APP_AUMID
    } else {
        POWERSHELL_AUMID
    }
}

/// `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Oleafly.lnk`.
#[cfg_attr(not(windows), allow(dead_code))]
fn start_menu_shortcut() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA").filter(|value| !value.is_empty())?;
    Some(
        PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Oleafly.lnk"),
    )
}

fn kind_key(kind: NotificationKind) -> &'static str {
    match kind {
        NotificationKind::ReviewReady => "reviewReady",
        NotificationKind::PlanReady => "planReady",
        NotificationKind::ApprovalNeeded => "approvalNeeded",
        NotificationKind::Failed => "failed",
        NotificationKind::BudgetReached => "budgetReached",
    }
}

pub struct Notifier {
    enabled: bool,
    localize: Option<Localizer>,
    app_launch: Option<Arc<AppLaunch>>,
}

impl Notifier {
    pub fn new(enabled: bool, localize: Option<Localizer>, app_launch: Option<AppLaunch>) -> Self {
        Self {
            enabled,
            localize,
            app_launch: app_launch.map(Arc::new),
        }
    }

    /// A text by its key; the English text when there is no localizer or
    /// it has none.
    pub(crate) fn text(&self, key: &str, title: Option<&str>) -> String {
        let params: Vec<(&str, &str)> = title
            .map(|title| vec![("title", title)])
            .unwrap_or_default();
        if let Some(localize) = &self.localize {
            let text = localize(key, &params);
            if !text.is_empty() && text != key {
                return text;
            }
        }
        let english = ENGLISH
            .iter()
            .find(|(known, _)| *known == key)
            .map_or(key, |(_, text)| text);
        params
            .iter()
            .fold(english.to_string(), |text, (name, value)| {
                text.replace(&format!("{{{{{name}}}}}"), value)
            })
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// A research task's notification.
    pub fn notify(&self, notification: &Notification) {
        if !self.enabled {
            return;
        }
        let key = kind_key(notification.kind);
        let title = self.text(
            &format!("researchTasks.notify.{key}.title"),
            Some(&notification.task_title),
        );
        let body = self.text(
            &format!("researchTasks.notify.{key}.body"),
            Some(&notification.task_title),
        );
        self.show(title, body);
    }

    /// Once, when the helper takes over work after the app quit.
    pub fn started(&self) {
        if !self.enabled {
            return;
        }
        let title = self.text("backgroundHelper.started.title", None);
        let body = self.text("backgroundHelper.started.body", None);
        self.show(title, body);
    }

    fn show(&self, title: String, body: String) {
        let launch = self.app_launch.clone();
        let _ = std::thread::Builder::new()
            .name("oleafly-notification".into())
            .spawn(move || show_now(&title, &body, launch));
    }
}

#[cfg(target_os = "macos")]
fn show_now(title: &str, body: &str, _launch: Option<Arc<AppLaunch>>) {
    use std::sync::OnceLock;
    static APPLICATION: OnceLock<bool> = OnceLock::new();
    let registered =
        *APPLICATION.get_or_init(|| notify_rust::set_application(MAC_BUNDLE_ID).is_ok());
    let shown = registered
        && notify_rust::Notification::new()
            .summary(title)
            .body(body)
            .show()
            .is_ok();
    if !shown {
        // AppleScript strings: quotes and backslashes escaped.
        let quote = |text: &str| text.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            quote(body),
            quote(title)
        );
        let _ = std::process::Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(windows)]
fn show_now(title: &str, body: &str, launch: Option<Arc<AppLaunch>>) {
    let shortcut = start_menu_shortcut().is_some_and(|path| path.is_file());
    let shown = notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .app_id(windows_app_id(shortcut))
        .show();
    if let Ok(handle) = shown {
        handle.wait_for_action(|action| {
            if action != "__closed" {
                if let Some(launch) = &launch {
                    launch.open();
                }
            }
        });
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn show_now(title: &str, body: &str, launch: Option<Arc<AppLaunch>>) {
    let shown = notify_rust::Notification::new()
        .appname("Oleafly")
        .summary(title)
        .body(body)
        .icon("oleafly")
        .action("default", "Open Oleafly")
        .show();
    if let Ok(handle) = shown {
        handle.wait_for_action(|action| {
            if action == "default" {
                if let Some(launch) = &launch {
                    launch.open();
                }
            }
        });
    }
}

#[cfg(not(any(unix, windows)))]
fn show_now(_title: &str, _body: &str, _launch: Option<Arc<AppLaunch>>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_come_from_the_localizer_and_fall_back_to_english() {
        assert_eq!(
            Notifier::new(true, None, None).text("backgroundHelper.started.title", None),
            "Oleafly keeps working"
        );
        let localized = Notifier::new(
            true,
            Some(Arc::new(|key: &str, _: &[(&str, &str)]| format!("[{key}]"))),
            None,
        );
        assert_eq!(
            localized.text("researchTasks.notify.reviewReady.title", None),
            "[researchTasks.notify.reviewReady.title]"
        );
        let missing = Notifier::new(
            true,
            Some(Arc::new(|key: &str, _: &[(&str, &str)]| key.to_string())),
            None,
        );
        assert_eq!(
            missing.text("researchTasks.notify.failed.title", None),
            "Task stopped"
        );
        assert_eq!(
            Notifier::new(true, None, None).text(
                "researchTasks.notify.failed.body",
                Some("Survey of LLM reviewers")
            ),
            "Survey of LLM reviewers"
        );
    }

    #[test]
    fn notifications_are_skipped_when_turned_off() {
        let off = Notifier::new(false, None, None);
        assert!(!off.enabled());
        off.started();
        off.notify(&Notification {
            kind: NotificationKind::Failed,
            task_id: "t".into(),
            project_id: "p".into(),
            task_title: "x".into(),
        });
    }

    #[test]
    fn windows_uses_the_app_id_only_when_its_start_menu_shortcut_exists() {
        assert_eq!(windows_app_id(true), APP_AUMID);
        assert_eq!(windows_app_id(false), POWERSHELL_AUMID);
    }

    #[test]
    fn every_notification_kind_has_english_texts() {
        let notifier = Notifier::new(true, None, None);
        for kind in [
            NotificationKind::ReviewReady,
            NotificationKind::PlanReady,
            NotificationKind::ApprovalNeeded,
            NotificationKind::Failed,
            NotificationKind::BudgetReached,
        ] {
            let key = format!("researchTasks.notify.{}.title", kind_key(kind));
            assert_ne!(notifier.text(&key, None), key);
        }
    }
}
