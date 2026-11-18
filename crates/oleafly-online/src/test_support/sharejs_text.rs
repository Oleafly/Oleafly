// ShareJS client v0.5.0
// https://github.com/josephg/ShareJS
//
// Copyright (c) 2011-2014 Joseph Gentle
// Licensed under the MIT License
// SPDX-License-Identifier: MIT

use serde_json::{json, Map, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Component {
    Insert {
        p: usize,
        i: Vec<u16>,
    },
    Delete {
        p: usize,
        d: Vec<u16>,
    },
    Comment {
        p: usize,
        c: Vec<u16>,
        t: Option<Value>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OracleError(pub String);

impl std::fmt::Display for OracleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for OracleError {}

pub type Op = Vec<Component>;

pub fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub fn text(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn slice(source: &[u16], from: usize, to: usize) -> Vec<u16> {
    let end = to.min(source.len());
    let start = from.min(end);
    source[start..end].to_vec()
}

fn tail(source: &[u16], from: usize) -> Vec<u16> {
    slice(source, from, source.len())
}

fn inject(target: &[u16], at: usize, inserted: &[u16]) -> Vec<u16> {
    let at = at.min(target.len());
    let mut joined = Vec::with_capacity(target.len() + inserted.len());
    joined.extend_from_slice(&target[..at]);
    joined.extend_from_slice(inserted);
    joined.extend_from_slice(&target[at..]);
    joined
}

impl Component {
    pub fn insert(p: usize, inserted: &str) -> Self {
        Component::Insert {
            p,
            i: units(inserted),
        }
    }

    pub fn delete(p: usize, deleted: &str) -> Self {
        Component::Delete {
            p,
            d: units(deleted),
        }
    }

    pub fn comment(p: usize, commented: &str, thread: Option<Value>) -> Self {
        Component::Comment {
            p,
            c: units(commented),
            t: thread,
        }
    }

    pub fn p(&self) -> usize {
        match self {
            Component::Insert { p, .. }
            | Component::Delete { p, .. }
            | Component::Comment { p, .. } => *p,
        }
    }

    pub fn from_json(value: &Value) -> Result<Self, OracleError> {
        let object = value
            .as_object()
            .ok_or_else(|| OracleError("component is not an object".into()))?;
        let p = object
            .get("p")
            .and_then(Value::as_u64)
            .ok_or_else(|| OracleError("component missing position field".into()))?
            as usize;
        let field = |name: &str| object.get(name).and_then(Value::as_str).map(units);
        match (field("i"), field("d"), field("c")) {
            (Some(i), None, None) => Ok(Component::Insert { p, i }),
            (None, Some(d), None) => Ok(Component::Delete { p, d }),
            (None, None, Some(c)) => Ok(Component::Comment {
                p,
                c,
                t: object.get("t").cloned(),
            }),
            _ => Err(OracleError("component needs an i, d or c field".into())),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Component::Insert { p, i } => json!({ "p": p, "i": text(i) }),
            Component::Delete { p, d } => json!({ "p": p, "d": text(d) }),
            Component::Comment { p, c, t } => {
                let mut object = Map::new();
                object.insert("p".into(), json!(p));
                object.insert("c".into(), json!(text(c)));
                if let Some(thread) = t {
                    object.insert("t".into(), thread.clone());
                }
                Value::Object(object)
            }
        }
    }
}

pub fn op_from_json(value: &Value) -> Result<Op, OracleError> {
    value
        .as_array()
        .ok_or_else(|| OracleError("op is not an array".into()))?
        .iter()
        .map(Component::from_json)
        .collect()
}

pub fn op_to_json(op: &[Component]) -> Value {
    Value::Array(op.iter().map(Component::to_json).collect())
}

pub fn apply_units(snapshot: &mut Vec<u16>, op: &[Component]) -> Result<(), OracleError> {
    for component in op {
        match component {
            Component::Insert { p, i } => {
                *snapshot = inject(snapshot, *p, i);
            }
            Component::Delete { p, d } => {
                let deleted = slice(snapshot, *p, p + d.len());
                if &deleted != d {
                    return Err(OracleError(format!(
                        "Delete component '{}' does not match deleted text '{}'",
                        text(d),
                        text(&deleted)
                    )));
                }
                let mut rest = slice(snapshot, 0, *p);
                rest.extend(tail(snapshot, p + d.len()));
                *snapshot = rest;
            }
            Component::Comment { p, c, .. } => {
                let commented = slice(snapshot, *p, p + c.len());
                if &commented != c {
                    return Err(OracleError(format!(
                        "Comment component '{}' does not match commented text '{}'",
                        text(c),
                        text(&commented)
                    )));
                }
            }
        }
    }
    Ok(())
}

pub fn apply(snapshot: &str, op: &[Component]) -> Result<String, OracleError> {
    let mut working = units(snapshot);
    apply_units(&mut working, op)?;
    Ok(text(&working))
}

pub fn append(new_op: &mut Op, component: Component) {
    match &component {
        Component::Insert { i, .. } if i.is_empty() => return,
        Component::Delete { d, .. } if d.is_empty() => return,
        _ => {}
    }
    let Some(last) = new_op.last_mut() else {
        new_op.push(component);
        return;
    };
    match (&*last, &component) {
        (
            Component::Insert {
                p: last_p,
                i: last_i,
            },
            Component::Insert { p, i },
        ) if last_p <= p && *p <= last_p + last_i.len() => {
            *last = Component::Insert {
                i: inject(last_i, p - last_p, i),
                p: *last_p,
            };
        }
        (
            Component::Delete {
                p: last_p,
                d: last_d,
            },
            Component::Delete { p, d },
        ) if p <= last_p && *last_p <= p + d.len() => {
            *last = Component::Delete {
                d: inject(d, last_p - p, last_d),
                p: *p,
            };
        }
        _ => new_op.push(component),
    }
}

pub fn compose(op1: &[Component], op2: &[Component]) -> Op {
    let mut new_op = op1.to_vec();
    for component in op2 {
        append(&mut new_op, component.clone());
    }
    new_op
}

fn transform_position(position: usize, component: &Component, insert_after: bool) -> usize {
    match component {
        Component::Insert { p, i } => {
            if *p < position || (*p == position && insert_after) {
                position + i.len()
            } else {
                position
            }
        }
        Component::Delete { p, d } => {
            if position <= *p {
                position
            } else if position <= p + d.len() {
                *p
            } else {
                position - d.len()
            }
        }
        Component::Comment { .. } => position,
    }
}

pub fn transform_cursor(mut position: usize, op: &[Component], side: Side) -> usize {
    for component in op {
        position = transform_position(position, component, side == Side::Right);
    }
    position
}

fn overlap_check(
    mine: &[u16],
    mine_at: usize,
    theirs: &[u16],
    theirs_at: usize,
) -> Result<(), OracleError> {
    let start = mine_at.max(theirs_at);
    let end = (mine_at + mine.len()).min(theirs_at + theirs.len());
    let mine_part = slice(mine, start - mine_at, end - mine_at);
    let their_part = slice(theirs, start - theirs_at, end - theirs_at);
    if mine_part != their_part {
        return Err(OracleError(
            "Delete ops delete different text in the same region of the document".into(),
        ));
    }
    Ok(())
}

pub fn transform_component(
    dest: &mut Op,
    component: &Component,
    other: &Component,
    side: Side,
) -> Result<(), OracleError> {
    match component {
        Component::Insert { p, i } => {
            append(
                dest,
                Component::Insert {
                    i: i.clone(),
                    p: transform_position(*p, other, side == Side::Right),
                },
            );
            Ok(())
        }
        Component::Delete { p, d } => transform_delete(dest, component, *p, d, other),
        Component::Comment { p, c, t } => transform_comment(dest, component, (*p, c, t), other),
    }
}

fn kept_outside(text: &[u16], p: usize, other_p: usize, other_d: &[u16]) -> Vec<u16> {
    let mut kept = Vec::new();
    if p < other_p {
        kept = slice(text, 0, other_p - p);
    }
    if p + text.len() > other_p + other_d.len() {
        kept.extend(tail(text, other_p + other_d.len() - p));
    }
    kept
}

fn transform_delete(
    dest: &mut Op,
    component: &Component,
    p: usize,
    d: &[u16],
    other: &Component,
) -> Result<(), OracleError> {
    match other {
        Component::Insert {
            p: other_p,
            i: other_i,
        } => {
            let mut rest = d.to_vec();
            if p < *other_p {
                append(
                    dest,
                    Component::Delete {
                        d: slice(&rest, 0, other_p - p),
                        p,
                    },
                );
                rest = tail(&rest, other_p - p);
            }
            if !rest.is_empty() {
                append(
                    dest,
                    Component::Delete {
                        d: rest,
                        p: p + other_i.len(),
                    },
                );
            }
        }
        Component::Delete {
            p: other_p,
            d: other_d,
        } => {
            if p >= other_p + other_d.len() {
                append(
                    dest,
                    Component::Delete {
                        d: d.to_vec(),
                        p: p - other_d.len(),
                    },
                );
            } else if p + d.len() <= *other_p {
                append(dest, component.clone());
            } else {
                let kept = kept_outside(d, p, *other_p, other_d);
                overlap_check(d, p, other_d, *other_p)?;
                if !kept.is_empty() {
                    append(
                        dest,
                        Component::Delete {
                            p: transform_position(p, other, false),
                            d: kept,
                        },
                    );
                }
            }
        }
        Component::Comment { .. } => append(dest, component.clone()),
    }
    Ok(())
}

fn transform_comment(
    dest: &mut Op,
    component: &Component,
    (p, c, t): (usize, &[u16], &Option<Value>),
    other: &Component,
) -> Result<(), OracleError> {
    match other {
        Component::Insert {
            p: other_p,
            i: other_i,
        } => {
            if p < *other_p && *other_p < p + c.len() {
                let offset = other_p - p;
                let mut widened = slice(c, 0, offset);
                widened.extend_from_slice(other_i);
                widened.extend(tail(c, offset));
                append(
                    dest,
                    Component::Comment {
                        c: widened,
                        p,
                        t: t.clone(),
                    },
                );
            } else {
                append(
                    dest,
                    Component::Comment {
                        c: c.to_vec(),
                        p: transform_position(p, other, true),
                        t: t.clone(),
                    },
                );
            }
        }
        Component::Delete {
            p: other_p,
            d: other_d,
        } => {
            if p >= other_p + other_d.len() {
                append(
                    dest,
                    Component::Comment {
                        c: c.to_vec(),
                        p: p - other_d.len(),
                        t: t.clone(),
                    },
                );
            } else if p + c.len() <= *other_p {
                append(dest, component.clone());
            } else {
                let kept = kept_outside(c, p, *other_p, other_d);
                overlap_check(c, p, other_d, *other_p)?;
                append(
                    dest,
                    Component::Comment {
                        c: kept,
                        p: transform_position(p, other, false),
                        t: t.clone(),
                    },
                );
            }
        }
        Component::Comment { .. } => append(dest, component.clone()),
    }
    Ok(())
}

fn transform_component_x(
    left: &Component,
    right: &Component,
    dest_left: &mut Op,
    dest_right: &mut Op,
) -> Result<(), OracleError> {
    transform_component(dest_left, left, right, Side::Left)?;
    transform_component(dest_right, right, left, Side::Right)
}

pub fn transform_x(left_op: &[Component], right_op: &[Component]) -> Result<(Op, Op), OracleError> {
    let mut left_op = left_op.to_vec();
    let mut new_right_op = Vec::new();
    for component in right_op {
        let mut right_component = Some(component.clone());
        let mut new_left_op = Vec::new();
        let mut k = 0;
        while k < left_op.len() {
            let Some(current) = right_component.clone() else {
                break;
            };
            let mut next = Vec::new();
            transform_component_x(&left_op[k], &current, &mut new_left_op, &mut next)?;
            k += 1;
            if next.len() == 1 {
                right_component = next.pop();
            } else if next.is_empty() {
                for rest in &left_op[k..] {
                    append(&mut new_left_op, rest.clone());
                }
                right_component = None;
                break;
            } else {
                let (left_rest, right_rest) = transform_x(&left_op[k..], &next)?;
                for rest in left_rest {
                    append(&mut new_left_op, rest);
                }
                for rest in right_rest {
                    append(&mut new_right_op, rest);
                }
                right_component = None;
                break;
            }
        }
        if let Some(rest) = right_component {
            append(&mut new_right_op, rest);
        }
        left_op = new_left_op;
    }
    Ok((left_op, new_right_op))
}

pub fn transform(op: &[Component], other: &[Component], side: Side) -> Result<Op, OracleError> {
    if other.is_empty() {
        return Ok(op.to_vec());
    }
    if op.len() == 1 && other.len() == 1 {
        let mut dest = Vec::new();
        transform_component(&mut dest, &op[0], &other[0], side)?;
        return Ok(dest);
    }
    match side {
        Side::Left => Ok(transform_x(op, other)?.0),
        Side::Right => Ok(transform_x(other, op)?.1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{Rng, SeedableRng};

    #[test]
    fn inserts_at_the_same_spot_put_the_left_side_first() {
        let left = vec![Component::insert(3, "L")];
        let right = vec![Component::insert(3, "R")];
        assert_eq!(
            transform(&left, &right, Side::Left).unwrap(),
            vec![Component::insert(3, "L")]
        );
        assert_eq!(
            transform(&right, &left, Side::Right).unwrap(),
            vec![Component::insert(4, "R")]
        );
    }

    #[test]
    fn overlapping_deletes_remove_the_shared_text_once() {
        let base = "abcdefgh";
        let first = vec![Component::delete(2, "cde")];
        let second = vec![Component::delete(3, "defg")];
        let second_after = transform(&second, &first, Side::Right).unwrap();
        let first_after = transform(&first, &second, Side::Left).unwrap();
        let one = apply(&apply(base, &first).unwrap(), &second_after).unwrap();
        let two = apply(&apply(base, &second).unwrap(), &first_after).unwrap();
        assert_eq!(one, "abh");
        assert_eq!(one, two);
    }

    #[test]
    fn a_delete_that_does_not_match_the_text_is_refused() {
        let error = apply("hello", &[Component::delete(1, "x")]).unwrap_err();
        assert!(error.0.contains("does not match"));
    }

    #[test]
    fn compose_joins_adjacent_inserts() {
        let composed = compose(&[Component::insert(0, "ab")], &[Component::insert(2, "cd")]);
        assert_eq!(composed, vec![Component::insert(0, "abcd")]);
    }

    #[test]
    fn positions_count_utf16_units() {
        let op = op_from_json(&json!([{ "p": 2, "i": "x" }])).unwrap();
        assert_eq!(apply("\u{1F600}y", &op).unwrap(), "\u{1F600}xy");
    }

    #[test]
    fn json_round_trips_every_kind() {
        let op = json!([{ "p": 0, "i": "a" }, { "p": 1, "d": "b" }, { "p": 0, "c": "a", "t": "thread" }]);
        assert_eq!(op_to_json(&op_from_json(&op).unwrap()), op);
    }

    fn random_op(rng: &mut rand::rngs::StdRng, doc: &[u16]) -> Op {
        let mut working = doc.to_vec();
        let mut op = Vec::new();
        for _ in 0..rng.gen_range(1..4) {
            if working.is_empty() || rng.gen_bool(0.5) {
                let at = rng.gen_range(0..=working.len());
                let inserted: String = (0..rng.gen_range(1..4))
                    .map(|_| char::from(b'a' + rng.gen_range(0..5)))
                    .collect();
                let component = Component::insert(at, &inserted);
                apply_units(&mut working, std::slice::from_ref(&component)).unwrap();
                append(&mut op, component);
            } else {
                let at = rng.gen_range(0..working.len());
                let end = rng.gen_range(at + 1..=working.len().min(at + 4));
                let component = Component::Delete {
                    p: at,
                    d: working[at..end].to_vec(),
                };
                apply_units(&mut working, std::slice::from_ref(&component)).unwrap();
                append(&mut op, component);
            }
        }
        op
    }

    #[test]
    fn random_concurrent_ops_converge_either_way_round() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(458);
        for _ in 0..2000 {
            let doc: Vec<u16> = (0..rng.gen_range(0..12))
                .map(|_| u16::from(b'k' + rng.gen_range(0..5)))
                .collect();
            let left = random_op(&mut rng, &doc);
            let right = random_op(&mut rng, &doc);
            let (left_after, right_after) = transform_x(&left, &right).unwrap();
            let mut one = doc.clone();
            apply_units(&mut one, &left).unwrap();
            apply_units(&mut one, &right_after).unwrap();
            let mut two = doc.clone();
            apply_units(&mut two, &right).unwrap();
            apply_units(&mut two, &left_after).unwrap();
            assert_eq!(
                text(&one),
                text(&two),
                "left {left:?} right {right:?} on {}",
                text(&doc)
            );
            assert_eq!(transform(&left, &right, Side::Left).unwrap(), left_after);
            assert_eq!(transform(&right, &left, Side::Right).unwrap(), right_after);
        }
    }
}
