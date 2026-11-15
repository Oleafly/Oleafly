use serde_json::Value;

const FRAME: char = char::REPLACEMENT_CHARACTER;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AckId(pub u64);

#[derive(Clone, Debug, PartialEq)]
pub enum Frame {
    Disconnect,
    Connect,
    Heartbeat,
    Message(String),
    Json(Value),
    Event {
        ack: Option<AckId>,
        name: String,
        args: Vec<Value>,
    },
    Ack {
        id: AckId,
        args: Vec<Value>,
    },
    Error(String),
    Noop,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FrameError {
    UnknownType(u8),
    Malformed(String),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::UnknownType(kind) => write!(f, "unknown frame type {kind}"),
            FrameError::Malformed(raw) => write!(f, "a frame that won't parse: {raw}"),
        }
    }
}

impl Frame {
    pub fn event(name: &str, args: &[Value]) -> Frame {
        Frame::Event {
            ack: None,
            name: name.to_string(),
            args: args.to_vec(),
        }
    }

    pub fn call(id: u64, name: &str, args: &[Value]) -> Frame {
        Frame::Event {
            ack: Some(AckId(id)),
            name: name.to_string(),
            args: args.to_vec(),
        }
    }

    pub fn ack(id: u64, args: &[Value]) -> Frame {
        Frame::Ack {
            id: AckId(id),
            args: args.to_vec(),
        }
    }

    pub fn into_event(self) -> Option<(String, Vec<Value>)> {
        match self {
            Frame::Event { name, args, .. } => Some((name, args)),
            _ => None,
        }
    }

    pub fn into_ack(self) -> Option<(u64, Vec<Value>)> {
        match self {
            Frame::Ack { id, args } => Some((id.0, args)),
            _ => None,
        }
    }
}

fn malformed(raw: &str) -> FrameError {
    let shown: String = raw.chars().take(80).collect();
    FrameError::Malformed(shown)
}

pub fn decode(raw: &str) -> Result<Frame, FrameError> {
    let mut parts = raw.splitn(4, ':');
    let kind_field = parts.next().unwrap_or_default();
    let (Some(id_field), Some(_endpoint)) = (parts.next(), parts.next()) else {
        return Err(malformed(raw));
    };
    let data = parts.next().unwrap_or_default();
    let kind: u8 = kind_field.parse().map_err(|_| malformed(raw))?;
    let ack = match id_field.strip_suffix('+').unwrap_or(id_field) {
        "" => None,
        number => Some(AckId(number.parse().map_err(|_| malformed(raw))?)),
    };
    match kind {
        0 => Ok(Frame::Disconnect),
        1 => Ok(Frame::Connect),
        2 => Ok(Frame::Heartbeat),
        3 => Ok(Frame::Message(data.to_string())),
        4 => serde_json::from_str(data)
            .map(Frame::Json)
            .map_err(|_| malformed(raw)),
        5 => {
            let body: Value = serde_json::from_str(data).map_err(|_| malformed(raw))?;
            let name = body
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| malformed(raw))?
                .to_string();
            let args = match body.get("args") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(args)) => args.clone(),
                Some(_) => return Err(malformed(raw)),
            };
            Ok(Frame::Event { ack, name, args })
        }
        6 => {
            let (id, args) = match data.split_once('+') {
                Some((id, args)) => (id, Some(args)),
                None => (data, None),
            };
            let id = AckId(id.parse().map_err(|_| malformed(raw))?);
            let args = match args.map(serde_json::from_str::<Value>) {
                None => Vec::new(),
                Some(Ok(Value::Array(args))) => args,
                Some(_) => return Err(malformed(raw)),
            };
            Ok(Frame::Ack { id, args })
        }
        7 => Ok(Frame::Error(data.to_string())),
        8 => Ok(Frame::Noop),
        other => Err(FrameError::UnknownType(other)),
    }
}

pub fn encode(frame: &Frame) -> String {
    match frame {
        Frame::Disconnect => "0::".to_string(),
        Frame::Connect => "1::".to_string(),
        Frame::Heartbeat => "2::".to_string(),
        Frame::Message(text) => format!("3:::{text}"),
        Frame::Json(value) => format!("4:::{value}"),
        Frame::Event { ack, name, args } => {
            let name = Value::String(name.clone());
            let body = if args.is_empty() {
                format!("{{\"name\":{name}}}")
            } else {
                format!(
                    "{{\"name\":{name},\"args\":{}}}",
                    Value::Array(args.clone())
                )
            };
            match ack {
                Some(AckId(id)) => format!("5:{id}+::{body}"),
                None => format!("5:::{body}"),
            }
        }
        Frame::Ack { id, args } if args.is_empty() => format!("6:::{}", id.0),
        Frame::Ack { id, args } => format!("6:::{}+{}", id.0, Value::Array(args.clone())),
        Frame::Error(reason) => format!("7:::{reason}"),
        Frame::Noop => "8::".to_string(),
    }
}

pub fn decode_payload(body: &str) -> Vec<String> {
    if !body.starts_with(FRAME) {
        return if body.is_empty() {
            Vec::new()
        } else {
            vec![body.to_string()]
        };
    }
    let mut frames = Vec::new();
    let mut rest = body;
    while let Some(stripped) = rest.strip_prefix(FRAME) {
        let Some(end) = stripped.find(FRAME) else {
            break;
        };
        let Ok(length) = stripped[..end].parse::<usize>() else {
            break;
        };
        let framed = &stripped[end + FRAME.len_utf8()..];
        let split = utf16_prefix(framed, length);
        frames.push(framed[..split].to_string());
        rest = &framed[split..];
    }
    frames
}

fn utf16_prefix(text: &str, units: usize) -> usize {
    let mut counted = 0;
    for (index, character) in text.char_indices() {
        if counted >= units {
            return index;
        }
        counted += character.len_utf16();
    }
    text.len()
}

pub fn encode_payload(frames: &[String]) -> String {
    match frames {
        [single] => single.clone(),
        many => many
            .iter()
            .map(|frame| format!("{FRAME}{}{FRAME}{frame}", frame.encode_utf16().count()))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_round_trip_for_every_type() {
        let frames = [
            Frame::Disconnect,
            Frame::Connect,
            Frame::Heartbeat,
            Frame::Message("hello: there".into()),
            Frame::Json(json!({ "a": [1, "b"] })),
            Frame::event("joinProjectResponse", &[json!({ "publicId": "P.1" })]),
            Frame::event("reconnectGracefully", &[]),
            Frame::call(
                7,
                "joinDoc",
                &[json!("doc"), json!({ "encodeRanges": true })],
            ),
            Frame::ack(7, &[Value::Null, json!(["line: one"]), json!(3)]),
            Frame::ack(8, &[]),
            Frame::Error("1+0".into()),
            Frame::Noop,
        ];
        for frame in frames {
            let wire = encode(&frame);
            assert_eq!(decode(&wire), Ok(frame.clone()), "{wire}");
        }
        assert_eq!(encode(&Frame::Heartbeat), "2::");
        assert_eq!(encode(&Frame::ack(3, &[])), "6:::3");
        assert_eq!(
            encode(&Frame::event("leaveDoc", &[])),
            "5:::{\"name\":\"leaveDoc\"}"
        );
        assert_eq!(decode("7:::1+0"), Ok(Frame::Error("1+0".into())));
        assert_eq!(decode("9::"), Err(FrameError::UnknownType(9)));
        for broken in [
            "",
            "garbage",
            "x::",
            "5:::nope",
            "5:::{\"args\":[]}",
            "5:::{\"name\":\"n\",\"args\":7}",
            "6:::nope",
            "6:::3+{}",
            "4:::{",
            "5:abc+::{\"name\":\"n\"}",
        ] {
            assert!(
                matches!(decode(broken), Err(FrameError::Malformed(_))),
                "{broken:?}"
            );
        }
    }

    #[test]
    fn an_event_with_an_ack_keeps_its_id() {
        let decoded = decode("5:3+::{\"name\":\"joinDoc\",\"args\":[\"d\"]}").unwrap();
        assert_eq!(
            decoded,
            Frame::Event {
                ack: Some(AckId(3)),
                name: "joinDoc".into(),
                args: vec![json!("d")],
            }
        );
        assert_eq!(
            encode(&decoded),
            "5:3+::{\"name\":\"joinDoc\",\"args\":[\"d\"]}"
        );
        assert_eq!(
            decode("6:::3+[null,1]").unwrap().into_ack(),
            Some((3, vec![Value::Null, json!(1)]))
        );
        assert_eq!(decode("6:::4").unwrap().into_ack(), Some((4, Vec::new())));
    }

    #[test]
    fn payload_lengths_count_utf16_units() {
        let frames = vec![
            "1::".to_string(),
            "5:::{\"name\":\"x\",\"args\":[\"é😀\"]}".to_string(),
        ];
        let body = encode_payload(&frames);
        assert!(body.contains(&format!("{FRAME}31{FRAME}")), "{body}");
        assert_eq!(decode_payload(&body), frames);
        assert_eq!(decode_payload("2::"), vec!["2::".to_string()]);
        assert!(decode_payload("").is_empty());
        assert_eq!(encode_payload(&["2::".to_string()]), "2::");
        assert_eq!(
            decode_payload(&format!("{FRAME}3{FRAME}1::{FRAME}9{FRAME}2::")),
            vec!["1::".to_string(), "2::".to_string()]
        );
    }
}
