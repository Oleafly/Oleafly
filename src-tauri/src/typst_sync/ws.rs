use std::io::{Error, ErrorKind};
use std::net::SocketAddr;
use std::time::Duration;

use base64::Engine as _;
use rand::RngCore;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

const ACCEPT_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_HEAD_BYTES: u64 = 16 * 1024;
pub(super) const MAX_KEPT_MESSAGE: u64 = 64 * 1024;
const MAX_CONTROL_PAYLOAD: u64 = 125;
const OP_CONTINUATION: u8 = 0x0;
const OP_TEXT: u8 = 0x1;
const OP_BINARY: u8 = 0x2;
const OP_CLOSE: u8 = 0x8;
const OP_PING: u8 = 0x9;
const OP_PONG: u8 = 0xA;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Incoming {
    Message(Vec<u8>),
    Ping(Vec<u8>),
    Closed,
}

pub(super) struct WsReader {
    inner: BufReader<OwnedReadHalf>,
    message: Vec<u8>,
    in_message: bool,
    discarding: bool,
}

pub(super) struct WsWriter {
    inner: OwnedWriteHalf,
}

fn protocol_error(message: &str) -> Error {
    Error::new(ErrorKind::InvalidData, message.to_owned())
}

pub(super) fn accept_key(key: &str) -> String {
    let digest = ring::digest::digest(
        &ring::digest::SHA1_FOR_LEGACY_USE_ONLY,
        format!("{key}{ACCEPT_GUID}").as_bytes(),
    );
    base64::engine::general_purpose::STANDARD.encode(digest.as_ref())
}

fn handshake_request(address: SocketAddr, key: &str) -> String {
    format!(
        "GET / HTTP/1.1\r\nHost: {address}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://{address}\r\n\r\n"
    )
}

async fn read_head(reader: &mut BufReader<OwnedReadHalf>) -> std::io::Result<Vec<String>> {
    let mut lines = Vec::new();
    let mut consumed = 0u64;
    loop {
        let mut line = Vec::new();
        let read = (&mut *reader)
            .take(MAX_HEAD_BYTES - consumed)
            .read_until(b'\n', &mut line)
            .await?;
        if read == 0 {
            return Err(Error::new(
                ErrorKind::UnexpectedEof,
                "the preview server closed the connection during the handshake",
            ));
        }
        consumed += read as u64;
        if !line.ends_with(b"\n") {
            return Err(protocol_error("the preview server handshake is too long"));
        }
        let text = String::from_utf8_lossy(&line).trim_end().to_owned();
        if text.is_empty() {
            return Ok(lines);
        }
        lines.push(text);
    }
}

fn verify_head(lines: &[String], key: &str) -> std::io::Result<()> {
    let status = lines
        .first()
        .ok_or_else(|| protocol_error("the preview server sent no status line"))?;
    let mut parts = status.split_whitespace();
    if !parts
        .next()
        .is_some_and(|version| version.starts_with("HTTP/1."))
        || parts.next() != Some("101")
    {
        return Err(protocol_error(
            "the preview server refused the WebSocket upgrade",
        ));
    }
    let expected = accept_key(key);
    let accepted = lines[1..].iter().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.trim().eq_ignore_ascii_case("sec-websocket-accept") && value.trim() == expected
        })
    });
    if accepted {
        Ok(())
    } else {
        Err(protocol_error(
            "the preview server sent a wrong WebSocket accept key",
        ))
    }
}

async fn connect_inner(address: SocketAddr) -> std::io::Result<(WsReader, WsWriter)> {
    let stream = TcpStream::connect(address).await?;
    stream.set_nodelay(true)?;
    let (read, mut write) = stream.into_split();
    let mut nonce = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let key = base64::engine::general_purpose::STANDARD.encode(nonce);
    write
        .write_all(handshake_request(address, &key).as_bytes())
        .await?;
    write.flush().await?;
    let mut reader = BufReader::new(read);
    let head = read_head(&mut reader).await?;
    verify_head(&head, &key)?;
    Ok((
        WsReader {
            inner: reader,
            message: Vec::new(),
            in_message: false,
            discarding: false,
        },
        WsWriter { inner: write },
    ))
}

pub(super) async fn connect(
    address: SocketAddr,
    timeout: Duration,
) -> std::io::Result<(WsReader, WsWriter)> {
    tokio::time::timeout(timeout, connect_inner(address))
        .await
        .map_err(|_| {
            Error::new(
                ErrorKind::TimedOut,
                "the preview server did not answer in time",
            )
        })?
}

fn unmask(payload: &mut [u8], mask: [u8; 4]) {
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index % 4];
    }
}

impl WsReader {
    async fn read_payload(
        &mut self,
        length: u64,
        mask: Option<[u8; 4]>,
    ) -> std::io::Result<Vec<u8>> {
        let size = usize::try_from(length).map_err(|_| protocol_error("frame too large"))?;
        let mut payload = vec![0u8; size];
        self.inner.read_exact(&mut payload).await?;
        if let Some(mask) = mask {
            unmask(&mut payload, mask);
        }
        Ok(payload)
    }

    async fn skip_payload(&mut self, length: u64) -> std::io::Result<()> {
        let skipped =
            tokio::io::copy(&mut (&mut self.inner).take(length), &mut tokio::io::sink()).await?;
        if skipped == length {
            Ok(())
        } else {
            Err(Error::new(
                ErrorKind::UnexpectedEof,
                "the preview server closed mid-frame",
            ))
        }
    }

    async fn frame_header(&mut self) -> std::io::Result<(bool, u8, u64, Option<[u8; 4]>)> {
        let mut head = [0u8; 2];
        self.inner.read_exact(&mut head).await?;
        let fin = head[0] & 0x80 != 0;
        if head[0] & 0x70 != 0 {
            return Err(protocol_error(
                "the preview server used an unknown WebSocket extension",
            ));
        }
        let opcode = head[0] & 0x0F;
        let masked = head[1] & 0x80 != 0;
        let length = match head[1] & 0x7F {
            126 => u64::from(self.inner.read_u16().await?),
            127 => self.inner.read_u64().await?,
            short => u64::from(short),
        };
        let mask = if masked {
            let mut key = [0u8; 4];
            self.inner.read_exact(&mut key).await?;
            Some(key)
        } else {
            None
        };
        Ok((fin, opcode, length, mask))
    }

    pub(super) async fn next(&mut self) -> std::io::Result<Incoming> {
        loop {
            let (fin, opcode, length, mask) = match self.frame_header().await {
                Ok(header) => header,
                Err(error) if error.kind() == ErrorKind::UnexpectedEof => {
                    return Ok(Incoming::Closed)
                }
                Err(error) => return Err(error),
            };
            match opcode {
                OP_CLOSE | OP_PING | OP_PONG => {
                    if !fin || length > MAX_CONTROL_PAYLOAD {
                        return Err(protocol_error(
                            "the preview server sent a malformed control frame",
                        ));
                    }
                    let payload = self.read_payload(length, mask).await?;
                    match opcode {
                        OP_CLOSE => return Ok(Incoming::Closed),
                        OP_PING => return Ok(Incoming::Ping(payload)),
                        _ => continue,
                    }
                }
                OP_TEXT | OP_BINARY | OP_CONTINUATION => {
                    let starts = opcode != OP_CONTINUATION;
                    if starts == self.in_message {
                        return Err(protocol_error(
                            "the preview server interleaved WebSocket messages",
                        ));
                    }
                    if starts {
                        self.in_message = true;
                        self.discarding = false;
                        self.message.clear();
                    }
                    let kept = self.message.len() as u64;
                    if self.discarding || kept.saturating_add(length) > MAX_KEPT_MESSAGE {
                        self.discarding = true;
                        self.message.clear();
                        self.skip_payload(length).await?;
                    } else {
                        let payload = self.read_payload(length, mask).await?;
                        self.message.extend_from_slice(&payload);
                    }
                    if fin {
                        self.in_message = false;
                        if !self.discarding {
                            return Ok(Incoming::Message(std::mem::take(&mut self.message)));
                        }
                        self.discarding = false;
                    }
                }
                _ => return Err(protocol_error("the preview server sent an unknown frame")),
            }
        }
    }
}

pub(super) fn encode_client_frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(0x80 | opcode);
    let length = payload.len();
    if length < 126 {
        frame.push(0x80 | length as u8);
    } else if let Ok(short) = u16::try_from(length) {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&short.to_be_bytes());
    } else {
        frame.push(0x80 | 127);
        frame.extend_from_slice(&(length as u64).to_be_bytes());
    }
    frame.extend_from_slice(&mask);
    let start = frame.len();
    frame.extend_from_slice(payload);
    unmask(&mut frame[start..], mask);
    frame
}

impl WsWriter {
    async fn send(&mut self, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
        let mut mask = [0u8; 4];
        rand::rngs::OsRng.fill_bytes(&mut mask);
        self.inner
            .write_all(&encode_client_frame(opcode, payload, mask))
            .await?;
        self.inner.flush().await
    }

    pub(super) async fn send_text(&mut self, text: &str) -> std::io::Result<()> {
        self.send(OP_TEXT, text.as_bytes()).await
    }

    pub(super) async fn send_pong(&mut self, payload: &[u8]) -> std::io::Result<()> {
        self.send(OP_PONG, payload).await
    }
}
