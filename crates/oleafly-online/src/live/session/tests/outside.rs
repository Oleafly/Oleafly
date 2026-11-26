use std::sync::{Arc, Mutex};

use oleafly_ot::{DocMessage, DocSink};
use serde_json::{json, Value};

use super::super::state::JoinKind;
use super::super::{LiveError, MergeReview, OutsideText, Overlap, Resolution, Seed, Seeded};
use super::{watcher, Watcher};
use crate::live::join::parse_join;
use crate::live::DocId;
use crate::realtime::events::PublicId;
use crate::realtime::project::{ProjectState, Role};

const DOC: &str = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PATH: &str = "a.tex";

fn one_doc() -> (Watcher, DocId) {
    (
        watcher(&[(DOC.to_string(), PATH.to_string())]),
        DocId(DOC.into()),
    )
}

fn join(state: &mut Watcher, doc: &DocId, text: &str) {
    let lines: Vec<&str> = text.split('\n').collect();
    let reply: [Value; 6] = [
        Value::Null,
        json!(lines),
        json!(3),
        json!([]),
        json!({}),
        json!("sharejs-text-ot"),
    ];
    state.joined(doc, JoinKind::Fresh, parse_join(doc, &reply));
}

fn seed(base: Option<&str>, local: &str) -> Seed {
    Seed {
        path: PATH.into(),
        doc: None,
        base: base.map(str::to_string),
        local: local.into(),
    }
}

fn reviews(state: &mut Watcher) -> Vec<(String, String)> {
    state.deliver();
    state
        .port
        .seen()
        .merged
        .iter()
        .filter_map(|(_, review)| match review {
            MergeReview::NeedsReview { mine, theirs } => Some((mine.clone(), theirs.clone())),
            _ => None,
        })
        .collect()
}

fn kept(state: &mut Watcher) -> Vec<String> {
    state.deliver();
    state
        .port
        .seen()
        .merged
        .iter()
        .filter_map(|(_, review)| match review {
            MergeReview::Kept { text } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn seeded(state: &mut Watcher) -> Vec<(String, Seeded)> {
    state.deliver();
    std::mem::take(&mut state.port.seen().seeded)
}

fn tab(state: &mut Watcher) -> Arc<Mutex<String>> {
    let shown = Arc::new(Mutex::new("Hello\n".to_string()));
    let sink: DocSink = {
        let shown = Arc::clone(&shown);
        Arc::new(move |message| {
            let mut shown = shown.lock().unwrap();
            match message {
                DocMessage::Remote { op, .. } => *shown = op.apply(&shown).unwrap(),
                DocMessage::Reset { text, .. } => *shown = text,
                _ => {}
            }
        })
    };
    state
        .open(PATH, sink, Some("Hello\n".into()))
        .expect("the doc opens");
    shown
}

#[test]
fn a_seed_waits_until_the_project_was_joined_before_it_counts_as_missing() {
    let (mut state, _) = one_doc();
    state.project = ProjectState::unjoined();
    state.forget_connection();
    state.seed(vec![seed(Some("Hello\n"), "Hello\nmine\n")]);
    assert_eq!(seeded(&mut state), []);
    state.connected(PublicId("P.joined".into()), 0);
    state.seed(Vec::new());
    assert_eq!(seeded(&mut state), [(PATH.to_string(), Seeded::NoDoc)]);
}

#[test]
fn a_seed_names_its_document_by_id_before_its_path() {
    let (mut state, doc) = one_doc();
    state.seed(vec![Seed {
        path: "moved here.tex".into(),
        doc: Some(doc.clone()),
        base: Some("Hello\n".into()),
        local: "Hello\nmine\n".into(),
    }]);
    assert_eq!(
        seeded(&mut state),
        [("moved here.tex".to_string(), Seeded::Taken)]
    );
    assert_eq!(state.text(&doc).as_deref(), Some("Hello\nmine\n"));
}

#[test]
fn a_seed_is_left_alone_for_people_who_cannot_edit_and_for_documents_already_loaded() {
    for role in [Role::Viewer, Role::Reviewer] {
        let (mut state, doc) = one_doc();
        state.project.role = role;
        state.seed(vec![seed(Some("Hello\n"), "Hello\nmine\n")]);
        assert_eq!(
            seeded(&mut state),
            [(PATH.to_string(), Seeded::Left)],
            "{role:?}"
        );
        assert_eq!(state.text(&doc), None, "{role:?}");
    }
    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "Theirs\n");
    state.seed(vec![seed(Some("Hello\n"), "Hello\nmine\n")]);
    assert_eq!(seeded(&mut state), [(PATH.to_string(), Seeded::Left)]);
    assert_eq!(state.text(&doc).as_deref(), Some("Theirs\n"));
}

#[test]
fn an_outside_edit_to_a_document_not_joined_yet_merges_when_it_joins() {
    let (mut state, doc) = one_doc();
    state
        .outside_edit(&doc, Some("Hello\n".into()), "Hello\nmine\n", Overlap::Hold)
        .unwrap();
    join(&mut state, &doc, "Theirs\nHello\n");
    assert_eq!(state.text(&doc).as_deref(), Some("Theirs\nHello\nmine\n"));
    assert_eq!(reviews(&mut state), []);
}

#[test]
fn an_overlapping_outside_edit_is_held_or_woven_as_asked() {
    let base = || Some("Hello\n".to_string());
    let (mut state, doc) = one_doc();
    let shown = tab(&mut state);
    join(&mut state, &doc, "Theirs\n");
    state
        .outside_edit(&doc, base(), "Mine\n", Overlap::Hold)
        .unwrap();
    assert_eq!(
        reviews(&mut state),
        [("Mine\n".to_string(), "Theirs\n".to_string())]
    );
    assert_eq!(state.text(&doc).as_deref(), Some("Mine\n"));
    assert_eq!(*shown.lock().unwrap(), "Mine\n");
    assert!(state.next_sends(std::time::Instant::now()).is_empty());
    assert_eq!(
        state.outside_edit(&doc, base(), "Mine again\n", Overlap::Hold),
        Err(LiveError::NotWritable)
    );
    state.resolve(&doc, Resolution::Theirs).unwrap();
    assert_eq!(state.text(&doc).as_deref(), Some("Theirs\n"));
    state.deliver();
    assert_eq!(*shown.lock().unwrap(), "Theirs\n");

    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "DUST\n");
    state
        .outside_edit(&doc, base(), "RAIN\n", Overlap::Weave)
        .unwrap();
    assert_eq!(reviews(&mut state), []);
    let woven = state.text(&doc).unwrap();
    assert!(
        woven.contains("RAIN") && woven.contains("DUST"),
        "{woven:?}"
    );
}

#[test]
fn an_outside_edit_with_no_base_never_replaces_the_online_text() {
    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "Theirs\n");
    state
        .outside_edit(&doc, None, "Mine\n", Overlap::Weave)
        .unwrap();
    assert_eq!(
        reviews(&mut state),
        [("Mine\n".to_string(), "Theirs\n".to_string())]
    );

    let (mut state, doc) = one_doc();
    state
        .outside_edit(&doc, None, "Mine\n", Overlap::Weave)
        .unwrap();
    join(&mut state, &doc, "Theirs\n");
    assert_eq!(
        reviews(&mut state),
        [("Mine\n".to_string(), "Theirs\n".to_string())]
    );

    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "Same\n");
    state
        .outside_edit(&doc, None, "Same\n", Overlap::Weave)
        .unwrap();
    assert_eq!(reviews(&mut state), []);
}

#[test]
fn a_held_outside_edit_is_held_again_after_a_restart() {
    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "Theirs\n");
    state
        .outside_edit(&doc, Some("Hello\n".into()), "Mine\n", Overlap::Hold)
        .unwrap();
    let batch = state
        .take_journal_batch(std::time::Instant::now(), true)
        .expect("the held text is journaled");
    let (_, record) = batch
        .docs
        .into_iter()
        .find(|(changed, _)| *changed == doc)
        .unwrap();
    let record = record.expect("a record");
    assert_eq!(
        (record.base_text.as_str(), record.local_text.as_str()),
        ("Hello\n", "Mine\n")
    );
    assert!(record.provisional);
}

#[test]
fn the_file_a_reload_is_about_to_replace_is_not_sent_again() {
    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "Theirs\n");
    state.send_refused(&doc, "update is too large");
    state.keep_and_reload(&doc, Some("Mine\n".into())).unwrap();
    state
        .outside_edit(&doc, Some("Hello\n".into()), "Mine\n", Overlap::Hold)
        .unwrap();
    join(&mut state, &doc, "Theirs\n");
    assert_eq!(state.text(&doc).as_deref(), Some("Theirs\n"));
    assert_eq!(reviews(&mut state), []);
}

#[test]
fn typing_not_sent_yet_is_kept_when_an_outside_edit_of_the_same_place_is_held() {
    let base = || Some("Hello\n".to_string());
    let (mut state, doc) = one_doc();
    join(&mut state, &doc, "Hello\n");
    state
        .outside_edit(&doc, base(), "Typed\n", Overlap::Weave)
        .unwrap();
    assert_eq!(kept(&mut state), Vec::<String>::new());
    state
        .outside_edit(&doc, base(), "Mine\n", Overlap::Hold)
        .unwrap();
    assert_eq!(kept(&mut state), ["Typed\n"]);
    assert_eq!(
        reviews(&mut state),
        [("Mine\n".to_string(), "Typed\n".to_string())]
    );
    join(&mut state, &doc, "Online\n");
    assert_eq!(state.text(&doc).as_deref(), Some("Mine\n"));
    assert_eq!(
        reviews(&mut state).last(),
        Some(&("Mine\n".to_string(), "Online\n".to_string()))
    );
}

#[test]
fn text_under_review_survives_a_fresh_join() {
    for base in [None, Some("Hello\n".to_string())] {
        let (mut state, doc) = one_doc();
        join(&mut state, &doc, "Theirs\n");
        state
            .outside_edit(&doc, base.clone(), "Mine\n", Overlap::Hold)
            .unwrap();
        join(&mut state, &doc, "Theirs again\n");
        assert_eq!(state.text(&doc).as_deref(), Some("Mine\n"), "{base:?}");
        let batch = state
            .take_journal_batch(std::time::Instant::now(), true)
            .unwrap();
        let record = batch.docs.into_iter().find(|(changed, _)| *changed == doc);
        assert_eq!(record.unwrap().1.unwrap().local_text, "Mine\n", "{base:?}");
        assert_eq!(kept(&mut state), Vec::<String>::new());
        state.resolve(&doc, Resolution::Theirs).unwrap();
        assert_eq!(state.text(&doc).as_deref(), Some("Theirs again\n"));
    }
}

#[test]
fn trying_a_stopped_document_again_never_undoes_edits_the_file_has_not_got_yet() {
    let outside = |base: Option<&str>, text: &str| {
        Some(OutsideText {
            base: base.map(str::to_string),
            text: text.to_string(),
        })
    };
    for (found, expected) in [
        (None, "Hello there\n"),
        (
            outside(Some("Hello\n"), "Hello\nMine\n"),
            "Hello there\nMine\n",
        ),
        (outside(None, "Mine\n"), "Mine\n"),
    ] {
        let (mut state, doc) = one_doc();
        join(&mut state, &doc, "Hello there\n");
        state.send_refused(&doc, "update is too large");
        state.retry(&doc, found).unwrap();
        assert_eq!(state.text(&doc).as_deref(), Some(expected));
    }
}
