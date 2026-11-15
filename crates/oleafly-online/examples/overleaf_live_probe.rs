use std::time::{Duration, Instant};

use oleafly_online::client::Http;
use oleafly_online::html;
use oleafly_online::realtime::project::{CapabilityCache, ProjectState};
use oleafly_online::realtime::{connect, Carrier, ProjectPage, ServerEvent};
use oleafly_online::session::{self, SessionHandle};
use serde_json::json;

const AGENT: &str = concat!("Oleafly/", env!("CARGO_PKG_VERSION"), " probe");
const USAGE: &str = "usage: overleaf_live_probe --server <url> --project <id> \
[--carrier websocket|xhr-polling|both] [--seconds <n>] [--email <address>]\n\
The password comes from OVERLEAF_PROBE_PASSWORD, or a whole cookie header from OVERLEAF_PROBE_COOKIE.";

struct Options {
    server: String,
    project: String,
    carriers: Vec<Carrier>,
    seconds: u64,
    email: Option<String>,
}

fn options() -> Result<Options, String> {
    let mut args = std::env::args().skip(1);
    let mut server = None;
    let mut project = None;
    let mut carriers = vec![Carrier::WebSocket, Carrier::XhrPolling];
    let mut seconds = 60;
    let mut email = None;
    while let Some(flag) = args.next() {
        let mut value = || args.next().ok_or_else(|| format!("{flag} needs a value"));
        match flag.as_str() {
            "--server" => server = Some(value()?),
            "--project" => project = Some(value()?),
            "--email" => email = Some(value()?),
            "--seconds" => seconds = value()?.parse().map_err(|_| "--seconds takes a number")?,
            "--carrier" => {
                carriers = match value()?.as_str() {
                    "websocket" => vec![Carrier::WebSocket],
                    "xhr-polling" => vec![Carrier::XhrPolling],
                    "both" => vec![Carrier::WebSocket, Carrier::XhrPolling],
                    other => return Err(format!("unknown carrier {other}")),
                }
            }
            other => return Err(format!("unknown flag {other}")),
        }
    }
    Ok(Options {
        server: session::normalize_server(Some(&server.ok_or("--server is required")?))
            .map_err(|error| format!("{:?}", error.kind))?,
        project: project.ok_or("--project is required")?,
        carriers,
        seconds,
        email,
    })
}

async fn sign_in(http: &Http, email: &str, password: &str) -> Result<String, String> {
    let login = http
        .get("/login", "")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let mut cookie = session::merge_set_cookies(
        "",
        login
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|value| value.to_str().ok()),
    );
    let page = login.text().await.map_err(|error| error.to_string())?;
    let csrf = html::meta_text(&html::meta_tags(&page), "ol-csrfToken")
        .ok_or("the sign-in page has no CSRF token")?;
    let answer = http
        .post("/login", &cookie)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .body(json!({ "email": email, "password": password, "_csrf": csrf }).to_string())
        .send()
        .await
        .map_err(|error| error.to_string())?;
    cookie = session::merge_set_cookies(
        &cookie,
        answer
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|value| value.to_str().ok()),
    );
    let status = answer.status();
    let body = answer.text().await.unwrap_or_default();
    if !status.is_success() || !body.contains("redir") {
        return Err(format!("sign-in failed with HTTP {status}: {body}"));
    }
    Ok(cookie)
}

async fn run(options: Options) -> Result<(), String> {
    let http = Http::new(&options.server, AGENT).map_err(|error| format!("{:?}", error.kind))?;
    let cookie = match (&options.email, std::env::var("OVERLEAF_PROBE_COOKIE")) {
        (Some(email), _) => {
            let password = std::env::var("OVERLEAF_PROBE_PASSWORD")
                .map_err(|_| "OVERLEAF_PROBE_PASSWORD is not set")?;
            sign_in(&http, email, &password).await?
        }
        (None, Ok(cookie)) => cookie,
        (None, Err(_)) => return Err(USAGE.to_string()),
    };
    let signed_in = session::session_from_cookie(&http, cookie, "probe")
        .await
        .map_err(|error| format!("the dashboard refused the session: {:?}", error.kind))?;
    println!("signed in as {} ({})", signed_in.email, signed_in.user_id);
    let handle = SessionHandle::new(&options.server, signed_in, None);
    let page = ProjectPage::load(&http, &handle, &options.project, false)
        .await
        .map_err(|error| format!("the editor page failed: {:?}", error.kind))?;
    println!(
        "editor page: wsUrl {:?}, max doc length {:?}, reconnect window {:?}",
        page.ws_url(),
        page.max_doc_length(),
        page.max_reconnect_gracefully()
    );
    let (mut connection, join) = connect(&http, &handle, &page, &options.carriers)
        .await
        .map_err(|error| error.to_string())?;
    println!(
        "connected over {} as {} ({}), protocol {}",
        connection.carrier().wire_name(),
        join.public_id,
        join.response["permissionsLevel"],
        join.response["protocolVersion"]
    );
    let mut state = ProjectState::from_join(join.response.clone())
        .map_err(|unsupported| format!("the join can't be read: {unsupported:?}"))?;
    println!(
        "role {} (restricted {}), track changes for me {}, {} members",
        state.role.collab_name(),
        state.restricted,
        state.tracks_changes_for(handle.user_id()),
        state.members.all().count()
    );
    for member in state.members.all() {
        println!(
            "  member {} <{}> {}",
            member.first_name,
            member.email,
            member.role.collab_name()
        );
    }
    println!("settings {:?}", state.settings());
    println!(
        "names a Windows coauthor can check out: {:?}",
        state.tree.paths_report().map_err(|error| error.kind)
    );
    for node in state.tree.nodes() {
        println!(
            "  {:?} {}",
            node.kind,
            state.tree.path_of(&node.id).unwrap_or_default()
        );
    }
    let capabilities = CapabilityCache::default()
        .refresh(&http, &handle, &options.project, &state.features)
        .await;
    println!("capabilities {capabilities:?}");
    let deadline = Instant::now() + Duration::from_secs(options.seconds);
    loop {
        for change in state.tree.due(Instant::now()) {
            println!("  tree {change:?}");
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match tokio::time::timeout(left.min(Duration::from_secs(1)), connection.next_event()).await
        {
            Ok(Some(event)) => {
                println!("{event:?}");
                match &event {
                    ServerEvent::Tree(change) => {
                        for change in state.tree.apply(change, Instant::now()) {
                            println!("  tree {change:?}");
                        }
                    }
                    ServerEvent::Project(change) => {
                        state.apply_project(change);
                        println!("  settings {:?}", state.settings());
                    }
                    ServerEvent::Access(change) => {
                        let refresh = state.apply_access(change);
                        if refresh
                            && state
                                .refresh_members(&http, &handle, &options.project)
                                .await
                                .is_ok()
                        {
                            println!("  {} members now", state.members.all().count());
                        }
                    }
                    _ => {}
                }
            }
            Ok(None) => {
                println!("the connection ended: {:?}", connection.dropped());
                return Ok(());
            }
            Err(_) => {}
        }
    }
    connection.close().await;
    println!("closed");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let result = match options() {
        Ok(options) => run(options).await,
        Err(error) => Err(format!("{error}\n{USAGE}")),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
