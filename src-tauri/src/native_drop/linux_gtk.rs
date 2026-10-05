use std::time::Instant;

pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-native-drop")
        .on_webview_ready(|webview| watch(&webview))
        .build()
}

fn watch<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use gtk::glib::ObjectType;
    use gtk::prelude::WidgetExt;
    use tauri::Manager;

    use super::{local_paths, NativeDropState};

    if webview.label() != webview.window().label() {
        return;
    }
    let app = webview.app_handle().clone();
    let _ = webview.with_webview(move |platform| {
        let view = platform.inner();
        let drag_id = |ctx: &gtk::gdk::DragContext| ctx.as_ptr() as usize;

        let state = app.clone();
        view.connect_drag_motion(move |_, ctx, _, _, _| {
            state
                .state::<NativeDropState>()
                .with(|drop| drop.motion(drag_id(ctx)));
            false
        });

        let state = app.clone();
        view.connect_drag_data_received(move |_, ctx, _, _, data, _, _| {
            let uris = data.uris();
            if uris.is_empty() {
                return;
            }
            let paths = local_paths(uris.iter().map(|uri| uri.as_str()));
            state
                .state::<NativeDropState>()
                .with(|drop| drop.offer(drag_id(ctx), paths));
        });

        let state = app;
        view.connect_drag_drop(move |_, ctx, _, _, _| {
            state
                .state::<NativeDropState>()
                .with(|drop| drop.dropped(drag_id(ctx), Instant::now()));
            false
        });
    });
}
