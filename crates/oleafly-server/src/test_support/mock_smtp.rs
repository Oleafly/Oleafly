use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

pub const MOCK_SMTP_USER: &str = "mailer@lab.test";
pub const MOCK_SMTP_PASSWORD: &str = "smtp pass/word";
pub const MOCK_MAIL_FROM: &str = "Smith Lab <oleafly@lab.test>";
const MAX_LINE: usize = 64 * 1024;
const MAX_MESSAGE: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MockSmtpFault {
    Unavailable,
    RejectMail,
    Stall,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedEmail {
    pub mail_from: String,
    pub rcpt_to: Vec<String>,
    pub login: Option<(String, String)>,
    pub data: String,
}

pub struct MockSmtp {
    addr: SocketAddr,
    shared: Arc<Shared>,
    task: JoinHandle<()>,
}

#[derive(Default)]
struct Shared {
    messages: Mutex<Vec<CapturedEmail>>,
    faults: Mutex<Vec<MockSmtpFault>>,
    stalled_recipients: Mutex<Vec<String>>,
    sessions: Mutex<usize>,
    arrived: Notify,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl MockSmtp {
    pub async fn start() -> MockSmtp {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the mock SMTP server");
        let addr = listener.local_addr().expect("mock SMTP address");
        let shared = Arc::new(Shared::default());
        let serving = Arc::clone(&shared);
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let session = Arc::clone(&serving);
                tokio::spawn(async move {
                    let _ = serve(stream, session).await;
                });
            }
        });
        MockSmtp { addr, shared, task }
    }

    pub fn url(&self) -> String {
        format!(
            "smtp://{}:{}@{}",
            encode_userinfo(MOCK_SMTP_USER),
            encode_userinfo(MOCK_SMTP_PASSWORD),
            self.addr
        )
    }

    pub fn messages(&self) -> Vec<CapturedEmail> {
        locked(&self.shared.messages).clone()
    }

    pub fn sessions(&self) -> usize {
        *locked(&self.shared.sessions)
    }

    pub fn fail_next(&self, count: usize, fault: MockSmtpFault) {
        locked(&self.shared.faults).extend(std::iter::repeat_n(fault, count));
    }

    pub fn stall_mail_to(&self, address: &str) {
        locked(&self.shared.stalled_recipients).push(address.to_string());
    }

    pub async fn wait_for(&self, count: usize, timeout: Duration) -> Vec<CapturedEmail> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let arrived = self.shared.arrived.notified();
            let messages = self.messages();
            if messages.len() >= count {
                return messages;
            }
            if tokio::time::timeout_at(deadline, arrived).await.is_err() {
                return self.messages();
            }
        }
    }

    pub async fn stays_quiet(&self, period: Duration) -> bool {
        let before = self.messages().len();
        tokio::time::sleep(period).await;
        self.messages().len() == before
    }
}

impl Drop for MockSmtp {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl CapturedEmail {
    pub fn header(&self, name: &str) -> Option<String> {
        header_in(&self.data, name)
    }

    pub fn subject(&self) -> String {
        self.header("Subject").map(decode_words).unwrap_or_default()
    }

    pub fn text(&self) -> String {
        part_of(&self.data, "text/plain").unwrap_or_default()
    }

    pub fn html(&self) -> String {
        part_of(&self.data, "text/html").unwrap_or_default()
    }
}

fn encode_userinfo(text: &str) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

async fn reply(writer: &mut tokio::net::tcp::OwnedWriteHalf, line: &str) -> std::io::Result<()> {
    writer.write_all(line.as_bytes()).await?;
    writer.write_all(b"\r\n").await?;
    writer.flush().await
}

async fn serve(stream: TcpStream, shared: Arc<Shared>) -> std::io::Result<()> {
    *locked(&shared.sessions) += 1;
    let fault = {
        let mut faults = locked(&shared.faults);
        (!faults.is_empty()).then(|| faults.remove(0))
    };
    let (read, mut writer) = stream.into_split();
    let mut reader = BufReader::new(read);
    if fault == Some(MockSmtpFault::Stall) {
        tokio::time::sleep(Duration::from_secs(60)).await;
        return Ok(());
    }
    if fault == Some(MockSmtpFault::Unavailable) {
        return reply(
            &mut writer,
            "421 4.3.2 mock.test is not taking mail right now",
        )
        .await;
    }
    reply(&mut writer, "220 mock.test ESMTP ready").await?;
    let mut login = None;
    let mut mail_from = String::new();
    let mut rcpt_to = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 || line.len() > MAX_LINE {
            return Ok(());
        }
        let command = line.trim_end_matches(['\r', '\n']);
        let verb = command
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        match verb.as_str() {
            "EHLO" | "HELO" => {
                reply(&mut writer, "250-mock.test").await?;
                reply(&mut writer, "250-AUTH PLAIN LOGIN").await?;
                reply(&mut writer, "250 8BITMIME").await?;
            }
            "AUTH" => {
                let mut parts = command.split_whitespace().skip(1);
                let mechanism = parts.next().unwrap_or_default().to_ascii_uppercase();
                login = match mechanism.as_str() {
                    "PLAIN" => {
                        let encoded = match parts.next() {
                            Some(value) => value.to_string(),
                            None => {
                                reply(&mut writer, "334 ").await?;
                                read_trimmed(&mut reader).await?
                            }
                        };
                        plain_login(&encoded)
                    }
                    "LOGIN" => {
                        reply(&mut writer, "334 VXNlcm5hbWU6").await?;
                        let user = decode_base64_text(&read_trimmed(&mut reader).await?);
                        reply(&mut writer, "334 UGFzc3dvcmQ6").await?;
                        let password = decode_base64_text(&read_trimmed(&mut reader).await?);
                        user.zip(password)
                    }
                    _ => None,
                };
                if login.is_some() {
                    reply(&mut writer, "235 2.7.0 Signed in").await?;
                } else {
                    reply(&mut writer, "535 5.7.8 Sign-in refused").await?;
                }
            }
            "MAIL" => {
                if fault == Some(MockSmtpFault::RejectMail) {
                    reply(&mut writer, "451 4.3.0 Try again later").await?;
                } else {
                    mail_from = angle_address(command);
                    rcpt_to.clear();
                    reply(&mut writer, "250 2.1.0 Sender ok").await?;
                }
            }
            "RCPT" => {
                let recipient = angle_address(command);
                if locked(&shared.stalled_recipients).contains(&recipient) {
                    let mut rest = String::new();
                    let _ =
                        tokio::time::timeout(Duration::from_secs(60), reader.read_line(&mut rest))
                            .await;
                    return Ok(());
                }
                rcpt_to.push(recipient);
                reply(&mut writer, "250 2.1.5 Recipient ok").await?;
            }
            "DATA" => {
                reply(&mut writer, "354 Send the message").await?;
                let Some(data) = read_data(&mut reader).await? else {
                    return Ok(());
                };
                locked(&shared.messages).push(CapturedEmail {
                    mail_from: mail_from.clone(),
                    rcpt_to: rcpt_to.clone(),
                    login: login.clone(),
                    data,
                });
                shared.arrived.notify_waiters();
                reply(&mut writer, "250 2.0.0 Queued").await?;
            }
            "RSET" | "NOOP" => reply(&mut writer, "250 2.0.0 Ok").await?,
            "QUIT" => {
                reply(&mut writer, "221 2.0.0 Bye").await?;
                return Ok(());
            }
            _ => reply(&mut writer, "502 5.5.2 Not supported").await?,
        }
    }
}

async fn read_trimmed(
    reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>,
) -> std::io::Result<String> {
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

async fn read_data(
    reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>,
) -> std::io::Result<Option<String>> {
    let mut data = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 || data.len() > MAX_MESSAGE {
            return Ok(None);
        }
        let content = line.trim_end_matches(['\r', '\n']);
        if content == "." {
            return Ok(Some(data));
        }
        let unstuffed = content
            .strip_prefix('.')
            .filter(|rest| rest.starts_with('.'));
        data.push_str(unstuffed.unwrap_or(content));
        data.push_str("\r\n");
    }
}

fn angle_address(command: &str) -> String {
    command
        .split_once('<')
        .and_then(|(_, rest)| rest.split_once('>'))
        .map(|(address, _)| address.to_string())
        .unwrap_or_default()
}

fn plain_login(encoded: &str) -> Option<(String, String)> {
    let decoded = decode_base64(encoded)?;
    let mut fields = decoded.split(|byte| *byte == 0).skip(1);
    let user = String::from_utf8(fields.next()?.to_vec()).ok()?;
    let password = String::from_utf8(fields.next()?.to_vec()).ok()?;
    Some((user, password))
}

fn decode_base64_text(encoded: &str) -> Option<String> {
    decode_base64(encoded).and_then(|bytes| String::from_utf8(bytes).ok())
}

fn decode_base64(encoded: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut count = 0u8;
    let mut out = Vec::new();
    for byte in encoded.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push(((bits >> count) & 0xff) as u8);
        }
    }
    Some(out)
}

fn decode_quoted_printable(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'=' if bytes[index + 1..].starts_with(b"\r\n") => index += 3,
            b'=' if bytes[index + 1..].starts_with(b"\n") => index += 2,
            b'=' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(value) => {
                        out.push(value);
                        index += 3;
                    }
                    Err(_) => {
                        out.push(b'=');
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    out
}

fn split_head(entity: &str) -> (&str, &str) {
    entity.split_once("\r\n\r\n").unwrap_or((entity, ""))
}

fn header_in(entity: &str, name: &str) -> Option<String> {
    let (head, _) = split_head(entity);
    let mut unfolded: Vec<String> = Vec::new();
    for line in head.split("\r\n") {
        if line.starts_with([' ', '\t']) {
            if let Some(last) = unfolded.last_mut() {
                last.push(' ');
                last.push_str(line.trim_start());
            }
        } else {
            unfolded.push(line.to_string());
        }
    }
    unfolded.into_iter().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_string())
    })
}

fn parameter(value: &str, name: &str) -> Option<String> {
    value.split(';').skip(1).find_map(|item| {
        let (key, raw) = item.split_once('=')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| raw.trim().trim_matches('"').to_string())
    })
}

fn decoded_body(entity: &str) -> String {
    let (_, body) = split_head(entity);
    let encoding = header_in(entity, "Content-Transfer-Encoding")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let bytes = match encoding.as_str() {
        "quoted-printable" => decode_quoted_printable(body),
        "base64" => decode_base64(body).unwrap_or_default(),
        _ => body.as_bytes().to_vec(),
    };
    String::from_utf8_lossy(&bytes).into_owned()
}

fn part_of(entity: &str, wanted: &str) -> Option<String> {
    let content_type = header_in(entity, "Content-Type").unwrap_or_else(|| "text/plain".into());
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if mime.starts_with("multipart/") {
        let boundary = parameter(&content_type, "boundary")?;
        let (_, body) = split_head(entity);
        let delimiter = format!("--{boundary}");
        return body
            .split(delimiter.as_str())
            .skip(1)
            .map(|part| part.trim_start_matches("\r\n"))
            .filter(|part| !part.starts_with("--"))
            .find_map(|part| part_of(part, wanted));
    }
    (mime == wanted).then(|| decoded_body(entity))
}

fn decode_words(value: String) -> String {
    let mut out = String::new();
    let mut rest = value.as_str();
    let mut after_word = false;
    while let Some(start) = rest.find("=?") {
        let before = &rest[..start];
        if !(after_word && before.trim().is_empty()) {
            out.push_str(before);
        }
        let word = &rest[start + 2..];
        let mut pieces = word.splitn(3, '?');
        let (Some(_charset), Some(kind), Some(tail)) =
            (pieces.next(), pieces.next(), pieces.next())
        else {
            out.push_str(&rest[start..]);
            return out;
        };
        let Some(end) = tail.find("?=") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let text = &tail[..end];
        let bytes = if kind.eq_ignore_ascii_case("b") {
            decode_base64(text).unwrap_or_default()
        } else {
            decode_quoted_printable(&text.replace('_', " "))
        };
        out.push_str(&String::from_utf8_lossy(&bytes));
        after_word = true;
        rest = &tail[end + 2..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_decode_what_mail_clients_send() {
        assert_eq!(
            plain_login("AG1haWxlckBsYWIudGVzdABzbXRwIHBhc3Mvd29yZA=="),
            Some((MOCK_SMTP_USER.to_string(), MOCK_SMTP_PASSWORD.to_string()))
        );
        assert_eq!(
            String::from_utf8(decode_quoted_printable("caf=C3=A9 =\r\nlong")).unwrap(),
            "café long"
        );
        assert_eq!(
            decode_words("=?utf-8?b?Q2Fmw6k=?= talk".to_string()),
            "Café talk"
        );
        assert_eq!(
            angle_address("MAIL FROM:<a@b.test> BODY=8BITMIME"),
            "a@b.test"
        );
        assert_eq!(encode_userinfo(MOCK_SMTP_PASSWORD), "smtp%20pass%2Fword");
    }

    #[test]
    fn multipart_bodies_are_split_and_decoded() {
        let data = "Subject: Hi\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello =C3=A9\r\n--b1\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nPHA+SGk8L3A+\r\n--b1--\r\n";
        let email = CapturedEmail {
            mail_from: String::new(),
            rcpt_to: Vec::new(),
            login: None,
            data: data.to_string(),
        };
        assert_eq!(email.subject(), "Hi");
        assert_eq!(email.text().trim_end(), "Hello é");
        assert_eq!(email.html().trim_end(), "<p>Hi</p>");
    }
}
