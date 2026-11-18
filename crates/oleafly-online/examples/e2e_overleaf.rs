use std::io::BufRead as _;

use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject};
use serde_json::{json, Value};
use tokio::sync::mpsc;

const PROTOCOL: &str = "e2e-overleaf ";
const MAIN: &str = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";

fn say(message: &Value) {
    println!("{PROTOCOL}{message}");
}

fn read_requests() -> mpsc::UnboundedReceiver<String> {
    let (lines, receiver) = mpsc::unbounded_channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}

fn answer(mock: &MockOverleaf, request: &Value) -> Result<Value, String> {
    match request["cmd"].as_str() {
        Some("text") => {
            let path = request["path"].as_str().unwrap_or_default();
            let doc = mock
                .entity_id(path)
                .ok_or_else(|| format!("the project has no {path}"))?;
            Ok(json!({ "text": mock.doc_text(&doc) }))
        }
        Some("crash") => {
            mock.crash();
            Ok(json!({}))
        }
        Some("recover") => {
            mock.recover();
            Ok(json!({}))
        }
        other => Err(format!("unknown command {other:?}")),
    }
}

#[tokio::main]
async fn main() {
    let mock = MockOverleaf::start(
        MockProject::new("E2E Live")
            .doc("main.tex", MAIN)
            .root_doc("main.tex"),
    )
    .await;
    mock.configure(|config| config.sign_in_as = Some("alice".into()));
    say(&json!({ "event": "ready", "server": mock.base, "project": mock.project_id() }));
    let mut requests = read_requests();
    while let Some(line) = requests.recv().await {
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if request["cmd"] == "quit" {
            break;
        }
        let id = request["id"].clone();
        match answer(&mock, &request) {
            Ok(mut reply) => {
                reply["id"] = id;
                reply["ok"] = json!(true);
                say(&reply);
            }
            Err(error) => say(&json!({ "id": id, "ok": false, "error": error })),
        }
    }
}
