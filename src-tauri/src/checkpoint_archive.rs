//! Password-encrypted streaming envelope for portable checkpoint archives.

use std::io::{Read, Write};
use std::num::NonZeroU32;

use ring::{aead, pbkdf2, rand as ring_rand};
use zeroize::Zeroize;

const MAGIC: &[u8; 16] = b"OLEAFLYCPARCHIVE";
const FORMAT_VERSION_PBKDF2: u16 = 1;
const FORMAT_VERSION_ARGON2ID: u16 = 2;
const KDF_PBKDF2_SHA256: u8 = 1;
const KDF_ARGON2ID: u8 = 2;
const AEAD_AES_256_GCM: u8 = 1;
const MIN_KDF_ITERATIONS: u32 = 100_000;
const MAX_KDF_ITERATIONS: u32 = 2_000_000;
const ARGON2_MEMORY_KIB: u32 = 65_536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const MAX_ARGON2_MEMORY_KIB: u32 = 262_144;
const MAX_ARGON2_TIME_COST: u32 = 10;
const MAX_ARGON2_PARALLELISM: u32 = 16;
const FRAME_PLAINTEXT_BYTES: usize = 1024 * 1024;
const MAX_FRAME_PLAINTEXT_BYTES: usize = 8 * 1024 * 1024;
const SALT_BYTES: usize = 16;
const NONCE_PREFIX_BYTES: usize = 4;
const HEADER_PREFIX_BYTES: usize = 20;
const HEADER_V1_BYTES: usize = 48;
const HEADER_V2_BYTES: usize = 56;
const DATA_FRAME: u8 = 0;
const FINAL_FRAME: u8 = 1;

/// Encrypts a logical archive stream with a passphrase-derived AES-256-GCM
/// key. Every frame and the final end marker are authenticated. The password
/// is never persisted in the envelope.
#[cfg(test)]
pub(crate) fn encrypt(
    mut plaintext: impl Read,
    encrypted: impl Write,
    password: &str,
) -> Result<(), String> {
    let mut writer = ArchiveEncryptWriter::new(encrypted, password)?;
    std::io::copy(&mut plaintext, &mut writer)
        .map_err(|error| format!("could not read archive payload: {error}"))?;
    writer.finish().map(|_| ())
}

/// Decrypts and authenticates an archive stream.
///
/// Callers that write to durable storage must supply a staging destination and
/// publish it only after this function returns. A late authentication failure
/// can otherwise leave already-decoded frames in the writer.
#[cfg(test)]
pub(crate) fn decrypt(
    encrypted: impl Read,
    mut plaintext: impl Write,
    password: &str,
) -> Result<(), String> {
    let mut reader = ArchiveDecryptReader::new(encrypted, password)?;
    std::io::copy(&mut reader, &mut plaintext)
        .map_err(|error| format!("could not restore archive payload: {error}"))?;
    plaintext
        .flush()
        .map_err(|error| format!("could not finish restored archive: {error}"))
}

/// A bounded-memory authenticated writer used to compose the logical history
/// exporter directly with the encrypted envelope. Plaintext never needs to be
/// written to a temporary file.
pub(crate) struct ArchiveEncryptWriter<W: Write> {
    encrypted: W,
    key: aead::LessSafeKey,
    header: Vec<u8>,
    nonce_prefix: [u8; NONCE_PREFIX_BYTES],
    counter: u64,
    plaintext: Vec<u8>,
}

impl<W: Write> ArchiveEncryptWriter<W> {
    pub(crate) fn new(mut encrypted: W, password: &str) -> Result<Self, String> {
        validate_password(password)?;
        let random = ring_rand::SystemRandom::new();
        let mut salt = [0_u8; SALT_BYTES];
        let mut nonce_prefix = [0_u8; NONCE_PREFIX_BYTES];
        ring_rand::SecureRandom::fill(&random, &mut salt)
            .map_err(|_| "could not generate archive salt".to_string())?;
        ring_rand::SecureRandom::fill(&random, &mut nonce_prefix)
            .map_err(|_| "could not generate archive nonce".to_string())?;
        let header = encode_header(&salt, &nonce_prefix);
        encrypted
            .write_all(&header)
            .map_err(|error| format!("could not write archive header: {error}"))?;
        let key = archive_key(
            password,
            &salt,
            KeyDerivation::Argon2id {
                memory_kib: ARGON2_MEMORY_KIB,
                time_cost: ARGON2_TIME_COST,
                parallelism: ARGON2_PARALLELISM,
            },
        )?;
        Ok(Self {
            encrypted,
            key,
            header,
            nonce_prefix,
            counter: 0,
            plaintext: Vec::with_capacity(FRAME_PLAINTEXT_BYTES),
        })
    }

    fn flush_data_frame(&mut self) -> Result<(), String> {
        if self.plaintext.is_empty() {
            return Ok(());
        }
        write_encrypted_frame(
            &mut self.encrypted,
            &self.key,
            &self.header,
            self.nonce_prefix,
            self.counter,
            DATA_FRAME,
            &self.plaintext,
        )?;
        self.plaintext.clear();
        self.counter = self
            .counter
            .checked_add(1)
            .ok_or_else(|| "archive contains too many frames".to_string())?;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<W, String> {
        self.flush_data_frame()?;
        write_encrypted_frame(
            &mut self.encrypted,
            &self.key,
            &self.header,
            self.nonce_prefix,
            self.counter,
            FINAL_FRAME,
            &[],
        )?;
        self.encrypted
            .flush()
            .map_err(|error| format!("could not finish archive: {error}"))?;
        Ok(self.encrypted)
    }
}

impl<W: Write> Write for ArchiveEncryptWriter<W> {
    fn write(&mut self, mut bytes: &[u8]) -> std::io::Result<usize> {
        let total = bytes.len();
        while !bytes.is_empty() {
            let available = FRAME_PLAINTEXT_BYTES - self.plaintext.len();
            let count = available.min(bytes.len());
            self.plaintext.extend_from_slice(&bytes[..count]);
            bytes = &bytes[count..];
            if self.plaintext.len() == FRAME_PLAINTEXT_BYTES {
                self.flush_data_frame().map_err(archive_io_error)?;
            }
        }
        Ok(total)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.encrypted.flush()
    }
}

/// A bounded-memory authenticated reader used to feed the logical history
/// importer. Authentication completes before each plaintext frame is exposed,
/// and EOF is returned only after the authenticated final marker is verified.
pub(crate) struct ArchiveDecryptReader<R: Read> {
    encrypted: R,
    key: aead::LessSafeKey,
    header: Vec<u8>,
    nonce_prefix: [u8; NONCE_PREFIX_BYTES],
    frame_bytes: usize,
    counter: u64,
    plaintext: Vec<u8>,
    offset: usize,
    reached_end: bool,
}

impl<R: Read> ArchiveDecryptReader<R> {
    pub(crate) fn new(mut encrypted: R, password: &str) -> Result<Self, String> {
        validate_password(password)?;
        let header = read_header(&mut encrypted)?;
        let decoded = decode_header(&header)?;
        let key = archive_key(password, &decoded.salt, decoded.derivation)?;
        Ok(Self {
            encrypted,
            key,
            header,
            nonce_prefix: decoded.nonce_prefix,
            frame_bytes: decoded.frame_bytes,
            counter: 0,
            plaintext: Vec::new(),
            offset: 0,
            reached_end: false,
        })
    }

    fn read_frame(&mut self) -> Result<(), String> {
        let mut frame_header = [0_u8; 5];
        self.encrypted
            .read_exact(&mut frame_header)
            .map_err(|error| truncated("archive frame header", error))?;
        let kind = frame_header[0];
        let ciphertext_len =
            u32::from_le_bytes(frame_header[1..5].try_into().expect("four bytes")) as usize;
        let tag_len = aead::AES_256_GCM.tag_len();
        if ciphertext_len < tag_len || ciphertext_len > self.frame_bytes.saturating_add(tag_len) {
            return Err("archive frame length is invalid".into());
        }
        if kind == FINAL_FRAME && ciphertext_len != tag_len {
            return Err("archive end marker is invalid".into());
        }
        if kind != DATA_FRAME && kind != FINAL_FRAME {
            return Err("archive frame type is unsupported".into());
        }

        let mut ciphertext = vec![0_u8; ciphertext_len];
        self.encrypted
            .read_exact(&mut ciphertext)
            .map_err(|error| truncated("archive frame", error))?;
        let aad = frame_aad(&self.header, self.counter, kind, ciphertext_len as u32);
        let plaintext_len = self
            .key
            .open_in_place(
                archive_nonce(self.nonce_prefix, self.counter),
                aead::Aad::from(aad.as_slice()),
                &mut ciphertext,
            )
            .map_err(|_| "archive password is incorrect or the file is damaged".to_string())?
            .len();
        ciphertext.truncate(plaintext_len);

        if kind == FINAL_FRAME {
            if !ciphertext.is_empty() {
                return Err("archive end marker is invalid".into());
            }
            let mut trailing = [0_u8; 1];
            if self
                .encrypted
                .read(&mut trailing)
                .map_err(|error| format!("could not finish reading archive: {error}"))?
                != 0
            {
                return Err("archive contains unexpected trailing data".into());
            }
            self.reached_end = true;
            self.plaintext.clear();
            self.offset = 0;
            return Ok(());
        }

        if ciphertext.is_empty() {
            return Err("archive contains an empty data frame".into());
        }
        self.plaintext = ciphertext;
        self.offset = 0;
        self.counter = self
            .counter
            .checked_add(1)
            .ok_or_else(|| "archive contains too many frames".to_string())?;
        Ok(())
    }
}

impl<R: Read> Read for ArchiveDecryptReader<R> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        while self.offset == self.plaintext.len() && !self.reached_end {
            self.read_frame().map_err(archive_io_error)?;
        }
        if self.reached_end {
            return Ok(0);
        }
        let count = output.len().min(self.plaintext.len() - self.offset);
        output[..count].copy_from_slice(&self.plaintext[self.offset..self.offset + count]);
        self.offset += count;
        Ok(count)
    }
}

fn archive_io_error(error: String) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, error)
}

#[derive(Clone, Copy)]
enum KeyDerivation {
    Pbkdf2Sha256 {
        iterations: u32,
    },
    Argon2id {
        memory_kib: u32,
        time_cost: u32,
        parallelism: u32,
    },
}

struct DecodedHeader {
    derivation: KeyDerivation,
    frame_bytes: usize,
    salt: [u8; SALT_BYTES],
    nonce_prefix: [u8; NONCE_PREFIX_BYTES],
}

fn encode_header(salt: &[u8; SALT_BYTES], nonce_prefix: &[u8; NONCE_PREFIX_BYTES]) -> Vec<u8> {
    let mut header = Vec::with_capacity(HEADER_V2_BYTES);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION_ARGON2ID.to_le_bytes());
    header.push(KDF_ARGON2ID);
    header.push(AEAD_AES_256_GCM);
    header.extend_from_slice(&ARGON2_MEMORY_KIB.to_le_bytes());
    header.extend_from_slice(&ARGON2_TIME_COST.to_le_bytes());
    header.extend_from_slice(&ARGON2_PARALLELISM.to_le_bytes());
    header.extend_from_slice(&(FRAME_PLAINTEXT_BYTES as u32).to_le_bytes());
    header.extend_from_slice(salt);
    header.extend_from_slice(nonce_prefix);
    header
}

fn read_header(reader: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut header = vec![0_u8; HEADER_PREFIX_BYTES];
    reader
        .read_exact(&mut header)
        .map_err(|error| truncated("archive header", error))?;
    if &header[..MAGIC.len()] != MAGIC {
        return Err("this is not an Oleafly Checkpoints archive".into());
    }
    let version = u16::from_le_bytes(header[16..18].try_into().expect("two bytes"));
    let total = match version {
        FORMAT_VERSION_PBKDF2 => HEADER_V1_BYTES,
        FORMAT_VERSION_ARGON2ID => HEADER_V2_BYTES,
        _ => {
            return Err(format!(
                "checkpoint archive version {version} is not supported"
            ))
        }
    };
    header.resize(total, 0);
    reader
        .read_exact(&mut header[HEADER_PREFIX_BYTES..])
        .map_err(|error| truncated("archive header", error))?;
    Ok(header)
}

fn decode_header(header: &[u8]) -> Result<DecodedHeader, String> {
    if header.len() < HEADER_PREFIX_BYTES || &header[..MAGIC.len()] != MAGIC {
        return Err("this is not an Oleafly Checkpoints archive".into());
    }
    let version = u16::from_le_bytes(header[16..18].try_into().expect("two bytes"));
    if header[19] != AEAD_AES_256_GCM {
        return Err("checkpoint archive encryption is not supported".into());
    }
    let (derivation, frame_offset) = match version {
        FORMAT_VERSION_PBKDF2 => {
            if header.len() != HEADER_V1_BYTES || header[18] != KDF_PBKDF2_SHA256 {
                return Err("checkpoint archive encryption is not supported".into());
            }
            let iterations = u32::from_le_bytes(header[20..24].try_into().expect("four bytes"));
            if !(MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&iterations) {
                return Err("checkpoint archive key settings are unsafe or unsupported".into());
            }
            (KeyDerivation::Pbkdf2Sha256 { iterations }, 24)
        }
        FORMAT_VERSION_ARGON2ID => {
            if header.len() != HEADER_V2_BYTES || header[18] != KDF_ARGON2ID {
                return Err("checkpoint archive encryption is not supported".into());
            }
            let memory_kib = u32::from_le_bytes(header[20..24].try_into().expect("four bytes"));
            let time_cost = u32::from_le_bytes(header[24..28].try_into().expect("four bytes"));
            let parallelism = u32::from_le_bytes(header[28..32].try_into().expect("four bytes"));
            if !(1..=MAX_ARGON2_PARALLELISM).contains(&parallelism)
                || !(1..=MAX_ARGON2_TIME_COST).contains(&time_cost)
                || memory_kib > MAX_ARGON2_MEMORY_KIB
                || memory_kib < parallelism.saturating_mul(8)
            {
                return Err("checkpoint archive key settings are unsafe or unsupported".into());
            }
            (
                KeyDerivation::Argon2id {
                    memory_kib,
                    time_cost,
                    parallelism,
                },
                32,
            )
        }
        _ => {
            return Err(format!(
                "checkpoint archive version {version} is not supported"
            ))
        }
    };
    let frame_bytes = u32::from_le_bytes(
        header[frame_offset..frame_offset + 4]
            .try_into()
            .expect("four bytes"),
    ) as usize;
    if frame_bytes == 0 || frame_bytes > MAX_FRAME_PLAINTEXT_BYTES {
        return Err("checkpoint archive frame size is invalid".into());
    }
    let salt_offset = frame_offset + 4;
    let nonce_offset = salt_offset + SALT_BYTES;
    let salt = header[salt_offset..nonce_offset]
        .try_into()
        .expect("sixteen bytes");
    let nonce_prefix = header[nonce_offset..nonce_offset + NONCE_PREFIX_BYTES]
        .try_into()
        .expect("four bytes");
    Ok(DecodedHeader {
        derivation,
        frame_bytes,
        salt,
        nonce_prefix,
    })
}

fn archive_key(
    password: &str,
    salt: &[u8],
    derivation: KeyDerivation,
) -> Result<aead::LessSafeKey, String> {
    let mut bytes = [0_u8; 32];
    let derived = match derivation {
        KeyDerivation::Pbkdf2Sha256 { iterations } => NonZeroU32::new(iterations)
            .ok_or_else(|| "checkpoint archive key settings are invalid".to_string())
            .map(|iterations| {
                pbkdf2::derive(
                    pbkdf2::PBKDF2_HMAC_SHA256,
                    iterations,
                    salt,
                    password.as_bytes(),
                    &mut bytes,
                )
            }),
        KeyDerivation::Argon2id {
            memory_kib,
            time_cost,
            parallelism,
        } => argon2::Params::new(memory_kib, time_cost, parallelism, Some(bytes.len()))
            .map_err(|_| "checkpoint archive key settings are invalid".to_string())
            .and_then(|params| {
                argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
                    .hash_password_into(password.as_bytes(), salt, &mut bytes)
                    .map_err(|_| "could not derive the archive key".to_string())
            }),
    };
    if let Err(error) = derived {
        bytes.zeroize();
        return Err(error);
    }
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, &bytes)
        .map_err(|_| "could not initialize archive encryption".to_string());
    bytes.zeroize();
    Ok(aead::LessSafeKey::new(unbound?))
}

fn write_encrypted_frame(
    writer: &mut impl Write,
    key: &aead::LessSafeKey,
    header: &[u8],
    nonce_prefix: [u8; NONCE_PREFIX_BYTES],
    counter: u64,
    kind: u8,
    plaintext: &[u8],
) -> Result<(), String> {
    let ciphertext_len = plaintext
        .len()
        .checked_add(aead::AES_256_GCM.tag_len())
        .and_then(|length| u32::try_from(length).ok())
        .ok_or_else(|| "archive frame is too large".to_string())?;
    let aad = frame_aad(header, counter, kind, ciphertext_len);
    let mut ciphertext = plaintext.to_vec();
    key.seal_in_place_append_tag(
        archive_nonce(nonce_prefix, counter),
        aead::Aad::from(aad.as_slice()),
        &mut ciphertext,
    )
    .map_err(|_| "could not encrypt archive frame".to_string())?;
    writer
        .write_all(&[kind])
        .and_then(|_| writer.write_all(&ciphertext_len.to_le_bytes()))
        .and_then(|_| writer.write_all(&ciphertext))
        .map_err(|error| format!("could not write archive frame: {error}"))
}

fn frame_aad(header: &[u8], counter: u64, kind: u8, ciphertext_len: u32) -> Vec<u8> {
    let mut aad = Vec::with_capacity(header.len() + 13);
    aad.extend_from_slice(header);
    aad.extend_from_slice(&counter.to_be_bytes());
    aad.push(kind);
    aad.extend_from_slice(&ciphertext_len.to_le_bytes());
    aad
}

fn archive_nonce(prefix: [u8; NONCE_PREFIX_BYTES], counter: u64) -> aead::Nonce {
    let mut nonce = [0_u8; 12];
    nonce[..NONCE_PREFIX_BYTES].copy_from_slice(&prefix);
    nonce[NONCE_PREFIX_BYTES..].copy_from_slice(&counter.to_be_bytes());
    aead::Nonce::assume_unique_for_key(nonce)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("archive password must contain at least 8 characters".into());
    }
    Ok(())
}

fn truncated(context: &str, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        format!("{context} is truncated")
    } else {
        format!("could not read {context}: {error}")
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::{decrypt, encrypt};

    #[test]
    fn round_trip_streams_payloads_larger_than_one_frame() {
        let plaintext = (0..(2 * 1024 * 1024 + 137))
            .map(|index| (index % 251) as u8)
            .collect::<Vec<_>>();
        let mut encrypted = Vec::new();
        encrypt(
            Cursor::new(&plaintext),
            &mut encrypted,
            "correct horse battery staple",
        )
        .unwrap();

        assert!(!encrypted
            .windows(64)
            .any(|window| window == &plaintext[..64]));

        let mut restored = Vec::new();
        decrypt(
            Cursor::new(&encrypted),
            &mut restored,
            "correct horse battery staple",
        )
        .unwrap();
        assert_eq!(restored, plaintext);
    }

    #[test]
    fn wrong_password_and_truncation_are_rejected() {
        let mut encrypted = Vec::new();
        encrypt(
            Cursor::new(b"checkpoint data"),
            &mut encrypted,
            "right-password",
        )
        .unwrap();

        let mut output = Vec::new();
        assert!(decrypt(Cursor::new(&encrypted), &mut output, "wrong-password").is_err());

        encrypted.pop();
        output.clear();
        assert!(decrypt(Cursor::new(&encrypted), &mut output, "right-password").is_err());
        assert!(encrypt(Cursor::new(b"checkpoint data"), Vec::new(), "short").is_err());
    }

    #[test]
    fn hostile_argon2_parameters_are_rejected_before_any_key_derivation() {
        let mut encrypted = Vec::new();
        encrypt(Cursor::new(b"checkpoint data"), &mut encrypted, "password").unwrap();

        for (offset, value) in [
            (20_usize, super::MAX_ARGON2_MEMORY_KIB + 1),
            (24, super::MAX_ARGON2_TIME_COST + 1),
            (28, super::MAX_ARGON2_PARALLELISM + 1),
            (24, 0),
            (28, 0),
        ] {
            let mut hostile = encrypted.clone();
            hostile[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            let mut output = Vec::new();
            let error = decrypt(Cursor::new(hostile), &mut output, "password").unwrap_err();
            assert!(error.contains("key settings"), "{offset}/{value}: {error}");
        }
    }

    #[test]
    fn unsupported_envelope_versions_and_kdf_ids_are_rejected() {
        let mut encrypted = Vec::new();
        encrypt(Cursor::new(b"checkpoint data"), &mut encrypted, "password").unwrap();

        let mut future = encrypted.clone();
        future[16..18].copy_from_slice(&3_u16.to_le_bytes());
        let mut output = Vec::new();
        assert!(decrypt(Cursor::new(future), &mut output, "password")
            .unwrap_err()
            .contains("version 3 is not supported"));

        let mut swapped = encrypted;
        swapped[18] = super::KDF_PBKDF2_SHA256;
        output.clear();
        assert!(decrypt(Cursor::new(swapped), &mut output, "password")
            .unwrap_err()
            .contains("encryption is not supported"));
    }

    #[test]
    fn tampering_and_trailing_bytes_are_rejected() {
        let mut encrypted = Vec::new();
        encrypt(Cursor::new(b"checkpoint data"), &mut encrypted, "password").unwrap();

        let middle = encrypted.len() / 2;
        encrypted[middle] ^= 0x40;
        let mut output = Vec::new();
        assert!(decrypt(Cursor::new(&encrypted), &mut output, "password").is_err());

        let mut valid = Vec::new();
        encrypt(Cursor::new(b"checkpoint data"), &mut valid, "password").unwrap();
        valid.extend_from_slice(b"unexpected");
        output.clear();
        assert!(decrypt(Cursor::new(valid), &mut output, "password").is_err());
    }
}
