use crate::{Error, ErrorKind, Result};
use fastcdc::v2020::StreamCDC;
use std::fmt;
use std::fs::File;
use std::io::{self, BufReader, Read};
use std::path::Path;

pub const MIN_CHUNK_SIZE: u32 = 256 * 1024;
pub const AVG_CHUNK_SIZE: u32 = 1024 * 1024;
pub const MAX_CHUNK_SIZE: u32 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ContentHash([u8; 32]);

impl ContentHash {
    pub fn digest(bytes: &[u8]) -> Self {
        Self(*blake3::hash(bytes).as_bytes())
    }

    pub fn digest_file(path: impl AsRef<Path>) -> io::Result<Self> {
        let file = File::open(path)?;
        let mut reader = BufReader::new(file);
        let mut hasher = blake3::Hasher::new();
        io::copy(&mut reader, &mut hasher)?;
        Ok(Self::from_bytes(*hasher.finalize().as_bytes()))
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn to_hex(self) -> String {
        encode_hex(&self.0)
    }

    pub fn from_hex(value: &str) -> Result<Self> {
        decode_hex_32(value).map(Self).ok_or_else(|| {
            Error::new(
                ErrorKind::InvalidInput,
                format!("invalid BLAKE3 hash {value:?}"),
            )
        })
    }
}

#[derive(Default)]
pub struct ContentHasher(blake3::Hasher);

impl ContentHasher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub fn finish(&self) -> ContentHash {
        ContentHash::from_bytes(*self.0.finalize().as_bytes())
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&encode_hex(&self.0))
    }
}

impl serde::Serialize for ContentHash {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> serde::Deserialize<'de> for ContentHash {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::from_hex(&value).map_err(serde::de::Error::custom)
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0xf) as usize] as char);
    }
    encoded
}

fn decode_hex_32(value: &str) -> Option<[u8; 32]> {
    let bytes = value.as_bytes();
    if bytes.len() != 64 {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in bytes.chunks_exact(2).enumerate() {
        decoded[index] = (hex_value(pair[0])? << 4) | hex_value(pair[1])?;
    }
    Some(decoded)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Chunk {
    pub offset: u64,
    pub data: Vec<u8>,
}

impl Chunk {
    pub fn hash(&self) -> ContentHash {
        ContentHash::digest(&self.data)
    }
}

pub fn tree_digest(entries: &[(String, ContentHash, bool)]) -> ContentHash {
    let mut sorted: Vec<&(String, ContentHash, bool)> = entries.iter().collect();
    sorted.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.cmp(&right.1))
            .then(left.2.cmp(&right.2))
    });
    let mut hasher = blake3::Hasher::new();
    for (path, hash, executable) in sorted {
        hasher.update(&(path.len() as u64).to_le_bytes());
        hasher.update(path.as_bytes());
        hasher.update(hash.as_bytes());
        hasher.update(&[u8::from(*executable)]);
    }
    ContentHash::from_bytes(*hasher.finalize().as_bytes())
}

pub struct Chunker<R: Read> {
    inner: StreamCDC<R>,
}

impl<R: Read> Chunker<R> {
    pub fn new(reader: R) -> Self {
        Self {
            inner: StreamCDC::new(
                reader,
                MIN_CHUNK_SIZE as usize,
                AVG_CHUNK_SIZE as usize,
                MAX_CHUNK_SIZE as usize,
            ),
        }
    }
}

impl<R: Read> Iterator for Chunker<R> {
    type Item = io::Result<Chunk>;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next().map(|chunk| {
            chunk
                .map(|chunk| Chunk {
                    offset: chunk.offset,
                    data: chunk.data,
                })
                .map_err(io::Error::from)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{tree_digest, Chunker, ContentHash};

    fn generated(len: usize) -> Vec<u8> {
        let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut data = Vec::with_capacity(len);
        while data.len() < len {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            data.extend_from_slice(&state.to_le_bytes());
        }
        data.truncate(len);
        data
    }

    #[test]
    fn chunk_boundaries_match_the_published_store_format() {
        let data = generated(12 * 1024 * 1024);
        let cuts: Vec<(u64, usize)> = Chunker::new(&data[..])
            .map(|chunk| chunk.unwrap())
            .map(|chunk| (chunk.offset, chunk.data.len()))
            .collect();
        assert_eq!(
            cuts,
            [
                (0, 532_150),
                (532_150, 2_088_921),
                (2_621_071, 1_361_465),
                (3_982_536, 604_807),
                (4_587_343, 1_071_987),
                (5_659_330, 2_119_792),
                (7_779_122, 1_188_501),
                (8_967_623, 1_871_958),
                (10_839_581, 1_205_351),
                (12_044_932, 537_980),
            ]
        );
    }

    #[test]
    fn chunking_round_trips_small_and_empty_inputs() {
        let empty: Vec<_> = Chunker::new(&[][..]).collect();
        assert!(empty.is_empty());
        let chunks: Vec<_> = Chunker::new(&b"hello"[..])
            .map(|chunk| chunk.unwrap())
            .collect();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].offset, 0);
        assert_eq!(chunks[0].data, b"hello");
        assert_eq!(chunks[0].hash(), ContentHash::digest(b"hello"));
    }

    #[test]
    fn hash_hex_round_trips_and_rejects_other_lengths() {
        let hash = ContentHash::digest(b"oleafly");
        assert_eq!(ContentHash::from_hex(&hash.to_hex()).unwrap(), hash);
        assert_eq!(hash.to_string(), hash.to_hex());
        assert!(ContentHash::from_hex("abcd").is_err());
        assert!(ContentHash::from_hex(&"z".repeat(64)).is_err());
    }

    #[test]
    fn tree_digest_ignores_order_and_sees_every_field() {
        let a = ("a.tex".to_string(), ContentHash::digest(b"a"), false);
        let b = ("b.sh".to_string(), ContentHash::digest(b"b"), true);
        assert_eq!(
            tree_digest(&[a.clone(), b.clone()]),
            tree_digest(&[b.clone(), a.clone()])
        );
        assert_ne!(
            tree_digest(std::slice::from_ref(&a)),
            tree_digest(&[("a.tex".to_string(), ContentHash::digest(b"a"), true)])
        );
        assert_ne!(
            tree_digest(std::slice::from_ref(&a)),
            tree_digest(&[("a2.tex".to_string(), ContentHash::digest(b"a"), false)])
        );
        assert_ne!(tree_digest(&[]), tree_digest(std::slice::from_ref(&b)));
    }

    #[test]
    fn digest_file_matches_the_in_memory_identity() {
        let directory = tempfile::TempDir::new().unwrap();
        let path = directory.path().join("data.bin");
        let bytes = generated(70_000);
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(
            ContentHash::digest_file(&path).unwrap(),
            ContentHash::digest(&bytes)
        );
    }
}
