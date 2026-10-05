use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

use super::ReloadBudget;

pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("oleafly-web-process")
        .on_webview_ready(|webview| watch(&webview))
        .build()
}

fn watch<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    if webview.label() != webview.window().label() {
        return;
    }
    let label = webview.label().to_owned();
    let _ = webview.with_webview(move |platform| {
        let budget = Rc::new(RefCell::new(ReloadBudget::default()));
        platform
            .inner()
            .connect_web_process_terminated(move |view, reason| {
                let cause = match reason {
                    WebProcessTerminationReason::Crashed => "crashed",
                    WebProcessTerminationReason::ExceededMemoryLimit => "ran out of memory",
                    _ => return,
                };
                if budget.borrow_mut().spend(Instant::now()) {
                    eprintln!("webview: the {label} web process {cause}; reloading the page");
                    view.reload();
                } else {
                    eprintln!("webview: the {label} web process {cause} again; not reloading");
                }
            });
    });
}
