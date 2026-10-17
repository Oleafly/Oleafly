use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

pub const FUTURE_FRAME: &str =
    r#"{"type":"from_a_later_server","project_id":"later","detail":{"kind":"unknown","n":1}}"#;
const MAX_HEAD_BYTES: usize = 64 * 1024;
const TEXT: u8 = 0x1;

pub struct FutureFrames {
    addr: SocketAddr,
    injected: Arc<AtomicU64>,
    task: JoinHandle<()>,
}

impl FutureFrames {
    pub async fn start(upstream: SocketAddr) -> FutureFrames {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind the future frames relay");
        let addr = listener.local_addr().expect("future frames relay address");
        let injected = Arc::new(AtomicU64::new(0));
        let counter = Arc::clone(&injected);
        let task = tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                tokio::spawn(relay(client, upstream, Arc::clone(&counter)));
            }
        });
        FutureFrames {
            addr,
            injected,
            task,
        }
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn address(&self) -> SocketAddr {
        self.addr
    }

    pub fn injected(&self) -> u64 {
        self.injected.load(Ordering::SeqCst)
    }
}

impl Drop for FutureFrames {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn relay(client: TcpStream, upstream: SocketAddr, injected: Arc<AtomicU64>) {
    let Ok(server) = TcpStream::connect(upstream).await else {
        return;
    };
    let _ = client.set_nodelay(true);
    let _ = server.set_nodelay(true);
    let (mut client_read, client_write) = client.into_split();
    let (server_read, mut server_write) = server.into_split();
    let up = tokio::spawn(async move {
        let _ = tokio::io::copy(&mut client_read, &mut server_write).await;
        let _ = server_write.shutdown().await;
    });
    let _ = responses(BufReader::new(server_read), client_write, &injected).await;
    up.abort();
}

async fn head<R: AsyncRead + Unpin>(reader: &mut BufReader<R>) -> std::io::Result<Option<Vec<u8>>> {
    let mut head = Vec::new();
    loop {
        let read = reader.read_until(b'\n', &mut head).await?;
        if read == 0 {
            return Ok(None);
        }
        if head.ends_with(b"\r\n\r\n") {
            return Ok(Some(head));
        }
        if head.len() > MAX_HEAD_BYTES {
            return Err(std::io::Error::other("response head too large"));
        }
    }
}

fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then_some(value.trim())
    })
}

async fn responses<R, W>(
    mut reader: BufReader<R>,
    mut writer: W,
    injected: &AtomicU64,
) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    while let Some(raw) = head(&mut reader).await? {
        let text = String::from_utf8_lossy(&raw).into_owned();
        let status: u16 = text
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        if status == 101 {
            writer.write_all(&raw).await?;
            return frames(reader, writer, injected).await;
        }
        let chunked = header(&text, "transfer-encoding")
            .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"));
        if chunked {
            writer.write_all(&raw).await?;
            chunks(&mut reader, &mut writer).await?;
            continue;
        }
        let bodiless = (100..200).contains(&status) || status == 204 || status == 304;
        let length = header(&text, "content-length").and_then(|value| value.parse::<usize>().ok());
        let body = match (bodiless, length) {
            (true, _) => Vec::new(),
            (false, Some(length)) => {
                let mut body = vec![0u8; length];
                reader.read_exact(&mut body).await?;
                body
            }
            (false, None) => {
                let mut body = Vec::new();
                reader.read_to_end(&mut body).await?;
                body
            }
        };
        let body = with_future_frames(body, injected);
        let rebuilt: String = text
            .split("\r\n")
            .filter(|line| !line.is_empty())
            .map(|line| match line.split_once(':') {
                Some((key, _)) if key.trim().eq_ignore_ascii_case("content-length") => {
                    format!("{}: {}\r\n", key.trim(), body.len())
                }
                _ => format!("{line}\r\n"),
            })
            .collect();
        writer.write_all(rebuilt.as_bytes()).await?;
        writer.write_all(b"\r\n").await?;
        writer.write_all(&body).await?;
        writer.flush().await?;
        if length.is_none() && !bodiless {
            return Ok(());
        }
    }
    Ok(())
}

async fn chunks<R, W>(reader: &mut BufReader<R>, writer: &mut W) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    loop {
        let mut line = Vec::new();
        reader.read_until(b'\n', &mut line).await?;
        writer.write_all(&line).await?;
        let size = usize::from_str_radix(
            String::from_utf8_lossy(&line)
                .trim()
                .split(';')
                .next()
                .unwrap_or("0"),
            16,
        )
        .unwrap_or(0);
        if size == 0 {
            loop {
                let mut trailer = Vec::new();
                reader.read_until(b'\n', &mut trailer).await?;
                writer.write_all(&trailer).await?;
                if trailer == b"\r\n" || trailer.is_empty() {
                    writer.flush().await?;
                    return Ok(());
                }
            }
        }
        let mut data = vec![0u8; size + 2];
        reader.read_exact(&mut data).await?;
        writer.write_all(&data).await?;
    }
}

fn with_future_frames(body: Vec<u8>, injected: &AtomicU64) -> Vec<u8> {
    let Ok(mut parsed) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    let Some(frames) = parsed.get_mut("frames").and_then(Value::as_array_mut) else {
        return body;
    };
    if frames.is_empty() {
        return body;
    }
    let future: Value = serde_json::from_str(FUTURE_FRAME).expect("the future frame is JSON");
    let mut interleaved = Vec::with_capacity(frames.len() * 2);
    for frame in frames.drain(..) {
        interleaved.push(future.clone());
        interleaved.push(frame);
        injected.fetch_add(1, Ordering::SeqCst);
    }
    *frames = interleaved;
    serde_json::to_vec(&parsed).unwrap_or(body)
}

async fn frames<R, W>(
    mut reader: BufReader<R>,
    mut writer: W,
    injected: &AtomicU64,
) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    loop {
        let mut start = [0u8; 2];
        reader.read_exact(&mut start).await?;
        let mut raw = start.to_vec();
        let length = match start[1] & 0x7f {
            126 => {
                let mut extended = [0u8; 2];
                reader.read_exact(&mut extended).await?;
                raw.extend_from_slice(&extended);
                u64::from(u16::from_be_bytes(extended))
            }
            127 => {
                let mut extended = [0u8; 8];
                reader.read_exact(&mut extended).await?;
                raw.extend_from_slice(&extended);
                u64::from_be_bytes(extended)
            }
            short => u64::from(short),
        };
        if start[1] & 0x80 != 0 {
            let mut mask = [0u8; 4];
            reader.read_exact(&mut mask).await?;
            raw.extend_from_slice(&mask);
        }
        let mut payload = vec![0u8; usize::try_from(length).unwrap_or(usize::MAX)];
        reader.read_exact(&mut payload).await?;
        raw.extend_from_slice(&payload);
        if start[0] & 0x0f == TEXT {
            let mut future = vec![0x80 | TEXT, u8::try_from(FUTURE_FRAME.len()).unwrap_or(125)];
            future.extend_from_slice(FUTURE_FRAME.as_bytes());
            writer.write_all(&future).await?;
            injected.fetch_add(1, Ordering::SeqCst);
        }
        writer.write_all(&raw).await?;
        writer.flush().await?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_frame_in_a_batch_gets_a_frame_from_a_later_server_in_front_of_it() {
        let injected = AtomicU64::new(0);
        let body = br#"{"frames":[{"type":"pong","id":1},{"type":"pong","id":2}],"cursor":"c"}"#;
        let rewritten: Value =
            serde_json::from_slice(&with_future_frames(body.to_vec(), &injected)).unwrap();
        let future: Value = serde_json::from_str(FUTURE_FRAME).unwrap();
        assert_eq!(
            rewritten["frames"],
            serde_json::json!([future, {"type":"pong","id":1}, future, {"type":"pong","id":2}])
        );
        assert_eq!(rewritten["cursor"], "c");
        assert_eq!(injected.load(Ordering::SeqCst), 2);
        let untouched = br#"{"frames":[]}"#.to_vec();
        assert_eq!(with_future_frames(untouched.clone(), &injected), untouched);
        assert!(FUTURE_FRAME.len() < 126);
    }
}
