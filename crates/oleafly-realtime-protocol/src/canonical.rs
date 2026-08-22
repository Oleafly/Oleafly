use crate::{
    AuthoringDocSnapshotV1, AuthoringNodeSnapshotV1, ContractError, Result,
    CANONICAL_MANIFEST_SCHEMA_VERSION,
};
use serde::Serialize;
use serde_json::{Map, Value};
use unicode_normalization::UnicodeNormalization;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalManifest {
    schema_version: u16,
    nodes: Vec<Value>,
    conflicts: Vec<Value>,
}

pub fn canonical_authoring_manifest_v1(snapshot: &AuthoringDocSnapshotV1) -> Result<String> {
    if snapshot.schema_version != crate::AUTHORING_DOC_SCHEMA_VERSION {
        return Err(ContractError::InvalidCanonicalManifest(format!(
            "unsupported AuthoringDoc schema version: {}",
            snapshot.schema_version
        )));
    }
    let mut node_refs: Vec<_> = snapshot.nodes.iter().collect();
    node_refs.sort_by_key(|node| node.file_id());
    let nodes = node_refs
        .into_iter()
        .map(canonical_node)
        .collect::<Result<Vec<_>>>()?;
    let conflicts = snapshot
        .conflicts
        .iter()
        .map(|conflict| {
            serde_json::to_value(conflict)
                .map_err(|error| ContractError::InvalidCanonicalManifest(error.to_string()))
                .and_then(canonical_json_value)
        })
        .collect::<Result<Vec<_>>>()?;
    serde_json::to_string(&CanonicalManifest {
        schema_version: CANONICAL_MANIFEST_SCHEMA_VERSION,
        nodes,
        conflicts,
    })
    .map_err(|error| ContractError::InvalidCanonicalManifest(error.to_string()))
}

fn canonical_json_value(value: Value) -> Result<Value> {
    match value {
        Value::Array(values) => Ok(Value::Array(
            values
                .into_iter()
                .map(canonical_json_value)
                .collect::<Result<Vec<_>>>()?,
        )),
        Value::Object(values) => {
            let mut entries: Vec<_> = values.into_iter().collect();
            entries.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
            let mut result = Map::new();
            for (key, value) in entries {
                result.insert(key, canonical_json_value(value)?);
            }
            Ok(Value::Object(result))
        }
        other => Ok(other),
    }
}

fn canonical_node(node: &AuthoringNodeSnapshotV1) -> Result<Value> {
    let serialized = serde_json::to_value(node)
        .map_err(|error| ContractError::InvalidCanonicalManifest(error.to_string()))?;
    let source = serialized.as_object().ok_or_else(|| {
        ContractError::InvalidCanonicalManifest("authoring node is not an object".to_owned())
    })?;
    let mut result = Map::new();
    for key in [
        "fileId",
        "parentId",
        "name",
        "collisionKey",
        "tombstone",
        "kind",
        "text",
        "binaryHeads",
    ] {
        if let Some(value) = source.get(key) {
            let value = if key == "binaryHeads" {
                let mut values = value.as_array().cloned().unwrap_or_default();
                values.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
                Value::Array(values)
            } else {
                value.clone()
            };
            result.insert(key.to_owned(), value);
        }
    }
    Ok(Value::Object(result))
}

pub fn portable_collision_key(path: &str) -> String {
    path.replace('\\', "/")
        .nfc()
        .map(|character| match character {
            'A'..='Z' => char::from_u32(character as u32 + 32).expect("ASCII lowercase"),
            _ => character,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collision_keys_normalize_separator_case_and_nfc() {
        assert_eq!(
            portable_collision_key("Sections\\CAFE\u{301}.tex"),
            "sections/cafÉ.tex"
        );
        assert_eq!(portable_collision_key("İΣß.TEX"), "İΣß.tex");
    }
}
