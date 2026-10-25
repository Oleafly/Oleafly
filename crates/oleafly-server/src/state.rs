use std::sync::Arc;
use std::time::Duration;

use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::crypto::sha256_b64url;
use oleafly_collab_protocol::ids::{DeviceId, ServerId};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::Connection;

use crate::auth::ProviderRegistry;
use crate::blobs::{cleanup, BlobStore};
use crate::clock::Clock;
use crate::comment_guard::CommentGuard;
use crate::config::{normalize_setup_code, ServerConfig};
use crate::db::{self, Db};
use crate::error::ServerError;
use crate::mail::{Mailer, RetryPolicy};
use crate::members;
use crate::mentions::Mentions;
use crate::polls::PollHub;
use crate::rate_limit::{ConnectLimits, RateLimiter};
use crate::rooms::Rooms;
use crate::security_log;
use crate::snapshots::{Budget, Snapshots};
use crate::sockets::SocketRegistry;
use crate::tokens;
use crate::transfers::Transfers;

pub const DATABASE_FILE: &str = "oleafly-server.sqlite3";
pub const SETUP_LOG_PREFIX: &str = "Setup code: ";
pub const DAY_MS: i64 = 24 * 60 * 60 * 1000;
pub const JOIN_BURST: u32 = 20;
pub const JOIN_PER_MINUTE: u32 = 10;
const SETUP_CODE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const EXPIRING_TABLES: [&str; 5] = [
    "nonces",
    "pending_auth",
    "auth_codes",
    "access_tokens",
    "refresh_tokens",
];

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<ServerConfig>,
    pub db: Db,
    pub server_id: ServerId,
    pub clock: Arc<dyn Clock>,
    pub http: reqwest::Client,
    pub providers: Arc<ProviderRegistry>,
    pub sockets: Arc<SocketRegistry>,
    pub rate_limiter: Arc<RateLimiter>,
    pub connects: Arc<ConnectLimits>,
    pub join_limiter: Arc<RateLimiter>,
    pub rooms: Arc<Rooms>,
    pub started_at: i64,
    pub polls: Arc<PollHub>,
    pub blobs: BlobStore,
    pub mailer: Mailer,
    pub snapshots: Snapshots,
    pub comment_guard: CommentGuard,
    pub mentions: Mentions,
    pub transfers: Transfers,
    #[cfg(feature = "web")]
    pub web: Arc<crate::web::Hub>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MaintenanceReport {
    pub security_events: usize,
    pub expired_rows: usize,
    pub expired_projects: usize,
    pub access_events: usize,
    pub guest_invitations: usize,
    pub web_sessions: usize,
}

fn open_database(data_dir: &std::path::Path) -> Result<Db, ServerError> {
    std::fs::create_dir_all(data_dir).map_err(|error| {
        ServerError::Internal(format!(
            "could not create the data directory {}: {error}",
            data_dir.display()
        ))
    })?;
    Db::open(&data_dir.join(DATABASE_FILE))
}

impl AppState {
    pub async fn new(config: ServerConfig, clock: Arc<dyn Clock>) -> Result<AppState, ServerError> {
        let data_dir = config.data_dir.clone();
        let database = tokio::task::spawn_blocking(move || open_database(&data_dir))
            .await
            .map_err(|error| {
                ServerError::Internal(format!("opening the database failed: {error}"))
            })??;
        AppState::with_db(config, clock, database).await
    }

    pub async fn with_db(
        config: ServerConfig,
        clock: Arc<dyn Clock>,
        database: Db,
    ) -> Result<AppState, ServerError> {
        AppState::with_mail_retry(config, clock, database, RetryPolicy::default()).await
    }

    pub async fn with_mail_retry(
        config: ServerConfig,
        clock: Arc<dyn Clock>,
        database: Db,
        mail_retry: RetryPolicy,
    ) -> Result<AppState, ServerError> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("oleafly-server/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| {
                ServerError::Internal(format!("could not build the HTTP client: {error}"))
            })?;
        let providers = Arc::new(ProviderRegistry::from_config(&config, http.clone()));
        let blobs = BlobStore::from_config(&config)?;
        let started_at = clock.now_ms();
        let mailer = Mailer::start(&config, Arc::clone(&clock), mail_retry)?;
        let preset = config.setup_code.clone();
        let (server_id, setup_line) = database
            .call(move |conn| {
                let transaction = conn.transaction()?;
                let server_id = db::server_id(&transaction)?;
                let setup_line = prepare_setup_code(&transaction, preset.as_deref())?;
                transaction.commit()?;
                Ok((server_id, setup_line))
            })
            .await?;
        if let Some(line) = setup_line {
            tracing::warn!("{line}");
        }
        // OLEAFLY_SNAPSHOT_MEMORY_MB bounds documents and large transfers
        // together: a quarter goes to transfers and the rest to documents.
        let memory = config.snapshot_memory_mb.saturating_mul(1024 * 1024);
        let transfer_budget = memory / 4;
        let snapshots = Snapshots::new(blobs.clone(), &config.data_dir);
        snapshots.set_budget(Budget {
            memory_bytes: memory - transfer_budget,
            max_snapshot_bytes: config.limits.max_project_mb.saturating_mul(1024 * 1024),
        });
        snapshots.move_legacy_files(&database).await?;
        let polls = Arc::new(PollHub::with_hold(config.poll_hold));
        let rate_limiter = Arc::new(RateLimiter::new(
            config.sign_in.requests_burst,
            config.sign_in.requests_per_minute,
        ));
        Ok(AppState {
            config: Arc::new(config),
            db: database,
            server_id,
            clock,
            http,
            providers,
            sockets: Arc::new(SocketRegistry::new()),
            rate_limiter,
            connects: Arc::new(ConnectLimits::default()),
            join_limiter: Arc::new(RateLimiter::new(JOIN_BURST, JOIN_PER_MINUTE)),
            rooms: Arc::new(Rooms::new()),
            started_at,
            polls,
            blobs,
            mailer,
            snapshots,
            comment_guard: CommentGuard::default(),
            mentions: Mentions::default(),
            transfers: Transfers::with_budget(transfer_budget),
            #[cfg(feature = "web")]
            web: Arc::new(crate::web::Hub::default()),
        })
    }

    pub async fn revoke_device(&self, device: DeviceId) -> Result<(), ServerError> {
        self.sign_out_device(device, None).await
    }

    pub async fn end_device_session(
        &self,
        device: DeviceId,
        reason: SessionEndReason,
    ) -> Result<(), ServerError> {
        self.sign_out_device(device, Some(reason)).await
    }

    async fn sign_out_device(
        &self,
        device: DeviceId,
        reason: Option<SessionEndReason>,
    ) -> Result<(), ServerError> {
        let now = self.clock.now_ms();
        self.db
            .call(move |conn| {
                let transaction = conn.transaction()?;
                tokens::sign_out_device(&transaction, device, now)?;
                transaction.commit()?;
                Ok(())
            })
            .await?;
        self.sockets.revoke(device, reason);
        Ok(())
    }

    pub async fn run_maintenance(&self) -> Result<MaintenanceReport, ServerError> {
        let now = self.clock.now_ms();
        let cutoff = now - i64::from(self.config.security_log_days) * DAY_MS;
        let mut report = MaintenanceReport::default();
        let mut failed: Option<ServerError> = None;
        let mut note = |step: &str, error: ServerError| {
            tracing::warn!("Maintenance could not {step}: {error}");
            failed.get_or_insert(error);
        };
        let pruned = self
            .db
            .call(move |conn| {
                let security_events = security_log::prune(conn, cutoff)?;
                let mut expired_rows = 0;
                for table in EXPIRING_TABLES {
                    expired_rows += conn.execute(
                        &format!("DELETE FROM {table} WHERE expires_at <= ?1"),
                        [now],
                    )?;
                }
                Ok((security_events, expired_rows))
            })
            .await;
        match pruned {
            Ok((security_events, expired_rows)) => {
                report.security_events = security_events;
                report.expired_rows = expired_rows;
            }
            Err(error) => note("prune the security log and expired sign-in rows", error),
        }
        match self
            .db
            .call(move |conn| crate::access_log::prune(conn, cutoff))
            .await
        {
            Ok(count) => report.access_events = count,
            Err(error) => note("prune the access log", error),
        }
        match self
            .db
            .call(move |conn| crate::guests::prune(conn, cutoff))
            .await
        {
            Ok(count) => report.guest_invitations = count,
            Err(error) => note("prune old guest invitations", error),
        }
        match self
            .db
            .call(move |conn| {
                let transaction = conn.transaction()?;
                let ended = crate::web_sessions::prune(&transaction, now)?;
                transaction.commit()?;
                Ok(ended)
            })
            .await
        {
            Ok(ended) => {
                report.web_sessions = ended.len();
                for device in ended {
                    self.sockets.revoke(device, None);
                }
            }
            Err(error) => note("end expired browser sessions", error),
        }
        match self.expire_projects(now).await {
            Ok(count) => report.expired_projects = count,
            Err(error) => note("delete expired projects", error),
        }
        if let Err(error) = self.snapshots.move_legacy_files(&self.db).await {
            note("move old snapshot files into the blob store", error);
        }
        if let Err(error) = self.snapshots.prune(&self.db, now).await {
            note("remove superseded snapshots", error);
        }
        match cleanup::unused_files(&self.db, &self.snapshots, now).await {
            Ok(unused) => {
                if let Err(error) =
                    cleanup::remove_unused_files(&self.db, &self.blobs, unused, now).await
                {
                    note("remove files no project uses", error);
                }
            }
            Err(error) => note("find files no project uses", error),
        }
        if let Err(error) = cleanup::finish_removals(&self.db, &self.blobs, &self.snapshots).await {
            note("finish removing stored files", error);
        }
        failed.map_or(Ok(report), Err)
    }

    async fn expire_projects(&self, now: i64) -> Result<usize, ServerError> {
        let pending_before = now - DAY_MS;
        let archived_before = now - i64::from(self.config.archive_days) * DAY_MS;
        let expired = self
            .db
            .call(move |conn| {
                let ids = crate::projects::expired_projects(conn, pending_before, archived_before)?;
                let mut deleted = Vec::with_capacity(ids.len());
                for id in ids {
                    deleted.push((id, crate::projects::delete_project(conn, id, now)?));
                }
                Ok(deleted)
            })
            .await?;
        for (project, deleted) in &expired {
            self.snapshots
                .forget_project(*project, &deleted.snapshots)
                .await;
        }
        Ok(expired.len())
    }
}

pub fn generate_setup_code() -> String {
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("the operating system random number generator is available");
    let characters: Vec<char> = bytes
        .iter()
        .map(|byte| char::from(SETUP_CODE_ALPHABET[usize::from(byte & 31)]))
        .collect();
    characters
        .chunks(4)
        .map(|group| group.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn setup_code_hash(code: &str) -> String {
    sha256_b64url(normalize_setup_code(code).as_bytes())
}

pub fn setup_log_line(code: Option<&str>) -> String {
    match code {
        Some(code) => format!(
            "{SETUP_LOG_PREFIX}{code}. This server has no admin yet. Enter the code in Oleafly when you add the server. It works once."
        ),
        None => format!(
            "{SETUP_LOG_PREFIX}set by OLEAFLY_SETUP_CODE. This server has no admin yet. Enter that code in Oleafly when you add the server. It works once."
        ),
    }
}

fn prepare_setup_code(
    conn: &Connection,
    preset: Option<&str>,
) -> Result<Option<String>, ServerError> {
    if members::count_admins(conn)? > 0 {
        db::meta_delete(conn, db::SETUP_CODE_HASH_KEY)?;
        return Ok(None);
    }
    let (hash, line) = match preset {
        Some(code) => (setup_code_hash(code), setup_log_line(None)),
        None => {
            let code = generate_setup_code();
            (setup_code_hash(&code), setup_log_line(Some(&code)))
        }
    };
    db::meta_set(conn, db::SETUP_CODE_HASH_KEY, &hash)?;
    Ok(Some(line))
}
