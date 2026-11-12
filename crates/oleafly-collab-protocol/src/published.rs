use serde::{Deserialize, Serialize};

use crate::projects::PersonSummary;

pub const MAX_PAGE_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_SOURCE_CHARS: usize = 200;
pub const MAX_PAGES_PER_ACCOUNT: u32 = 500;
pub const PUBLIC_PATH: &str = "n";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishNote {
    pub source: String,
    pub title: String,
    pub html: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishedNote {
    pub id: String,
    pub source: String,
    pub title: String,
    pub url: String,
    pub size: u64,
    pub published_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub taken_down: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminPublishedNote {
    pub note: PublishedNote,
    pub author: Option<PersonSummary>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishedNotes {
    pub allowed: bool,
    pub notes: Vec<PublishedNote>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn published_notes_match_the_wire_json() {
        let wire = json!({
            "allowed": true,
            "notes": [{
                "id": "01920000-0000-7000-8000-000000000009",
                "source": "note-7",
                "title": "Reading list",
                "url": "https://collab.example.org/n/abcdefghijklmnop",
                "size": 2048,
                "published_at": 5,
                "updated_at": 9,
                "taken_down": false
            }]
        });
        let listed: PublishedNotes = serde_json::from_value(wire.clone()).unwrap();
        assert!(listed.allowed);
        assert_eq!(listed.notes[0].title, "Reading list");
        assert_eq!(serde_json::to_value(listed).unwrap(), wire);
        let upload: PublishNote =
            serde_json::from_str(r#"{"source":"note-7","title":"T","html":"<p>x</p>"}"#).unwrap();
        assert_eq!(upload.html, "<p>x</p>");
        assert_eq!(PublishedNotes::default().notes.len(), 0);
        let mut older = wire["notes"][0].clone();
        older.as_object_mut().unwrap().remove("taken_down");
        assert!(
            !serde_json::from_value::<PublishedNote>(older)
                .unwrap()
                .taken_down
        );
    }
}
