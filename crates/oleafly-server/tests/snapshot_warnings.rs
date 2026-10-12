mod large_changes;
mod people;

use large_changes::{
    append_large_changes, budget, build_every, hinted, opened_doc, shared_with_alice,
};
use people::stage;

#[derive(Clone, Default)]
struct Capture(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .expect("capture lock")
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn a_project_too_large_to_build_is_reported_once_per_round_of_changes() {
    let capture = Capture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .finish();
    let _logging = tracing::subscriber::set_default(subscriber);
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    build_every(&stage, 10);
    budget(&stage, 4 << 20, 200 << 20);
    let doc = opened_doc();
    append_large_changes(&stage, &doc, project, 1..=12, 64 << 10).await;
    for _ in 0..4 {
        assert_eq!(hinted(&stage, project, 12).await, Some(0));
    }
    append_large_changes(&stage, &doc, project, 13..=16, 64 << 10).await;
    assert_eq!(hinted(&stage, project, 16).await, Some(0));
    append_large_changes(&stage, &doc, project, 17..=22, 64 << 10).await;
    assert_eq!(hinted(&stage, project, 22).await, Some(0));
    let text = String::from_utf8_lossy(&capture.0.lock().expect("capture lock")).into_owned();
    let warnings = text
        .lines()
        .filter(|line| line.contains("WARN") && line.contains("Kept the change log"))
        .count();
    assert_eq!(warnings, 2, "{text}");
}
