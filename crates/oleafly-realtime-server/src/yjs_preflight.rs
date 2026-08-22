//! Allocation-safe structural admission for untrusted Yjs update-v1 data.
//!
//! The traversal is adapted from the MIT-licensed `yrs` 0.26.0 decoders in
//! `src/update.rs`, `src/block.rs`, `src/any.rs`, `src/id_set.rs`, and
//! `src/updates/decoder.rs`:
//! <https://github.com/y-crdt/y-crdt/tree/v0.26.0/yrs/src>.
//! Keep this scanner in lockstep with the exact pinned `yrs` version.

use anyhow::{bail, Context, Result};
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use yrs::encoding::read::{Cursor, Read};

use crate::config::ServerLimits;

const BLOCK_GC: u8 = 0;
const BLOCK_DELETED: u8 = 1;
const BLOCK_JSON: u8 = 2;
const BLOCK_BINARY: u8 = 3;
const BLOCK_STRING: u8 = 4;
const BLOCK_EMBED: u8 = 5;
const BLOCK_FORMAT: u8 = 6;
const BLOCK_TYPE: u8 = 7;
const BLOCK_ANY: u8 = 8;
const BLOCK_DOC: u8 = 9;
const BLOCK_SKIP: u8 = 10;
const BLOCK_MOVE: u8 = 11;

const HAS_PARENT_SUB: u8 = 0b0010_0000;
const HAS_RIGHT_ORIGIN: u8 = 0b0100_0000;
const HAS_ORIGIN: u8 = 0b1000_0000;
const UNUSED_INFO_FLAG: u8 = 0b0001_0000;
const MAX_YJS_CLIENT_ID: u64 = (1_u64 << 53) - 1;

pub(crate) fn preflight_state_vector_v1(bytes: &[u8], limits: &ServerLimits) -> Result<()> {
    let mut scanner = Scanner::new(bytes, limits);
    let entries = scanner.read_u32("Yjs state-vector entry count")? as usize;
    if entries > limits.max_state_vector_entries {
        bail!("Yjs state vector declares too many entries");
    }
    for _ in 0..entries {
        scanner.read_client_id("Yjs state-vector client")?;
        scanner.read_u32("Yjs state-vector clock")?;
    }
    scanner.finish("Yjs state vector")
}

pub(crate) fn preflight_update_v1(bytes: &[u8], limits: &ServerLimits) -> Result<()> {
    let mut scanner = Scanner::new(bytes, limits);
    scanner.scan_update()?;
    scanner.finish("Yjs update")
}

struct Scanner<'a> {
    cursor: Cursor<'a>,
    limits: &'a ServerLimits,
    elements: usize,
    content_bytes: usize,
}

impl<'a> Scanner<'a> {
    fn new(bytes: &'a [u8], limits: &'a ServerLimits) -> Self {
        Self {
            cursor: Cursor::new(bytes),
            limits,
            elements: 0,
            content_bytes: 0,
        }
    }

    fn finish(&self, label: &str) -> Result<()> {
        if self.cursor.next != self.cursor.buf.len() {
            bail!("{label} has trailing bytes");
        }
        Ok(())
    }

    fn scan_update(&mut self) -> Result<()> {
        let clients = self.read_u32("Yjs update client count")? as usize;
        if clients > self.limits.max_update_clients {
            bail!("Yjs update declares too many clients");
        }
        self.add_elements(clients, "Yjs update clients")?;

        for _ in 0..clients {
            let blocks = self.read_u32("Yjs update block count")? as usize;
            if blocks > self.limits.max_update_blocks_per_client {
                bail!("Yjs update declares too many blocks for a client");
            }
            self.add_elements(blocks, "Yjs update blocks")?;
            self.read_client_id("Yjs update client")?;
            let mut clock = self.read_u32("Yjs update client clock")?;
            for _ in 0..blocks {
                let block_len = self.scan_block()?;
                if let Some(block_len) = block_len {
                    clock = clock
                        .checked_add(block_len)
                        .context("Yjs update block clock overflow")?;
                }
            }
        }

        let delete_clients = self.read_u32("Yjs delete-set client count")? as usize;
        if delete_clients > self.limits.max_update_clients {
            bail!("Yjs update delete set declares too many clients");
        }
        self.add_elements(delete_clients, "Yjs delete-set clients")?;
        for _ in 0..delete_clients {
            self.read_client_id("Yjs delete-set client")?;
            let ranges = self.read_u32("Yjs delete-set IdRange count")? as usize;
            self.add_elements(ranges, "Yjs delete-set IdRanges")?;
            for _ in 0..ranges {
                let clock = self.read_u32("Yjs delete-set range clock")?;
                let len = self.read_u32("Yjs delete-set range length")?;
                clock
                    .checked_add(len)
                    .context("Yjs delete-set range clock overflow")?;
            }
        }
        Ok(())
    }

    /// Returns the UTF-16 clock length used by `yrs::Item::new`, or `None` for an
    /// empty item which `yrs` drops while decoding.
    fn scan_block(&mut self) -> Result<Option<u32>> {
        let info = self.read_u8("Yjs block info")?;
        match info {
            BLOCK_SKIP => return Ok(Some(self.read_u32("Yjs skip length")?)),
            BLOCK_GC => return Ok(Some(self.read_u32("Yjs GC length")?)),
            _ => {}
        }
        if info & UNUSED_INFO_FLAG != 0 {
            bail!("Yjs block uses an unsupported info flag");
        }

        let cant_copy_parent_info = info & (HAS_ORIGIN | HAS_RIGHT_ORIGIN) == 0;
        if info & HAS_ORIGIN != 0 {
            self.read_id("Yjs block left origin")?;
        }
        if info & HAS_RIGHT_ORIGIN != 0 {
            self.read_id("Yjs block right origin")?;
        }
        if cant_copy_parent_info {
            match self.read_u32("Yjs block parent tag")? {
                0 => self.read_id("Yjs block parent ID")?,
                1 => {
                    self.read_string("Yjs block parent name")?;
                }
                _ => bail!("Yjs block has an unsupported parent tag"),
            }
            if info & HAS_PARENT_SUB != 0 {
                self.read_string("Yjs block parent key")?;
            }
        }

        let len = match info & 0b0000_1111 {
            BLOCK_DELETED => self.read_u32("Yjs deleted-content length")?,
            BLOCK_JSON => self.scan_legacy_json_content()?,
            BLOCK_BINARY => {
                self.read_sized_bytes("Yjs binary content")?;
                1
            }
            BLOCK_STRING => {
                let value = self.read_string("Yjs string content")?;
                u32::try_from(value.encode_utf16().count())
                    .context("Yjs string UTF-16 length overflow")?
            }
            BLOCK_EMBED => {
                self.scan_json_string("Yjs embedded JSON")?;
                1
            }
            BLOCK_FORMAT => {
                self.read_string("Yjs format key")?;
                self.scan_json_string("Yjs format JSON")?;
                1
            }
            BLOCK_TYPE => {
                self.scan_type_ref()?;
                1
            }
            BLOCK_ANY => {
                let len = self.read_u32("Yjs Any-content element count")? as usize;
                self.add_elements(len, "Yjs Any-content elements")?;
                for _ in 0..len {
                    self.scan_any(1)?;
                }
                len as u32
            }
            BLOCK_DOC => {
                self.read_string("Yjs subdocument GUID")?;
                self.scan_any(1)?;
                1
            }
            BLOCK_MOVE => {
                self.scan_move()?;
                1
            }
            _ => {
                bail!("Yjs block has an unsupported content reference")
            }
        };
        Ok((len != 0).then_some(len))
    }

    fn scan_legacy_json_content(&mut self) -> Result<u32> {
        let declared = self.read_u32("Yjs legacy JSON element count")?;
        if declared > i32::MAX as u32 {
            bail!("Yjs legacy JSON element count overflows the yrs decoder");
        }
        // `yrs` 0.26.0 intentionally mirrors Yjs here and reads count + 1 strings.
        let actual = declared
            .checked_add(1)
            .context("Yjs legacy JSON element count overflow")?;
        self.add_elements(actual as usize, "Yjs legacy JSON elements")?;
        for _ in 0..actual {
            self.read_string("Yjs legacy JSON string")?;
        }
        Ok(actual)
    }

    fn scan_type_ref(&mut self) -> Result<()> {
        match self.read_u8("Yjs type reference")? {
            0..=2 | 4..=6 | 9 | 15 => Ok(()),
            3 => {
                self.read_string("Yjs XML element name")?;
                Ok(())
            }
            // Type ref 7 needs yrs' optional `weak` feature, which this server does not enable.
            _ => bail!("Yjs block has an unsupported type reference"),
        }
    }

    fn scan_move(&mut self) -> Result<()> {
        let flags: i32 = self.cursor.read_var().context("decode Yjs move flags")?;
        self.read_id("Yjs move start")?;
        if flags & 1 == 0 {
            self.read_id("Yjs move end")?;
        }
        Ok(())
    }

    fn scan_any(&mut self, depth: usize) -> Result<()> {
        if depth > self.limits.max_update_nesting_depth {
            bail!("Yjs Any value exceeds the configured nesting depth");
        }
        match self.read_u8("Yjs Any tag")? {
            127 | 126 | 121 | 120 => Ok(()),
            125 => {
                let _: i64 = self.cursor.read_var().context("decode Yjs Any integer")?;
                Ok(())
            }
            124 => {
                self.read_exact(4, "Yjs Any float32")?;
                Ok(())
            }
            123 | 122 => {
                self.read_exact(8, "Yjs Any 64-bit value")?;
                Ok(())
            }
            119 => {
                self.read_string("Yjs Any string")?;
                Ok(())
            }
            118 => {
                let len: usize = self
                    .cursor
                    .read_var()
                    .context("decode Yjs Any map element count")?;
                self.add_elements(len, "Yjs Any map elements")?;
                for _ in 0..len {
                    self.read_string("Yjs Any map key")?;
                    self.scan_any(depth + 1)?;
                }
                Ok(())
            }
            117 => {
                let len: usize = self
                    .cursor
                    .read_var()
                    .context("decode Yjs Any array element count")?;
                self.add_elements(len, "Yjs Any array elements")?;
                for _ in 0..len {
                    self.scan_any(depth + 1)?;
                }
                Ok(())
            }
            116 => {
                self.read_sized_bytes("Yjs Any buffer")?;
                Ok(())
            }
            _ => bail!("Yjs Any value has an unsupported tag"),
        }
    }

    fn scan_json_string(&mut self, label: &str) -> Result<()> {
        let max_elements = self.limits.max_update_elements;
        let max_depth = self.limits.max_update_nesting_depth;
        let elements = self.elements;
        // `read_string` charges the complete encoded JSON string to the cumulative
        // content-byte budget before parsing. Keep the recursive walk allocation-free:
        // `yrs::Any::from_json` runs only after this preflight has bounded every
        // collection value and nesting level.
        let json = self.read_string(label)?;
        let mut budget = JsonBudget {
            elements,
            max_elements,
            max_depth,
        };
        let mut deserializer = serde_json::Deserializer::from_str(json);
        JsonValueSeed {
            budget: &mut budget,
            depth: 1,
            charge_value: false,
        }
        .deserialize(&mut deserializer)
        .with_context(|| format!("decode {label}"))?;
        deserializer
            .end()
            .with_context(|| format!("decode {label}"))?;
        self.elements = budget.elements;
        Ok(())
    }

    fn read_id(&mut self, label: &str) -> Result<()> {
        self.read_client_id(label)?;
        self.read_u32(label)?;
        Ok(())
    }

    fn read_client_id(&mut self, label: &str) -> Result<u64> {
        let client: u64 = self
            .cursor
            .read_var()
            .with_context(|| format!("decode {label}"))?;
        if client > MAX_YJS_CLIENT_ID {
            bail!("{label} exceeds Yjs' 53-bit client-ID range");
        }
        Ok(client)
    }

    fn read_u32(&mut self, label: &str) -> Result<u32> {
        self.cursor
            .read_var()
            .with_context(|| format!("decode {label}"))
    }

    fn read_u8(&mut self, label: &str) -> Result<u8> {
        self.cursor
            .read_u8()
            .with_context(|| format!("decode {label}"))
    }

    fn read_exact(&mut self, len: usize, label: &str) -> Result<&[u8]> {
        self.cursor
            .read_exact(len)
            .with_context(|| format!("decode {label}"))
    }

    fn read_sized_bytes(&mut self, label: &str) -> Result<&[u8]> {
        let len = self.read_u32(&format!("{label} length"))? as usize;
        self.add_content_bytes(len, label)?;
        self.read_exact(len, label)
    }

    fn read_string(&mut self, label: &str) -> Result<&str> {
        let bytes = self.read_sized_bytes(label)?;
        std::str::from_utf8(bytes).with_context(|| format!("decode {label} as UTF-8"))
    }

    fn add_elements(&mut self, count: usize, label: &str) -> Result<()> {
        self.elements = self
            .elements
            .checked_add(count)
            .with_context(|| format!("{label} count overflow"))?;
        if self.elements > self.limits.max_update_elements {
            bail!("{label} exceeds the configured cumulative element limit");
        }
        Ok(())
    }

    fn add_content_bytes(&mut self, count: usize, label: &str) -> Result<()> {
        self.content_bytes = self
            .content_bytes
            .checked_add(count)
            .with_context(|| format!("{label} byte count overflow"))?;
        if self.content_bytes > self.limits.max_update_content_bytes {
            bail!("{label} exceeds the configured cumulative content-byte limit");
        }
        Ok(())
    }
}

struct JsonBudget {
    elements: usize,
    max_elements: usize,
    max_depth: usize,
}

impl JsonBudget {
    fn charge_value<E>(&mut self) -> std::result::Result<(), E>
    where
        E: serde::de::Error,
    {
        self.elements = self
            .elements
            .checked_add(1)
            .ok_or_else(|| E::custom("Yjs JSON element count overflow"))?;
        if self.elements > self.max_elements {
            return Err(E::custom(
                "Yjs JSON exceeds the configured cumulative element limit",
            ));
        }
        Ok(())
    }
}

struct JsonValueSeed<'a> {
    budget: &'a mut JsonBudget,
    depth: usize,
    charge_value: bool,
}

impl<'de> DeserializeSeed<'de> for JsonValueSeed<'_> {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> std::result::Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        if self.depth > self.budget.max_depth {
            return Err(serde::de::Error::custom(
                "Yjs JSON exceeds the configured nesting depth",
            ));
        }
        if self.charge_value {
            self.budget.charge_value()?;
        }
        deserializer.deserialize_any(JsonValueVisitor {
            budget: self.budget,
            depth: self.depth,
        })
    }
}

struct JsonValueVisitor<'a> {
    budget: &'a mut JsonBudget,
    depth: usize,
}

impl<'de> Visitor<'de> for JsonValueVisitor<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a bounded JSON value")
    }

    fn visit_unit<E>(self) -> std::result::Result<Self::Value, E> {
        Ok(())
    }

    fn visit_bool<E>(self, _value: bool) -> std::result::Result<Self::Value, E> {
        Ok(())
    }

    fn visit_i64<E>(self, _value: i64) -> std::result::Result<Self::Value, E> {
        Ok(())
    }

    fn visit_u64<E>(self, _value: u64) -> std::result::Result<Self::Value, E> {
        Ok(())
    }

    fn visit_f64<E>(self, _value: f64) -> std::result::Result<Self::Value, E> {
        Ok(())
    }

    fn visit_str<E>(self, _value: &str) -> std::result::Result<Self::Value, E> {
        Ok(())
    }

    fn visit_seq<A>(self, mut sequence: A) -> std::result::Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while sequence
            .next_element_seed(JsonValueSeed {
                budget: self.budget,
                depth: self.depth + 1,
                charge_value: true,
            })?
            .is_some()
        {}
        Ok(())
    }

    fn visit_map<A>(self, mut map: A) -> std::result::Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        while map.next_key_seed(JsonMapKeySeed)?.is_some() {
            map.next_value_seed(JsonValueSeed {
                budget: self.budget,
                depth: self.depth + 1,
                charge_value: true,
            })?;
        }
        Ok(())
    }
}

struct JsonMapKeySeed;

impl<'de> DeserializeSeed<'de> for JsonMapKeySeed {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> std::result::Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_str(JsonMapKeyVisitor)
    }
}

struct JsonMapKeyVisitor;

impl Visitor<'_> for JsonMapKeyVisitor {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON object key")
    }

    fn visit_str<E>(self, _value: &str) -> std::result::Result<Self::Value, E> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use yrs::{
        updates::decoder::Decode, ClientID, Doc, GetString, OffsetKind, Options, ReadTxn,
        StateVector, Text, Transact, Update,
    };

    use super::*;

    fn push_var(mut value: u64, bytes: &mut Vec<u8>) {
        while value >= 0x80 {
            bytes.push(((value & 0x7f) as u8) | 0x80);
            value >>= 7;
        }
        bytes.push(value as u8);
    }

    fn single_content_block(info: u8, content: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut bytes = Vec::new();
        push_var(1, &mut bytes); // struct clients
        push_var(1, &mut bytes); // blocks
        push_var(1, &mut bytes); // client
        push_var(0, &mut bytes); // clock
        bytes.push(info);
        push_var(1, &mut bytes); // named parent
        push_var(4, &mut bytes);
        bytes.extend_from_slice(b"root");
        content(&mut bytes);
        push_var(0, &mut bytes); // delete-set clients
        bytes
    }

    fn single_json_block(info: u8, json: &str) -> Vec<u8> {
        single_content_block(info, |bytes| {
            if info == BLOCK_FORMAT {
                push_var(3, bytes);
                bytes.extend_from_slice(b"key");
            }
            push_var(json.len() as u64, bytes);
            bytes.extend_from_slice(json.as_bytes());
        })
    }

    fn strict_limits() -> ServerLimits {
        ServerLimits {
            max_state_vector_entries: 4,
            max_update_clients: 4,
            max_update_blocks_per_client: 8,
            max_update_elements: 16,
            max_update_content_bytes: 64,
            max_update_nesting_depth: 4,
            ..ServerLimits::default()
        }
    }

    #[test]
    fn walks_every_state_vector_entry() {
        assert!(
            preflight_state_vector_v1(&[0xff, 0xff, 0xff, 0xff, 0x0f], &strict_limits()).is_err()
        );
        // Two entries, but the second is truncated after its client ID.
        assert!(preflight_state_vector_v1(&[2, 1, 0, 2], &strict_limits()).is_err());
        assert!(preflight_state_vector_v1(&[1, 1, 0, 0], &strict_limits()).is_err());
    }

    #[test]
    fn checks_every_struct_client_and_cumulative_block_count() {
        let limits = strict_limits();
        assert!(preflight_update_v1(&[0xff, 0xff, 0xff, 0xff, 0x0f], &limits).is_err());
        assert!(preflight_update_v1(&[1, 0xff, 0xff, 0xff, 0xff, 0x0f], &limits).is_err());
        // The first client is empty; the second declares u32::MAX blocks.
        assert!(preflight_update_v1(&[2, 0, 1, 0, 0xff, 0xff, 0xff, 0xff, 0x0f], &limits).is_err());

        let cumulative_limits = ServerLimits {
            max_update_elements: 4,
            ..limits
        };
        // Three clients plus two blocks crosses the cumulative element budget.
        assert!(preflight_update_v1(&[3, 1, 1, 0], &cumulative_limits).is_err());
    }

    #[test]
    fn checks_delete_clients_and_every_id_range_count() {
        let limits = strict_limits();
        assert!(preflight_update_v1(&[0, 0xff, 0xff, 0xff, 0xff, 0x0f], &limits).is_err());
        // The second delete client declares u32::MAX ranges.
        let bytes = [
            0, // struct clients
            2, // delete clients
            1, 0, // first client, zero ranges
            2, 0xff, 0xff, 0xff, 0xff, 0x0f,
        ];
        assert!(preflight_update_v1(&bytes, &limits).is_err());
    }

    #[test]
    fn checks_all_length_prefixed_strings_and_buffers() {
        let limits = ServerLimits {
            max_update_content_bytes: 8,
            ..strict_limits()
        };
        let string = single_content_block(BLOCK_STRING, |bytes| push_var(9, bytes));
        assert!(preflight_update_v1(&string, &limits).is_err());
        let binary = single_content_block(BLOCK_BINARY, |bytes| push_var(9, bytes));
        assert!(preflight_update_v1(&binary, &limits).is_err());
        let any_buffer = single_content_block(BLOCK_ANY, |bytes| {
            push_var(1, bytes);
            bytes.push(116);
            push_var(9, bytes);
        });
        assert!(preflight_update_v1(&any_buffer, &limits).is_err());
    }

    #[test]
    fn checks_item_content_counts_before_allocation() {
        let limits = strict_limits();
        let any = single_content_block(BLOCK_ANY, |bytes| push_var(u32::MAX as u64, bytes));
        assert!(preflight_update_v1(&any, &limits).is_err());
        let legacy_json =
            single_content_block(BLOCK_JSON, |bytes| push_var(u32::MAX as u64, bytes));
        assert!(preflight_update_v1(&legacy_json, &limits).is_err());
    }

    #[test]
    fn checks_nested_any_array_map_counts_and_depth() {
        let element_limits = ServerLimits {
            max_update_elements: 8,
            ..strict_limits()
        };
        for tag in [117, 118] {
            let bytes = single_content_block(BLOCK_ANY, |bytes| {
                push_var(1, bytes);
                bytes.push(tag);
                push_var(20, bytes);
            });
            assert!(preflight_update_v1(&bytes, &element_limits).is_err());
        }

        let depth_limits = ServerLimits {
            max_update_nesting_depth: 2,
            ..strict_limits()
        };
        let nested = single_content_block(BLOCK_ANY, |bytes| {
            push_var(1, bytes);
            for _ in 0..3 {
                bytes.push(117);
                push_var(1, bytes);
            }
            bytes.push(126);
        });
        assert!(preflight_update_v1(&nested, &depth_limits).is_err());
    }

    #[test]
    fn checks_nested_embed_and_format_json_counts_and_depth() {
        let element_limits = ServerLimits {
            // One client, one block, and at most three nested JSON values.
            max_update_elements: 5,
            ..strict_limits()
        };
        let depth_limits = ServerLimits {
            max_update_nesting_depth: 2,
            ..strict_limits()
        };

        for info in [BLOCK_EMBED, BLOCK_FORMAT] {
            assert!(
                preflight_update_v1(&single_json_block(info, r#"[0,1,2,3]"#), &element_limits,)
                    .is_err()
            );
            assert!(preflight_update_v1(
                &single_json_block(info, r#"{"a":0,"b":1,"c":2,"d":3}"#),
                &element_limits,
            )
            .is_err());
            assert!(
                preflight_update_v1(&single_json_block(info, r#"[[null]]"#), &depth_limits,)
                    .is_err()
            );

            let valid = single_json_block(info, r#"{"a":[true,null]}"#);
            preflight_update_v1(&valid, &strict_limits()).unwrap();
            Update::decode_v1(&valid).unwrap();
        }
    }

    #[test]
    fn rejects_unknown_content_type_and_any_tags() {
        assert!(preflight_update_v1(&single_content_block(12, |_| {}), &strict_limits()).is_err());
        assert!(preflight_update_v1(
            &single_content_block(BLOCK_TYPE, |bytes| bytes.push(8)),
            &strict_limits()
        )
        .is_err());
        assert!(preflight_update_v1(
            &single_content_block(BLOCK_ANY, |bytes| {
                push_var(1, bytes);
                bytes.push(115);
            }),
            &strict_limits()
        )
        .is_err());
    }

    #[test]
    fn accepts_valid_nested_any_map_and_array() {
        let nested = single_content_block(BLOCK_ANY, |bytes| {
            push_var(1, bytes); // ItemContent::Any length
            bytes.push(118); // map
            push_var(1, bytes);
            push_var(3, bytes);
            bytes.extend_from_slice(b"key");
            bytes.push(117); // array
            push_var(1, bytes);
            bytes.push(126); // null
        });
        preflight_update_v1(&nested, &strict_limits()).unwrap();
        Update::decode_v1(&nested).unwrap();
    }

    #[test]
    fn accepts_checked_in_authoring_doc_fixture() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture {
            yjs_update_v1_base64: String,
        }

        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../fixtures/realtime/authoring-doc-v1.json"
        ))
        .unwrap();
        let bytes = STANDARD.decode(fixture.yjs_update_v1_base64).unwrap();
        preflight_update_v1(&bytes, &ServerLimits::default()).unwrap();
    }

    #[test]
    fn accepts_two_client_text_create_edit_and_delete_updates() {
        fn doc(client_id: u64) -> Doc {
            Doc::with_options(Options {
                offset_kind: OffsetKind::Utf16,
                ..Options::with_client_id(ClientID::new(client_id))
            })
        }

        let alice = doc(101);
        let text = alice.get_or_insert_text("source");
        text.insert(&mut alice.transact_mut(), 0, "Hello 🌿");
        let create = alice
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        preflight_update_v1(&create, &ServerLimits::default()).unwrap();

        let bob = doc(202);
        bob.transact_mut()
            .apply_update(Update::decode_v1(&create).unwrap())
            .unwrap();
        let alice_vector = alice.transact().state_vector();
        let bob_text = bob.get_or_insert_text("source");
        let end = bob_text.get_string(&bob.transact()).encode_utf16().count() as u32;
        bob_text.insert(&mut bob.transact_mut(), end, " from Bob");
        let edit = bob.transact().encode_state_as_update_v1(&alice_vector);
        preflight_update_v1(&edit, &ServerLimits::default()).unwrap();

        alice
            .transact_mut()
            .apply_update(Update::decode_v1(&edit).unwrap())
            .unwrap();
        let bob_vector = bob.transact().state_vector();
        text.remove_range(&mut alice.transact_mut(), 0, 6);
        let delete = alice.transact().encode_state_as_update_v1(&bob_vector);
        preflight_update_v1(&delete, &ServerLimits::default()).unwrap();
    }
}
