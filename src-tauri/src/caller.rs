use tauri::{Runtime, Webview};

pub(crate) fn own_window_label<R: Runtime>(webview: &Webview<R>) -> Option<String> {
    let window = webview.window();
    (webview.label() == window.label()).then(|| window.label().to_owned())
}

#[cfg(test)]
mod tests {
    use super::own_window_label;

    #[test]
    fn only_a_window_own_webview_speaks_for_the_window() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let sibling = main
            .as_ref()
            .window()
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    "oleafly-browser-pane-test",
                    Default::default(),
                ),
                tauri::LogicalPosition::new(0, 0),
                tauri::LogicalSize::new(400, 600),
            )
            .unwrap();

        assert_eq!(own_window_label(main.as_ref()), Some("main".to_owned()));
        assert_eq!(own_window_label(&sibling), None);
    }
}
