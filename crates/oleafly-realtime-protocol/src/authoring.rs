use crate::{
    portable_collision_key, ConflictId, ContentDigest, ContractError, FileId, RealtimeLimitsV1,
    Result, AUTHORING_DOC_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use unicode_normalization::UnicodeNormalization;
use yrs::types::ToJson;
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Array, ClientID, Doc, GetString, Map, OffsetKind, Options, Out, ReadTxn, StateVector,
    Transact, Update,
};

pub const AUTHORING_CONFLICT_SCHEMA_VERSION: u16 = 1;

pub const AUTHORING_ROOTS: AuthoringRoots = AuthoringRoots {
    metadata: "authoring",
    nodes: "nodes",
    texts: "texts",
    binary_heads: "binary_heads",
    conflicts: "conflicts",
};

pub const AUTHORING_METADATA_KEYS: AuthoringMetadataKeys = AuthoringMetadataKeys {
    schema_version: "schema_version",
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthoringRoots {
    pub metadata: &'static str,
    pub nodes: &'static str,
    pub texts: &'static str,
    pub binary_heads: &'static str,
    pub conflicts: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthoringMetadataKeys {
    pub schema_version: &'static str,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthoringDocSnapshotV1 {
    pub schema_version: u16,
    pub nodes: Vec<AuthoringNodeSnapshotV1>,
    pub conflicts: Vec<AuthoringConflictRecordV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AuthoringNodeSnapshotV1 {
    Directory {
        file_id: FileId,
        parent_id: Option<FileId>,
        name: String,
        collision_key: String,
        tombstone: bool,
    },
    Text {
        file_id: FileId,
        parent_id: Option<FileId>,
        name: String,
        collision_key: String,
        tombstone: bool,
        text: String,
    },
    Binary {
        file_id: FileId,
        parent_id: Option<FileId>,
        name: String,
        collision_key: String,
        tombstone: bool,
        binary_heads: Vec<ContentDigest>,
    },
}

impl AuthoringNodeSnapshotV1 {
    pub const fn file_id(&self) -> FileId {
        match self {
            Self::Directory { file_id, .. }
            | Self::Text { file_id, .. }
            | Self::Binary { file_id, .. } => *file_id,
        }
    }

    pub const fn parent_id(&self) -> Option<FileId> {
        match self {
            Self::Directory { parent_id, .. }
            | Self::Text { parent_id, .. }
            | Self::Binary { parent_id, .. } => *parent_id,
        }
    }

    pub fn collision_key(&self) -> &str {
        match self {
            Self::Directory { collision_key, .. }
            | Self::Text { collision_key, .. }
            | Self::Binary { collision_key, .. } => collision_key,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Self::Directory { name, .. } | Self::Text { name, .. } | Self::Binary { name, .. } => {
                name
            }
        }
    }

    pub const fn tombstone(&self) -> bool {
        match self {
            Self::Directory { tombstone, .. }
            | Self::Text { tombstone, .. }
            | Self::Binary { tombstone, .. } => *tombstone,
        }
    }

    pub const fn is_directory(&self) -> bool {
        matches!(self, Self::Directory { .. })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AuthoringConflictRecordV1 {
    PathCollision {
        schema_version: u16,
        conflict_id: ConflictId,
        parent_id: Option<FileId>,
        collision_key: String,
        file_ids: Vec<FileId>,
    },
    BinaryHeads {
        schema_version: u16,
        conflict_id: ConflictId,
        file_id: FileId,
        heads: Vec<ContentDigest>,
    },
    DeleteVsEdit {
        schema_version: u16,
        conflict_id: ConflictId,
        file_id: FileId,
        recovery_copy_file_id: FileId,
    },
    RenameLoser {
        schema_version: u16,
        conflict_id: ConflictId,
        file_id: FileId,
        losing_name: String,
        winning_name: String,
    },
}

impl AuthoringConflictRecordV1 {
    const fn schema_version(&self) -> u16 {
        match self {
            Self::PathCollision { schema_version, .. }
            | Self::BinaryHeads { schema_version, .. }
            | Self::DeleteVsEdit { schema_version, .. }
            | Self::RenameLoser { schema_version, .. } => *schema_version,
        }
    }

    const fn conflict_id(&self) -> ConflictId {
        match self {
            Self::PathCollision { conflict_id, .. }
            | Self::BinaryHeads { conflict_id, .. }
            | Self::DeleteVsEdit { conflict_id, .. }
            | Self::RenameLoser { conflict_id, .. } => *conflict_id,
        }
    }
}

/// Creates an empty `yrs::Doc` configured for Yjs-compatible UTF-16 offsets.
/// JavaScript must apply the semantic AuthoringDoc roots and schema update.
pub fn authoring_doc() -> Doc {
    Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::default()
    })
}

/// Test/transport constructor with a fixed client ID. It creates no Yjs roots.
pub fn authoring_doc_with_client_id(client_id: u64) -> Doc {
    Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::with_client_id(ClientID::new(client_id))
    })
}

pub fn apply_update_v1(doc: &Doc, bytes: &[u8]) -> Result<()> {
    apply_update_v1_with_limits(doc, bytes, RealtimeLimitsV1::default())
}

pub fn apply_update_v1_with_limits(
    doc: &Doc,
    bytes: &[u8],
    limits: RealtimeLimitsV1,
) -> Result<()> {
    let limits = limits.validate()?;
    if bytes.len() > limits.max_yjs_update_bytes {
        return Err(ContractError::InvalidUpdate(
            "Yjs update exceeds the configured limit".to_owned(),
        ));
    }
    let update = Update::decode_v1(bytes)
        .map_err(|error| ContractError::InvalidUpdate(error.to_string()))?;
    let current = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    let candidate = authoring_doc();
    register_authoring_roots(&candidate);
    candidate
        .transact_mut()
        .apply_update(
            Update::decode_v1(&current)
                .map_err(|error| ContractError::InvalidUpdate(error.to_string()))?,
        )
        .map_err(|error| ContractError::InvalidUpdate(error.to_string()))?;
    candidate
        .transact_mut()
        .apply_update(update)
        .map_err(|error| ContractError::InvalidUpdate(error.to_string()))?;
    snapshot_authoring_doc_v1(&candidate)?;
    register_authoring_roots(doc);
    doc.transact_mut()
        .apply_update(
            Update::decode_v1(bytes)
                .map_err(|error| ContractError::InvalidUpdate(error.to_string()))?,
        )
        .map_err(|error| ContractError::InvalidUpdate(error.to_string()))
}

fn register_authoring_roots(doc: &Doc) {
    doc.get_or_insert_map(AUTHORING_ROOTS.metadata);
    doc.get_or_insert_map(AUTHORING_ROOTS.nodes);
    doc.get_or_insert_map(AUTHORING_ROOTS.texts);
    doc.get_or_insert_map(AUTHORING_ROOTS.binary_heads);
    doc.get_or_insert_array(AUTHORING_ROOTS.conflicts);
}

pub fn snapshot_authoring_doc_v1(doc: &Doc) -> Result<AuthoringDocSnapshotV1> {
    let txn = doc.transact();
    for (name, _) in txn.root_refs() {
        if !matches!(
            name,
            "authoring" | "nodes" | "texts" | "binary_heads" | "conflicts"
        ) {
            return Err(invalid_doc(format!(
                "AuthoringDoc has unknown root: {name}"
            )));
        }
    }
    let metadata = txn.get_map(AUTHORING_ROOTS.metadata).ok_or_else(|| {
        ContractError::InvalidAuthoringDoc("AuthoringDoc is missing metadata".to_owned())
    })?;
    let schema_version = any_u16(
        metadata.get(&txn, AUTHORING_METADATA_KEYS.schema_version),
        "schema_version",
    )?;
    if schema_version != AUTHORING_DOC_SCHEMA_VERSION {
        return Err(ContractError::InvalidAuthoringDoc(format!(
            "unsupported AuthoringDoc schema version: {schema_version}"
        )));
    }
    for (key, _) in metadata.iter(&txn) {
        if key != AUTHORING_METADATA_KEYS.schema_version {
            return Err(invalid_doc(format!(
                "AuthoringDoc metadata has unknown key: {key}"
            )));
        }
    }
    let node_map = txn.get_map(AUTHORING_ROOTS.nodes).ok_or_else(|| {
        ContractError::InvalidAuthoringDoc("AuthoringDoc is missing nodes".to_owned())
    })?;
    let texts = txn.get_map(AUTHORING_ROOTS.texts).ok_or_else(|| {
        ContractError::InvalidAuthoringDoc("AuthoringDoc is missing texts".to_owned())
    })?;
    let binary_heads = txn.get_map(AUTHORING_ROOTS.binary_heads).ok_or_else(|| {
        ContractError::InvalidAuthoringDoc("AuthoringDoc is missing binary heads".to_owned())
    })?;
    let mut nodes = Vec::with_capacity(node_map.len(&txn) as usize);
    let mut text_ids = BTreeSet::new();
    let mut binary_ids = BTreeSet::new();

    for (file_id_value, node_value) in node_map.iter(&txn) {
        let file_id = FileId::parse(file_id_value)?;
        let node = match node_value {
            Out::YMap(node) => node,
            _ => {
                return Err(ContractError::InvalidAuthoringDoc(format!(
                    "AuthoringDoc node {file_id} is not a Y.Map"
                )))
            }
        };
        for (key, _) in node.iter(&txn) {
            if !matches!(
                key,
                "parent_id" | "name" | "collision_key" | "tombstone" | "kind"
            ) {
                return Err(invalid_doc(format!(
                    "AuthoringDoc node {file_id} has unknown key: {key}"
                )));
            }
        }
        let parent_id = match node.get(&txn, "parent_id") {
            None | Some(Out::Any(Any::Null | Any::Undefined)) => None,
            value => Some(FileId::parse(&out_string(value, "parent_id")?)?),
        };
        let name = out_string(node.get(&txn, "name"), "name")?;
        let collision_key = out_string(node.get(&txn, "collision_key"), "collision_key")?;
        validate_node_name(file_id, &name, &collision_key)?;
        let tombstone = out_bool(node.get(&txn, "tombstone"), "tombstone")?;
        let kind = out_string(node.get(&txn, "kind"), "kind")?;
        let snapshot = match kind.as_str() {
            "directory" => AuthoringNodeSnapshotV1::Directory {
                file_id,
                parent_id,
                name,
                collision_key,
                tombstone,
            },
            "text" => {
                text_ids.insert(file_id);
                let text = match texts.get(&txn, &file_id.to_string()) {
                    Some(Out::YText(text)) => text,
                    _ => {
                        return Err(ContractError::InvalidAuthoringDoc(format!(
                            "AuthoringDoc text node {file_id} has no Y.Text"
                        )))
                    }
                };
                AuthoringNodeSnapshotV1::Text {
                    file_id,
                    parent_id,
                    name,
                    collision_key,
                    tombstone,
                    text: text.get_string(&txn),
                }
            }
            "binary" => {
                binary_ids.insert(file_id);
                let heads = match binary_heads.get(&txn, &file_id.to_string()) {
                    Some(Out::YArray(heads)) => heads,
                    _ => {
                        return Err(ContractError::InvalidAuthoringDoc(format!(
                            "AuthoringDoc binary node {file_id} has no head array"
                        )))
                    }
                };
                let mut values = Vec::with_capacity(heads.len(&txn) as usize);
                for value in heads.iter(&txn) {
                    values.push(ContentDigest::parse(&out_string(
                        Some(value),
                        "binary head",
                    )?)?);
                }
                AuthoringNodeSnapshotV1::Binary {
                    file_id,
                    parent_id,
                    name,
                    collision_key,
                    tombstone,
                    binary_heads: values,
                }
            }
            _ => {
                return Err(ContractError::InvalidAuthoringDoc(format!(
                    "unsupported AuthoringDoc node kind: {kind}"
                )))
            }
        };
        nodes.push(snapshot);
    }
    for (file_id, value) in texts.iter(&txn) {
        let parsed = FileId::parse(file_id)?;
        if !text_ids.contains(&parsed) || !matches!(value, Out::YText(_)) {
            return Err(invalid_doc(format!(
                "AuthoringDoc has orphan or invalid text root: {file_id}"
            )));
        }
    }
    for (file_id, value) in binary_heads.iter(&txn) {
        let parsed = FileId::parse(file_id)?;
        if !binary_ids.contains(&parsed) || !matches!(value, Out::YArray(_)) {
            return Err(invalid_doc(format!(
                "AuthoringDoc has orphan or invalid binary-head root: {file_id}"
            )));
        }
    }
    nodes.sort_by_key(AuthoringNodeSnapshotV1::file_id);

    let conflicts = txn
        .get_array(AUTHORING_ROOTS.conflicts)
        .ok_or_else(|| {
            ContractError::InvalidAuthoringDoc("AuthoringDoc is missing conflicts".to_owned())
        })?
        .iter(&txn)
        .map(|value| {
            let json = serde_json::to_value(match value {
                Out::Any(any) => any,
                other => other.to_json(&txn),
            })
            .map_err(|error| ContractError::InvalidAuthoringDoc(error.to_string()))?;
            serde_json::from_value(json)
                .map_err(|error| ContractError::InvalidAuthoringDoc(error.to_string()))
        })
        .collect::<Result<Vec<AuthoringConflictRecordV1>>>()?;

    validate_materializable_tree_v1(&nodes, &conflicts)?;
    Ok(AuthoringDocSnapshotV1 {
        schema_version,
        nodes,
        conflicts,
    })
}

pub fn validate_materializable_tree_v1(
    nodes: &[AuthoringNodeSnapshotV1],
    conflicts: &[AuthoringConflictRecordV1],
) -> Result<()> {
    let by_id: BTreeMap<_, _> = nodes.iter().map(|node| (node.file_id(), node)).collect();
    if by_id.len() != nodes.len() {
        return Err(invalid_doc("AuthoringDoc repeats a FileId"));
    }

    let mut conflict_ids = BTreeSet::new();
    for conflict in conflicts {
        if conflict.schema_version() != AUTHORING_CONFLICT_SCHEMA_VERSION {
            return Err(invalid_doc(format!(
                "unsupported AuthoringDoc conflict schema version: {}",
                conflict.schema_version()
            )));
        }
        if !conflict_ids.insert(conflict.conflict_id()) {
            return Err(invalid_doc(format!(
                "duplicate AuthoringDoc conflict ID: {}",
                conflict.conflict_id()
            )));
        }
        match conflict {
            AuthoringConflictRecordV1::PathCollision { file_ids, .. } if file_ids.len() < 2 => {
                return Err(invalid_doc(
                    "path collision conflicts need at least two files",
                ));
            }
            AuthoringConflictRecordV1::BinaryHeads { heads, .. } if heads.len() < 2 => {
                return Err(invalid_doc("binary head conflicts need at least two heads"));
            }
            AuthoringConflictRecordV1::RenameLoser {
                file_id,
                losing_name,
                winning_name,
                ..
            } => {
                validate_node_name(*file_id, losing_name, &portable_collision_key(losing_name))?;
                validate_node_name(
                    *file_id,
                    winning_name,
                    &portable_collision_key(winning_name),
                )?;
            }
            _ => {}
        }
    }

    for node in nodes.iter().filter(|node| !node.tombstone()) {
        validate_node_name(node.file_id(), node.name(), node.collision_key())?;
        if let Some(parent_id) = node.parent_id() {
            let parent = by_id.get(&parent_id).ok_or_else(|| {
                invalid_doc(format!(
                    "AuthoringDoc node {} has a missing parent",
                    node.file_id()
                ))
            })?;
            if parent.tombstone() || !parent.is_directory() {
                return Err(invalid_doc(format!(
                    "AuthoringDoc node {} has a non-directory or deleted parent",
                    node.file_id()
                )));
            }
        }
        let mut visited = HashSet::from([node.file_id()]);
        let mut parent_id = node.parent_id();
        while let Some(parent) = parent_id {
            if !visited.insert(parent) {
                return Err(invalid_doc(format!(
                    "AuthoringDoc node {} is in a parent cycle",
                    node.file_id()
                )));
            }
            parent_id = by_id.get(&parent).and_then(|value| value.parent_id());
        }
        if let AuthoringNodeSnapshotV1::Binary {
            file_id,
            binary_heads,
            ..
        } = node
        {
            let unique: BTreeSet<_> = binary_heads.iter().collect();
            if unique.len() != binary_heads.len() {
                return Err(invalid_doc(format!(
                    "AuthoringDoc binary node {file_id} repeats a binary head"
                )));
            }
            if binary_heads.len() > 1
                && !conflicts.iter().any(|conflict| match conflict {
                    AuthoringConflictRecordV1::BinaryHeads {
                        file_id: conflict_file_id,
                        heads,
                        ..
                    } => conflict_file_id == file_id && sorted_eq(heads, binary_heads),
                    _ => false,
                })
            {
                return Err(invalid_doc(format!(
                    "AuthoringDoc binary node {file_id} has unresolved heads without a typed conflict"
                )));
            }
        }
    }

    let mut siblings: BTreeMap<(Option<FileId>, String), Vec<FileId>> = BTreeMap::new();
    for node in nodes.iter().filter(|node| !node.tombstone()) {
        siblings
            .entry((node.parent_id(), node.collision_key().to_owned()))
            .or_default()
            .push(node.file_id());
    }
    for ((parent_id, collision_key), file_ids) in siblings {
        if file_ids.len() < 2 {
            continue;
        }
        let covered = conflicts.iter().any(|conflict| match conflict {
            AuthoringConflictRecordV1::PathCollision {
                parent_id: conflict_parent,
                collision_key: conflict_key,
                file_ids: conflict_files,
                ..
            } => {
                *conflict_parent == parent_id
                    && conflict_key == &collision_key
                    && sorted_eq(conflict_files, &file_ids)
            }
            _ => false,
        });
        if !covered {
            return Err(invalid_doc(format!(
                "active siblings collide at portable key {collision_key}"
            )));
        }
    }
    Ok(())
}

fn sorted_eq<T: Ord + Clone>(left: &[T], right: &[T]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort();
    right.sort();
    left == right
}

fn any_u16(value: Option<Out>, field: &str) -> Result<u16> {
    match value {
        Some(Out::Any(Any::Number(value)))
            if value.fract() == 0.0 && value >= 0.0 && value <= f64::from(u16::MAX) =>
        {
            Ok(value as u16)
        }
        Some(Out::Any(Any::BigInt(value))) => u16::try_from(value)
            .map_err(|_| invalid_doc(format!("{field} is outside the u16 range"))),
        _ => Err(invalid_doc(format!("{field} is not an integer"))),
    }
}

fn validate_node_name(file_id: FileId, name: &str, collision_key: &str) -> Result<()> {
    let normalized: String = name.nfc().collect();
    let invalid_character = name.chars().any(|character| {
        character <= '\u{1f}'
            || ('\u{7f}'..='\u{9f}').contains(&character)
            || matches!(
                character,
                '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
            )
    });
    let base = name.split('.').next().unwrap_or_default();
    let folded_base = portable_collision_key(base);
    let reserved = matches!(folded_base.as_str(), "con" | "prn" | "aux" | "nul")
        || (folded_base.len() == 4
            && (folded_base.starts_with("com") || folded_base.starts_with("lpt"))
            && matches!(folded_base.as_bytes()[3], b'1'..=b'9'));
    if name.is_empty()
        || normalized != name
        || matches!(name, "." | "..")
        || invalid_character
        || name.ends_with('.')
        || name.ends_with(' ')
        || reserved
    {
        return Err(invalid_doc(format!(
            "AuthoringDoc node {file_id} has an invalid portable name"
        )));
    }
    if portable_collision_key(name) != collision_key {
        return Err(invalid_doc(format!(
            "AuthoringDoc node {file_id} has an invalid collision key"
        )));
    }
    Ok(())
}

fn out_string(value: Option<Out>, field: &str) -> Result<String> {
    match value {
        Some(Out::Any(Any::String(value))) => Ok(value.to_string()),
        _ => Err(invalid_doc(format!("{field} is not a string"))),
    }
}

fn out_bool(value: Option<Out>, field: &str) -> Result<bool> {
    match value {
        Some(Out::Any(Any::Bool(value))) => Ok(value),
        _ => Err(invalid_doc(format!("{field} is not a boolean"))),
    }
}

fn invalid_doc(message: impl Into<String>) -> ContractError {
    ContractError::InvalidAuthoringDoc(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(value: &str) -> FileId {
        FileId::parse(value).unwrap()
    }

    fn text(file_id: FileId, parent_id: Option<FileId>, name: &str) -> AuthoringNodeSnapshotV1 {
        AuthoringNodeSnapshotV1::Text {
            file_id,
            parent_id,
            name: name.to_owned(),
            collision_key: portable_collision_key(name),
            tombstone: false,
            text: String::new(),
        }
    }

    fn directory(
        file_id: FileId,
        parent_id: Option<FileId>,
        name: &str,
    ) -> AuthoringNodeSnapshotV1 {
        AuthoringNodeSnapshotV1::Directory {
            file_id,
            parent_id,
            name: name.to_owned(),
            collision_key: portable_collision_key(name),
            tombstone: false,
        }
    }

    #[test]
    fn rejects_non_materializable_portable_names() {
        let id = file("0198cf35-0000-7000-8000-000000000021");
        for name in [
            "",
            ".",
            "CON",
            "bad?.tex",
            "trail. ",
            "child/name",
            "bad\u{85}.tex",
        ] {
            let nodes = [text(id, None, name)];
            assert!(
                validate_materializable_tree_v1(&nodes, &[]).is_err(),
                "{name}"
            );
        }
    }

    #[test]
    fn rejects_missing_non_directory_and_cyclic_parents() {
        let first = file("0198cf35-0000-7000-8000-000000000021");
        let second = file("0198cf35-0000-7000-8000-000000000022");
        assert!(
            validate_materializable_tree_v1(&[text(first, Some(second), "a.tex")], &[]).is_err()
        );
        assert!(validate_materializable_tree_v1(
            &[
                directory(first, Some(second), "a"),
                directory(second, Some(first), "b")
            ],
            &[]
        )
        .is_err());
    }

    #[test]
    fn sibling_collisions_require_the_matching_typed_record() {
        let first = file("0198cf35-0000-7000-8000-000000000021");
        let second = file("0198cf35-0000-7000-8000-000000000022");
        let nodes = [
            text(first, None, "README.tex"),
            text(second, None, "readme.tex"),
        ];
        assert!(validate_materializable_tree_v1(&nodes, &[]).is_err());
        let conflicts = [AuthoringConflictRecordV1::PathCollision {
            schema_version: AUTHORING_CONFLICT_SCHEMA_VERSION,
            conflict_id: ConflictId::parse("0198cf35-0000-7000-8000-000000000023").unwrap(),
            parent_id: None,
            collision_key: "readme.tex".to_owned(),
            file_ids: vec![second, first],
        }];
        assert!(validate_materializable_tree_v1(&nodes, &conflicts).is_ok());
    }

    #[test]
    fn conflict_records_are_strict_and_versioned() {
        let arbitrary = r#"{
            "schemaVersion": 1,
            "conflictId": "0198cf35-0000-7000-8000-000000000023",
            "kind": "rename_loser",
            "fileId": "0198cf35-0000-7000-8000-000000000021",
            "losingName": "old.tex",
            "winningName": "new.tex",
            "arbitrary": true
        }"#;
        assert!(serde_json::from_str::<AuthoringConflictRecordV1>(arbitrary).is_err());
    }
}
