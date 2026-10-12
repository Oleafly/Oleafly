use std::collections::BTreeMap;

use collab_bakeoff::engine::{Engine, EngineError, NewNode, NodeKind};

fn text_node<'a>(
    id: &'a str,
    parent: Option<&'a str>,
    name: &'a str,
    text: &'a str,
) -> NewNode<'a> {
    NewNode {
        id,
        parent,
        name,
        kind: NodeKind::Text,
        blob_hash: None,
        text,
    }
}

fn dir_node<'a>(id: &'a str, parent: Option<&'a str>, name: &'a str) -> NewNode<'a> {
    NewNode {
        id,
        parent,
        name,
        kind: NodeKind::Dir,
        blob_hash: None,
        text: "",
    }
}

fn blob_node<'a>(
    id: &'a str,
    parent: Option<&'a str>,
    name: &'a str,
    hash: &'a str,
) -> NewNode<'a> {
    NewNode {
        id,
        parent,
        name,
        kind: NodeKind::Blob,
        blob_hash: Some(hash),
        text: "",
    }
}

fn project<E: Engine>(peer: u64) -> E {
    let mut engine = E::new(peer).expect("new");
    engine
        .create_node(&dir_node("d-sec", None, "sections"))
        .expect("dir");
    engine
        .create_node(&text_node("f-main", None, "main.tex", "Hello 🌿 world"))
        .expect("main");
    engine
        .create_node(&text_node("f-intro", Some("d-sec"), "intro.tex", "Intro"))
        .expect("intro");
    engine
        .create_node(&blob_node("b-fig", None, "fig.png", "h1"))
        .expect("figure");
    engine
}

fn files(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
        .collect()
}

fn creates_and_materializes<E: Engine>() {
    let engine = project::<E>(1);
    let view = engine.materialize().expect("materialize");
    assert_eq!(
        view.files,
        files(&[
            ("main.tex", "Hello 🌿 world"),
            ("sections/intro.tex", "Intro"),
            ("fig.png", "blob:h1")
        ])
    );
    assert!(view.dirs.contains("sections"));
    assert!(view.trash.is_empty());
    assert_eq!(view.repaired, 0);
}

fn splices_in_utf16_units<E: Engine>() {
    let mut engine = project::<E>(1);
    engine
        .splice_utf16("f-main", 8, 0, "!")
        .expect("insert after the emoji");
    assert_eq!(engine.text("f-main").expect("text"), "Hello 🌿! world");
    engine
        .splice_utf16("f-main", 6, 2, "🌱")
        .expect("replace the emoji");
    assert_eq!(engine.text("f-main").expect("text"), "Hello 🌱! world");
    let error = engine
        .splice_utf16("f-main", 15, 1, "x")
        .expect_err("past the end");
    assert!(matches!(error, EngineError::OutOfRange { .. }), "{error:?}");
}

fn renames_moves_trashes_and_restores<E: Engine>() {
    let mut engine = project::<E>(1);
    engine.rename("f-main", "paper.tex").expect("rename");
    engine.move_node("f-intro", None).expect("move to the root");
    engine.trash("b-fig").expect("trash the figure");
    let view = engine.materialize().expect("materialize");
    assert_eq!(
        view.files,
        files(&[("paper.tex", "Hello 🌿 world"), ("intro.tex", "Intro")])
    );
    engine.trash("f-intro").expect("trash the text");
    let view = engine.materialize().expect("materialize");
    assert_eq!(view.trash.get("f-intro").map(String::as_str), Some("Intro"));
    engine
        .restore("f-intro", Some("d-sec"))
        .expect("restore the text");
    engine.restore("b-fig", None).expect("restore the figure");
    let view = engine.materialize().expect("materialize");
    assert_eq!(
        view.files,
        files(&[
            ("paper.tex", "Hello 🌿 world"),
            ("sections/intro.tex", "Intro"),
            ("fig.png", "blob:h1")
        ])
    );
    assert!(view.trash.is_empty());
}

fn rejects_unknown_nodes_and_cycles<E: Engine>() {
    let mut engine = project::<E>(1);
    engine
        .create_node(&dir_node("d-inner", Some("d-sec"), "inner"))
        .expect("inner dir");
    assert!(matches!(
        engine.rename("nope", "x"),
        Err(EngineError::UnknownNode(_))
    ));
    assert!(engine.move_node("d-sec", Some("d-inner")).is_err());
    assert!(engine
        .create_node(&text_node("f-main", None, "again.tex", ""))
        .is_err());
}

fn round_trips_through_save_and_load<E: Engine>() {
    let mut engine = project::<E>(1);
    engine
        .splice_utf16("f-main", 0, 0, "% saved\n")
        .expect("edit");
    engine.trash("b-fig").expect("trash");
    let bytes = engine.save().expect("save");
    let loaded = E::load(&bytes, 2).expect("load");
    assert_eq!(
        loaded.materialize().expect("loaded view"),
        engine.materialize().expect("view")
    );
}

fn exports_and_imports_updates_since_a_version<E: Engine>() {
    let mut author = project::<E>(1);
    let mut reader = E::load(&author.snapshot().expect("snapshot"), 2).expect("join");
    let before = author.version();
    author
        .splice_utf16("f-main", 0, 0, "% one\n")
        .expect("edit");
    author.rename("f-intro", "start.tex").expect("rename");
    let update = author.export_since(&before).expect("export");
    reader.import(&update).expect("import");
    assert_eq!(
        reader.materialize().expect("reader"),
        author.materialize().expect("author")
    );
    reader.import(&update).expect("import twice");
    assert_eq!(
        reader.materialize().expect("reader"),
        author.materialize().expect("author")
    );
}

fn merges_concurrent_edits<E: Engine>() {
    let mut left = project::<E>(1);
    let mut right = E::load(&left.snapshot().expect("snapshot"), 2).expect("join");
    let left_base = left.version();
    let right_base = right.version();
    left.splice_utf16("f-main", 0, 0, "L").expect("left");
    right.splice_utf16("f-main", 14, 0, "R").expect("right");
    let from_left = left.export_since(&left_base).expect("left export");
    let from_right = right.export_since(&right_base).expect("right export");
    left.import(&from_right).expect("left import");
    right.import(&from_left).expect("right import");
    assert_eq!(left.text("f-main").expect("left"), "LHello 🌿 worldR");
    assert_eq!(
        left.materialize().expect("left"),
        right.materialize().expect("right")
    );
}

fn compacts_and_joins_from_the_compaction<E: Engine>() {
    let mut engine = project::<E>(1);
    for round in 0..20 {
        engine
            .splice_utf16("f-intro", 0, 0, &format!("{round} "))
            .expect("edit");
    }
    let compacted = engine.compact().expect("compact");
    let joined = E::load(&compacted, 3).expect("join");
    assert_eq!(
        joined.materialize().expect("joined"),
        engine.materialize().expect("engine")
    );
}

macro_rules! conformance_suite {
    ($module:ident, $engine:ty) => {
        mod $module {
            #[test]
            fn creates_and_materializes() {
                super::creates_and_materializes::<$engine>();
            }

            #[test]
            fn splices_in_utf16_units() {
                super::splices_in_utf16_units::<$engine>();
            }

            #[test]
            fn renames_moves_trashes_and_restores() {
                super::renames_moves_trashes_and_restores::<$engine>();
            }

            #[test]
            fn rejects_unknown_nodes_and_cycles() {
                super::rejects_unknown_nodes_and_cycles::<$engine>();
            }

            #[test]
            fn round_trips_through_save_and_load() {
                super::round_trips_through_save_and_load::<$engine>();
            }

            #[test]
            fn exports_and_imports_updates_since_a_version() {
                super::exports_and_imports_updates_since_a_version::<$engine>();
            }

            #[test]
            fn merges_concurrent_edits() {
                super::merges_concurrent_edits::<$engine>();
            }

            #[test]
            fn compacts_and_joins_from_the_compaction() {
                super::compacts_and_joins_from_the_compaction::<$engine>();
            }
        }
    };
}

conformance_suite!(loro_suite, collab_bakeoff::loro_engine::LoroEngine);
conformance_suite!(yrs_suite, collab_bakeoff::yrs_engine::YrsEngine);
conformance_suite!(
    automerge_suite,
    collab_bakeoff::automerge_engine::AutomergeEngine
);
