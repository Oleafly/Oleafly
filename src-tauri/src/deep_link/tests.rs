use super::*;
use std::sync::{Arc, Mutex};
use tauri::test::MockRuntime;
use tauri::Listener;

fn link(pack_id: &str, template_id: &str) -> TemplateLink {
    TemplateLink {
        pack_id: pack_id.to_string(),
        template_id: template_id.to_string(),
    }
}

fn config(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap()
}

#[test]
fn a_template_link_names_one_pack_and_one_template() {
    assert_eq!(
        parse("oleafly://template/academic-writing/ieee_conference-2"),
        Ok(link("academic-writing", "ieee_conference-2"))
    );
    assert_eq!(
        parse("OLEAFLY://template/University-CN/Thesis_01"),
        Ok(link("University-CN", "Thesis_01"))
    );
    let longest = "a".repeat(MAX_ID_LEN);
    assert_eq!(
        parse(&format!("oleafly://template/{longest}/{longest}")),
        Ok(link(&longest, &longest))
    );
}

#[test]
fn hostile_or_malformed_template_links_are_refused() {
    let long = "a".repeat(MAX_ID_LEN + 1);
    let huge = "b".repeat(10_000);
    let hostile = [
        "oleafly://template/a/b/c".to_string(),
        "oleafly://template/a/b/".to_string(),
        "oleafly://template/a".to_string(),
        "oleafly://template/".to_string(),
        "oleafly://template".to_string(),
        "oleafly://".to_string(),
        "oleafly:".to_string(),
        "oleafly:template/a/b".to_string(),
        "oleafly:///template/a/b".to_string(),
        "oleafly://template//b".to_string(),
        "oleafly://template/a//b".to_string(),
        "oleafly://template/../b".to_string(),
        "oleafly://template/a/..".to_string(),
        "oleafly://template/a/../b".to_string(),
        "oleafly://template/./a/b".to_string(),
        "oleafly://template/a/b/../c".to_string(),
        "oleafly://template/a%2Fb/c".to_string(),
        "oleafly://template/a/b%2F..%2F..".to_string(),
        "oleafly://template/%2e%2e/b".to_string(),
        "oleafly://template/a%00/b".to_string(),
        "oleafly://template/a/b?install=1".to_string(),
        "oleafly://template/a/b#top".to_string(),
        "oleafly://template/a/b?".to_string(),
        "oleafly://open/a/b".to_string(),
        "oleafly://Template/a/b".to_string(),
        "oleafly://templates/a/b".to_string(),
        "oleafly://template.example.com/a/b".to_string(),
        "oleafly://user@template/a/b".to_string(),
        "oleafly://template:443/a/b".to_string(),
        "oleafly://template\\a\\b".to_string(),
        "oleafly://template/a\\..\\b/c".to_string(),
        "oleafly://template/a/b ".to_string(),
        "oleafly://template/a\n/b".to_string(),
        "oleafly://template/a\t/b".to_string(),
        "oleafly://template/a\0/b".to_string(),
        "oleafly://template/a/b\" --open-folder \"C:\\Users".to_string(),
        "oleafly://template/caf\u{e9}/b".to_string(),
        "oleafly://template/\u{ff41}/b".to_string(),
        "oleafly://template/a/b.zip".to_string(),
        format!("oleafly://template/{long}/b"),
        format!("oleafly://template/a/{long}"),
        format!("oleafly://template/a/{huge}"),
    ];
    for raw in &hostile {
        assert_eq!(parse(raw), Err(Rejection::Malformed), "{raw:?}");
    }
}

#[test]
fn links_for_other_schemes_are_left_to_their_own_handlers() {
    for raw in [
        "",
        "file:///Users/me/thesis/",
        "https://oleafly.com/template/a/b",
        "oleaflyx://template/a/b",
        "oleafl://template/a/b",
        "/oleafly://template/a/b",
        " oleafly://template/a/b",
        "\u{e9}leafly://template/a/b",
    ] {
        assert_eq!(parse(raw), Err(Rejection::OtherScheme), "{raw:?}");
    }
}

#[test]
fn links_the_url_parser_normalized_still_pass_only_as_two_plain_ids() {
    for raw in [
        "oleafly://template/a/%2e%2e/b",
        "oleafly://template/a/b/%2E%2E/c",
        "oleafly://template/x/./y",
        "oleafly://template/a/b/../c",
        "oleafly://TEMPLATE/a/b",
        "oleafly://template/a/b%2Fc",
        "oleafly://template/a/b?x#y",
        "  oleafly://template/a/b  ",
    ] {
        let Ok(url) = tauri::Url::parse(raw) else {
            continue;
        };
        if let Ok(parsed) = parse(url.as_str()) {
            for id in [&parsed.pack_id, &parsed.template_id] {
                assert!(
                    crate::template_packs::is_valid_id(id),
                    "{raw:?} gave {id:?}"
                );
                assert!(id.len() <= MAX_ID_LEN, "{raw:?}");
            }
        }
    }
}

#[test]
fn only_arguments_that_start_with_the_scheme_count_as_links() {
    assert!(is_deep_link_arg("oleafly://template/a/b"));
    assert!(is_deep_link_arg("OleaFly:anything"));
    assert!(!is_deep_link_arg("oleafly"));
    assert!(!is_deep_link_arg("/srv/oleafly:notes"));
    assert!(!is_deep_link_arg("oleafl\u{e9}:x"));
    assert!(!is_deep_link_arg(""));
}

#[test]
fn ignored_links_are_logged_short_and_escaped() {
    let message = ignored_message("oleafly://template/a\n/b\u{1b}[31m");
    assert!(
        message.contains("oleafly://template/a\\n/b\\u{1b}[31m"),
        "{message}"
    );
    assert!(!message.contains('\n'));
    let long = ignored_message(&format!("oleafly://{}", "x".repeat(5_000)));
    assert!(long.len() < 400, "{}", long.len());
    assert!(long.ends_with("…\""), "{long}");
}

#[test]
fn a_link_waits_for_the_page_and_only_the_latest_one_is_kept() {
    let inbox = LinkInbox::default();
    assert_eq!(inbox.admit(link("a", "first")), None);
    assert_eq!(inbox.admit(link("a", "second")), None);
    assert_eq!(inbox.open(), Some(link("a", "second")));
    assert_eq!(inbox.open(), None);
    assert_eq!(inbox.admit(link("b", "live")), Some(link("b", "live")));
    inbox.close();
    assert_eq!(inbox.admit(link("c", "after-reload")), None);
    assert_eq!(inbox.open(), Some(link("c", "after-reload")));
}

fn app_with_inbox() -> tauri::App<MockRuntime> {
    tauri::test::mock_builder()
        .manage(LinkInbox::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

fn heard_links(app: &tauri::App<MockRuntime>) -> Arc<Mutex<Vec<serde_json::Value>>> {
    let heard = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&heard);
    app.listen_any(TEMPLATE_LINK_EVENT, move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    heard
}

#[test]
fn shared_project_links_are_handled_elsewhere_and_not_logged_as_ignored() {
    assert!(!reported(
        Rejection::Malformed,
        "oleafly://open?server=https%3A%2F%2Funi.edu&project=x"
    ));
    assert!(!reported(
        Rejection::Malformed,
        "oleafly://server/add?url=https%3A%2F%2Funi.edu"
    ));
    assert!(reported(Rejection::Malformed, "oleafly://template/a"));
    assert!(reported(Rejection::Malformed, "oleafly://nonsense"));
    assert!(!reported(Rejection::OtherScheme, "file:///srv/thesis/"));
}

#[test]
fn a_cold_start_link_is_buffered_until_the_main_page_is_ready() {
    let app = app_with_inbox();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let heard = heard_links(&app);

    receive(app.handle(), "oleafly://template/academic-writing/ieee");
    receive(app.handle(), "file:///Users/me/thesis/");
    assert!(heard.lock().unwrap().is_empty());

    assert_eq!(
        claim_for(main.as_ref()),
        Some(link("academic-writing", "ieee"))
    );
    assert_eq!(claim_for(main.as_ref()), None);

    receive(app.handle(), "oleafly://template/typst-cv/modern");
    receive(app.handle(), "https://oleafly.com/template/typst-cv/modern");
    let heard = heard.lock().unwrap();
    assert_eq!(heard.len(), 1, "{heard:?}");
    assert_eq!(
        heard[0],
        serde_json::json!({ "packId": "typst-cv", "templateId": "modern" })
    );
}

#[test]
fn only_the_main_window_page_can_claim_a_waiting_link() {
    let app = app_with_inbox();
    let preview = tauri::WebviewWindowBuilder::new(&app, "preview", Default::default())
        .build()
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let pane = main
        .as_ref()
        .window()
        .add_child(
            tauri::webview::WebviewBuilder::new("oleafly-browser-pane-link", Default::default()),
            tauri::LogicalPosition::new(0, 0),
            tauri::LogicalSize::new(400, 600),
        )
        .unwrap();
    receive(app.handle(), "oleafly://template/open-cv/simple");
    assert_eq!(claim_for(preview.as_ref()), None);
    assert_eq!(claim_for(&pane), None);
    assert_eq!(claim_for(main.as_ref()), Some(link("open-cv", "simple")));
}

#[test]
fn links_from_the_deep_link_plugin_reach_the_inbox() {
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_deep_link::init())
        .manage(LinkInbox::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    start(app.handle());
    tauri::Emitter::emit(
        app.handle(),
        "deep-link://new-url",
        vec![
            tauri::Url::parse("file:///Users/me/thesis/").unwrap(),
            tauri::Url::parse("oleafly://template/open-letter/formal").unwrap(),
        ],
    )
    .unwrap();
    assert_eq!(
        claim_for(main.as_ref()),
        Some(link("open-letter", "formal"))
    );
}

#[test]
fn the_plugin_is_skipped_only_where_argv_is_read_and_not_unicode() {
    assert!(plugin_allowed(false, false));
    assert!(plugin_allowed(false, true));
    assert!(plugin_allowed(true, true));
    assert!(!plugin_allowed(true, false));
}

fn launch(registers_schemes: bool, debug_build: bool, automated: bool, appimage: bool) -> Launch {
    Launch {
        registers_schemes,
        debug_build,
        automated,
        appimage,
    }
}

#[test]
fn schemes_are_registered_at_runtime_only_for_dev_and_appimage_builds() {
    assert!(registers_at_runtime(launch(true, true, false, false)));
    assert!(registers_at_runtime(launch(true, false, false, true)));
    assert!(!registers_at_runtime(launch(true, false, false, false)));
    assert!(!registers_at_runtime(launch(true, true, true, true)));
    assert!(!registers_at_runtime(launch(false, true, false, true)));
}

#[test]
fn the_bundle_registers_the_oleafly_scheme_on_every_desktop() {
    let tauri = config(include_str!("../../tauri.conf.json"));
    assert_eq!(
        tauri["plugins"]["deep-link"],
        serde_json::json!({ "desktop": { "schemes": [SCHEME] } })
    );
    for (name, text) in [
        (
            "tauri.linux.conf.json",
            include_str!("../../tauri.linux.conf.json"),
        ),
        (
            "tauri.macos.conf.json",
            include_str!("../../tauri.macos.conf.json"),
        ),
        (
            "tauri.windows.conf.json",
            include_str!("../../tauri.windows.conf.json"),
        ),
    ] {
        assert!(config(text)["plugins"].is_null(), "{name}");
    }
}

#[test]
fn the_page_gets_no_deep_link_plugin_commands() {
    for (name, text) in [
        (
            "default.json",
            include_str!("../../capabilities/default.json"),
        ),
        (
            "browser.json",
            include_str!("../../capabilities/browser.json"),
        ),
    ] {
        assert!(!text.contains("deep-link"), "{name}");
    }
}

#[test]
fn linux_packages_hand_links_to_a_handler_that_takes_urls() {
    let handler = include_str!("../../linux/oleafly-url-handler.desktop");
    assert!(handler.starts_with("[Desktop Entry]\n"));
    assert!(handler.contains("\nExec=/usr/bin/oleafly-desktop %u\n"));
    assert!(handler.contains(&format!("\nMimeType=x-scheme-handler/{SCHEME};\n")));
    assert!(handler.contains("\nNoDisplay=true\n"));
    assert!(handler.contains("\nIcon=oleafly-desktop\n"));
    let main = include_str!("../../linux/main.desktop");
    assert!(!main.contains("MimeType"));
    assert!(!main.contains("mime_type"));
    assert!(!include_str!("../../linux/appimage.desktop").contains("x-scheme-handler"));
    let linux = config(include_str!("../../tauri.linux.conf.json"));
    for format in ["deb", "rpm"] {
        assert_eq!(
            linux["bundle"]["linux"][format]["files"]
                ["/usr/share/applications/oleafly-url-handler.desktop"],
            "linux/oleafly-url-handler.desktop",
            "{format}"
        );
    }
}
