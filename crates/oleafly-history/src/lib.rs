//! Durable, content-addressed compile checkpoints.
//!
//! This crate deliberately does not discover compiler dependencies. Callers
//! must pass an explicit, already-proven list of project-local regular files.
//! Staging seals those bytes into a private materialized tree. Publishing is a
//! separate operation that is only valid after the compiler has consumed that
//! tree and Oleafly has validated its output.

use std::collections::HashSet;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use fastcdc::v2020::StreamCDC;
use rand::RngCore;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::ser::SerializeSeq;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

const FORMAT_VERSION: u32 = 2;
const UNSTORED_MANIFEST_VERSION: u32 = 2;
const PACK_MAGIC: &[u8; 12] = b"OLEAPACK\0\0\0\x01";
const MIN_CHUNK_SIZE: u32 = 256 * 1024;
const AVG_CHUNK_SIZE: u32 = 1024 * 1024;
const MAX_CHUNK_SIZE: u32 = 4 * 1024 * 1024;
const ZSTD_LEVEL: i32 = 3;
const EXPORT_MAGIC: &[u8] = b"OLEAFLY-CKPT\0\x01";
const HISTORY_EXPORT_MAGIC: &[u8] = b"OLEAFLY-HISTORY\0\x02";
const MAX_EXPORT_HEADER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_HISTORY_CHECKPOINTS: u64 = 4_096;
const MAX_CHECKPOINT_LABEL_CHARS: usize = 80;
const MAX_HISTORY_METADATA_BYTES: u64 = 256 * 1024 * 1024;
const MAX_HISTORY_CHUNK_REFERENCES: u64 = 250_000;
const MAX_HISTORY_LOGICAL_BYTES: u64 = 128 * 1024 * 1024 * 1024;
const MAX_CHECKPOINT_FILE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_PROJECT_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const STORE_LINEAGE_BYTES: usize = 36;
const OPERATION_LOCK_FILE: &str = "operation.lock";
const NAMESPACE_LOCK_FILE: &str = ".oleafly-checkpoint-stores.lock";
const INITIALIZATION_LOCK_PREFIX: &str = ".oleafly-checkpoint-init-lock-";
const INITIALIZATION_DIR_PREFIX: &str = ".oleafly-checkpoint-init-";
const DELETE_RECORD_VERSION: u8 = 1;
const DELETE_RECORD_PREFIX: &str = ".oleafly-checkpoint-delete-";
const DELETE_RECORD_SUFFIX: &str = ".json";

static CANDIDATE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize, Serialize)]
struct DeleteRecord {
    version: u8,
    store_name_hash: String,
    token: String,
}

/// Errors returned by checkpoint storage operations.
#[derive(Debug, Error)]
pub enum HistoryError {
    #[error("checkpoint I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("checkpoint catalog failed: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("checkpoint metadata is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid checkpoint input: {0}")]
    InvalidInput(String),
    #[error("the proven input set must contain project.json")]
    MissingProjectManifest,
    #[error("unsupported checkpoint store format version {0}")]
    UnsupportedFormat(u32),
    #[error("checkpoint store is corrupt: {0}")]
    Corrupt(String),
    #[error("checkpoint {0} was not found")]
    CheckpointNotFound(String),
    #[error("checkpoint publication was cancelled")]
    PublicationCancelled,
}

pub type Result<T> = std::result::Result<T, HistoryError>;

/// Coordinates cancellation with the one operation that makes a checkpoint
/// visible.
///
/// `commit_visibility` must serialize its cancellation decision with `commit`.
/// Returning `false` means cancellation won and `commit` was not invoked.
pub trait PublicationGate {
    fn is_cancelled(&self) -> bool;

    fn commit_visibility(&self, commit: &mut dyn FnMut() -> Result<()>) -> Result<bool>;
}

struct UncancelledPublication;

impl PublicationGate for UncancelledPublication {
    fn is_cancelled(&self) -> bool {
        false
    }

    fn commit_visibility(&self, commit: &mut dyn FnMut() -> Result<()>) -> Result<bool> {
        commit()?;
        Ok(true)
    }
}

struct DeferredVisibility<'a>(&'a dyn PublicationGate);

impl PublicationGate for DeferredVisibility<'_> {
    fn is_cancelled(&self) -> bool {
        self.0.is_cancelled()
    }

    fn commit_visibility(&self, commit: &mut dyn FnMut() -> Result<()>) -> Result<bool> {
        if self.0.is_cancelled() {
            return Ok(false);
        }
        commit()?;
        Ok(true)
    }
}

fn ensure_publication_active(gate: &dyn PublicationGate) -> Result<()> {
    if gate.is_cancelled() {
        return Err(HistoryError::PublicationCancelled);
    }
    Ok(())
}

/// A BLAKE3 content identity.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ContentHash([u8; 32]);

impl ContentHash {
    pub fn digest(bytes: &[u8]) -> Self {
        Self(*blake3::hash(bytes).as_bytes())
    }

    /// Streams one regular file into a BLAKE3 identity without retaining its
    /// contents in memory. Callers must still seal and identity-check the file
    /// before treating this hash as replay evidence.
    pub fn digest_file(path: impl AsRef<Path>) -> Result<Self> {
        let file = File::open(path)?;
        let mut reader = BufReader::new(file);
        let mut hasher = blake3::Hasher::new();
        io::copy(&mut reader, &mut hasher)?;
        Ok(Self::from_bytes(*hasher.finalize().as_bytes()))
    }

    /// Streams a file identity while polling the same gate used for staging
    /// and publication.
    pub fn digest_file_controlled(
        path: impl AsRef<Path>,
        gate: &dyn PublicationGate,
    ) -> Result<Self> {
        hash_file_controlled(path.as_ref(), gate)
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

    fn from_hex(value: &str) -> Result<Self> {
        let decoded = decode_hex_32(value)
            .ok_or_else(|| HistoryError::Corrupt(format!("invalid BLAKE3 hash {value:?}")))?;
        Ok(Self(decoded))
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&encode_hex(&self.0))
    }
}

/// The identity of a deterministic source manifest.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct SnapshotRoot(ContentHash);

impl SnapshotRoot {
    pub fn as_hash(&self) -> ContentHash {
        self.0
    }

    pub fn as_hex(&self) -> String {
        self.0.to_hex()
    }

    pub fn parse(value: &str) -> Result<Self> {
        Self::from_hex(value)
    }

    fn from_hex(value: &str) -> Result<Self> {
        Ok(Self(ContentHash::from_hex(value)?))
    }
}

impl fmt::Display for SnapshotRoot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Why a project-local regular file is eligible for a sealed candidate.
#[derive(Clone, Debug, Eq, PartialEq)]
enum CaptureBasis {
    Explicit,
    CompilerRead {
        resolved_path: PathBuf,
        first_read_hash: ContentHash,
    },
    ReplayRequired {
        resolved_path: PathBuf,
        preseal_hash: ContentHash,
    },
}

/// One project-local regular file from explicit policy, direct compiler
/// evidence, or a dependency that must be proven by sealed replay.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CaptureInput {
    relative_path: String,
    basis: CaptureBasis,
    stored: bool,
}

impl CaptureInput {
    pub fn explicit(relative_path: impl Into<String>) -> Result<Self> {
        let relative_path = relative_path.into();
        validate_portable_relative_path(&relative_path)?;
        Ok(Self {
            relative_path,
            basis: CaptureBasis::Explicit,
            stored: true,
        })
    }

    pub fn proven(
        relative_path: impl Into<String>,
        resolved_path: impl Into<PathBuf>,
        first_read_hash: ContentHash,
    ) -> Result<Self> {
        let relative_path = relative_path.into();
        validate_portable_relative_path(&relative_path)?;
        let resolved_path = resolved_path.into();
        if !resolved_path.is_absolute() {
            return Err(HistoryError::InvalidInput(format!(
                "resolved compiler input for {relative_path} must be absolute"
            )));
        }
        Ok(Self {
            relative_path,
            basis: CaptureBasis::CompilerRead {
                resolved_path,
                first_read_hash,
            },
            stored: true,
        })
    }

    /// Marks a compiler-discovered path whose exact sealed bytes must appear
    /// in the authoritative replay evidence. Unlike `proven`, `preseal_hash`
    /// is not represented as a first-read hash from the live compile.
    pub fn replay_required(
        relative_path: impl Into<String>,
        resolved_path: impl Into<PathBuf>,
        preseal_hash: ContentHash,
    ) -> Result<Self> {
        Self::replay_required_with_storage(relative_path, resolved_path, preseal_hash, true)
    }

    pub fn replay_required_unstored(
        relative_path: impl Into<String>,
        resolved_path: impl Into<PathBuf>,
        preseal_hash: ContentHash,
    ) -> Result<Self> {
        Self::replay_required_with_storage(relative_path, resolved_path, preseal_hash, false)
    }

    fn replay_required_with_storage(
        relative_path: impl Into<String>,
        resolved_path: impl Into<PathBuf>,
        preseal_hash: ContentHash,
        stored: bool,
    ) -> Result<Self> {
        let relative_path = relative_path.into();
        validate_portable_relative_path(&relative_path)?;
        if !stored && relative_path == "project.json" {
            return Err(HistoryError::InvalidInput(
                "project.json must always retain its checkpoint bytes".into(),
            ));
        }
        let resolved_path = resolved_path.into();
        if !resolved_path.is_absolute() {
            return Err(HistoryError::InvalidInput(format!(
                "resolved replay input for {relative_path} must be absolute"
            )));
        }
        Ok(Self {
            relative_path,
            basis: CaptureBasis::ReplayRequired {
                resolved_path,
                preseal_hash,
            },
            stored,
        })
    }

    pub fn relative_path(&self) -> &str {
        &self.relative_path
    }

    pub fn is_stored(&self) -> bool {
        self.stored
    }
}

/// One project-local input observed by the sealed replay compile.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ReplayedInput {
    pub relative_path: String,
    pub content_hash: ContentHash,
}

impl ReplayedInput {
    pub fn new(relative_path: impl Into<String>, content_hash: ContentHash) -> Result<Self> {
        let relative_path = relative_path.into();
        validate_portable_relative_path(&relative_path)?;
        Ok(Self {
            relative_path,
            content_hash,
        })
    }
}

/// Provenance recorded for a successful, already-validated compile.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompileEvidence {
    pub engine: String,
    pub toolchain_identity: String,
    pub main_document: String,
    pub output_hash: ContentHash,
    pub completed_at_unix_ms: i64,
    replayed_inputs: Vec<ReplayedInput>,
}

impl CompileEvidence {
    pub fn new(
        engine: impl Into<String>,
        toolchain_identity: impl Into<String>,
        main_document: impl Into<String>,
        output_hash: ContentHash,
        completed_at_unix_ms: i64,
        mut replayed_inputs: Vec<ReplayedInput>,
    ) -> Result<Self> {
        let engine = engine.into();
        if engine.trim().is_empty() {
            return Err(HistoryError::InvalidInput(
                "compile engine must not be empty".into(),
            ));
        }
        let toolchain_identity = toolchain_identity.into();
        if toolchain_identity.trim().is_empty() {
            return Err(HistoryError::InvalidInput(
                "compile toolchain identity must not be empty".into(),
            ));
        }
        let main_document = main_document.into();
        validate_portable_relative_path(&main_document)?;
        if completed_at_unix_ms < 0 {
            return Err(HistoryError::InvalidInput(
                "compile completion time must not be negative".into(),
            ));
        }
        replayed_inputs.sort();
        validate_portable_path_set(
            replayed_inputs
                .iter()
                .map(|input| input.relative_path.as_str()),
        )?;
        Ok(Self {
            engine,
            toolchain_identity,
            main_document,
            output_hash,
            completed_at_unix_ms,
            replayed_inputs,
        })
    }
}

/// A visible immutable checkpoint.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Checkpoint {
    pub snapshot_root: SnapshotRoot,
    pub completed_at_unix_ms: i64,
    pub engine: String,
    pub toolchain_identity: String,
    pub main_document: String,
    pub output_hash: ContentHash,
    pub file_count: u64,
    pub logical_bytes: u64,
    pub label: Option<String>,
    replayed_inputs: Vec<ReplayedInput>,
    portable_metadata_bytes: u64,
    chunk_references: u64,
    unstored_file_count: u64,
    unstored_logical_bytes: u64,
}

impl Checkpoint {
    pub fn replayed_inputs(&self) -> &[ReplayedInput] {
        &self.replayed_inputs
    }

    pub fn unstored_file_count(&self) -> u64 {
        self.unstored_file_count
    }

    pub fn unstored_logical_bytes(&self) -> u64 {
        self.unstored_logical_bytes
    }
}

/// Digest evidence for one file in a sealed candidate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedFile {
    pub relative_path: String,
    pub logical_bytes: u64,
    pub content_hash: ContentHash,
    pub chunk_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CheckpointFile {
    pub relative_path: String,
    pub logical_bytes: u64,
    pub content_hash: ContentHash,
    pub stored: bool,
    pub chunk_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackInspection {
    pub file_name: String,
    pub encoded_bytes: u64,
    pub chunk_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreInspection {
    pub root: PathBuf,
    pub catalog_path: PathBuf,
    pub catalog_bytes: u64,
    pub format_version: u32,
    pub lineage: String,
    pub checkpoint_count: u64,
    pub manifest_count: u64,
    pub pack_count: u64,
    pub chunk_count: u64,
    pub manifest_chunk_count: u64,
    pub packs: Vec<PackInspection>,
}

/// Whether publication created a new visible root or reused an exact one.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PublishOutcome {
    Created(Checkpoint),
    Existing(Checkpoint),
}

/// Storage measurements used by maintenance and UI surfaces.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct StoreStats {
    pub checkpoint_count: u64,
    pub manifest_count: u64,
    pub pack_count: u64,
    pub chunk_count: u64,
    pub stored_pack_bytes: u64,
    pub compressed_chunk_count: u64,
    pub raw_chunk_count: u64,
    pub max_raw_chunk_bytes: u64,
    pub logical_chunk_bytes: u64,
    pub stored_chunk_bytes: u64,
    pub visible_logical_bytes: u64,
    pub reclaimable_pack_bytes: u64,
    pub unstored_file_count: u64,
    pub unstored_logical_bytes: u64,
}

/// Results of conservative reachability garbage collection.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GarbageCollection {
    pub deleted_manifests: u64,
    pub deleted_chunks: u64,
    pub deleted_packs: u64,
    pub reclaimed_bytes: u64,
}

/// Result of verified materialization into a new staging directory.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Materialization {
    pub file_count: u64,
    pub logical_bytes: u64,
    pub omitted: Vec<String>,
}

/// Work performed by a complete integrity verification pass.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Verification {
    pub checked_checkpoints: u64,
    pub checked_files: u64,
    pub checked_chunk_references: u64,
    pub checked_packs: u64,
}

/// Metadata for a portable logical checkpoint export.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportSummary {
    pub snapshot_root: SnapshotRoot,
    pub file_count: u64,
    pub logical_bytes: u64,
}

/// Metadata for a portable logical export of all visible roots.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HistoryExportSummary {
    pub checkpoint_count: u64,
    pub logical_bytes: u64,
}

/// Result of an all-or-nothing portable history import.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct HistoryImportSummary {
    pub created_checkpoints: u64,
    pub existing_checkpoints: u64,
}

/// An invisible sealed candidate. Dropping it removes staging data.
pub struct Candidate {
    store_root: PathBuf,
    staging_dir: PathBuf,
    sealed_root: PathBuf,
    staged_pack: PathBuf,
    pack_id: ContentHash,
    pack_len: u64,
    snapshot_root: SnapshotRoot,
    manifest: Manifest,
    manifest_json: Vec<u8>,
    proven_files: Vec<SealedFile>,
    new_chunks: Vec<StagedChunk>,
    _store_locks: StoreLocks,
    cleaned: bool,
}

struct StoreLocks {
    _namespace: File,
    _operation: File,
}

impl Candidate {
    pub fn sealed_root(&self) -> &Path {
        &self.sealed_root
    }

    pub fn snapshot_root(&self) -> &SnapshotRoot {
        &self.snapshot_root
    }

    /// Reports whether this candidate's root is already a visible checkpoint,
    /// using the store locks the candidate already holds.
    pub fn root_is_visible(&self) -> Result<bool> {
        let store = Store {
            root: self.store_root.clone(),
        };
        Ok(store.checkpoint_inner(&self.snapshot_root)?.is_some())
    }

    pub fn sealed_files(&self) -> Vec<SealedFile> {
        self.manifest
            .files
            .iter()
            .map(|file| SealedFile {
                relative_path: file.path.clone(),
                logical_bytes: file.logical_size,
                content_hash: ContentHash::from_hex(&file.content_hash)
                    .expect("candidate manifests contain generated BLAKE3 hashes"),
                chunk_count: file.chunks.len() as u64,
            })
            .collect()
    }

    pub fn proven_files(&self) -> &[SealedFile] {
        &self.proven_files
    }

    fn cleanup(&mut self) -> Result<()> {
        if !self.cleaned {
            match fs::remove_dir_all(&self.staging_dir) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            self.cleaned = true;
        }
        Ok(())
    }
}

impl fmt::Debug for Candidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Candidate")
            .field("snapshot_root", &self.snapshot_root)
            .field("sealed_root", &self.sealed_root)
            .finish_non_exhaustive()
    }
}

impl Drop for Candidate {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn advance_capture_budget(
    file_bytes: u64,
    checkpoint_bytes: u64,
    chunk_references: u64,
    chunk_bytes: u64,
) -> Result<(u64, u64, u64)> {
    let file_bytes = file_bytes
        .checked_add(chunk_bytes)
        .ok_or_else(|| HistoryError::InvalidInput("checkpoint file size overflow".into()))?;
    if file_bytes > MAX_CHECKPOINT_FILE_BYTES {
        return Err(HistoryError::InvalidInput(
            "checkpoint file exceeds the 16 GiB capture limit".into(),
        ));
    }
    let checkpoint_bytes = checkpoint_bytes
        .checked_add(chunk_bytes)
        .ok_or_else(|| HistoryError::InvalidInput("checkpoint size overflow".into()))?;
    if checkpoint_bytes > MAX_HISTORY_LOGICAL_BYTES {
        return Err(HistoryError::InvalidInput(
            "checkpoint exceeds the portable history logical-size limit".into(),
        ));
    }
    let chunk_references = chunk_references
        .checked_add(1)
        .ok_or_else(|| HistoryError::InvalidInput("checkpoint chunk count overflow".into()))?;
    if chunk_references > MAX_HISTORY_CHUNK_REFERENCES {
        return Err(HistoryError::InvalidInput(
            "checkpoint exceeds the portable history chunk-reference limit".into(),
        ));
    }
    Ok((file_bytes, checkpoint_bytes, chunk_references))
}

fn advance_unstored_capture_budget(
    file_bytes: u64,
    checkpoint_bytes: u64,
    read_bytes: u64,
) -> Result<(u64, u64)> {
    let file_bytes = file_bytes
        .checked_add(read_bytes)
        .ok_or_else(|| HistoryError::InvalidInput("checkpoint file size overflow".into()))?;
    if file_bytes > MAX_CHECKPOINT_FILE_BYTES {
        return Err(HistoryError::InvalidInput(
            "checkpoint file exceeds the 16 GiB capture limit".into(),
        ));
    }
    let checkpoint_bytes = checkpoint_bytes
        .checked_add(read_bytes)
        .ok_or_else(|| HistoryError::InvalidInput("checkpoint size overflow".into()))?;
    if checkpoint_bytes > MAX_HISTORY_LOGICAL_BYTES {
        return Err(HistoryError::InvalidInput(
            "checkpoint exceeds the portable history logical-size limit".into(),
        ));
    }
    Ok((file_bytes, checkpoint_bytes))
}

/// A single project's independent checkpoint store.
#[derive(Clone, Debug)]
pub struct Store {
    root: PathBuf,
}

/// A store used by automatic publication.
///
/// A first publication is assembled below a private sibling directory. The
/// final store path remains absent until [`PublicationStore::commit`] installs
/// a nonempty store with one same-filesystem rename.
pub struct PublicationStore {
    store: Option<Store>,
    target_root: PathBuf,
    initialization_dir: Option<PathBuf>,
    _initialization_lock: File,
}

/// Result of committing an automatic publication store.
#[derive(Debug)]
pub enum PublicationCommitOutcome {
    /// The store is visible and its parent directory was durably synchronized.
    Durable(Store),
    /// The initial store is visible, but parent-directory synchronization could
    /// not prove that the install will survive a system crash.
    InstalledDurabilityUncertain(Store),
}

impl PublicationCommitOutcome {
    pub fn into_store(self) -> Store {
        match self {
            Self::Durable(store) | Self::InstalledDurabilityUncertain(store) => store,
        }
    }
}

impl PublicationStore {
    pub fn store(&self) -> &Store {
        self.store
            .as_ref()
            .expect("publication store is available until commit")
    }

    /// Makes a successfully published initial store visible. Existing stores
    /// need no installation and are returned unchanged.
    pub fn commit(self) -> Result<PublicationCommitOutcome> {
        self.commit_with_parent_sync(sync_directory)
    }

    /// Publishes and installs a checkpoint without cancellation.
    pub fn publish(
        self,
        candidate: Candidate,
        evidence: CompileEvidence,
    ) -> Result<(PublishOutcome, PublicationCommitOutcome)> {
        self.publish_controlled(candidate, evidence, &UncancelledPublication)
    }

    /// Publishes with one cancellation cutoff at the operation that first
    /// makes the checkpoint visible. Existing stores cross the cutoff at the
    /// catalog commit. A first store crosses it at the final directory rename.
    pub fn publish_controlled(
        self,
        candidate: Candidate,
        evidence: CompileEvidence,
        gate: &dyn PublicationGate,
    ) -> Result<(PublishOutcome, PublicationCommitOutcome)> {
        let requires_install = self.initialization_dir.is_some();
        let published = if requires_install {
            self.store().publish_inner_controlled(
                candidate,
                evidence,
                PublishFault::None,
                &DeferredVisibility(gate),
            )?
        } else {
            self.store().publish_controlled(candidate, evidence, gate)?
        };
        let committed = if requires_install {
            self.commit_controlled(gate)?
        } else {
            self.commit()?
        };
        Ok((published, committed))
    }

    fn commit_controlled(self, gate: &dyn PublicationGate) -> Result<PublicationCommitOutcome> {
        self.commit_inner(sync_directory, Some(gate))
    }

    fn commit_with_parent_sync(
        self,
        sync_parent: impl FnMut(&Path) -> Result<()>,
    ) -> Result<PublicationCommitOutcome> {
        self.commit_inner(sync_parent, None)
    }

    fn commit_inner(
        mut self,
        mut sync_parent: impl FnMut(&Path) -> Result<()>,
        gate: Option<&dyn PublicationGate>,
    ) -> Result<PublicationCommitOutcome> {
        let mut store = self
            .store
            .take()
            .expect("publication store is available until commit");
        let Some(initialization_dir) = self.initialization_dir.as_ref() else {
            return Ok(PublicationCommitOutcome::Durable(store));
        };

        if store.list()?.is_empty() {
            return Err(HistoryError::InvalidInput(
                "cannot install a checkpoint store without a visible checkpoint".into(),
            ));
        }

        let parent = store_parent(&self.target_root)?;
        let namespace_lock = open_namespace_lock(parent, true)?;
        fs4::FileExt::lock(&namespace_lock)?;
        if self.target_root.try_exists()? {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint store appeared while its first publication was being installed: {}",
                self.target_root.display()
            )));
        }

        let mut install = || {
            fs::rename(&store.root, &self.target_root)?;
            Ok(())
        };
        let installed = if let Some(gate) = gate {
            gate.commit_visibility(&mut install)?
        } else {
            install()?;
            true
        };
        if !installed {
            return Err(HistoryError::PublicationCancelled);
        }
        let mut durable = sync_parent(parent).is_ok();
        store.root = self.target_root.clone();
        let initialization_dir = initialization_dir.clone();
        self.initialization_dir = None;
        drop(namespace_lock);

        // Any residue here is private and will also be reaped before the next
        // publication attempt. A later successful parent sync also makes the
        // already-completed install durable.
        let _ = remove_path_without_following_links(&initialization_dir);
        durable |= sync_parent(parent).is_ok();
        if durable {
            Ok(PublicationCommitOutcome::Durable(store))
        } else {
            Ok(PublicationCommitOutcome::InstalledDurabilityUncertain(
                store,
            ))
        }
    }
}

impl Drop for PublicationStore {
    fn drop(&mut self) {
        if let Some(initialization_dir) = self.initialization_dir.take() {
            let _ = remove_path_without_following_links(&initialization_dir);
            if let Some(parent) = initialization_dir.parent() {
                let _ = sync_directory(parent);
            }
        }
    }
}

/// An exclusive, cross-process store operation. Keep this guard alive while
/// external journal files under the store root are in use.
pub struct ExclusiveStoreGuard<'a> {
    store: &'a Store,
    _locks: StoreLocks,
}

impl ExclusiveStoreGuard<'_> {
    pub fn root(&self) -> &Path {
        &self.store.root
    }

    pub fn checkpoint(&self, root: &SnapshotRoot) -> Result<Option<Checkpoint>> {
        self.store.checkpoint_inner(root)
    }

    pub fn materialize(
        &self,
        root: &SnapshotRoot,
        destination: impl AsRef<Path>,
    ) -> Result<Materialization> {
        self.store.materialize_unlocked(root, destination.as_ref())
    }
}

impl Store {
    /// Opens or creates the store at an application-data path supplied by the
    /// caller. This method never accepts or derives a project source path.
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let requested_root = root.as_ref();
        let requested_parent = store_parent(requested_root)?;
        fs::create_dir_all(requested_parent)?;
        validate_real_directory(requested_parent, "checkpoint store parent")?;
        let parent = requested_parent.canonicalize()?;
        let name = store_name(requested_root)?;
        let _initialization_lock = lock_initialization(&parent, name, true)?.ok_or_else(|| {
            HistoryError::Corrupt("blocking checkpoint initialization lock was not acquired".into())
        })?;
        let root = parent.join(name);
        let namespace_lock = open_namespace_lock(&parent, true)?;
        fs4::FileExt::lock_shared(&namespace_lock)?;
        fs::create_dir_all(&root)?;
        validate_real_directory(&root, "checkpoint store root")?;
        set_private_directory_permissions(&root)?;
        sync_directory(&parent)?;
        let operation_lock_path = root.join(OPERATION_LOCK_FILE);
        let mut operation_options = OpenOptions::new();
        operation_options.create(true).read(true).write(true);
        let operation_lock = open_with_no_follow(&mut operation_options, &operation_lock_path)?;
        validate_regular_file(&operation_lock_path, "checkpoint operation lock")?;
        set_private_file_permissions(&root.join(OPERATION_LOCK_FILE))?;
        fs4::FileExt::lock(&operation_lock)?;
        initialize_format(&root)?;
        fs::create_dir_all(root.join("packs"))?;
        fs::create_dir_all(root.join("staging"))?;
        validate_real_directory(&root.join("packs"), "checkpoint packs directory")?;
        validate_real_directory(&root.join("staging"), "checkpoint staging directory")?;
        set_private_directory_permissions(&root.join("packs"))?;
        set_private_directory_permissions(&root.join("staging"))?;
        sync_directory(&root)?;

        let store = Self { root };
        store.initialize_catalog()?;
        upgrade_existing_format(&store.root)?;
        sync_directory(&store.root)?;
        remove_stale_staging(&store.root)?;
        store.recover_orphan_packs_inner()?;
        Ok(store)
    }

    /// Opens an existing store for automatic publication or creates a private
    /// first-publication store whose final path stays absent until commit.
    pub fn open_for_publication(root: impl AsRef<Path>) -> Result<PublicationStore> {
        Self::open_for_publication_checked(root.as_ref(), true)?.ok_or_else(|| {
            HistoryError::Corrupt("blocking checkpoint publication lock was not acquired".into())
        })
    }

    /// Tries to reserve one store for automatic publication without waiting.
    /// `None` means another process currently owns the publication lock.
    pub fn try_open_for_publication(root: impl AsRef<Path>) -> Result<Option<PublicationStore>> {
        Self::open_for_publication_checked(root.as_ref(), false)
    }

    fn open_for_publication_checked(
        requested_root: &Path,
        wait_for_initialization: bool,
    ) -> Result<Option<PublicationStore>> {
        let requested_parent = store_parent(requested_root)?;
        fs::create_dir_all(requested_parent)?;
        validate_real_directory(requested_parent, "checkpoint store parent")?;
        let parent = requested_parent.canonicalize()?;
        let name = store_name(requested_root)?;
        let target_root = parent.join(name);
        let Some(initialization_lock) =
            lock_initialization(&parent, name, wait_for_initialization)?
        else {
            return Ok(None);
        };
        reap_initialization_directories(&parent, name)?;

        if target_root.try_exists()? {
            let store = Self::open_existing(&target_root)?.ok_or_else(|| {
                HistoryError::Corrupt(format!(
                    "checkpoint store disappeared while it was opened: {}",
                    target_root.display()
                ))
            })?;
            return Ok(Some(PublicationStore {
                store: Some(store),
                target_root,
                initialization_dir: None,
                _initialization_lock: initialization_lock,
            }));
        }

        let initialization_dir = create_initialization_directory(&parent, name)?;
        let pending_root = initialization_dir.join("store");
        let store = match Self::open(&pending_root) {
            Ok(store) => store,
            Err(error) => {
                let _ = remove_path_without_following_links(&initialization_dir);
                let _ = sync_directory(&parent);
                return Err(error);
            }
        };
        Ok(Some(PublicationStore {
            store: Some(store),
            target_root,
            initialization_dir: Some(initialization_dir),
            _initialization_lock: initialization_lock,
        }))
    }

    /// Opens a previously created store without creating any path or file.
    /// This is the listing/UI entry point for lazy checkpoint creation.
    pub fn open_existing(root: impl AsRef<Path>) -> Result<Option<Self>> {
        let requested_root = root.as_ref();
        if !requested_root.try_exists()? {
            return Ok(None);
        }
        let requested_parent = store_parent(requested_root)?;
        validate_real_directory(requested_parent, "checkpoint store parent")?;
        let parent = requested_parent.canonicalize()?;
        let root = parent.join(store_name(requested_root)?);
        if !parent.join(NAMESPACE_LOCK_FILE).try_exists()? {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint store namespace is missing {NAMESPACE_LOCK_FILE}"
            )));
        }
        let namespace_lock = open_namespace_lock(&parent, false)?;
        fs4::FileExt::lock_shared(&namespace_lock)?;
        if !root.try_exists()? {
            return Ok(None);
        }
        if !root.join(OPERATION_LOCK_FILE).try_exists()? {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint store is missing {OPERATION_LOCK_FILE}"
            )));
        }
        let store = Self { root: root.clone() };
        let operation_lock = store.acquire_shared_operation_lock()?;
        validate_real_directory(&root, "checkpoint store root")?;
        validate_existing_format(&root)?;
        validate_regular_file(&root.join("catalog.sqlite3"), "checkpoint catalog")?;
        validate_real_directory(&root.join("packs"), "checkpoint packs directory")?;
        validate_real_directory(&root.join("staging"), "checkpoint staging directory")?;
        store.validate_catalog_version()?;
        upgrade_existing_format(&root)?;
        drop(operation_lock);
        drop(namespace_lock);
        Ok(Some(store))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn lock_exclusive(&self) -> Result<ExclusiveStoreGuard<'_>> {
        Ok(ExclusiveStoreGuard {
            store: self,
            _locks: self.acquire_exclusive_locks()?,
        })
    }

    /// Atomically detaches and removes one exact store while blocking all
    /// Store handles in this namespace. The namespace lock remains beside the
    /// stores so a later recreation cannot race on a replacement lock inode.
    pub fn destroy(root: impl AsRef<Path>) -> Result<bool> {
        Ok(Self::destroy_checked(root.as_ref(), false, true)?.unwrap_or(false))
    }

    /// Atomically removes a store only when it has no visible checkpoints.
    /// The emptiness check and detach share the namespace lock, so a cleanup
    /// attempt cannot race with publication in another process.
    pub fn destroy_if_empty(root: impl AsRef<Path>) -> Result<bool> {
        Ok(Self::destroy_checked(root.as_ref(), true, true)?.unwrap_or(false))
    }

    /// Tries to atomically remove an empty store without waiting on another
    /// process. `None` means the namespace is currently busy.
    pub fn try_destroy_if_empty(root: impl AsRef<Path>) -> Result<Option<bool>> {
        Self::destroy_checked(root.as_ref(), true, false)
    }

    fn destroy_checked(
        requested_root: &Path,
        only_if_empty: bool,
        wait_for_namespace: bool,
    ) -> Result<Option<bool>> {
        let requested_parent = store_parent(requested_root)?;
        if !requested_parent.try_exists()? {
            return Ok(Some(false));
        }
        validate_real_directory(requested_parent, "checkpoint store parent")?;
        let parent = requested_parent.canonicalize()?;
        let name = store_name(requested_root)?;
        let root = parent.join(name);
        let Some(_initialization_lock) = lock_initialization(&parent, name, wait_for_namespace)?
        else {
            return Ok(None);
        };
        let namespace_lock = open_namespace_lock(&parent, true)?;
        if wait_for_namespace {
            fs4::FileExt::lock(&namespace_lock)?;
        } else {
            match fs4::FileExt::try_lock(&namespace_lock) {
                Ok(()) => {}
                Err(fs4::TryLockError::WouldBlock) => return Ok(None),
                Err(fs4::TryLockError::Error(error)) => return Err(error.into()),
            }
        }
        let mut removed = if wait_for_namespace {
            reap_detached_stores(&parent, name, root.try_exists()?)?
        } else {
            false
        };
        if !root.try_exists()? {
            return Ok(Some(removed));
        }
        validate_real_directory(&root, "checkpoint store root")?;
        validate_regular_file(&root.join(OPERATION_LOCK_FILE), "checkpoint operation lock")?;
        validate_existing_format(&root)?;
        validate_regular_file(&root.join("catalog.sqlite3"), "checkpoint catalog")?;
        validate_real_directory(&root.join("packs"), "checkpoint packs directory")?;
        validate_real_directory(&root.join("staging"), "checkpoint staging directory")?;
        if only_if_empty {
            let store = Self { root: root.clone() };
            let connection = store.connection()?;
            let has_visible: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM checkpoints LIMIT 1)",
                [],
                |row| row.get(0),
            )?;
            drop(connection);
            if has_visible {
                return Ok(Some(false));
            }
        }
        let (record_path, record) = prepare_delete_record(&parent, name)?;
        let tombstone = detached_store_path(&parent, name, &record.token);
        if tombstone.try_exists()? {
            return Err(HistoryError::Corrupt(format!(
                "detached checkpoint store already exists {}",
                tombstone.display()
            )));
        }
        fs::rename(&root, &tombstone)?;
        sync_directory(&parent)?;
        remove_detached_store(&tombstone)?;
        sync_directory(&parent)?;
        remove_delete_record(&record_path)?;
        sync_directory(&parent)?;
        removed = true;
        Ok(Some(removed))
    }

    /// Seals only the explicit regular files in `inputs` into a private tree.
    /// No directory traversal or dependency discovery occurs here.
    pub fn stage_candidate(
        &self,
        project_root: impl AsRef<Path>,
        inputs: &[CaptureInput],
    ) -> Result<Candidate> {
        self.stage_candidate_controlled(project_root, inputs, &UncancelledPublication)
    }

    /// Seals a candidate while polling a caller-owned cancellation gate between
    /// files and bounded content chunks.
    pub fn stage_candidate_controlled(
        &self,
        project_root: impl AsRef<Path>,
        inputs: &[CaptureInput],
        gate: &dyn PublicationGate,
    ) -> Result<Candidate> {
        ensure_publication_active(gate)?;
        let store_locks = self.acquire_exclusive_locks()?;
        ensure_publication_active(gate)?;
        self.stage_candidate_locked_controlled(project_root.as_ref(), inputs, store_locks, gate)
    }

    fn stage_candidate_locked(
        &self,
        project_root: &Path,
        inputs: &[CaptureInput],
        store_locks: StoreLocks,
    ) -> Result<Candidate> {
        self.stage_candidate_locked_controlled(
            project_root,
            inputs,
            store_locks,
            &UncancelledPublication,
        )
    }

    fn stage_candidate_locked_controlled(
        &self,
        project_root: &Path,
        inputs: &[CaptureInput],
        store_locks: StoreLocks,
        gate: &dyn PublicationGate,
    ) -> Result<Candidate> {
        ensure_publication_active(gate)?;
        let canonical_project_root = project_root.canonicalize()?;
        if !canonical_project_root.is_dir() {
            return Err(HistoryError::InvalidInput(
                "project root must be a directory".into(),
            ));
        }

        let mut sorted_inputs = inputs.to_vec();
        sorted_inputs.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        validate_portable_path_set(
            sorted_inputs
                .iter()
                .map(|input| input.relative_path.as_str()),
        )?;
        if !sorted_inputs
            .iter()
            .any(|input| input.relative_path == "project.json")
        {
            return Err(HistoryError::MissingProjectManifest);
        }

        let staging_dir = create_candidate_directory(&self.root.join("staging"))?;
        let sealed_root = staging_dir.join("sealed");
        fs::create_dir(&sealed_root)?;
        set_private_directory_permissions(&sealed_root)?;
        let staged_pack = staging_dir.join("candidate.pack");

        let result = self.capture_candidate(
            &canonical_project_root,
            &sorted_inputs,
            &staging_dir,
            &sealed_root,
            &staged_pack,
            store_locks,
            gate,
        );
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging_dir);
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn capture_candidate(
        &self,
        canonical_project_root: &Path,
        inputs: &[CaptureInput],
        staging_dir: &Path,
        sealed_root: &Path,
        staged_pack: &Path,
        store_locks: StoreLocks,
        gate: &dyn PublicationGate,
    ) -> Result<Candidate> {
        ensure_publication_active(gate)?;
        let connection = self.connection()?;
        let mut pack = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(staged_pack)?;
        set_private_file_permissions(staged_pack)?;
        pack.write_all(PACK_MAGIC)?;

        let mut manifest_files = Vec::with_capacity(inputs.len());
        let mut proven_files = Vec::new();
        let mut staged_hashes = HashSet::new();
        let mut new_chunks = Vec::new();
        let mut candidate_logical_size = 0_u64;
        let mut candidate_chunk_references = 0_u64;

        if inputs.len() as u64 > MAX_HISTORY_CHUNK_REFERENCES {
            return Err(HistoryError::InvalidInput(
                "checkpoint file count exceeds the portable history limit".into(),
            ));
        }

        for input in inputs {
            ensure_publication_active(gate)?;
            let source = canonical_project_root.join(path_from_portable(&input.relative_path));
            validate_unsymlinked_regular_file(canonical_project_root, &input.relative_path)?;
            let mut source_options = OpenOptions::new();
            source_options.read(true);
            let source_file = open_with_no_follow(&mut source_options, &source)?;
            let mut source_handle = same_file::Handle::from_file(source_file)?;
            let current_handle = same_file::Handle::from_path(&source)?;
            if source_handle != current_handle {
                return Err(HistoryError::InvalidInput(format!(
                    "proven input {} changed identity while it was opened",
                    input.relative_path
                )));
            }
            let opened_metadata = source_handle.as_file().metadata()?;
            if !opened_metadata.is_file() || is_reparse_point(&opened_metadata) {
                return Err(HistoryError::InvalidInput(format!(
                    "proven input {} must be a regular file",
                    input.relative_path
                )));
            }
            let canonical_source = source.canonicalize()?;
            if !canonical_source.starts_with(canonical_project_root) {
                return Err(HistoryError::InvalidInput(format!(
                    "proven input {} resolves outside the project",
                    input.relative_path
                )));
            }
            if source_handle != same_file::Handle::from_path(&source)? {
                return Err(HistoryError::InvalidInput(format!(
                    "proven input {} changed identity while it was resolved",
                    input.relative_path
                )));
            }
            let expected_resolved_path = match &input.basis {
                CaptureBasis::CompilerRead { resolved_path, .. }
                | CaptureBasis::ReplayRequired { resolved_path, .. } => Some(resolved_path),
                CaptureBasis::Explicit => None,
            };
            if let Some(resolved_path) = expected_resolved_path {
                if &canonical_source != resolved_path {
                    return Err(HistoryError::InvalidInput(format!(
                        "replay input {} resolved as {}, expected {}",
                        input.relative_path,
                        canonical_source.display(),
                        resolved_path.display()
                    )));
                }
            }

            let destination = sealed_root.join(path_from_portable(&input.relative_path));
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut destination_file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&destination)?;
            set_private_file_permissions(&destination)?;

            let mut content_hasher = blake3::Hasher::new();
            let mut logical_size = 0_u64;
            let mut chunks = Vec::new();
            let mut source_reader = BufReader::new(source_handle.as_file_mut());
            if input.stored {
                for chunk in StreamCDC::new(
                    &mut source_reader,
                    MIN_CHUNK_SIZE,
                    AVG_CHUNK_SIZE,
                    MAX_CHUNK_SIZE,
                ) {
                    let chunk = chunk.map_err(io::Error::from)?;
                    ensure_publication_active(gate)?;
                    let (next_file_size, next_candidate_size, next_chunk_references) =
                        advance_capture_budget(
                            logical_size,
                            candidate_logical_size,
                            candidate_chunk_references,
                            chunk.length as u64,
                        )?;
                    destination_file.write_all(&chunk.data)?;
                    content_hasher.update(&chunk.data);
                    logical_size = next_file_size;
                    candidate_logical_size = next_candidate_size;
                    candidate_chunk_references = next_chunk_references;

                    let chunk_hash = ContentHash::digest(&chunk.data);
                    let chunk_hash_hex = chunk_hash.to_hex();
                    chunks.push(ManifestChunk {
                        hash: chunk_hash_hex.clone(),
                        raw_len: chunk.length as u64,
                    });

                    let already_published = connection
                        .query_row(
                            "SELECT 1 FROM chunks WHERE chunk_hash = ?1",
                            [&chunk_hash_hex],
                            |_| Ok(()),
                        )
                        .optional()?
                        .is_some();
                    if !already_published && staged_hashes.insert(chunk_hash_hex.clone()) {
                        new_chunks.push(write_pack_chunk(&mut pack, chunk_hash, &chunk.data)?);
                    }
                    ensure_publication_active(gate)?;
                }
            } else {
                let mut buffer = vec![0_u8; 64 * 1024];
                loop {
                    ensure_publication_active(gate)?;
                    let count = source_reader.read(&mut buffer)?;
                    if count == 0 {
                        break;
                    }
                    let (next_file_size, next_candidate_size) = advance_unstored_capture_budget(
                        logical_size,
                        candidate_logical_size,
                        count as u64,
                    )?;
                    destination_file.write_all(&buffer[..count])?;
                    content_hasher.update(&buffer[..count]);
                    logical_size = next_file_size;
                    candidate_logical_size = next_candidate_size;
                }
            }
            drop(source_reader);
            ensure_publication_active(gate)?;

            if source_handle != same_file::Handle::from_path(&source)? {
                return Err(HistoryError::InvalidInput(format!(
                    "proven input {} changed identity while it was being sealed",
                    input.relative_path
                )));
            }

            let captured_metadata = source_handle.as_file().metadata()?;
            if captured_metadata.len() != opened_metadata.len() {
                return Err(HistoryError::InvalidInput(format!(
                    "proven input {} changed while it was being sealed",
                    input.relative_path
                )));
            }

            let content_hash = ContentHash::from_bytes(*content_hasher.finalize().as_bytes());
            let expected_hash = match &input.basis {
                CaptureBasis::CompilerRead {
                    first_read_hash, ..
                } => Some((*first_read_hash, "changed after the compiler first read it")),
                CaptureBasis::ReplayRequired { preseal_hash, .. } => {
                    Some((*preseal_hash, "changed before it was sealed for replay"))
                }
                CaptureBasis::Explicit => None,
            };
            if let Some((expected_hash, changed_message)) = expected_hash {
                if content_hash != expected_hash {
                    return Err(HistoryError::InvalidInput(format!(
                        "replay input {} {changed_message}",
                        input.relative_path
                    )));
                }
                proven_files.push(SealedFile {
                    relative_path: input.relative_path.clone(),
                    logical_bytes: logical_size,
                    content_hash,
                    chunk_count: chunks.len() as u64,
                });
            }

            manifest_files.push(ManifestFile {
                path: input.relative_path.clone(),
                logical_size,
                content_hash: content_hash.to_hex(),
                stored: input.stored,
                chunks,
            });
        }

        ensure_publication_active(gate)?;
        pack.sync_all()?;
        ensure_publication_active(gate)?;
        sync_directory(staging_dir)?;
        let pack_len = pack.metadata()?.len();
        drop(pack);
        let pack_id = hash_file_controlled(staged_pack, gate)?;
        let manifest = Manifest {
            format_version: FORMAT_VERSION,
            files: manifest_files,
        };
        let snapshot_root = compute_snapshot_root(&manifest)?;
        let manifest_json = serde_json::to_vec(&manifest)?;

        Ok(Candidate {
            store_root: self.root.clone(),
            staging_dir: staging_dir.to_path_buf(),
            sealed_root: sealed_root.to_path_buf(),
            staged_pack: staged_pack.to_path_buf(),
            pack_id,
            pack_len,
            snapshot_root,
            manifest,
            manifest_json,
            proven_files,
            new_chunks,
            _store_locks: store_locks,
            cleaned: false,
        })
    }

    /// Publishes a candidate root last, after its immutable pack is durable.
    pub fn publish(
        &self,
        candidate: Candidate,
        evidence: CompileEvidence,
    ) -> Result<PublishOutcome> {
        self.publish_inner(candidate, evidence, PublishFault::None)
    }

    /// Publishes through a cancellation gate whose commit callback is the
    /// single cutoff between cancellation and a visible checkpoint root.
    pub fn publish_controlled(
        &self,
        candidate: Candidate,
        evidence: CompileEvidence,
        gate: &dyn PublicationGate,
    ) -> Result<PublishOutcome> {
        self.publish_inner_controlled(candidate, evidence, PublishFault::None, gate)
    }

    fn publish_inner(
        &self,
        candidate: Candidate,
        evidence: CompileEvidence,
        fault: PublishFault,
    ) -> Result<PublishOutcome> {
        self.publish_inner_controlled(candidate, evidence, fault, &UncancelledPublication)
    }

    fn publish_inner_controlled(
        &self,
        mut candidate: Candidate,
        evidence: CompileEvidence,
        fault: PublishFault,
        gate: &dyn PublicationGate,
    ) -> Result<PublishOutcome> {
        if candidate.store_root != self.root {
            return Err(HistoryError::InvalidInput(
                "candidate belongs to a different checkpoint store".into(),
            ));
        }
        ensure_publication_active(gate)?;
        verify_candidate_sealed_tree_controlled(&candidate, gate)?;
        ensure_publication_active(gate)?;
        validate_compile_evidence(&candidate, &evidence)?;

        let root_hex = candidate.snapshot_root.as_hex();
        let mut connection = self.connection()?;
        if let Some(existing) = query_checkpoint(&connection, &root_hex)? {
            let _ = candidate.cleanup();
            return Ok(PublishOutcome::Existing(existing));
        }

        let logical_bytes = candidate
            .manifest
            .files
            .iter()
            .try_fold(0_u64, |total, file| {
                total
                    .checked_add(file.logical_size)
                    .ok_or_else(|| HistoryError::InvalidInput("snapshot length overflow".into()))
            })?;
        let unstored = manifest_unstored_totals(&candidate.manifest)?;
        let mut checkpoint = Checkpoint {
            snapshot_root: candidate.snapshot_root,
            completed_at_unix_ms: evidence.completed_at_unix_ms,
            engine: evidence.engine,
            toolchain_identity: evidence.toolchain_identity,
            main_document: evidence.main_document,
            output_hash: evidence.output_hash,
            file_count: candidate.manifest.files.len() as u64,
            logical_bytes,
            label: None,
            replayed_inputs: evidence.replayed_inputs,
            portable_metadata_bytes: 0,
            chunk_references: 0,
            unstored_file_count: unstored.file_count,
            unstored_logical_bytes: unstored.logical_bytes,
        };

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let (_, candidate_budget) = validate_portable_history_after_publication(
            &transaction,
            &checkpoint,
            &candidate.manifest,
        )?;
        checkpoint.portable_metadata_bytes = candidate_budget.metadata_bytes;
        checkpoint.chunk_references = candidate_budget.chunk_references;

        let mut published_pack_path = None;
        if !candidate.new_chunks.is_empty() {
            let pack_id = candidate.pack_id.to_hex();
            let file_name = format!("{pack_id}.pack");
            let destination = self.root.join("packs").join(&file_name);
            if destination.exists() {
                if hash_file_controlled(&destination, gate)? != candidate.pack_id {
                    return Err(HistoryError::Corrupt(format!(
                        "immutable pack collision for {pack_id}"
                    )));
                }
                fs::remove_file(&candidate.staged_pack)?;
            } else {
                fs::rename(&candidate.staged_pack, &destination)?;
                set_private_file_permissions(&destination)?;
                sync_directory(&self.root.join("packs"))?;
            }
            published_pack_path = Some(destination);
            if fault == PublishFault::AfterPackPublished {
                return Err(HistoryError::Io(io::Error::other(
                    "injected failure after pack publication",
                )));
            }

            transaction.execute(
                "INSERT OR IGNORE INTO packs(pack_id, file_name, encoded_size) VALUES (?1, ?2, ?3)",
                params![pack_id, file_name, candidate.pack_len as i64],
            )?;
            for chunk in &candidate.new_chunks {
                transaction.execute(
                    "INSERT OR IGNORE INTO chunks(
                        chunk_hash, pack_id, payload_offset, stored_len, raw_len, encoding
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        chunk.hash.to_hex(),
                        pack_id,
                        chunk.payload_offset as i64,
                        chunk.stored_len as i64,
                        chunk.raw_len as i64,
                        chunk.encoding.as_i64(),
                    ],
                )?;
            }
        }

        let existing_manifest = transaction
            .query_row(
                "SELECT manifest_json FROM manifests WHERE snapshot_root = ?1",
                [&root_hex],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()?;
        if let Some(existing_manifest) = existing_manifest {
            if existing_manifest != candidate.manifest_json {
                return Err(HistoryError::Corrupt(format!(
                    "snapshot root {root_hex} has conflicting manifest bytes"
                )));
            }
        } else {
            transaction.execute(
                "INSERT INTO manifests(snapshot_root, manifest_json) VALUES (?1, ?2)",
                params![root_hex, &candidate.manifest_json],
            )?;
        }
        for file in &candidate.manifest.files {
            for chunk in &file.chunks {
                transaction.execute(
                    "INSERT OR IGNORE INTO manifest_chunks(snapshot_root, chunk_hash)
                     VALUES (?1, ?2)",
                    params![root_hex, chunk.hash],
                )?;
            }
        }

        if fault == PublishFault::BeforeVisibleRoot {
            return Err(HistoryError::Io(io::Error::other(
                "injected failure before visible root",
            )));
        }

        // The visible root is intentionally the final catalog mutation.
        insert_checkpoint(&transaction, &checkpoint)?;

        if fault == PublishFault::BeforeCommit {
            return Err(HistoryError::Io(io::Error::other(
                "injected failure before catalog commit",
            )));
        }

        let mut transaction = Some(transaction);
        let mut commit = || {
            transaction
                .take()
                .expect("checkpoint transaction is committed at most once")
                .commit()
                .map_err(HistoryError::from)
        };
        if !gate.commit_visibility(&mut commit)? {
            return Err(HistoryError::PublicationCancelled);
        }
        // Visibility is committed. Cleanup must not turn success into an error
        // that a caller could mistake for a safe retry or rollback point.
        let _ = candidate.cleanup();

        // Keep the variable alive until the transaction is committed. On an
        // injected failure, the immutable file is an unreachable orphan that
        // recovery can remove without exposing a checkpoint.
        drop(published_pack_path);
        Ok(PublishOutcome::Created(checkpoint))
    }

    pub fn checkpoint(&self, root: &SnapshotRoot) -> Result<Option<Checkpoint>> {
        let _store_locks = self.acquire_shared_locks()?;
        self.checkpoint_inner(root)
    }

    fn checkpoint_inner(&self, root: &SnapshotRoot) -> Result<Option<Checkpoint>> {
        let connection = self.connection()?;
        query_checkpoint(&connection, &root.as_hex())
    }

    pub fn latest_checkpoint(&self) -> Result<Option<Checkpoint>> {
        let _store_locks = self.acquire_shared_locks()?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                        main_document, output_hash, file_count, logical_bytes,
                        replayed_inputs_json,
                        length(CAST(snapshot_root AS BLOB))
                          + length(CAST(engine AS BLOB))
                          + length(CAST(toolchain_identity AS BLOB))
                          + length(CAST(main_document AS BLOB))
                          + length(CAST(output_hash AS BLOB))
                          + length(CAST(replayed_inputs_json AS BLOB)),
                 portable_metadata_bytes, chunk_references,
                 unstored_file_count, unstored_logical_bytes, label
                 FROM checkpoints
                 ORDER BY sequence DESC
                 LIMIT 1",
                [],
                checkpoint_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn checkpoint_files(&self, root: &SnapshotRoot) -> Result<Option<Vec<CheckpointFile>>> {
        let _store_locks = self.acquire_shared_locks()?;
        let connection = self.connection()?;
        if query_checkpoint(&connection, &root.as_hex())?.is_none() {
            return Ok(None);
        }
        let manifest = load_visible_manifest(&connection, root)?;
        verify_manifest_root(root, &manifest)?;
        let mut files = Vec::with_capacity(manifest.files.len());
        for file in &manifest.files {
            files.push(CheckpointFile {
                relative_path: file.path.clone(),
                logical_bytes: file.logical_size,
                content_hash: ContentHash::from_hex(&file.content_hash)?,
                stored: file.stored,
                chunk_count: file.chunks.len() as u64,
            });
        }
        Ok(Some(files))
    }

    pub fn inspect(&self) -> Result<StoreInspection> {
        let _store_locks = self.acquire_shared_locks()?;
        let catalog_path = self.root.join("catalog.sqlite3");
        validate_regular_file(&catalog_path, "checkpoint catalog")?;
        let catalog_bytes = fs::symlink_metadata(&catalog_path)?.len();
        let connection = self.connection()?;
        let format_version: u32 =
            connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let lineage = self.lineage_with_connection(&connection)?;
        let mut packs = Vec::new();
        {
            let mut statement = connection.prepare(
                "SELECT p.file_name, p.encoded_size,
                        (SELECT COUNT(*) FROM chunks c WHERE c.pack_id = p.pack_id)
                 FROM packs p
                 ORDER BY p.file_name ASC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(PackInspection {
                    file_name: row.get::<_, String>(0)?,
                    encoded_bytes: row.get::<_, i64>(1)?.max(0) as u64,
                    chunk_count: row.get::<_, i64>(2)?.max(0) as u64,
                })
            })?;
            for pack in rows {
                packs.push(pack?);
            }
        }
        Ok(StoreInspection {
            root: self.root.clone(),
            catalog_path,
            catalog_bytes,
            format_version,
            lineage,
            checkpoint_count: query_count(&connection, "checkpoints")?,
            manifest_count: query_count(&connection, "manifests")?,
            pack_count: query_count(&connection, "packs")?,
            chunk_count: query_count(&connection, "chunks")?,
            manifest_chunk_count: query_count(&connection, "manifest_chunks")?,
            packs,
        })
    }

    /// Lists visible checkpoints newest first. Candidates are never listed.
    pub fn list(&self) -> Result<Vec<Checkpoint>> {
        let _store_locks = self.acquire_shared_locks()?;
        self.list_inner()
    }

    fn list_inner(&self) -> Result<Vec<Checkpoint>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json,
                    length(CAST(snapshot_root AS BLOB))
                      + length(CAST(engine AS BLOB))
                      + length(CAST(toolchain_identity AS BLOB))
                      + length(CAST(main_document AS BLOB))
                      + length(CAST(output_hash AS BLOB))
                      + length(CAST(replayed_inputs_json AS BLOB)),
             portable_metadata_bytes, chunk_references,
             unstored_file_count, unstored_logical_bytes, label
             FROM checkpoints
             ORDER BY sequence DESC",
        )?;
        let rows = statement.query_map([], checkpoint_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn stats(&self) -> Result<StoreStats> {
        let _store_locks = self.acquire_shared_locks()?;
        let connection = self.connection()?;
        let chunk_stats = connection.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN encoding = 1 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN encoding = 0 THEN 1 ELSE 0 END), 0),
                COALESCE(MAX(raw_len), 0),
                COALESCE(SUM(raw_len), 0),
                COALESCE(SUM(stored_len), 0)
             FROM chunks",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, i64>(2)? as u64,
                    row.get::<_, i64>(3)? as u64,
                    row.get::<_, i64>(4)? as u64,
                ))
            },
        )?;
        let checkpoint_totals = connection.query_row(
            "SELECT
                COALESCE(SUM(logical_bytes), 0),
                COALESCE(SUM(unstored_file_count), 0),
                COALESCE(SUM(unstored_logical_bytes), 0)
             FROM checkpoints",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, i64>(2)? as u64,
                ))
            },
        )?;
        Ok(StoreStats {
            checkpoint_count: query_count(&connection, "checkpoints")?,
            manifest_count: query_count(&connection, "manifests")?,
            pack_count: query_count(&connection, "packs")?,
            chunk_count: query_count(&connection, "chunks")?,
            stored_pack_bytes: connection.query_row(
                "SELECT COALESCE(SUM(encoded_size), 0) FROM packs",
                [],
                |row| row.get::<_, i64>(0),
            )? as u64,
            compressed_chunk_count: chunk_stats.0,
            raw_chunk_count: chunk_stats.1,
            max_raw_chunk_bytes: chunk_stats.2,
            logical_chunk_bytes: chunk_stats.3,
            stored_chunk_bytes: chunk_stats.4,
            visible_logical_bytes: checkpoint_totals.0,
            unstored_file_count: checkpoint_totals.1,
            unstored_logical_bytes: checkpoint_totals.2,
            reclaimable_pack_bytes: connection.query_row(
                "SELECT COALESCE(SUM(p.encoded_size), 0)
                 FROM packs p
                 WHERE NOT EXISTS (
                    SELECT 1
                    FROM chunks c
                    JOIN manifest_chunks mc ON mc.chunk_hash = c.chunk_hash
                    JOIN checkpoints cp ON cp.snapshot_root = mc.snapshot_root
                    WHERE c.pack_id = p.pack_id
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )? as u64,
        })
    }

    pub fn set_checkpoint_label(&self, root: &SnapshotRoot, label: &str) -> Result<Checkpoint> {
        let label = validate_checkpoint_label(label)?;
        let _store_locks = self.acquire_exclusive_locks()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut checkpoint = query_checkpoint(&transaction, &root.as_hex())?
            .ok_or_else(|| HistoryError::CheckpointNotFound(root.as_hex()))?;
        checkpoint.label = label;
        let manifest = load_visible_manifest(&transaction, root)?;
        let (_, budget) =
            validate_portable_history_after_publication(&transaction, &checkpoint, &manifest)?;
        checkpoint.portable_metadata_bytes = budget.metadata_bytes;
        transaction.execute(
            "UPDATE checkpoints
             SET label = ?2, portable_metadata_bytes = ?3
             WHERE snapshot_root = ?1",
            params![
                root.as_hex(),
                checkpoint.label.as_deref(),
                checkpoint.portable_metadata_bytes as i64,
            ],
        )?;
        transaction.commit()?;
        Ok(checkpoint)
    }

    /// Removes a selected visible root. Payload reclamation is deliberately a
    /// separate operation so a crash cannot make a retained root unreadable.
    pub fn delete_checkpoint(&self, root: &SnapshotRoot) -> Result<bool> {
        let _store_locks = self.acquire_exclusive_locks()?;
        let connection = self.connection()?;
        Ok(connection.execute(
            "DELETE FROM checkpoints WHERE snapshot_root = ?1",
            [root.as_hex()],
        )? > 0)
    }

    /// Retains only the newest visible checkpoint.
    pub fn keep_latest(&self) -> Result<u64> {
        let _store_locks = self.acquire_exclusive_locks()?;
        let connection = self.connection()?;
        Ok(connection.execute(
            "DELETE FROM checkpoints
             WHERE snapshot_root <> (
                 SELECT snapshot_root FROM checkpoints
                 ORDER BY sequence DESC
                 LIMIT 1
             )",
            [],
        )? as u64)
    }

    /// Removes all visible roots without touching project files.
    pub fn reset(&self) -> Result<u64> {
        let _store_locks = self.acquire_exclusive_locks()?;
        let connection = self.connection()?;
        Ok(connection.execute("DELETE FROM checkpoints", [])? as u64)
    }

    /// Reclaims only packs that contain no chunk reachable from a retained
    /// root. Mixed packs remain intact until a future restartable compactor.
    pub fn garbage_collect(&self) -> Result<GarbageCollection> {
        let _store_locks = self.acquire_exclusive_locks()?;
        remove_stale_staging(&self.root)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let deleted_manifests = transaction.execute(
            "DELETE FROM manifests
             WHERE snapshot_root NOT IN (SELECT snapshot_root FROM checkpoints)",
            [],
        )? as u64;

        let mut packs_to_delete = Vec::new();
        {
            let mut statement = transaction.prepare(
                "SELECT p.pack_id, p.file_name, p.encoded_size
                 FROM packs p
                 WHERE NOT EXISTS (
                    SELECT 1
                    FROM chunks c
                    JOIN manifest_chunks mc ON mc.chunk_hash = c.chunk_hash
                    WHERE c.pack_id = p.pack_id
                 )",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? as u64,
                ))
            })?;
            for row in rows {
                let (pack_id, file_name, encoded_size) = row?;
                let file_name = validated_pack_file_name(&pack_id, &file_name)?;
                packs_to_delete.push((pack_id, file_name, encoded_size));
            }
        }

        let mut deleted_chunks = 0_u64;
        for (pack_id, _, _) in &packs_to_delete {
            deleted_chunks +=
                transaction.execute("DELETE FROM chunks WHERE pack_id = ?1", [pack_id])? as u64;
            transaction.execute("DELETE FROM packs WHERE pack_id = ?1", [pack_id])?;
        }
        transaction.commit()?;

        let mut reclaimed_bytes = 0_u64;
        for (_, file_name, encoded_size) in &packs_to_delete {
            let path = self.root.join("packs").join(file_name);
            match fs::remove_file(&path) {
                Ok(()) => reclaimed_bytes += *encoded_size,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    reclaimed_bytes += *encoded_size;
                }
                Err(error) => return Err(error.into()),
            }
        }
        self.recover_orphan_packs_inner()?;

        Ok(GarbageCollection {
            deleted_manifests,
            deleted_chunks,
            deleted_packs: packs_to_delete.len() as u64,
            reclaimed_bytes,
        })
    }

    /// Materializes one retained checkpoint into a newly created directory.
    /// Every chunk, file, and the manifest root are rehashed before success.
    pub fn materialize(
        &self,
        root: &SnapshotRoot,
        destination: impl AsRef<Path>,
    ) -> Result<Materialization> {
        let _store_locks = self.acquire_shared_locks()?;
        self.materialize_unlocked(root, destination.as_ref())
    }

    fn materialize_unlocked(
        &self,
        root: &SnapshotRoot,
        destination: &Path,
    ) -> Result<Materialization> {
        fs::create_dir(destination)?;
        set_private_directory_permissions(destination)?;
        let result = self.materialize_inner(root, destination);
        if result.is_err() {
            let _ = fs::remove_dir_all(destination);
        }
        result
    }

    fn materialize_inner(
        &self,
        root: &SnapshotRoot,
        destination: &Path,
    ) -> Result<Materialization> {
        let connection = self.connection()?;
        let manifest = load_visible_manifest(&connection, root)?;
        verify_manifest_root(root, &manifest)?;

        let mut logical_bytes = 0_u64;
        let mut file_count = 0_u64;
        let mut omitted = Vec::new();
        for manifest_file in &manifest.files {
            validate_portable_relative_path(&manifest_file.path)?;
            if !manifest_file.stored {
                omitted.push(manifest_file.path.clone());
                continue;
            }
            let output = destination.join(path_from_portable(&manifest_file.path));
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output_file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&output)?;
            set_private_file_permissions(&output)?;
            let mut file_hasher = blake3::Hasher::new();
            let mut file_bytes = 0_u64;
            for manifest_chunk in &manifest_file.chunks {
                let raw = self.read_verified_chunk(&connection, manifest_chunk)?;
                output_file.write_all(&raw)?;
                file_hasher.update(&raw);
                file_bytes = file_bytes
                    .checked_add(raw.len() as u64)
                    .ok_or_else(|| HistoryError::Corrupt("file length overflow".into()))?;
            }
            output_file.sync_all()?;
            verify_file_digest(manifest_file, file_bytes, &file_hasher)?;
            logical_bytes = logical_bytes
                .checked_add(file_bytes)
                .ok_or_else(|| HistoryError::Corrupt("snapshot length overflow".into()))?;
            file_count += 1;
        }
        sync_materialized_directory_tree(destination)?;
        Ok(Materialization {
            file_count,
            logical_bytes,
            omitted,
        })
    }

    /// Verifies all retained roots and all indexed immutable packs.
    pub fn verify(&self) -> Result<Verification> {
        let _store_locks = self.acquire_shared_locks()?;
        validate_existing_format(&self.root)?;
        let connection = self.connection()?;
        let mut verification = Verification::default();

        {
            let mut statement = connection.prepare("SELECT pack_id, file_name FROM packs")?;
            let packs = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for pack in packs {
                let (pack_id, file_name) = pack?;
                let expected = ContentHash::from_hex(&pack_id)?;
                let file_name = validated_pack_file_name(&pack_id, &file_name)?;
                let path = self.root.join("packs").join(file_name);
                if hash_file(&path)? != expected {
                    return Err(HistoryError::Corrupt(format!(
                        "immutable pack {pack_id} failed BLAKE3 verification"
                    )));
                }
                verification.checked_packs += 1;
            }
        }

        let roots = self.list_inner()?;
        for checkpoint in roots {
            let manifest = load_visible_manifest(&connection, &checkpoint.snapshot_root)?;
            verify_manifest_root(&checkpoint.snapshot_root, &manifest)?;
            let evidence = CompileEvidence {
                engine: checkpoint.engine.clone(),
                toolchain_identity: checkpoint.toolchain_identity.clone(),
                main_document: checkpoint.main_document.clone(),
                output_hash: checkpoint.output_hash,
                completed_at_unix_ms: checkpoint.completed_at_unix_ms,
                replayed_inputs: checkpoint.replayed_inputs.clone(),
            };
            validate_archived_evidence(&manifest, &evidence)?;
            let mut logical_bytes = 0_u64;
            for manifest_file in &manifest.files {
                let file_bytes = if manifest_file.stored {
                    let mut file_hasher = blake3::Hasher::new();
                    let mut file_bytes = 0_u64;
                    for manifest_chunk in &manifest_file.chunks {
                        let raw = self.read_verified_chunk(&connection, manifest_chunk)?;
                        file_hasher.update(&raw);
                        file_bytes = file_bytes
                            .checked_add(raw.len() as u64)
                            .ok_or_else(|| HistoryError::Corrupt("file length overflow".into()))?;
                        verification.checked_chunk_references += 1;
                    }
                    verify_file_digest(manifest_file, file_bytes, &file_hasher)?;
                    file_bytes
                } else {
                    manifest_file.logical_size
                };
                logical_bytes = logical_bytes
                    .checked_add(file_bytes)
                    .ok_or_else(|| HistoryError::Corrupt("snapshot length overflow".into()))?;
                verification.checked_files += 1;
            }
            let unstored = manifest_unstored_totals(&manifest)?;
            if checkpoint.file_count != manifest.files.len() as u64
                || checkpoint.logical_bytes != logical_bytes
                || checkpoint.unstored_file_count != unstored.file_count
                || checkpoint.unstored_logical_bytes != unstored.logical_bytes
            {
                return Err(HistoryError::Corrupt(format!(
                    "checkpoint {} summary does not match its manifest",
                    checkpoint.snapshot_root
                )));
            }
            verification.checked_checkpoints += 1;
        }
        Ok(verification)
    }

    fn read_verified_chunk(
        &self,
        connection: &Connection,
        manifest_chunk: &ManifestChunk,
    ) -> Result<Vec<u8>> {
        let row = connection
            .query_row(
                "SELECT p.pack_id, p.file_name, c.payload_offset, c.stored_len, c.raw_len, c.encoding
                 FROM chunks c JOIN packs p ON p.pack_id = c.pack_id
                 WHERE c.chunk_hash = ?1",
                [&manifest_chunk.hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                HistoryError::Corrupt(format!(
                    "manifest references missing chunk {}",
                    manifest_chunk.hash
                ))
            })?;
        let (pack_id, file_name, payload_offset, stored_len, raw_len, encoding) = row;
        let file_name = validated_pack_file_name(&pack_id, &file_name)?;
        if payload_offset < PACK_MAGIC.len() as i64
            || stored_len <= 0
            || raw_len <= 0
            || raw_len > MAX_CHUNK_SIZE as i64
            || stored_len > raw_len
            || manifest_chunk.raw_len != raw_len as u64
        {
            return Err(HistoryError::Corrupt(format!(
                "chunk {} has invalid size metadata",
                manifest_chunk.hash
            )));
        }

        let pack_path = self.root.join("packs").join(file_name);
        validate_regular_file(&pack_path, "checkpoint pack")?;
        let mut options = OpenOptions::new();
        options.read(true);
        let mut pack = open_with_no_follow(&mut options, &pack_path)?;
        let end = (payload_offset as u64)
            .checked_add(stored_len as u64)
            .ok_or_else(|| HistoryError::Corrupt("chunk offset overflow".into()))?;
        if end > pack.metadata()?.len() {
            return Err(HistoryError::Corrupt(format!(
                "chunk {} extends beyond its immutable pack",
                manifest_chunk.hash
            )));
        }
        pack.seek(io::SeekFrom::Start(payload_offset as u64))?;
        let mut stored = vec![0_u8; stored_len as usize];
        pack.read_exact(&mut stored)?;

        let raw = match encoding {
            0 => stored,
            1 => {
                let decoder = zstd::stream::read::Decoder::new(stored.as_slice())?;
                let mut bounded = decoder.take(raw_len as u64 + 1);
                let mut decoded = Vec::with_capacity(raw_len as usize);
                bounded.read_to_end(&mut decoded)?;
                decoded
            }
            _ => {
                return Err(HistoryError::Corrupt(format!(
                    "chunk {} has unknown encoding {encoding}",
                    manifest_chunk.hash
                )))
            }
        };
        if raw.len() != raw_len as usize {
            return Err(HistoryError::Corrupt(format!(
                "chunk {} decoded to the wrong length",
                manifest_chunk.hash
            )));
        }
        if ContentHash::digest(&raw).to_hex() != manifest_chunk.hash {
            return Err(HistoryError::Corrupt(format!(
                "chunk {} failed BLAKE3 verification",
                manifest_chunk.hash
            )));
        }
        Ok(raw)
    }

    /// Writes a self-contained, verified logical checkpoint stream. The
    /// stream is not encrypted; callers must wrap it in their authenticated
    /// user-selected encryption envelope before storing it as a backup.
    pub fn export_checkpoint<W: Write>(
        &self,
        root: &SnapshotRoot,
        mut writer: W,
    ) -> Result<ExportSummary> {
        let _store_locks = self.acquire_shared_locks()?;
        let checkpoint = self
            .checkpoint_inner(root)?
            .ok_or_else(|| HistoryError::CheckpointNotFound(root.as_hex()))?;
        let connection = self.connection()?;
        let record =
            self.write_portable_checkpoint_record(&connection, &checkpoint, &mut writer)?;
        writer.flush()?;
        Ok(record.export)
    }

    /// Imports one logical checkpoint stream invisibly, then publishes its
    /// root in the normal root-last transaction. Existing roots and chunks
    /// are deduplicated by their BLAKE3 identities.
    pub fn import_checkpoint<R: Read>(&self, mut reader: R) -> Result<PublishOutcome> {
        let store_locks = self.acquire_exclusive_locks()?;
        remove_stale_staging(&self.root)?;
        let mut magic = vec![0_u8; EXPORT_MAGIC.len()];
        reader.read_exact(&mut magic)?;
        if magic != EXPORT_MAGIC {
            return Err(HistoryError::InvalidInput(
                "not an Oleafly portable checkpoint stream".into(),
            ));
        }
        let mut length = [0_u8; 8];
        reader.read_exact(&mut length)?;
        let header_len = u64::from_le_bytes(length);
        if header_len == 0 || header_len > MAX_EXPORT_HEADER_BYTES {
            return Err(HistoryError::InvalidInput(format!(
                "portable checkpoint header length {header_len} is invalid"
            )));
        }
        let mut header = vec![0_u8; header_len as usize];
        reader.read_exact(&mut header)?;
        let metadata: PortableCheckpoint = serde_json::from_slice(&header)?;
        if metadata.export_version != 1 {
            return Err(HistoryError::UnsupportedFormat(metadata.export_version));
        }
        let expected_root = SnapshotRoot::parse(&metadata.snapshot_root)?;
        verify_archive_manifest(&metadata.manifest)?;
        verify_manifest_root(&expected_root, &metadata.manifest)?;
        if let Some(unstored) = metadata.manifest.files.iter().find(|file| !file.stored) {
            return Err(HistoryError::InvalidInput(format!(
                "portable checkpoint records {} without its bytes",
                unstored.path
            )));
        }
        let label = validate_portable_label(metadata.label.as_deref())?;
        let output_hash = ContentHash::from_hex(&metadata.output_hash)?;
        let evidence = CompileEvidence::new(
            metadata.engine,
            metadata.toolchain_identity,
            metadata.main_document,
            output_hash,
            metadata.completed_at_unix_ms,
            decode_portable_replayed_inputs(metadata.replayed_inputs.clone())?,
        )?;

        let import_dir = create_candidate_directory(&self.root.join("staging"))?;
        let mut guard = StagingGuard::new(import_dir.clone());
        let source_root = import_dir.join("portable-source");
        fs::create_dir(&source_root)?;
        set_private_directory_permissions(&source_root)?;
        let mut inputs = Vec::with_capacity(metadata.manifest.files.len());
        let mut buffer = vec![0_u8; 64 * 1024];

        for manifest_file in &metadata.manifest.files {
            let path = source_root.join(path_from_portable(&manifest_file.path));
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)?;
            set_private_file_permissions(&path)?;
            let mut remaining = manifest_file.logical_size;
            let mut hasher = blake3::Hasher::new();
            while remaining > 0 {
                let wanted = remaining.min(buffer.len() as u64) as usize;
                let count = reader.read(&mut buffer[..wanted])?;
                if count == 0 {
                    return Err(HistoryError::Io(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "portable checkpoint ended inside a file",
                    )));
                }
                output.write_all(&buffer[..count])?;
                hasher.update(&buffer[..count]);
                remaining -= count as u64;
            }
            verify_file_digest(manifest_file, manifest_file.logical_size, &hasher)?;

            let input = if evidence
                .replayed_inputs
                .iter()
                .any(|replayed| replayed.relative_path == manifest_file.path)
            {
                CaptureInput::proven(
                    manifest_file.path.clone(),
                    path.canonicalize()?,
                    ContentHash::from_hex(&manifest_file.content_hash)?,
                )?
            } else {
                CaptureInput::explicit(manifest_file.path.clone())?
            };
            inputs.push(input);
        }
        let mut trailing = [0_u8; 1];
        if reader.read(&mut trailing)? != 0 {
            return Err(HistoryError::InvalidInput(
                "portable checkpoint contains trailing data".into(),
            ));
        }
        sync_directory(&source_root)?;

        let candidate = self.stage_candidate_locked(&source_root, &inputs, store_locks)?;
        if candidate.snapshot_root() != &expected_root {
            return Err(HistoryError::Corrupt(format!(
                "portable checkpoint restaged as {}, expected {expected_root}",
                candidate.snapshot_root()
            )));
        }
        guard.cleanup()?;
        let outcome = self.publish(candidate, evidence)?;
        match (outcome, label) {
            (PublishOutcome::Created(checkpoint), Some(label)) => Ok(PublishOutcome::Created(
                self.set_checkpoint_label(&checkpoint.snapshot_root, &label)?,
            )),
            (outcome, _) => Ok(outcome),
        }
    }

    /// Streams every visible checkpoint, oldest first, as a logical portable
    /// history. This stream is intentionally unencrypted for composition with
    /// Oleafly's authenticated password envelope.
    pub fn export_history<W: Write>(&self, mut writer: W) -> Result<HistoryExportSummary> {
        let _store_locks = self.acquire_shared_locks()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let checkpoint_count = query_count(&transaction, "checkpoints")?;
        PortableHistoryBudget::validate_checkpoint_count(checkpoint_count)?;
        let lineage = self.lineage_with_connection(&transaction)?;
        writer.write_all(HISTORY_EXPORT_MAGIC)?;
        writer.write_all(lineage.as_bytes())?;
        writer.write_all(&checkpoint_count.to_le_bytes())?;
        let mut budget = PortableHistoryBudget::default();
        let mut statement = transaction.prepare(
            "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json,
                    length(CAST(snapshot_root AS BLOB))
                      + length(CAST(engine AS BLOB))
                      + length(CAST(toolchain_identity AS BLOB))
                      + length(CAST(main_document AS BLOB))
                      + length(CAST(output_hash AS BLOB))
                      + length(CAST(replayed_inputs_json AS BLOB)),
             portable_metadata_bytes, chunk_references,
             unstored_file_count, unstored_logical_bytes, label
             FROM checkpoints ORDER BY sequence ASC",
        )?;
        let checkpoints = statement.query_map([], checkpoint_from_row)?;
        for checkpoint in checkpoints {
            let checkpoint = checkpoint?;
            let record =
                self.write_portable_checkpoint_record(&transaction, &checkpoint, &mut writer)?;
            budget.include(record.budget)?;
        }
        drop(statement);
        writer.flush()?;
        transaction.commit()?;
        Ok(HistoryExportSummary {
            checkpoint_count: budget.checkpoint_count,
            logical_bytes: budget.logical_bytes,
        })
    }

    /// Imports a complete portable history. The catalog write transaction is
    /// held until every record and payload has verified, so a corrupt late
    /// record exposes no partial history.
    pub fn import_history<R: Read>(&self, reader: R) -> Result<HistoryImportSummary> {
        self.import_history_validated(reader, |_, _, _| Ok::<(), String>(()))
    }

    /// Imports a complete portable history while letting the application
    /// validate the portable `project.json` against each checkpoint's compile
    /// identity. Validation runs before the catalog transaction commits, so a
    /// rejected record exposes no partial history.
    pub fn import_history_validated<R, F>(
        &self,
        mut reader: R,
        mut validate_project: F,
    ) -> Result<HistoryImportSummary>
    where
        R: Read,
        F: FnMut(&str, &str, &[u8]) -> std::result::Result<(), String>,
    {
        let _store_locks = self.acquire_exclusive_locks()?;
        remove_stale_staging(&self.root)?;
        let mut magic = vec![0_u8; HISTORY_EXPORT_MAGIC.len()];
        reader.read_exact(&mut magic)?;
        if magic != HISTORY_EXPORT_MAGIC {
            return Err(HistoryError::InvalidInput(
                "not an Oleafly portable history stream".into(),
            ));
        }
        let mut lineage_bytes = [0_u8; STORE_LINEAGE_BYTES];
        reader.read_exact(&mut lineage_bytes)?;
        let archive_lineage = std::str::from_utf8(&lineage_bytes)
            .map_err(|_| HistoryError::InvalidInput("portable history lineage is invalid".into()))?
            .to_string();
        validate_store_lineage(&archive_lineage)?;
        let mut count_bytes = [0_u8; 8];
        reader.read_exact(&mut count_bytes)?;
        let count = u64::from_le_bytes(count_bytes);
        PortableHistoryBudget::validate_checkpoint_count(count)?;

        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current_lineage = self.lineage_with_connection(&transaction)?;
        let existing_checkpoint_count = query_count(&transaction, "checkpoints")?;
        if existing_checkpoint_count > 0 && current_lineage != archive_lineage {
            return Err(HistoryError::InvalidInput(
                "portable history belongs to a different Checkpoints store".into(),
            ));
        }
        let preexisting_checkpoints = if existing_checkpoint_count > 0 {
            query_checkpoints_oldest_first(&transaction)?
        } else {
            Vec::new()
        };
        if existing_checkpoint_count == 0 && current_lineage != archive_lineage {
            transaction.execute(
                "UPDATE store_identity SET lineage = ?1 WHERE singleton = 1",
                [&archive_lineage],
            )?;
        }
        let import_dir = create_candidate_directory(&self.root.join("staging"))?;
        let mut guard = StagingGuard::new(import_dir.clone());
        let staged_pack = import_dir.join("history.pack");
        let mut pack = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&staged_pack)?;
        set_private_file_permissions(&staged_pack)?;
        pack.write_all(PACK_MAGIC)?;

        let mut staged_hashes = HashSet::new();
        let mut new_chunks = Vec::new();
        let mut imported_roots = HashSet::new();
        let mut checkpoints = Vec::with_capacity(count.min(4096) as usize);
        let mut budget = PortableHistoryBudget::default();
        for _ in 0..count {
            let remaining = budget.remaining();
            let (checkpoint, project_json) = self.read_portable_checkpoint_record(
                &transaction,
                &mut reader,
                &mut pack,
                &mut staged_hashes,
                &mut new_chunks,
                remaining,
            )?;
            validate_project(
                &checkpoint.evidence.engine,
                &checkpoint.evidence.main_document,
                &project_json,
            )
            .map_err(|error| {
                HistoryError::InvalidInput(format!(
                    "portable checkpoint {} has unusable project metadata: {error}",
                    checkpoint.root
                ))
            })?;
            budget.include(checkpoint.portable_budget)?;
            let root_hex = checkpoint.root.as_hex();
            if !imported_roots.insert(root_hex.clone()) {
                return Err(HistoryError::InvalidInput(format!(
                    "portable history repeats checkpoint {root_hex}"
                )));
            }
            checkpoints.push(checkpoint);
        }
        let mut trailing = [0_u8; 1];
        if reader.read(&mut trailing)? != 0 {
            return Err(HistoryError::InvalidInput(
                "portable history contains trailing data".into(),
            ));
        }
        pack.sync_all()?;
        sync_directory(&import_dir)?;
        let pack_len = pack.metadata()?.len();
        drop(pack);

        if !new_chunks.is_empty() {
            let pack_id = hash_file(&staged_pack)?;
            let pack_id_hex = pack_id.to_hex();
            let file_name = format!("{pack_id_hex}.pack");
            let destination = self.root.join("packs").join(&file_name);
            if destination.exists() {
                if hash_file(&destination)? != pack_id {
                    return Err(HistoryError::Corrupt(format!(
                        "immutable pack collision for {pack_id_hex}"
                    )));
                }
                fs::remove_file(&staged_pack)?;
            } else {
                fs::rename(&staged_pack, &destination)?;
                set_private_file_permissions(&destination)?;
                sync_directory(&self.root.join("packs"))?;
            }
            transaction.execute(
                "INSERT OR IGNORE INTO packs(pack_id, file_name, encoded_size) VALUES (?1, ?2, ?3)",
                params![pack_id_hex, file_name, pack_len as i64],
            )?;
            for chunk in &new_chunks {
                transaction.execute(
                    "INSERT OR IGNORE INTO chunks(
                        chunk_hash, pack_id, payload_offset, stored_len, raw_len, encoding
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        chunk.hash.to_hex(),
                        pack_id_hex,
                        chunk.payload_offset as i64,
                        chunk.stored_len as i64,
                        chunk.raw_len as i64,
                        chunk.encoding.as_i64(),
                    ],
                )?;
            }
        }

        let mut missing = Vec::new();
        let mut existing_checkpoints = 0_u64;
        for checkpoint in checkpoints {
            let root_hex = checkpoint.root.as_hex();
            if query_checkpoint(&transaction, &root_hex)?.is_some() {
                existing_checkpoints += 1;
                continue;
            }
            let manifest_json = serde_json::to_vec(&checkpoint.manifest)?;
            let existing_manifest = transaction
                .query_row(
                    "SELECT manifest_json FROM manifests WHERE snapshot_root = ?1",
                    [&root_hex],
                    |row| row.get::<_, Vec<u8>>(0),
                )
                .optional()?;
            if let Some(existing_manifest) = existing_manifest {
                if existing_manifest != manifest_json {
                    return Err(HistoryError::Corrupt(format!(
                        "snapshot root {root_hex} has conflicting manifest bytes"
                    )));
                }
            } else {
                transaction.execute(
                    "INSERT INTO manifests(snapshot_root, manifest_json) VALUES (?1, ?2)",
                    params![root_hex, manifest_json],
                )?;
            }
            for file in &checkpoint.manifest.files {
                for chunk in &file.chunks {
                    transaction.execute(
                        "INSERT OR IGNORE INTO manifest_chunks(snapshot_root, chunk_hash)
                         VALUES (?1, ?2)",
                        params![root_hex, chunk.hash],
                    )?;
                }
            }
            missing.push(checkpoint);
        }

        // All visible roots are inserted last in this single transaction.
        for checkpoint in &missing {
            let logical_bytes =
                checkpoint
                    .manifest
                    .files
                    .iter()
                    .try_fold(0_u64, |total, file| {
                        total
                            .checked_add(file.logical_size)
                            .ok_or_else(|| HistoryError::Corrupt("snapshot length overflow".into()))
                    })?;
            let unstored = manifest_unstored_totals(&checkpoint.manifest)?;
            transaction.execute(
                "INSERT INTO checkpoints(
                    snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json,
                    portable_metadata_bytes, chunk_references,
                    unstored_file_count, unstored_logical_bytes, label
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    checkpoint.root.as_hex(),
                    checkpoint.evidence.completed_at_unix_ms,
                    checkpoint.evidence.engine,
                    checkpoint.evidence.toolchain_identity,
                    checkpoint.evidence.main_document,
                    checkpoint.evidence.output_hash.to_hex(),
                    checkpoint.manifest.files.len() as i64,
                    logical_bytes as i64,
                    encode_replayed_inputs(&checkpoint.evidence.replayed_inputs)?,
                    checkpoint.portable_budget.metadata_bytes as i64,
                    checkpoint.portable_budget.chunk_references as i64,
                    unstored.file_count as i64,
                    unstored.logical_bytes as i64,
                    checkpoint.label.as_deref(),
                ],
            )?;
        }

        // Imported missing roots belong behind every recovery point that was
        // already visible locally. Reinsert only the catalog rows, oldest
        // first, so SQLite assigns them newer authoritative sequences while
        // preserving their relative order and immutable payload identities.
        if !missing.is_empty() {
            for checkpoint in &preexisting_checkpoints {
                transaction.execute(
                    "DELETE FROM checkpoints WHERE snapshot_root = ?1",
                    [checkpoint.snapshot_root.as_hex()],
                )?;
                insert_checkpoint(&transaction, checkpoint)?;
            }
        }
        transaction.commit()?;
        // Visibility is committed above. Staging cleanup is best-effort so a
        // cleanup failure cannot turn a successful import into an error that
        // callers might treat as safe to roll back.
        let _ = guard.cleanup();
        Ok(HistoryImportSummary {
            created_checkpoints: missing.len() as u64,
            existing_checkpoints,
        })
    }

    fn write_portable_checkpoint_record<W: Write>(
        &self,
        connection: &Connection,
        checkpoint: &Checkpoint,
        writer: &mut W,
    ) -> Result<PortableCheckpointRecordSummary> {
        let root = checkpoint.snapshot_root;
        let manifest = load_visible_manifest(connection, &root)?;
        let prepared = prepare_portable_checkpoint(checkpoint, &manifest)?;
        writer.write_all(EXPORT_MAGIC)?;
        writer.write_all(&(prepared.header.len() as u64).to_le_bytes())?;
        writer.write_all(&prepared.header)?;

        let mut logical_bytes = 0_u64;
        for manifest_file in &manifest.files {
            let file_bytes = if manifest_file.stored {
                let mut file_hasher = blake3::Hasher::new();
                let mut file_bytes = 0_u64;
                for manifest_chunk in &manifest_file.chunks {
                    let raw = self.read_verified_chunk(connection, manifest_chunk)?;
                    writer.write_all(&raw)?;
                    file_hasher.update(&raw);
                    file_bytes = file_bytes
                        .checked_add(raw.len() as u64)
                        .ok_or_else(|| HistoryError::Corrupt("file length overflow".into()))?;
                }
                verify_file_digest(manifest_file, file_bytes, &file_hasher)?;
                file_bytes
            } else {
                manifest_file.logical_size
            };
            logical_bytes = logical_bytes
                .checked_add(file_bytes)
                .ok_or_else(|| HistoryError::Corrupt("snapshot length overflow".into()))?;
        }
        if checkpoint.file_count != manifest.files.len() as u64
            || checkpoint.logical_bytes != logical_bytes
        {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint {root} summary does not match its manifest"
            )));
        }
        Ok(PortableCheckpointRecordSummary {
            export: ExportSummary {
                snapshot_root: root,
                file_count: manifest.files.len() as u64,
                logical_bytes,
            },
            budget: prepared.budget,
        })
    }

    fn read_portable_checkpoint_record<R: Read>(
        &self,
        connection: &Connection,
        reader: &mut R,
        pack: &mut File,
        staged_hashes: &mut HashSet<String>,
        new_chunks: &mut Vec<StagedChunk>,
        remaining: ImportBudget,
    ) -> Result<(ImportedCheckpoint, Vec<u8>)> {
        let (metadata, metadata_bytes) = read_portable_checkpoint_metadata(reader)?;
        if metadata_bytes > remaining.metadata_bytes {
            return Err(HistoryError::InvalidInput(
                "portable history metadata exceeds the import limit".into(),
            ));
        }
        let root = SnapshotRoot::parse(&metadata.snapshot_root)?;
        verify_archive_manifest(&metadata.manifest)?;
        verify_manifest_root(&root, &metadata.manifest)?;
        let label = validate_portable_label(metadata.label.as_deref())?;
        let output_hash = ContentHash::from_hex(&metadata.output_hash)?;
        let evidence = CompileEvidence::new(
            metadata.engine,
            metadata.toolchain_identity,
            metadata.main_document,
            output_hash,
            metadata.completed_at_unix_ms,
            decode_portable_replayed_inputs(metadata.replayed_inputs)?,
        )?;
        validate_archived_evidence(&metadata.manifest, &evidence)?;
        let declared_logical_bytes =
            metadata
                .manifest
                .files
                .iter()
                .try_fold(0_u64, |total, file| {
                    total.checked_add(file.logical_size).ok_or_else(|| {
                        HistoryError::InvalidInput("portable history logical size overflow".into())
                    })
                })?;
        if declared_logical_bytes > remaining.logical_bytes {
            return Err(HistoryError::InvalidInput(
                "portable history exceeds the import logical-size limit".into(),
            ));
        }
        let declared_chunk_references =
            metadata
                .manifest
                .files
                .iter()
                .try_fold(0_u64, |total, file| {
                    total.checked_add(file.chunks.len() as u64).ok_or_else(|| {
                        HistoryError::InvalidInput("portable history has too many chunks".into())
                    })
                })?;
        if declared_chunk_references > remaining.chunk_references {
            return Err(HistoryError::InvalidInput(
                "portable history contains too many chunk references".into(),
            ));
        }
        let project_manifest = metadata
            .manifest
            .files
            .iter()
            .find(|file| file.path == "project.json")
            .ok_or(HistoryError::MissingProjectManifest)?;
        if project_manifest.logical_size > MAX_PROJECT_MANIFEST_BYTES {
            return Err(HistoryError::InvalidInput(
                "portable project.json exceeds the import limit".into(),
            ));
        }

        let mut project_json = Vec::with_capacity(project_manifest.logical_size as usize);
        for file in &metadata.manifest.files {
            if !file.stored {
                continue;
            }
            let mut file_hasher = blake3::Hasher::new();
            let mut file_bytes = 0_u64;
            for chunk in &file.chunks {
                if chunk.raw_len == 0 || chunk.raw_len > MAX_CHUNK_SIZE as u64 {
                    return Err(HistoryError::InvalidInput(format!(
                        "portable chunk {} has invalid length {}",
                        chunk.hash, chunk.raw_len
                    )));
                }
                let mut raw = vec![0_u8; chunk.raw_len as usize];
                reader.read_exact(&mut raw)?;
                let actual_hash = ContentHash::digest(&raw);
                if actual_hash.to_hex() != chunk.hash {
                    return Err(HistoryError::Corrupt(format!(
                        "portable chunk {} failed BLAKE3 verification",
                        chunk.hash
                    )));
                }
                file_hasher.update(&raw);
                if file.path == "project.json" {
                    project_json.extend_from_slice(&raw);
                }
                file_bytes = file_bytes
                    .checked_add(raw.len() as u64)
                    .ok_or_else(|| HistoryError::Corrupt("file length overflow".into()))?;

                let already_published = connection
                    .query_row(
                        "SELECT 1 FROM chunks WHERE chunk_hash = ?1",
                        [&chunk.hash],
                        |_| Ok(()),
                    )
                    .optional()?
                    .is_some();
                if !already_published && staged_hashes.insert(chunk.hash.clone()) {
                    new_chunks.push(write_pack_chunk(pack, actual_hash, &raw)?);
                }
            }
            verify_file_digest(file, file_bytes, &file_hasher)?;
        }
        Ok((
            ImportedCheckpoint {
                root,
                evidence,
                manifest: metadata.manifest,
                label,
                portable_budget: PortableCheckpointBudget {
                    metadata_bytes,
                    logical_bytes: declared_logical_bytes,
                    chunk_references: declared_chunk_references,
                },
            },
            project_json,
        ))
    }

    fn initialize_catalog(&self) -> Result<()> {
        let connection = self.open_connection(true)?;
        let version: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > FORMAT_VERSION {
            return Err(HistoryError::UnsupportedFormat(version));
        }
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS packs(
                pack_id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL UNIQUE,
                encoded_size INTEGER NOT NULL CHECK(encoded_size >= 0)
             );
             CREATE TABLE IF NOT EXISTS chunks(
                chunk_hash TEXT PRIMARY KEY,
                pack_id TEXT NOT NULL REFERENCES packs(pack_id),
                payload_offset INTEGER NOT NULL CHECK(payload_offset >= 0),
                stored_len INTEGER NOT NULL CHECK(stored_len >= 0),
                raw_len INTEGER NOT NULL CHECK(raw_len >= 0),
                encoding INTEGER NOT NULL CHECK(encoding IN (0, 1))
             );
             CREATE TABLE IF NOT EXISTS manifests(
                snapshot_root TEXT PRIMARY KEY,
                manifest_json BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS manifest_chunks(
                snapshot_root TEXT NOT NULL REFERENCES manifests(snapshot_root) ON DELETE CASCADE,
                chunk_hash TEXT NOT NULL REFERENCES chunks(chunk_hash),
                PRIMARY KEY(snapshot_root, chunk_hash)
             );
             CREATE TABLE IF NOT EXISTS checkpoints(
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_root TEXT NOT NULL UNIQUE REFERENCES manifests(snapshot_root),
                completed_at_unix_ms INTEGER NOT NULL CHECK(completed_at_unix_ms >= 0),
                engine TEXT NOT NULL,
                toolchain_identity TEXT NOT NULL,
                main_document TEXT NOT NULL,
                output_hash TEXT NOT NULL,
                replayed_inputs_json TEXT NOT NULL
                ,file_count INTEGER NOT NULL CHECK(file_count >= 0)
                ,logical_bytes INTEGER NOT NULL CHECK(logical_bytes >= 0)
                ,portable_metadata_bytes INTEGER NOT NULL DEFAULT 0 CHECK(portable_metadata_bytes >= 0)
                ,chunk_references INTEGER NOT NULL DEFAULT 0 CHECK(chunk_references >= 0)
                ,unstored_file_count INTEGER NOT NULL DEFAULT 0 CHECK(unstored_file_count >= 0)
                ,unstored_logical_bytes INTEGER NOT NULL DEFAULT 0 CHECK(unstored_logical_bytes >= 0)
                ,label TEXT
             );
             CREATE TABLE IF NOT EXISTS store_identity(
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                lineage TEXT NOT NULL UNIQUE
             );
             COMMIT;",
        )?;
        migrate_catalog_to_current_version(&connection)?;
        let existing = connection
            .query_row(
                "SELECT lineage FROM store_identity WHERE singleton = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing.is_none() {
            connection.execute(
                "INSERT INTO store_identity(singleton, lineage) VALUES (1, ?1)",
                [generate_store_lineage()],
            )?;
        }
        self.lineage_with_connection(&connection)?;
        Ok(())
    }

    fn validate_catalog_version(&self) -> Result<()> {
        let connection = self.connection()?;
        let version: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version == 0 || version > FORMAT_VERSION {
            return Err(HistoryError::UnsupportedFormat(version));
        }
        self.lineage_with_connection(&connection)?;
        migrate_catalog_to_current_version(&connection)?;
        Ok(())
    }

    fn lineage_with_connection(&self, connection: &Connection) -> Result<String> {
        let lineage = connection
            .query_row(
                "SELECT lineage FROM store_identity WHERE singleton = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| HistoryError::Corrupt("checkpoint store lineage is missing".into()))?;
        validate_store_lineage(&lineage)?;
        Ok(lineage)
    }

    fn recover_orphan_packs_inner(&self) -> Result<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        remove_orphan_pack_files(&self.root, &transaction)?;
        sync_directory(&self.root.join("packs"))?;
        transaction.commit()?;
        Ok(())
    }

    fn acquire_shared_operation_lock(&self) -> Result<File> {
        let path = self.root.join(OPERATION_LOCK_FILE);
        let mut options = OpenOptions::new();
        options.read(true).write(true);
        let file = open_with_no_follow(&mut options, &path)?;
        validate_regular_file(&path, "checkpoint operation lock")?;
        fs4::FileExt::lock_shared(&file)?;
        Ok(file)
    }

    fn acquire_exclusive_operation_lock(&self) -> Result<File> {
        let path = self.root.join(OPERATION_LOCK_FILE);
        let mut options = OpenOptions::new();
        options.read(true).write(true);
        let file = open_with_no_follow(&mut options, &path)?;
        validate_regular_file(&path, "checkpoint operation lock")?;
        fs4::FileExt::lock(&file)?;
        Ok(file)
    }

    fn acquire_shared_locks(&self) -> Result<StoreLocks> {
        let namespace = open_namespace_lock(store_parent(&self.root)?, false)?;
        fs4::FileExt::lock_shared(&namespace)?;
        let operation = self.acquire_shared_operation_lock()?;
        Ok(StoreLocks {
            _namespace: namespace,
            _operation: operation,
        })
    }

    fn acquire_exclusive_locks(&self) -> Result<StoreLocks> {
        let namespace = open_namespace_lock(store_parent(&self.root)?, false)?;
        fs4::FileExt::lock_shared(&namespace)?;
        let operation = self.acquire_exclusive_operation_lock()?;
        Ok(StoreLocks {
            _namespace: namespace,
            _operation: operation,
        })
    }

    fn connection(&self) -> Result<Connection> {
        self.open_connection(false)
    }

    fn open_connection(&self, create: bool) -> Result<Connection> {
        let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW;
        if create {
            flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
        let catalog = self.root.join("catalog.sqlite3");
        if catalog.try_exists()? {
            validate_regular_file(&catalog, "checkpoint catalog")?;
        }
        let connection = Connection::open_with_flags(&catalog, flags)?;
        validate_regular_file(&catalog, "checkpoint catalog")?;
        connection.busy_timeout(std::time::Duration::from_secs(30))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = FULL;",
        )?;
        Ok(connection)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Manifest {
    format_version: u32,
    files: Vec<ManifestFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ManifestFile {
    path: String,
    logical_size: u64,
    content_hash: String,
    #[serde(
        default = "manifest_file_stored_default",
        skip_serializing_if = "manifest_file_stored_is_default"
    )]
    stored: bool,
    chunks: Vec<ManifestChunk>,
}

fn manifest_file_stored_default() -> bool {
    true
}

fn manifest_file_stored_is_default(stored: &bool) -> bool {
    *stored
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ManifestChunk {
    hash: String,
    raw_len: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PortableCheckpoint {
    export_version: u32,
    snapshot_root: String,
    completed_at_unix_ms: i64,
    engine: String,
    toolchain_identity: String,
    main_document: String,
    output_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    replayed_inputs: Vec<PortableReplayedInput>,
    manifest: Manifest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PortableReplayedInput {
    relative_path: String,
    content_hash: String,
}

#[derive(Serialize)]
struct PortableCheckpointView<'a> {
    export_version: u32,
    snapshot_root: PortableSnapshotRoot<'a>,
    completed_at_unix_ms: i64,
    engine: &'a str,
    toolchain_identity: &'a str,
    main_document: &'a str,
    output_hash: PortableContentHash<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<&'a str>,
    replayed_inputs: PortableReplayedInputs<'a>,
    manifest: &'a Manifest,
}

struct PortableSnapshotRoot<'a>(&'a SnapshotRoot);

impl Serialize for PortableSnapshotRoot<'_> {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(self.0)
    }
}

struct PortableContentHash<'a>(&'a ContentHash);

impl Serialize for PortableContentHash<'_> {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(self.0)
    }
}

struct PortableReplayedInputs<'a>(&'a [ReplayedInput]);

impl Serialize for PortableReplayedInputs<'_> {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for input in self.0 {
            sequence.serialize_element(&PortableReplayedInputView {
                relative_path: &input.relative_path,
                content_hash: PortableContentHash(&input.content_hash),
            })?;
        }
        sequence.end()
    }
}

#[derive(Serialize)]
struct PortableReplayedInputView<'a> {
    relative_path: &'a str,
    content_hash: PortableContentHash<'a>,
}

struct BoundedPortableWriter<W> {
    inner: W,
    written: u64,
    limit: u64,
    overflowed: bool,
}

impl<W> BoundedPortableWriter<W> {
    fn new(inner: W, limit: u64) -> Self {
        Self {
            inner,
            written: 0,
            limit,
            overflowed: false,
        }
    }
}

impl<W: Write> Write for BoundedPortableWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let requested = u64::try_from(buffer.len()).unwrap_or(u64::MAX);
        if requested > self.limit.saturating_sub(self.written) {
            self.overflowed = true;
            return Err(io::Error::other(
                "portable checkpoint header limit exceeded",
            ));
        }
        let written = self.inner.write(buffer)?;
        self.written = self
            .written
            .checked_add(written as u64)
            .ok_or_else(|| io::Error::other("portable checkpoint header length overflow"))?;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn write_bounded_portable_json<T: Serialize, W: Write>(
    value: &T,
    writer: W,
    limit: u64,
) -> Result<u64> {
    let mut writer = BoundedPortableWriter::new(writer, limit);
    match serde_json::to_writer(&mut writer, value) {
        Ok(()) => Ok(writer.written),
        Err(_) if writer.overflowed => Err(HistoryError::InvalidInput(
            "portable checkpoint header exceeds 16 MiB".into(),
        )),
        Err(error) => Err(error.into()),
    }
}

fn encode_portable_replayed_inputs(inputs: &[ReplayedInput]) -> Vec<PortableReplayedInput> {
    inputs
        .iter()
        .map(|input| PortableReplayedInput {
            relative_path: input.relative_path.clone(),
            content_hash: input.content_hash.to_hex(),
        })
        .collect()
}

fn decode_portable_replayed_inputs(
    inputs: Vec<PortableReplayedInput>,
) -> Result<Vec<ReplayedInput>> {
    inputs
        .into_iter()
        .map(|input| {
            ReplayedInput::new(
                input.relative_path,
                ContentHash::from_hex(&input.content_hash)?,
            )
        })
        .collect()
}

fn encode_replayed_inputs(inputs: &[ReplayedInput]) -> Result<String> {
    Ok(serde_json::to_string(&encode_portable_replayed_inputs(
        inputs,
    ))?)
}

fn decode_replayed_inputs(json: &str) -> Result<Vec<ReplayedInput>> {
    let inputs = serde_json::from_str::<Vec<PortableReplayedInput>>(json)?;
    decode_portable_replayed_inputs(inputs)
}

fn portable_checkpoint_view<'a>(
    checkpoint: &'a Checkpoint,
    manifest: &'a Manifest,
) -> Result<(PortableCheckpointView<'a>, PortableCheckpointBudget)> {
    verify_manifest_root(&checkpoint.snapshot_root, manifest)?;
    let logical_bytes = manifest.files.iter().try_fold(0_u64, |total, file| {
        total
            .checked_add(file.logical_size)
            .ok_or_else(|| HistoryError::Corrupt("snapshot length overflow".into()))
    })?;
    let chunk_references = manifest.files.iter().try_fold(0_u64, |total, file| {
        total
            .checked_add(file.chunks.len() as u64)
            .ok_or_else(|| HistoryError::Corrupt("checkpoint chunk count overflow".into()))
    })?;
    if checkpoint.file_count != manifest.files.len() as u64
        || checkpoint.logical_bytes != logical_bytes
    {
        return Err(HistoryError::Corrupt(format!(
            "checkpoint {} summary does not match its manifest",
            checkpoint.snapshot_root
        )));
    }
    let project_manifest = manifest
        .files
        .iter()
        .find(|file| file.path == "project.json")
        .ok_or(HistoryError::MissingProjectManifest)?;
    if project_manifest.logical_size > MAX_PROJECT_MANIFEST_BYTES {
        return Err(HistoryError::InvalidInput(
            "portable project.json exceeds the import limit".into(),
        ));
    }

    let metadata = PortableCheckpointView {
        export_version: 1,
        snapshot_root: PortableSnapshotRoot(&checkpoint.snapshot_root),
        completed_at_unix_ms: checkpoint.completed_at_unix_ms,
        engine: &checkpoint.engine,
        toolchain_identity: &checkpoint.toolchain_identity,
        main_document: &checkpoint.main_document,
        output_hash: PortableContentHash(&checkpoint.output_hash),
        label: checkpoint.label.as_deref(),
        replayed_inputs: PortableReplayedInputs(&checkpoint.replayed_inputs),
        manifest,
    };
    Ok((
        metadata,
        PortableCheckpointBudget {
            metadata_bytes: 0,
            logical_bytes,
            chunk_references,
        },
    ))
}

fn portable_checkpoint_budget(
    checkpoint: &Checkpoint,
    manifest: &Manifest,
) -> Result<PortableCheckpointBudget> {
    let (metadata, mut budget) = portable_checkpoint_view(checkpoint, manifest)?;
    budget.metadata_bytes =
        write_bounded_portable_json(&metadata, io::sink(), MAX_EXPORT_HEADER_BYTES)?;
    Ok(budget)
}

fn prepare_portable_checkpoint(
    checkpoint: &Checkpoint,
    manifest: &Manifest,
) -> Result<PreparedPortableCheckpoint> {
    let (metadata, mut budget) = portable_checkpoint_view(checkpoint, manifest)?;
    let metadata_bytes =
        write_bounded_portable_json(&metadata, io::sink(), MAX_EXPORT_HEADER_BYTES)?;
    let capacity = usize::try_from(metadata_bytes).map_err(|_| {
        HistoryError::InvalidInput("portable checkpoint header is too large".into())
    })?;
    let mut header = Vec::with_capacity(capacity);
    let retained_bytes =
        write_bounded_portable_json(&metadata, &mut header, MAX_EXPORT_HEADER_BYTES)?;
    if retained_bytes != metadata_bytes || header.len() as u64 != metadata_bytes {
        return Err(HistoryError::Corrupt(
            "portable checkpoint header serialization changed between passes".into(),
        ));
    }
    budget.metadata_bytes = metadata_bytes;

    Ok(PreparedPortableCheckpoint { budget, header })
}

fn validate_portable_history_after_publication(
    connection: &Connection,
    checkpoint: &Checkpoint,
    manifest: &Manifest,
) -> Result<(PortableHistoryBudget, PortableCheckpointBudget)> {
    let candidate_budget = portable_checkpoint_budget(checkpoint, manifest)?;
    let totals = connection.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(portable_metadata_bytes), 0),
                COALESCE(SUM(logical_bytes), 0),
                COALESCE(SUM(chunk_references), 0)
         FROM checkpoints WHERE snapshot_root <> ?1",
        [checkpoint.snapshot_root.as_hex()],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    )?;
    let mut budget = PortableHistoryBudget::from_totals(totals.0, totals.1, totals.2, totals.3)?;
    budget.include(candidate_budget)?;
    Ok((budget, candidate_budget))
}

struct ImportedCheckpoint {
    root: SnapshotRoot,
    evidence: CompileEvidence,
    manifest: Manifest,
    label: Option<String>,
    portable_budget: PortableCheckpointBudget,
}

#[derive(Clone, Copy, Debug)]
struct ImportBudget {
    metadata_bytes: u64,
    logical_bytes: u64,
    chunk_references: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PortableCheckpointBudget {
    metadata_bytes: u64,
    logical_bytes: u64,
    chunk_references: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct PortableHistoryBudget {
    checkpoint_count: u64,
    metadata_bytes: u64,
    logical_bytes: u64,
    chunk_references: u64,
}

impl PortableHistoryBudget {
    fn from_totals(
        checkpoint_count: i64,
        metadata_bytes: i64,
        logical_bytes: i64,
        chunk_references: i64,
    ) -> Result<Self> {
        let convert = |value: i64, label: &str| {
            u64::try_from(value).map_err(|_| {
                HistoryError::Corrupt(format!("portable history {label} total is negative"))
            })
        };
        let budget = Self {
            checkpoint_count: convert(checkpoint_count, "checkpoint count")?,
            metadata_bytes: convert(metadata_bytes, "metadata")?,
            logical_bytes: convert(logical_bytes, "logical size")?,
            chunk_references: convert(chunk_references, "chunk reference")?,
        };
        Self::validate_checkpoint_count(budget.checkpoint_count)?;
        if budget.metadata_bytes > MAX_HISTORY_METADATA_BYTES
            || budget.logical_bytes > MAX_HISTORY_LOGICAL_BYTES
            || budget.chunk_references > MAX_HISTORY_CHUNK_REFERENCES
        {
            return Err(HistoryError::Corrupt(
                "portable history totals exceed the format limits".into(),
            ));
        }
        Ok(budget)
    }

    fn validate_checkpoint_count(checkpoint_count: u64) -> Result<()> {
        if checkpoint_count > MAX_HISTORY_CHECKPOINTS {
            return Err(HistoryError::InvalidInput(
                "portable history exceeds the checkpoint-count limit".into(),
            ));
        }
        Ok(())
    }

    fn include(&mut self, checkpoint: PortableCheckpointBudget) -> Result<()> {
        let checkpoint_count = self
            .checkpoint_count
            .checked_add(1)
            .ok_or_else(|| HistoryError::InvalidInput("portable history count overflow".into()))?;
        Self::validate_checkpoint_count(checkpoint_count)?;

        let metadata_bytes = self
            .metadata_bytes
            .checked_add(checkpoint.metadata_bytes)
            .ok_or_else(|| {
                HistoryError::InvalidInput("portable history metadata is too large".into())
            })?;
        if metadata_bytes > MAX_HISTORY_METADATA_BYTES {
            return Err(HistoryError::InvalidInput(
                "portable history metadata exceeds the limit".into(),
            ));
        }

        let logical_bytes = self
            .logical_bytes
            .checked_add(checkpoint.logical_bytes)
            .ok_or_else(|| HistoryError::InvalidInput("portable history is too large".into()))?;
        if logical_bytes > MAX_HISTORY_LOGICAL_BYTES {
            return Err(HistoryError::InvalidInput(
                "portable history exceeds the logical-size limit".into(),
            ));
        }

        let chunk_references = self
            .chunk_references
            .checked_add(checkpoint.chunk_references)
            .ok_or_else(|| {
                HistoryError::InvalidInput("portable history has too many chunks".into())
            })?;
        if chunk_references > MAX_HISTORY_CHUNK_REFERENCES {
            return Err(HistoryError::InvalidInput(
                "portable history contains too many chunk references".into(),
            ));
        }

        *self = Self {
            checkpoint_count,
            metadata_bytes,
            logical_bytes,
            chunk_references,
        };
        Ok(())
    }

    fn remaining(self) -> ImportBudget {
        ImportBudget {
            metadata_bytes: MAX_HISTORY_METADATA_BYTES.saturating_sub(self.metadata_bytes),
            logical_bytes: MAX_HISTORY_LOGICAL_BYTES.saturating_sub(self.logical_bytes),
            chunk_references: MAX_HISTORY_CHUNK_REFERENCES.saturating_sub(self.chunk_references),
        }
    }
}

struct PreparedPortableCheckpoint {
    header: Vec<u8>,
    budget: PortableCheckpointBudget,
}

struct PortableCheckpointRecordSummary {
    export: ExportSummary,
    budget: PortableCheckpointBudget,
}

struct StagingGuard {
    path: PathBuf,
    cleaned: bool,
}

impl StagingGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            cleaned: false,
        }
    }

    fn cleanup(&mut self) -> Result<()> {
        if !self.cleaned {
            match fs::remove_dir_all(&self.path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            self.cleaned = true;
        }
        Ok(())
    }
}

impl Drop for StagingGuard {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChunkEncoding {
    Raw,
    Zstd,
}

impl ChunkEncoding {
    fn as_i64(self) -> i64 {
        match self {
            Self::Raw => 0,
            Self::Zstd => 1,
        }
    }
}

#[derive(Clone, Debug)]
struct StagedChunk {
    hash: ContentHash,
    payload_offset: u64,
    stored_len: u64,
    raw_len: u64,
    encoding: ChunkEncoding,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PublishFault {
    None,
    AfterPackPublished,
    BeforeVisibleRoot,
    BeforeCommit,
}

fn write_pack_chunk(pack: &mut File, hash: ContentHash, raw: &[u8]) -> Result<StagedChunk> {
    let compressed = zstd::stream::encode_all(raw, ZSTD_LEVEL)?;
    let (encoding, payload): (ChunkEncoding, &[u8]) = if compressed.len() < raw.len() {
        (ChunkEncoding::Zstd, &compressed)
    } else {
        (ChunkEncoding::Raw, raw)
    };
    pack.write_all(b"CHNK")?;
    pack.write_all(hash.as_bytes())?;
    pack.write_all(&(raw.len() as u64).to_le_bytes())?;
    pack.write_all(&(payload.len() as u64).to_le_bytes())?;
    pack.write_all(&[encoding.as_i64() as u8])?;
    let payload_offset = pack.stream_position()?;
    pack.write_all(payload)?;
    Ok(StagedChunk {
        hash,
        payload_offset,
        stored_len: payload.len() as u64,
        raw_len: raw.len() as u64,
        encoding,
    })
}

fn compute_snapshot_root(manifest: &Manifest) -> Result<SnapshotRoot> {
    let version = manifest.format_version;
    if version == 0 || version > FORMAT_VERSION {
        return Err(HistoryError::UnsupportedFormat(version));
    }
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"oleafly-snapshot\0");
    hasher.update(&version.to_le_bytes());
    hasher.update(&(manifest.files.len() as u64).to_le_bytes());
    for file in &manifest.files {
        hash_length_prefixed(&mut hasher, file.path.as_bytes());
        hasher.update(&file.logical_size.to_le_bytes());
        let content_hash = ContentHash::from_hex(&file.content_hash)?;
        hasher.update(content_hash.as_bytes());
        if version >= UNSTORED_MANIFEST_VERSION {
            hasher.update(&[u8::from(file.stored)]);
        }
        hasher.update(&(file.chunks.len() as u64).to_le_bytes());
        for chunk in &file.chunks {
            let chunk_hash = ContentHash::from_hex(&chunk.hash)?;
            hasher.update(chunk_hash.as_bytes());
            hasher.update(&chunk.raw_len.to_le_bytes());
        }
    }
    Ok(SnapshotRoot(ContentHash::from_bytes(
        *hasher.finalize().as_bytes(),
    )))
}

fn validate_compile_evidence(candidate: &Candidate, evidence: &CompileEvidence) -> Result<()> {
    validate_archived_evidence(&candidate.manifest, evidence)?;
    let replayed = evidence
        .replayed_inputs
        .iter()
        .map(|input| (input.relative_path.as_str(), input.content_hash))
        .collect::<Vec<_>>();
    let proven = candidate
        .proven_files
        .iter()
        .map(|file| (file.relative_path.as_str(), file.content_hash))
        .collect::<Vec<_>>();
    if replayed != proven {
        return Err(HistoryError::InvalidInput(
            "sealed replay inputs do not exactly match the discovery evidence".into(),
        ));
    }
    Ok(())
}

fn verify_candidate_sealed_tree_controlled(
    candidate: &Candidate,
    gate: &dyn PublicationGate,
) -> Result<()> {
    for file in &candidate.manifest.files {
        ensure_publication_active(gate)?;
        let metadata = validate_unsymlinked_regular_file(&candidate.sealed_root, &file.path)?;
        if metadata.len() != file.logical_size {
            return Err(HistoryError::InvalidInput(format!(
                "sealed replay input {} changed before publication",
                file.path
            )));
        }
        let actual = hash_file_controlled(
            &candidate.sealed_root.join(path_from_portable(&file.path)),
            gate,
        )?;
        if actual != ContentHash::from_hex(&file.content_hash)? {
            return Err(HistoryError::InvalidInput(format!(
                "sealed replay input {} changed before publication",
                file.path
            )));
        }
    }
    ensure_publication_active(gate)?;
    Ok(())
}

fn validate_archived_evidence(manifest: &Manifest, evidence: &CompileEvidence) -> Result<()> {
    let main_file = manifest
        .files
        .iter()
        .find(|file| file.path == evidence.main_document)
        .ok_or_else(|| {
            HistoryError::InvalidInput(format!(
                "compiled main document {} is not present in the sealed candidate",
                evidence.main_document
            ))
        })?;
    if !main_file.stored {
        return Err(HistoryError::InvalidInput(format!(
            "compiled main document {} must always retain its checkpoint bytes",
            evidence.main_document
        )));
    }
    let main_replay = evidence
        .replayed_inputs
        .iter()
        .find(|input| input.relative_path == evidence.main_document)
        .ok_or_else(|| {
            HistoryError::InvalidInput(format!(
                "compiled main document {} lacks sealed replay evidence",
                evidence.main_document
            ))
        })?;
    if main_replay.content_hash != ContentHash::from_hex(&main_file.content_hash)? {
        return Err(HistoryError::InvalidInput(format!(
            "replayed main document {} does not match the sealed bytes",
            evidence.main_document
        )));
    }
    for replayed in &evidence.replayed_inputs {
        let Some(file) = manifest
            .files
            .iter()
            .find(|file| file.path == replayed.relative_path)
        else {
            return Err(HistoryError::InvalidInput(format!(
                "replayed input {} is not present in the sealed candidate",
                replayed.relative_path
            )));
        };
        if replayed.content_hash != ContentHash::from_hex(&file.content_hash)? {
            return Err(HistoryError::InvalidInput(format!(
                "replayed input {} does not match the sealed bytes",
                replayed.relative_path
            )));
        }
    }
    Ok(())
}

fn validate_checkpoint_label(label: &str) -> Result<Option<String>> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().any(char::is_control) {
        return Err(HistoryError::InvalidInput(
            "checkpoint label must not contain control characters".into(),
        ));
    }
    if trimmed.chars().count() > MAX_CHECKPOINT_LABEL_CHARS {
        return Err(HistoryError::InvalidInput(format!(
            "checkpoint label must be at most {MAX_CHECKPOINT_LABEL_CHARS} characters"
        )));
    }
    Ok(Some(trimmed.to_string()))
}

fn validate_portable_label(label: Option<&str>) -> Result<Option<String>> {
    match label {
        Some(label) => validate_checkpoint_label(label),
        None => Ok(None),
    }
}

fn hash_length_prefixed(hasher: &mut blake3::Hasher, value: &[u8]) {
    hasher.update(&(value.len() as u64).to_le_bytes());
    hasher.update(value);
}

fn query_checkpoint(connection: &Connection, root: &str) -> Result<Option<Checkpoint>> {
    connection
        .query_row(
            "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json,
                    length(CAST(snapshot_root AS BLOB))
                      + length(CAST(engine AS BLOB))
                      + length(CAST(toolchain_identity AS BLOB))
                      + length(CAST(main_document AS BLOB))
                      + length(CAST(output_hash AS BLOB))
                      + length(CAST(replayed_inputs_json AS BLOB)),
             portable_metadata_bytes, chunk_references,
             unstored_file_count, unstored_logical_bytes, label
             FROM checkpoints WHERE snapshot_root = ?1",
            [root],
            checkpoint_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn query_checkpoints_oldest_first(connection: &Connection) -> Result<Vec<Checkpoint>> {
    let mut statement = connection.prepare(
        "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                main_document, output_hash, file_count, logical_bytes, replayed_inputs_json,
                length(CAST(snapshot_root AS BLOB))
                  + length(CAST(engine AS BLOB))
                  + length(CAST(toolchain_identity AS BLOB))
                  + length(CAST(main_document AS BLOB))
                  + length(CAST(output_hash AS BLOB))
                  + length(CAST(replayed_inputs_json AS BLOB)),
         portable_metadata_bytes, chunk_references,
         unstored_file_count, unstored_logical_bytes, label
         FROM checkpoints ORDER BY sequence ASC",
    )?;
    let rows = statement.query_map([], checkpoint_from_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn insert_checkpoint(connection: &Connection, checkpoint: &Checkpoint) -> Result<()> {
    connection.execute(
        "INSERT INTO checkpoints(
            snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
            main_document, output_hash, file_count, logical_bytes, replayed_inputs_json,
            portable_metadata_bytes, chunk_references,
            unstored_file_count, unstored_logical_bytes, label
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            checkpoint.snapshot_root.as_hex(),
            checkpoint.completed_at_unix_ms,
            checkpoint.engine,
            checkpoint.toolchain_identity,
            checkpoint.main_document,
            checkpoint.output_hash.to_hex(),
            checkpoint.file_count as i64,
            checkpoint.logical_bytes as i64,
            encode_replayed_inputs(&checkpoint.replayed_inputs)?,
            checkpoint.portable_metadata_bytes as i64,
            checkpoint.chunk_references as i64,
            checkpoint.unstored_file_count as i64,
            checkpoint.unstored_logical_bytes as i64,
            checkpoint.label,
        ],
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct UnstoredTotals {
    file_count: u64,
    logical_bytes: u64,
}

fn manifest_unstored_totals(manifest: &Manifest) -> Result<UnstoredTotals> {
    let mut totals = UnstoredTotals::default();
    for file in &manifest.files {
        if file.stored {
            continue;
        }
        totals.file_count = totals
            .file_count
            .checked_add(1)
            .ok_or_else(|| HistoryError::Corrupt("unstored file count overflow".into()))?;
        totals.logical_bytes = totals
            .logical_bytes
            .checked_add(file.logical_size)
            .ok_or_else(|| HistoryError::Corrupt("unstored length overflow".into()))?;
    }
    Ok(totals)
}

struct CatalogColumn {
    name: &'static str,
    declaration: &'static str,
    backfilled: bool,
}

const CATALOG_ADDED_COLUMNS: &[CatalogColumn] = &[
    CatalogColumn {
        name: "portable_metadata_bytes",
        declaration: "INTEGER NOT NULL DEFAULT 0 CHECK(portable_metadata_bytes >= 0)",
        backfilled: true,
    },
    CatalogColumn {
        name: "chunk_references",
        declaration: "INTEGER NOT NULL DEFAULT 0 CHECK(chunk_references >= 0)",
        backfilled: true,
    },
    CatalogColumn {
        name: "unstored_file_count",
        declaration: "INTEGER NOT NULL DEFAULT 0 CHECK(unstored_file_count >= 0)",
        backfilled: true,
    },
    CatalogColumn {
        name: "unstored_logical_bytes",
        declaration: "INTEGER NOT NULL DEFAULT 0 CHECK(unstored_logical_bytes >= 0)",
        backfilled: true,
    },
    CatalogColumn {
        name: "label",
        declaration: "TEXT",
        backfilled: false,
    },
];

fn missing_catalog_columns(connection: &Connection) -> Result<Vec<&'static CatalogColumn>> {
    let mut statement = connection.prepare("PRAGMA table_info(checkpoints)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(CATALOG_ADDED_COLUMNS
        .iter()
        .filter(|column| !columns.iter().any(|existing| existing == column.name))
        .collect())
}

fn catalog_user_version(connection: &Connection) -> Result<u32> {
    Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

fn migrate_catalog_to_current_version(connection: &Connection) -> Result<()> {
    let version = catalog_user_version(connection)?;
    if version > FORMAT_VERSION {
        return Err(HistoryError::UnsupportedFormat(version));
    }
    if version == FORMAT_VERSION && missing_catalog_columns(connection)?.is_empty() {
        return Ok(());
    }
    let transaction =
        rusqlite::Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
    let version = catalog_user_version(&transaction)?;
    if version > FORMAT_VERSION {
        return Err(HistoryError::UnsupportedFormat(version));
    }
    let missing = missing_catalog_columns(&transaction)?;
    let requires_backfill =
        version < FORMAT_VERSION || missing.iter().any(|column| column.backfilled);
    for column in missing {
        let (name, declaration) = (column.name, column.declaration);
        transaction.execute_batch(&format!(
            "ALTER TABLE checkpoints ADD COLUMN {name} {declaration};"
        ))?;
    }
    if requires_backfill {
        for checkpoint in query_checkpoints_oldest_first(&transaction)? {
            let manifest = load_visible_manifest(&transaction, &checkpoint.snapshot_root)?;
            let budget = portable_checkpoint_budget(&checkpoint, &manifest)?;
            let unstored = manifest_unstored_totals(&manifest)?;
            transaction.execute(
                "UPDATE checkpoints
                 SET portable_metadata_bytes = ?2, chunk_references = ?3,
                     unstored_file_count = ?4, unstored_logical_bytes = ?5
                 WHERE snapshot_root = ?1",
                params![
                    checkpoint.snapshot_root.as_hex(),
                    budget.metadata_bytes as i64,
                    budget.chunk_references as i64,
                    unstored.file_count as i64,
                    unstored.logical_bytes as i64,
                ],
            )?;
        }
    }
    if version != FORMAT_VERSION {
        transaction.execute_batch(&format!("PRAGMA user_version = {FORMAT_VERSION};"))?;
    }
    transaction.commit()?;
    Ok(())
}

fn checkpoint_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Checkpoint> {
    let summary_bytes = row.get::<_, i64>(9)?;
    if summary_bytes < 0 || summary_bytes as u64 > MAX_EXPORT_HEADER_BYTES {
        return Err(to_sql_conversion_error(HistoryError::Corrupt(
            "checkpoint summary exceeds the portable header limit".into(),
        )));
    }
    let root: String = row.get(0)?;
    let output_hash: String = row.get(5)?;
    let replayed_inputs_json: String = row.get(8)?;
    let snapshot_root = SnapshotRoot::from_hex(&root).map_err(to_sql_conversion_error)?;
    let output_hash = ContentHash::from_hex(&output_hash).map_err(to_sql_conversion_error)?;
    Ok(Checkpoint {
        snapshot_root,
        completed_at_unix_ms: row.get(1)?,
        engine: row.get(2)?,
        toolchain_identity: row.get(3)?,
        main_document: row.get(4)?,
        output_hash,
        file_count: row.get::<_, i64>(6)? as u64,
        logical_bytes: row.get::<_, i64>(7)? as u64,
        replayed_inputs: decode_replayed_inputs(&replayed_inputs_json)
            .map_err(to_sql_conversion_error)?,
        portable_metadata_bytes: row.get::<_, i64>(10)? as u64,
        chunk_references: row.get::<_, i64>(11)? as u64,
        unstored_file_count: row.get::<_, i64>(12)? as u64,
        unstored_logical_bytes: row.get::<_, i64>(13)? as u64,
        label: row.get(14)?,
    })
}

fn load_visible_manifest(connection: &Connection, root: &SnapshotRoot) -> Result<Manifest> {
    let bounded_bytes = connection
        .query_row(
            "SELECT length(CAST(m.manifest_json AS BLOB)), m.manifest_json
             FROM manifests m JOIN checkpoints c ON c.snapshot_root = m.snapshot_root
             WHERE m.snapshot_root = ?1",
            [root.as_hex()],
            |row| {
                let manifest_bytes = row.get::<_, i64>(0)?;
                if manifest_bytes < 0 || manifest_bytes as u64 > MAX_EXPORT_HEADER_BYTES {
                    return Ok(None);
                }
                row.get::<_, Vec<u8>>(1).map(Some)
            },
        )
        .optional()?
        .ok_or_else(|| HistoryError::CheckpointNotFound(root.as_hex()))?;
    let bytes = bounded_bytes.ok_or_else(|| {
        HistoryError::Corrupt("manifest exceeds the portable header limit".into())
    })?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn verify_manifest_root(expected: &SnapshotRoot, manifest: &Manifest) -> Result<()> {
    verify_archive_manifest(manifest)?;
    let actual = compute_snapshot_root(manifest)?;
    if &actual != expected {
        return Err(HistoryError::Corrupt(format!(
            "manifest root is {actual}, expected {expected}"
        )));
    }
    Ok(())
}

fn verify_file_digest(
    manifest_file: &ManifestFile,
    actual_size: u64,
    hasher: &blake3::Hasher,
) -> Result<()> {
    if actual_size != manifest_file.logical_size {
        return Err(HistoryError::Corrupt(format!(
            "file {} has length {actual_size}, expected {}",
            manifest_file.path, manifest_file.logical_size
        )));
    }
    let actual_hash = encode_hex(hasher.finalize().as_bytes());
    if actual_hash != manifest_file.content_hash {
        return Err(HistoryError::Corrupt(format!(
            "file {} failed BLAKE3 verification",
            manifest_file.path
        )));
    }
    Ok(())
}

fn verify_archive_manifest(manifest: &Manifest) -> Result<()> {
    if manifest.format_version == 0 || manifest.format_version > FORMAT_VERSION {
        return Err(HistoryError::UnsupportedFormat(manifest.format_version));
    }
    if manifest.files.is_empty() {
        return Err(HistoryError::InvalidInput(
            "portable checkpoint contains no files".into(),
        ));
    }
    validate_portable_path_set(manifest.files.iter().map(|file| file.path.as_str()))?;
    let mut previous: Option<&str> = None;
    let mut has_project_json = false;
    for file in &manifest.files {
        validate_portable_relative_path(&file.path)?;
        if previous.is_some_and(|path| path >= file.path.as_str()) {
            return Err(HistoryError::InvalidInput(
                "portable checkpoint paths are duplicated or unsorted".into(),
            ));
        }
        previous = Some(&file.path);
        has_project_json |= file.path == "project.json";
        if !file.stored {
            if manifest.format_version < UNSTORED_MANIFEST_VERSION {
                return Err(HistoryError::Corrupt(format!(
                    "file {} omits its bytes in a version {} manifest",
                    file.path, manifest.format_version
                )));
            }
            if file.path == "project.json" {
                return Err(HistoryError::InvalidInput(
                    "project.json must always retain its checkpoint bytes".into(),
                ));
            }
            if !file.chunks.is_empty() {
                return Err(HistoryError::Corrupt(format!(
                    "file {} omits its bytes but references chunks",
                    file.path
                )));
            }
            ContentHash::from_hex(&file.content_hash)?;
            continue;
        }
        let chunk_bytes = file.chunks.iter().try_fold(0_u64, |total, chunk| {
            ContentHash::from_hex(&chunk.hash)?;
            total
                .checked_add(chunk.raw_len)
                .ok_or_else(|| HistoryError::Corrupt("file length overflow".into()))
        })?;
        if chunk_bytes != file.logical_size {
            return Err(HistoryError::Corrupt(format!(
                "file {} chunk lengths do not match its logical length",
                file.path
            )));
        }
        ContentHash::from_hex(&file.content_hash)?;
    }
    if !has_project_json {
        return Err(HistoryError::MissingProjectManifest);
    }
    Ok(())
}

fn read_portable_checkpoint_metadata<R: Read>(reader: &mut R) -> Result<(PortableCheckpoint, u64)> {
    let mut magic = vec![0_u8; EXPORT_MAGIC.len()];
    reader.read_exact(&mut magic)?;
    if magic != EXPORT_MAGIC {
        return Err(HistoryError::InvalidInput(
            "portable history contains an invalid checkpoint record".into(),
        ));
    }
    let mut length = [0_u8; 8];
    reader.read_exact(&mut length)?;
    let header_len = u64::from_le_bytes(length);
    if header_len == 0 || header_len > MAX_EXPORT_HEADER_BYTES {
        return Err(HistoryError::InvalidInput(format!(
            "portable checkpoint header length {header_len} is invalid"
        )));
    }
    let mut header = vec![0_u8; header_len as usize];
    reader.read_exact(&mut header)?;
    let metadata: PortableCheckpoint = serde_json::from_slice(&header)?;
    if metadata.export_version != 1 {
        return Err(HistoryError::UnsupportedFormat(metadata.export_version));
    }
    Ok((metadata, header_len))
}

fn to_sql_conversion_error(error: HistoryError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn query_count(connection: &Connection, table: &str) -> Result<u64> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    Ok(connection.query_row(&sql, [], |row| row.get::<_, i64>(0))? as u64)
}

fn validate_real_directory(path: &Path, label: &str) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        HistoryError::Corrupt(format!(
            "{label} {} cannot be inspected: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(HistoryError::Corrupt(format!(
            "{label} {} is not a real directory",
            path.display()
        )));
    }
    Ok(())
}

fn validate_regular_file(path: &Path, label: &str) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        HistoryError::Corrupt(format!(
            "{label} {} cannot be inspected: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(HistoryError::Corrupt(format!(
            "{label} {} is not a regular file",
            path.display()
        )));
    }
    Ok(())
}

fn open_with_no_follow(options: &mut OpenOptions, path: &Path) -> io::Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;

        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;

        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn store_parent(root: &Path) -> Result<&Path> {
    root.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            HistoryError::InvalidInput("checkpoint store must have a parent directory".into())
        })
}

fn store_name(root: &Path) -> Result<&std::ffi::OsStr> {
    root.file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| HistoryError::InvalidInput("checkpoint store has no directory name".into()))
}

fn open_namespace_lock(parent: &Path, create: bool) -> Result<File> {
    let path = parent.join(NAMESPACE_LOCK_FILE);
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint namespace lock {} is not a regular file",
                path.display()
            )));
        }
    }
    let mut options = OpenOptions::new();
    options.create(create).read(true).write(true);
    let file = open_with_no_follow(&mut options, &path)?;
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(HistoryError::Corrupt(format!(
            "checkpoint namespace lock {} is not a regular file",
            path.display()
        )));
    }
    if create {
        set_private_file_permissions(&path)?;
        sync_directory(parent)?;
    }
    Ok(file)
}

fn initialization_lock_path(parent: &Path, name: &std::ffi::OsStr) -> PathBuf {
    parent.join(format!(
        "{INITIALIZATION_LOCK_PREFIX}{}.lock",
        store_name_hash(name)
    ))
}

fn open_initialization_lock(parent: &Path, name: &std::ffi::OsStr) -> Result<File> {
    let path = initialization_lock_path(parent, name);
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint initialization lock {} is not a regular file",
                path.display()
            )));
        }
    }
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
    let file = open_with_no_follow(&mut options, &path)?;
    validate_regular_file(&path, "checkpoint initialization lock")?;
    set_private_file_permissions(&path)?;
    sync_directory(parent)?;
    Ok(file)
}

fn lock_initialization(parent: &Path, name: &std::ffi::OsStr, wait: bool) -> Result<Option<File>> {
    let path = initialization_lock_path(parent, name);
    let file = open_initialization_lock(parent, name)?;
    let opened = same_file::Handle::from_file(file.try_clone()?)?;
    if opened != same_file::Handle::from_path(&path)? {
        return Err(HistoryError::Corrupt(format!(
            "checkpoint initialization lock changed while it was opened: {}",
            path.display()
        )));
    }
    if wait {
        fs4::FileExt::lock(&file)?;
    } else {
        match fs4::FileExt::try_lock(&file) {
            Ok(()) => {}
            Err(fs4::TryLockError::WouldBlock) => return Ok(None),
            Err(fs4::TryLockError::Error(error)) => return Err(error.into()),
        }
    }
    if opened != same_file::Handle::from_path(&path)? {
        return Err(HistoryError::Corrupt(format!(
            "checkpoint initialization lock changed while it was acquired: {}",
            path.display()
        )));
    }
    Ok(Some(file))
}

fn initialization_directory_prefix(name: &std::ffi::OsStr) -> String {
    format!("{INITIALIZATION_DIR_PREFIX}{}-", store_name_hash(name))
}

fn create_initialization_directory(parent: &Path, name: &std::ffi::OsStr) -> Result<PathBuf> {
    let prefix = initialization_directory_prefix(name);
    for _ in 0..32 {
        let token = generate_delete_token();
        let path = parent.join(format!("{prefix}{token}"));
        match fs::create_dir(&path) {
            Ok(()) => {
                set_private_directory_permissions(&path)?;
                sync_directory(parent)?;
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(HistoryError::Corrupt(
        "could not reserve a checkpoint initialization directory".into(),
    ))
}

fn reap_initialization_directories(parent: &Path, name: &std::ffi::OsStr) -> Result<()> {
    let prefix = initialization_directory_prefix(name);
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(token) = file_name.strip_prefix(&prefix) else {
            continue;
        };
        if !valid_delete_token(token) {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint initialization directory has an invalid name {file_name:?}"
            )));
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint initialization path {} is not a real directory",
                path.display()
            )));
        }
        remove_path_without_following_links(&path)?;
        sync_directory(parent)?;
    }
    Ok(())
}

fn store_name_hash(name: &std::ffi::OsStr) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"oleafly-checkpoint-store-name-v1\0");
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;
        hasher.update(name.as_bytes());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt as _;
        for unit in name.encode_wide() {
            hasher.update(&unit.to_le_bytes());
        }
    }
    #[cfg(not(any(unix, windows)))]
    hasher.update(name.to_string_lossy().as_bytes());
    encode_hex(hasher.finalize().as_bytes())
}

fn valid_delete_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn generate_delete_token() -> String {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    encode_hex(&bytes)
}

fn detached_store_path(parent: &Path, name: &std::ffi::OsStr, token: &str) -> PathBuf {
    let mut detached = std::ffi::OsString::from(".");
    detached.push(name);
    detached.push(".deleting.");
    detached.push(token);
    parent.join(detached)
}

fn delete_record_path(parent: &Path, name_hash: &str, token: &str) -> PathBuf {
    parent.join(format!(
        "{DELETE_RECORD_PREFIX}{name_hash}-{token}{DELETE_RECORD_SUFFIX}"
    ))
}

fn read_delete_record(
    path: &Path,
    expected_name_hash: &str,
    expected_token: &str,
) -> Result<DeleteRecord> {
    validate_regular_file(path, "checkpoint delete record")?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = open_with_no_follow(&mut options, path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let record: DeleteRecord = serde_json::from_slice(&bytes)?;
    if record.version != DELETE_RECORD_VERSION
        || record.store_name_hash != expected_name_hash
        || record.token != expected_token
        || !valid_delete_token(&record.token)
    {
        return Err(HistoryError::Corrupt(format!(
            "checkpoint delete record {} does not match its store identity",
            path.display()
        )));
    }
    Ok(record)
}

fn delete_records(parent: &Path, name: &std::ffi::OsStr) -> Result<Vec<(PathBuf, DeleteRecord)>> {
    let name_hash = store_name_hash(name);
    let prefix = format!("{DELETE_RECORD_PREFIX}{name_hash}-");
    let mut records = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(token) = file_name
            .strip_prefix(&prefix)
            .and_then(|rest| rest.strip_suffix(DELETE_RECORD_SUFFIX))
        else {
            continue;
        };
        if !valid_delete_token(token) {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint delete record has an invalid name {file_name:?}"
            )));
        }
        let path = entry.path();
        let record = read_delete_record(&path, &name_hash, token)?;
        records.push((path, record));
    }
    records.sort_by(|left, right| left.1.token.cmp(&right.1.token));
    Ok(records)
}

fn prepare_delete_record(parent: &Path, name: &std::ffi::OsStr) -> Result<(PathBuf, DeleteRecord)> {
    let existing = delete_records(parent, name)?;
    if existing.len() > 1 {
        return Err(HistoryError::Corrupt(
            "multiple pending delete records exist for one checkpoint store".into(),
        ));
    }
    if let Some(record) = existing.into_iter().next() {
        return Ok(record);
    }

    let name_hash = store_name_hash(name);
    for _ in 0..10_000 {
        let token = generate_delete_token();
        let record = DeleteRecord {
            version: DELETE_RECORD_VERSION,
            store_name_hash: name_hash.clone(),
            token: token.clone(),
        };
        let path = delete_record_path(parent, &name_hash, &token);
        let temporary = parent.join(format!(
            ".checkpoint-delete-record-{}-{token}.tmp",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        let mut file = match open_with_no_follow(&mut options, &temporary) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        let result = (|| {
            let bytes = serde_json::to_vec(&record)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            set_private_file_permissions(&temporary)?;
            drop(file);
            fs::rename(&temporary, &path)?;
            sync_directory(parent)?;
            Ok((path, record))
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        return result;
    }
    Err(HistoryError::Corrupt(
        "could not reserve a checkpoint delete record".into(),
    ))
}

fn remove_delete_record(path: &Path) -> Result<()> {
    validate_regular_file(path, "checkpoint delete record")?;
    fs::remove_file(path)?;
    Ok(())
}

fn reap_detached_stores(
    parent: &Path,
    name: &std::ffi::OsStr,
    live_root_exists: bool,
) -> Result<bool> {
    let mut removed = false;
    for (record_path, record) in delete_records(parent, name)? {
        let detached = detached_store_path(parent, name, &record.token);
        match fs::symlink_metadata(&detached) {
            Ok(metadata) => {
                if !metadata.is_dir()
                    || metadata.file_type().is_symlink()
                    || is_reparse_point(&metadata)
                {
                    return Err(HistoryError::Corrupt(format!(
                        "detached checkpoint store {} is not a real directory",
                        detached.display()
                    )));
                }
                remove_detached_store(&detached)?;
                sync_directory(parent)?;
                remove_delete_record(&record_path)?;
                sync_directory(parent)?;
                removed = true;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if !live_root_exists {
                    // The detached directory was fully removed and only its
                    // durable completion record survived the prior attempt.
                    remove_delete_record(&record_path)?;
                    sync_directory(parent)?;
                    removed = true;
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(removed)
}

fn remove_detached_store(root: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(HistoryError::Corrupt(format!(
            "detached checkpoint store {} is not a real directory",
            root.display()
        )));
    }
    let operation_lock = root.join(OPERATION_LOCK_FILE);
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.path() == operation_lock {
            continue;
        }
        remove_path_without_following_links(&entry.path())?;
    }
    sync_directory(root)?;
    match fs::remove_file(&operation_lock) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    fs::remove_dir(root)?;
    Ok(())
}

fn remove_path_without_following_links(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || metadata.is_file() {
        fs::remove_file(path)?;
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err(HistoryError::Corrupt(format!(
            "checkpoint store contains an unsupported entry {}",
            path.display()
        )));
    }
    for entry in fs::read_dir(path)? {
        remove_path_without_following_links(&entry?.path())?;
    }
    fs::remove_dir(path)?;
    Ok(())
}

fn remove_orphan_pack_files(root: &Path, connection: &Connection) -> Result<()> {
    let mut known = HashSet::new();
    let mut statement = connection.prepare("SELECT pack_id, file_name FROM packs")?;
    for row in statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (pack_id, file_name) = row?;
        known.insert(validated_pack_file_name(&pack_id, &file_name)?);
    }
    for entry in fs::read_dir(root.join("packs"))? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HistoryError::Corrupt(format!(
                "checkpoint packs directory contains an unsupported entry {}",
                entry.path().display()
            )));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let name = validated_orphan_pack_file_name(&name)?;
        if !known.contains(&name) {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn validated_pack_file_name(pack_id: &str, file_name: &str) -> Result<String> {
    let canonical_id = ContentHash::from_hex(pack_id)?.to_hex();
    if pack_id != canonical_id {
        return Err(HistoryError::Corrupt(format!(
            "pack id {pack_id:?} is not canonical lowercase BLAKE3"
        )));
    }
    let expected = format!("{canonical_id}.pack");
    if file_name != expected {
        return Err(HistoryError::Corrupt(format!(
            "pack {canonical_id} has invalid file name {file_name:?}"
        )));
    }
    Ok(expected)
}

fn validated_orphan_pack_file_name(file_name: &str) -> Result<String> {
    let pack_id = file_name.strip_suffix(".pack").ok_or_else(|| {
        HistoryError::Corrupt(format!(
            "checkpoint packs directory contains invalid file {file_name:?}"
        ))
    })?;
    validated_pack_file_name(pack_id, file_name)
}

fn remove_stale_staging(root: &Path) -> Result<()> {
    let staging = root.join("staging");
    for entry in fs::read_dir(&staging)? {
        remove_path_without_following_links(&entry?.path())?;
    }
    sync_directory(&staging)
}

fn initialize_format(root: &Path) -> Result<()> {
    if root.join("format.json").exists() {
        validate_existing_format(root)?;
        return Ok(());
    }
    write_format_marker(root)
}

fn upgrade_existing_format(root: &Path) -> Result<()> {
    if validate_existing_format(root)? == FORMAT_VERSION {
        return Ok(());
    }
    write_format_marker(root)
}

fn write_format_marker(root: &Path) -> Result<()> {
    #[derive(Deserialize, Serialize)]
    struct FormatMarker<'a> {
        format: &'a str,
        version: u32,
        hash: &'a str,
        chunker: &'a str,
        compression: &'a str,
    }

    let marker_path = root.join("format.json");
    let marker = FormatMarker {
        format: "oleafly-checkpoints",
        version: FORMAT_VERSION,
        hash: "blake3",
        chunker: "fastcdc-v2020-256k-1m-4m",
        compression: "zstd-3-if-smaller",
    };
    let bytes = serde_json::to_vec_pretty(&marker)?;
    let unique = CANDIDATE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = root.join(format!(".format.json.{}.{unique}.tmp", std::process::id()));
    {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    set_private_file_permissions(&temporary)?;
    if let Err(error) = fs::rename(&temporary, &marker_path) {
        let _ = fs::remove_file(&temporary);
        if !marker_path.exists() {
            return Err(error.into());
        }
        validate_existing_format(root)?;
    }
    sync_directory(root)?;
    Ok(())
}

fn validate_existing_format(root: &Path) -> Result<u32> {
    #[derive(Deserialize)]
    struct ExistingFormat {
        format: String,
        version: u32,
        hash: String,
        chunker: String,
        compression: String,
    }

    let marker_path = root.join("format.json");
    validate_regular_file(&marker_path, "checkpoint format marker")?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut marker_file = open_with_no_follow(&mut options, &marker_path)?;
    let mut bytes = Vec::new();
    marker_file.read_to_end(&mut bytes)?;
    let marker: ExistingFormat = serde_json::from_slice(&bytes)?;
    if marker.format != "oleafly-checkpoints"
        || marker.version == 0
        || marker.version > FORMAT_VERSION
    {
        return Err(HistoryError::UnsupportedFormat(marker.version));
    }
    if marker.hash != "blake3"
        || marker.chunker != "fastcdc-v2020-256k-1m-4m"
        || marker.compression != "zstd-3-if-smaller"
    {
        return Err(HistoryError::Corrupt(
            "checkpoint format algorithms do not match a supported checkpoint store".into(),
        ));
    }
    Ok(marker.version)
}

fn validate_portable_relative_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains(':')
        || path.chars().any(char::is_control)
    {
        return Err(HistoryError::InvalidInput(format!(
            "{path:?} is not a portable project-relative path"
        )));
    }
    if path.nfc().collect::<String>() != path {
        return Err(HistoryError::InvalidInput(format!(
            "{path:?} is not normalized as portable Unicode NFC"
        )));
    }
    let components = path.split('/').collect::<Vec<_>>();
    if components.iter().any(|component| {
        component.is_empty()
            || *component == "."
            || *component == ".."
            || component.ends_with(['.', ' '])
            || is_windows_reserved_component(component)
    }) {
        return Err(HistoryError::InvalidInput(format!(
            "{path:?} is not a normalized project-relative path"
        )));
    }
    let first = components.first().copied().unwrap_or_default();
    if first.eq_ignore_ascii_case(".git") || first.eq_ignore_ascii_case(".oleafly") {
        return Err(HistoryError::InvalidInput(format!(
            "{path:?} is inside a protected project-internal root"
        )));
    }
    Ok(())
}

fn is_windows_reserved_component(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or_default();
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn validate_portable_path_set<'a>(paths: impl IntoIterator<Item = &'a str>) -> Result<()> {
    let mut casefolded = HashSet::new();
    let mut ordered = Vec::new();
    for path in paths {
        validate_portable_relative_path(path)?;
        let folded = path.nfc().flat_map(char::to_lowercase).collect::<String>();
        if !casefolded.insert(folded.clone()) {
            return Err(HistoryError::InvalidInput(format!(
                "portable project paths collide after case folding: {path}"
            )));
        }
        ordered.push((folded, path));
    }
    ordered.sort_by(|left, right| left.0.cmp(&right.0));
    for pair in ordered.windows(2) {
        let (parent_folded, parent) = &pair[0];
        let (child_folded, child) = &pair[1];
        if child_folded
            .strip_prefix(parent_folded.as_str())
            .is_some_and(|suffix| suffix.starts_with('/'))
        {
            return Err(HistoryError::InvalidInput(format!(
                "portable project path {parent} conflicts with descendant {child}"
            )));
        }
    }
    Ok(())
}

fn path_from_portable(path: &str) -> PathBuf {
    path.split('/').collect()
}

fn validate_unsymlinked_regular_file(
    project_root: &Path,
    relative_path: &str,
) -> Result<fs::Metadata> {
    let components = relative_path.split('/').collect::<Vec<_>>();
    let mut current = project_root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HistoryError::InvalidInput(format!(
                "proven input {relative_path} contains a symbolic link or reparse point"
            )));
        }
        let is_final = index + 1 == components.len();
        if (is_final && !metadata.is_file()) || (!is_final && !metadata.is_dir()) {
            return Err(HistoryError::InvalidInput(format!(
                "proven input {relative_path} must be a regular file beneath real directories"
            )));
        }
        if is_final {
            return Ok(metadata);
        }
    }
    Err(HistoryError::InvalidInput(format!(
        "proven input {relative_path} must be a regular file"
    )))
}

fn create_candidate_directory(staging_root: &Path) -> Result<PathBuf> {
    for _ in 0..100 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let counter = CANDIDATE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate =
            staging_root.join(format!("candidate-{}-{now}-{counter}", std::process::id()));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                set_private_directory_permissions(&candidate)?;
                return Ok(candidate);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(HistoryError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique checkpoint candidate directory",
    )))
}

fn hash_file(path: &Path) -> Result<ContentHash> {
    hash_file_controlled(path, &UncancelledPublication)
}

fn hash_file_controlled(path: &Path, gate: &dyn PublicationGate) -> Result<ContentHash> {
    ensure_publication_active(gate)?;
    validate_regular_file(path, "checkpoint payload")?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = open_with_no_follow(&mut options, path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_publication_active(gate)?;
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    ensure_publication_active(gate)?;
    Ok(ContentHash::from_bytes(*hasher.finalize().as_bytes()))
}

fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn generate_store_lineage() -> String {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = encode_hex(&bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn validate_store_lineage(lineage: &str) -> Result<()> {
    let bytes = lineage.as_bytes();
    let valid = bytes.len() == STORE_LINEAGE_BYTES
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
            }
        });
    if !valid {
        return Err(HistoryError::Corrupt(format!(
            "invalid checkpoint store lineage {lineage:?}"
        )));
    }
    Ok(())
}

fn decode_hex_32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_digit(pair[0])?;
        let low = decode_hex_digit(pair[1])?;
        decoded[index] = (high << 4) | low;
    }
    Some(decoded)
}

fn decode_hex_digit(digit: u8) -> Option<u8> {
    match digit {
        b'0'..=b'9' => Some(digit - b'0'),
        b'a'..=b'f' => Some(digit - b'a' + 10),
        b'A'..=b'F' => Some(digit - b'A' + 10),
        _ => None,
    }
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;

        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)?
            .sync_all()?;
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
    }
    Ok(())
}

fn sync_materialized_directory_tree(root: &Path) -> Result<()> {
    sync_materialized_directory_tree_with(root, sync_directory)
}

fn sync_materialized_directory_tree_with(
    root: &Path,
    mut sync: impl FnMut(&Path) -> Result<()>,
) -> Result<()> {
    fn collect(directory: &Path, directories: &mut Vec<PathBuf>) -> Result<()> {
        let metadata = fs::symlink_metadata(directory)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HistoryError::Corrupt(
                "materialized checkpoint contains an invalid directory".into(),
            ));
        }
        let mut entries = fs::read_dir(directory)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
                return Err(HistoryError::Corrupt(
                    "materialized checkpoint contains a linked path".into(),
                ));
            }
            if metadata.is_dir() {
                collect(&entry.path(), directories)?;
            } else if !metadata.is_file() {
                return Err(HistoryError::Corrupt(
                    "materialized checkpoint contains a non-file path".into(),
                ));
            }
        }
        directories.push(directory.to_path_buf());
        Ok(())
    }

    let mut directories = Vec::new();
    collect(root, &mut directories)?;
    for directory in directories {
        sync(&directory)?;
    }
    let parent = root.parent().ok_or_else(|| {
        HistoryError::InvalidInput("materialization destination has no parent".into())
    })?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if !parent_metadata.is_dir()
        || parent_metadata.file_type().is_symlink()
        || is_reparse_point(&parent_metadata)
    {
        return Err(HistoryError::Corrupt(
            "materialization parent is not a real directory".into(),
        ));
    }
    sync(parent)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn published_test_store(root: &Path) -> (Store, SnapshotRoot) {
        let project = root.join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.tex"), b"source").unwrap();
        let main = project.join("main.tex").canonicalize().unwrap();
        let store = Store::open(root.join("history")).unwrap();
        let candidate = store
            .stage_candidate(
                &project,
                &[
                    CaptureInput::explicit("project.json").unwrap(),
                    CaptureInput::proven("main.tex", &main, ContentHash::digest(b"source"))
                        .unwrap(),
                ],
            )
            .unwrap();
        let snapshot_root = *candidate.snapshot_root();
        let evidence = CompileEvidence::new(
            "tectonic",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"output"),
            1,
            vec![ReplayedInput::new("main.tex", ContentHash::digest(b"source")).unwrap()],
        )
        .unwrap();
        store.publish(candidate, evidence).unwrap();
        (store, snapshot_root)
    }

    fn catalog_user_version_at(root: &Path) -> u32 {
        let connection = Connection::open(root.join("catalog.sqlite3")).unwrap();
        connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn write_legacy_format_marker(root: &Path) {
        let marker = serde_json::json!({
            "format": "oleafly-checkpoints",
            "version": 1,
            "hash": "blake3",
            "chunker": "fastcdc-v2020-256k-1m-4m",
            "compression": "zstd-3-if-smaller",
        });
        fs::write(
            root.join("format.json"),
            serde_json::to_vec_pretty(&marker).unwrap(),
        )
        .unwrap();
    }

    fn rewrite_store_as_version_one(store: &Store, root: &SnapshotRoot) -> SnapshotRoot {
        let connection = store.connection().unwrap();
        let manifest = load_visible_manifest(&connection, root).unwrap();
        let checkpoint = query_checkpoint(&connection, &root.as_hex())
            .unwrap()
            .unwrap();
        let legacy = Manifest {
            format_version: 1,
            files: manifest.files.clone(),
        };
        let legacy_root = compute_snapshot_root(&legacy).unwrap();
        assert_ne!(legacy_root, *root);
        let legacy_json = serde_json::to_vec(&legacy).unwrap();
        assert!(!String::from_utf8(legacy_json.clone())
            .unwrap()
            .contains("stored"));

        connection
            .execute(
                "INSERT INTO manifests(snapshot_root, manifest_json) VALUES (?1, ?2)",
                params![legacy_root.as_hex(), &legacy_json],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO manifest_chunks(snapshot_root, chunk_hash)
                 SELECT ?1, chunk_hash FROM manifest_chunks WHERE snapshot_root = ?2",
                params![legacy_root.as_hex(), root.as_hex()],
            )
            .unwrap();
        connection
            .execute_batch(
                "DROP TABLE checkpoints;
                 CREATE TABLE checkpoints(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_root TEXT NOT NULL UNIQUE REFERENCES manifests(snapshot_root),
                    completed_at_unix_ms INTEGER NOT NULL CHECK(completed_at_unix_ms >= 0),
                    engine TEXT NOT NULL,
                    toolchain_identity TEXT NOT NULL,
                    main_document TEXT NOT NULL,
                    output_hash TEXT NOT NULL,
                    replayed_inputs_json TEXT NOT NULL
                    ,file_count INTEGER NOT NULL CHECK(file_count >= 0)
                    ,logical_bytes INTEGER NOT NULL CHECK(logical_bytes >= 0)
                 );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO checkpoints(
                    snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    legacy_root.as_hex(),
                    checkpoint.completed_at_unix_ms,
                    checkpoint.engine,
                    checkpoint.toolchain_identity,
                    checkpoint.main_document,
                    checkpoint.output_hash.to_hex(),
                    checkpoint.file_count as i64,
                    checkpoint.logical_bytes as i64,
                    encode_replayed_inputs(&checkpoint.replayed_inputs).unwrap(),
                ],
            )
            .unwrap();
        connection
            .execute(
                "DELETE FROM manifests WHERE snapshot_root = ?1",
                [root.as_hex()],
            )
            .unwrap();
        connection
            .execute_batch("PRAGMA user_version = 1;")
            .unwrap();
        drop(connection);
        write_legacy_format_marker(store.root());
        legacy_root
    }

    #[test]
    fn version_one_catalog_and_manifest_migrate_in_place_on_open() {
        for reopen_existing in [false, true] {
            let temp = tempdir().unwrap();
            let (store, root) = published_test_store(temp.path());
            let history = store.root().to_path_buf();
            let legacy_root = rewrite_store_as_version_one(&store, &root);
            drop(store);
            assert_eq!(catalog_user_version_at(&history), 1);
            assert_eq!(validate_existing_format(&history).unwrap(), 1);

            let migrated = if reopen_existing {
                Store::open_existing(&history).unwrap().unwrap()
            } else {
                Store::open(&history).unwrap()
            };

            assert_eq!(catalog_user_version_at(&history), FORMAT_VERSION);
            assert_eq!(validate_existing_format(&history).unwrap(), FORMAT_VERSION);
            let checkpoint = migrated.checkpoint(&legacy_root).unwrap().unwrap();
            assert_eq!(checkpoint.file_count, 2);
            assert!(checkpoint.portable_metadata_bytes > 0);
            assert_eq!(checkpoint.chunk_references, 2);
            assert_eq!(checkpoint.unstored_file_count, 0);
            assert_eq!(checkpoint.unstored_logical_bytes, 0);

            let verified = migrated.verify().unwrap();
            assert_eq!(verified.checked_checkpoints, 1);
            assert_eq!(verified.checked_files, 2);
            let files = migrated.checkpoint_files(&legacy_root).unwrap().unwrap();
            assert_eq!(files.len(), 2);
            assert!(files.iter().all(|file| file.stored));

            let restored = temp.path().join("restored");
            let materialized = migrated.materialize(&legacy_root, &restored).unwrap();
            assert_eq!(materialized.file_count, 2);
            assert!(materialized.omitted.is_empty());
            assert_eq!(fs::read(restored.join("main.tex")).unwrap(), b"source");

            let mut archive = Vec::new();
            migrated.export_history(&mut archive).unwrap();
            let elsewhere = Store::open(temp.path().join("elsewhere")).unwrap();
            assert_eq!(
                elsewhere
                    .import_history(archive.as_slice())
                    .unwrap()
                    .created_checkpoints,
                1
            );
            assert!(elsewhere.checkpoint(&legacy_root).unwrap().is_some());
        }
    }

    #[test]
    fn checkpoint_labels_are_trimmed_validated_and_clearable() {
        let temp = tempdir().unwrap();
        let (store, root) = published_test_store(temp.path());
        let unlabeled_metadata_bytes = store
            .checkpoint(&root)
            .unwrap()
            .unwrap()
            .portable_metadata_bytes;
        assert!(store.checkpoint(&root).unwrap().unwrap().label.is_none());

        let labeled = store
            .set_checkpoint_label(&root, "  Submission draft  ")
            .unwrap();
        assert_eq!(labeled.label.as_deref(), Some("Submission draft"));
        assert!(labeled.portable_metadata_bytes > unlabeled_metadata_bytes);
        assert_eq!(
            store.list().unwrap()[0].label.as_deref(),
            Some("Submission draft")
        );

        assert_eq!(
            store
                .set_checkpoint_label(&root, &"e".repeat(80))
                .unwrap()
                .label,
            Some("e".repeat(80))
        );
        assert!(matches!(
            store.set_checkpoint_label(&root, &"e".repeat(81)),
            Err(HistoryError::InvalidInput(_))
        ));
        assert!(matches!(
            store.set_checkpoint_label(&root, "draft\nv2"),
            Err(HistoryError::InvalidInput(_))
        ));
        assert_eq!(
            store.checkpoint(&root).unwrap().unwrap().label,
            Some("e".repeat(80))
        );

        let cleared = store.set_checkpoint_label(&root, "   ").unwrap();
        assert!(cleared.label.is_none());
        assert_eq!(cleared.portable_metadata_bytes, unlabeled_metadata_bytes);
        assert!(store.checkpoint(&root).unwrap().unwrap().label.is_none());

        let absent = SnapshotRoot::parse(&ContentHash::digest(b"absent").to_hex()).unwrap();
        assert!(matches!(
            store.set_checkpoint_label(&absent, "Anything"),
            Err(HistoryError::CheckpointNotFound(_))
        ));
    }

    #[test]
    fn checkpoint_labels_survive_export_and_import() {
        let temp = tempdir().unwrap();
        let (store, root) = published_test_store(temp.path());
        let mut unlabeled_archive = Vec::new();
        store
            .export_checkpoint(&root, &mut unlabeled_archive)
            .unwrap();
        assert!(!String::from_utf8_lossy(&unlabeled_archive).contains("\"label\""));

        store
            .set_checkpoint_label(&root, "Submission draft")
            .unwrap();

        let mut history_archive = Vec::new();
        store.export_history(&mut history_archive).unwrap();
        let restored = Store::open(temp.path().join("restored-history")).unwrap();
        assert_eq!(
            restored
                .import_history(history_archive.as_slice())
                .unwrap()
                .created_checkpoints,
            1
        );
        assert_eq!(
            restored
                .checkpoint(&root)
                .unwrap()
                .unwrap()
                .label
                .as_deref(),
            Some("Submission draft")
        );

        let mut single_archive = Vec::new();
        store.export_checkpoint(&root, &mut single_archive).unwrap();
        let single = Store::open(temp.path().join("single-history")).unwrap();
        assert!(matches!(
            single.import_checkpoint(single_archive.as_slice()).unwrap(),
            PublishOutcome::Created(checkpoint)
                if checkpoint.label.as_deref() == Some("Submission draft")
        ));
        assert_eq!(
            single.checkpoint(&root).unwrap().unwrap().label.as_deref(),
            Some("Submission draft")
        );
    }

    #[test]
    fn a_catalog_without_the_label_column_gains_it_without_a_budget_backfill() {
        let temp = tempdir().unwrap();
        let (store, root) = published_test_store(temp.path());
        let history = store.root().to_path_buf();
        drop(store);
        let connection = Connection::open(history.join("catalog.sqlite3")).unwrap();
        connection
            .execute("UPDATE checkpoints SET portable_metadata_bytes = 7", [])
            .unwrap();
        connection
            .execute_batch("ALTER TABLE checkpoints DROP COLUMN label;")
            .unwrap();
        drop(connection);

        let migrated = Store::open_existing(&history).unwrap().unwrap();
        assert_eq!(catalog_user_version_at(&history), FORMAT_VERSION);
        let checkpoint = migrated.checkpoint(&root).unwrap().unwrap();
        assert!(checkpoint.label.is_none());
        assert_eq!(checkpoint.portable_metadata_bytes, 7);

        let labeled = migrated.set_checkpoint_label(&root, "Kept").unwrap();
        assert_eq!(labeled.label.as_deref(), Some("Kept"));
        assert!(labeled.portable_metadata_bytes > 7);
        drop(migrated);

        let reopened = Store::open_existing(&history).unwrap().unwrap();
        assert_eq!(
            reopened
                .checkpoint(&root)
                .unwrap()
                .unwrap()
                .label
                .as_deref(),
            Some("Kept")
        );
    }

    #[test]
    fn a_catalog_newer_than_this_build_is_never_opened() {
        let temp = tempdir().unwrap();
        let (store, _) = published_test_store(temp.path());
        let history = store.root().to_path_buf();
        drop(store);
        let connection = Connection::open(history.join("catalog.sqlite3")).unwrap();
        connection
            .execute_batch(&format!("PRAGMA user_version = {};", FORMAT_VERSION + 1))
            .unwrap();
        drop(connection);

        assert!(matches!(
            Store::open_existing(&history),
            Err(HistoryError::UnsupportedFormat(version)) if version == FORMAT_VERSION + 1
        ));
        assert!(matches!(
            Store::open(&history),
            Err(HistoryError::UnsupportedFormat(version)) if version == FORMAT_VERSION + 1
        ));
    }

    #[test]
    fn the_stored_flag_changes_a_version_two_root_and_round_trips_as_json() {
        let content_hash = ContentHash::digest(b"");
        let stored = Manifest {
            format_version: FORMAT_VERSION,
            files: vec![
                ManifestFile {
                    path: "figures/data.csv".into(),
                    logical_size: 0,
                    content_hash: content_hash.to_hex(),
                    stored: true,
                    chunks: Vec::new(),
                },
                ManifestFile {
                    path: "project.json".into(),
                    logical_size: 0,
                    content_hash: content_hash.to_hex(),
                    stored: true,
                    chunks: Vec::new(),
                },
            ],
        };
        let mut unstored = stored.clone();
        unstored.files[0].stored = false;

        assert_ne!(
            compute_snapshot_root(&stored).unwrap(),
            compute_snapshot_root(&unstored).unwrap()
        );

        let stored_json = serde_json::to_vec(&stored).unwrap();
        let unstored_json = serde_json::to_vec(&unstored).unwrap();
        assert!(!String::from_utf8(stored_json.clone())
            .unwrap()
            .contains("stored"));
        assert!(String::from_utf8(unstored_json.clone())
            .unwrap()
            .contains(r#""stored":false"#));
        for (manifest, json) in [(&stored, stored_json), (&unstored, unstored_json)] {
            let parsed: Manifest = serde_json::from_slice(&json).unwrap();
            assert_eq!(serde_json::to_vec(&parsed).unwrap(), json);
            assert_eq!(
                compute_snapshot_root(&parsed).unwrap(),
                compute_snapshot_root(manifest).unwrap()
            );
        }
    }

    #[test]
    fn a_version_one_manifest_may_never_omit_stored_bytes() {
        let content_hash = ContentHash::digest(b"");
        let manifest = Manifest {
            format_version: 1,
            files: vec![
                ManifestFile {
                    path: "figures/data.csv".into(),
                    logical_size: 4,
                    content_hash: content_hash.to_hex(),
                    stored: false,
                    chunks: Vec::new(),
                },
                ManifestFile {
                    path: "project.json".into(),
                    logical_size: 0,
                    content_hash: content_hash.to_hex(),
                    stored: true,
                    chunks: Vec::new(),
                },
            ],
        };

        let error = verify_archive_manifest(&manifest).unwrap_err();

        assert!(
            error.to_string().contains("version 1 manifest"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn project_json_can_never_be_recorded_without_its_bytes() {
        let temp = tempdir().unwrap();
        let resolved = temp.path().canonicalize().unwrap().join("project.json");

        assert!(matches!(
            CaptureInput::replay_required_unstored(
                "project.json",
                &resolved,
                ContentHash::digest(b"{}")
            ),
            Err(HistoryError::InvalidInput(_))
        ));
        assert!(CaptureInput::replay_required(
            "project.json",
            &resolved,
            ContentHash::digest(b"{}")
        )
        .is_ok());
    }

    #[test]
    fn capture_budget_is_enforced_before_oversized_chunk_bytes_are_written() {
        assert!(advance_unstored_capture_budget(MAX_CHECKPOINT_FILE_BYTES, 0, 1).is_err());
        assert!(advance_unstored_capture_budget(0, MAX_HISTORY_LOGICAL_BYTES, 1).is_err());
        assert_eq!(advance_unstored_capture_budget(1, 2, 4).unwrap(), (5, 6));
        assert!(advance_capture_budget(MAX_CHECKPOINT_FILE_BYTES, 0, 0, 1).is_err());
        assert!(advance_capture_budget(0, MAX_HISTORY_LOGICAL_BYTES, 0, 1).is_err());
        assert!(advance_capture_budget(0, 0, MAX_HISTORY_CHUNK_REFERENCES, 1).is_err());
        assert_eq!(advance_capture_budget(1, 2, 3, 4).unwrap(), (5, 6, 4));
    }

    #[test]
    fn portable_history_budget_accepts_exact_limits_and_rejects_each_overflow() {
        let one = PortableCheckpointBudget {
            metadata_bytes: 1,
            logical_bytes: 1,
            chunk_references: 1,
        };
        let mut exact = PortableHistoryBudget {
            checkpoint_count: MAX_HISTORY_CHECKPOINTS - 1,
            metadata_bytes: MAX_HISTORY_METADATA_BYTES - 1,
            logical_bytes: MAX_HISTORY_LOGICAL_BYTES - 1,
            chunk_references: MAX_HISTORY_CHUNK_REFERENCES - 1,
        };
        exact.include(one).unwrap();
        assert_eq!(exact.checkpoint_count, MAX_HISTORY_CHECKPOINTS);
        assert_eq!(exact.metadata_bytes, MAX_HISTORY_METADATA_BYTES);
        assert_eq!(exact.logical_bytes, MAX_HISTORY_LOGICAL_BYTES);
        assert_eq!(exact.chunk_references, MAX_HISTORY_CHUNK_REFERENCES);

        for mut usage in [
            PortableHistoryBudget {
                checkpoint_count: MAX_HISTORY_CHECKPOINTS,
                ..PortableHistoryBudget::default()
            },
            PortableHistoryBudget {
                metadata_bytes: MAX_HISTORY_METADATA_BYTES,
                ..PortableHistoryBudget::default()
            },
            PortableHistoryBudget {
                logical_bytes: MAX_HISTORY_LOGICAL_BYTES,
                ..PortableHistoryBudget::default()
            },
            PortableHistoryBudget {
                chunk_references: MAX_HISTORY_CHUNK_REFERENCES,
                ..PortableHistoryBudget::default()
            },
        ] {
            let before = usage;
            assert!(matches!(
                usage.include(one),
                Err(HistoryError::InvalidInput(_))
            ));
            assert_eq!(usage, before);
        }
    }

    #[test]
    fn portable_header_writer_counts_exact_bytes_and_stops_at_limit() {
        let content_hash = ContentHash::digest(b"");
        let manifest = Manifest {
            format_version: FORMAT_VERSION,
            files: vec![
                ManifestFile {
                    path: "main.tex".into(),
                    logical_size: 0,
                    content_hash: content_hash.to_hex(),
                    stored: true,
                    chunks: Vec::new(),
                },
                ManifestFile {
                    path: "project.json".into(),
                    logical_size: 0,
                    content_hash: content_hash.to_hex(),
                    stored: true,
                    chunks: Vec::new(),
                },
            ],
        };
        let snapshot_root = compute_snapshot_root(&manifest).unwrap();
        let output_hash = ContentHash::digest(b"output");
        let checkpoint = Checkpoint {
            snapshot_root,
            completed_at_unix_ms: 17,
            engine: "tectonic".into(),
            toolchain_identity: "tectonic-test@1".into(),
            main_document: "main.tex".into(),
            output_hash,
            file_count: 2,
            logical_bytes: 0,
            label: None,
            replayed_inputs: vec![ReplayedInput::new("main.tex", content_hash).unwrap()],
            portable_metadata_bytes: 0,
            chunk_references: 0,
            unstored_file_count: 0,
            unstored_logical_bytes: 0,
        };
        let metadata = PortableCheckpoint {
            export_version: 1,
            snapshot_root: snapshot_root.as_hex(),
            completed_at_unix_ms: checkpoint.completed_at_unix_ms,
            engine: checkpoint.engine.clone(),
            toolchain_identity: checkpoint.toolchain_identity.clone(),
            main_document: checkpoint.main_document.clone(),
            output_hash: output_hash.to_hex(),
            label: None,
            replayed_inputs: vec![PortableReplayedInput {
                relative_path: "main.tex".into(),
                content_hash: content_hash.to_hex(),
            }],
            manifest: manifest.clone(),
        };
        let canonical = serde_json::to_vec(&metadata).unwrap();
        let exact_limit = canonical.len() as u64;
        let (view, _) = portable_checkpoint_view(&checkpoint, &manifest).unwrap();

        let counted = write_bounded_portable_json(&view, io::sink(), exact_limit).unwrap();
        let mut retained = Vec::new();
        let retained_count =
            write_bounded_portable_json(&view, &mut retained, exact_limit).unwrap();

        assert_eq!(counted, exact_limit);
        assert_eq!(retained_count, exact_limit);
        assert_eq!(retained, canonical);

        let mut rejected = Vec::new();
        let error =
            write_bounded_portable_json(&view, &mut rejected, exact_limit.checked_sub(1).unwrap())
                .unwrap_err();
        assert!(
            error.to_string().contains("header exceeds 16 MiB"),
            "unexpected error: {error}"
        );
        assert!(rejected.len() < canonical.len());
    }

    #[test]
    fn oversized_legacy_checkpoint_summary_is_rejected_before_owned_loading() {
        let temp = tempdir().unwrap();
        let (store, root) = published_test_store(temp.path());
        let connection = store.connection().unwrap();
        connection
            .execute(
                "UPDATE checkpoints
                 SET replayed_inputs_json = CAST(zeroblob(?1) AS TEXT)
                 WHERE snapshot_root = ?2",
                params![MAX_EXPORT_HEADER_BYTES as i64 + 1, root.as_hex()],
            )
            .unwrap();
        drop(connection);

        let error = store.export_history(io::sink()).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("checkpoint summary exceeds the portable header limit"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn oversized_legacy_manifest_is_rejected_before_owned_loading() {
        let temp = tempdir().unwrap();
        let (store, root) = published_test_store(temp.path());
        let connection = store.connection().unwrap();
        connection
            .execute(
                "UPDATE manifests
                 SET manifest_json = zeroblob(?1)
                 WHERE snapshot_root = ?2",
                params![MAX_EXPORT_HEADER_BYTES as i64 + 1, root.as_hex()],
            )
            .unwrap();
        drop(connection);

        let error = store.export_history(io::sink()).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("manifest exceeds the portable header limit"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn portable_budget_replaces_an_existing_root_instead_of_counting_it_twice() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.tex"), b"source").unwrap();
        let main = project.join("main.tex").canonicalize().unwrap();
        let store = Store::open(temp.path().join("history")).unwrap();
        let candidate = store
            .stage_candidate(
                &project,
                &[
                    CaptureInput::explicit("project.json").unwrap(),
                    CaptureInput::proven("main.tex", &main, ContentHash::digest(b"source"))
                        .unwrap(),
                ],
            )
            .unwrap();
        let evidence = CompileEvidence::new(
            "tectonic",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"output"),
            1,
            vec![ReplayedInput::new("main.tex", ContentHash::digest(b"source")).unwrap()],
        )
        .unwrap();
        store.publish(candidate, evidence).unwrap();

        let mut replacement = store.list().unwrap().pop().unwrap();
        replacement.completed_at_unix_ms = 2;
        replacement.toolchain_identity = "tectonic-test@replacement".into();
        let connection = store.connection().unwrap();
        let manifest = load_visible_manifest(&connection, &replacement.snapshot_root).unwrap();
        let expected = portable_checkpoint_budget(&replacement, &manifest).unwrap();
        assert_eq!(
            expected,
            prepare_portable_checkpoint(&replacement, &manifest)
                .unwrap()
                .budget
        );

        let (usage, candidate) =
            validate_portable_history_after_publication(&connection, &replacement, &manifest)
                .unwrap();

        assert_eq!(candidate, expected);
        assert_eq!(
            usage,
            PortableHistoryBudget {
                checkpoint_count: 1,
                metadata_bytes: expected.metadata_bytes,
                logical_bytes: expected.logical_bytes,
                chunk_references: expected.chunk_references,
            }
        );
    }

    #[test]
    fn portable_paths_reject_parent_and_platform_prefixes() {
        for invalid in [
            "",
            "../main.tex",
            "a/../main.tex",
            "/main.tex",
            "C:/main.tex",
            "folder/C:/main.tex",
            "a\\b",
            "notes/\nsecret.tex",
            "aux",
            "CON.tex",
            "chapters/Lpt9.log",
            "trailing-dot./main.tex",
            "trailing-space /main.tex",
            "cafe\u{301}.tex",
        ] {
            assert!(
                CaptureInput::explicit(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        assert_eq!(
            CaptureInput::explicit("chapters/one.tex")
                .unwrap()
                .relative_path(),
            "chapters/one.tex"
        );
        assert!(CaptureInput::explicit("caf\u{e9}.tex").is_ok());
    }

    #[test]
    fn replay_required_inputs_are_bound_to_preseal_bytes_and_replay_closure() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"= Replayed").unwrap();
        let main = project.join("main.typ").canonicalize().unwrap();
        let hash = ContentHash::digest_file(&main).unwrap();
        let store = Store::open(temp.path().join("history")).unwrap();

        let candidate = store
            .stage_candidate(
                &project,
                &[
                    CaptureInput::explicit("project.json").unwrap(),
                    CaptureInput::replay_required("main.typ", &main, hash).unwrap(),
                ],
            )
            .unwrap();

        assert_eq!(candidate.proven_files().len(), 1);
        assert_eq!(candidate.proven_files()[0].relative_path, "main.typ");
        assert_eq!(candidate.proven_files()[0].content_hash, hash);
    }

    #[test]
    fn replay_required_input_rejects_bytes_changed_before_sealing() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"= Before").unwrap();
        let main = project.join("main.typ").canonicalize().unwrap();
        let hash = ContentHash::digest_file(&main).unwrap();
        fs::write(&main, b"= After").unwrap();
        let store = Store::open(temp.path().join("history")).unwrap();

        let error = store
            .stage_candidate(
                &project,
                &[
                    CaptureInput::explicit("project.json").unwrap(),
                    CaptureInput::replay_required("main.typ", &main, hash).unwrap(),
                ],
            )
            .unwrap_err();

        assert!(error
            .to_string()
            .contains("changed before it was sealed for replay"));
    }

    #[test]
    fn digest_file_matches_the_in_memory_blake3_identity() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("large.bin");
        let bytes = vec![0xa5; 2 * 1024 * 1024 + 17];
        fs::write(&path, &bytes).unwrap();

        assert_eq!(
            ContentHash::digest_file(&path).unwrap(),
            ContentHash::digest(&bytes)
        );
    }

    #[test]
    fn nested_materialization_syncs_every_directory_before_its_parent() {
        let temp = tempdir().unwrap();
        let restored = temp.path().join("restored");
        fs::create_dir(&restored).unwrap();
        fs::create_dir_all(restored.join("chapters/deep")).unwrap();
        fs::write(restored.join("chapters/deep/one.tex"), b"source").unwrap();
        let mut synced = Vec::new();

        sync_materialized_directory_tree_with(&restored, |directory| {
            synced.push(directory.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(
            synced,
            vec![
                restored.join("chapters/deep"),
                restored.join("chapters"),
                restored.clone(),
                temp.path().to_path_buf(),
            ]
        );
    }

    #[test]
    fn path_conversion_has_only_normal_components() {
        let path = path_from_portable("a/b.tex");
        assert!(path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_))));
    }

    #[test]
    fn portable_paths_reject_casefold_collisions() {
        assert!(validate_portable_path_set(["project.json", "Main.tex", "main.tex"]).is_err());
        assert!(validate_portable_path_set(["Figures/\u{c9}.tex", "figures/\u{e9}.tex"]).is_err());
        assert!(validate_portable_path_set(["project.json", "chapters/one.tex"]).is_ok());
    }

    #[test]
    fn portable_paths_reject_file_directory_prefix_conflicts() {
        assert!(validate_portable_path_set(["project.json", "project.json/child"]).is_err());
        assert!(validate_portable_path_set(["Figures", "figures/plot.png"]).is_err());
        assert!(validate_portable_path_set(["main.tex", "main.tex.bak"]).is_ok());
    }

    #[test]
    fn publication_faults_never_expose_a_root_and_reopen_removes_orphan_packs() {
        for (index, fault) in [
            PublishFault::AfterPackPublished,
            PublishFault::BeforeVisibleRoot,
            PublishFault::BeforeCommit,
        ]
        .into_iter()
        .enumerate()
        {
            let temp = tempdir().unwrap();
            let project = temp.path().join(format!("project-{index}"));
            fs::create_dir(&project).unwrap();
            fs::write(project.join("project.json"), b"{}").unwrap();
            fs::write(project.join("main.tex"), format!("source-{index}")).unwrap();
            let history = temp.path().join(format!("history-{index}"));
            let store = Store::open(&history).unwrap();
            let candidate = store
                .stage_candidate(
                    &project,
                    &[
                        CaptureInput::explicit("project.json").unwrap(),
                        CaptureInput::proven(
                            "main.tex",
                            project.join("main.tex").canonicalize().unwrap(),
                            ContentHash::digest(format!("source-{index}").as_bytes()),
                        )
                        .unwrap(),
                    ],
                )
                .unwrap();
            let evidence = CompileEvidence::new(
                "tectonic",
                "tectonic-test@1",
                "main.tex",
                ContentHash::digest(b"output"),
                index as i64,
                candidate
                    .proven_files()
                    .iter()
                    .map(|file| ReplayedInput::new(&file.relative_path, file.content_hash).unwrap())
                    .collect(),
            )
            .unwrap();

            assert!(store.publish_inner(candidate, evidence, fault).is_err());
            assert!(store.list().unwrap().is_empty());
            assert!(fs::read_dir(history.join("packs"))
                .unwrap()
                .next()
                .is_some());

            let reopened = Store::open(&history).unwrap();
            assert!(reopened.list().unwrap().is_empty());
            assert!(fs::read_dir(history.join("packs"))
                .unwrap()
                .next()
                .is_none());
        }
    }

    #[test]
    fn first_publication_reports_installed_when_parent_sync_fails_after_rename() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.tex"), b"source").unwrap();
        let history = temp.path().join("history");
        let publication = Store::open_for_publication(&history).unwrap();
        let candidate = publication
            .store()
            .stage_candidate(
                &project,
                &[
                    CaptureInput::explicit("project.json").unwrap(),
                    CaptureInput::proven(
                        "main.tex",
                        project.join("main.tex").canonicalize().unwrap(),
                        ContentHash::digest(b"source"),
                    )
                    .unwrap(),
                ],
            )
            .unwrap();
        let evidence = CompileEvidence::new(
            "tectonic",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"output"),
            1,
            candidate
                .proven_files()
                .iter()
                .map(|file| ReplayedInput::new(&file.relative_path, file.content_hash).unwrap())
                .collect(),
        )
        .unwrap();
        publication.store().publish(candidate, evidence).unwrap();

        let outcome = publication
            .commit_with_parent_sync(|_| {
                Err(HistoryError::Io(io::Error::other(
                    "injected parent sync failure",
                )))
            })
            .unwrap();

        let PublicationCommitOutcome::InstalledDurabilityUncertain(store) = outcome else {
            panic!("post-rename sync failure must preserve the installed outcome");
        };
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(
            Store::open_existing(&history)
                .unwrap()
                .unwrap()
                .list()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn oversized_history_is_rejected_before_payload_bytes_are_read() {
        let temp = tempdir().unwrap();
        let store = Store::open(temp.path().join("history")).unwrap();
        let mut remaining = MAX_HISTORY_LOGICAL_BYTES + 1;
        let mut chunks = Vec::new();
        while remaining > 0 {
            let raw_len = remaining.min(MAX_CHUNK_SIZE as u64);
            chunks.push(ManifestChunk {
                hash: ContentHash::digest(b"declared chunk").to_hex(),
                raw_len,
            });
            remaining -= raw_len;
        }
        let main_hash = ContentHash::digest(b"declared main");
        let manifest = Manifest {
            format_version: FORMAT_VERSION,
            files: vec![
                ManifestFile {
                    path: "main.tex".into(),
                    logical_size: MAX_HISTORY_LOGICAL_BYTES + 1,
                    content_hash: main_hash.to_hex(),
                    stored: true,
                    chunks,
                },
                ManifestFile {
                    path: "project.json".into(),
                    logical_size: 0,
                    content_hash: ContentHash::digest(b"").to_hex(),
                    stored: true,
                    chunks: Vec::new(),
                },
            ],
        };
        let root = compute_snapshot_root(&manifest).unwrap();
        let metadata = PortableCheckpoint {
            export_version: 1,
            snapshot_root: root.as_hex(),
            completed_at_unix_ms: 1,
            engine: "tectonic".into(),
            toolchain_identity: "tectonic-test@1".into(),
            main_document: "main.tex".into(),
            output_hash: ContentHash::digest(b"output").to_hex(),
            label: None,
            replayed_inputs: vec![PortableReplayedInput {
                relative_path: "main.tex".into(),
                content_hash: main_hash.to_hex(),
            }],
            manifest,
        };
        let header = serde_json::to_vec(&metadata).unwrap();
        assert!(header.len() as u64 <= MAX_EXPORT_HEADER_BYTES);
        let connection = store.connection().unwrap();
        let lineage = store.lineage_with_connection(&connection).unwrap();
        drop(connection);
        let mut archive = Vec::new();
        archive.extend_from_slice(HISTORY_EXPORT_MAGIC);
        archive.extend_from_slice(lineage.as_bytes());
        archive.extend_from_slice(&1_u64.to_le_bytes());
        archive.extend_from_slice(EXPORT_MAGIC);
        archive.extend_from_slice(&(header.len() as u64).to_le_bytes());
        archive.extend_from_slice(&header);

        let error = store.import_history(archive.as_slice()).unwrap_err();
        assert!(
            error.to_string().contains("logical-size limit"),
            "unexpected error: {error}"
        );
        assert!(store.list().unwrap().is_empty());
    }
}
