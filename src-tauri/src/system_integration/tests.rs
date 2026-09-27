use super::*;
use std::ffi::OsString;
#[cfg(target_os = "macos")]
use tauri::Manager;

const LINUX_BINARY: &str = "oleafly";
const PACKAGED_EXE: &str = "/usr/bin/oleafly";

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
                        .replace("{{comment}}", env!("CARGO_PKG_DESCRIPTION"))
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
    assert!(rendered.contains("\nExec=/usr/bin/oleafly %F\n"));
    assert!(rendered.contains("\nName=Oleafly\n"));
}

#[test]
fn the_appimage_launcher_runs_its_own_binary_by_name() {
    let linux = config(include_str!("../../tauri.linux.conf.json"));
    assert_eq!(
        linux["bundle"]["linux"]["appimage"]["files"]["/usr/share/applications/Oleafly.desktop"],
        "linux/appimage.desktop"
    );
    let expected = desktop_template_rendered(LINUX_BINARY)
        .replace("\nExec=/usr/bin/oleafly %F\n", "\nExec=oleafly %F\n");
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
        assert_eq!(files.as_object().unwrap().len(), 2, "{format}");
    }
}

#[test]
fn service_menus_open_folders_and_carry_every_translation() {
    let dolphin = file_manager::dolphin_service_menu(PACKAGED_EXE);
    assert!(dolphin.starts_with(
        "[Desktop Entry]\nType=Service\nMimeType=inode/directory;\nActions=openWithOleafly;\n"
    ));
    assert!(dolphin.contains("\nName=Open with Oleafly\n"));
    assert!(dolphin.contains("\nExec=/usr/bin/oleafly --open-folder %f\n"));
    assert!(dolphin.contains("\nIcon=oleafly\n"));
    let nemo = file_manager::nemo_action(PACKAGED_EXE);
    assert!(nemo.starts_with("[Nemo Action]\n"));
    assert!(nemo.contains("\nExec=/usr/bin/oleafly --open-folder %F\n"));
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
        file_manager::exec_argument("/usr/bin/oleafly"),
        "/usr/bin/oleafly"
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
    assert!(text.contains("\nExec=/usr/bin/oleafly --open-folder %f\n"));
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
    };
    assert_eq!(
        serde_json::to_value(&item).unwrap(),
        serde_json::json!({
            "id": "folder_open_with",
            "state": "needs_attention",
            "packaged": false,
            "attention": "moved"
        })
    );
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
