use std::time::{SystemTime, UNIX_EPOCH};

use oleafly_collab_protocol::crypto::b64url_decode;
use ring::signature::{
    self, EcdsaVerificationAlgorithm, RsaParameters, RsaPublicKeyComponents, UnparsedPublicKey,
};
use serde::Deserialize;
use serde_json::Value;

pub const LEEWAY_SECONDS: f64 = 60.0;

#[derive(Debug, Clone, Deserialize)]
pub struct Jwk {
    pub kty: String,
    pub kid: Option<String>,
    pub alg: Option<String>,
    #[serde(rename = "use")]
    pub usage: Option<String>,
    pub crv: Option<String>,
    pub n: Option<String>,
    pub e: Option<String>,
    pub x: Option<String>,
    pub y: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct JwkSet {
    pub keys: Vec<Jwk>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Audience {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, Deserialize)]
pub struct IdClaims {
    pub iss: String,
    pub sub: String,
    pub aud: Audience,
    pub exp: f64,
    pub iat: f64,
    pub nbf: Option<f64>,
    pub nonce: Option<String>,
    pub azp: Option<String>,
    pub email: Option<String>,
    pub email_verified: Option<Value>,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdTokenError {
    Malformed,
    CriticalHeader,
    UnsupportedAlgorithm,
    UnknownKey,
    BadSignature,
    Issuer,
    Audience,
    Expired,
    NotYetValid,
    Nonce,
}

impl std::fmt::Display for IdTokenError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            IdTokenError::Malformed => "the ID token is malformed",
            IdTokenError::CriticalHeader => "the ID token header names critical extensions",
            IdTokenError::UnsupportedAlgorithm => "the ID token uses an unsupported algorithm",
            IdTokenError::UnknownKey => "no published key matches the ID token",
            IdTokenError::BadSignature => "the ID token signature is invalid",
            IdTokenError::Issuer => "the ID token names another issuer",
            IdTokenError::Audience => "the ID token is for another client",
            IdTokenError::Expired => "the ID token has expired",
            IdTokenError::NotYetValid => "the ID token is not valid yet",
            IdTokenError::Nonce => "the ID token nonce does not match",
        };
        formatter.write_str(text)
    }
}

#[derive(Debug, Deserialize)]
struct Header {
    alg: String,
    kid: Option<String>,
}

#[derive(Clone, Copy)]
enum Algorithm {
    Rsa(&'static RsaParameters),
    Ec {
        curve: &'static str,
        size: usize,
        verifier: &'static EcdsaVerificationAlgorithm,
    },
    Ed25519,
}

impl Algorithm {
    fn parse(alg: &str) -> Option<Algorithm> {
        match alg {
            "RS256" => Some(Algorithm::Rsa(&signature::RSA_PKCS1_2048_8192_SHA256)),
            "RS384" => Some(Algorithm::Rsa(&signature::RSA_PKCS1_2048_8192_SHA384)),
            "RS512" => Some(Algorithm::Rsa(&signature::RSA_PKCS1_2048_8192_SHA512)),
            "PS256" => Some(Algorithm::Rsa(&signature::RSA_PSS_2048_8192_SHA256)),
            "PS384" => Some(Algorithm::Rsa(&signature::RSA_PSS_2048_8192_SHA384)),
            "PS512" => Some(Algorithm::Rsa(&signature::RSA_PSS_2048_8192_SHA512)),
            "ES256" => Some(Algorithm::Ec {
                curve: "P-256",
                size: 32,
                verifier: &signature::ECDSA_P256_SHA256_FIXED,
            }),
            "ES384" => Some(Algorithm::Ec {
                curve: "P-384",
                size: 48,
                verifier: &signature::ECDSA_P384_SHA384_FIXED,
            }),
            "EdDSA" => Some(Algorithm::Ed25519),
            _ => None,
        }
    }

    fn key_type(self) -> &'static str {
        match self {
            Algorithm::Rsa(_) => "RSA",
            Algorithm::Ec { .. } => "EC",
            Algorithm::Ed25519 => "OKP",
        }
    }

    fn verify(self, key: &Jwk, message: &[u8], signature_bytes: &[u8]) -> bool {
        match self {
            Algorithm::Rsa(parameters) => {
                let (Some(n), Some(e)) = (decode(key.n.as_deref()), decode(key.e.as_deref()))
                else {
                    return false;
                };
                RsaPublicKeyComponents {
                    n: strip_leading_zeros(&n),
                    e: strip_leading_zeros(&e),
                }
                .verify(parameters, message, signature_bytes)
                .is_ok()
            }
            Algorithm::Ec {
                curve,
                size,
                verifier,
            } => {
                let (Some(x), Some(y)) = (decode(key.x.as_deref()), decode(key.y.as_deref()))
                else {
                    return false;
                };
                if key.crv.as_deref() != Some(curve) || x.len() != size || y.len() != size {
                    return false;
                }
                let mut point = Vec::with_capacity(1 + 2 * size);
                point.push(4);
                point.extend_from_slice(&x);
                point.extend_from_slice(&y);
                UnparsedPublicKey::new(verifier, point)
                    .verify(message, signature_bytes)
                    .is_ok()
            }
            Algorithm::Ed25519 => {
                let Some(x) = decode(key.x.as_deref()) else {
                    return false;
                };
                key.crv.as_deref() == Some("Ed25519")
                    && UnparsedPublicKey::new(&signature::ED25519, x)
                        .verify(message, signature_bytes)
                        .is_ok()
            }
        }
    }
}

fn decode(value: Option<&str>) -> Option<Vec<u8>> {
    value.and_then(|text| b64url_decode(text).ok())
}

fn strip_leading_zeros(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|byte| *byte != 0)
        .unwrap_or(bytes.len());
    &bytes[start..]
}

pub fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

pub fn verify_signature(token: &str, keys: &JwkSet) -> Result<Vec<u8>, IdTokenError> {
    let mut parts = token.split('.');
    let (Some(header_part), Some(payload_part), Some(signature_part), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(IdTokenError::Malformed);
    };
    let header_bytes = b64url_decode(header_part).map_err(|_| IdTokenError::Malformed)?;
    let header_value: Value =
        serde_json::from_slice(&header_bytes).map_err(|_| IdTokenError::Malformed)?;
    if header_value.get("crit").is_some() {
        return Err(IdTokenError::CriticalHeader);
    }
    let header: Header =
        serde_json::from_value(header_value).map_err(|_| IdTokenError::Malformed)?;
    let payload = b64url_decode(payload_part).map_err(|_| IdTokenError::Malformed)?;
    let signature_bytes = b64url_decode(signature_part).map_err(|_| IdTokenError::Malformed)?;
    let algorithm = Algorithm::parse(&header.alg).ok_or(IdTokenError::UnsupportedAlgorithm)?;
    let signing_input = &token[..header_part.len() + 1 + payload_part.len()];
    let candidates: Vec<&Jwk> = keys
        .keys
        .iter()
        .filter(|key| key.kty == algorithm.key_type())
        .filter(|key| key.usage.as_deref().is_none_or(|usage| usage == "sig"))
        .filter(|key| key.alg.as_deref().is_none_or(|alg| alg == header.alg))
        .filter(|key| header.kid.is_none() || key.kid == header.kid)
        .collect();
    if candidates.is_empty() {
        return Err(IdTokenError::UnknownKey);
    }
    if candidates
        .iter()
        .any(|key| algorithm.verify(key, signing_input.as_bytes(), &signature_bytes))
    {
        Ok(payload)
    } else {
        Err(IdTokenError::BadSignature)
    }
}

pub fn validate_id_token(
    token: &str,
    keys: &JwkSet,
    issuer: &str,
    client_id: &str,
    nonce: &str,
    now: i64,
) -> Result<IdClaims, IdTokenError> {
    let payload = verify_signature(token, keys)?;
    let claims: IdClaims = serde_json::from_slice(&payload).map_err(|_| IdTokenError::Malformed)?;
    if claims.sub.is_empty() {
        return Err(IdTokenError::Malformed);
    }
    if claims.iss != issuer {
        return Err(IdTokenError::Issuer);
    }
    let audiences: Vec<&str> = match &claims.aud {
        Audience::One(audience) => vec![audience.as_str()],
        Audience::Many(list) => list.iter().map(String::as_str).collect(),
    };
    if !audiences.contains(&client_id) {
        return Err(IdTokenError::Audience);
    }
    let azp = claims.azp.as_deref();
    if azp.is_some_and(|party| party != client_id) || (audiences.len() > 1 && azp.is_none()) {
        return Err(IdTokenError::Audience);
    }
    let now = now as f64;
    if claims.exp + LEEWAY_SECONDS <= now {
        return Err(IdTokenError::Expired);
    }
    let early = claims.iat - LEEWAY_SECONDS > now
        || claims.nbf.is_some_and(|nbf| nbf - LEEWAY_SECONDS > now);
    if early {
        return Err(IdTokenError::NotYetValid);
    }
    if claims.nonce.as_deref() != Some(nonce) {
        return Err(IdTokenError::Nonce);
    }
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_support::TestSigner;

    const NOW: i64 = 1_800_000_000;
    const RFC_HEADER: &str = "eyJhbGciOiJSUzI1NiJ9";
    const RFC_PAYLOAD: &str = "eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ";
    const RFC_SIGNATURE: &str = "cC4hiUPoj9Eetdgtv3hF80EGrhuB__dzERat0XF9g2VtQgr9PJbu3XOiZj5RZmh7AAuHIm4Bh-0Qc_lF5YKt_O8W2Fp5jujGbds9uJdbF9CUAr7t1dnZcAcQjbKBYNX4BAynRFdiuB--f_nZLgrnbyTyWzO75vRK5h6xBArLIARNPvkSjtQBMHlb1L07Qe7K0GarZRmB_eSN9383LcOLn6_dO--xi12jzDwusC-eOkHWEsqtFZESc6BfI7noOPqvhJ1phCnvWh6IeYI2w9QOYEUipUTI8np6LbgGY9Fs98rqVt5AXLIhWkWywlVmtVrBp0igcN_IoypGlUPQGe77Rw";
    const RFC_N: &str = "ofgWCuLjybRlzo0tZWJjNiuSfb4p4fAkd_wWJcyQoTbji9k0l8W26mPddxHmfHQp-Vaw-4qPCJrcS2mJPMEzP1Pt0Bm4d4QlL-yRT-SFd2lZS-pCgNMsD1W_YpRPEwOWvG6b32690r2jZ47soMZo9wGzjb_7OMg0LOL-bSf63kpaSHSXndS5z5rexMdbBYUsLA9e-KXBdQOS-UTo7WTBEMa2R2CapHg665xsmtdVMTBQY4uDZlxvb3qCo5ZwKh9kG4LT6_I5IhlJH7aGhyxXFvUK-DWNmoudF8NAco9_h9iaGNj8q2ethFkMLs91kzk2PAcDTW9gb54h4FRWyuXpoQ";

    fn rfc_keys() -> JwkSet {
        serde_json::from_value(json!({ "keys": [{ "kty": "RSA", "n": RFC_N, "e": "AQAB" }] }))
            .expect("rfc key")
    }

    fn claims() -> Value {
        json!({
            "iss": "https://id.uni.edu",
            "sub": "user-1",
            "aud": "client-1",
            "exp": NOW + 300,
            "iat": NOW,
            "nonce": "nonce-1",
            "email": "a@uni.edu",
            "email_verified": true
        })
    }

    fn keys_of(signer: &TestSigner) -> JwkSet {
        serde_json::from_value(signer.jwks()).expect("jwks")
    }

    fn validate(token: &str, keys: &JwkSet) -> Result<IdClaims, IdTokenError> {
        validate_id_token(
            token,
            keys,
            "https://id.uni.edu",
            "client-1",
            "nonce-1",
            NOW,
        )
    }

    #[test]
    fn the_rfc_7515_rs256_example_verifies() {
        let token = format!("{RFC_HEADER}.{RFC_PAYLOAD}.{RFC_SIGNATURE}");
        let payload = verify_signature(&token, &rfc_keys()).expect("signature");
        assert!(String::from_utf8(payload)
            .expect("utf8")
            .contains("\"iss\":\"joe\""));
    }

    #[test]
    fn a_changed_rs256_payload_fails() {
        let forged = oleafly_collab_protocol::crypto::b64url_encode(br#"{"iss":"mallory"}"#);
        let token = format!("{RFC_HEADER}.{forged}.{RFC_SIGNATURE}");
        assert_eq!(
            verify_signature(&token, &rfc_keys()),
            Err(IdTokenError::BadSignature)
        );
    }

    #[test]
    fn an_es256_token_validates() {
        let signer = TestSigner::generate("key-1");
        let parsed = validate(&signer.sign(&claims()), &keys_of(&signer)).expect("valid token");
        assert_eq!(parsed.sub, "user-1");
        assert_eq!(parsed.email_verified, Some(Value::Bool(true)));
    }

    #[test]
    fn none_and_hmac_algorithms_are_refused() {
        let signer = TestSigner::generate("key-1");
        for alg in ["none", "HS256"] {
            let token = signer.sign_with_header(&json!({ "alg": alg, "kid": "key-1" }), &claims());
            assert_eq!(
                validate(&token, &keys_of(&signer)).err(),
                Some(IdTokenError::UnsupportedAlgorithm)
            );
        }
    }

    #[test]
    fn a_crit_header_is_refused_even_when_the_signature_is_good() {
        let signer = TestSigner::generate("key-1");
        for crit in [json!(["exp"]), json!([]), Value::Null] {
            let header = json!({ "alg": "ES256", "kid": "key-1", "crit": crit });
            let token = signer.sign_with_header(&header, &claims());
            assert_eq!(
                validate(&token, &keys_of(&signer)).err(),
                Some(IdTokenError::CriticalHeader)
            );
        }
    }

    #[test]
    fn claims_are_checked() {
        let signer = TestSigner::generate("key-1");
        let keys = keys_of(&signer);
        let cases = vec![
            (json!({ "nonce": "other" }), IdTokenError::Nonce),
            (json!({ "aud": "client-2" }), IdTokenError::Audience),
            (
                json!({ "aud": ["client-1", "client-2"] }),
                IdTokenError::Audience,
            ),
            (json!({ "azp": "client-2" }), IdTokenError::Audience),
            (
                json!({ "iss": "https://id.uni.edu/" }),
                IdTokenError::Issuer,
            ),
            (json!({ "exp": NOW - 61 }), IdTokenError::Expired),
            (json!({ "iat": NOW + 120 }), IdTokenError::NotYetValid),
            (json!({ "nbf": NOW + 120 }), IdTokenError::NotYetValid),
            (json!({ "exp": "never" }), IdTokenError::Malformed),
            (json!({ "nbf": "later" }), IdTokenError::Malformed),
            (json!({ "sub": "" }), IdTokenError::Malformed),
        ];
        for (change, expected) in cases {
            let mut body = claims();
            for (key, value) in change.as_object().expect("object") {
                body[key] = value.clone();
            }
            assert_eq!(
                validate(&signer.sign(&body), &keys).err(),
                Some(expected),
                "{change}"
            );
        }
    }

    #[test]
    fn several_audiences_pass_with_a_matching_azp() {
        let signer = TestSigner::generate("key-1");
        let mut body = claims();
        body["aud"] = json!(["client-1", "client-2"]);
        body["azp"] = json!("client-1");
        assert!(validate(&signer.sign(&body), &keys_of(&signer)).is_ok());
    }

    #[test]
    fn an_unknown_key_id_is_reported() {
        let signer = TestSigner::generate("key-1");
        let other = TestSigner::generate("key-2");
        assert_eq!(
            validate(&signer.sign(&claims()), &keys_of(&other)).err(),
            Some(IdTokenError::UnknownKey)
        );
    }

    #[test]
    fn a_signature_from_another_key_with_the_same_id_fails() {
        let signer = TestSigner::generate("key-1");
        let impostor = TestSigner::generate("key-1");
        assert_eq!(
            validate(&impostor.sign(&claims()), &keys_of(&signer)).err(),
            Some(IdTokenError::BadSignature)
        );
    }
}
