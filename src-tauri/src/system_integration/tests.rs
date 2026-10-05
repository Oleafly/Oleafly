use super::*;
use std::ffi::OsString;
#[cfg(target_os = "macos")]
use tauri::Manager;

const LINUX_BINARY: &str = "oleafly-desktop";
const PACKAGED_EXE: &str = "/usr/bin/oleafly-desktop";

fn url(text: &str) -> tauri::Url {
    tauri::Url::parse(text).unwrap()
}

fn config(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap()
}

#[test]
fn an_open_event_passes_on_only_local_file_urls() {
    let entries = opened_entries(&[
        url("file:///srv/thesis/"),
        url("https://example.com/thesis"),
        url("oleafly://open?path=/srv/x"),
        url("FILE:///srv/My%20Notes"),
    ]);
    assert_eq!(
        entries,
        [
            OsString::from("file:///srv/thesis/"),
            OsString::from("file:///srv/My%20Notes"),
        ]
    );
    assert!(opened_entries(&[]).is_empty());
}

#[cfg(target_os = "macos")]
fn app_built_like_run() -> tauri::App<tauri::test::MockRuntime> {
    crate::with_open_intake(
        tauri::test::mock_builder(),
        crate::open_request::OpenIntake::default(),
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .unwrap()
}

#[cfg(target_os = "macos")]
fn pending(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> Vec<(String, crate::open_request::OpenSource)> {
    app.state::<crate::open_request::OpenIntake>()
        .pending()
        .into_iter()
        .map(|request| (request.display_name, request.source))
        .collect()
}

#[cfg(target_os = "macos")]
#[test]
fn a_folder_opened_from_finder_or_the_dock_joins_the_intake_as_an_os_request() {
    use crate::open_request::OpenSource;
    let app = app_built_like_run();
    on_run_event(
        app.handle(),
        &tauri::RunEvent::Opened {
            urls: vec![
                url("file:///srv/thesis/"),
                url("file:///srv/My%20Notes%20%231"),
            ],
        },
    );
    assert_eq!(
        pending(&app),
        [
            ("thesis".to_string(), OpenSource::Os),
            ("My Notes #1".to_string(), OpenSource::Os),
        ]
    );
}

#[cfg(target_os = "macos")]
#[test]
fn the_app_run_builds_hears_open_events_before_any_window_exists() {
    let app = app_built_like_run();
    assert!(app.get_webview_window("main").is_none());
    on_run_event(
        app.handle(),
        &tauri::RunEvent::Opened {
            urls: vec![url("file:///Users/me/paper")],
        },
    );
    assert_eq!(
        pending(&app),
        [("paper".to_string(), crate::open_request::OpenSource::Os)]
    );
    assert!(app.handle().remove_plugin("system-integration"));
}

#[cfg(target_os = "macos")]
#[test]
fn open_events_without_a_local_folder_leave_the_intake_empty() {
    let app = app_built_like_run();
    on_run_event(app.handle(), &tauri::RunEvent::Ready);
    on_run_event(app.handle(), &tauri::RunEvent::Opened { urls: Vec::new() });
    on_run_event(
        app.handle(),
        &tauri::RunEvent::Opened {
            urls: vec![
                url("https://example.com/thesis"),
                url("oleafly://open?path=/srv/x"),
            ],
        },
    );
    assert!(pending(&app).is_empty());
}

#[test]
fn the_folder_document_type_takes_dock_drops_without_becoming_the_default() {
    let macos = config(include_str!("../../tauri.macos.conf.json"));
    let associations: Vec<tauri::utils::config::FileAssociation> =
        serde_json::from_value(macos["bundle"]["fileAssociations"].clone()).unwrap();
    assert!(associations
        .iter()
        .all(|association| association.mime_type.is_none()));
    let plist = tauri::utils::config::file_associations_plist(&associations).unwrap();
    let dict = plist.as_dictionary().unwrap();
    assert!(dict.get("UTExportedTypeDeclarations").is_none());
    let types = dict
        .get("CFBundleDocumentTypes")
        .and_then(|value| value.as_array())
        .unwrap();
    assert_eq!(types.len(), 1);
    let folder = types[0].as_dictionary().unwrap();
    let text = |key: &str| folder.get(key).and_then(|value| value.as_string());
    let content_types: Vec<&str> = folder
        .get("LSItemContentTypes")
        .and_then(|value| value.as_array())
        .unwrap()
        .iter()
        .filter_map(|value| value.as_string())
        .collect();
    assert_eq!(content_types, ["public.folder"]);
    assert_eq!(text("CFBundleTypeRole"), Some("Editor"));
    assert_eq!(text("LSHandlerRank"), Some("Alternate"));
    assert_eq!(text("CFBundleTypeName"), Some("Folder"));
    assert!(folder.get("CFBundleTypeExtensions").is_none());
}

#[test]
fn no_platform_config_declares_a_folder_type_outside_macos() {
    for (name, text) in [
        ("tauri.conf.json", include_str!("../../tauri.conf.json")),
        (
            "tauri.linux.conf.json",
            include_str!("../../tauri.linux.conf.json"),
        ),
    ] {
        let value = config(text);
        assert!(
            value["bundle"]["fileAssociations"].is_null(),
            "{name} declares file associations"
        );
        assert!(!text.contains("inode/directory"), "{name}");
    }
}

#[test]
fn the_quick_action_opens_the_selected_folders_through_launch_services() {
    assert_eq!(
        quick_action::shell_command("com.oleafly.app"),
        "/usr/bin/open -b 'com.oleafly.app' \"$@\""
    );
    let document = quick_action::document("com.oleafly.app");
    assert!(document.contains("<string>/usr/bin/open -b 'com.oleafly.app' \"$@\"</string>"));
    assert!(document.contains("<key>inputMethod</key>\n\t\t\t\t\t<integer>1</integer>"));
    assert!(document.contains(
        "<key>serviceInputTypeIdentifier</key>\n\t\t<string>com.apple.Automator.fileSystemObject.folder</string>"
    ));
    let info = quick_action::info_plist("Open in <Oleafly> & more", "com.oleafly.app");
    assert!(info.contains("<string>Open in &lt;Oleafly&gt; &amp; more</string>"));
    assert!(info.contains("<string>com.oleafly.app.open-folder-quick-action</string>"));
    assert!(info.contains(
        "<key>NSSendFileTypes</key>\n\t\t\t<array>\n\t\t\t\t<string>public.folder</string>"
    ));
    assert!(info.contains("<string>com.apple.finder</string>"));
    assert!(quick_action::valid_bundle_id("com.oleafly.app.e2e"));
    for bad in ["", "com.oleafly'app", "com oleafly", "com/oleafly"] {
        assert!(!quick_action::valid_bundle_id(bad), "{bad:?}");
    }
}

#[test]
fn the_quick_action_installs_repairs_and_removes_itself() {
    let temp = tempfile::tempdir().unwrap();
    let services = temp.path().join("Library/Services");
    let bundle = "com.oleafly.app";
    assert_eq!(
        quick_action::state(&services, bundle),
        ItemState::NotInstalled
    );
    quick_action::install(&services, "Open in Oleafly", bundle).unwrap();
    assert_eq!(quick_action::state(&services, bundle), ItemState::Installed);
    let root = services.join(quick_action::WORKFLOW_DIR);
    let names: Vec<String> = std::fs::read_dir(&services)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, [quick_action::WORKFLOW_DIR]);
    assert_eq!(
        quick_action::state(&services, "com.oleafly.app.e2e"),
        ItemState::NeedsAttention
    );
    std::fs::write(root.join("Contents/document.wflow"), "tampered").unwrap();
    assert_eq!(
        quick_action::state(&services, bundle),
        ItemState::NeedsAttention
    );
    quick_action::install(&services, "Open in Oleafly", bundle).unwrap();
    assert_eq!(quick_action::state(&services, bundle), ItemState::Installed);
    quick_action::remove(&services).unwrap();
    assert!(!root.exists());
    quick_action::remove(&services).unwrap();
    assert_eq!(
        quick_action::state(&services, bundle),
        ItemState::NotInstalled
    );
    assert!(quick_action::install(&services, "Open in Oleafly", "bad id").is_err());
    assert!(!root.exists());
}

#[cfg(target_os = "macos")]
#[test]
fn the_installed_quick_action_is_a_valid_workflow_bundle() {
    let temp = tempfile::tempdir().unwrap();
    quick_action::install(temp.path(), "Öffnen in Oleafly & Co", "com.oleafly.app").unwrap();
    let contents = temp
        .path()
        .join(quick_action::WORKFLOW_DIR)
        .join("Contents");
    for file in ["Info.plist", "document.wflow"] {
        let output = std::process::Command::new("/usr/bin/plutil")
            .arg("-lint")
            .arg(contents.join(file))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{file}: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}

#[cfg(target_os = "macos")]
fn plist_value(file: &Path, key_path: &str) -> String {
    let output = std::process::Command::new("/usr/bin/plutil")
        .args(["-extract", key_path, "raw", "-o", "-"])
        .arg(file)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{key_path} missing in {}",
        file.display()
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[cfg(target_os = "macos")]
#[test]
fn the_quick_action_is_listed_under_quick_actions_and_not_only_services() {
    let temp = tempfile::tempdir().unwrap();
    quick_action::install(temp.path(), "Open in Oleafly", "com.oleafly.app").unwrap();
    let contents = temp
        .path()
        .join(quick_action::WORKFLOW_DIR)
        .join("Contents");
    let document = contents.join("document.wflow");
    let info = contents.join("Info.plist");
    assert_eq!(
        plist_value(&document, "workflowMetaData.presentationMode"),
        "15"
    );
    assert_eq!(
        plist_value(&document, "workflowMetaData.inputTypeIdentifier"),
        "com.apple.Automator.fileSystemObject.folder"
    );
    assert_eq!(
        plist_value(&document, "workflowMetaData.applicationBundleID"),
        "com.apple.finder"
    );
    assert_eq!(
        plist_value(&document, "workflowMetaData.systemImageName"),
        "NSActionTemplate"
    );
    assert_eq!(
        plist_value(&info, "NSServices.0.NSIconName"),
        "NSActionTemplate"
    );
    assert_eq!(
        plist_value(&info, "NSServices.0.NSBackgroundColorName"),
        "background"
    );
}

#[cfg(target_os = "macos")]
fn quarantine(path: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    let value = b"0083;00000000;Safari;";
    let status = unsafe {
        libc::setxattr(
            path.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
            0,
        )
    };
    assert_eq!(status, 0, "{}", std::io::Error::last_os_error());
}

#[cfg(target_os = "macos")]
#[test]
fn a_quarantined_quick_action_needs_attention_and_a_repair_clears_it() {
    let temp = tempfile::tempdir().unwrap();
    let bundle = "com.oleafly.app";
    quick_action::install(temp.path(), "Open in Oleafly", bundle).unwrap();
    let document = temp
        .path()
        .join(quick_action::WORKFLOW_DIR)
        .join("Contents/document.wflow");
    quarantine(&document);
    assert!(quick_action::is_quarantined(&document));
    assert_eq!(
        quick_action::state(temp.path(), bundle),
        ItemState::NeedsAttention
    );
    quick_action::install(temp.path(), "Open in Oleafly", bundle).unwrap();
    assert!(!quick_action::is_quarantined(&document));
    assert_eq!(
        quick_action::state(temp.path(), bundle),
        ItemState::Installed
    );
    let plain = temp.path().join("plain");
    std::fs::write(&plain, "x").unwrap();
    quarantine(&plain);
    quick_action::strip_quarantine(&plain).unwrap();
    quick_action::strip_quarantine(&plain).unwrap();
    assert!(!quick_action::is_quarantined(&plain));
}

fn services_status(entries: &[(&str, serde_json::Value)]) -> serde_json::Value {
    serde_json::Value::Object(
        entries
            .iter()
            .map(|(key, modes)| {
                (
                    (*key).to_string(),
                    serde_json::json!({ "presentation_modes": modes }),
                )
            })
            .collect(),
    )
}

const OUR_SERVICE: &str =
    "com.oleafly.app.open-folder-quick-action - Open in Oleafly - runWorkflowAsService";

fn pbs_export(services: &[(&str, u8)]) -> String {
    let entries: String = services
        .iter()
        .map(|(key, context_menu)| {
            format!(
                "\t\t<key>{key}</key>
\t\t<dict>
\t\t\t<key>presentation_modes</key>
\t\t\t<dict>
\t\t\t\t<key>ContextMenu</key>
\t\t\t\t<integer>{context_menu}</integer>
\t\t\t\t<key>ServicesMenu</key>
\t\t\t\t<integer>1</integer>
\t\t\t</dict>
\t\t</dict>
"
            )
        })
        .collect();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
\t<key>FinderActive</key>
\t<dict>
\t\t<key>APPEXTENSION-com.apple.finder.MarkupQuickAction</key>
\t\t<true/>
\t</dict>
\t<key>NSServicesStatus</key>
\t<dict>
{entries}\t</dict>
\t<key>ServicesShortcutsPresent</key>
\t<data>AQ==</data>
</dict>
</plist>
"
    )
}

#[test]
fn the_quick_actions_menu_counts_only_this_services_context_menu_switch() {
    let bundle = "com.oleafly.app.open-folder-quick-action";
    let title = "Open in Oleafly";
    let shown =
        |status: &serde_json::Value| quick_action::shown_in_quick_actions(status, bundle, title);
    let enabled = services_status(&[(
        OUR_SERVICE,
        serde_json::json!({ "ContextMenu": 1, "FinderPreview": 1, "ServicesMenu": 1, "TouchBar": 0 }),
    )]);
    assert!(shown(&enabled));
    let disabled = services_status(&[(
        OUR_SERVICE,
        serde_json::json!({ "ContextMenu": 0, "ServicesMenu": 1 }),
    )]);
    assert!(!shown(&disabled));
    let others = services_status(&[
        (
            "com.apple.Terminal - New Terminal at Folder - newTerminalAtURLPaths",
            serde_json::json!({ "ContextMenu": 1 }),
        ),
        (
            "com.oleafly.app.e2e.open-folder-quick-action - Open in Oleafly - runWorkflowAsService",
            serde_json::json!({ "ContextMenu": 1 }),
        ),
    ]);
    assert!(!shown(&others));
    assert!(!shown(&serde_json::Value::Null));
    assert!(!shown(&serde_json::json!({})));
    let with_ours = services_status(&[
        (
            "com.apple.Terminal - New Terminal at Folder - newTerminalAtURLPaths",
            serde_json::json!({ "ContextMenu": 0 }),
        ),
        (OUR_SERVICE, serde_json::json!({ "ContextMenu": true })),
    ]);
    assert!(shown(&with_ours));
    assert!(!shown(&services_status(&[(
        OUR_SERVICE,
        serde_json::json!({ "ServicesMenu": 1 })
    )])));
    assert!(!shown(&serde_json::json!({ OUR_SERVICE: {} })));
    let german = services_status(&[(
        "com.oleafly.app.open-folder-quick-action - In Oleafly öffnen - runWorkflowAsService",
        serde_json::json!({ "ContextMenu": 1 }),
    )]);
    assert!(!shown(&german));
    assert!(quick_action::shown_in_quick_actions(
        &german,
        bundle,
        "In Oleafly öffnen"
    ));
    assert!(!quick_action::shown_in_quick_actions(
        &enabled,
        bundle,
        "In Oleafly öffnen"
    ));
}

#[test]
fn the_installed_menu_title_is_read_from_the_services_entry() {
    let info = serde_json::json!({
        "CFBundleIdentifier": "com.oleafly.app.open-folder-quick-action",
        "NSServices": [{ "NSMenuItem": { "default": "In Oleafly öffnen" }, "NSMessage": "runWorkflowAsService" }]
    });
    assert_eq!(
        quick_action::installed_menu_title(&info),
        Some("In Oleafly öffnen")
    );
    assert_eq!(
        quick_action::installed_menu_title(&serde_json::json!({})),
        None
    );
    assert_eq!(
        quick_action::installed_menu_title(&serde_json::json!({ "NSServices": [{}] })),
        None
    );
    assert_eq!(
        quick_action::workflow_id("com.oleafly.app"),
        "com.oleafly.app.open-folder-quick-action"
    );
}

#[test]
fn the_quick_actions_switch_is_read_from_an_exported_services_domain() {
    let bundle = "com.oleafly.app.open-folder-quick-action";
    let title = "Open in Oleafly";
    let switch =
        |export: &str| quick_action::quick_actions_switch(export.as_bytes(), bundle, title);
    assert_eq!(switch(&pbs_export(&[(OUR_SERVICE, 1)])), Some(true));
    assert_eq!(switch(&pbs_export(&[(OUR_SERVICE, 0)])), Some(false));
    let as_booleans = |export: String| {
        export
            .replace("<integer>1</integer>", "<true/>")
            .replace("<integer>0</integer>", "<false/>")
    };
    assert_eq!(
        switch(&as_booleans(pbs_export(&[(OUR_SERVICE, 1)]))),
        Some(true)
    );
    assert_eq!(
        switch(&as_booleans(pbs_export(&[(OUR_SERVICE, 0)]))),
        Some(false)
    );
    assert_eq!(
        switch(&pbs_export(&[(
            "com.oleafly.app.dev.open-folder-quick-action - Open in Oleafly - runWorkflowAsService",
            1
        )])),
        Some(false)
    );
    assert_eq!(switch(&pbs_export(&[])), Some(false));
    let empty =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<dict/>\n</plist>\n";
    assert_eq!(switch(empty), Some(false));
    let not_a_dict =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<array/>\n</plist>\n";
    assert_eq!(switch(not_a_dict), None);
    assert_eq!(switch("not a plist"), None);
    assert_eq!(switch(""), None);
}

#[test]
fn the_installed_info_plist_names_the_menu_title_the_services_status_uses() {
    let info = quick_action::info_plist("Öffnen in Oleafly & Co", "com.oleafly.app");
    let info =
        serde_json::to_value(plist::Value::from_reader_xml(info.as_bytes()).unwrap()).unwrap();
    assert_eq!(
        quick_action::installed_menu_title(&info),
        Some("Öffnen in Oleafly & Co")
    );
    assert_eq!(
        info["CFBundleIdentifier"],
        quick_action::workflow_id("com.oleafly.app")
    );
    assert_eq!(info["NSServices"][0]["NSMessage"], "runWorkflowAsService");
}

#[test]
fn the_services_key_uses_the_identifier_and_title_the_installed_workflow_carries() {
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(
        quick_action::installed_service(temp.path(), "com.oleafly.app.dev", "Open in Oleafly"),
        (
            "com.oleafly.app.dev.open-folder-quick-action".to_string(),
            "Open in Oleafly".to_string()
        )
    );
    quick_action::install(temp.path(), "In Oleafly öffnen", "com.oleafly.app").unwrap();
    assert_eq!(
        quick_action::installed_service(temp.path(), "com.oleafly.app.dev", "Open in Oleafly"),
        (
            "com.oleafly.app.open-folder-quick-action".to_string(),
            "In Oleafly öffnen".to_string()
        )
    );
}

#[test]
fn an_installed_quick_action_is_off_until_its_own_services_entry_is_switched_on() {
    let temp = tempfile::tempdir().unwrap();
    let bundle = "com.oleafly.unit-test.menu-hint";
    quick_action::install(temp.path(), "Öffnen in Oleafly & Co", bundle).unwrap();
    assert_eq!(
        quick_action::state(temp.path(), bundle),
        ItemState::Installed
    );
    let (service, title) = quick_action::installed_service(temp.path(), bundle, "Open in Oleafly");
    let installed_key = format!("{service} - {title} - runWorkflowAsService");
    assert_eq!(
        installed_key,
        "com.oleafly.unit-test.menu-hint.open-folder-quick-action - Öffnen in Oleafly & Co - runWorkflowAsService"
    );
    let escaped_key = installed_key.replace('&', "&amp;");
    let current_language_key =
        "com.oleafly.unit-test.menu-hint.open-folder-quick-action - Open in Oleafly - runWorkflowAsService";
    for (export, expected) in [
        (pbs_export(&[(OUR_SERVICE, 1)]), Some(false)),
        (pbs_export(&[(current_language_key, 1)]), Some(false)),
        (pbs_export(&[(escaped_key.as_str(), 0)]), Some(false)),
        (pbs_export(&[(escaped_key.as_str(), 1)]), Some(true)),
    ] {
        assert_eq!(
            quick_action::quick_actions_switch(export.as_bytes(), &service, &title),
            expected,
            "{export}"
        );
    }
}

#[test]
fn a_workflow_left_by_another_build_needs_attention_and_a_repair_makes_it_consistent() {
    let temp = tempfile::tempdir().unwrap();
    let contents = temp
        .path()
        .join(quick_action::WORKFLOW_DIR)
        .join("Contents");
    quick_action::install(temp.path(), "Open in Oleafly", "com.oleafly.app").unwrap();
    std::fs::write(
        contents.join("document.wflow"),
        quick_action::document("com.oleafly.app.dev"),
    )
    .unwrap();
    for bundle in ["com.oleafly.app.dev", "com.oleafly.app"] {
        assert_eq!(
            quick_action::state(temp.path(), bundle),
            ItemState::NeedsAttention,
            "{bundle}"
        );
    }

    quick_action::install(temp.path(), "Open in Oleafly", "com.oleafly.app.dev").unwrap();
    assert_eq!(
        quick_action::state(temp.path(), "com.oleafly.app.dev"),
        ItemState::Installed
    );
    assert_eq!(
        quick_action::installed_service(temp.path(), "com.oleafly.app.dev", "Open in Oleafly").0,
        "com.oleafly.app.dev.open-folder-quick-action"
    );

    let info = contents.join("Info.plist");
    let written = std::fs::read_to_string(&info).unwrap();
    let without_identifier = written.replace(
        "\t<key>CFBundleIdentifier</key>\n\t<string>com.oleafly.app.dev.open-folder-quick-action</string>\n",
        "",
    );
    assert_ne!(without_identifier, written);
    for broken in [without_identifier.as_str(), "not a plist", ""] {
        std::fs::write(&info, broken).unwrap();
        assert_eq!(
            quick_action::state(temp.path(), "com.oleafly.app.dev"),
            ItemState::NeedsAttention,
            "{broken}"
        );
    }
    std::fs::remove_file(&info).unwrap();
    assert_eq!(
        quick_action::state(temp.path(), "com.oleafly.app.dev"),
        ItemState::NeedsAttention
    );
}

#[test]
fn a_menu_title_from_another_language_is_not_a_defect() {
    let temp = tempfile::tempdir().unwrap();
    let bundle = "com.oleafly.app";
    quick_action::install(temp.path(), "In Oleafly öffnen", bundle).unwrap();
    assert_eq!(
        quick_action::state(temp.path(), bundle),
        ItemState::Installed
    );
    let info = temp
        .path()
        .join(quick_action::WORKFLOW_DIR)
        .join("Contents/Info.plist");
    std::fs::write(&info, quick_action::info_plist("Oleafly で開く", bundle)).unwrap();
    assert_eq!(
        quick_action::state(temp.path(), bundle),
        ItemState::Installed
    );
    assert_eq!(
        quick_action::installed_service(temp.path(), bundle, "Open in Oleafly").1,
        "Oleafly で開く"
    );
}

#[cfg(target_os = "macos")]
fn defaults_can_export(defaults: &Path, domain: &Path) -> bool {
    let mut command = std::process::Command::new(defaults);
    command.arg("export").arg(domain).arg("-");
    crate::proc::output_contained_with_timeout(command, std::time::Duration::from_secs(5))
        .is_ok_and(|output| output.status.success())
}

#[cfg(target_os = "macos")]
#[test]
fn the_live_export_test_is_skipped_when_defaults_is_missing_or_cannot_run() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let domain = temp.path().join("services-status.plist");
    std::fs::write(&domain, pbs_export(&[])).unwrap();
    let not_a_program = temp.path().join("not-a-program");
    std::fs::write(&not_a_program, "defaults").unwrap();
    let failing = temp.path().join("failing");
    std::fs::write(&failing, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&failing, std::fs::Permissions::from_mode(0o755)).unwrap();
    for defaults in [
        temp.path().join("missing"),
        not_a_program,
        failing,
        temp.path().to_path_buf(),
    ] {
        assert!(
            !defaults_can_export(&defaults, &domain),
            "{}",
            defaults.display()
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn defaults_export_reads_a_services_domain_from_a_file_and_never_pbs() {
    let temp = tempfile::tempdir().unwrap();
    let bundle = "com.oleafly.unit-test.menu-hint";
    quick_action::install(temp.path(), "Open in Oleafly", bundle).unwrap();
    let (service, title) = quick_action::installed_service(temp.path(), bundle, "Open in Oleafly");
    let key = format!("{service} - {title} - runWorkflowAsService");
    let domain = temp.path().join("services-status.plist");
    std::fs::write(&domain, pbs_export(&[(key.as_str(), 1)])).unwrap();
    if !defaults_can_export(Path::new("/usr/bin/defaults"), &domain) {
        return;
    }
    for (context_menu, expected) in [(1, Some(true)), (0, Some(false))] {
        std::fs::write(&domain, pbs_export(&[(key.as_str(), context_menu)])).unwrap();
        let export = quick_action::export_defaults(domain.to_str().unwrap()).unwrap();
        assert_eq!(
            quick_action::quick_actions_switch(&export, &service, &title),
            expected
        );
    }
    let absent = temp.path().join("absent.plist");
    let export = quick_action::export_defaults(absent.to_str().unwrap()).unwrap();
    assert_eq!(
        quick_action::quick_actions_switch(&export, &service, &title),
        Some(false)
    );
    assert!(!absent.exists());
}

#[test]
fn the_explorer_verbs_open_the_clicked_folder_or_the_folder_behind_the_click() {
    let exe = r"C:\Users\Me Too\AppData\Local\Oleafly\Oleafly.exe";
    let values = explorer_menu::verb_values(exe, "Open with Oleafly");
    let expected: Vec<(&str, &str, &str)> = vec![
        (
            r"Software\Classes\Directory\shell\Oleafly",
            "",
            "Open with Oleafly",
        ),
        (
            r"Software\Classes\Directory\shell\Oleafly",
            "Icon",
            r#""C:\Users\Me Too\AppData\Local\Oleafly\Oleafly.exe",0"#,
        ),
        (
            r"Software\Classes\Directory\shell\Oleafly\command",
            "",
            r#""C:\Users\Me Too\AppData\Local\Oleafly\Oleafly.exe" --open-folder "%V""#,
        ),
        (
            r"Software\Classes\Directory\Background\shell\Oleafly",
            "",
            "Open with Oleafly",
        ),
        (
            r"Software\Classes\Directory\Background\shell\Oleafly",
            "Icon",
            r#""C:\Users\Me Too\AppData\Local\Oleafly\Oleafly.exe",0"#,
        ),
        (
            r"Software\Classes\Directory\Background\shell\Oleafly\command",
            "",
            r#""C:\Users\Me Too\AppData\Local\Oleafly\Oleafly.exe" --open-folder "%V""#,
        ),
    ];
    let actual: Vec<(&str, &str, &str)> = values
        .iter()
        .map(|value| (value.key.as_str(), value.name, value.data.as_str()))
        .collect();
    assert_eq!(actual, expected);
    assert!(values.iter().all(|value| !value.key.contains(r"\Drive\")));
    assert_eq!(
        explorer_menu::exe_text(Path::new(r"\\?\C:\Apps\Oleafly.exe")).as_deref(),
        Some(r"C:\Apps\Oleafly.exe")
    );
}

#[test]
fn the_uninstaller_removes_only_this_installs_verbs_and_keeps_them_across_updates() {
    let hooks = include_str!("../../windows/hooks.nsh");
    let command = &explorer_menu::verb_values(r"$INSTDIR\${MAINBINARYNAME}.exe", "")[2].data;
    let nsis_command = command.replace('"', "$\\\"");
    assert!(hooks.contains("!macro NSIS_HOOK_PREUNINSTALL"));
    assert!(hooks.contains("${If} $UpdateMode <> 1"));
    for key in explorer_menu::VERB_KEYS {
        assert!(hooks.contains(&format!(
            "ReadRegStr $R7 HKCU \"{key}\\command\" \"\"\n    ${{If}} $R7 == \"{nsis_command}\"\n      DeleteRegKey HKCU \"{key}\""
        )), "{key}\n{hooks}");
    }
    assert_eq!(hooks.matches("DeleteRegKey").count(), 2);
    let tauri = config(include_str!("../../tauri.conf.json"));
    assert_eq!(
        tauri["bundle"]["windows"]["nsis"]["installerHooks"],
        "windows/hooks.nsh"
    );
    assert_eq!(
        tauri["bundle"]["windows"]["wix"]["fragmentPaths"],
        serde_json::json!(["windows/explorer-menu.wxs"])
    );
    assert_eq!(
        tauri["bundle"]["windows"]["wix"]["componentGroupRefs"],
        serde_json::json!(["OleaflyExplorerMenu"])
    );
}

struct WixElement {
    name: String,
    attributes: std::collections::BTreeMap<String, String>,
    text: String,
}

impl WixElement {
    fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes.get(name).map(String::as_str)
    }
}

fn xml_unescaped(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn wix_elements(source: &str) -> Vec<WixElement> {
    source
        .split('<')
        .skip(1)
        .filter(|chunk| !chunk.starts_with(['/', '?', '!']))
        .map(|chunk| {
            let (tag, text) = chunk.split_once('>').expect("an unterminated tag");
            let tag = tag.trim_end_matches('/');
            let (name, mut rest) = tag.split_once(char::is_whitespace).unwrap_or((tag, ""));
            let mut attributes = std::collections::BTreeMap::new();
            while let Some((key, after)) = rest.split_once("=\"") {
                let (value, remainder) = after.split_once('"').expect("an unterminated value");
                attributes.insert(key.trim().to_string(), xml_unescaped(value));
                rest = remainder;
            }
            WixElement {
                name: name.to_string(),
                attributes,
                text: xml_unescaped(text.trim()),
            }
        })
        .collect()
}

#[test]
fn the_msi_removes_only_this_installs_verbs_and_keeps_them_across_upgrades() {
    let elements = wix_elements(include_str!("../../windows/explorer-menu.wxs"));
    let element = |name: &str, id: &str| -> &WixElement {
        elements
            .iter()
            .find(|element| element.name == name && element.attribute("Id") == Some(id))
            .unwrap_or_else(|| panic!("no {name} {id} in explorer-menu.wxs"))
    };
    let tauri = config(include_str!("../../tauri.conf.json"));
    assert!(tauri["mainBinaryName"].is_null());
    let group = tauri["bundle"]["windows"]["wix"]["componentGroupRefs"][0]
        .as_str()
        .unwrap();
    element("ComponentGroup", group);

    let exe = format!("[INSTALLDIR]{}.exe", env!("CARGO_PKG_NAME"));
    let own = explorer_menu::verb_values(&exe, "");
    let own_verb = element("SetProperty", "OLEAFLY_OWN_VERB");
    assert_eq!(own_verb.attribute("Value"), Some(own[2].data.as_str()));
    assert_eq!(own[2].data, own[5].data);
    assert_eq!(own_verb.attribute("After"), Some("CostFinalize"));
    assert_eq!(own_verb.attribute("Sequence"), Some("execute"));

    for key in explorer_menu::VERB_KEYS {
        let search = elements
            .windows(2)
            .find(|pair| {
                pair[1].name == "RegistrySearch"
                    && pair[1].attribute("Key") == Some(format!(r"{key}\command").as_str())
            })
            .unwrap_or_else(|| panic!("no RegistrySearch for {key}"));
        assert_eq!(search[0].name, "Property");
        assert_eq!(search[0].attribute("Secure"), Some("yes"));
        assert_eq!(search[1].attribute("Root"), Some("HKCU"));
        assert_eq!(search[1].attribute("Type"), Some("raw"));
        assert_eq!(search[1].attribute("Name"), None);
        let property = search[0].attribute("Id").unwrap();

        let condition = format!(
            r#"REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE AND {property} ~= OLEAFLY_OWN_VERB"#
        );
        let scheduled = elements
            .iter()
            .find(|element| element.name == "Custom" && element.text == condition)
            .unwrap_or_else(|| panic!("no Custom runs on {condition}"));
        assert_eq!(scheduled.attribute("Before"), Some("InstallFinalize"));
        let action = scheduled.attribute("Action").unwrap();

        let removal = element("CustomAction", action);
        assert_eq!(removal.attribute("BinaryKey"), Some("WixCA"));
        assert_eq!(removal.attribute("DllEntry"), Some("WixQuietExec64"));
        assert_eq!(removal.attribute("Execute"), Some("deferred"));
        assert_eq!(removal.attribute("Impersonate"), Some("yes"));
        assert_eq!(removal.attribute("Return"), Some("ignore"));

        let command = element("SetProperty", action);
        assert_eq!(
            command.attribute("Value"),
            Some(format!(r#""[System64Folder]reg.exe" delete "HKCU\{key}" /f"#).as_str())
        );
        assert_eq!(command.attribute("Before"), Some(action));
        assert_eq!(command.attribute("Sequence"), Some("execute"));
    }
    for name in ["RegistrySearch", "CustomAction", "Custom"] {
        assert_eq!(
            elements
                .iter()
                .filter(|element| element.name == name)
                .count(),
            explorer_menu::VERB_KEYS.len(),
            "{name}"
        );
    }
}

#[cfg(windows)]
#[test]
fn the_explorer_menu_is_written_repaired_and_removed_under_the_user_key() {
    let root = windows_registry::CURRENT_USER;
    let prefix = format!(
        r"Software\OleaflyTests\system-integration-{}",
        std::process::id()
    );
    let here = explorer_menu::verb_values(r"C:\Apps\Oleafly\Oleafly.exe", "Open with Oleafly");
    assert_eq!(
        explorer_menu::state(root, &prefix, &here),
        ItemState::NotInstalled
    );
    assert!(explorer_menu::write(root, &prefix, &here).unwrap());
    assert_eq!(
        explorer_menu::state(root, &prefix, &here),
        ItemState::Installed
    );
    assert!(!explorer_menu::write(root, &prefix, &here).unwrap());
    let moved = explorer_menu::verb_values(r"D:\Oleafly\Oleafly.exe", "Open with Oleafly");
    assert_eq!(
        explorer_menu::state(root, &prefix, &moved),
        ItemState::NeedsAttention
    );
    assert!(explorer_menu::write(root, &prefix, &moved).unwrap());
    let relabelled = explorer_menu::verb_values(r"D:\Oleafly\Oleafly.exe", "Mit Oleafly öffnen");
    assert_eq!(
        explorer_menu::state(root, &prefix, &relabelled),
        ItemState::Installed
    );
    assert!(explorer_menu::write(root, &prefix, &relabelled).unwrap());
    explorer_menu::remove(root, &prefix).unwrap();
    assert_eq!(
        explorer_menu::state(root, &prefix, &relabelled),
        ItemState::NotInstalled
    );
    explorer_menu::remove(root, &prefix).unwrap();
    let _ = root.remove_tree(&prefix);
}

fn desktop_template_rendered(exec: &str) -> String {
    let template = include_str!("../../linux/main.desktop");
    let name = config(include_str!("../../tauri.conf.json"))["productName"]
        .as_str()
        .unwrap()
        .to_string();
    let linux = config(include_str!("../../tauri.linux.conf.json"));
    let comment = linux["bundle"]["shortDescription"]
        .as_str()
        .unwrap_or(env!("CARGO_PKG_DESCRIPTION"))
        .to_string();
    let mut out = String::new();
    let mut skipping = false;
    for line in template.lines() {
        match line {
            "{{#if comment}}" => {}
            "{{#if mime_type}}" => skipping = true,
            "{{/if}}" => skipping = false,
            _ if skipping => {}
            _ => {
                out.push_str(
                    &line
                        .replace("{{categories}}", "")
                        .replace("{{comment}}", &comment)
                        .replace("{{exec}}", exec)
                        .replace("{{icon}}", exec)
                        .replace("{{name}}", &name),
                );
                out.push('\n');
            }
        }
    }
    out
}

#[test]
fn packaged_linux_launchers_run_the_installed_binary_with_every_folder() {
    let template = include_str!("../../linux/main.desktop");
    assert!(template.contains("\nExec=/usr/bin/{{exec}} %F\n"));
    assert!(!template.contains("inode/directory"));
    let linux = config(include_str!("../../tauri.linux.conf.json"));
    for format in ["deb", "rpm"] {
        assert_eq!(
            linux["bundle"]["linux"][format]["desktopTemplate"], "linux/main.desktop",
            "{format}"
        );
    }
    let rendered = desktop_template_rendered(LINUX_BINARY);
    assert!(rendered.contains("\nExec=/usr/bin/oleafly-desktop %F\n"));
    assert!(rendered.contains("\nName=Oleafly\n"));
}

#[test]
fn the_appimage_launcher_runs_its_own_binary_by_name() {
    let linux = config(include_str!("../../tauri.linux.conf.json"));
    assert_eq!(
        linux["bundle"]["linux"]["appimage"]["files"]["/usr/share/applications/Oleafly.desktop"],
        "linux/appimage.desktop"
    );
    let expected = desktop_template_rendered(LINUX_BINARY).replace(
        "\nExec=/usr/bin/oleafly-desktop %F\n",
        "\nExec=oleafly-desktop %F\n",
    );
    assert_eq!(include_str!("../../linux/appimage.desktop"), expected);
}

#[test]
fn packages_ship_the_dolphin_and_nemo_actions_the_builders_describe() {
    assert_eq!(
        include_str!("../../linux/oleafly-open-folder.desktop"),
        file_manager::dolphin_service_menu(PACKAGED_EXE),
        "linux/oleafly-open-folder.desktop is out of date"
    );
    assert_eq!(
        include_str!("../../linux/oleafly-open-folder.nemo_action"),
        file_manager::nemo_action(PACKAGED_EXE),
        "linux/oleafly-open-folder.nemo_action is out of date"
    );
    let linux = config(include_str!("../../tauri.linux.conf.json"));
    for format in ["deb", "rpm"] {
        let files = &linux["bundle"]["linux"][format]["files"];
        assert_eq!(
            files[format!(
                "/usr/share/{}/{}",
                file_manager::DOLPHIN_DIR,
                file_manager::DOLPHIN_FILE
            )],
            "linux/oleafly-open-folder.desktop",
            "{format}"
        );
        assert_eq!(
            files[format!(
                "/usr/share/{}/{}",
                file_manager::NEMO_DIR,
                file_manager::NEMO_FILE
            )],
            "linux/oleafly-open-folder.nemo_action",
            "{format}"
        );
        assert_eq!(files["/usr/bin/oleafly"], "./linux/oleafly", "{format}");
        assert_eq!(
            files["/usr/share/metainfo/com.oleafly.app.metainfo.xml"],
            "linux/com.oleafly.app.metainfo.xml",
            "{format}"
        );
        assert_eq!(files.as_object().unwrap().len(), 4, "{format}");
    }
}

#[test]
fn service_menus_open_folders_and_carry_every_translation() {
    let dolphin = file_manager::dolphin_service_menu(PACKAGED_EXE);
    assert!(dolphin.starts_with(
        "[Desktop Entry]\nType=Service\nMimeType=inode/directory;\nActions=openWithOleafly;\n"
    ));
    assert!(dolphin.contains("\nName=Open with Oleafly\n"));
    assert!(dolphin.contains("\nExec=/usr/bin/oleafly-desktop --open-folder %f\n"));
    assert!(dolphin.contains("\nIcon=oleafly-desktop\n"));
    let nemo = file_manager::nemo_action(PACKAGED_EXE);
    assert!(nemo.starts_with("[Nemo Action]\n"));
    assert!(nemo.contains("\nExec=/usr/bin/oleafly-desktop --open-folder %F\n"));
    assert!(nemo.contains("\nSelection=s\nExtensions=dir;\nQuote=double\n"));
    for text in [&dolphin, &nemo] {
        let translated = text
            .lines()
            .filter(|line| line.starts_with("Name["))
            .count();
        assert_eq!(translated, crate::i18n::SUPPORTED.len() - 1);
        assert!(text.contains(&format!(
            "\nName[zh_CN]={}\n",
            crate::i18n::t_in("zh-Hans", "systemIntegration.openWithOleafly")
        )));
        assert!(text.contains("\nName[pt_BR]="));
        assert!(text.contains("\nName[zh_TW]="));
    }
    assert_eq!(file_manager::desktop_locale("nb"), "nb");
}

#[test]
fn exec_arguments_are_quoted_the_way_desktop_entries_require() {
    assert_eq!(
        file_manager::exec_argument("/usr/bin/oleafly-desktop"),
        "/usr/bin/oleafly-desktop"
    );
    assert_eq!(
        file_manager::exec_argument("/home/me/My Apps/Oleafly.AppImage"),
        "\"/home/me/My Apps/Oleafly.AppImage\""
    );
    assert_eq!(
        file_manager::exec_argument("/opt/50%/a$b\"c`d"),
        "\"/opt/50%%/a\\$b\\\"c\\`d\""
    );
    assert!(file_manager::dolphin_service_menu("/opt/a\\b/oleafly")
        .contains("\nExec=\"/opt/a\\\\\\\\b/oleafly\" --open-folder %f\n"));
    assert_eq!(
        file_manager::script_name("Open with Oleafly"),
        "Open with Oleafly"
    );
    assert_eq!(file_manager::script_name("a/b"), "a b");
    assert_eq!(file_manager::script_name(" / "), "Oleafly");
}

fn layout(root: &Path, exe: &str) -> file_manager::Layout {
    file_manager::Layout {
        exe: exe.to_string(),
        identifier: "com.oleafly.app".to_string(),
        data_home: root.join("data"),
        system_share: root.join("share"),
        programs: file_manager::Programs {
            dolphin: true,
            nemo: true,
            nautilus: true,
        },
        folder_handler_set: true,
        nautilus_script: None,
    }
}

fn item_state(
    layout: &file_manager::Layout,
    id: ItemId,
) -> Option<(ItemState, bool, Option<&'static str>)> {
    file_manager::item(layout, id).map(|item| (item.state, item.packaged, item.attention))
}

#[test]
fn an_appimage_writes_user_level_actions_that_follow_the_appimage() {
    let temp = tempfile::tempdir().unwrap();
    let appimage = "/home/me/Apps/Oleafly_0.4.2_amd64.AppImage";
    let here = layout(temp.path(), appimage);
    for (id, dir, file, executable) in [
        (
            ItemId::Dolphin,
            file_manager::DOLPHIN_DIR,
            file_manager::DOLPHIN_FILE,
            true,
        ),
        (
            ItemId::Nemo,
            file_manager::NEMO_DIR,
            file_manager::NEMO_FILE,
            false,
        ),
    ] {
        assert_eq!(
            item_state(&here, id),
            Some((ItemState::NotInstalled, false, None))
        );
        assert_eq!(
            file_manager::set(&here, id, true, "Open with Oleafly"),
            Ok(None)
        );
        let path = here.data_home.join(dir).join(file);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains(&format!("Exec={appimage} --open-folder")),
            "{text}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, if executable { 0o755 } else { 0o644 });
        }
        #[cfg(not(unix))]
        let _ = executable;
        assert_eq!(
            item_state(&here, id),
            Some((ItemState::Installed, false, None))
        );
        let moved = layout(temp.path(), "/home/me/Downloads/Oleafly.AppImage");
        assert_eq!(
            item_state(&moved, id),
            Some((ItemState::NeedsAttention, false, Some(file_manager::MOVED)))
        );
        assert_eq!(
            file_manager::set(&here, id, false, "Open with Oleafly"),
            Ok(None)
        );
        assert!(!path.exists());
        assert_eq!(
            file_manager::set(&here, id, false, "Open with Oleafly"),
            Ok(None)
        );
    }
}

#[test]
fn actions_that_came_with_the_package_are_reported_and_left_alone() {
    let temp = tempfile::tempdir().unwrap();
    let mut here = layout(temp.path(), PACKAGED_EXE);
    here.programs = file_manager::Programs::default();
    let shipped = here
        .system_share
        .join(file_manager::DOLPHIN_DIR)
        .join(file_manager::DOLPHIN_FILE);
    std::fs::create_dir_all(shipped.parent().unwrap()).unwrap();
    std::fs::write(&shipped, file_manager::dolphin_service_menu(PACKAGED_EXE)).unwrap();
    assert_eq!(item_state(&here, ItemId::Dolphin), None);
    here.programs.dolphin = true;
    assert_eq!(
        item_state(&here, ItemId::Dolphin),
        Some((ItemState::Installed, true, None))
    );
    assert!(file_manager::set(&here, ItemId::Dolphin, false, "Open with Oleafly").is_err());
    assert!(shipped.exists());
    assert_eq!(item_state(&here, ItemId::Nemo), None);
}

#[test]
fn rows_appear_only_for_file_managers_that_are_present() {
    let temp = tempfile::tempdir().unwrap();
    let mut here = layout(temp.path(), PACKAGED_EXE);
    here.programs = file_manager::Programs::default();
    here.folder_handler_set = false;
    assert!(file_manager::status(&here).is_empty());
    here.programs.nemo = true;
    let ids: Vec<ItemId> = file_manager::status(&here)
        .into_iter()
        .map(|item| item.id)
        .collect();
    assert_eq!(ids, [ItemId::Nemo]);
    assert_eq!(file_manager::item(&here, ItemId::QuickAction), None);
    assert!(file_manager::set(&here, ItemId::ExplorerMenu, true, "x").is_err());
}

#[test]
fn the_nautilus_script_is_named_after_the_label_and_can_be_removed() {
    let temp = tempfile::tempdir().unwrap();
    let mut here = layout(temp.path(), "/opt/Oleafly's App/oleafly");
    assert_eq!(
        item_state(&here, ItemId::Nautilus),
        Some((ItemState::NotInstalled, false, None))
    );
    let name = file_manager::set(&here, ItemId::Nautilus, true, "Mit Oleafly öffnen")
        .unwrap()
        .unwrap();
    assert_eq!(name, "Mit Oleafly öffnen");
    let script = here.data_home.join(file_manager::NAUTILUS_DIR).join(&name);
    assert!(std::fs::read_to_string(&script)
        .unwrap()
        .contains("exec '/opt/Oleafly'\\''s App/oleafly' --open-folder \"$folder\"\n"));
    here.nautilus_script = Some(name.clone());
    assert_eq!(
        item_state(&here, ItemId::Nautilus),
        Some((ItemState::Installed, false, None))
    );
    let renamed = file_manager::set(&here, ItemId::Nautilus, true, "Open with Oleafly")
        .unwrap()
        .unwrap();
    assert!(!script.exists());
    here.nautilus_script = Some(renamed);
    assert_eq!(
        file_manager::set(&here, ItemId::Nautilus, false, "x"),
        Ok(None)
    );
    assert_eq!(
        std::fs::read_dir(here.data_home.join(file_manager::NAUTILUS_DIR))
            .unwrap()
            .count(),
        0
    );
}

#[cfg(unix)]
#[test]
fn the_nautilus_script_opens_the_first_selected_folder_or_the_current_one() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let record = temp.path().join("record");
    let fake = temp.path().join("fake oleafly");
    std::fs::write(
        &fake,
        format!(
            "#!/bin/sh\nfor arg in \"$@\"; do printf '%s\\n' \"$arg\"; done > '{}'\n",
            record.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let here = layout(temp.path(), fake.to_str().unwrap());
    let name = file_manager::set(&here, ItemId::Nautilus, true, "Open with Oleafly")
        .unwrap()
        .unwrap();
    let script = here.data_home.join(file_manager::NAUTILUS_DIR).join(name);
    let cwd = temp.path().join("current folder");
    std::fs::create_dir(&cwd).unwrap();
    let run = |selected: &str| {
        let status = std::process::Command::new(&script)
            .current_dir(&cwd)
            .env("NAUTILUS_SCRIPT_SELECTED_FILE_PATHS", selected)
            .status()
            .unwrap();
        assert!(status.success());
        std::fs::read_to_string(&record).unwrap()
    };
    assert_eq!(
        run("/srv/My Thesis\n/srv/notes\n"),
        "--open-folder\n/srv/My Thesis\n"
    );
    let shown = run("");
    let physical = cwd.canonicalize().unwrap();
    assert!(
        [cwd.as_path(), physical.as_path()]
            .iter()
            .any(|folder| shown == format!("--open-folder\n{}\n", folder.display())),
        "{shown}"
    );
}

#[test]
fn the_folder_open_with_entry_is_offered_only_beside_an_existing_default() {
    let temp = tempfile::tempdir().unwrap();
    let mut here = layout(temp.path(), PACKAGED_EXE);
    here.folder_handler_set = false;
    assert_eq!(item_state(&here, ItemId::FolderOpenWith), None);
    assert!(file_manager::set(&here, ItemId::FolderOpenWith, true, "x").is_err());
    here.folder_handler_set = true;
    assert_eq!(
        item_state(&here, ItemId::FolderOpenWith),
        Some((ItemState::NotInstalled, false, None))
    );
    assert_eq!(
        file_manager::set(&here, ItemId::FolderOpenWith, true, "x"),
        Ok(None)
    );
    let entry = here
        .data_home
        .join(file_manager::APPLICATIONS_DIR)
        .join("com.oleafly.app.open-folder.desktop");
    let text = std::fs::read_to_string(&entry).unwrap();
    assert!(text.contains("\nNoDisplay=true\nMimeType=inode/directory;\n"));
    assert!(text.contains("\nExec=/usr/bin/oleafly-desktop --open-folder %f\n"));
    assert_eq!(
        item_state(&here, ItemId::FolderOpenWith),
        Some((ItemState::Installed, false, None))
    );
    here.folder_handler_set = false;
    assert_eq!(
        item_state(&here, ItemId::FolderOpenWith),
        Some((
            ItemState::NeedsAttention,
            false,
            Some(file_manager::NO_DEFAULT_FILE_MANAGER)
        ))
    );
    assert_eq!(
        file_manager::set(&here, ItemId::FolderOpenWith, false, "x"),
        Ok(None)
    );
    assert!(!entry.exists());
    assert_eq!(item_state(&here, ItemId::FolderOpenWith), None);
}

#[test]
fn preferences_are_written_only_when_they_change_and_survive_a_corrupt_file() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("nested").join(PREFS_FILE);
    let first = update_prefs_at(&path, |prefs| {
        let seen = prefs.contains_key("quick_action_offered");
        prefs.insert("quick_action_offered".into(), Value::Bool(true));
        !seen
    })
    .unwrap();
    assert!(first);
    let written = std::fs::metadata(&path).unwrap().modified().unwrap();
    let again = update_prefs_at(&path, |prefs| {
        let seen = prefs.contains_key("quick_action_offered");
        prefs.insert("quick_action_offered".into(), Value::Bool(true));
        !seen
    })
    .unwrap();
    assert!(!again);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        written
    );
    std::fs::write(&path, "{not json").unwrap();
    assert!(read_prefs_at(&path).is_empty());
    update_prefs_at(&path, |prefs| {
        prefs.insert("explorer_menu".into(), Value::Bool(false))
    })
    .unwrap();
    assert_eq!(
        read_prefs_at(&path).get("explorer_menu"),
        Some(&Value::Bool(false))
    );
}

#[test]
fn every_item_serializes_with_the_names_the_settings_screen_reads() {
    let item = Item {
        id: ItemId::FolderOpenWith,
        state: ItemState::NeedsAttention,
        packaged: false,
        attention: Some("moved"),
        quick_actions_menu: None,
        menu_title: None,
    };
    assert_eq!(
        serde_json::to_value(&item).unwrap(),
        serde_json::json!({
            "id": "folder_open_with",
            "state": "needs_attention",
            "packaged": false,
            "attention": "moved",
            "quick_actions_menu": null,
            "menu_title": null
        })
    );
    let quick_action = Item {
        id: ItemId::QuickAction,
        state: ItemState::Installed,
        packaged: false,
        attention: None,
        quick_actions_menu: Some(false),
        menu_title: Some("In Oleafly öffnen".to_string()),
    };
    let quick_action = serde_json::to_value(&quick_action).unwrap();
    assert_eq!(quick_action["quick_actions_menu"], false);
    assert_eq!(quick_action["menu_title"], "In Oleafly öffnen");
    for (id, text) in [
        (ItemId::QuickAction, "quick_action"),
        (ItemId::ExplorerMenu, "explorer_menu"),
        (ItemId::Dolphin, "dolphin"),
        (ItemId::Nemo, "nemo"),
        (ItemId::Nautilus, "nautilus"),
    ] {
        assert_eq!(serde_json::to_value(id).unwrap(), text);
        assert_eq!(serde_json::from_value::<ItemId>(text.into()).unwrap(), id);
    }
}
