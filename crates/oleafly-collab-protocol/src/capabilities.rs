use crate::ids::ServerId;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const WELL_KNOWN_PATH: &str = "/.well-known/oleafly-server";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolRange {
    pub min: u32,
    pub max: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Github,
    Oidc,
    EmailLink,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub kind: ProviderKind,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionSupport {
    None,
    Allowed,
    Required,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Features {
    pub email: bool,
    pub guests: bool,
    pub link_sharing: bool,
    pub access_logs: bool,
    pub comments: bool,
    pub encryption: EncryptionSupport,
    #[serde(default)]
    pub suggestions: bool,
    #[serde(default)]
    pub chat: bool,
    #[serde(default)]
    pub web: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    pub max_project_mb: u64,
    pub max_file_mb: u64,
    pub max_members_per_project: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityManifest {
    pub server_id: ServerId,
    pub name: String,
    pub icon_url: Option<String>,
    pub version: String,
    pub protocol: ProtocolRange,
    pub needs_setup: bool,
    pub providers: Vec<ProviderInfo>,
    pub features: Features,
    pub limits: Limits,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionMismatch {
    ClientTooOld,
    ServerTooOld,
}

pub fn negotiate(client: ProtocolRange, server: ProtocolRange) -> Result<u32, VersionMismatch> {
    let low = client.min.max(server.min);
    let high = client.max.min(server.max);
    if low <= high {
        Ok(high)
    } else if client.max < server.min {
        Err(VersionMismatch::ClientTooOld)
    } else {
        Err(VersionMismatch::ServerTooOld)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
        "server_id": "01920000-0000-7000-8000-000000000001",
        "name": "Smith Lab",
        "icon_url": null,
        "version": "0.1.0",
        "protocol": { "min": 1, "max": 1 },
        "needs_setup": true,
        "providers": [
            { "id": "github", "kind": "github", "label": "GitHub" },
            { "id": "uni", "kind": "oidc", "label": "University login" }
        ],
        "features": {
            "email": false,
            "guests": false,
            "link_sharing": false,
            "access_logs": false,
            "comments": true,
            "encryption": "none",
            "suggestions": true,
            "chat": true,
            "web": false
        },
        "limits": { "max_project_mb": 200, "max_file_mb": 50, "max_members_per_project": 20 }
    }"#;

    fn manifest() -> CapabilityManifest {
        CapabilityManifest {
            server_id: "01920000-0000-7000-8000-000000000001".parse().unwrap(),
            name: "Smith Lab".to_string(),
            icon_url: None,
            version: "0.1.0".to_string(),
            protocol: ProtocolRange { min: 1, max: 1 },
            needs_setup: true,
            providers: vec![
                ProviderInfo {
                    id: "github".to_string(),
                    kind: ProviderKind::Github,
                    label: "GitHub".to_string(),
                },
                ProviderInfo {
                    id: "uni".to_string(),
                    kind: ProviderKind::Oidc,
                    label: "University login".to_string(),
                },
            ],
            features: Features {
                email: false,
                guests: false,
                link_sharing: false,
                access_logs: false,
                comments: true,
                encryption: EncryptionSupport::None,
                suggestions: true,
                chat: true,
                web: false,
            },
            limits: Limits {
                max_project_mb: 200,
                max_file_mb: 50,
                max_members_per_project: 20,
            },
        }
    }

    #[test]
    fn constants_match_the_spec() {
        assert_eq!(PROTOCOL_VERSION, 1);
        assert_eq!(WELL_KNOWN_PATH, "/.well-known/oleafly-server");
    }

    #[test]
    fn the_manifest_round_trips_through_the_documented_json() {
        let parsed: CapabilityManifest = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(parsed, manifest());
        let expected: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(serde_json::to_value(manifest()).unwrap(), expected);
    }

    #[test]
    fn a_manifest_with_fields_from_a_newer_server_still_parses() {
        let mut value: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        value["motd"] = serde_json::json!("hello");
        value["features"]["presence"] = serde_json::json!(true);
        assert_eq!(
            serde_json::from_value::<CapabilityManifest>(value).unwrap(),
            manifest()
        );
    }

    #[test]
    fn a_manifest_from_an_older_server_has_no_suggestions_chat_or_browser_access() {
        let mut value: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        let features = value["features"].as_object_mut().unwrap();
        for key in ["suggestions", "chat", "web"] {
            features.remove(key);
        }
        let parsed: CapabilityManifest = serde_json::from_value(value).unwrap();
        assert!(!parsed.features.suggestions);
        assert!(!parsed.features.chat);
        assert!(!parsed.features.web);
        assert!(parsed.features.comments);
    }

    #[test]
    fn enums_use_snake_case_names() {
        assert_eq!(
            serde_json::to_string(&ProviderKind::EmailLink).unwrap(),
            "\"email_link\""
        );
        assert_eq!(
            serde_json::to_string(&EncryptionSupport::Allowed).unwrap(),
            "\"allowed\""
        );
        assert_eq!(
            serde_json::to_string(&EncryptionSupport::Required).unwrap(),
            "\"required\""
        );
        assert_eq!(
            serde_json::to_string(&VersionMismatch::ClientTooOld).unwrap(),
            "\"client_too_old\""
        );
    }

    #[test]
    fn kinds_from_a_newer_server_read_as_unknown() {
        assert_eq!(
            serde_json::from_str::<ProviderKind>("\"bitbucket\"").unwrap(),
            ProviderKind::Unknown
        );
        assert_eq!(
            serde_json::from_str::<EncryptionSupport>("\"per_folder\"").unwrap(),
            EncryptionSupport::Unknown
        );
        assert_eq!(
            serde_json::to_string(&ProviderKind::Unknown).unwrap(),
            "\"unknown\""
        );
        assert_eq!(
            serde_json::to_string(&EncryptionSupport::Unknown).unwrap(),
            "\"unknown\""
        );
        let mut value: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        value["providers"][1]["kind"] = serde_json::json!("saml");
        value["features"]["encryption"] = serde_json::json!("per_folder");
        let parsed: CapabilityManifest = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.providers[0].kind, ProviderKind::Github);
        assert_eq!(parsed.providers[1].kind, ProviderKind::Unknown);
        assert_eq!(parsed.features.encryption, EncryptionSupport::Unknown);
        assert_eq!(parsed.protocol, ProtocolRange { min: 1, max: 1 });
    }

    #[test]
    fn negotiate_picks_the_highest_shared_version() {
        let range = |min, max| ProtocolRange { min, max };
        assert_eq!(negotiate(range(1, 1), range(1, 1)), Ok(1));
        assert_eq!(negotiate(range(1, 3), range(2, 5)), Ok(3));
        assert_eq!(negotiate(range(1, 5), range(2, 2)), Ok(2));
        assert_eq!(negotiate(range(2, 4), range(1, 2)), Ok(2));
    }

    #[test]
    fn negotiate_names_the_side_that_needs_an_update() {
        let range = |min, max| ProtocolRange { min, max };
        assert_eq!(
            negotiate(range(1, 1), range(2, 3)),
            Err(VersionMismatch::ClientTooOld)
        );
        assert_eq!(
            negotiate(range(3, 4), range(1, 2)),
            Err(VersionMismatch::ServerTooOld)
        );
    }
}
