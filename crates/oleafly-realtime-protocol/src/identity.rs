use crate::{ContractError, Result};
use serde::{Deserialize, Deserializer, Serialize};
use std::fmt::{Display, Formatter};
use uuid::{Uuid, Variant, Version};

macro_rules! uuid_identity {
    ($name:ident, $kind:literal, $version:expr) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn parse(value: &str) -> Result<Self> {
                let id = Uuid::parse_str(value).map_err(|_| ContractError::InvalidIdentity {
                    kind: $kind,
                    value: value.to_owned(),
                })?;
                let is_canonical = id.hyphenated().to_string() == value;
                let has_supported_version = (1..=8).contains(&id.get_version_num());
                if !is_canonical || id.get_variant() != Variant::RFC4122 || !has_supported_version {
                    return Err(ContractError::InvalidIdentity {
                        kind: $kind,
                        value: value.to_owned(),
                    });
                }
                if let Some(version) = $version {
                    if id.get_version() != Some(version) {
                        return Err(ContractError::InvalidIdentity {
                            kind: $kind,
                            value: value.to_owned(),
                        });
                    }
                }
                Ok(Self(id))
            }

            pub const fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl Display for $name {
            fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::parse(&value).map_err(serde::de::Error::custom)
            }
        }
    };
}

uuid_identity!(ServerInstanceId, "ServerInstanceId", None::<Version>);
uuid_identity!(ServerProfileId, "ServerProfileId", None::<Version>);
uuid_identity!(ActorId, "ActorId", None::<Version>);
uuid_identity!(SharedProjectId, "SharedProjectId", Some(Version::SortRand));
uuid_identity!(ReplicaId, "ReplicaId", Some(Version::SortRand));
uuid_identity!(FileId, "FileId", Some(Version::SortRand));
uuid_identity!(
    ProjectRevisionId,
    "ProjectRevisionId",
    Some(Version::SortRand)
);
uuid_identity!(EditSessionId, "EditSessionId", Some(Version::SortRand));
uuid_identity!(ClientUpdateId, "ClientUpdateId", Some(Version::SortRand));
uuid_identity!(ConflictId, "ConflictId", Some(Version::SortRand));

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ContentDigest(String);

impl ContentDigest {
    pub fn parse(value: &str) -> Result<Self> {
        let digest = value.strip_prefix("sha256:").unwrap_or_default();
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ContractError::InvalidIdentity {
                kind: "ContentDigest",
                value: value.to_owned(),
            });
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for ContentDigest {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for ContentDigest {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteProjectRef {
    pub server_instance_id: ServerInstanceId,
    pub project_id: SharedProjectId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedProjectBinding {
    pub local_project_id: String,
    pub server_profile_id: ServerProfileId,
    pub server_instance_id: ServerInstanceId,
    pub project_id: SharedProjectId,
    pub replica_id: ReplicaId,
    pub state: LocalBindingState,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalBindingState {
    SharingStaging,
    SharingCutover,
    JoiningBootstrap,
    SharedActive,
    RevocationRecovery,
}

/// Origin metadata retained after the live binding and credentials are removed.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClosedSharedProjectRecord {
    pub local_project_id: String,
    pub server_instance_id: ServerInstanceId,
    pub project_id: SharedProjectId,
    pub state: ClosedSharedProjectState,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClosedSharedProjectState {
    SharedClosed,
}

/// A copy is a separately minted solo project and does not mutate its source.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MakeLocalCopyResultV1 {
    pub source: RemoteProjectRef,
    pub source_revision_id: ProjectRevisionId,
    pub minted_local_project_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordered_identities_require_uuid_v7() {
        assert!(FileId::parse("0198cf35-0000-7000-8000-000000000001").is_ok());
        assert!(FileId::parse("a07b6610-5950-4b90-8a29-c9ea207236c8").is_err());
        assert!(ServerInstanceId::parse("a07b6610-5950-4b90-8a29-c9ea207236c8").is_ok());
        assert!(ServerInstanceId::parse("A07B6610-5950-4B90-8A29-C9EA207236C8").is_err());
        assert!(ServerInstanceId::parse("00000000-0000-0000-0000-000000000000").is_err());
        assert!(ContentDigest::parse(
            "sha256:08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48e6eae5f6db9f2e2b9f8cc"
        )
        .is_ok());
        assert!(ContentDigest::parse("sha256:ABC").is_err());
    }
}
