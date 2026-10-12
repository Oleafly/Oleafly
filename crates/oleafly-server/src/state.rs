use std::sync::Arc;
use std::time::Duration;

use oleafly_collab_protocol::crypto::sha256_b64url;
use oleafly_collab_protocol::ids::{DeviceId, ServerId};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection};

use crate::auth::ProviderRegistry;
use crate::clock::Clock;
use crate::config::{normalize_setup_code, ServerConfig};
use crate::db::{self, Db};
use crate::error::ServerError;
use crate::members;
use crate::rate_limit::{RateLimiter, SIGN_IN_BURST, SIGN_IN_PER_MINUTE};
use crate::security_log;
use crate::sockets::SocketRegistry;
use crate::tokens;

pub const DATABASE_FILE: &str = "oleafly-server.sqlite3";
pub const SETUP_LOG_PREFIX: &str = "Setup code: ";
pub const DAY_MS: i64 = 24 * 60 * 60 * 1000;
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MaintenanceReport {
    pub security_events: usize,
    pub expired_rows: usize,
}

impl AppState {
    pub async fn new(config: ServerConfig, clock: Arc<dyn Clock>) -> Result<AppState, ServerError> {
        std::fs::create_dir_all(&config.data_dir).map_err(|error| {
            ServerError::Internal(format!(
                "could not create the data directory {}: {error}",
                config.data_dir.display()
            ))
        })?;
        let database = Db::open(&config.data_dir.join(DATABASE_FILE))?;
        AppState::with_db(config, clock, database).await
    }

    pub async fn with_db(
        config: ServerConfig,
        clock: Arc<dyn Clock>,
        database: Db,
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
        Ok(AppState {
            config: Arc::new(config),
            db: database,
            server_id,
            clock,
            http,
            providers,
            sockets: Arc::new(SocketRegistry::new()),
            rate_limiter: Arc::new(RateLimiter::new(SIGN_IN_BURST, SIGN_IN_PER_MINUTE)),
        })
    }

    pub async fn revoke_device(&self, device: DeviceId) -> Result<(), ServerError> {
        let now = self.clock.now_ms();
        self.db
            .call(move |conn| {
                let transaction = conn.transaction()?;
                transaction.execute(
                    "UPDATE devices SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL",
                    params![device.to_string(), now],
                )?;
                tokens::revoke_device_tokens(&transaction, device)?;
                transaction.execute(
                    "UPDATE refresh_tokens SET revoked_at = ?2, grace_reply = NULL WHERE device_id = ?1 AND revoked_at IS NULL",
                    params![device.to_string(), now],
                )?;
                transaction.commit()?;
                Ok(())
            })
            .await?;
        self.sockets.revoke(device);
        Ok(())
    }

    pub async fn run_maintenance(&self) -> Result<MaintenanceReport, ServerError> {
        let now = self.clock.now_ms();
        let cutoff = now - i64::from(self.config.security_log_days) * DAY_MS;
        self.db
            .call(move |conn| {
                let security_events = security_log::prune(conn, cutoff)?;
                let mut expired_rows = 0;
                for table in EXPIRING_TABLES {
                    expired_rows += conn.execute(
                        &format!("DELETE FROM {table} WHERE expires_at <= ?1"),
                        [now],
                    )?;
                }
                Ok(MaintenanceReport {
                    security_events,
                    expired_rows,
                })
            })
            .await
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
