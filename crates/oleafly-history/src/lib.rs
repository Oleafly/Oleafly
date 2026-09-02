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
use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

const FORMAT_VERSION: u32 = 1;
const PACK_MAGIC: &[u8; 12] = b"OLEAPACK\0\0\0\x01";
const MIN_CHUNK_SIZE: u32 = 256 * 1024;
const AVG_CHUNK_SIZE: u32 = 1024 * 1024;
const MAX_CHUNK_SIZE: u32 = 4 * 1024 * 1024;
const ZSTD_LEVEL: i32 = 3;
const EXPORT_MAGIC: &[u8] = b"OLEAFLY-CKPT\0\x01";
const HISTORY_EXPORT_MAGIC: &[u8] = b"OLEAFLY-HISTORY\0\x02";
const MAX_EXPORT_HEADER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_HISTORY_CHECKPOINTS: u64 = 4_096;
const MAX_HISTORY_METADATA_BYTES: u64 = 256 * 1024 * 1024;
const MAX_HISTORY_CHUNK_REFERENCES: u64 = 250_000;
const MAX_HISTORY_LOGICAL_BYTES: u64 = 128 * 1024 * 1024 * 1024;
const MAX_PROJECT_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const STORE_LINEAGE_BYTES: usize = 36;
const OPERATION_LOCK_FILE: &str = "operation.lock";
const NAMESPACE_LOCK_FILE: &str = ".oleafly-checkpoint-stores.lock";
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
}

pub type Result<T> = std::result::Result<T, HistoryError>;

/// A BLAKE3 content identity.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ContentHash([u8; 32]);

impl ContentHash {
    pub fn digest(bytes: &[u8]) -> Self {
        Self(*blake3::hash(bytes).as_bytes())
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
}

/// One project-local regular file from an explicit policy selection or a
/// compiler report that binds its resolved identity and first-read bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CaptureInput {
    relative_path: String,
    basis: CaptureBasis,
}

impl CaptureInput {
    pub fn explicit(relative_path: impl Into<String>) -> Result<Self> {
        let relative_path = relative_path.into();
        validate_portable_relative_path(&relative_path)?;
        Ok(Self {
            relative_path,
            basis: CaptureBasis::Explicit,
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
        })
    }

    pub fn relative_path(&self) -> &str {
        &self.relative_path
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
    replayed_inputs: Vec<ReplayedInput>,
}

impl Checkpoint {
    pub fn replayed_inputs(&self) -> &[ReplayedInput] {
        &self.replayed_inputs
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

/// A single project's independent checkpoint store.
#[derive(Clone, Debug)]
pub struct Store {
    root: PathBuf,
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
        let root = parent.join(store_name(requested_root)?);
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
        sync_directory(&store.root)?;
        remove_stale_staging(&store.root)?;
        store.recover_orphan_packs_inner()?;
        Ok(store)
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
        let requested_root = root.as_ref();
        let requested_parent = store_parent(requested_root)?;
        if !requested_parent.try_exists()? {
            return Ok(false);
        }
        validate_real_directory(requested_parent, "checkpoint store parent")?;
        let parent = requested_parent.canonicalize()?;
        let name = store_name(requested_root)?;
        let root = parent.join(name);
        let namespace_lock = open_namespace_lock(&parent, true)?;
        fs4::FileExt::lock(&namespace_lock)?;
        let mut removed = reap_detached_stores(&parent, name, root.try_exists()?)?;
        if !root.try_exists()? {
            return Ok(removed);
        }
        validate_real_directory(&root, "checkpoint store root")?;
        validate_regular_file(&root.join(OPERATION_LOCK_FILE), "checkpoint operation lock")?;
        validate_existing_format(&root)?;
        validate_regular_file(&root.join("catalog.sqlite3"), "checkpoint catalog")?;
        validate_real_directory(&root.join("packs"), "checkpoint packs directory")?;
        validate_real_directory(&root.join("staging"), "checkpoint staging directory")?;
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
        Ok(removed)
    }

    /// Seals only the explicit regular files in `inputs` into a private tree.
    /// No directory traversal or dependency discovery occurs here.
    pub fn stage_candidate(
        &self,
        project_root: impl AsRef<Path>,
        inputs: &[CaptureInput],
    ) -> Result<Candidate> {
        let store_locks = self.acquire_exclusive_locks()?;
        self.stage_candidate_locked(project_root.as_ref(), inputs, store_locks)
    }

    fn stage_candidate_locked(
        &self,
        project_root: &Path,
        inputs: &[CaptureInput],
        store_locks: StoreLocks,
    ) -> Result<Candidate> {
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
        );
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging_dir);
        }
        result
    }

    fn capture_candidate(
        &self,
        canonical_project_root: &Path,
        inputs: &[CaptureInput],
        staging_dir: &Path,
        sealed_root: &Path,
        staged_pack: &Path,
        store_locks: StoreLocks,
    ) -> Result<Candidate> {
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

        for input in inputs {
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
            if let CaptureBasis::CompilerRead { resolved_path, .. } = &input.basis {
                if &canonical_source != resolved_path {
                    return Err(HistoryError::InvalidInput(format!(
                        "proven input {} resolved as {}, expected {}",
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
            for chunk in StreamCDC::new(
                &mut source_reader,
                MIN_CHUNK_SIZE,
                AVG_CHUNK_SIZE,
                MAX_CHUNK_SIZE,
            ) {
                let chunk = chunk.map_err(io::Error::from)?;
                destination_file.write_all(&chunk.data)?;
                content_hasher.update(&chunk.data);
                logical_size = logical_size
                    .checked_add(chunk.length as u64)
                    .ok_or_else(|| HistoryError::InvalidInput("input is too large".into()))?;

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
            }
            drop(source_reader);
            destination_file.sync_all()?;

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
            if let CaptureBasis::CompilerRead {
                first_read_hash, ..
            } = &input.basis
            {
                if &content_hash != first_read_hash {
                    return Err(HistoryError::InvalidInput(format!(
                        "proven input {} changed after the compiler first read it",
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
                chunks,
            });
        }

        pack.sync_all()?;
        sync_directory(staging_dir)?;
        let pack_len = pack.metadata()?.len();
        drop(pack);
        let pack_id = hash_file(staged_pack)?;
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

    fn publish_inner(
        &self,
        mut candidate: Candidate,
        evidence: CompileEvidence,
        fault: PublishFault,
    ) -> Result<PublishOutcome> {
        if candidate.store_root != self.root {
            return Err(HistoryError::InvalidInput(
                "candidate belongs to a different checkpoint store".into(),
            ));
        }
        verify_candidate_sealed_tree(&candidate)?;
        validate_compile_evidence(&candidate, &evidence)?;

        let root_hex = candidate.snapshot_root.as_hex();
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let root_already_visible = query_checkpoint(&transaction, &root_hex)?.is_some();

        let mut published_pack_path = None;
        if !candidate.new_chunks.is_empty() {
            let pack_id = candidate.pack_id.to_hex();
            let file_name = format!("{pack_id}.pack");
            let destination = self.root.join("packs").join(&file_name);
            if destination.exists() {
                if hash_file(&destination)? != candidate.pack_id {
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

        let logical_bytes = candidate
            .manifest
            .files
            .iter()
            .try_fold(0_u64, |total, file| {
                total
                    .checked_add(file.logical_size)
                    .ok_or_else(|| HistoryError::InvalidInput("snapshot length overflow".into()))
            })?;
        let checkpoint = Checkpoint {
            snapshot_root: candidate.snapshot_root,
            completed_at_unix_ms: evidence.completed_at_unix_ms,
            engine: evidence.engine,
            toolchain_identity: evidence.toolchain_identity,
            main_document: evidence.main_document,
            output_hash: evidence.output_hash,
            file_count: candidate.manifest.files.len() as u64,
            logical_bytes,
            replayed_inputs: evidence.replayed_inputs,
        };

        // Reinsert an existing root so its catalog sequence records this
        // validated publication as the newest recovery point. The delete and
        // insert are one transaction, while the immutable manifest and packs
        // remain unchanged.
        if root_already_visible {
            transaction.execute(
                "DELETE FROM checkpoints WHERE snapshot_root = ?1",
                [&root_hex],
            )?;
        }

        // The visible root is intentionally the final catalog mutation.
        transaction.execute(
            "INSERT INTO checkpoints(
                snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                root_hex,
                checkpoint.completed_at_unix_ms,
                checkpoint.engine,
                checkpoint.toolchain_identity,
                checkpoint.main_document,
                checkpoint.output_hash.to_hex(),
                checkpoint.file_count as i64,
                checkpoint.logical_bytes as i64,
                encode_replayed_inputs(&checkpoint.replayed_inputs)?,
            ],
        )?;

        if fault == PublishFault::BeforeCommit {
            return Err(HistoryError::Io(io::Error::other(
                "injected failure before catalog commit",
            )));
        }

        transaction.commit()?;
        // Visibility is committed. Cleanup must not turn success into an error
        // that a caller could mistake for a safe retry or rollback point.
        let _ = candidate.cleanup();

        // Keep the variable alive until the transaction is committed. On an
        // injected failure, the immutable file is an unreachable orphan that
        // recovery can remove without exposing a checkpoint.
        drop(published_pack_path);
        if root_already_visible {
            Ok(PublishOutcome::Existing(checkpoint))
        } else {
            Ok(PublishOutcome::Created(checkpoint))
        }
    }

    pub fn checkpoint(&self, root: &SnapshotRoot) -> Result<Option<Checkpoint>> {
        let _store_locks = self.acquire_shared_locks()?;
        self.checkpoint_inner(root)
    }

    fn checkpoint_inner(&self, root: &SnapshotRoot) -> Result<Option<Checkpoint>> {
        let connection = self.connection()?;
        query_checkpoint(&connection, &root.as_hex())
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
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
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
            visible_logical_bytes: connection.query_row(
                "SELECT COALESCE(SUM(logical_bytes), 0) FROM checkpoints",
                [],
                |row| row.get::<_, i64>(0),
            )? as u64,
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
        for manifest_file in &manifest.files {
            validate_portable_relative_path(&manifest_file.path)?;
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
        }
        sync_materialized_directory_tree(destination)?;
        Ok(Materialization {
            file_count: manifest.files.len() as u64,
            logical_bytes,
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
                logical_bytes = logical_bytes
                    .checked_add(file_bytes)
                    .ok_or_else(|| HistoryError::Corrupt("snapshot length overflow".into()))?;
                verification.checked_files += 1;
            }
            if checkpoint.file_count != manifest.files.len() as u64
                || checkpoint.logical_bytes != logical_bytes
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
        let summary =
            self.write_portable_checkpoint_record(&connection, &checkpoint, &mut writer)?;
        writer.flush()?;
        Ok(summary)
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
            output.sync_all()?;
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
        self.publish(candidate, evidence)
    }

    /// Streams every visible checkpoint, oldest first, as a logical portable
    /// history. This stream is intentionally unencrypted for composition with
    /// Oleafly's authenticated password envelope.
    pub fn export_history<W: Write>(&self, mut writer: W) -> Result<HistoryExportSummary> {
        let _store_locks = self.acquire_shared_locks()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let checkpoint_count = query_count(&transaction, "checkpoints")?;
        if checkpoint_count > MAX_HISTORY_CHECKPOINTS {
            return Err(HistoryError::InvalidInput(
                "checkpoint history exceeds the portable export limit".into(),
            ));
        }
        let lineage = self.lineage_with_connection(&transaction)?;
        writer.write_all(HISTORY_EXPORT_MAGIC)?;
        writer.write_all(lineage.as_bytes())?;
        writer.write_all(&checkpoint_count.to_le_bytes())?;
        let mut logical_bytes = 0_u64;
        let mut statement = transaction.prepare(
            "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
             FROM checkpoints ORDER BY sequence ASC",
        )?;
        let checkpoints = statement.query_map([], checkpoint_from_row)?;
        for checkpoint in checkpoints {
            let checkpoint = checkpoint?;
            let summary =
                self.write_portable_checkpoint_record(&transaction, &checkpoint, &mut writer)?;
            logical_bytes = logical_bytes
                .checked_add(summary.logical_bytes)
                .ok_or_else(|| HistoryError::Corrupt("history length overflow".into()))?;
            if logical_bytes > MAX_HISTORY_LOGICAL_BYTES {
                return Err(HistoryError::InvalidInput(
                    "checkpoint history exceeds the portable logical-size limit".into(),
                ));
            }
        }
        drop(statement);
        writer.flush()?;
        transaction.commit()?;
        Ok(HistoryExportSummary {
            checkpoint_count,
            logical_bytes,
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
        if count > MAX_HISTORY_CHECKPOINTS {
            return Err(HistoryError::InvalidInput(format!(
                "portable history checkpoint count {count} is invalid"
            )));
        }

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
        let mut metadata_bytes = 0_u64;
        let mut logical_bytes = 0_u64;
        let mut chunk_references = 0_u64;
        for _ in 0..count {
            let remaining = ImportBudget {
                metadata_bytes: MAX_HISTORY_METADATA_BYTES.saturating_sub(metadata_bytes),
                logical_bytes: MAX_HISTORY_LOGICAL_BYTES.saturating_sub(logical_bytes),
                chunk_references: MAX_HISTORY_CHUNK_REFERENCES.saturating_sub(chunk_references),
            };
            let (
                checkpoint,
                project_json,
                checkpoint_metadata_bytes,
                checkpoint_logical_bytes,
                checkpoint_chunk_references,
            ) = self.read_portable_checkpoint_record(
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
            metadata_bytes = metadata_bytes
                .checked_add(checkpoint_metadata_bytes)
                .ok_or_else(|| {
                    HistoryError::InvalidInput("portable history metadata is too large".into())
                })?;
            if metadata_bytes > MAX_HISTORY_METADATA_BYTES {
                return Err(HistoryError::InvalidInput(
                    "portable history metadata exceeds the import limit".into(),
                ));
            }
            logical_bytes = logical_bytes
                .checked_add(checkpoint_logical_bytes)
                .ok_or_else(|| {
                    HistoryError::InvalidInput("portable history is too large".into())
                })?;
            if logical_bytes > MAX_HISTORY_LOGICAL_BYTES {
                return Err(HistoryError::InvalidInput(
                    "portable history exceeds the import logical-size limit".into(),
                ));
            }
            chunk_references = chunk_references
                .checked_add(checkpoint_chunk_references)
                .ok_or_else(|| {
                    HistoryError::InvalidInput("portable history has too many chunks".into())
                })?;
            if chunk_references > MAX_HISTORY_CHUNK_REFERENCES {
                return Err(HistoryError::InvalidInput(
                    "portable history contains too many chunk references".into(),
                ));
            }
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
            transaction.execute(
                "INSERT INTO checkpoints(
                    snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
    ) -> Result<ExportSummary> {
        let root = checkpoint.snapshot_root;
        let manifest = load_visible_manifest(connection, &root)?;
        verify_manifest_root(&root, &manifest)?;
        let metadata = PortableCheckpoint {
            export_version: 1,
            snapshot_root: root.as_hex(),
            completed_at_unix_ms: checkpoint.completed_at_unix_ms,
            engine: checkpoint.engine.clone(),
            toolchain_identity: checkpoint.toolchain_identity.clone(),
            main_document: checkpoint.main_document.clone(),
            output_hash: checkpoint.output_hash.to_hex(),
            replayed_inputs: encode_portable_replayed_inputs(&checkpoint.replayed_inputs),
            manifest: manifest.clone(),
        };
        let header = serde_json::to_vec(&metadata)?;
        if header.len() as u64 > MAX_EXPORT_HEADER_BYTES {
            return Err(HistoryError::InvalidInput(
                "portable checkpoint header exceeds 16 MiB".into(),
            ));
        }
        writer.write_all(EXPORT_MAGIC)?;
        writer.write_all(&(header.len() as u64).to_le_bytes())?;
        writer.write_all(&header)?;

        let mut logical_bytes = 0_u64;
        for manifest_file in &manifest.files {
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
        Ok(ExportSummary {
            snapshot_root: root,
            file_count: manifest.files.len() as u64,
            logical_bytes,
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
    ) -> Result<(ImportedCheckpoint, Vec<u8>, u64, u64, u64)> {
        let (metadata, metadata_bytes) = read_portable_checkpoint_metadata(reader)?;
        if metadata_bytes > remaining.metadata_bytes {
            return Err(HistoryError::InvalidInput(
                "portable history metadata exceeds the import limit".into(),
            ));
        }
        let root = SnapshotRoot::parse(&metadata.snapshot_root)?;
        verify_archive_manifest(&metadata.manifest)?;
        verify_manifest_root(&root, &metadata.manifest)?;
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
            },
            project_json,
            metadata_bytes,
            declared_logical_bytes,
            declared_chunk_references,
        ))
    }

    fn initialize_catalog(&self) -> Result<()> {
        let connection = self.open_connection(true)?;
        let version: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version != 0 && version != FORMAT_VERSION {
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
             );
             CREATE TABLE IF NOT EXISTS store_identity(
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                lineage TEXT NOT NULL UNIQUE
             );
             PRAGMA user_version = 1;
             COMMIT;",
        )?;
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
        if version != FORMAT_VERSION {
            return Err(HistoryError::UnsupportedFormat(version));
        }
        self.lineage_with_connection(&connection)?;
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
    chunks: Vec<ManifestChunk>,
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
    replayed_inputs: Vec<PortableReplayedInput>,
    manifest: Manifest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PortableReplayedInput {
    relative_path: String,
    content_hash: String,
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

struct ImportedCheckpoint {
    root: SnapshotRoot,
    evidence: CompileEvidence,
    manifest: Manifest,
}

#[derive(Clone, Copy, Debug)]
struct ImportBudget {
    metadata_bytes: u64,
    logical_bytes: u64,
    chunk_references: u64,
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
    if manifest.format_version != FORMAT_VERSION {
        return Err(HistoryError::UnsupportedFormat(manifest.format_version));
    }
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"oleafly-snapshot\0");
    hasher.update(&FORMAT_VERSION.to_le_bytes());
    hasher.update(&(manifest.files.len() as u64).to_le_bytes());
    for file in &manifest.files {
        hash_length_prefixed(&mut hasher, file.path.as_bytes());
        hasher.update(&file.logical_size.to_le_bytes());
        let content_hash = ContentHash::from_hex(&file.content_hash)?;
        hasher.update(content_hash.as_bytes());
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

fn verify_candidate_sealed_tree(candidate: &Candidate) -> Result<()> {
    for file in &candidate.manifest.files {
        let metadata = validate_unsymlinked_regular_file(&candidate.sealed_root, &file.path)?;
        if metadata.len() != file.logical_size {
            return Err(HistoryError::InvalidInput(format!(
                "sealed replay input {} changed before publication",
                file.path
            )));
        }
        let actual = hash_file(&candidate.sealed_root.join(path_from_portable(&file.path)))?;
        if actual != ContentHash::from_hex(&file.content_hash)? {
            return Err(HistoryError::InvalidInput(format!(
                "sealed replay input {} changed before publication",
                file.path
            )));
        }
    }
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
    let main_replay = evidence
        .replayed_inputs
        .iter()
        .find(|input| input.relative_path == evidence.main_document)
        .ok_or_else(|| {
            HistoryError::InvalidInput(format!(
                "compiled main document {} lacks first-read dependency evidence",
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

fn hash_length_prefixed(hasher: &mut blake3::Hasher, value: &[u8]) {
    hasher.update(&(value.len() as u64).to_le_bytes());
    hasher.update(value);
}

fn query_checkpoint(connection: &Connection, root: &str) -> Result<Option<Checkpoint>> {
    connection
        .query_row(
            "SELECT snapshot_root, completed_at_unix_ms, engine, toolchain_identity,
                    main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
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
                main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
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
            main_document, output_hash, file_count, logical_bytes, replayed_inputs_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
        ],
    )?;
    Ok(())
}

fn checkpoint_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Checkpoint> {
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
    })
}

fn load_visible_manifest(connection: &Connection, root: &SnapshotRoot) -> Result<Manifest> {
    let bytes = connection
        .query_row(
            "SELECT m.manifest_json
             FROM manifests m JOIN checkpoints c ON c.snapshot_root = m.snapshot_root
             WHERE m.snapshot_root = ?1",
            [root.as_hex()],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
        .ok_or_else(|| HistoryError::CheckpointNotFound(root.as_hex()))?;
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
    #[derive(Deserialize, Serialize)]
    struct FormatMarker<'a> {
        format: &'a str,
        version: u32,
        hash: &'a str,
        chunker: &'a str,
        compression: &'a str,
    }

    let marker_path = root.join("format.json");
    if marker_path.exists() {
        return validate_existing_format(root);
    }

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
        if marker_path.exists() {
            let _ = fs::remove_file(&temporary);
            validate_existing_format(root)?;
        } else {
            return Err(error.into());
        }
    }
    sync_directory(root)?;
    Ok(())
}

fn validate_existing_format(root: &Path) -> Result<()> {
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
    if marker.format != "oleafly-checkpoints" || marker.version != FORMAT_VERSION {
        return Err(HistoryError::UnsupportedFormat(marker.version));
    }
    if marker.hash != "blake3"
        || marker.chunker != "fastcdc-v2020-256k-1m-4m"
        || marker.compression != "zstd-3-if-smaller"
    {
        return Err(HistoryError::Corrupt(
            "checkpoint format algorithms do not match version 1".into(),
        ));
    }
    Ok(())
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
    validate_regular_file(path, "checkpoint payload")?;
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = open_with_no_follow(&mut options, path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
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
                    chunks,
                },
                ManifestFile {
                    path: "project.json".into(),
                    logical_size: 0,
                    content_hash: ContentHash::digest(b"").to_hex(),
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
