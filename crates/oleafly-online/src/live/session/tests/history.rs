use std::time::Duration;

use serde_json::json;

use super::super::DocStopReason;
use super::tree::{live_as, quick, TreePort};
use super::{eventually, project, Rig, Tab, FILES, NOTES};
use crate::live::rest::{DocAtVersion, SettingsUpdate};
use crate::live::DocId;
use crate::realtime::tree::{NodeKind, PathChange};

#[tokio::test]
async fn a_restore_with_a_gap_longer_than_a_replace_replaces_the_open_doc() {
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| {
        config.restore_gap = Duration::from_millis(2500);
        config.ranges_support = true;
    });
    let port = TreePort::new();
    for (path, text) in FILES {
        port.text(path, text);
    }
    let live = live_as(&rig, "alice", &port, quick()).await;
    let mut tab = Tab::open(&live, NOTES);
    eventually("notes is joined", || {
        rig.has_joined("alice", &rig.id(NOTES))
    })
    .await;
    tab.type_end(&live, " and more");
    assert!(live.settle(Duration::from_secs(10)).await);
    let old = tab.doc.clone();
    let sent = rig.mock.received("applyOtUpdate").len();
    let restored = live.revert_file(0, NOTES).await.unwrap();
    assert_eq!(restored.kind, NodeKind::Doc);
    let new = DocId(restored.id.0.clone());
    eventually("the new doc is live", || {
        live.text(&new).as_deref() == Some("Notes")
    })
    .await;
    let changes: Vec<PathChange> = port.seen().trees.iter().flatten().cloned().collect();
    assert!(
        changes.iter().any(|change| matches!(
            change,
            PathChange::Replaced { old: was, new: now, path, .. }
                if was.0 == old.0 && now.0 == new.0 && path == NOTES
        )),
        "{changes:?}"
    );
    assert!(
        !changes
            .iter()
            .any(|change| matches!(change, PathChange::Removed { path, .. } if path == NOTES)),
        "{changes:?}"
    );
    assert!(port
        .seen()
        .stopped
        .contains(&(old.clone(), DocStopReason::Removed)));
    assert_eq!(
        rig.mock.received("applyOtUpdate").len(),
        sent,
        "a restore sends no text of its own"
    );
    live.stop().await;
}

#[tokio::test]
async fn history_reads_and_settings_go_through_the_session() {
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| {
        config.versioning = false;
        config.image_names = vec![("texlive-full:2025.1".into(), "TeX Live 2025".into())];
    });
    let port = TreePort::new();
    for (path, text) in FILES {
        port.text(path, text);
    }
    let live = live_as(&rig, "alice", &port, quick()).await;
    let mut tab = Tab::open(&live, NOTES);
    eventually("notes is joined", || {
        rig.has_joined("alice", &rig.id(NOTES))
    })
    .await;
    tab.type_end(&live, "!");
    assert!(live.settle(Duration::from_secs(10)).await);
    let access = live.history_access();
    assert!(!access.full && !access.restricted);
    let page = live.history_page(None, 10).await.unwrap();
    assert_eq!(page.updates.len(), 1);
    assert_eq!(page.updates[0].paths, [NOTES]);
    assert_eq!(
        live.doc_at_version(1, NOTES).await.unwrap(),
        DocAtVersion::Text("Notes!".into())
    );
    let settings = live.project_settings();
    assert_eq!(settings.compiler.as_deref(), Some("pdflatex"));
    assert_eq!(settings.images[0].name, "texlive-full:2025.1");
    live.update_settings(&SettingsUpdate {
        image: Some("texlive-full:2025.1".into()),
        spelling: Some("de".into()),
        ..SettingsUpdate::default()
    })
    .await
    .unwrap();
    eventually("the echoes are applied", || {
        let settings = live.project_settings();
        settings.spelling.as_deref() == Some("de")
            && settings.image.as_deref() == Some("texlive-full:2025.1")
    })
    .await;
    let sent = &rig
        .mock
        .requests(&format!("/project/{}/settings", rig.mock.project_id()))[0];
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&sent.body).unwrap(),
        json!({ "imageName": "texlive-full:2025.1", "spellCheckLanguage": "de" })
    );
    live.stop().await;
}
