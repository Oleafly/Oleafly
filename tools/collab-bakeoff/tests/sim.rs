use collab_bakeoff::engine::Engine;
use collab_bakeoff::loro_engine::LoroEngine;
use collab_bakeoff::scenarios::{self, MAIN};
use collab_bakeoff::sim::{peer_id, resolve_edit, Refused, Server, Sim};
use collab_bakeoff::trace::{Cut, Op, DEFAULT_CAP};

fn insert(actor: usize, text: &str) -> Op {
    Op::Splice {
        actor,
        id: MAIN.to_owned(),
        pos: 0,
        delete: 0,
        insert: text.to_owned(),
    }
}

#[test]
fn peer_ids_differ_per_person_and_per_restart() {
    assert_eq!(peer_id(0, 0), 1_000);
    assert_eq!(peer_id(2, 3), 3_003);
}

#[test]
fn the_server_refuses_batches_over_the_cap() {
    let mut server = Server::new(vec![1, 2, 3], 4);
    assert_eq!(
        server.submit(1, vec![0; 5]),
        Err(Refused::TooLarge { size: 5, cap: 4 })
    );
    assert_eq!(server.submit(1, vec![0; 4]), Ok(0));
    assert_eq!(server.next_seq, 1);
}

#[test]
fn the_server_keeps_two_snapshots_and_prunes_before_the_older() {
    let mut server = Server::new(vec![0], DEFAULT_CAP);
    for seq in 0..3_u8 {
        server.submit(1, vec![seq]).expect("submit");
    }
    server.store_snapshot(2, vec![10]);
    assert!(server.since(0).is_ok());
    server.store_snapshot(3, vec![11]);
    assert_eq!(server.snapshots.len(), 2);
    assert!(server.since(1).is_err());
    assert_eq!(server.since(2).expect("retained").len(), 1);
    assert_eq!(
        server.newest_snapshot().map(|snapshot| snapshot.upto),
        Some(3)
    );
}

#[test]
fn the_server_corrupts_only_the_next_batch_of_the_chosen_person() {
    let mut server = Server::new(Vec::new(), DEFAULT_CAP);
    server.corrupt_next_from = Some(1);
    server.submit(2, b"abcd".to_vec()).expect("other person");
    server.submit(1, b"abcd".to_vec()).expect("chosen person");
    server.submit(1, b"abcd".to_vec()).expect("later batch");
    let stored: Vec<&[u8]> = server
        .log
        .iter()
        .map(|batch| batch.bytes.as_slice())
        .collect();
    assert_eq!(stored, vec![&b"abcd"[..], &b"abCd"[..], &b"abcd"[..]]);
}

#[test]
fn edits_resolve_to_valid_utf16_ranges() {
    assert_eq!(resolve_edit("Hello 🌿", 7, 5), (6, 2));
    assert_eq!(resolve_edit("Hello 🌿", 17, 3), (8, 0));
    assert_eq!(resolve_edit("Hello 🌿", 0, 7), (0, 6));
}

#[test]
fn replicas_converge_after_settling() {
    let scenario = scenarios::blank("converge", 3);
    let mut sim = Sim::<LoroEngine>::start(&scenario).expect("start");
    sim.apply(&insert(1, "one "));
    sim.apply(&insert(2, "two "));
    sim.settle();
    let texts: Vec<String> = sim
        .replicas
        .values()
        .map(|replica| replica.engine.text(MAIN).expect("text"))
        .collect();
    assert!(texts.iter().all(|text| text == &texts[0]), "{texts:?}");
    assert!(texts[0].contains("one ") && texts[0].contains("two "));
}

#[test]
fn a_torn_save_falls_back_and_resyncs() {
    let scenario = scenarios::blank("torn", 3);
    let mut sim = Sim::<LoroEngine>::start(&scenario).expect("start");
    sim.apply(&Op::Persist { actor: 1 });
    sim.apply(&insert(1, "kept "));
    sim.apply(&Op::Sync { actor: 1 });
    sim.apply(&Op::Crash {
        actor: 1,
        cut: Cut::Half,
        reuse_peer: false,
    });
    sim.apply(&Op::Sync { actor: 1 });
    let replica = sim.replicas.get(&1).expect("replica");
    assert_eq!(replica.incarnation, 1);
    assert!(replica.engine.text(MAIN).expect("text").contains("kept "));
}
