// Holds the background helper's lock like a helper that stopped answering:
// it never reads stop requests. Built with plain rustc (std only, Rust
// 1.89+ for File::lock). Usage: lock_holder <path to daemon.lock>
// Prints "locked" once it holds the lock, then sleeps.
use std::io::Write;

fn main() {
    let Some(path) = std::env::args_os().nth(1) else {
        eprintln!("usage: lock_holder <lock file>");
        std::process::exit(2);
    };
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&path)
        .expect("open the lock file");
    file.lock().expect("take the lock");
    println!("locked");
    let _ = std::io::stdout().flush();
    std::thread::sleep(std::time::Duration::from_secs(600));
    drop(file);
}
