use serde::{Deserialize, Serialize};

use crate::projects::PersonSummary;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessKind {
    Opened,
    Joined,
    Downloaded,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JoinedVia {
    Link,
    Share,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessEntry {
    pub id: i64,
    pub kind: AccessKind,
    pub via: Option<JoinedVia>,
    pub person: PersonSummary,
    pub device_name: String,
    pub at: i64,
    pub last_at: i64,
    pub times: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";

    fn round_trip<T>(value: T, wire: Value)
    where
        T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug,
    {
        assert_eq!(serde_json::to_value(&value).unwrap(), wire);
        assert_eq!(serde_json::from_value::<T>(wire).unwrap(), value);
    }

    #[test]
    fn an_access_entry_matches_its_wire_json() {
        round_trip(
            AccessEntry {
                id: 7,
                kind: AccessKind::Joined,
                via: Some(JoinedVia::Link),
                person: PersonSummary {
                    account_id: ACCOUNT.parse().unwrap(),
                    display_name: "Carol Smith".to_string(),
                    avatar_url: None,
                    email: Some("carol@uni.edu".to_string()),
                    login: None,
                    guest: false,
                    active: true,
                },
                device_name: "Carol's laptop".to_string(),
                at: 5,
                last_at: 9,
                times: 3,
            },
            json!({
                "id": 7,
                "kind": "joined",
                "via": "link",
                "person": {
                    "account_id": ACCOUNT,
                    "display_name": "Carol Smith",
                    "avatar_url": null,
                    "email": "carol@uni.edu",
                    "login": null
                },
                "device_name": "Carol's laptop",
                "at": 5,
                "last_at": 9,
                "times": 3
            }),
        );
    }

    #[test]
    fn every_kind_and_way_in_has_a_stable_name() {
        for (kind, name) in [
            (AccessKind::Opened, "opened"),
            (AccessKind::Joined, "joined"),
            (AccessKind::Downloaded, "downloaded"),
        ] {
            round_trip(kind, json!(name));
        }
        for (via, name) in [(JoinedVia::Link, "link"), (JoinedVia::Share, "share")] {
            round_trip(via, json!(name));
        }
    }

    #[test]
    fn names_from_a_newer_server_read_as_unknown() {
        assert_eq!(
            serde_json::from_value::<AccessKind>(json!("printed")).unwrap(),
            AccessKind::Unknown
        );
        assert_eq!(
            serde_json::from_value::<JoinedVia>(json!("carrier_pigeon")).unwrap(),
            JoinedVia::Unknown
        );
    }
}
