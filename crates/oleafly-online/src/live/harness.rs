use std::collections::VecDeque;

use oleafly_ot::testing::{EditorDoc, Reaction};
use oleafly_ot::{ChannelError, DocMessage, EditorChannel, TextOperation};
use serde_json::{json, Value};

use crate::test_support::mock_overleaf::{MockOverleaf, MockPeer};

use super::doc::{OutgoingUpdate, OverleafDoc, Rejoin};
use super::format::{DocFormat, FormatState};
use super::{AppliedUpdate, PublicId};

pub struct Joined {
    pub version: u64,
    pub text: String,
    pub format: FormatState,
    pub updates: Vec<AppliedUpdate>,
}

pub fn parse_join(reply: &[Value]) -> Result<Joined, String> {
    if !reply.first().is_some_and(Value::is_null) {
        return Err(reply
            .first()
            .and_then(|error| error["message"].as_str())
            .unwrap_or("joinDoc failed")
            .to_string());
    }
    let kind = reply[5].as_str().unwrap_or("sharejs-text-ot");
    let format = DocFormat::from_join_type(kind).map_err(|error| error.to_string())?;
    let (text, format) =
        FormatState::from_join(format, &reply[1], &reply[4]).map_err(|error| error.to_string())?;
    let updates = reply[3]
        .as_array()
        .map(|updates| {
            updates
                .iter()
                .filter_map(|update| AppliedUpdate::from_value(update, None))
                .collect()
        })
        .unwrap_or_default();
    Ok(Joined {
        version: reply[2].as_u64().unwrap_or_default(),
        text,
        format,
        updates,
    })
}

pub struct Wire {
    pub peer: MockPeer,
    pub own: Vec<PublicId>,
}

impl Wire {
    pub fn connect(mock: &MockOverleaf, name: &str) -> Wire {
        let peer = mock.peer(name);
        let own = vec![PublicId(peer.public_id.clone())];
        Wire { peer, own }
    }

    pub fn public_id(&self) -> PublicId {
        PublicId(self.peer.public_id.clone())
    }

    pub fn reconnect(&mut self, mock: &MockOverleaf, name: &str) {
        self.peer.drop_connection();
        self.peer = mock.peer(name);
        self.own.push(self.public_id());
    }

    pub fn join(&mut self, doc: &str, from: Option<u64>) -> Result<Joined, String> {
        let options = json!({ "encodeRanges": true, "supportsHistoryOT": true });
        let args = match from {
            Some(from) => vec![json!(doc), json!(from), options],
            None => vec![json!(doc), options],
        };
        let reply = self
            .peer
            .emit("joinDoc", args)
            .ok_or("joinDoc got no reply")?;
        parse_join(&reply)
    }

    pub fn open(&mut self, doc: &str) -> OverleafDoc {
        let joined = self.join(doc, None).expect("joinDoc");
        OverleafDoc::joined(
            super::DocId(doc.to_string()),
            joined.version,
            joined.text,
            joined.format,
        )
    }

    pub fn send_raw(&mut self, update: &OutgoingUpdate) -> Vec<Value> {
        self.peer
            .emit("applyOtUpdate", vec![json!(update.doc), update.payload()])
            .expect("applyOtUpdate got no reply")
    }

    pub fn send(&mut self, update: &OutgoingUpdate) {
        let reply = self.send_raw(update);
        assert!(
            reply.first().is_none_or(Value::is_null),
            "the server refused {:?}: {reply:?}",
            update.payload()
        );
    }

    pub fn incoming(&mut self, doc: &str) -> Vec<AppliedUpdate> {
        self.peer
            .take_events("otUpdateApplied")
            .iter()
            .filter_map(|args| {
                args.first()
                    .and_then(|update| AppliedUpdate::from_value(update, None))
            })
            .filter(|update| update.doc.0 == doc)
            .collect()
    }

    pub fn assert_healthy(&mut self) {
        assert!(
            self.peer.events("otUpdateError").is_empty(),
            "the server reported {:?}",
            self.peer.events("otUpdateError")
        );
        assert!(self.peer.is_connected(), "the server disconnected us");
    }
}

pub struct Editor {
    pub doc: EditorDoc,
    pub channel: EditorChannel,
    to_editor: VecDeque<DocMessage>,
    to_channel: VecDeque<(u64, TextOperation)>,
    pub corrections: usize,
}

impl Editor {
    pub fn new(text: &str) -> Editor {
        Editor {
            doc: EditorDoc::opened("doc", 0, 0, text.to_string()),
            channel: EditorChannel::new(text.to_string()),
            to_editor: VecDeque::new(),
            to_channel: VecDeque::new(),
            corrections: 0,
        }
    }

    pub fn typed(&mut self, sent: Option<(u64, TextOperation)>) {
        if let Some(sent) = sent {
            self.to_channel.push_back(sent);
        }
    }

    pub fn type_text(&mut self, text: &str) {
        let sent = self.doc.type_text(text).expect("type");
        self.typed(sent);
    }

    pub fn has_work(&self) -> bool {
        !self.to_editor.is_empty() || !self.to_channel.is_empty()
    }

    pub fn deliver_to_channel(&mut self, doc: &mut OverleafDoc) -> bool {
        let Some((rev, op)) = self.to_channel.pop_front() else {
            return false;
        };
        let applied = match self.channel.receive(rev, op) {
            Ok(applied) => applied,
            Err(ChannelError::BeforeReset) => return true,
            Err(error) => panic!("the channel refused the edit: {error}"),
        };
        let correction = doc.local(applied).expect("the doc takes the edit");
        self.to_editor.push_back(DocMessage::Ack {
            rev: self.channel.rev(),
            length: self.channel.length(),
        });
        if let Some(correction) = correction {
            self.corrections += 1;
            self.remote(correction);
        }
        true
    }

    pub fn deliver_to_editor(&mut self) -> bool {
        let Some(message) = self.to_editor.pop_front() else {
            return false;
        };
        match self.doc.receive(message) {
            Reaction::Nothing => {}
            Reaction::Send(rev, op) => self.to_channel.push_back((rev, op)),
            Reaction::Resync => panic!("the editor had to resync"),
        }
        true
    }

    pub fn remote(&mut self, op: TextOperation) {
        self.channel
            .remote(op.clone())
            .expect("the channel takes the remote op");
        self.to_editor.push_back(DocMessage::Remote {
            rev: self.channel.rev(),
            op,
            length: self.channel.length(),
        });
    }

    pub fn rejoined(&mut self, rejoin: Rejoin) {
        match rejoin {
            Rejoin::Clean(op) | Rejoin::Merged(op) => {
                if !op.is_noop() {
                    self.remote(op);
                }
            }
            Rejoin::Conflict { theirs, .. } => {
                let rev = self.channel.reset(theirs.clone());
                self.to_editor
                    .push_back(DocMessage::Reset { rev, text: theirs });
            }
        }
    }

    pub fn drain(&mut self, doc: &mut OverleafDoc) {
        while self.deliver_to_channel(doc) || self.deliver_to_editor() {}
    }
}
