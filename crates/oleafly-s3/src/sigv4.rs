use std::collections::BTreeMap;
use std::fmt::Write;

use ring::digest::{digest, SHA256};
use ring::hmac;

pub const ALGORITHM: &str = "AWS4-HMAC-SHA256";
pub const SERVICE: &str = "s3";
pub const EMPTY_PAYLOAD_SHA256: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

pub struct Credentials<'a> {
    pub access_key_id: &'a str,
    pub secret_access_key: &'a str,
}

pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub headers: &'a [(&'a str, &'a str)],
    pub payload_sha256: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signed {
    pub canonical_request: String,
    pub string_to_sign: String,
    pub signed_headers: String,
    pub signature: String,
    pub authorization: String,
}

pub fn sign(
    credentials: &Credentials<'_>,
    region: &str,
    service: &str,
    amz_date: &str,
    request: &Request<'_>,
) -> Signed {
    let (canonical_headers, signed_headers) = canonical_headers(request.headers);
    let canonical_request = format!(
        "{}\n{}\n{}\n{canonical_headers}\n{signed_headers}\n{}",
        request.method, request.path, request.query, request.payload_sha256
    );
    let date = amz_date.get(..8).unwrap_or(amz_date);
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "{ALGORITHM}\n{amz_date}\n{scope}\n{}",
        hex(digest(&SHA256, canonical_request.as_bytes()).as_ref())
    );
    let key = hmac::Key::new(
        hmac::HMAC_SHA256,
        &signing_key(credentials.secret_access_key, date, region, service),
    );
    let signature = hex(hmac::sign(&key, string_to_sign.as_bytes()).as_ref());
    let authorization = format!(
        "{ALGORITHM} Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        credentials.access_key_id
    );
    Signed {
        canonical_request,
        string_to_sign,
        signed_headers,
        signature,
        authorization,
    }
}

pub fn signing_key(secret_access_key: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let step = |key: &[u8], data: &str| {
        hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, key), data.as_bytes())
            .as_ref()
            .to_vec()
    };
    let date_key = step(format!("AWS4{secret_access_key}").as_bytes(), date);
    let region_key = step(&date_key, region);
    let service_key = step(&region_key, service);
    step(&service_key, "aws4_request")
}

pub fn uri_encode(value: &str, keep_slash: bool) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'~')
            || (keep_slash && byte == b'/')
        {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

pub fn amz_date(epoch_ms: i64) -> String {
    let seconds = epoch_ms.div_euclid(1000);
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let in_day = seconds.rem_euclid(86_400);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        in_day / 3600,
        in_day % 3600 / 60,
        in_day % 60
    )
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn canonical_headers(headers: &[(&str, &str)]) -> (String, String) {
    let mut merged: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (name, value) in headers {
        merged
            .entry(name.trim().to_ascii_lowercase())
            .or_default()
            .push(value.split_whitespace().collect::<Vec<_>>().join(" "));
    }
    let canonical = merged
        .iter()
        .map(|(name, values)| format!("{name}:{}\n", values.join(",")))
        .collect();
    let signed = merged.keys().cloned().collect::<Vec<_>>().join(";");
    (canonical, signed)
}

fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCESS_KEY_ID: &str = "AKIAIOSFODNN7EXAMPLE";
    const S3_EXAMPLE_SECRET: &str = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn the_aws_get_object_example_signs_to_the_documented_signature() {
        let headers = [
            ("Host", "examplebucket.s3.amazonaws.com"),
            ("Range", "bytes=0-9"),
            ("x-amz-content-sha256", EMPTY_PAYLOAD_SHA256),
            ("x-amz-date", "20130524T000000Z"),
        ];
        let signed = sign(
            &Credentials {
                access_key_id: ACCESS_KEY_ID,
                secret_access_key: S3_EXAMPLE_SECRET,
            },
            "us-east-1",
            SERVICE,
            "20130524T000000Z",
            &Request {
                method: "GET",
                path: "/test.txt",
                query: "",
                headers: &headers,
                payload_sha256: EMPTY_PAYLOAD_SHA256,
            },
        );
        assert_eq!(
            signed.canonical_request,
            "GET\n/test.txt\n\nhost:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:20130524T000000Z\n\nhost;range;x-amz-content-sha256;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            signed.string_to_sign,
            "AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972"
        );
        assert_eq!(
            signed.signature,
            "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
        assert_eq!(
            signed.authorization,
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
    }

    #[test]
    fn the_aws_put_object_example_encodes_the_path_and_signs_to_the_documented_signature() {
        let payload_sha256 = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";
        let headers = [
            ("Host", "examplebucket.s3.amazonaws.com"),
            ("Date", "Fri, 24 May 2013 00:00:00 GMT"),
            ("x-amz-date", "20130524T000000Z"),
            ("x-amz-storage-class", "REDUCED_REDUNDANCY"),
            ("x-amz-content-sha256", payload_sha256),
        ];
        let path = format!("/{}", uri_encode("test$file.text", true));
        let signed = sign(
            &Credentials {
                access_key_id: ACCESS_KEY_ID,
                secret_access_key: S3_EXAMPLE_SECRET,
            },
            "us-east-1",
            SERVICE,
            "20130524T000000Z",
            &Request {
                method: "PUT",
                path: &path,
                query: "",
                headers: &headers,
                payload_sha256,
            },
        );
        assert_eq!(
            signed.canonical_request,
            "PUT\n/test%24file.text\n\ndate:Fri, 24 May 2013 00:00:00 GMT\nhost:examplebucket.s3.amazonaws.com\nx-amz-content-sha256:44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072\nx-amz-date:20130524T000000Z\nx-amz-storage-class:REDUCED_REDUNDANCY\n\ndate;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class\n44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
        );
        assert_eq!(
            signed.string_to_sign,
            "AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d"
        );
        assert_eq!(
            signed.signature,
            "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
        );
    }

    #[test]
    fn the_signing_key_matches_the_documented_derivation() {
        assert_eq!(
            hex(&signing_key(
                "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
                "20120215",
                "us-east-1",
                "iam"
            )),
            "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
        );
    }

    #[test]
    fn header_values_are_trimmed_and_their_inner_spaces_collapsed() {
        let headers = [
            ("X-Amz-Date", "20130524T000000Z"),
            ("host", "  bucket.example   "),
            ("x-amz-meta-note", "a   b  c"),
        ];
        let signed = sign(
            &Credentials {
                access_key_id: ACCESS_KEY_ID,
                secret_access_key: S3_EXAMPLE_SECRET,
            },
            "us-east-1",
            SERVICE,
            "20130524T000000Z",
            &Request {
                method: "DELETE",
                path: "/k",
                query: "",
                headers: &headers,
                payload_sha256: EMPTY_PAYLOAD_SHA256,
            },
        );
        assert!(signed.canonical_request.contains(
            "host:bucket.example\nx-amz-date:20130524T000000Z\nx-amz-meta-note:a b c\n\n"
        ));
        assert_eq!(signed.signed_headers, "host;x-amz-date;x-amz-meta-note");
    }

    #[test]
    fn paths_are_encoded_byte_by_byte_with_unreserved_characters_kept() {
        assert_eq!(uri_encode("test$file.text", true), "test%24file.text");
        assert_eq!(uri_encode("a b/c~d-e_f.g", true), "a%20b/c~d-e_f.g");
        assert_eq!(uri_encode("a/b", false), "a%2Fb");
        assert_eq!(uri_encode("thèse+1", true), "th%C3%A8se%2B1");
    }

    #[test]
    fn dates_are_formatted_in_utc_for_the_signature() {
        assert_eq!(amz_date(1_369_353_600_000), "20130524T000000Z");
        assert_eq!(amz_date(1_760_000_000_999), "20251009T085320Z");
        assert_eq!(amz_date(1_709_251_199_000), "20240229T235959Z");
        assert_eq!(amz_date(951_782_400_000), "20000229T000000Z");
        assert_eq!(amz_date(0), "19700101T000000Z");
    }
}
