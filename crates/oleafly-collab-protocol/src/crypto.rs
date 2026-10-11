use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ring::digest;
use ring::signature::{UnparsedPublicKey, ED25519};

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    #[error("value is not base64url without padding")]
    BadEncoding,
}

pub fn b64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn b64url_decode(text: &str) -> Result<Vec<u8>, CryptoError> {
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| CryptoError::BadEncoding)
}

pub fn verify_ed25519(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    public_key.len() == 32
        && signature.len() == 64
        && UnparsedPublicKey::new(&ED25519, public_key)
            .verify(message, signature)
            .is_ok()
}

pub fn sha256_b64url(bytes: &[u8]) -> String {
    b64url_encode(digest::digest(&digest::SHA256, bytes).as_ref())
}

pub fn pkce_s256(verifier: &str) -> String {
    sha256_b64url(verifier.as_bytes())
}

pub mod b64url_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<T, S>(bytes: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        T: AsRef<[u8]> + ?Sized,
        S: Serializer,
    {
        serializer.serialize_str(&super::b64url_encode(bytes.as_ref()))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        super::b64url_decode(&text).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&text[index..index + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn base64url_is_unpadded_and_url_safe() {
        assert_eq!(b64url_encode(b"hello"), "aGVsbG8");
        assert_eq!(b64url_encode(&[0xfb, 0xff, 0xfe]), "-__-");
        assert_eq!(b64url_encode(b""), "");
        assert_eq!(b64url_decode("aGVsbG8"), Ok(b"hello".to_vec()));
        assert_eq!(b64url_decode("-__-"), Ok(vec![0xfb, 0xff, 0xfe]));
    }

    #[test]
    fn base64url_rejects_padding_the_standard_alphabet_and_trailing_bits() {
        for text in ["aGVsbG8=", "+//+", "aGVsbG9", "a", "aGVs bG8"] {
            assert_eq!(b64url_decode(text), Err(CryptoError::BadEncoding), "{text}");
        }
        assert_eq!(
            CryptoError::BadEncoding.to_string(),
            "value is not base64url without padding"
        );
    }

    #[test]
    fn sha256_and_pkce_match_published_vectors() {
        assert_eq!(
            sha256_b64url(b""),
            "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"
        );
        assert_eq!(
            sha256_b64url(b"abc"),
            "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
        assert_eq!(
            pkce_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn ed25519_accepts_the_rfc_8032_vectors() {
        let public_key = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        let signature = hex(concat!(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155",
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        ));
        assert!(verify_ed25519(&public_key, b"", &signature));
        assert!(!verify_ed25519(&public_key, b"x", &signature));
        let public_key = hex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
        let signature = hex(concat!(
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da",
            "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"
        ));
        assert!(verify_ed25519(&public_key, &[0x72], &signature));
    }

    #[test]
    fn ed25519_rejects_tampering_and_malformed_inputs() {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let message = b"oleafly";
        let signature = pair.sign(message);
        let public_key = pair.public_key().as_ref();
        assert!(verify_ed25519(public_key, message, signature.as_ref()));
        assert!(!verify_ed25519(public_key, b"oleaflx", signature.as_ref()));
        let mut flipped = signature.as_ref().to_vec();
        flipped[0] ^= 1;
        assert!(!verify_ed25519(public_key, message, &flipped));
        assert!(!verify_ed25519(
            &public_key[..31],
            message,
            signature.as_ref()
        ));
        assert!(!verify_ed25519(
            public_key,
            message,
            &signature.as_ref()[..63]
        ));
        assert!(!verify_ed25519(&[], message, &[]));
    }

    #[test]
    fn byte_fields_serialise_as_base64url() {
        #[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
        struct Holder {
            #[serde(with = "b64url_bytes")]
            bytes: Vec<u8>,
        }
        let holder = Holder {
            bytes: vec![0xfb, 0xff, 0xfe],
        };
        assert_eq!(
            serde_json::to_string(&holder).unwrap(),
            r#"{"bytes":"-__-"}"#
        );
        assert_eq!(
            serde_json::from_str::<Holder>(r#"{"bytes":"-__-"}"#).unwrap(),
            holder
        );
        assert!(serde_json::from_str::<Holder>(r#"{"bytes":"-__-="}"#).is_err());
    }
}
