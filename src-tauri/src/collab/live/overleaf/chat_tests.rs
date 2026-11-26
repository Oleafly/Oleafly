use std::time::{Duration, Instant};

use oleafly_online::live::session::ChatChange;
use oleafly_online::test_support::mock_overleaf::{MockProject, MockUser, Privilege};

use super::chat::{OnlineChatMessage, OVERLEAF_CHAT_UNITS};
use super::rig::{eventually, run, FirstStart, OverleafRig, Place, WAIT};
use crate::collab::chat::CollabChatStatus;
use crate::collab::commands::CollabCommandError;
use crate::collab::live::payloads::MemberStanding;

const MAIN: &str = "main.tex";
const TEXT: &str = "Chat about this.\n";
const DISK: &[(&str, &str)] = &[(MAIN, TEXT)];
const UNKNOWN: &str = "6b04e5f6c0ffee00ff000001";

fn project() -> MockProject {
    MockProject::new("chat")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .member(MockUser::named("erin"), Privilege::ReadAndWrite)
        .doc(MAIN, TEXT)
}

async fn rig_with(project: MockProject, name: &str, chat_off: bool) -> OverleafRig {
    let first = FirstStart {
        imported: DISK,
        chat_off,
        ..FirstStart::default()
    };
    let rig = OverleafRig::start_full(project, DISK, Place::Scratch, first, name).await;
    eventually("chat support is known", || {
        rig.live.session.chat_support().probed
    })
    .await;
    rig
}

async fn rig_as(project: MockProject, name: &str) -> OverleafRig {
    rig_with(project, name, false).await
}

fn code<T: std::fmt::Debug>(result: Result<T, CollabCommandError>) -> &'static str {
    result.expect_err("a refusal").code
}

fn object_id(id: &str) -> bool {
    id.len() == 24
        && id
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn bodies(listed: &[OnlineChatMessage]) -> Vec<&str> {
    listed.iter().map(|message| message.body.as_str()).collect()
}

fn told(rig: &OverleafRig, local: bool) -> usize {
    rig.host
        .chat
        .lock()
        .unwrap()
        .iter()
        .filter(|payload| payload.local == local && payload.project_id == rig.project_id)
        .count()
}

fn on_overleaf(rig: &OverleafRig, content: &str) -> Option<String> {
    rig.mock
        .chat_messages()
        .as_array()?
        .iter()
        .find(|message| message["content"] == content)
        .and_then(|message| message["id"].as_str().map(str::to_owned))
}

async fn listed_until(
    rig: &OverleafRig,
    what: &str,
    check: impl Fn(&[OnlineChatMessage]) -> bool,
) -> Vec<OnlineChatMessage> {
    let started = Instant::now();
    loop {
        let listed = rig.live.chat_list(None, 50).await.unwrap();
        if check(&listed) {
            return listed;
        }
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn standing(rig: &OverleafRig, name: &str) -> Option<MemberStanding> {
    let id = MockUser::named(name).id;
    rig.live
        .members()
        .into_iter()
        .find(|member| member.person.account_id == id)
        .map(|member| member.standing)
}

#[test]
fn overleaf_chat_pages_by_message_and_a_send_shows_once_with_its_real_id() {
    run(async {
        let rig = rig_as(project(), "alice").await;
        let status = rig.live.chat_status();
        assert_eq!(
            status,
            CollabChatStatus {
                available: true,
                post: true,
                reactions: false,
                edit: true,
                clear: false,
                math: true,
                markdown: false,
                max_length: OVERLEAF_CHAT_UNITS,
            }
        );
        let wire = serde_json::to_value(status).unwrap();
        assert_eq!(
            (wire["maxLength"].clone(), wire["markdown"].clone()),
            (10_240.into(), false.into())
        );
        let bob = rig.mock.peer("bob");
        for text in ["one", "two", "three"] {
            assert_eq!(bob.post_chat(text, None).status, 204);
        }
        listed_until(&rig, "bob's messages arrive", |listed| listed.len() == 3).await;
        eventually("others' messages are told as news", || {
            told(&rig, false) > 0
        })
        .await;
        let newest = rig.live.chat_list(None, 2).await.unwrap();
        assert_eq!(bodies(&newest), ["two", "three"]);
        assert!(newest
            .iter()
            .all(|message| object_id(&message.id) && message.verified && !message.pending));
        assert_eq!(newest[0].author, MockUser::named("bob").id);
        let older = rig.live.chat_list(Some(&newest[0].id), 2).await.unwrap();
        assert_eq!(bodies(&older), ["one"]);
        assert_eq!(
            code(rig.live.chat_list(Some(UNKNOWN), 2).await),
            "not_found"
        );
        let news = told(&rig, false);
        let mine = told(&rig, true);
        let sent = rig.live.chat_send("  Hello $x$  ").await.unwrap();
        assert_eq!(sent.body, "Hello $x$");
        assert!(!sent.pending, "{sent:?}");
        assert_eq!(Some(sent.id.clone()), on_overleaf(&rig, "Hello $x$"));
        assert_eq!(sent.author, MockUser::named("alice").id);
        let listed = rig.live.chat_list(None, 50).await.unwrap();
        assert_eq!(bodies(&listed), ["one", "two", "three", "Hello $x$"]);
        eventually("the send is told as local", || told(&rig, true) > mine).await;
        assert_eq!(told(&rig, false), news, "an own echo is not news");
        rig.finish().await;
    });
}

#[test]
fn own_messages_are_edited_and_deleted_on_overleaf_and_the_rest_is_refused() {
    run(async {
        let rig = rig_as(project(), "alice").await;
        let mine = rig.live.chat_send("First").await.unwrap();
        let edited = rig.live.chat_edit(&mine.id, "First, edited").await.unwrap();
        assert_eq!(
            (edited.id.as_str(), edited.body.as_str()),
            (mine.id.as_str(), "First, edited")
        );
        assert!(edited.edited_at.is_some());
        assert_eq!(on_overleaf(&rig, "First, edited"), Some(mine.id.clone()));
        let bob = rig.mock.peer("bob");
        assert_eq!(bob.post_chat("From Bob", None).status, 204);
        let from_bob = on_overleaf(&rig, "From Bob").unwrap();
        listed_until(&rig, "bob's message arrives", |listed| {
            listed.iter().any(|message| message.id == from_bob)
        })
        .await;
        assert_eq!(
            code(rig.live.chat_edit(&from_bob, "Mine now").await),
            "forbidden"
        );
        assert_eq!(code(rig.live.chat_delete(&from_bob).await), "forbidden");
        assert_eq!(bob.delete_chat(&from_bob).status, 204);
        listed_until(&rig, "bob's delete leaves no tombstone", |listed| {
            listed.iter().all(|message| message.id != from_bob)
        })
        .await;
        rig.live.chat_delete(&mine.id).await.unwrap();
        assert_eq!(on_overleaf(&rig, "First, edited"), None);
        assert_eq!(code(rig.live.chat_delete(&mine.id).await), "not_found");
        assert_eq!(
            code(rig.live.chat_edit(&mine.id, "Again").await),
            "not_found"
        );
        assert!(rig.live.chat_list(None, 50).await.unwrap().is_empty());
        assert_eq!(rig.live.chat_reactions_refused().code, "forbidden");
        assert_eq!(rig.live.chat_clear_refused().code, "chat_role");
        assert_eq!(code(rig.live.chat_send("   ").await), "invalid");
        let long = "x".repeat(OVERLEAF_CHAT_UNITS + 1);
        assert_eq!(code(rig.live.chat_send(&long).await), "too_large");
        let astral = "\u{1F600}".repeat(OVERLEAF_CHAT_UNITS / 2 + 1);
        assert_eq!(code(rig.live.chat_send(&astral).await), "too_large");
        let full = "y".repeat(OVERLEAF_CHAT_UNITS);
        assert_eq!(rig.live.chat_send(&full).await.unwrap().body, full);
        rig.finish().await;
    });
}

#[test]
fn a_viewer_chats_on_overleaf_and_a_link_viewer_has_no_chat() {
    run(async {
        let rig = rig_as(project(), "dave").await;
        assert!(rig.live.chat_status().post);
        let sent = rig.live.chat_send("Viewers chat here").await.unwrap();
        assert_eq!(sent.author, MockUser::named("dave").id);
        rig.finish().await;
        let rig = rig_as(project().token_viewer(MockUser::named("tess")), "tess").await;
        let status = rig.live.chat_status();
        assert!(!status.available && !status.post, "{status:?}");
        assert_eq!(code(rig.live.chat_send("Hello").await), "chat_role");
        assert_eq!(code(rig.live.chat_list(None, 50).await), "chat_role");
        assert!(on_overleaf(&rig, "Hello").is_none());
        rig.finish().await;
    });
}

#[test]
fn without_chat_on_the_server_the_chat_is_off_and_lists_nothing() {
    run(async {
        let rig = rig_with(project(), "alice", true).await;
        let status = rig.live.chat_status();
        assert!(!status.available && !status.post, "{status:?}");
        assert_eq!(code(rig.live.chat_list(None, 50).await), "not_found");
        assert_eq!(code(rig.live.chat_send("Hello").await), "chat_off_server");
        assert_eq!(
            code(rig.live.chat_edit(UNKNOWN, "Hello").await),
            "chat_off_server"
        );
        rig.finish().await;
    });
}

#[test]
fn chat_trouble_is_logged_once_until_it_changes() {
    run(async {
        let rig = rig_as(project(), "alice").await;
        let change = |trouble: Option<&str>| ChatChange {
            local: true,
            support: false,
            trouble: trouble.map(str::to_owned),
        };
        let first = rig
            .live
            .mirror
            .chat_noticed(&change(Some("the chat messages did not arrive")));
        assert!(first.is_some_and(|line| line.contains("the chat messages did not arrive")));
        assert_eq!(
            rig.live
                .mirror
                .chat_noticed(&change(Some("the chat messages did not arrive"))),
            None
        );
        assert_eq!(rig.live.mirror.chat_noticed(&change(None)), None);
        assert!(rig
            .live
            .mirror
            .chat_noticed(&change(Some("again")))
            .is_some());
        rig.finish().await;
    });
}

#[test]
fn people_off_the_roster_keep_their_names_with_their_standing() {
    run(async {
        let rig = rig_as(
            project().invited("ivy@oleafly.edu", Privilege::ReadAndWrite),
            "alice",
        )
        .await;
        assert_eq!(standing(&rig, "alice"), Some(MemberStanding::Member));
        let invited = rig
            .live
            .members()
            .into_iter()
            .find(|member| member.standing == MemberStanding::Invited)
            .unwrap();
        assert_eq!(invited.person.display_name, "ivy@oleafly.edu");
        let bob = rig.mock.peer("bob");
        assert_eq!(bob.post_chat("Bob was here", None).status, 204);
        listed_until(&rig, "bob's message arrives", |listed| !listed.is_empty()).await;
        rig.mock.set_privilege("bob", None);
        eventually("bob is a former member", || {
            standing(&rig, "bob") == Some(MemberStanding::Former)
        })
        .await;
        rig.mock.set_privilege("erin", None);
        eventually("erin left the roster", || standing(&rig, "erin").is_none()).await;
        rig.mock.record_version("erin", MAIN);
        let told = *rig.host.members_changed.lock().unwrap();
        let page = rig
            .live
            .history_list(None, 50, crate::collab::commands::now_ms())
            .await
            .unwrap();
        assert_eq!(page.entries[0].authors, [MockUser::named("erin").id]);
        assert_eq!(standing(&rig, "erin"), Some(MemberStanding::Former));
        let erin = MockUser::named("erin");
        let named = rig
            .live
            .members()
            .into_iter()
            .find(|member| member.person.account_id == erin.id)
            .unwrap();
        assert_eq!(
            named.person.display_name,
            format!("{} {}", erin.first_name, erin.last_name)
        );
        assert!(*rig.host.members_changed.lock().unwrap() > told);
        rig.finish().await;
        let rig = rig_as(project().token_viewer(MockUser::named("tess")), "alice").await;
        let bob = rig.mock.peer("bob");
        assert_eq!(bob.post_chat("Bob was here", None).status, 204);
        listed_until(&rig, "bob's message arrives", |listed| !listed.is_empty()).await;
        rig.mock.set_privilege("bob", None);
        eventually("bob is unlisted on a link-shared project", || {
            standing(&rig, "bob") == Some(MemberStanding::Unlisted)
        })
        .await;
        rig.finish().await;
    });
}
