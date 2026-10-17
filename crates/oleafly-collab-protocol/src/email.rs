use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailFailure {
    pub at: i64,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailStatus {
    pub configured: bool,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub notifications: bool,
    #[serde(default)]
    pub last_failure: Option<EmailFailure>,
    // Whether email is known to get through: a connection check passed or
    // an email was delivered. An older server doesn't say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailTestResult {
    pub sent_to: Vec<String>,
    pub delivered: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailPreferences {
    #[serde(default = "on")]
    pub shared_with_you: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentions: Option<bool>,
    #[serde(default)]
    pub mail_configured: bool,
    #[serde(default)]
    pub notifications: bool,
}

fn on() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailPreferencesPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_with_you: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentions: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn replies_from_an_older_server_still_parse() {
        let status: EmailStatus = serde_json::from_value(json!({ "configured": false })).unwrap();
        assert_eq!(
            status,
            EmailStatus {
                configured: false,
                from: None,
                notifications: false,
                last_failure: None,
                working: None,
            }
        );
        let preferences: EmailPreferences = serde_json::from_value(json!({})).unwrap();
        assert!(preferences.shared_with_you);
        assert!(!preferences.mail_configured);
        assert!(!preferences.notifications);
        let result: EmailTestResult =
            serde_json::from_value(json!({ "sent_to": ["ada@uni.edu"], "delivered": true }))
                .unwrap();
        assert_eq!(result.error, None);
        let patch: EmailPreferencesPatch = serde_json::from_value(json!({})).unwrap();
        assert_eq!(patch, EmailPreferencesPatch::default());
    }

    #[test]
    fn an_older_server_has_no_mention_setting_and_a_newer_one_names_it() {
        let older: EmailPreferences =
            serde_json::from_value(json!({ "shared_with_you": true })).unwrap();
        assert_eq!(older.mentions, None);
        let newer: EmailPreferences = serde_json::from_value(
            json!({ "shared_with_you": true, "mentions": false, "mail_configured": true }),
        )
        .unwrap();
        assert_eq!(newer.mentions, Some(false));
        assert_eq!(
            serde_json::to_value(newer).unwrap()["mentions"],
            json!(false)
        );
        assert_eq!(
            serde_json::to_value(EmailPreferencesPatch {
                mentions: Some(false),
                ..EmailPreferencesPatch::default()
            })
            .unwrap(),
            json!({ "mentions": false })
        );
    }

    #[test]
    fn a_patch_sends_only_what_changes_and_status_round_trips() {
        assert_eq!(
            serde_json::to_value(EmailPreferencesPatch::default()).unwrap(),
            json!({})
        );
        assert_eq!(
            serde_json::to_value(EmailPreferencesPatch {
                shared_with_you: Some(false),
                ..EmailPreferencesPatch::default()
            })
            .unwrap(),
            json!({ "shared_with_you": false })
        );
        let status = EmailStatus {
            configured: true,
            from: Some("Smith Lab <lab@uni.edu>".to_string()),
            notifications: true,
            last_failure: Some(EmailFailure {
                at: 1_760_000_000_000,
                message: "Connection refused".to_string(),
            }),
            working: Some(false),
        };
        let text = serde_json::to_string(&status).unwrap();
        assert_eq!(serde_json::from_str::<EmailStatus>(&text).unwrap(), status);
    }
}
