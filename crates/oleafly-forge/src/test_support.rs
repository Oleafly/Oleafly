//! A small HTTP/1.1 server for tests: it answers from a script and records
//! every request it receives. Each connection gets one answer and is closed.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

/// One scripted answer.
#[derive(Clone, Debug)]
pub struct MockResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    /// Content-Length announced without sending a body, for size limits.
    declared_length: Option<u64>,
    /// Answer only requests with this method whose target starts with this.
    route: Option<(String, String)>,
    /// Wait this long, once the request is recorded, before answering.
    delay: Option<Duration>,
}

impl MockResponse {
    pub fn json(status: u16, body: &str) -> MockResponse {
        MockResponse::raw(
            status,
            &[("content-type", "application/json")],
            body.as_bytes(),
        )
    }

    pub fn raw(status: u16, headers: &[(&str, &str)], body: &[u8]) -> MockResponse {
        MockResponse {
            status,
            headers: headers
                .iter()
                .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
                .collect(),
            body: body.to_vec(),
            declared_length: None,
            route: None,
            delay: None,
        }
    }

    pub fn redirect(status: u16, location: &str) -> MockResponse {
        MockResponse::raw(status, &[("location", location)], b"")
    }

    /// Headers announcing `length` bytes, then the connection closes.
    pub fn declared(status: u16, length: u64) -> MockResponse {
        MockResponse {
            declared_length: Some(length),
            ..MockResponse::raw(status, &[("content-type", "application/zip")], b"")
        }
    }

    /// Answer only `method` requests whose target (path and query) starts
    /// with `prefix`. Unrouted answers are used in order for any request.
    pub fn on(mut self, method: &str, prefix: &str) -> MockResponse {
        self.route = Some((method.to_string(), prefix.to_string()));
        self
    }

    /// Answer `delay` after the request arrived, for tests that act while a
    /// call is in flight.
    pub fn delayed(mut self, delay: Duration) -> MockResponse {
        self.delay = Some(delay);
        self
    }

    fn matches(&self, method: &str, target: &str) -> bool {
        match &self.route {
            Some((want_method, prefix)) => {
                want_method.eq_ignore_ascii_case(method) && target.starts_with(prefix.as_str())
            }
            None => true,
        }
    }
}

/// A request as the server saw it. `path` is the request target, query
/// included.
#[derive(Clone, Debug)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    /// Lowercase names.
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl RecordedRequest {
    pub fn header(&self, name: &str) -> Option<String> {
        let name = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(header, _)| *header == name)
            .map(|(_, value)| value.clone())
    }
}

struct State {
    responses: Vec<Option<MockResponse>>,
    requests: Vec<RecordedRequest>,
}

pub struct MockServer {
    address: SocketAddr,
    state: Arc<Mutex<State>>,
}

impl MockServer {
    pub fn start(responses: Vec<MockResponse>) -> MockServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        let address = listener.local_addr().expect("read the bound address");
        let state = Arc::new(Mutex::new(State {
            responses: responses.into_iter().map(Some).collect(),
            requests: Vec::new(),
        }));
        let shared = Arc::clone(&state);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let shared = Arc::clone(&shared);
                std::thread::spawn(move || serve(stream, &shared));
            }
        });
        MockServer { address, state }
    }

    /// `http://127.0.0.1:<port>`.
    pub fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    pub fn requests(&self) -> Vec<RecordedRequest> {
        self.lock().requests.clone()
    }

    /// Point a scripted redirect somewhere else, for servers that redirect
    /// to each other.
    pub fn set_location(&self, index: usize, location: &str) {
        let mut state = self.lock();
        if let Some(Some(response)) = state.responses.get_mut(index) {
            response
                .headers
                .retain(|(name, _)| !name.eq_ignore_ascii_case("location"));
            response
                .headers
                .push(("location".to_string(), location.to_string()));
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn serve(mut stream: TcpStream, state: &Arc<Mutex<State>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    let response = {
        let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
        let picked = state
            .responses
            .iter_mut()
            .find(|slot| {
                slot.as_ref()
                    .is_some_and(|response| response.matches(&request.method, &request.path))
            })
            .and_then(Option::take);
        state.requests.push(request);
        picked
    };
    let response = response.unwrap_or_else(|| {
        MockResponse::raw(
            500,
            &[("content-type", "text/plain")],
            b"no scripted response",
        )
    });
    if let Some(delay) = response.delay {
        std::thread::sleep(delay);
    }
    let length = response
        .declared_length
        .unwrap_or(response.body.len() as u64);
    let mut head = format!(
        "HTTP/1.1 {} Scripted\r\nContent-Length: {length}\r\nConnection: close\r\n",
        response.status
    );
    for (name, value) in &response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    if response.declared_length.is_none() {
        let _ = stream.write_all(&response.body);
    }
    let _ = stream.flush();
}

fn read_request(stream: &mut TcpStream) -> Option<RecordedRequest> {
    let mut received = Vec::new();
    let mut buffer = [0_u8; 4096];
    let head_end = loop {
        if let Some(end) = received.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break end;
        }
        if received.len() > 64 * 1024 {
            return None;
        }
        match stream.read(&mut buffer) {
            Ok(0) => return None,
            Ok(read) => received.extend_from_slice(&buffer[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
    };
    let head = String::from_utf8_lossy(&received[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next()?.split(' ');
    let method = request_line.next()?.to_string();
    let path = request_line.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    let length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = received[head_end + 4..].to_vec();
    while body.len() < length {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => body.extend_from_slice(&buffer[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    Some(RecordedRequest {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}
