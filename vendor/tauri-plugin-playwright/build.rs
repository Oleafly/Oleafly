const COMMANDS: &[&str] = &["pw_result"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
