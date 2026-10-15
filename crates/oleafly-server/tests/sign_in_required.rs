use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[test]
fn the_server_refuses_to_start_without_github_or_openid_connect() {
    let directory = tempfile::tempdir().unwrap();
    let data_dir = directory.path().join("data");
    let mut child = Command::new(env!("CARGO_BIN_EXE_oleafly-server"))
        .env_clear()
        .env("OLEAFLY_PUBLIC_URL", "https://collab.example.edu")
        .env("OLEAFLY_BIND", "127.0.0.1:0")
        .env("OLEAFLY_DATA_DIR", &data_dir)
        .env(
            "OLEAFLY_SMTP_URL",
            "smtps://lab:secret@smtp.example.edu:465",
        )
        .env("OLEAFLY_MAIL_FROM", "lab@example.edu")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() > deadline {
            child.kill().unwrap();
            panic!("the server kept running with no way to sign in");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(output.status.code(), Some(2), "{stderr}");
    assert!(
        stderr.contains("Oleafly Server cannot start. No sign-in method is set up"),
        "{stderr}"
    );
    assert!(stderr.contains("OLEAFLY_GITHUB_CLIENT_ID"), "{stderr}");
    assert!(!data_dir.exists(), "it created {}", data_dir.display());
}
