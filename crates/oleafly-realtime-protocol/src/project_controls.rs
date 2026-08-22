use crate::FileId;
use serde::{Deserialize, Serialize};

pub const PROJECT_CONTROLS_SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectControlsSnapshotV1 {
    #[serde(deserialize_with = "deserialize_schema_version")]
    pub schema_version: u16,
    #[serde(with = "crate::canonical_u64")]
    pub version: u64,
    pub main_file_id: Option<FileId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProjectControlCommandV1 {
    SetMainFile {
        #[serde(with = "crate::canonical_u64")]
        expected_version: u64,
        main_file_id: Option<FileId>,
    },
}

fn deserialize_schema_version<'de, D>(deserializer: D) -> Result<u16, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let version = u16::deserialize(deserializer)?;
    if version != PROJECT_CONTROLS_SCHEMA_VERSION {
        return Err(serde::de::Error::custom(format!(
            "unsupported project-controls schema version: {version}"
        )));
    }
    Ok(version)
}
