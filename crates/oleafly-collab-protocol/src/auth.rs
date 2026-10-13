use crate::ids::{AccountId, DeviceId, ServerId};
use crate::roles::ServerRole;
use serde::{Deserialize, Serialize};
use std::fmt;

const CHALLENGE_DOMAIN: &[u8] = b"oleafly-collab/v1\0";
const REDACTED: &str = "[redacted]";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ChallengePurpose {
    Token,
    Refresh,
    Socket,
}

impl ChallengePurpose {
    fn label(self) -> &'static str {
        match self {
            ChallengePurpose::Token => "token",
            ChallengePurpose::Refresh => "refresh",
            ChallengePurpose::Socket => "socket",
        }
    }
}

pub fn challenge_message(purpose: ChallengePurpose, server_id: ServerId, nonce: &str) -> Vec<u8> {
    let server = server_id.to_string();
    let label = purpose.label();
    let mut message =
        Vec::with_capacity(CHALLENGE_DOMAIN.len() + label.len() + server.len() + nonce.len() + 2);
    message.extend_from_slice(CHALLENGE_DOMAIN);
    message.extend_from_slice(label.as_bytes());
    message.push(0);
    message.extend_from_slice(server.as_bytes());
    message.push(0);
    message.extend_from_slice(nonce.as_bytes());
    message
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthStartQuery {
    pub provider: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_challenge: String,
    pub device_public_key: String,
    pub device_name: String,
    pub platform: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChallengeResponse {
    pub nonce: String,
    pub expires_at: i64,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenRequest {
    pub code: String,
    pub code_verifier: String,
    pub device_public_key: String,
    pub nonce: String,
    pub signature: String,
}

impl fmt::Debug for TokenRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TokenRequest")
            .field("code", &REDACTED)
            .field("code_verifier", &REDACTED)
            .field("device_public_key", &self.device_public_key)
            .field("nonce", &self.nonce)
            .field("signature", &self.signature)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
    pub device_id: DeviceId,
    pub nonce: String,
    pub signature: String,
}

impl fmt::Debug for RefreshRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RefreshRequest")
            .field("refresh_token", &REDACTED)
            .field("device_id", &self.device_id)
            .field("nonce", &self.nonce)
            .field("signature", &self.signature)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionTokens {
    pub account_id: AccountId,
    pub device_id: DeviceId,
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
}

impl fmt::Debug for SessionTokens {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionTokens")
            .field("account_id", &self.account_id)
            .field("device_id", &self.device_id)
            .field("access_token", &REDACTED)
            .field("access_expires_at", &self.access_expires_at)
            .field("refresh_token", &REDACTED)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountSummary {
    pub account_id: AccountId,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub server_role: ServerRole,
    pub emails: Vec<String>,
    pub logins: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceSummary {
    pub device_id: DeviceId,
    pub name: String,
    pub platform: String,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
    pub current: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthErrorCode {
    NotAdmitted,
    InvalidCode,
    InvalidSignature,
    ExpiredNonce,
    InvalidRedirect,
    UnknownProvider,
    ProviderFailed,
    RefreshReused,
    Revoked,
    SetupCodeInvalid,
    SignInCancelled,
}

impl AuthErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthErrorCode::NotAdmitted => "not_admitted",
            AuthErrorCode::InvalidCode => "invalid_code",
            AuthErrorCode::InvalidSignature => "invalid_signature",
            AuthErrorCode::ExpiredNonce => "expired_nonce",
            AuthErrorCode::InvalidRedirect => "invalid_redirect",
            AuthErrorCode::UnknownProvider => "unknown_provider",
            AuthErrorCode::ProviderFailed => "provider_failed",
            AuthErrorCode::RefreshReused => "refresh_reused",
            AuthErrorCode::Revoked => "revoked",
            AuthErrorCode::SetupCodeInvalid => "setup_code_invalid",
            AuthErrorCode::SignInCancelled => "sign_in_cancelled",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEndReason {
    AccountSuspended,
    AccessEnded,
    #[serde(other)]
    Unknown,
}

impl SessionEndReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionEndReason::AccountSuspended => "account_suspended",
            SessionEndReason::AccessEnded => "access_ended",
            SessionEndReason::Unknown => "unknown",
        }
    }

    pub fn from_code(code: &str) -> Option<SessionEndReason> {
        match code {
            "account_suspended" => Some(SessionEndReason::AccountSuspended),
            "access_ended" => Some(SessionEndReason::AccessEnded),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCodeRequest {
    pub device_public_key: String,
    pub device_name: String,
    pub platform: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_code: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

impl fmt::Debug for DeviceCodeResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceCodeResponse")
            .field("device_code", &REDACTED)
            .field("user_code", &self.user_code)
            .field("verification_uri", &self.verification_uri)
            .field("expires_in", &self.expires_in)
            .field("interval", &self.interval)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceTokenRequest {
    pub device_code: String,
    pub nonce: String,
    pub signature: String,
}

impl fmt::Debug for DeviceTokenRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceTokenRequest")
            .field("device_code", &REDACTED)
            .field("nonce", &self.nonce)
            .field("signature", &self.signature)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DevicePoll {
    Pending { interval: u64 },
    SlowDown { interval: u64 },
    Denied,
    Expired,
    Approved { tokens: SessionTokens },
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: &str = "01920000-0000-7000-8000-000000000001";
    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";
    const DEVICE: &str = "01920000-0000-7000-8000-000000000003";

    fn ordinal(code: AuthErrorCode) -> usize {
        match code {
            AuthErrorCode::NotAdmitted => 0,
            AuthErrorCode::InvalidCode => 1,
            AuthErrorCode::InvalidSignature => 2,
            AuthErrorCode::ExpiredNonce => 3,
            AuthErrorCode::InvalidRedirect => 4,
            AuthErrorCode::UnknownProvider => 5,
            AuthErrorCode::ProviderFailed => 6,
            AuthErrorCode::RefreshReused => 7,
            AuthErrorCode::Revoked => 8,
            AuthErrorCode::SetupCodeInvalid => 9,
            AuthErrorCode::SignInCancelled => 10,
        }
    }

    #[test]
    fn challenge_message_has_the_documented_byte_layout() {
        let server: ServerId = SERVER.parse().unwrap();
        for (purpose, label) in [
            (ChallengePurpose::Token, "token"),
            (ChallengePurpose::Refresh, "refresh"),
            (ChallengePurpose::Socket, "socket"),
        ] {
            let parts: [&[u8]; 7] = [
                b"oleafly-collab/v1",
                &[0],
                label.as_bytes(),
                &[0],
                SERVER.as_bytes(),
                &[0],
                b"n0nce-AB_c",
            ];
            assert_eq!(
                challenge_message(purpose, server, "n0nce-AB_c"),
                parts.concat(),
                "{label}"
            );
        }
    }

    #[test]
    fn challenge_messages_differ_by_purpose_server_and_nonce() {
        let server: ServerId = SERVER.parse().unwrap();
        let other: ServerId = "01920000-0000-7000-8000-000000000009".parse().unwrap();
        let token = challenge_message(ChallengePurpose::Token, server, "abc");
        assert_ne!(
            token,
            challenge_message(ChallengePurpose::Refresh, server, "abc")
        );
        assert_ne!(
            token,
            challenge_message(ChallengePurpose::Socket, server, "abc")
        );
        assert_ne!(
            token,
            challenge_message(ChallengePurpose::Token, other, "abc")
        );
        assert_ne!(
            token,
            challenge_message(ChallengePurpose::Token, server, "abd")
        );
    }

    #[test]
    fn session_tokens_match_the_wire_json() {
        let json = format!(
            r#"{{"account_id":"{ACCOUNT}","device_id":"{DEVICE}","access_token":"at","access_expires_at":1760000000000,"refresh_token":"rt"}}"#
        );
        let tokens: SessionTokens = serde_json::from_str(&json).unwrap();
        assert_eq!(
            tokens,
            SessionTokens {
                account_id: ACCOUNT.parse().unwrap(),
                device_id: DEVICE.parse().unwrap(),
                access_token: "at".to_string(),
                access_expires_at: 1_760_000_000_000,
                refresh_token: "rt".to_string(),
            }
        );
        assert_eq!(
            serde_json::to_value(tokens).unwrap(),
            serde_json::from_str::<serde_json::Value>(&json).unwrap()
        );
    }

    #[test]
    fn account_and_device_summaries_match_the_wire_json() {
        let account_json = format!(
            r#"{{"account_id":"{ACCOUNT}","display_name":"Alice Chen","avatar_url":null,"server_role":"maintainer","emails":["alice@uni.edu"],"logins":["alice-chen"]}}"#
        );
        let account: AccountSummary = serde_json::from_str(&account_json).unwrap();
        assert_eq!(account.server_role, ServerRole::Maintainer);
        assert_eq!(account.avatar_url, None);
        assert_eq!(
            serde_json::to_value(account).unwrap(),
            serde_json::from_str::<serde_json::Value>(&account_json).unwrap()
        );
        let device_json = format!(
            r#"{{"device_id":"{DEVICE}","name":"Alice's laptop","platform":"macos","created_at":1,"last_seen_at":null,"current":true}}"#
        );
        let device: DeviceSummary = serde_json::from_str(&device_json).unwrap();
        assert!(device.current);
        assert_eq!(
            serde_json::to_value(device).unwrap(),
            serde_json::from_str::<serde_json::Value>(&device_json).unwrap()
        );
    }

    #[test]
    fn the_setup_code_is_optional_in_the_start_query() {
        let without: AuthStartQuery = serde_json::from_str(
            r#"{"provider":"github","redirect_uri":"http://127.0.0.1:5000/callback","state":"s","code_challenge":"c","device_public_key":"k","device_name":"Laptop","platform":"linux"}"#,
        )
        .unwrap();
        assert_eq!(without.setup_code, None);
        assert!(!serde_json::to_string(&without)
            .unwrap()
            .contains("setup_code"));
        let with = AuthStartQuery {
            setup_code: Some("123456".to_string()),
            ..without
        };
        assert_eq!(serde_json::to_value(with).unwrap()["setup_code"], "123456");
        let challenge: ChallengeResponse =
            serde_json::from_str(r#"{"nonce":"n","expires_at":120000}"#).unwrap();
        assert_eq!(challenge.expires_at, 120_000);
        let error: ApiError =
            serde_json::from_str(r#"{"code":"not_admitted","message":"no"}"#).unwrap();
        assert_eq!(error.code, AuthErrorCode::NotAdmitted.as_str());
    }

    #[test]
    fn refresh_requests_carry_a_typed_device_id() {
        let json = format!(
            r#"{{"refresh_token":"rt","device_id":"{DEVICE}","nonce":"n","signature":"s"}}"#
        );
        let request: RefreshRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(request.device_id, DEVICE.parse::<DeviceId>().unwrap());
        assert!(serde_json::from_str::<RefreshRequest>(
            r#"{"refresh_token":"rt","device_id":"DEVICE","nonce":"n","signature":"s"}"#
        )
        .is_err());
        let token: TokenRequest = serde_json::from_str(
            r#"{"code":"c","code_verifier":"v","device_public_key":"k","nonce":"n","signature":"s"}"#,
        )
        .unwrap();
        assert_eq!(token.code_verifier, "v");
    }

    #[test]
    fn auth_error_codes_use_their_wire_names() {
        let codes = [
            (AuthErrorCode::NotAdmitted, "not_admitted"),
            (AuthErrorCode::InvalidCode, "invalid_code"),
            (AuthErrorCode::InvalidSignature, "invalid_signature"),
            (AuthErrorCode::ExpiredNonce, "expired_nonce"),
            (AuthErrorCode::InvalidRedirect, "invalid_redirect"),
            (AuthErrorCode::UnknownProvider, "unknown_provider"),
            (AuthErrorCode::ProviderFailed, "provider_failed"),
            (AuthErrorCode::RefreshReused, "refresh_reused"),
            (AuthErrorCode::Revoked, "revoked"),
            (AuthErrorCode::SetupCodeInvalid, "setup_code_invalid"),
            (AuthErrorCode::SignInCancelled, "sign_in_cancelled"),
        ];
        for (index, (code, name)) in codes.into_iter().enumerate() {
            assert_eq!(ordinal(code), index, "{name}");
            assert_eq!(code.as_str(), name);
            assert_eq!(serde_json::to_value(code).unwrap(), name);
        }
    }

    #[test]
    fn session_end_reasons_use_their_wire_codes() {
        for (reason, code) in [
            (SessionEndReason::AccountSuspended, "account_suspended"),
            (SessionEndReason::AccessEnded, "access_ended"),
        ] {
            assert_eq!(reason.as_str(), code);
            assert_eq!(serde_json::to_value(reason).unwrap(), code);
            assert_eq!(
                serde_json::from_value::<SessionEndReason>(serde_json::json!(code)).unwrap(),
                reason
            );
            assert_eq!(SessionEndReason::from_code(code), Some(reason));
        }
        assert_eq!(SessionEndReason::from_code("revoked"), None);
        assert_eq!(SessionEndReason::from_code("unknown"), None);
        assert_eq!(
            serde_json::from_value::<SessionEndReason>(serde_json::json!("account_deleted"))
                .unwrap(),
            SessionEndReason::Unknown
        );
        let error: ApiError =
            serde_json::from_str(r#"{"code":"access_ended","message":"gone"}"#).unwrap();
        assert_eq!(
            SessionEndReason::from_code(&error.code),
            Some(SessionEndReason::AccessEnded)
        );
    }

    #[test]
    fn debug_output_never_shows_tokens_or_codes() {
        let tokens = SessionTokens {
            account_id: ACCOUNT.parse().unwrap(),
            device_id: DEVICE.parse().unwrap(),
            access_token: "secret-access".to_string(),
            access_expires_at: 0,
            refresh_token: "secret-refresh".to_string(),
        };
        let refresh = RefreshRequest {
            refresh_token: "secret-refresh".to_string(),
            device_id: DEVICE.parse().unwrap(),
            nonce: "n".to_string(),
            signature: "s".to_string(),
        };
        let token = TokenRequest {
            code: "secret-code".to_string(),
            code_verifier: "secret-verifier".to_string(),
            device_public_key: "k".to_string(),
            nonce: "n".to_string(),
            signature: "s".to_string(),
        };
        let printed = format!("{tokens:?} {refresh:?} {token:?}");
        assert!(!printed.contains("secret-"), "{printed}");
        assert!(printed.contains(ACCOUNT));
        assert!(printed.contains("[redacted]"));
    }

    #[test]
    fn device_code_requests_and_replies_match_the_wire_json() {
        let request: DeviceCodeRequest = serde_json::from_str(
            r#"{"device_public_key":"k","device_name":"Lab PC","platform":"linux"}"#,
        )
        .unwrap();
        assert_eq!(request.setup_code, None);
        assert_eq!(request.device_name, "Lab PC");
        let with_code = DeviceCodeRequest {
            setup_code: Some("4F7K-Q2ZX".to_string()),
            ..request
        };
        assert_eq!(
            serde_json::to_value(&with_code).unwrap()["setup_code"],
            "4F7K-Q2ZX"
        );
        let wire = serde_json::json!({
            "device_code": "dc",
            "user_code": "BCDF-GHJK",
            "verification_uri": "https://collab.uni.edu/auth/device",
            "verification_uri_complete": "https://collab.uni.edu/auth/device?code=BCDF-GHJK",
            "expires_in": 600,
            "interval": 5
        });
        let reply: DeviceCodeResponse = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(reply.user_code, "BCDF-GHJK");
        assert_eq!((reply.expires_in, reply.interval), (600, 5));
        assert_eq!(serde_json::to_value(&reply).unwrap(), wire);
        let poll: DeviceTokenRequest =
            serde_json::from_str(r#"{"device_code":"dc","nonce":"n","signature":"s"}"#).unwrap();
        assert_eq!(poll.nonce, "n");
    }

    #[test]
    fn device_polls_are_tagged_by_status() {
        let tokens = SessionTokens {
            account_id: ACCOUNT.parse().unwrap(),
            device_id: DEVICE.parse().unwrap(),
            access_token: "at".to_string(),
            access_expires_at: 1,
            refresh_token: "rt".to_string(),
        };
        let cases = [
            (
                DevicePoll::Pending { interval: 5 },
                serde_json::json!({"status": "pending", "interval": 5}),
            ),
            (
                DevicePoll::SlowDown { interval: 10 },
                serde_json::json!({"status": "slow_down", "interval": 10}),
            ),
            (DevicePoll::Denied, serde_json::json!({"status": "denied"})),
            (
                DevicePoll::Expired,
                serde_json::json!({"status": "expired"}),
            ),
            (
                DevicePoll::Approved {
                    tokens: tokens.clone(),
                },
                serde_json::json!({"status": "approved", "tokens": serde_json::to_value(&tokens).unwrap()}),
            ),
        ];
        for (poll, wire) in cases {
            assert_eq!(serde_json::to_value(&poll).unwrap(), wire);
            assert_eq!(serde_json::from_value::<DevicePoll>(wire).unwrap(), poll);
        }
    }

    #[test]
    fn debug_output_never_shows_device_codes() {
        let reply = DeviceCodeResponse {
            device_code: "secret-device".to_string(),
            user_code: "BCDF-GHJK".to_string(),
            verification_uri: "https://collab.uni.edu/auth/device".to_string(),
            verification_uri_complete: "https://collab.uni.edu/auth/device?code=BCDF-GHJK"
                .to_string(),
            expires_in: 600,
            interval: 5,
        };
        let poll = DeviceTokenRequest {
            device_code: "secret-device".to_string(),
            nonce: "n".to_string(),
            signature: "s".to_string(),
        };
        let printed = format!("{reply:?} {poll:?}");
        assert!(!printed.contains("secret-"), "{printed}");
        assert!(printed.contains("BCDF-GHJK"));
    }
}
