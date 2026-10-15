use crate::{Error, ErrorKind, Result};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

fn parse_uuid7_strict(value: &str) -> Option<Uuid> {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return None;
    }
    for (index, byte) in bytes.iter().enumerate() {
        match index {
            8 | 13 | 18 | 23 => {
                if *byte != b'-' {
                    return None;
                }
            }
            14 => {
                if *byte != b'7' {
                    return None;
                }
            }
            19 => {
                if !matches!(byte, b'8' | b'9' | b'a' | b'b') {
                    return None;
                }
            }
            _ => {
                if !byte.is_ascii_digit() && !(b'a'..=b'f').contains(byte) {
                    return None;
                }
            }
        }
    }
    Uuid::parse_str(value).ok()
}

fn invalid(value: &str) -> Error {
    Error::new(ErrorKind::InvalidInput, format!("invalid id {value:?}"))
}

macro_rules! uuid7_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }

            pub fn parse(value: &str) -> Result<Self> {
                parse_uuid7_strict(value)
                    .map(Self)
                    .ok_or_else(|| invalid(value))
            }

            pub fn as_uuid(&self) -> Uuid {
                self.0
            }

            pub fn as_bytes(&self) -> &[u8; 16] {
                self.0.as_bytes()
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl FromStr for $name {
            type Err = Error;

            fn from_str(value: &str) -> Result<Self> {
                Self::parse(value)
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(
                &self,
                serializer: S,
            ) -> std::result::Result<S::Ok, S::Error> {
                serializer.collect_str(self)
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(
                deserializer: D,
            ) -> std::result::Result<Self, D::Error> {
                let value = String::deserialize(deserializer)?;
                Self::parse(&value).map_err(serde::de::Error::custom)
            }
        }
    };
}

uuid7_id!(ProjectId);
uuid7_id!(FileId);
uuid7_id!(DeviceId);

impl DeviceId {
    pub fn id4(&self) -> String {
        let text = self.to_string();
        text[text.len() - 4..].to_string()
    }
}

pub fn device_slug(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut pending_dash = false;
    for character in name.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(character);
        } else {
            pending_dash = true;
        }
    }
    if slug.is_empty() {
        "computer".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::{device_slug, DeviceId, FileId, ProjectId};

    #[test]
    fn generated_ids_round_trip_through_strict_parsing() {
        let project = ProjectId::new();
        let file = FileId::new();
        let device = DeviceId::new();
        assert_eq!(ProjectId::parse(&project.to_string()).unwrap(), project);
        assert_eq!(FileId::parse(&file.to_string()).unwrap(), file);
        assert_eq!(DeviceId::parse(&device.to_string()).unwrap(), device);
        assert_ne!(project, ProjectId::new());
    }

    #[test]
    fn strict_parsing_rejects_every_noncanonical_form() {
        let value = ProjectId::new().to_string();
        for rejected in [
            value.to_uppercase(),
            value.replace('-', ""),
            format!("{{{value}}}"),
            format!("urn:uuid:{value}"),
            "550e8400-e29b-41d4-a716-446655440000".to_string(),
            "018f0000-0000-7000-c000-000000000000".to_string(),
            "018f0000-0000-7000-8000-00000000000".to_string(),
            "018f0000_0000_7000_8000_000000000000".to_string(),
            String::new(),
        ] {
            assert!(ProjectId::parse(&rejected).is_err(), "{rejected}");
        }
    }

    #[test]
    fn serde_round_trip_uses_the_strict_string_form() {
        let device = DeviceId::new();
        let encoded = serde_json::to_string(&device).unwrap();
        assert_eq!(encoded, format!("\"{device}\""));
        assert_eq!(serde_json::from_str::<DeviceId>(&encoded).unwrap(), device);
        assert!(serde_json::from_str::<DeviceId>("\"not-an-id\"").is_err());
    }

    #[test]
    fn id4_is_the_last_four_hex_digits() {
        let device = DeviceId::parse("018f3c2a-7b1e-7f3a-9d4c-5e6f70813f9a").unwrap();
        assert_eq!(device.id4(), "3f9a");
    }

    #[test]
    fn device_slugs_follow_the_shared_reduction() {
        assert_eq!(device_slug("Ada's MacBook Pro"), "ada-s-macbook-pro");
        assert_eq!(device_slug("--Office__PC--"), "office-pc");
        assert_eq!(device_slug("München Ω"), "m-nchen");
        assert_eq!(device_slug(""), "computer");
        assert_eq!(device_slug("☃☃"), "computer");
        assert_eq!(device_slug("PC  42"), "pc-42");
    }
}
