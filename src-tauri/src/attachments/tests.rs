use std::time::{Duration, SystemTime};

use serde_json::json;

use super::*;

fn set_modified(path: &Path, seconds: u64) {
    let file = std::fs::File::options().write(true).open(path).unwrap();
    file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds))
        .unwrap();
}

fn modified(path: &Path) -> SystemTime {
    std::fs::metadata(path).unwrap().modified().unwrap()
}

#[test]
fn uploads_decode_their_framed_header() {
    // The same bytes as the TypeScript encoder's test vector.
    let json = r#"{"projectId":"p1","name":"é.pdf","mime":"application/pdf"}"#.as_bytes();
    assert_eq!(json.len(), 59);
    let mut body = vec![59, 0, 0, 0];
    body.extend_from_slice(json);
    body.extend_from_slice(&[1, 2, 3]);
    let (header, bytes) = decode_upload(&body).unwrap();
    assert_eq!(
        header,
        UploadHeader {
            project_id: Some("p1".into()),
            name: "é.pdf".into(),
            mime: "application/pdf".into()
        }
    );
    assert_eq!(bytes, &[1, 2, 3]);
}

#[test]
fn malformed_frames_are_refused() {
    assert!(decode_upload(&[200, 0, 0]).is_err());
    assert!(decode_upload(&[10, 0, 0, 0, b'{']).is_err());
    assert!(decode_upload(&[0, 64, 0, 0]).is_err());
}

#[test]
fn the_ipc_fallback_number_array_becomes_bytes() {
    assert_eq!(
        upload_bytes(&tauri::ipc::InvokeBody::Json(json!([1, 2, 255]))).unwrap(),
        vec![1, 2, 255]
    );
    assert!(upload_bytes(&tauri::ipc::InvokeBody::Json(json!([256]))).is_err());
    assert_eq!(
        upload_bytes(&tauri::ipc::InvokeBody::Raw(vec![9, 8])).unwrap(),
        vec![9, 8]
    );
}

#[test]
fn storing_twice_dedupes_by_hash() {
    let root = tempfile::tempdir().unwrap();
    let first = store_bytes(root.path(), "p1", "a.png", "image/png", b"same", 10).unwrap();
    let second = store_bytes(root.path(), "p1", "b.png", "image/png", b"same", 10).unwrap();
    assert_eq!(first.sha256, second.sha256);
    assert_eq!(second.name, "b.png");
    assert_eq!(second.size, 4);
    let blobs = blob_hashes(&scope_dir(root.path(), "p1"));
    assert_eq!(blobs, vec![first.sha256.clone()]);
    assert_eq!(
        first.sha256,
        "0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5"
    );
}

#[test]
fn files_over_the_limit_are_refused_with_an_app_error_code() {
    let root = tempfile::tempdir().unwrap();
    let error = store_bytes(root.path(), "p1", "a.png", "image/png", &[0u8; 11], 10).unwrap_err();
    assert!(error.contains("attachments.too_large"), "{error}");
    assert!(store_bytes(root.path(), "p1", "a.png", "image/png", &[0u8; 10], 10).is_ok());
}

#[test]
fn names_are_sanitized_and_mimes_validated() {
    let root = tempfile::tempdir().unwrap();
    let meta = store_bytes(
        root.path(),
        "p1",
        "a\u{7}/b\\c:d.pdf",
        "Application/PDF",
        b"x",
        10,
    )
    .unwrap();
    assert_eq!(
        (meta.name.as_str(), meta.mime.as_str()),
        ("a_b_c_d.pdf", "application/pdf")
    );
    assert!(store_bytes(root.path(), "p1", "x", "pdf", b"x", 10).is_err());
    assert!(store_bytes(root.path(), "p1", "x", "image/<svg>", b"x", 10).is_err());
    assert_eq!(clean_name("   "), "attachment");
    assert_eq!(clean_name(&"é".repeat(300)).chars().count(), 255);
}

#[test]
fn scope_ids_reject_paths_on_every_platform() {
    for bad in ["../x", "a/b", "a\\b", "C:", ""] {
        assert!(scope_name(Some(bad)).is_err(), "{bad}");
    }
    assert_eq!(scope_name(None).unwrap(), "global");
    assert_eq!(scope_name(Some("p-1_a")).unwrap(), "p-1_a");
}

#[test]
fn hashes_must_be_hex_and_are_lowercased() {
    let root = tempfile::tempdir().unwrap();
    let meta = store_bytes(root.path(), "p1", "a.txt", "text/plain", b"hello", 10).unwrap();
    assert!(read_meta(root.path(), "p1", &"Z".repeat(64)).is_err());
    assert_eq!(
        read_meta(root.path(), "p1", &meta.sha256.to_ascii_uppercase())
            .unwrap()
            .unwrap()
            .sha256,
        meta.sha256
    );
}

#[test]
fn data_roots_with_spaces_and_unicode_work() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Zoë Q Data");
    let meta = store_bytes(
        &root,
        GLOBAL_SCOPE,
        "notes.md",
        "text/markdown",
        b"# Notes",
        100,
    )
    .unwrap();
    assert_eq!(
        read_bytes(&root, GLOBAL_SCOPE, &meta.sha256).unwrap(),
        b"# Notes"
    );
    assert_eq!(
        read_meta(&root, GLOBAL_SCOPE, &meta.sha256)
            .unwrap()
            .unwrap()
            .name,
        "notes.md"
    );
}

#[test]
fn text_sidecars_record_pages_and_has_text() {
    let root = tempfile::tempdir().unwrap();
    let meta = store_bytes(root.path(), "p1", "a.pdf", "application/pdf", b"%PDF", 10).unwrap();
    assert!(!meta.has_text);
    let updated = store_text(root.path(), "p1", &meta.sha256, "page text", Some(12)).unwrap();
    assert!(updated.has_text);
    assert_eq!(updated.pages, Some(12));
    assert_eq!(
        read_text(root.path(), "p1", &meta.sha256)
            .unwrap()
            .as_deref(),
        Some("page text")
    );
    // A second put keeps what the text sidecar recorded.
    let again = store_bytes(
        root.path(),
        "p1",
        "renamed.pdf",
        "application/pdf",
        b"%PDF",
        10,
    )
    .unwrap();
    assert_eq!((again.pages, again.has_text), (Some(12), true));
    let huge = "x".repeat(MAX_ATTACHMENT_TEXT_BYTES + 1);
    let error = store_text(root.path(), "p1", &meta.sha256, &huge, None).unwrap_err();
    assert!(error.contains("attachments.invalid_request"), "{error}");
}

#[test]
fn reads_touch_the_lru_clock() {
    let root = tempfile::tempdir().unwrap();
    let meta = store_bytes(
        root.path(),
        "p1",
        "a.bin",
        "application/octet-stream",
        b"abc",
        10,
    )
    .unwrap();
    let blob = blob_path(root.path(), "p1", &meta.sha256);
    set_modified(&blob, 978_307_200);
    read_bytes(root.path(), "p1", &meta.sha256).unwrap();
    assert!(modified(&blob) > SystemTime::UNIX_EPOCH + Duration::from_secs(978_307_200));
}

#[test]
fn the_store_evicts_least_recently_used_blobs_beyond_the_cap() {
    let root = tempfile::tempdir().unwrap();
    let mut metas = Vec::new();
    for index in 0..4u8 {
        let bytes = vec![index; 1024];
        let meta = store_bytes(
            root.path(),
            "p1",
            "f.bin",
            "application/octet-stream",
            &bytes,
            4096,
        )
        .unwrap();
        store_text(root.path(), "p1", &meta.sha256, "t", None).unwrap();
        set_modified(
            &blob_path(root.path(), "p1", &meta.sha256),
            1_000 + u64::from(index),
        );
        metas.push(meta);
    }
    let newest = metas.last().unwrap().sha256.clone();
    let freed = enforce_store_cap(root.path(), 3 * 1024, ("p1", &newest)).unwrap();
    assert_eq!(freed, 1024);
    let oldest = &metas[0].sha256;
    assert!(!blob_path(root.path(), "p1", oldest).exists());
    assert!(!meta_path(root.path(), "p1", oldest).exists());
    assert!(!text_path(root.path(), "p1", oldest).exists());
    assert!(blob_path(root.path(), "p1", &newest).exists());
}

#[test]
fn gc_keeps_only_listed_hashes_and_reports_freed_bytes() {
    let root = tempfile::tempdir().unwrap();
    let keep = store_bytes(root.path(), "p1", "a", "text/plain", b"keep", 10).unwrap();
    store_bytes(root.path(), "p1", "b", "text/plain", b"drop-1", 10).unwrap();
    store_bytes(root.path(), "p1", "c", "text/plain", b"drop-22", 10).unwrap();
    let freed = gc_scope(root.path(), "p1", &[keep.sha256.to_ascii_uppercase()]).unwrap();
    assert_eq!(freed, 6 + 7);
    assert_eq!(
        blob_hashes(&scope_dir(root.path(), "p1")),
        vec![keep.sha256]
    );
}

#[test]
fn re_storing_a_blob_open_for_reading_succeeds() {
    let root = tempfile::tempdir().unwrap();
    let meta = store_bytes(
        root.path(),
        "p1",
        "a.bin",
        "application/octet-stream",
        b"held",
        10,
    )
    .unwrap();
    let _held = std::fs::File::open(blob_path(root.path(), "p1", &meta.sha256)).unwrap();
    assert!(store_bytes(
        root.path(),
        "p1",
        "a.bin",
        "application/octet-stream",
        b"held",
        10
    )
    .is_ok());
}

#[test]
fn locating_prefers_the_project_scope_then_global() {
    let root = tempfile::tempdir().unwrap();
    let meta = store_bytes(root.path(), GLOBAL_SCOPE, "a", "text/plain", b"x", 10).unwrap();
    assert_eq!(
        locate(root.path(), Some("p1"), &meta.sha256).as_deref(),
        Some("global")
    );
    store_bytes(root.path(), "p1", "a", "text/plain", b"x", 10).unwrap();
    assert_eq!(
        locate(root.path(), Some("p1"), &meta.sha256).as_deref(),
        Some("p1")
    );
    assert_eq!(locate(root.path(), Some("p1"), &"0".repeat(64)), None);
}

#[test]
fn removing_a_project_drops_its_attachment_folder() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let root = crate::paths::oleafly_root().unwrap();
    store_bytes(&root, "p1", "a", "text/plain", b"x", 10).unwrap();
    assert!(scope_dir(&root, "p1").is_dir());
    remove_project("p1").unwrap();
    assert!(!scope_dir(&root, "p1").exists());
    remove_project("p1").unwrap();
    assert!(remove_project("../p1").is_err());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}
