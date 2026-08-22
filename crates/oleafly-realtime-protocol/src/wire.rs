use crate::{
    ActorId, AiAssistanceReceipt, ClientPresenceV1, ClientUpdateId, ContractError, EditSessionId,
    FileId, MutationEnvelopeV1, MutationOrigin, PresenceSelectionV1, RealtimeLimitsV1, ReplicaId,
    Result, ServerPresenceV1, REALTIME_PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const FRAME_MAGIC: [u8; 4] = *b"OLRT";
pub const FRAME_HEADER_VERSION: u8 = 1;
pub const FRAME_HEADER_LENGTH: usize = 12;
pub const OPENING_PROTOCOL_VERSION: u16 = 0;
pub const SYNC_TICKET_LENGTH: usize = 32;

const KIND_OPENING_AUTH: u8 = 0x01;
const KIND_OPENING_ACCEPTED: u8 = 0x02;
const KIND_YJS_SYNC: u8 = 0x10;
const KIND_MUTATION: u8 = 0x11;
const KIND_DURABLE_RECEIPT: u8 = 0x12;
const KIND_CLIENT_PRESENCE: u8 = 0x20;
const KIND_SERVER_PRESENCE: u8 = 0x21;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpeningAuthV1 {
    pub supported_versions: Vec<u16>,
    pub ticket: [u8; SYNC_TICKET_LENGTH],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClientStateVectorRequestV1 {
    pub payload: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServerYjsSyncKindV1 {
    SyncUpdate,
    Broadcast,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerYjsSyncMessageV1 {
    pub kind: ServerYjsSyncKindV1,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DurableReceiptV1 {
    pub client_update_id: ClientUpdateId,
    pub replica_id: ReplicaId,
    #[serde(with = "crate::canonical_u64")]
    pub client_sequence: u64,
    #[serde(with = "crate::canonical_u64")]
    pub server_sequence: u64,
    #[serde(with = "crate::canonical_u64")]
    pub authorization_epoch: u64,
    #[serde(with = "crate::canonical_u64")]
    pub committed_at_unix_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClientToServerMessageV1 {
    OpeningAuth(OpeningAuthV1),
    StateVectorRequest(ClientStateVectorRequestV1),
    Mutation(MutationEnvelopeV1),
    ClientPresence(ClientPresenceV1),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ServerToClientMessageV1 {
    OpeningAccepted,
    YjsSync(ServerYjsSyncMessageV1),
    DurableReceipt(DurableReceiptV1),
    ServerPresence(ServerPresenceV1),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClientToServerFrameV1 {
    pub protocol_version: u16,
    pub message: ClientToServerMessageV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerToClientFrameV1 {
    pub protocol_version: u16,
    pub message: ServerToClientMessageV1,
}

pub fn encode_client_to_server_frame_v1(frame: &ClientToServerFrameV1) -> Result<Vec<u8>> {
    encode_client_to_server_frame_v1_with_limits(frame, RealtimeLimitsV1::default())
}

pub fn encode_client_to_server_frame_v1_with_limits(
    frame: &ClientToServerFrameV1,
    limits: RealtimeLimitsV1,
) -> Result<Vec<u8>> {
    let limits = limits.validate()?;
    validate_client_protocol_version(frame)?;
    let (kind, payload) = encode_client_message(&frame.message, limits)?;
    encode_frame(frame.protocol_version, kind, payload, limits)
}

pub fn encode_server_to_client_frame_v1(frame: &ServerToClientFrameV1) -> Result<Vec<u8>> {
    encode_server_to_client_frame_v1_with_limits(frame, RealtimeLimitsV1::default())
}

pub fn encode_server_to_client_frame_v1_with_limits(
    frame: &ServerToClientFrameV1,
    limits: RealtimeLimitsV1,
) -> Result<Vec<u8>> {
    let limits = limits.validate()?;
    validate_negotiated_protocol_version(frame.protocol_version)?;
    let (kind, payload) = encode_server_message(&frame.message, limits)?;
    encode_frame(frame.protocol_version, kind, payload, limits)
}

pub fn decode_client_to_server_frame_v1(bytes: &[u8]) -> Result<ClientToServerFrameV1> {
    decode_client_to_server_frame_v1_with_limits(bytes, RealtimeLimitsV1::default())
}

pub fn decode_client_to_server_frame_v1_with_limits(
    bytes: &[u8],
    limits: RealtimeLimitsV1,
) -> Result<ClientToServerFrameV1> {
    let limits = limits.validate()?;
    let (protocol_version, kind, mut reader) = decode_header(bytes, limits)?;
    let message = decode_client_message(kind, &mut reader)?;
    reader.finish()?;
    let frame = ClientToServerFrameV1 {
        protocol_version,
        message,
    };
    validate_client_protocol_version(&frame)?;
    Ok(frame)
}

pub fn decode_server_to_client_frame_v1(bytes: &[u8]) -> Result<ServerToClientFrameV1> {
    decode_server_to_client_frame_v1_with_limits(bytes, RealtimeLimitsV1::default())
}

pub fn decode_server_to_client_frame_v1_with_limits(
    bytes: &[u8],
    limits: RealtimeLimitsV1,
) -> Result<ServerToClientFrameV1> {
    let limits = limits.validate()?;
    let (protocol_version, kind, mut reader) = decode_header(bytes, limits)?;
    validate_negotiated_protocol_version(protocol_version)?;
    let message = decode_server_message(kind, &mut reader)?;
    reader.finish()?;
    Ok(ServerToClientFrameV1 {
        protocol_version,
        message,
    })
}

fn encode_frame(
    protocol_version: u16,
    kind: u8,
    payload: Vec<u8>,
    limits: RealtimeLimitsV1,
) -> Result<Vec<u8>> {
    let total = FRAME_HEADER_LENGTH
        .checked_add(payload.len())
        .ok_or_else(|| invalid_frame("realtime frame length overflow"))?;
    if total > limits.max_frame_bytes {
        return Err(invalid_frame("realtime frame exceeds the configured limit"));
    }
    let payload_length = u32::try_from(payload.len())
        .map_err(|_| invalid_frame("realtime frame payload exceeds the u32 length limit"))?;
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(&FRAME_MAGIC);
    bytes.push(FRAME_HEADER_VERSION);
    bytes.extend_from_slice(&protocol_version.to_be_bytes());
    bytes.push(kind);
    bytes.extend_from_slice(&payload_length.to_be_bytes());
    bytes.extend_from_slice(&payload);
    Ok(bytes)
}

fn decode_header(bytes: &[u8], limits: RealtimeLimitsV1) -> Result<(u16, u8, Reader<'_>)> {
    if bytes.len() > limits.max_frame_bytes {
        return Err(invalid_frame("realtime frame exceeds the configured limit"));
    }
    if bytes.len() < FRAME_HEADER_LENGTH {
        return Err(invalid_frame("realtime frame is truncated"));
    }
    if bytes[..4] != FRAME_MAGIC {
        return Err(invalid_frame("realtime frame has invalid magic"));
    }
    if bytes[4] != FRAME_HEADER_VERSION {
        return Err(invalid_frame(format!(
            "unsupported realtime frame header version: {}",
            bytes[4]
        )));
    }
    let protocol_version = u16::from_be_bytes([bytes[5], bytes[6]]);
    let kind = bytes[7];
    let payload_length = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    if payload_length > limits.max_frame_bytes - FRAME_HEADER_LENGTH {
        return Err(invalid_frame(
            "realtime frame payload exceeds the configured limit",
        ));
    }
    if payload_length != bytes.len() - FRAME_HEADER_LENGTH {
        return Err(invalid_frame(
            "realtime frame payload length does not match the header",
        ));
    }
    Ok((
        protocol_version,
        kind,
        Reader::new(&bytes[FRAME_HEADER_LENGTH..], limits),
    ))
}

fn encode_client_message(
    message: &ClientToServerMessageV1,
    limits: RealtimeLimitsV1,
) -> Result<(u8, Vec<u8>)> {
    let mut writer = Writer::new(limits);
    let kind = match message {
        ClientToServerMessageV1::OpeningAuth(auth) => {
            if auth.supported_versions.is_empty() {
                return Err(invalid_frame(
                    "opening auth must advertise at least one protocol version",
                ));
            }
            let count = u16::try_from(auth.supported_versions.len()).map_err(|_| {
                invalid_frame("opening auth advertises more than 65535 protocol versions")
            })?;
            let mut unique = auth.supported_versions.clone();
            if unique.contains(&OPENING_PROTOCOL_VERSION) {
                return Err(invalid_frame(
                    "opening auth cannot advertise reserved protocol version 0",
                ));
            }
            unique.sort_unstable();
            unique.dedup();
            if unique.len() != auth.supported_versions.len() {
                return Err(invalid_frame(
                    "opening auth protocol versions must be unique",
                ));
            }
            writer.u16(count);
            for version in &auth.supported_versions {
                writer.u16(*version);
            }
            writer.raw(&auth.ticket);
            KIND_OPENING_AUTH
        }
        ClientToServerMessageV1::StateVectorRequest(request) => {
            writer.u8(0);
            writer.bytes(
                &request.payload,
                limits.max_yjs_state_vector_bytes,
                "Yjs state vector",
            )?;
            KIND_YJS_SYNC
        }
        ClientToServerMessageV1::Mutation(envelope) => {
            writer.uuid(envelope.client_update_id);
            writer.uuid(envelope.replica_id);
            writer.u64(envelope.client_sequence);
            writer.uuid(envelope.edit_session_id);
            writer.u8(origin_byte(envelope.origin));
            writer.optional(envelope.assistance.as_ref(), |writer, assistance| {
                assistance.validate_with_limit(limits.max_assistance_accepted_diff_bytes)?;
                writer.string(
                    &assistance.provider,
                    limits.max_string_bytes,
                    "assistance provider",
                )?;
                writer.string(
                    &assistance.model,
                    limits.max_string_bytes,
                    "assistance model",
                )?;
                writer.string(
                    &assistance.proposal_identifier,
                    limits.max_string_bytes,
                    "proposal identifier",
                )?;
                writer.string32(
                    &assistance.accepted_diff,
                    limits.max_assistance_accepted_diff_bytes,
                    "accepted diff",
                )
            })?;
            writer.bytes(
                &envelope.update,
                limits.max_mutation_update_bytes,
                "mutation update",
            )?;
            KIND_MUTATION
        }
        ClientToServerMessageV1::ClientPresence(presence) => {
            encode_selection(&mut writer, presence.selection.as_ref())?;
            KIND_CLIENT_PRESENCE
        }
    };
    Ok((kind, writer.finish()?))
}

fn encode_server_message(
    message: &ServerToClientMessageV1,
    limits: RealtimeLimitsV1,
) -> Result<(u8, Vec<u8>)> {
    let mut writer = Writer::new(limits);
    let kind = match message {
        ServerToClientMessageV1::OpeningAccepted => KIND_OPENING_ACCEPTED,
        ServerToClientMessageV1::YjsSync(sync) => {
            writer.u8(match sync.kind {
                ServerYjsSyncKindV1::SyncUpdate => 1,
                ServerYjsSyncKindV1::Broadcast => 2,
            });
            writer.bytes(&sync.payload, limits.max_yjs_update_bytes, "Yjs update")?;
            KIND_YJS_SYNC
        }
        ServerToClientMessageV1::DurableReceipt(receipt) => {
            writer.uuid(receipt.client_update_id);
            writer.uuid(receipt.replica_id);
            writer.u64(receipt.client_sequence);
            writer.u64(receipt.server_sequence);
            writer.u64(receipt.authorization_epoch);
            writer.u64(receipt.committed_at_unix_ms);
            KIND_DURABLE_RECEIPT
        }
        ServerToClientMessageV1::ServerPresence(presence) => {
            validate_server_presence(presence, limits)?;
            writer.uuid(presence.actor_id);
            writer.uuid(presence.replica_id);
            writer.string(
                &presence.display_name,
                limits.max_string_bytes,
                "presence display name",
            )?;
            writer.string(
                &presence.color_token,
                limits.max_string_bytes,
                "presence color token",
            )?;
            encode_selection(&mut writer, presence.selection.as_ref())?;
            KIND_SERVER_PRESENCE
        }
    };
    Ok((kind, writer.finish()?))
}

fn decode_client_message(kind: u8, reader: &mut Reader<'_>) -> Result<ClientToServerMessageV1> {
    match kind {
        KIND_OPENING_AUTH => {
            let count = reader.u16()?;
            if count == 0 {
                return Err(invalid_frame(
                    "opening auth advertised no protocol versions",
                ));
            }
            if usize::from(count) * 2 + SYNC_TICKET_LENGTH > reader.remaining() {
                return Err(invalid_frame("opening auth version list is truncated"));
            }
            let mut supported_versions = Vec::with_capacity(usize::from(count));
            for _ in 0..count {
                supported_versions.push(reader.u16()?);
            }
            let mut unique = supported_versions.clone();
            if unique.contains(&OPENING_PROTOCOL_VERSION) {
                return Err(invalid_frame(
                    "opening auth cannot advertise reserved protocol version 0",
                ));
            }
            unique.sort_unstable();
            unique.dedup();
            if unique.len() != supported_versions.len() {
                return Err(invalid_frame(
                    "opening auth protocol versions must be unique",
                ));
            }
            let mut ticket = [0_u8; SYNC_TICKET_LENGTH];
            ticket.copy_from_slice(reader.take(SYNC_TICKET_LENGTH)?);
            Ok(ClientToServerMessageV1::OpeningAuth(OpeningAuthV1 {
                supported_versions,
                ticket,
            }))
        }
        KIND_YJS_SYNC => {
            if reader.u8()? != 0 {
                return Err(invalid_frame(
                    "clients may only send Yjs state-vector requests",
                ));
            }
            Ok(ClientToServerMessageV1::StateVectorRequest(
                ClientStateVectorRequestV1 {
                    payload: reader
                        .bytes(reader.limits.max_yjs_state_vector_bytes, "Yjs state vector")?
                        .to_vec(),
                },
            ))
        }
        KIND_MUTATION => Ok(ClientToServerMessageV1::Mutation(decode_mutation(reader)?)),
        KIND_CLIENT_PRESENCE => Ok(ClientToServerMessageV1::ClientPresence(ClientPresenceV1 {
            selection: decode_selection(reader)?,
        })),
        KIND_OPENING_ACCEPTED | KIND_DURABLE_RECEIPT | KIND_SERVER_PRESENCE => Err(invalid_frame(
            "server-to-client message kind received from a client",
        )),
        _ => Err(invalid_frame(format!(
            "unknown realtime message kind: {kind}"
        ))),
    }
}

fn decode_server_message(kind: u8, reader: &mut Reader<'_>) -> Result<ServerToClientMessageV1> {
    match kind {
        KIND_OPENING_ACCEPTED => Ok(ServerToClientMessageV1::OpeningAccepted),
        KIND_YJS_SYNC => {
            let sync_kind = match reader.u8()? {
                1 => ServerYjsSyncKindV1::SyncUpdate,
                2 => ServerYjsSyncKindV1::Broadcast,
                _ => return Err(invalid_frame("server Yjs message has an invalid subtype")),
            };
            Ok(ServerToClientMessageV1::YjsSync(ServerYjsSyncMessageV1 {
                kind: sync_kind,
                payload: reader
                    .bytes(reader.limits.max_yjs_update_bytes, "Yjs update")?
                    .to_vec(),
            }))
        }
        KIND_DURABLE_RECEIPT => Ok(ServerToClientMessageV1::DurableReceipt(DurableReceiptV1 {
            client_update_id: reader.uuid(ClientUpdateId::parse)?,
            replica_id: reader.uuid(ReplicaId::parse)?,
            client_sequence: reader.u64()?,
            server_sequence: reader.u64()?,
            authorization_epoch: reader.u64()?,
            committed_at_unix_ms: reader.u64()?,
        })),
        KIND_SERVER_PRESENCE => {
            let presence = ServerPresenceV1 {
                actor_id: reader.uuid(ActorId::parse)?,
                replica_id: reader.uuid(ReplicaId::parse)?,
                display_name: reader
                    .string(reader.limits.max_string_bytes, "presence display name")?,
                color_token: reader
                    .string(reader.limits.max_string_bytes, "presence color token")?,
                selection: decode_selection(reader)?,
            };
            validate_server_presence(&presence, reader.limits)?;
            Ok(ServerToClientMessageV1::ServerPresence(presence))
        }
        KIND_OPENING_AUTH | KIND_MUTATION | KIND_CLIENT_PRESENCE => Err(invalid_frame(
            "client-to-server message kind received from a server",
        )),
        _ => Err(invalid_frame(format!(
            "unknown realtime message kind: {kind}"
        ))),
    }
}

fn decode_mutation(reader: &mut Reader<'_>) -> Result<MutationEnvelopeV1> {
    let client_update_id = reader.uuid(ClientUpdateId::parse)?;
    let replica_id = reader.uuid(ReplicaId::parse)?;
    let client_sequence = reader.u64()?;
    let edit_session_id = reader.uuid(EditSessionId::parse)?;
    let origin = match reader.u8()? {
        0 => MutationOrigin::Human,
        1 => MutationOrigin::SuggestionAccept,
        2 => MutationOrigin::VersionRestore,
        3 => MutationOrigin::ExternalSmallSave,
        4 => MutationOrigin::ExternalBulkApply,
        5 => MutationOrigin::Import,
        _ => return Err(invalid_frame("unknown mutation origin")),
    };
    let assistance = reader.optional(|reader| {
        let receipt = AiAssistanceReceipt {
            provider: reader.string(reader.limits.max_string_bytes, "assistance provider")?,
            model: reader.string(reader.limits.max_string_bytes, "assistance model")?,
            proposal_identifier: reader
                .string(reader.limits.max_string_bytes, "proposal identifier")?,
            accepted_diff: reader.string32(
                reader.limits.max_assistance_accepted_diff_bytes,
                "accepted diff",
            )?,
        };
        receipt.validate_with_limit(reader.limits.max_assistance_accepted_diff_bytes)?;
        Ok(receipt)
    })?;
    let update = reader
        .bytes(reader.limits.max_mutation_update_bytes, "mutation update")?
        .to_vec();
    Ok(MutationEnvelopeV1 {
        client_update_id,
        replica_id,
        client_sequence,
        edit_session_id,
        origin,
        assistance,
        update,
    })
}

fn encode_selection(writer: &mut Writer, selection: Option<&PresenceSelectionV1>) -> Result<()> {
    writer.optional(selection, |writer, selection| {
        writer.uuid(selection.file_id);
        writer.bytes(
            &selection.anchor_relative_position,
            writer.limits.max_relative_position_bytes,
            "presence anchor relative position",
        )?;
        writer.bytes(
            &selection.head_relative_position,
            writer.limits.max_relative_position_bytes,
            "presence head relative position",
        )
    })
}

fn decode_selection(reader: &mut Reader<'_>) -> Result<Option<PresenceSelectionV1>> {
    reader.optional(|reader| {
        Ok(PresenceSelectionV1 {
            file_id: reader.uuid(FileId::parse)?,
            anchor_relative_position: reader
                .bytes(
                    reader.limits.max_relative_position_bytes,
                    "presence anchor relative position",
                )?
                .to_vec(),
            head_relative_position: reader
                .bytes(
                    reader.limits.max_relative_position_bytes,
                    "presence head relative position",
                )?
                .to_vec(),
        })
    })
}

fn validate_client_protocol_version(frame: &ClientToServerFrameV1) -> Result<()> {
    match &frame.message {
        ClientToServerMessageV1::OpeningAuth(_)
            if frame.protocol_version != OPENING_PROTOCOL_VERSION =>
        {
            Err(invalid_frame(
                "opening auth must use protocol version 0 before negotiation",
            ))
        }
        ClientToServerMessageV1::OpeningAuth(_) => Ok(()),
        _ => validate_negotiated_protocol_version(frame.protocol_version),
    }
}

fn validate_negotiated_protocol_version(version: u16) -> Result<()> {
    if version != REALTIME_PROTOCOL_VERSION {
        return Err(invalid_frame(format!(
            "realtime v1 codec cannot read protocol version {version}"
        )));
    }
    Ok(())
}

fn validate_server_presence(presence: &ServerPresenceV1, limits: RealtimeLimitsV1) -> Result<()> {
    if presence.display_name.is_empty() || presence.color_token.is_empty() {
        return Err(invalid_frame(
            "server presence display name and color token must not be empty",
        ));
    }
    if presence.display_name.len() > limits.max_string_bytes
        || presence.color_token.len() > limits.max_string_bytes
    {
        return Err(invalid_frame(
            "server presence string exceeds the configured limit",
        ));
    }
    Ok(())
}

const fn origin_byte(origin: MutationOrigin) -> u8 {
    match origin {
        MutationOrigin::Human => 0,
        MutationOrigin::SuggestionAccept => 1,
        MutationOrigin::VersionRestore => 2,
        MutationOrigin::ExternalSmallSave => 3,
        MutationOrigin::ExternalBulkApply => 4,
        MutationOrigin::Import => 5,
    }
}

struct Writer {
    bytes: Vec<u8>,
    limits: RealtimeLimitsV1,
}

impl Writer {
    fn new(limits: RealtimeLimitsV1) -> Self {
        Self {
            bytes: Vec::new(),
            limits,
        }
    }
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }
    fn raw(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }
    fn bytes(&mut self, value: &[u8], maximum: usize, label: &str) -> Result<()> {
        if value.len() > maximum {
            return Err(invalid_frame(format!(
                "{label} exceeds the configured limit"
            )));
        }
        let length = u32::try_from(value.len())
            .map_err(|_| invalid_frame("binary field exceeds the u32 length limit"))?;
        self.u32(length);
        self.raw(value);
        Ok(())
    }
    fn string(&mut self, value: &str, maximum: usize, label: &str) -> Result<()> {
        if value.len() > maximum {
            return Err(invalid_frame(format!(
                "{label} exceeds the configured limit"
            )));
        }
        let length = u16::try_from(value.len())
            .map_err(|_| invalid_frame("string field exceeds the u16 length limit"))?;
        self.u16(length);
        self.raw(value.as_bytes());
        Ok(())
    }
    fn string32(&mut self, value: &str, maximum: usize, label: &str) -> Result<()> {
        if value.len() > maximum {
            return Err(invalid_frame(format!(
                "{label} exceeds the configured limit"
            )));
        }
        let length = u32::try_from(value.len())
            .map_err(|_| invalid_frame("string field exceeds the u32 length limit"))?;
        self.u32(length);
        self.raw(value.as_bytes());
        Ok(())
    }
    fn uuid<T: std::fmt::Display>(&mut self, value: T) {
        let compact = value.to_string().replace('-', "");
        for index in (0..compact.len()).step_by(2) {
            self.bytes
                .push(u8::from_str_radix(&compact[index..index + 2], 16).expect("validated UUID"));
        }
    }
    fn optional<T>(
        &mut self,
        value: Option<T>,
        write: impl FnOnce(&mut Self, T) -> Result<()>,
    ) -> Result<()> {
        match value {
            Some(value) => {
                self.u8(1);
                write(self, value)
            }
            None => {
                self.u8(0);
                Ok(())
            }
        }
    }
    fn finish(self) -> Result<Vec<u8>> {
        if self.bytes.len() + FRAME_HEADER_LENGTH > self.limits.max_frame_bytes {
            return Err(invalid_frame("realtime frame exceeds the configured limit"));
        }
        Ok(self.bytes)
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
    limits: RealtimeLimitsV1,
}

impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8], limits: RealtimeLimitsV1) -> Self {
        Self {
            bytes,
            offset: 0,
            limits,
        }
    }
    fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_be_bytes(
            self.take(2)?.try_into().expect("checked length"),
        ))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().expect("checked length"),
        ))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().expect("checked length"),
        ))
    }
    fn bytes(&mut self, maximum: usize, label: &str) -> Result<&'a [u8]> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(invalid_frame(format!(
                "{label} exceeds the configured limit"
            )));
        }
        self.take(length)
    }
    fn string(&mut self, maximum: usize, label: &str) -> Result<String> {
        let length = usize::from(self.u16()?);
        self.utf8(length, maximum, label)
    }
    fn string32(&mut self, maximum: usize, label: &str) -> Result<String> {
        let length = self.u32()? as usize;
        self.utf8(length, maximum, label)
    }
    fn uuid<T>(&mut self, parse: impl FnOnce(&str) -> Result<T>) -> Result<T> {
        let bytes = self.take(16)?;
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        parse(&format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        ))
    }
    fn optional<T>(&mut self, read: impl FnOnce(&mut Self) -> Result<T>) -> Result<Option<T>> {
        match self.u8()? {
            0 => Ok(None),
            1 => read(self).map(Some),
            _ => Err(invalid_frame("optional field marker is invalid")),
        }
    }
    fn finish(&self) -> Result<()> {
        if self.offset != self.bytes.len() {
            return Err(invalid_frame("realtime message has trailing bytes"));
        }
        Ok(())
    }
    fn utf8(&mut self, length: usize, maximum: usize, label: &str) -> Result<String> {
        if length > maximum {
            return Err(invalid_frame(format!(
                "{label} exceeds the configured limit"
            )));
        }
        std::str::from_utf8(self.take(length)?)
            .map(str::to_owned)
            .map_err(|_| invalid_frame(format!("{label} is not valid UTF-8")))
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| invalid_frame("realtime frame payload is truncated"))?;
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }
}

fn invalid_frame(message: impl Into<String>) -> ContractError {
    ContractError::InvalidFrame(message.into())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PendingMutationId {
    pub client_update_id: ClientUpdateId,
    pub replica_id: ReplicaId,
    pub client_sequence: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PendingMutationTracker {
    pending: BTreeMap<ClientUpdateId, PendingMutationId>,
}

impl PendingMutationTracker {
    pub fn add(&mut self, mutation: PendingMutationId) -> Result<bool> {
        if let Some(existing) = self.pending.get(&mutation.client_update_id) {
            if existing.replica_id != mutation.replica_id
                || existing.client_sequence != mutation.client_sequence
            {
                return Err(invalid_frame(
                    "client update ID is already pending with a different mutation identity",
                ));
            }
            return Ok(false);
        }
        self.pending.insert(mutation.client_update_id, mutation);
        Ok(true)
    }

    pub fn acknowledge(&mut self, receipt: &DurableReceiptV1) -> Result<bool> {
        let Some(pending) = self.pending.get(&receipt.client_update_id) else {
            return Ok(false);
        };
        if pending.replica_id != receipt.replica_id
            || pending.client_sequence != receipt.client_sequence
        {
            return Err(invalid_frame(
                "durable receipt does not match the pending mutation identity",
            ));
        }
        self.pending.remove(&receipt.client_update_id);
        Ok(true)
    }

    pub fn count(&self) -> usize {
        self.pending.len()
    }

    pub fn ids(&self) -> impl Iterator<Item = ClientUpdateId> + '_ {
        self.pending.keys().copied()
    }

    pub fn is_saved_to_team(&self) -> bool {
        self.pending.is_empty()
    }
}
