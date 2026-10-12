use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::str::FromStr;
use uuid::{Uuid, Variant, Version};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, thiserror::Error)]
pub enum IdError {
    #[error("id is not a canonical lowercase hyphenated UUID")]
    NotCanonical,
    #[error("id is not a version 7 UUID")]
    NotVersion7,
}

fn parse_v7(text: &str) -> Result<Uuid, IdError> {
    let id = Uuid::parse_str(text).map_err(|_| IdError::NotCanonical)?;
    if id.hyphenated().to_string() != text {
        return Err(IdError::NotCanonical);
    }
    if id.get_variant() != Variant::RFC4122 || id.get_version() != Some(Version::SortRand) {
        return Err(IdError::NotVersion7);
    }
    Ok(id)
}

macro_rules! typed_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new_v7() -> Self {
                Self(Uuid::now_v7())
            }

            pub fn as_uuid(&self) -> Uuid {
                self.0
            }
        }

        impl FromStr for $name {
            type Err = IdError;

            fn from_str(text: &str) -> Result<Self, IdError> {
                parse_v7(text).map(Self)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0.hyphenated(), formatter)
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.collect_str(self)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let text = String::deserialize(deserializer)?;
                text.parse().map_err(serde::de::Error::custom)
            }
        }
    };
}

typed_id!(FileId);
typed_id!(AccountId);
typed_id!(DeviceId);
typed_id!(ServerId);
typed_id!(SharedProjectId);
typed_id!(BatchId);
typed_id!(CommentId);

#[cfg(test)]
mod tests {
    use super::*;

    const CANONICAL: &str = "01920000-0000-7000-8000-000000000001";

    #[test]
    fn every_id_type_generates_version_7_and_round_trips_through_display() {
        fn check<T>(id: T)
        where
            T: Copy + std::fmt::Display + std::fmt::Debug + PartialEq + FromStr<Err = IdError>,
        {
            let text = id.to_string();
            assert_eq!(text.len(), 36);
            assert_eq!(text, text.to_ascii_lowercase());
            assert_eq!(text.parse::<T>(), Ok(id));
        }
        check(FileId::new_v7());
        check(AccountId::new_v7());
        check(DeviceId::new_v7());
        check(ServerId::new_v7());
        check(SharedProjectId::new_v7());
        check(BatchId::new_v7());
        check(CommentId::new_v7());
        assert_eq!(
            FileId::new_v7().as_uuid().get_version(),
            Some(Version::SortRand)
        );
    }

    #[test]
    fn ids_made_one_after_another_sort_in_creation_order() {
        let first = BatchId::new_v7();
        let second = BatchId::new_v7();
        assert!(first < second);
    }

    #[test]
    fn parsing_accepts_only_canonical_lowercase_hyphenated_text() {
        assert!(CANONICAL.parse::<DeviceId>().is_ok());
        for text in [
            "01920000-0000-7000-8000-00000000000A",
            "{01920000-0000-7000-8000-000000000001}",
            "01920000000070008000000000000001",
            "urn:uuid:01920000-0000-7000-8000-000000000001",
            " 01920000-0000-7000-8000-000000000001",
            "",
            "not-a-uuid",
        ] {
            assert_eq!(
                text.parse::<DeviceId>(),
                Err(IdError::NotCanonical),
                "{text}"
            );
        }
    }

    #[test]
    fn parsing_requires_a_version_7_rfc_uuid() {
        for text in [
            "00000000-0000-0000-0000-000000000000",
            "a07b6610-5950-4b90-8a29-c9ea207236c8",
            "01920000-0000-7000-0000-000000000001",
        ] {
            assert_eq!(
                text.parse::<ServerId>(),
                Err(IdError::NotVersion7),
                "{text}"
            );
        }
    }

    #[test]
    fn ids_serialise_as_canonical_strings_and_reject_anything_else() {
        let id: AccountId = CANONICAL.parse().unwrap();
        assert_eq!(
            serde_json::to_string(&id).unwrap(),
            format!("\"{CANONICAL}\"")
        );
        assert_eq!(
            serde_json::from_str::<AccountId>(&format!("\"{CANONICAL}\"")).unwrap(),
            id
        );
        for json in [
            "\"01920000-0000-7000-8000-00000000000A\"",
            "\"a07b6610-5950-4b90-8a29-c9ea207236c8\"",
            "42",
            "null",
        ] {
            assert!(serde_json::from_str::<AccountId>(json).is_err(), "{json}");
        }
    }

    #[test]
    fn errors_describe_the_problem() {
        assert_eq!(
            IdError::NotCanonical.to_string(),
            "id is not a canonical lowercase hyphenated UUID"
        );
        assert_eq!(
            IdError::NotVersion7.to_string(),
            "id is not a version 7 UUID"
        );
    }
}
