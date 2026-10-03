use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;

use super::protocol::{
    self, CompileStatus, DocumentPoint, PreviewEvent, SourcePoint, MAX_FORWARD_PROBES,
};
use super::session::{self, Connection, ServerSpec, Timeouts};
use super::ws::{self, Incoming};
use super::*;

fn version(text: &str) -> ToolchainVersion {
    ToolchainVersion::parse(text).unwrap()
}

#[test]
fn only_tinymist_builds_from_0_13_30_answer_both_sync_directions() {
    for unsupported in ["0.11.32", "0.12.22", "0.13.29"] {
        assert!(
            !protocol::tinymist_supports_sync(&version(unsupported)),
            "{unsupported}"
        );
    }
    for supported in ["0.13.30", "0.14.20", "0.15.2", "0.15.8", "0.16.0"] {
        assert!(
            protocol::tinymist_supports_sync(&version(supported)),
            "{supported}"
        );
    }
}

fn typst_meta(pin: Option<&str>) -> ProjectMeta {
    let mut meta = ProjectMeta {
        name: "Paper".into(),
        main_doc: "main.typ".into(),
        engine: "typst".into(),
        ..ProjectMeta::default()
    };
    meta.set_typst_version_pin(pin.map(str::to_owned));
    meta
}

#[test]
fn projects_whose_typst_matches_an_old_tinymist_hide_sync() {
    assert!(!supported_for_project(&typst_meta(Some("0.11.1"))));
    assert!(!supported_for_project(&typst_meta(Some("0.12.0"))));
    assert!(supported_for_project(&typst_meta(Some("0.13.1"))));
    assert!(supported_for_project(&typst_meta(Some("0.14.2"))));
    assert!(supported_for_project(&typst_meta(Some("0.15.1"))));
    let latex = ProjectMeta {
        main_doc: "main.tex".into(),
        engine: "latex".into(),
        ..ProjectMeta::default()
    };
    assert!(!supported_for_project(&latex));
}

#[test]
fn the_typst_descriptor_reports_sync_only_where_tinymist_answers() {
    let _env = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let mut old = crate::document_engine::descriptor_for("typst", "main.typ").unwrap();
    crate::typst_toolchain::describe_project(&mut old, &typst_meta(Some("0.12.0")));
    let mut current = crate::document_engine::descriptor_for("typst", "main.typ").unwrap();
    crate::typst_toolchain::describe_project(&mut current, &typst_meta(Some("0.14.2")));
    std::env::remove_var("OLEAFLY_DATA_DIR");
    assert!(!old.capabilities.supports_synctex);
    assert!(current.capabilities.supports_synctex);
}

#[test]
fn jump_messages_parse_into_page_points() {
    assert_eq!(
        protocol::parse_data_message(b"jump,1 70.86614 96.28714"),
        Some(PreviewEvent::Jump(DocumentPoint {
            page: 1,
            x: 70.86614,
            y: 96.28714
        }))
    );
    assert_eq!(
        protocol::parse_data_message(b"jump,3 10 20\n"),
        Some(PreviewEvent::Jump(DocumentPoint {
            page: 3,
            x: 10.0,
            y: 20.0
        }))
    );
    for rejected in [
        &b"jump,0 1 2"[..],
        b"jump,1 NaN 2",
        b"jump,1 2",
        b"jump,1 2 3 4",
        b"viewport,1 2 3",
        b"diff-v1,\x00\x01",
        b"new,Libertinus",
    ] {
        assert_eq!(protocol::parse_data_message(rejected), None);
    }
}

#[test]
fn control_messages_parse_editor_jumps_and_compile_status() {
    assert_eq!(
        protocol::parse_control_message(
            br#"{"event":"editorScrollTo","filepath":"/p/main.typ","start":[5,1],"end":[5,1]}"#
        ),
        Some(PreviewEvent::EditorScrollTo(SourcePoint {
            filepath: "/p/main.typ".into(),
            line: 5,
            character: 1,
        }))
    );
    for (kind, status) in [
        ("Compiling", CompileStatus::Compiling),
        ("CompileSuccess", CompileStatus::Success),
        ("CompileError", CompileStatus::Error),
    ] {
        let message = format!(r#"{{"event":"compileStatus","kind":"{kind}"}}"#);
        assert_eq!(
            protocol::parse_control_message(message.as_bytes()),
            Some(PreviewEvent::Compile(status))
        );
    }
    for ignored in [
        &br#"{"event":"syncEditorChanges"}"#[..],
        br#"{"event":"outline","items":[]}"#,
        br#"{"event":"editorScrollTo","filepath":"/p","start":null}"#,
        br#"{"event":"compileStatus","kind":"Paused"}"#,
        b"not json",
    ] {
        assert_eq!(protocol::parse_control_message(ignored), None);
    }
}

#[test]
fn requests_are_written_the_way_the_preview_server_reads_them() {
    let forward: serde_json::Value =
        serde_json::from_str(&protocol::panel_scroll_to("/p/main.typ", 4, 7)).unwrap();
    assert_eq!(
        forward,
        serde_json::json!({"event":"panelScrollTo","filepath":"/p/main.typ","line":4,"character":7})
    );
    let point = protocol::src_point(DocumentPoint {
        page: 2,
        x: 100.5,
        y: 75.0,
    });
    let json = point.strip_prefix("src-point ").unwrap();
    let parsed: serde_json::Value = serde_json::from_str(json).unwrap();
    assert_eq!(parsed["page_no"], 2);
    assert_eq!(parsed["x"], 100.5);
    assert_eq!(parsed["y"], 75.0);
    let files = BTreeMap::from([("/p/main.typ".to_string(), "= Hi".to_string())]);
    let sync: serde_json::Value =
        serde_json::from_str(&protocol::sync_memory_files(&files)).unwrap();
    assert_eq!(
        sync,
        serde_json::json!({"event":"syncMemoryFiles","files":{"/p/main.typ":"= Hi"}})
    );
}

#[test]
fn columns_convert_between_utf16_and_characters() {
    let line = "😀😀 wörds 漢字";
    assert_eq!(protocol::utf16_to_char_column(line, 0), 0);
    assert_eq!(protocol::utf16_to_char_column(line, 2), 1);
    assert_eq!(protocol::utf16_to_char_column(line, 5), 3);
    assert_eq!(
        protocol::utf16_to_char_column(line, 99),
        line.chars().count()
    );
    assert_eq!(protocol::char_to_utf16_column(line, 3), 5);
    assert_eq!(protocol::char_to_utf16_column(line, 9), 11);
    assert_eq!(protocol::char_to_utf16_column("ascii", 3), 3);
    assert_eq!(protocol::source_lines("a\r\nb\nc"), vec!["a", "b", "c"]);
}

#[test]
fn forward_candidates_sit_inside_words_and_skip_code() {
    let text = "#set page(margin: 1cm)\n= A Heading Here\nSecond *bold words* here.\n#lorem(40)\n";
    let candidates = protocol::forward_candidates(text, 2, Some(9));
    assert_eq!(candidates[0], (2, 9));
    assert!(candidates.iter().all(|(line, _)| *line <= 3));
    assert!(candidates.len() <= MAX_FORWARD_PROBES);
    let line_two: Vec<usize> = candidates
        .iter()
        .filter(|(line, _)| *line == 2)
        .map(|(_, column)| *column)
        .collect();
    assert_eq!(line_two.len(), 4);
    assert!(line_two.iter().all(|column| {
        let before = text
            .lines()
            .nth(2)
            .unwrap()
            .chars()
            .nth(column - 1)
            .unwrap();
        before.is_alphanumeric()
    }));
    let code = protocol::forward_candidates(text, 3, Some(3));
    assert!(code.iter().all(|(line, _)| *line != 3));
    assert!(code.iter().any(|(line, _)| *line == 2));
    assert_eq!(
        protocol::forward_candidates(text, 0, None).first(),
        Some(&(1, 3))
    );
    assert!(protocol::forward_candidates(text, 40, None).is_empty());
    let after_space = protocol::forward_candidates("Hello world", 0, Some(6));
    assert_ne!(after_space[0], (0, 6));
}

#[test]
fn forward_rects_cover_the_line_above_the_baseline() {
    let rect = protocol::rect_for_jump(DocumentPoint {
        page: 2,
        x: 70.0,
        y: 96.0,
    });
    assert_eq!(rect.page, 2);
    assert_eq!(rect.x, 70.0);
    assert_eq!(rect.y, 87.0);
    assert_eq!(rect.height, 12.0);
    assert!(rect.width > 0.0);
    let top = protocol::rect_for_jump(DocumentPoint {
        page: 1,
        x: 0.0,
        y: 3.0,
    });
    assert_eq!(top.y, 0.0);
}

#[test]
fn inverse_probes_start_at_the_click_and_stay_on_the_page() {
    let probes = protocol::inverse_probes(DocumentPoint {
        page: 3,
        x: 2.0,
        y: 100.0,
    });
    assert_eq!(
        probes[0],
        DocumentPoint {
            page: 3,
            x: 2.0,
            y: 100.0
        }
    );
    assert!(probes.len() > 1);
    assert!(probes
        .iter()
        .all(|probe| probe.page == 3 && probe.x >= 0.0 && probe.y >= 0.0));
}

#[test]
fn source_paths_stay_inside_the_project() {
    assert_eq!(
        protocol::validate_relative("sections/intro.typ"),
        Some(PathBuf::from("sections").join("intro.typ"))
    );
    for rejected in [
        "",
        "../main.typ",
        "/etc/passwd",
        "a/../../b.typ",
        "a\\b.typ",
        "a\0b",
    ] {
        assert_eq!(protocol::validate_relative(rejected), None, "{rejected:?}");
    }
    let root = PathBuf::from("/projects/paper");
    let alias = PathBuf::from("/link/paper");
    let roots = vec![root.clone(), alias.clone()];
    assert_eq!(
        protocol::relative_source(&root.join("sections").join("a.typ"), &roots),
        Some("sections/a.typ".into())
    );
    assert_eq!(
        protocol::relative_source(&alias.join("main.typ"), &roots),
        Some("main.typ".into())
    );
    assert_eq!(
        protocol::relative_source(Path::new("/elsewhere/x.typ"), &roots),
        None
    );
    assert_eq!(protocol::relative_source(&root, &roots), None);
}

#[test]
fn memory_files_name_absolute_paths_and_refuse_escapes() {
    let root = PathBuf::from("/projects/paper");
    let sources = BTreeMap::from([
        ("main.typ".to_string(), "= A".to_string()),
        ("sections/b.typ".to_string(), "B".to_string()),
    ]);
    let files = memory_files(&root, &sources).unwrap();
    assert_eq!(
        files
            .get(root.join("main.typ").to_str().unwrap())
            .map(String::as_str),
        Some("= A")
    );
    assert_eq!(files.len(), 2);
    let escape = BTreeMap::from([("../x.typ".to_string(), String::new())]);
    assert!(memory_files(&root, &escape).is_err());
    assert_eq!(protocol::sources_fingerprint(&BTreeMap::new()), None);
    let changed = BTreeMap::from([("main.typ".to_string(), "= B".to_string())]);
    assert_ne!(
        protocol::sources_fingerprint(&sources),
        protocol::sources_fingerprint(&changed)
    );
}

#[test]
fn the_server_listens_on_loopback_for_both_planes() {
    let spec = ServerSpec {
        program: PathBuf::from("tinymist"),
        root: PathBuf::from("/p"),
        main: PathBuf::from("/p/main.typ"),
        environment: Vec::new(),
    };
    let args: Vec<String> = session::server_args(&spec, 4001, 4002)
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        args,
        [
            "preview",
            "--data-plane-host",
            "127.0.0.1:4001",
            "--control-plane-host",
            "127.0.0.1:4002",
            "--no-open",
            "--root",
            "/p",
            "/p/main.typ"
        ]
    );
    let (data, control) = session::reserve_ports().unwrap();
    assert_ne!(data, control);
}

const SERVER_TEXT: u8 = 0x1;
const SERVER_BINARY: u8 = 0x2;
const SERVER_PING: u8 = 0x9;

fn server_frame(opcode: u8, payload: &[u8], fin: bool) -> Vec<u8> {
    let mut frame = vec![if fin { 0x80 | opcode } else { opcode }];
    let length = payload.len();
    if length < 126 {
        frame.push(length as u8);
    } else if let Ok(short) = u16::try_from(length) {
        frame.push(126);
        frame.extend_from_slice(&short.to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(length as u64).to_be_bytes());
    }
    frame.extend_from_slice(payload);
    frame
}

struct ClientFrame {
    opcode: u8,
    masked: bool,
    payload: Vec<u8>,
}

async fn read_client_frame(stream: &mut tokio::net::tcp::OwnedReadHalf) -> Option<ClientFrame> {
    let mut head = [0u8; 2];
    stream.read_exact(&mut head).await.ok()?;
    let opcode = head[0] & 0x0F;
    let masked = head[1] & 0x80 != 0;
    let length = match head[1] & 0x7F {
        126 => u64::from(stream.read_u16().await.ok()?),
        127 => stream.read_u64().await.ok()?,
        short => u64::from(short),
    };
    let mut mask = [0u8; 4];
    if masked {
        stream.read_exact(&mut mask).await.ok()?;
    }
    let mut payload = vec![0u8; length as usize];
    stream.read_exact(&mut payload).await.ok()?;
    if masked {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }
    Some(ClientFrame {
        opcode,
        masked,
        payload,
    })
}

struct Upgrade {
    read: tokio::net::tcp::OwnedReadHalf,
    write: OwnedWriteHalf,
    origin: Option<String>,
    accept: String,
}

async fn accept_upgrade(stream: TcpStream) -> Upgrade {
    let (mut read, write) = stream.into_split();
    let mut request = Vec::new();
    let mut byte = [0u8; 1];
    while !request.ends_with(b"\r\n\r\n") {
        read.read_exact(&mut byte).await.unwrap();
        request.push(byte[0]);
    }
    let text = String::from_utf8(request).unwrap();
    let header = |name: &str| {
        text.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_owned())
        })
    };
    let key = header("sec-websocket-key").unwrap();
    Upgrade {
        read,
        write,
        origin: header("origin"),
        accept: ws::accept_key(&key),
    }
}

fn upgrade_response(accept: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\nsec-websocket-accept: {accept}\r\n\r\n"
    )
    .into_bytes()
}

type PageSpot = (u32, f64, f64);
type PageBox = (u32, f64, f64, f64, f64);
type SourceSpot = (String, u32, u32);

#[derive(Default)]
struct FakeState {
    hits: Vec<((usize, usize), PageSpot)>,
    regions: Vec<(PageBox, SourceSpot)>,
    control_messages: Vec<String>,
    data_messages: Vec<String>,
    memory: Vec<BTreeMap<String, String>>,
    origins: Vec<Option<String>>,
    unmasked: usize,
    pongs: usize,
    control_writer: Option<Arc<tokio::sync::Mutex<OwnedWriteHalf>>>,
    data_writer: Option<Arc<tokio::sync::Mutex<OwnedWriteHalf>>>,
    compile_delay: Duration,
    close_data_on_src_point: bool,
}

#[derive(Clone)]
struct FakeServer {
    data_port: u16,
    control_port: u16,
    state: Arc<Mutex<FakeState>>,
}

async fn send_to(writer: &Option<Arc<tokio::sync::Mutex<OwnedWriteHalf>>>, frame: Vec<u8>) {
    if let Some(writer) = writer {
        let _ = writer.lock().await.write_all(&frame).await;
    }
}

fn compile_frames() -> Vec<u8> {
    let mut frames = server_frame(
        SERVER_TEXT,
        br#"{"event":"compileStatus","kind":"Compiling"}"#,
        true,
    );
    frames.extend(server_frame(
        SERVER_TEXT,
        br#"{"event":"compileStatus","kind":"CompileSuccess"}"#,
        true,
    ));
    frames.extend(server_frame(
        SERVER_TEXT,
        br#"{"event":"compileStatus","kind":"CompileSuccess"}"#,
        true,
    ));
    frames
}

impl FakeServer {
    async fn start() -> Self {
        let data = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let control = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let server = Self {
            data_port: data.local_addr().unwrap().port(),
            control_port: control.local_addr().unwrap().port(),
            state: Arc::new(Mutex::new(FakeState::default())),
        };
        let state = server.state.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = control.accept().await {
                tokio::spawn(serve_control(stream, state.clone()));
            }
        });
        let state = server.state.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = data.accept().await {
                tokio::spawn(serve_data(stream, state.clone()));
            }
        });
        server
    }

    fn ports(&self) -> (u16, u16) {
        (self.data_port, self.control_port)
    }

    fn hit(&self, line: usize, character: usize, page: u32, x: f64, y: f64) {
        self.state
            .lock()
            .unwrap()
            .hits
            .push(((line, character), (page, x, y)));
    }

    fn region(
        &self,
        page: u32,
        x: (f64, f64),
        y: (f64, f64),
        filepath: &str,
        line: u32,
        character: u32,
    ) {
        self.state.lock().unwrap().regions.push((
            (page, x.0, x.1, y.0, y.1),
            (filepath.to_owned(), line, character),
        ));
    }

    fn forward_requests(&self) -> usize {
        self.state
            .lock()
            .unwrap()
            .control_messages
            .iter()
            .filter(|message| message.contains("panelScrollTo"))
            .count()
    }
}

async fn serve_control(stream: TcpStream, state: Arc<Mutex<FakeState>>) {
    let Upgrade {
        mut read,
        mut write,
        origin,
        accept,
    } = accept_upgrade(stream).await;
    state.lock().unwrap().origins.push(origin);
    let mut greeting = upgrade_response(&accept);
    greeting.extend(server_frame(
        SERVER_TEXT,
        br#"{"event":"syncEditorChanges"}"#,
        true,
    ));
    greeting.extend(compile_frames());
    write.write_all(&greeting).await.unwrap();
    let writer = Arc::new(tokio::sync::Mutex::new(write));
    state.lock().unwrap().control_writer = Some(writer.clone());
    while let Some(frame) = read_client_frame(&mut read).await {
        let text = String::from_utf8_lossy(&frame.payload).into_owned();
        let (reply, delay, data_writer) = {
            let mut state = state.lock().unwrap();
            if !frame.masked {
                state.unmasked += 1;
            }
            if frame.opcode == 0xA {
                state.pongs += 1;
                continue;
            }
            state.control_messages.push(text.clone());
            let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            match value["event"].as_str() {
                Some("panelScrollTo") => {
                    let wanted = (
                        value["line"].as_u64().unwrap_or(0) as usize,
                        value["character"].as_u64().unwrap_or(0) as usize,
                    );
                    let reply = state
                        .hits
                        .iter()
                        .find(|(position, _)| *position == wanted)
                        .map(|(_, (page, x, y))| format!("jump,{page} {x} {y}"));
                    (
                        reply.map(|reply| (true, reply)),
                        Duration::ZERO,
                        state.data_writer.clone(),
                    )
                }
                Some("syncMemoryFiles") => {
                    let files: BTreeMap<String, String> =
                        serde_json::from_value(value["files"].clone()).unwrap_or_default();
                    state.memory.push(files);
                    (Some((false, String::new())), state.compile_delay, None)
                }
                _ => (None, Duration::ZERO, None),
            }
        };
        match reply {
            Some((true, jump)) => {
                send_to(
                    &data_writer,
                    server_frame(SERVER_TEXT, jump.as_bytes(), true),
                )
                .await;
            }
            Some((false, _)) => {
                let writer = writer.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    let _ = writer.lock().await.write_all(&compile_frames()).await;
                });
            }
            None => {}
        }
    }
}

async fn serve_data(stream: TcpStream, state: Arc<Mutex<FakeState>>) {
    let Upgrade {
        mut read,
        mut write,
        accept,
        ..
    } = accept_upgrade(stream).await;
    let mut greeting = upgrade_response(&accept);
    greeting.extend(server_frame(SERVER_TEXT, b"invert-colors,never", true));
    let mut document = b"new,".to_vec();
    document.extend(std::iter::repeat_n(0xAB, 200_000));
    greeting.extend(server_frame(SERVER_BINARY, &document, true));
    greeting.extend(server_frame(SERVER_PING, b"hi", true));
    write.write_all(&greeting).await.unwrap();
    let writer = Arc::new(tokio::sync::Mutex::new(write));
    state.lock().unwrap().data_writer = Some(writer.clone());
    while let Some(frame) = read_client_frame(&mut read).await {
        let text = String::from_utf8_lossy(&frame.payload).into_owned();
        let (reply, control, close) = {
            let mut state = state.lock().unwrap();
            if !frame.masked {
                state.unmasked += 1;
            }
            if frame.opcode == 0xA {
                state.pongs += 1;
                continue;
            }
            state.data_messages.push(text.clone());
            let Some(json) = text.strip_prefix("src-point ") else {
                continue;
            };
            let value: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
            let page = value["page_no"].as_u64().unwrap_or(0) as u32;
            let x = value["x"].as_f64().unwrap_or(-1.0);
            let y = value["y"].as_f64().unwrap_or(-1.0);
            let reply = state
                .regions
                .iter()
                .find_map(|((p, x0, x1, y0, y1), target)| {
                    (*p == page && x >= *x0 && x <= *x1 && y >= *y0 && y <= *y1)
                        .then(|| target.clone())
                });
            (
                reply,
                state.control_writer.clone(),
                state.close_data_on_src_point,
            )
        };
        if close {
            let _ = writer.lock().await.shutdown().await;
            return;
        }
        if let Some((filepath, line, character)) = reply {
            let message = serde_json::json!({
                "event": "editorScrollTo",
                "filepath": filepath,
                "start": [line, character],
                "end": [line, character],
            })
            .to_string();
            send_to(
                &control,
                server_frame(SERVER_TEXT, message.as_bytes(), true),
            )
            .await;
        }
    }
}

fn loopback(port: u16) -> std::net::SocketAddr {
    std::net::SocketAddr::from(([127, 0, 0, 1], port))
}

fn quick_timeouts() -> Timeouts {
    Timeouts {
        connect: Duration::from_millis(500),
        start: Duration::from_secs(3),
        compile: Duration::from_secs(2),
        probe: Duration::from_millis(150),
        forward_budget: Duration::from_secs(2),
        inverse_budget: Duration::from_secs(2),
        stop: Duration::from_secs(2),
    }
}

async fn open_connection(server: &FakeServer) -> (Connection, broadcast::Receiver<PreviewEvent>) {
    let events = broadcast::channel(64).0;
    let initial = events.subscribe();
    let connection = Connection::open(
        loopback(server.control_port),
        loopback(server.data_port),
        events,
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    (connection, initial)
}

#[tokio::test]
async fn messages_pushed_with_the_handshake_reach_listeners() {
    let server = FakeServer::start().await;
    let (connection, initial) = open_connection(&server).await;
    session::wait_for_compile(initial, false, Duration::from_secs(2))
        .await
        .unwrap();
    assert!(connection.is_alive());
    let origins = server.state.lock().unwrap().origins.clone();
    assert_eq!(
        origins,
        vec![Some(format!("http://127.0.0.1:{}", server.control_port))]
    );
}

#[tokio::test]
async fn a_wrong_accept_key_is_refused() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut upgrade = accept_upgrade(stream).await;
        upgrade
            .write
            .write_all(&upgrade_response("bm90IHRoZSBrZXk="))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
    });
    assert!(ws::connect(loopback(port), Duration::from_secs(2))
        .await
        .is_err());
}

#[tokio::test]
async fn big_documents_are_skipped_fragments_join_and_pings_get_pongs() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let pong = Arc::new(Mutex::new(None));
    let seen = pong.clone();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let Upgrade {
            mut read,
            mut write,
            accept,
            ..
        } = accept_upgrade(stream).await;
        let mut frames = upgrade_response(&accept);
        frames.extend(server_frame(SERVER_BINARY, &vec![7u8; 300_000], true));
        frames.extend(server_frame(SERVER_TEXT, b"jump,", false));
        frames.extend(server_frame(SERVER_PING, b"ok", true));
        frames.extend(server_frame(0x0, b"2 1 2", true));
        write.write_all(&frames).await.unwrap();
        let frame = read_client_frame(&mut read).await.unwrap();
        *seen.lock().unwrap() = Some((frame.opcode, frame.masked, frame.payload));
        tokio::time::sleep(Duration::from_millis(200)).await;
    });
    let (mut reader, mut writer) = ws::connect(loopback(port), Duration::from_secs(2))
        .await
        .unwrap();
    let ping = reader.next().await.unwrap();
    assert_eq!(ping, Incoming::Ping(b"ok".to_vec()));
    writer.send_pong(b"ok").await.unwrap();
    assert_eq!(
        reader.next().await.unwrap(),
        Incoming::Message(b"jump,2 1 2".to_vec())
    );
    assert_eq!(reader.next().await.unwrap(), Incoming::Closed);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(*pong.lock().unwrap(), Some((0xA, true, b"ok".to_vec())));
}

#[tokio::test]
async fn forward_sync_probes_until_a_position_lands_in_text() {
    let server = FakeServer::start().await;
    server.hit(4, 6, 2, 70.5, 96.25);
    let (connection, initial) = open_connection(&server).await;
    session::wait_for_compile(initial, false, Duration::from_secs(2))
        .await
        .unwrap();
    let point = connection
        .forward(
            "/p/main.typ",
            &[(4, 2), (4, 3), (4, 6), (4, 9)],
            Duration::from_millis(150),
            Duration::from_secs(3),
        )
        .await
        .unwrap();
    assert_eq!(
        point,
        Some(DocumentPoint {
            page: 2,
            x: 70.5,
            y: 96.25
        })
    );
    assert_eq!(server.forward_requests(), 3);
    let state = server.state.lock().unwrap();
    assert_eq!(state.unmasked, 0);
    assert!(state.pongs >= 1);
}

#[tokio::test]
async fn forward_sync_gives_up_within_its_budget() {
    let server = FakeServer::start().await;
    let (connection, initial) = open_connection(&server).await;
    session::wait_for_compile(initial, false, Duration::from_secs(2))
        .await
        .unwrap();
    let started = std::time::Instant::now();
    let candidates: Vec<(usize, usize)> = (0..20).map(|column| (0, column)).collect();
    let point = connection
        .forward(
            "/p/main.typ",
            &candidates,
            Duration::from_millis(100),
            Duration::from_millis(350),
        )
        .await
        .unwrap();
    assert_eq!(point, None);
    assert!(started.elapsed() < Duration::from_millis(1500));
    assert!(server.forward_requests() <= 5);
}

#[tokio::test]
async fn inverse_sync_returns_the_first_point_that_hits_text() {
    let server = FakeServer::start().await;
    server.region(1, (95.0, 140.0), (100.0, 106.0), "/p/sections/a.typ", 9, 3);
    let (connection, initial) = open_connection(&server).await;
    session::wait_for_compile(initial, false, Duration::from_secs(2))
        .await
        .unwrap();
    let probes = protocol::inverse_probes(DocumentPoint {
        page: 1,
        x: 100.0,
        y: 110.0,
    });
    let source = connection
        .inverse(&probes, Duration::from_millis(150), Duration::from_secs(3))
        .await
        .unwrap();
    assert_eq!(
        source,
        Some(SourcePoint {
            filepath: "/p/sections/a.typ".into(),
            line: 9,
            character: 3
        })
    );
    let sent = server.state.lock().unwrap().data_messages.clone();
    assert!(sent[0].starts_with("src-point "));
    assert!(sent.len() >= 2);
}

#[tokio::test]
async fn memory_files_are_pushed_and_awaited_before_queries() {
    let server = FakeServer::start().await;
    server.state.lock().unwrap().compile_delay = Duration::from_millis(300);
    let (connection, initial) = open_connection(&server).await;
    session::wait_for_compile(initial, false, Duration::from_secs(2))
        .await
        .unwrap();
    let files = BTreeMap::from([("/p/main.typ".to_string(), "\n\nHello".to_string())]);
    let started = std::time::Instant::now();
    connection
        .sync_memory_files(&files, Duration::from_secs(2))
        .await
        .unwrap();
    assert!(started.elapsed() >= Duration::from_millis(250));
    assert_eq!(server.state.lock().unwrap().memory, vec![files]);
}

#[tokio::test]
async fn a_dropped_socket_reports_that_the_server_stopped() {
    let server = FakeServer::start().await;
    server.state.lock().unwrap().close_data_on_src_point = true;
    let (connection, initial) = open_connection(&server).await;
    session::wait_for_compile(initial, false, Duration::from_secs(2))
        .await
        .unwrap();
    let probes = protocol::inverse_probes(DocumentPoint {
        page: 1,
        x: 1.0,
        y: 1.0,
    });
    let outcome = connection
        .inverse(&probes, Duration::from_millis(500), Duration::from_secs(3))
        .await;
    assert!(outcome.is_err());
    assert!(!connection.is_alive());
}

#[cfg(unix)]
mod lifecycle {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    struct Project {
        _dir: tempfile::TempDir,
        root: PathBuf,
        program: PathBuf,
    }

    fn project(script: &str) -> Project {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap().join("paper");
        std::fs::create_dir_all(root.join("sections")).unwrap();
        std::fs::write(root.join("main.typ"), "= Title\nHello world here.\n").unwrap();
        std::fs::write(root.join("other.typ"), "Other\n").unwrap();
        std::fs::write(
            root.join("sections").join("a.typ"),
            "😀😀 wörds here\nsecond line\n",
        )
        .unwrap();
        let program = dir.path().join("fake-tinymist");
        std::fs::write(&program, script).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        Project {
            _dir: dir,
            root,
            program,
        }
    }

    fn sleeper() -> Project {
        project("#!/bin/sh\nexec sleep 300\n")
    }

    fn target(project: &Project, id: &str, main: &str) -> Target {
        Target {
            project_id: id.into(),
            root: project.root.clone(),
            roots: vec![project.root.clone()],
            main: project.root.join(main),
            tinymist: "0.15.8".into(),
            environment: vec![("OLEAFLY_FAKE".into(), "1".into())],
        }
    }

    fn registry(server: &FakeServer, idle: Duration) -> Registry {
        let ports = server.ports();
        Registry::new(Config {
            timeouts: quick_timeouts(),
            ports: Arc::new(move || Ok(ports)),
            idle,
            max_sessions: 2,
            max_starts: 3,
            start_window: Duration::from_secs(60),
        })
    }

    fn resolver(program: PathBuf) -> impl Fn() -> std::future::Ready<Result<PathBuf, String>> {
        move || std::future::ready(Ok(program.clone()))
    }

    fn running(pid: u32) -> bool {
        let pid = pid as libc::pid_t;
        unsafe {
            libc::kill(pid, 0) == 0 && libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) == 0
        }
    }

    async fn gone(pid: u32) -> bool {
        for _ in 0..100 {
            if !running(pid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }

    async fn start(registry: &Registry, target: &Target, program: &Path) -> u32 {
        drop(
            registry
                .acquire(target, resolver(program.to_owned()))
                .await
                .unwrap(),
        );
        registry.running_pid(&target.project_id).await.unwrap()
    }

    #[tokio::test]
    async fn the_server_starts_on_first_use_and_is_reused() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        assert_eq!(registry.running_pid("p1").await, None);
        let target = target(&project, "p1", "main.typ");
        let first = start(&registry, &target, &project.program).await;
        assert!(running(first));
        let again = start(&registry, &target, &project.program).await;
        assert_eq!(first, again);
        registry.stop_all().await;
        assert!(gone(first).await);
    }

    #[tokio::test]
    async fn a_crashed_server_restarts_on_the_next_request() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        let target = target(&project, "p1", "main.typ");
        let first = start(&registry, &target, &project.program).await;
        unsafe {
            libc::kill(first as libc::pid_t, libc::SIGKILL);
        }
        assert!(gone(first).await);
        let second = start(&registry, &target, &project.program).await;
        assert_ne!(first, second);
        assert!(running(second));
        registry.stop_all().await;
    }

    #[tokio::test]
    async fn closing_a_project_stops_its_server() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        let one = start(
            &registry,
            &target(&project, "p1", "main.typ"),
            &project.program,
        )
        .await;
        let two = start(
            &registry,
            &target(&project, "p2", "main.typ"),
            &project.program,
        )
        .await;
        registry.stop_project("p1").await;
        assert!(gone(one).await);
        assert!(running(two));
        assert_eq!(registry.running_pid("p1").await, None);
        registry.stop_all().await;
        assert!(gone(two).await);
    }

    #[tokio::test]
    async fn an_idle_server_stops_by_itself() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_millis(200));
        let pid = start(
            &registry,
            &target(&project, "p1", "main.typ"),
            &project.program,
        )
        .await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(gone(pid).await);
        assert_eq!(registry.running_pid("p1").await, None);
    }

    #[tokio::test]
    async fn a_new_main_document_restarts_the_server() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        let first = start(
            &registry,
            &target(&project, "p1", "main.typ"),
            &project.program,
        )
        .await;
        let second = start(
            &registry,
            &target(&project, "p1", "other.typ"),
            &project.program,
        )
        .await;
        assert_ne!(first, second);
        assert!(gone(first).await);
        registry.stop_all().await;
    }

    #[tokio::test]
    async fn quitting_kills_every_server_at_once() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        let one = start(
            &registry,
            &target(&project, "p1", "main.typ"),
            &project.program,
        )
        .await;
        let two = start(
            &registry,
            &target(&project, "p2", "main.typ"),
            &project.program,
        )
        .await;
        registry.kill_all_now();
        assert!(gone(one).await);
        assert!(gone(two).await);
    }

    #[tokio::test]
    async fn only_a_few_servers_run_at_once() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        let one = start(
            &registry,
            &target(&project, "p1", "main.typ"),
            &project.program,
        )
        .await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        start(
            &registry,
            &target(&project, "p2", "main.typ"),
            &project.program,
        )
        .await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        start(
            &registry,
            &target(&project, "p3", "main.typ"),
            &project.program,
        )
        .await;
        assert!(gone(one).await);
        assert_eq!(registry.running_pid("p1").await, None);
        registry.stop_all().await;
    }

    #[tokio::test]
    async fn a_server_that_never_starts_is_not_retried_forever() {
        let server = FakeServer::start().await;
        let project = project("#!/bin/sh\nexit 3\n");
        let registry = Registry::new(Config {
            timeouts: quick_timeouts(),
            ports: Arc::new(session::reserve_ports),
            idle: Duration::from_secs(60),
            max_sessions: 2,
            max_starts: 2,
            start_window: Duration::from_secs(60),
        });
        let _ = server;
        let target = target(&project, "p1", "main.typ");
        let started = std::time::Instant::now();
        for _ in 0..2 {
            assert!(registry
                .acquire(&target, resolver(project.program.clone()))
                .await
                .is_err());
        }
        let refused = registry
            .acquire(&target, resolver(project.program.clone()))
            .await
            .err()
            .unwrap();
        assert!(refused.contains("keeps stopping"), "{refused}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn sync_requests_translate_between_the_editor_and_the_server() {
        let server = FakeServer::start().await;
        let project = sleeper();
        let registry = registry(&server, Duration::from_secs(60));
        let target = target(&project, "p1", "main.typ");
        let section = project.root.join("sections").join("a.typ");
        server.hit(0, 6, 1, 80.0, 120.0);
        server.region(
            1,
            (0.0, 600.0),
            (0.0, 800.0),
            section.to_str().unwrap(),
            0,
            4,
        );
        let forward = TypstSyncForwardRequest {
            project_id: "p1".into(),
            main_doc: "main.typ".into(),
            file: "sections/a.typ".into(),
            line: 1,
            column: Some(8),
            sources: BTreeMap::from([(
                "sections/a.typ".to_string(),
                "😀😀 wörds here\nsecond line\n".to_string(),
            )]),
        };
        let rect = forward_with(
            &registry,
            &target,
            &forward,
            resolver(project.program.clone()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!((rect.page, rect.x, rect.y), (1, 80.0, 111.0));
        let pushed = server.state.lock().unwrap().memory.clone();
        assert_eq!(pushed.len(), 1);
        assert!(pushed[0].contains_key(section.to_str().unwrap()));
        let inverse = TypstSyncInverseRequest {
            project_id: "p1".into(),
            main_doc: "main.typ".into(),
            page: 1,
            x: 10.0,
            y: 10.0,
            sources: forward.sources.clone(),
        };
        let hit = inverse_with(
            &registry,
            &target,
            &inverse,
            resolver(project.program.clone()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(hit.file, "sections/a.typ");
        assert_eq!(hit.line, 1);
        assert_eq!(hit.column, 6);
        assert_eq!(server.state.lock().unwrap().memory.len(), 1);
        let outside = TypstSyncForwardRequest {
            file: "../escape.typ".into(),
            ..forward
        };
        assert!(forward_with(
            &registry,
            &target,
            &outside,
            resolver(project.program.clone())
        )
        .await
        .unwrap()
        .is_none());
        registry.stop_all().await;
    }
}

fn real_tinymist() -> PathBuf {
    if let Some(path) = std::env::var_os("OLEAFLY_TINYMIST_BIN") {
        return PathBuf::from(path);
    }
    let manifest: serde_json::Value = serde_json::from_str(include_str!(
        "../../../scripts/language-servers/manifest.json"
    ))
    .unwrap();
    let server = &manifest["servers"]["tinymist"];
    let target = server["targets"]
        .as_object()
        .unwrap()
        .iter()
        .find(|(triple, _)| {
            let triple = triple.as_str();
            triple.contains(std::env::consts::ARCH)
                && (triple.contains(std::env::consts::OS)
                    || (std::env::consts::OS == "macos" && triple.contains("darwin")))
        })
        .map(|(_, target)| target.clone())
        .expect("a Tinymist build for this computer");
    let archive = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(target["resourceRelativePath"].as_str().unwrap());
    let bytes = std::fs::read(&archive).unwrap_or_else(|_| {
        panic!(
            "set OLEAFLY_TINYMIST_BIN or fetch the bundled Tinymist into {}",
            archive.display()
        )
    });
    let out = std::env::temp_dir().join(format!("oleafly-typst-sync-{}", std::process::id()));
    std::fs::create_dir_all(&out).unwrap();
    let member = target["archiveMember"].as_str().unwrap();
    let mut entries = tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..]));
    for entry in entries.entries().unwrap() {
        let mut entry = entry.unwrap();
        if entry.path().unwrap().to_string_lossy() == member {
            let binary = out.join("tinymist");
            entry.unpack(&binary).unwrap();
            return binary;
        }
    }
    panic!("the Tinymist archive has no {member}");
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let destination = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs the real Tinymist binary; set OLEAFLY_TINYMIST_BIN or fetch the bundled build"]
async fn real_tinymist_syncs_a_research_seed_both_ways() {
    let program = real_tinymist();
    let seed = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
        .join("research-seeds")
        .join("systems-measurement-paper-typst");
    let dir = tempfile::tempdir().unwrap();
    let root = canonical_root(dir.path()).unwrap().join("paper");
    copy_tree(&seed, &root);
    let target = Target {
        project_id: "seed".into(),
        root: root.clone(),
        roots: vec![root.clone()],
        main: root.join("main.typ"),
        tinymist: "real".into(),
        environment: Vec::new(),
    };
    let registry = Registry::new(Config::default());
    let resolve = || std::future::ready(Ok::<PathBuf, String>(program.clone()));
    let file = "sections/methodology.typ";
    let text = std::fs::read_to_string(root.join(file)).unwrap();
    let line = protocol::source_lines(&text)
        .iter()
        .position(|line| line.starts_with("Published amplification"))
        .unwrap();
    let started = std::time::Instant::now();
    let forward = TypstSyncForwardRequest {
        project_id: "seed".into(),
        main_doc: "main.typ".into(),
        file: file.into(),
        line: line as u32 + 1,
        column: Some(20),
        sources: BTreeMap::new(),
    };
    let rect = forward_with(&registry, &target, &forward, resolve)
        .await
        .unwrap()
        .expect("forward sync lands on the PDF");
    eprintln!(
        "forward {file}:{} -> page {} at ({:.1}, {:.1}) in {:?}",
        line + 1,
        rect.page,
        rect.x,
        rect.y,
        started.elapsed()
    );
    assert!(rect.page >= 1);
    let inverse = TypstSyncInverseRequest {
        project_id: "seed".into(),
        main_doc: "main.typ".into(),
        page: rect.page as u32,
        x: rect.x + 12.0,
        y: rect.y + 7.0,
        sources: BTreeMap::new(),
    };
    let hit = inverse_with(&registry, &target, &inverse, resolve)
        .await
        .unwrap()
        .expect("inverse sync lands in the source");
    eprintln!("inverse -> {}:{}:{}", hit.file, hit.line, hit.column);
    assert_eq!(hit.file, file);
    assert!((hit.line - (line as i32 + 1)).abs() <= 1, "{}", hit.line);
    let shifted = format!("\n\n{text}");
    let moved = TypstSyncForwardRequest {
        line: line as u32 + 3,
        sources: BTreeMap::from([(file.to_string(), shifted)]),
        ..forward
    };
    let after = forward_with(&registry, &target, &moved, resolve)
        .await
        .unwrap()
        .expect("forward sync follows the pushed buffer");
    eprintln!(
        "forward after an edit -> page {} at ({:.1}, {:.1})",
        after.page, after.x, after.y
    );
    assert_eq!(after.page, rect.page);
    assert!((after.x - rect.x).abs() < 1.0 && (after.y - rect.y).abs() < 15.0);
    registry.stop_all().await;
}
