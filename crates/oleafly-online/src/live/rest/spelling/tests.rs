use serde_json::{json, Value};

use super::super::tests::rest_for;
use super::super::RestError;
use crate::realtime::page::MAX_WORD_CHARS;
use crate::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser, Privilege};

fn project() -> MockProject {
    MockProject::new("Spelling")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc("main.tex", "Oleaflyish words")
}

fn bodies(mock: &MockOverleaf, route: &str) -> Vec<Value> {
    mock.requests(route)
        .iter()
        .map(|request| serde_json::from_str(&request.body).unwrap())
        .collect()
}

#[tokio::test]
async fn words_are_learned_and_unlearned_exactly_as_written() {
    let mock = MockOverleaf::start(project()).await;
    mock.set_learned_words("bob", &["Zeta"]);
    let (rest, bob) = rest_for(&mock, "bob").await;
    assert_eq!(rest.learned_words(), Some(vec!["Zeta".to_string()]));
    for word in [
        "Oleaflyish",
        "oleaflyish",
        "Größenordnungsx",
        "two words",
        "Oleaflyish",
    ] {
        rest.spell(&bob, word, true).await.unwrap();
    }
    assert_eq!(
        mock.learned_words("bob"),
        [
            "Zeta",
            "Oleaflyish",
            "oleaflyish",
            "Größenordnungsx",
            "two words"
        ]
    );
    rest.spell(&bob, "oleaflyish", false).await.unwrap();
    rest.spell(&bob, "never", false).await.unwrap();
    assert_eq!(
        mock.learned_words("bob"),
        ["Zeta", "Oleaflyish", "Größenordnungsx", "two words"]
    );
    assert_eq!(
        bodies(&mock, "/spelling/learn")[0],
        json!({ "word": "Oleaflyish" })
    );
    assert_eq!(
        bodies(&mock, "/spelling/unlearn"),
        [json!({ "word": "oleaflyish" }), json!({ "word": "never" })]
    );
    assert!(mock
        .requests("/spelling/")
        .iter()
        .all(|request| request.headers.contains_key("x-csrf-token")));
    let (_, alice) = rest_for(&mock, "alice").await;
    assert!(mock.learned_words("alice").is_empty());
    drop(alice);
}

#[tokio::test]
async fn words_overleaf_would_refuse_are_never_sent() {
    let mock = MockOverleaf::start(project()).await;
    let (rest, bob) = rest_for(&mock, "bob").await;
    let long = "x".repeat(MAX_WORD_CHARS + 1);
    for word in ["", "a\u{0}b", "line\nbreak", long.as_str()] {
        assert!(
            matches!(
                rest.spell(&bob, word, true).await,
                Err(RestError::Refused { status: 400, .. })
            ),
            "{word:?}"
        );
    }
    assert!(mock.requests("/spelling/").is_empty());
}

#[tokio::test]
async fn a_full_dictionary_refuses_with_its_reason_and_a_stale_token_is_refreshed() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.dictionary_bytes = 12);
    let (rest, bob) = rest_for(&mock, "bob").await;
    rest.spell(&bob, "Oleaflyish", true).await.unwrap();
    assert_eq!(
        rest.spell(&bob, "another", true).await,
        Err(RestError::Refused {
            status: 400,
            message: "Max dictionary size reached".into(),
        })
    );
    mock.rotate_csrf();
    rest.spell(&bob, "Oleaflyish", false).await.unwrap();
    assert!(mock.learned_words("bob").is_empty());
}
