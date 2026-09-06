use std::io::{BufRead, Write};
use std::time::Duration;

use serde_json::Value;

pub const STDIO_FLAG: &str = "--oleafly-mcp-stdio";
const URL_VAR: &str = "OLEAFLY_MCP_URL";
const TOKEN_VAR: &str = "OLEAFLY_MCP_TOKEN";
const MAX_LINE_BYTES: usize = 256 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

pub fn stdio_server(http: &Value) -> Result<Value, String> {
    let url = http["url"]
        .as_str()
        .ok_or("The research tool server has no address.")?;
    let token = http["headers"]
        .as_array()
        .and_then(|headers| {
            headers.iter().find(|header| {
                header["name"]
                    .as_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case("authorization"))
            })
        })
        .and_then(|header| header["value"].as_str())
        .ok_or("The research tool server has no credential.")?;
    let executable = std::env::current_exe()
        .map_err(|_| "Oleafly could not locate its own executable.".to_string())?;
    Ok(serde_json::json!({
        "name": http["name"].as_str().unwrap_or("oleafly-research"),
        "command": executable.to_string_lossy(),
        "args": [STDIO_FLAG],
        "env": [
            { "name": URL_VAR, "value": url },
            { "name": TOKEN_VAR, "value": token },
        ],
    }))
}

pub fn stdio_bridge_requested() -> bool {
    std::env::args_os().any(|value| value == STDIO_FLAG)
}

pub fn serve_stdio_bridge() -> i32 {
    let Ok(url) = std::env::var(URL_VAR) else {
        return 2;
    };
    let Ok(token) = std::env::var(TOKEN_VAR) else {
        return 2;
    };
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return 2;
    };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    match pump(&runtime, &url, &token, stdin.lock(), &mut stdout) {
        Ok(()) => 0,
        Err(code) => code,
    }
}

pub(super) fn pump(
    runtime: &tokio::runtime::Runtime,
    url: &str,
    token: &str,
    mut reader: impl BufRead,
    writer: &mut impl Write,
) -> Result<(), i32> {
    let client = reqwest::Client::builder()
        .timeout(CALL_TIMEOUT)
        .build()
        .map_err(|_| 2)?;
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return Ok(()),
            Ok(_) => {}
        }
        let request = line.trim();
        if request.is_empty() {
            continue;
        }
        if request.len() > MAX_LINE_BYTES {
            return Err(1);
        }
        let Ok(message) = serde_json::from_str::<Value>(request) else {
            continue;
        };
        let id = message.get("id").cloned();
        let sent = runtime.block_on(async {
            let response = client
                .post(url)
                .header("Authorization", token)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .json(&message)
                .send()
                .await?;
            response.text().await
        });
        let body = match sent {
            Ok(body) => body,
            Err(_) => match id {
                None => continue,
                Some(id) => serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32603,
                        "message": "The research tool server is unavailable.",
                    },
                })
                .to_string(),
            },
        };
        let body = body.trim();
        if body.is_empty() {
            continue;
        }
        if writeln!(writer, "{body}").is_err() || writer.flush().is_err() {
            return Ok(());
        }
    }
}
