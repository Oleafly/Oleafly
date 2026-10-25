use loro::cursor::Side;
use loro::{Container, LoroDoc, LoroMap, LoroText, LoroValue, ValueOrContainer};

use crate::role_guard::SUGGESTIONS;

pub fn file_text(doc: &LoroDoc, file: &str) -> LoroText {
    doc.get_text(format!("text:{file}"))
}

fn record(doc: &LoroDoc, id: &str) -> LoroMap {
    doc.get_map(SUGGESTIONS)
        .insert_container(id, LoroMap::new())
        .expect("a record")
}

pub fn existing(doc: &LoroDoc, id: &str) -> LoroMap {
    match doc.get_map(SUGGESTIONS).get(id) {
        Some(ValueOrContainer::Container(Container::Map(map))) => map,
        _ => panic!("the suggestion {id} exists"),
    }
}

fn stamp(map: &LoroMap, file: &str, kind: &str, author: &str) {
    map.insert("file_id", file).expect("file");
    map.insert("kind", kind).expect("kind");
    map.insert("author", author).expect("author");
    map.insert("device", "device").expect("device");
    map.insert("created_at", 10_i64).expect("created at");
}

pub fn cursor_at(text: &LoroText, at: usize) -> Vec<u8> {
    let length = text.len_unicode();
    let cursor = if at < length {
        text.get_cursor(at, Side::Left)
    } else if length > 0 {
        text.get_cursor(length - 1, Side::Right)
    } else {
        text.get_cursor(0, Side::Left)
    };
    cursor.expect("a cursor").encode()
}

pub fn set_range(doc: &LoroDoc, id: &str, file: &str, from: usize, to: usize) {
    let text = file_text(doc, file);
    let map = existing(doc, id);
    let start = text.get_cursor(from, Side::Left).expect("start");
    let end = text.get_cursor(to - 1, Side::Right).expect("end");
    map.insert("start", LoroValue::from(start.encode()))
        .expect("start");
    map.insert("end", LoroValue::from(end.encode()))
        .expect("end");
}

pub fn suggest_insert(
    doc: &LoroDoc,
    id: &str,
    file: &str,
    at: usize,
    inserted: &str,
    author: &str,
) {
    let text = file_text(doc, file);
    text.insert(at, inserted).expect("insert");
    let map = record(doc, id);
    stamp(&map, file, "insert", author);
    set_range(doc, id, file, at, at + inserted.chars().count());
}

pub fn suggest_delete(doc: &LoroDoc, id: &str, file: &str, from: usize, to: usize, author: &str) {
    let text = file_text(doc, file);
    let deleted = text.slice(from, to).expect("slice");
    text.delete(from, to - from).expect("delete");
    let map = record(doc, id);
    stamp(&map, file, "delete", author);
    map.insert("anchor", LoroValue::from(cursor_at(&text, from)))
        .expect("anchor");
    map.insert("text", deleted).expect("text");
}

pub fn remove_suggestion(doc: &LoroDoc, id: &str) {
    doc.get_map(SUGGESTIONS).delete(id).expect("remove");
}
