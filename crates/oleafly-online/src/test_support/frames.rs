use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Packet {
    pub kind: u8,
    pub id: Option<u64>,
    pub wants_ack: bool,
    pub endpoint: String,
    pub data: String,
}

impl Packet {
    pub fn parse(raw: &str) -> Option<Packet> {
        let mut parts = raw.splitn(4, ':');
        let kind = parts.next()?.parse::<u8>().ok()?;
        let id_field = parts.next().unwrap_or_default();
        let endpoint = parts.next().unwrap_or_default().to_string();
        let data = parts.next().unwrap_or_default().to_string();
        let (id, wants_ack) = match id_field.strip_suffix('+') {
            Some(number) => (number.parse().ok(), true),
            None if id_field.is_empty() => (None, false),
            None => (id_field.parse().ok(), false),
        };
        Some(Packet {
            kind,
            id,
            wants_ack,
            endpoint,
            data,
        })
    }

    pub fn event(&self) -> Option<(String, Vec<Value>)> {
        if self.kind != 5 {
            return None;
        }
        let body: Value = serde_json::from_str(&self.data).ok()?;
        let name = body.get("name")?.as_str()?.to_string();
        let args = body
            .get("args")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Some((name, args))
    }

    pub fn ack(&self) -> Option<(u64, Vec<Value>)> {
        if self.kind != 6 {
            return None;
        }
        match self.data.split_once('+') {
            Some((id, args)) => Some((
                id.parse().ok()?,
                serde_json::from_str::<Value>(args)
                    .ok()?
                    .as_array()
                    .cloned()
                    .unwrap_or_default(),
            )),
            None => Some((self.data.parse().ok()?, Vec::new())),
        }
    }
}

pub fn event(name: &str, args: &[Value]) -> String {
    if args.is_empty() {
        return format!("5:::{}", json!({ "name": name }));
    }
    format!("5:::{}", json!({ "name": name, "args": args }))
}

pub fn event_with_ack(id: u64, name: &str, args: &[Value]) -> String {
    format!("5:{id}+::{}", json!({ "name": name, "args": args }))
}

pub fn ack(id: u64, args: &[Value]) -> String {
    if args.is_empty() {
        format!("6:::{id}")
    } else {
        format!("6:::{id}+{}", Value::Array(args.to_vec()))
    }
}

pub fn payload(packets: &[String]) -> String {
    match packets {
        [single] => single.clone(),
        many => super::frame(&many.iter().map(String::as_str).collect::<Vec<_>>()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packets_keep_their_ack_ids() {
        let packet = Packet::parse("5:3+::{\"name\":\"joinDoc\",\"args\":[\"d\"]}").unwrap();
        assert_eq!(packet.id, Some(3));
        assert!(packet.wants_ack);
        assert_eq!(packet.event().unwrap().0, "joinDoc");
        let reply = Packet::parse("6:::3+[null,1]").unwrap();
        assert_eq!(reply.ack().unwrap(), (3, vec![Value::Null, json!(1)]));
        assert_eq!(
            Packet::parse("6:::4").unwrap().ack().unwrap(),
            (4, Vec::new())
        );
    }
}
