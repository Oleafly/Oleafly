// ot.js TextOperation
// https://github.com/Operational-Transformation/ot.js
//
// Copyright (c) 2012-2014 Tim Baumann, http://timbaumann.info
// Licensed under the MIT License
// SPDX-License-Identifier: MIT

use serde_json::{json, Map, Value};

use super::sharejs_text::{text, units, OracleError};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Marks {
    pub tracking: Option<Value>,
    pub comment_ids: Option<Value>,
}

impl Marks {
    fn is_plain(&self) -> bool {
        self.tracking.is_none() && self.comment_ids.is_none()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    Retain { n: usize, marks: Marks },
    Insert { text: Vec<u16>, marks: Marks },
    Delete { n: usize },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextOperation {
    pub parts: Vec<Part>,
    pub base_length: usize,
    pub target_length: usize,
}

fn fail(message: &str) -> OracleError {
    OracleError(message.to_string())
}

impl TextOperation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn retain_marked(&mut self, n: usize, marks: Marks) -> &mut Self {
        if n == 0 {
            return self;
        }
        self.base_length += n;
        self.target_length += n;
        if let Some(Part::Retain {
            n: last,
            marks: last_marks,
        }) = self.parts.last_mut()
        {
            if *last_marks == marks {
                *last += n;
                return self;
            }
        }
        self.parts.push(Part::Retain { n, marks });
        self
    }

    pub fn retain(&mut self, n: usize) -> &mut Self {
        self.retain_marked(n, Marks::default())
    }

    pub fn insert_marked(&mut self, inserted: Vec<u16>, marks: Marks) -> &mut Self {
        if inserted.is_empty() {
            return self;
        }
        self.target_length += inserted.len();
        let count = self.parts.len();
        match self.parts.last_mut() {
            Some(Part::Insert {
                text: last,
                marks: last_marks,
            }) if *last_marks == marks => {
                last.extend(inserted);
            }
            Some(Part::Delete { .. }) => {
                if let Some(Part::Insert {
                    text: before,
                    marks: before_marks,
                }) = count.checked_sub(2).and_then(|at| self.parts.get_mut(at))
                {
                    if *before_marks == marks {
                        before.extend(inserted);
                        return self;
                    }
                }
                let delete = self.parts.pop().unwrap_or(Part::Delete { n: 0 });
                self.parts.push(Part::Insert {
                    text: inserted,
                    marks,
                });
                self.parts.push(delete);
            }
            _ => self.parts.push(Part::Insert {
                text: inserted,
                marks,
            }),
        }
        self
    }

    pub fn insert(&mut self, inserted: &str) -> &mut Self {
        self.insert_marked(units(inserted), Marks::default())
    }

    pub fn delete(&mut self, n: usize) -> &mut Self {
        if n == 0 {
            return self;
        }
        self.base_length += n;
        if let Some(Part::Delete { n: last }) = self.parts.last_mut() {
            *last += n;
            return self;
        }
        self.parts.push(Part::Delete { n });
        self
    }

    pub fn is_noop(&self) -> bool {
        self.parts
            .iter()
            .all(|part| matches!(part, Part::Retain { marks, .. } if marks.is_plain()))
    }

    pub fn from_json(value: &Value) -> Result<Self, OracleError> {
        let mut operation = TextOperation::new();
        for part in value
            .as_array()
            .ok_or_else(|| fail("a text operation is an array"))?
        {
            match part {
                Value::Number(number) => {
                    let n = number
                        .as_i64()
                        .ok_or_else(|| fail("a retain or delete is an integer"))?;
                    if n > 0 {
                        operation.retain(n as usize);
                    } else if n < 0 {
                        operation.delete(n.unsigned_abs() as usize);
                    } else {
                        return Err(fail("a zero-length part"));
                    }
                }
                Value::String(inserted) => {
                    operation.insert(inserted);
                }
                Value::Object(object) => {
                    let marks = Marks {
                        tracking: object.get("tracking").cloned(),
                        comment_ids: object.get("commentIds").cloned(),
                    };
                    if let Some(n) = object.get("r").and_then(Value::as_u64) {
                        operation.retain_marked(n as usize, marks);
                    } else if let Some(inserted) = object.get("i").and_then(Value::as_str) {
                        operation.insert_marked(units(inserted), marks);
                    } else {
                        return Err(fail("an object part needs r or i"));
                    }
                }
                _ => return Err(fail("unknown text operation part")),
            }
        }
        Ok(operation)
    }

    pub fn to_json(&self) -> Value {
        let marked = |key: &str, value: Value, marks: &Marks| {
            let mut object = Map::new();
            object.insert(key.to_string(), value);
            if let Some(tracking) = &marks.tracking {
                object.insert("tracking".into(), tracking.clone());
            }
            if let Some(ids) = &marks.comment_ids {
                object.insert("commentIds".into(), ids.clone());
            }
            Value::Object(object)
        };
        Value::Array(
            self.parts
                .iter()
                .map(|part| match part {
                    Part::Retain { n, marks } if marks.is_plain() => json!(n),
                    Part::Retain { n, marks } => marked("r", json!(n), marks),
                    Part::Insert {
                        text: inserted,
                        marks,
                    } if marks.is_plain() => json!(text(inserted)),
                    Part::Insert {
                        text: inserted,
                        marks,
                    } => marked("i", json!(text(inserted)), marks),
                    Part::Delete { n } => json!(-(*n as i64)),
                })
                .collect(),
        )
    }

    pub fn apply(
        &self,
        content: &[u16],
        tracked: &[Option<Value>],
    ) -> Result<(Vec<u16>, Vec<Option<Value>>), OracleError> {
        if content.len() != self.base_length {
            return Err(fail(
                "The operation's base length must be equal to the string's length.",
            ));
        }
        let mut out = Vec::with_capacity(self.target_length);
        let mut out_tracked = Vec::with_capacity(self.target_length);
        let mut at = 0;
        let resolve = |tracking: &Option<Value>| match tracking {
            Some(value) if value.get("type").and_then(Value::as_str) == Some("none") => None,
            other => other.clone(),
        };
        for part in &self.parts {
            match part {
                Part::Retain { n, marks } => {
                    if at + n > content.len() {
                        return Err(fail(
                            "Operation can't retain more characters than are left in the string.",
                        ));
                    }
                    out.extend_from_slice(&content[at..at + n]);
                    match &marks.tracking {
                        Some(_) => {
                            out_tracked.extend(std::iter::repeat_n(resolve(&marks.tracking), *n))
                        }
                        None => out_tracked.extend_from_slice(&tracked[at..at + n]),
                    }
                    at += n;
                }
                Part::Insert {
                    text: inserted,
                    marks,
                } => {
                    out.extend_from_slice(inserted);
                    out_tracked.extend(std::iter::repeat_n(
                        resolve(&marks.tracking),
                        inserted.len(),
                    ));
                }
                Part::Delete { n } => at += n,
            }
        }
        if at != content.len() {
            return Err(fail("The operation didn't operate on the whole string."));
        }
        Ok((out, out_tracked))
    }

    pub fn transform(
        operation1: &TextOperation,
        operation2: &TextOperation,
    ) -> Result<(TextOperation, TextOperation), OracleError> {
        if operation1.base_length != operation2.base_length {
            return Err(fail("Both operations have to have the same base length"));
        }
        let mut prime1 = TextOperation::new();
        let mut prime2 = TextOperation::new();
        let mut ops1 = operation1.parts.iter().cloned();
        let mut ops2 = operation2.parts.iter().cloned();
        let mut op1 = ops1.next();
        let mut op2 = ops2.next();
        let shrink = |part: Part, by: usize| match part {
            Part::Retain { n, marks } => Part::Retain { n: n - by, marks },
            Part::Delete { n } => Part::Delete { n: n - by },
            insert => insert,
        };
        let length = |part: &Part| match part {
            Part::Retain { n, .. } | Part::Delete { n } => *n,
            Part::Insert { text: inserted, .. } => inserted.len(),
        };
        loop {
            match (op1.clone(), op2.clone()) {
                (None, None) => break,
                (
                    Some(Part::Insert {
                        text: inserted,
                        marks,
                    }),
                    _,
                ) => {
                    prime2.retain(inserted.len());
                    prime1.insert_marked(inserted, marks);
                    op1 = ops1.next();
                }
                (
                    _,
                    Some(Part::Insert {
                        text: inserted,
                        marks,
                    }),
                ) => {
                    prime1.retain(inserted.len());
                    prime2.insert_marked(inserted, marks);
                    op2 = ops2.next();
                }
                (None, _) => {
                    return Err(fail(
                        "Cannot compose operations: first operation is too short.",
                    ))
                }
                (_, None) => {
                    return Err(fail(
                        "Cannot compose operations: first operation is too long.",
                    ))
                }
                (Some(first), Some(second)) => {
                    let minl = length(&first).min(length(&second));
                    match (&first, &second) {
                        (
                            Part::Retain { marks: marks1, .. },
                            Part::Retain { marks: marks2, .. },
                        ) => {
                            let kept = |tracking: &Option<Value>| Marks {
                                tracking: tracking.clone(),
                                comment_ids: None,
                            };
                            let (one, two) = if marks1.tracking.is_some() {
                                (kept(&marks1.tracking), kept(&None))
                            } else {
                                (kept(&None), kept(&marks2.tracking))
                            };
                            prime1.retain_marked(minl, one);
                            prime2.retain_marked(minl, two);
                        }
                        (Part::Delete { .. }, Part::Delete { .. }) => {}
                        (Part::Delete { .. }, Part::Retain { .. }) => {
                            prime1.delete(minl);
                        }
                        (Part::Retain { .. }, Part::Delete { .. }) => {
                            prime2.delete(minl);
                        }
                        _ => return Err(fail("The two operations aren't compatible")),
                    }
                    op1 = if length(&first) > minl {
                        Some(shrink(first, minl))
                    } else {
                        ops1.next()
                    };
                    op2 = if length(&second) > minl {
                        Some(shrink(second, minl))
                    } else {
                        ops2.next()
                    };
                }
            }
        }
        Ok((prime1, prime2))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{Rng, SeedableRng};

    fn plain(content: &str) -> (Vec<u16>, Vec<Option<Value>>) {
        let units = units(content);
        let tracked = vec![None; units.len()];
        (units, tracked)
    }

    #[test]
    fn wire_form_round_trips_with_tracking_and_comment_ids() {
        let wire = json!([3, "ab", -2, { "r": 4, "tracking": { "type": "delete", "userId": "u", "ts": "t" } }, { "i": "x", "commentIds": ["c1"] }]);
        assert_eq!(TextOperation::from_json(&wire).unwrap().to_json(), wire);
    }

    #[test]
    fn the_first_operation_wins_a_tie() {
        let (doc, tracked) = plain("ab");
        let mut first = TextOperation::new();
        first.retain(1).insert("X").retain(1);
        let mut second = TextOperation::new();
        second.retain(1).insert("Y").retain(1);
        let (first_after, second_after) = TextOperation::transform(&first, &second).unwrap();
        let (one, one_tracked) = first.apply(&doc, &tracked).unwrap();
        let (one, _) = second_after.apply(&one, &one_tracked).unwrap();
        let (two, two_tracked) = second.apply(&doc, &tracked).unwrap();
        let (two, _) = first_after.apply(&two, &two_tracked).unwrap();
        assert_eq!(text(&one), "aXYb");
        assert_eq!(one, two);
    }

    #[test]
    fn a_tracked_retain_marks_text_and_none_clears_it() {
        let (doc, tracked) = plain("abcd");
        let delete = json!({ "type": "delete", "userId": "u", "ts": "t" });
        let mut mark = TextOperation::new();
        mark.retain(1)
            .retain_marked(
                2,
                Marks {
                    tracking: Some(delete.clone()),
                    comment_ids: None,
                },
            )
            .retain(1);
        let (marked, marks) = mark.apply(&doc, &tracked).unwrap();
        assert_eq!(text(&marked), "abcd");
        assert_eq!(marks, vec![None, Some(delete.clone()), Some(delete), None]);
        let mut clear = TextOperation::new();
        clear.retain_marked(
            4,
            Marks {
                tracking: Some(json!({ "type": "none" })),
                comment_ids: None,
            },
        );
        let (_, cleared) = clear.apply(&marked, &marks).unwrap();
        assert_eq!(cleared, vec![None; 4]);
    }

    #[test]
    fn random_concurrent_operations_converge() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(458);
        let random = |rng: &mut rand::rngs::StdRng, length: usize| {
            let mut operation = TextOperation::new();
            let mut left = length;
            while left > 0 {
                let n = rng.gen_range(1..=left.min(3));
                match rng.gen_range(0..3) {
                    0 => operation.retain(n),
                    1 => operation.delete(n),
                    _ => operation.insert(&"xyz"[..n]).retain(n),
                };
                left -= n;
            }
            if rng.gen_bool(0.3) {
                operation.insert("end");
            }
            operation
        };
        for _ in 0..2000 {
            let length = rng.gen_range(0..10);
            let (doc, tracked) = plain(&"abcdefghij"[..length]);
            let first = random(&mut rng, length);
            let second = random(&mut rng, length);
            let (first_after, second_after) = TextOperation::transform(&first, &second).unwrap();
            let (one, one_tracked) = first.apply(&doc, &tracked).unwrap();
            let (one, _) = second_after.apply(&one, &one_tracked).unwrap();
            let (two, two_tracked) = second.apply(&doc, &tracked).unwrap();
            let (two, _) = first_after.apply(&two, &two_tracked).unwrap();
            assert_eq!(
                text(&one),
                text(&two),
                "{:?} vs {:?}",
                first.to_json(),
                second.to_json()
            );
        }
    }
}
