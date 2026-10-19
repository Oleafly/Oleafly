use oleafly_agent::{ModelCaps, Wire};

use super::super::{store_bytes, store_text, GLOBAL_SCOPE};
use super::*;

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0, 1, 2, 3];

fn resolved(provider: &str, model: &str, wire: Wire, caps: ModelCaps) -> Resolved {
    Resolved {
        provider_id: provider.into(),
        model_id: model.into(),
        credential: String::new(),
        auth: None,
        wire,
        caps,
    }
}

fn claude(caps: ModelCaps) -> Resolved {
    resolved(
        "anthropic",
        "claude-opus-5-5",
        Wire::Anthropic {
            base_url: "https://api.anthropic.com/v1".into(),
        },
        caps,
    )
}

fn groq() -> Resolved {
    resolved(
        "groq",
        "openai/gpt-oss-120b",
        Wire::OpenAiChat {
            base_url: "https://api.groq.com/openai/v1".into(),
            reasoning_content: false,
        },
        ModelCaps {
            images: Some(false),
            ..ModelCaps::default()
        },
    )
}

fn vision() -> ModelCaps {
    ModelCaps {
        images: Some(true),
        pdf: Some(true),
        context_window: Some(200_000),
        ..ModelCaps::default()
    }
}

fn attachment(sha256: &str, name: &str, mime: &str) -> ContentPart {
    ContentPart::Attachment {
        sha256: sha256.into(),
        name: name.into(),
        mime: mime.into(),
    }
}

fn user(parts: Vec<ContentPart>) -> Message {
    Message {
        role: Role::User,
        content: parts,
    }
}

fn request(messages: Vec<Message>) -> CompletionRequest {
    CompletionRequest {
        messages,
        ..CompletionRequest::default()
    }
}

fn store_pdf(
    root: &std::path::Path,
    bytes: &[u8],
    pages: Option<u32>,
    text: Option<&str>,
) -> String {
    let meta = store_bytes(root, "p1", "a.pdf", "application/pdf", bytes, usize::MAX).unwrap();
    if let Some(text) = text {
        store_text(root, "p1", &meta.sha256, text, pages).unwrap();
    }
    meta.sha256
}

fn texts(message: &Message) -> Vec<String> {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn context(root: &std::path::Path, resolved: &Resolved) -> RunMediaContext {
    RunMediaContext::new(root.to_path_buf(), Some("p1".into()), resolved)
}

#[test]
fn images_resolve_to_data_urls_for_vision_models() {
    let root = tempfile::tempdir().unwrap();
    let png = store_bytes(root.path(), "p1", "fig.png", "image/png", PNG, 100).unwrap();
    let mut req = request(vec![user(vec![attachment(
        &png.sha256,
        "fig.png",
        "image/png",
    )])]);
    let events = context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    assert!(events.is_empty());
    assert!(matches!(
        &req.messages[0].content[0],
        ContentPart::Image { image } if image.starts_with("data:image/png;base64,")
    ));
}

#[test]
fn images_become_a_note_for_text_only_models() {
    let root = tempfile::tempdir().unwrap();
    let png = store_bytes(root.path(), "p1", "fig.png", "image/png", PNG, 100).unwrap();
    let mut req = request(vec![user(vec![attachment(
        &png.sha256,
        "fig.png",
        "image/png",
    )])]);
    let events = context(root.path(), &groq())
        .resolve_request(&mut req)
        .unwrap();
    assert!(texts(&req.messages[0])[0].contains("does not accept images"));
    assert!(matches!(
        &events[..],
        [AgentEvent::Notice { code, detail }] if code == "attachment_skipped" && detail.as_deref() == Some("fig.png")
    ));
}

#[test]
fn pdfs_go_as_documents_where_the_provider_reads_them() {
    let root = tempfile::tempdir().unwrap();
    let sha = store_pdf(root.path(), b"%PDF-1.7 tiny", Some(3), Some("text"));
    let mut req = request(vec![user(vec![attachment(
        &sha,
        "a.pdf",
        "application/pdf",
    )])]);
    context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    assert!(matches!(
        &req.messages[0].content[0],
        ContentPart::Document { data, name, .. }
            if *data == base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.7 tiny") && name == "a.pdf"
    ));
}

#[test]
fn pdfs_fall_back_to_extracted_text_elsewhere() {
    let root = tempfile::tempdir().unwrap();
    let sha = store_pdf(root.path(), b"%PDF", Some(3), Some("Page one text"));
    let mut req = request(vec![user(vec![attachment(
        &sha,
        "a.pdf",
        "application/pdf",
    )])]);
    let events = context(root.path(), &groq())
        .resolve_request(&mut req)
        .unwrap();
    let text = &texts(&req.messages[0])[0];
    assert!(
        text.starts_with("Attached file \"a.pdf\" (3 pages)"),
        "{text}"
    );
    assert!(text.contains("Page one text"));
    assert!(matches!(
        &events[..],
        [AgentEvent::Notice { code, .. }] if code == "attachment_sent_as_text"
    ));
}

#[test]
fn pdfs_over_the_page_limit_fall_back_to_text() {
    let root = tempfile::tempdir().unwrap();
    let sha = store_pdf(root.path(), b"%PDF", Some(150), Some("long"));
    let mut req = request(vec![user(vec![attachment(
        &sha,
        "a.pdf",
        "application/pdf",
    )])]);
    context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    assert!(!req.messages[0]
        .content
        .iter()
        .any(|part| matches!(part, ContentPart::Document { .. })));
    assert!(texts(&req.messages[0])[0].contains("(150 pages)"));
}

#[test]
fn the_newest_attachments_win_the_request_budget() {
    let root = tempfile::tempdir().unwrap();
    // 12 MiB each: the Gemini/chat budget (18 MiB) fits one as base64.
    let big = vec![7u8; 12 * 1024 * 1024];
    let older = store_pdf(root.path(), &big, Some(1), Some("older text"));
    let mut newer_bytes = big.clone();
    newer_bytes[0] = 8;
    let newer = store_pdf(root.path(), &newer_bytes, Some(1), Some("newer text"));
    let gemini = resolved(
        "google",
        "gemini-3.8-flash",
        Wire::Google {
            base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
        },
        vision(),
    );
    let mut req = request(vec![
        user(vec![attachment(&older, "old.pdf", "application/pdf")]),
        Message {
            role: Role::Assistant,
            content: vec![ContentPart::text("ok")],
        },
        user(vec![attachment(&newer, "new.pdf", "application/pdf")]),
    ]);
    context(root.path(), &gemini)
        .resolve_request(&mut req)
        .unwrap();
    assert!(
        matches!(&req.messages[2].content[0], ContentPart::Document { name, .. } if name == "new.pdf")
    );
    assert!(texts(&req.messages[0])[0].contains("older text"));
}

#[test]
fn missing_attachments_become_a_note() {
    let root = tempfile::tempdir().unwrap();
    let mut req = request(vec![user(vec![attachment(
        &"a".repeat(64),
        "gone.png",
        "image/png",
    )])]);
    let events = context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    assert!(texts(&req.messages[0])[0].contains("no longer stored"));
    assert_eq!(events.len(), 1);
}

#[test]
fn media_parts_move_before_the_users_text() {
    let root = tempfile::tempdir().unwrap();
    let png = store_bytes(root.path(), GLOBAL_SCOPE, "fig.png", "image/png", PNG, 100).unwrap();
    let mut req = request(vec![user(vec![
        ContentPart::text("q"),
        attachment(&png.sha256, "fig.png", "image/png"),
    ])]);
    context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    assert!(matches!(
        req.messages[0].content.as_slice(),
        [ContentPart::Image { .. }, ContentPart::Text { text }] if text == "q"
    ));
}

#[test]
fn legacy_inline_images_count_against_the_budget() {
    let root = tempfile::tempdir().unwrap();
    let png = store_bytes(root.path(), "p1", "fig.png", "image/png", PNG, 100).unwrap();
    let inline = format!(
        "data:image/png;base64,{}",
        "A".repeat(30 * 1024 * 1024 - 10)
    );
    let mut req = request(vec![user(vec![
        ContentPart::Image { image: inline },
        attachment(&png.sha256, "fig.png", "image/png"),
    ])]);
    context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    assert!(texts(&req.messages[0])
        .iter()
        .any(|text| text.contains("no room")));
}

#[test]
fn text_attachments_are_truncated_to_the_budget() {
    let root = tempfile::tempdir().unwrap();
    let body = "x".repeat(300_000);
    let file = store_bytes(
        root.path(),
        "p1",
        "notes.txt",
        "text/plain",
        body.as_bytes(),
        usize::MAX,
    )
    .unwrap();
    let mut req = request(vec![user(vec![attachment(
        &file.sha256,
        "notes.txt",
        "text/plain",
    )])]);
    context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    let text = &texts(&req.messages[0])[0];
    assert!(text.contains("[Text truncated after"));
    assert!(text.len() <= PER_ATTACHMENT_TEXT_CHARS + 200);
}

#[test]
fn run_start_images_leave_room_for_tool_images() {
    let root = tempfile::tempdir().unwrap();
    let parts: Vec<ContentPart> = (0..13u8)
        .map(|index| {
            let mut bytes = PNG.to_vec();
            bytes.push(index);
            let meta = store_bytes(root.path(), "p1", "f.png", "image/png", &bytes, 100).unwrap();
            attachment(&meta.sha256, "f.png", "image/png")
        })
        .collect();
    let mut req = request(vec![user(parts)]);
    context(root.path(), &claude(vision()))
        .resolve_request(&mut req)
        .unwrap();
    let images = req.messages[0]
        .content
        .iter()
        .filter(|part| matches!(part, ContentPart::Image { .. }))
        .count();
    assert_eq!(images, 12);
    assert_eq!(texts(&req.messages[0]).len(), 1);
}

#[test]
fn steered_attachments_share_the_runs_remaining_budget() {
    let root = tempfile::tempdir().unwrap();
    let mut stored = Vec::new();
    for index in 0..13u8 {
        let mut bytes = PNG.to_vec();
        bytes.push(index);
        stored.push(store_bytes(root.path(), "p1", "f.png", "image/png", &bytes, 100).unwrap());
    }
    let ctx = context(root.path(), &claude(vision()));
    let mut req = request(vec![user(
        stored[..11]
            .iter()
            .map(|meta| attachment(&meta.sha256, "f.png", "image/png"))
            .collect(),
    )]);
    ctx.resolve_request(&mut req).unwrap();
    let mut steer = user(
        stored[11..]
            .iter()
            .map(|meta| attachment(&meta.sha256, "f.png", "image/png"))
            .collect(),
    );
    ctx.resolve_message(&mut steer).unwrap();
    let images = steer
        .content
        .iter()
        .filter(|part| matches!(part, ContentPart::Image { .. }))
        .count();
    assert_eq!(images, 1);
    assert_eq!(texts(&steer).len(), 1);
}
