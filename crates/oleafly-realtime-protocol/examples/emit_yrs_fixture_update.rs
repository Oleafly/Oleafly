use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Array, ArrayPrelim, ClientID, Doc, GetString, Map, MapPrelim, OffsetKind, Options, Out,
    ReadTxn, Text, Transact, Update,
};

const FIXTURE: &str = include_str!("../../../fixtures/realtime/authoring-doc-v1.json");
const MAIN_FILE_ID: &str = "0198cf35-0000-7000-8000-000000000002";
const BINARY_FILE_ID: &str = "0198cf35-0000-7000-8000-000000000005";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    yjs_update_v1_base64: String,
}

fn main() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("valid fixture JSON");
    let initial = STANDARD
        .decode(fixture.yjs_update_v1_base64)
        .expect("valid fixture base64");

    let options = Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::with_client_id(ClientID::new(202))
    };
    let doc = Doc::with_options(options);
    doc.transact_mut()
        .apply_update(Update::decode_v1(&initial).expect("Yjs update decodes"))
        .expect("Yjs update applies");
    let initial_state = doc.transact().state_vector();

    let metadata = doc.get_or_insert_map("authoring");
    let nodes = doc.get_or_insert_map("nodes");
    let texts = doc.get_or_insert_map("texts");
    let binary_heads = doc.get_or_insert_map("binary_heads");
    let mut txn = doc.transact_mut();
    metadata.insert(&mut txn, "schema_version", 1_i64);

    let main_text = match texts.get(&txn, MAIN_FILE_ID) {
        Some(Out::YText(text)) => text,
        _ => panic!("main file is not a Y.Text"),
    };
    let prefix = "\\documentclass{article}\n\\begin{document}\nHello 🌿";
    assert!(main_text.get_string(&txn).starts_with(prefix));
    main_text.insert(
        &mut txn,
        prefix.encode_utf16().count() as u32,
        " edited by yrs",
    );

    let binary = nodes.insert(&mut txn, BINARY_FILE_ID, MapPrelim::default());
    binary.insert(&mut txn, "parent_id", Any::Null);
    binary.insert(&mut txn, "name", "figure.png");
    binary.insert(&mut txn, "collision_key", "figure.png");
    binary.insert(&mut txn, "tombstone", false);
    binary.insert(&mut txn, "kind", "binary");
    let heads = binary_heads.insert(&mut txn, BINARY_FILE_ID, ArrayPrelim::default());
    heads.push_back(
        &mut txn,
        "sha256:08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48e6eae5f6db9f2e2b9f8cc",
    );
    drop(txn);

    let update = doc.transact().encode_diff_v1(&initial_state);
    println!("{}", STANDARD.encode(update));
}
