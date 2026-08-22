use std::{net::SocketAddr, str::FromStr};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use url::Url;

pub const DEFAULT_MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeMode {
    Development,
    Production,
}

impl FromStr for RuntimeMode {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "development" => Ok(Self::Development),
            "production" => Ok(Self::Production),
            _ => bail!("OLEAFLY_REALTIME_MODE must be development or production"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ServerLimits {
    pub max_connections: usize,
    pub max_write_buffer_bytes: usize,
    pub room_broadcast_bytes: usize,
    pub mutation_rate_per_second: u32,
    pub mutation_burst: u32,
    pub state_vector_rate_per_second: u32,
    pub state_vector_burst: u32,
    pub presence_rate_per_second: u32,
    pub presence_burst: u32,
    pub auth_rate_per_minute: u32,
    pub auth_burst: u32,
    pub decode_concurrency: usize,
    pub decode_timeout_ms: u64,
    pub max_state_vector_entries: usize,
    pub max_update_clients: usize,
    pub max_update_blocks_per_client: usize,
    pub max_update_elements: usize,
    pub max_update_content_bytes: usize,
    pub max_update_nesting_depth: usize,
    pub max_project_state_bytes: usize,
    pub max_materialized_project_bytes: usize,
    pub max_project_nodes: usize,
    pub max_file_name_bytes: usize,
    pub max_text_file_bytes: usize,
    pub max_total_text_bytes: usize,
}

impl Default for ServerLimits {
    fn default() -> Self {
        Self {
            max_connections: 256,
            max_write_buffer_bytes: 512 * 1024,
            room_broadcast_bytes: 64 * 1024 * 1024,
            mutation_rate_per_second: 60,
            mutation_burst: 120,
            state_vector_rate_per_second: 5,
            state_vector_burst: 10,
            presence_rate_per_second: 30,
            presence_burst: 60,
            auth_rate_per_minute: 30,
            auth_burst: 10,
            decode_concurrency: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(4)
                .clamp(1, 8),
            decode_timeout_ms: 5_000,
            max_state_vector_entries: 65_536,
            max_update_clients: 4_096,
            max_update_blocks_per_client: 100_000,
            max_update_elements: 1_000_000,
            max_update_content_bytes: DEFAULT_MAX_FRAME_BYTES,
            max_update_nesting_depth: 64,
            max_project_state_bytes: 128 * 1024 * 1024,
            max_materialized_project_bytes: 128 * 1024 * 1024,
            max_project_nodes: 20_000,
            max_file_name_bytes: 255,
            max_text_file_bytes: 32 * 1024 * 1024,
            max_total_text_bytes: 64 * 1024 * 1024,
        }
    }
}

impl ServerLimits {
    pub fn validate(&self) -> Result<()> {
        if self.max_connections == 0 {
            bail!("OLEAFLY_REALTIME_MAX_CONNECTIONS must be greater than zero");
        }
        if self.max_write_buffer_bytes < 128 * 1024 {
            bail!("OLEAFLY_REALTIME_MAX_WRITE_BUFFER_BYTES must be at least 131072");
        }
        if self.room_broadcast_bytes < DEFAULT_MAX_FRAME_BYTES {
            bail!("OLEAFLY_REALTIME_ROOM_BROADCAST_BYTES must hold at least one maximum frame");
        }
        for (name, rate, burst) in [
            (
                "mutation",
                self.mutation_rate_per_second,
                self.mutation_burst,
            ),
            (
                "state vector",
                self.state_vector_rate_per_second,
                self.state_vector_burst,
            ),
            (
                "presence",
                self.presence_rate_per_second,
                self.presence_burst,
            ),
            ("authentication", self.auth_rate_per_minute, self.auth_burst),
        ] {
            if rate == 0 || burst == 0 {
                bail!("{name} rate and burst must be greater than zero");
            }
        }
        for (name, value) in [
            ("decode concurrency", self.decode_concurrency),
            ("state vector entries", self.max_state_vector_entries),
            ("update clients", self.max_update_clients),
            (
                "update blocks per client",
                self.max_update_blocks_per_client,
            ),
            ("update elements", self.max_update_elements),
            ("update content bytes", self.max_update_content_bytes),
            ("update nesting depth", self.max_update_nesting_depth),
            ("project state bytes", self.max_project_state_bytes),
            (
                "materialized project bytes",
                self.max_materialized_project_bytes,
            ),
            ("project nodes", self.max_project_nodes),
            ("file name bytes", self.max_file_name_bytes),
            ("text file bytes", self.max_text_file_bytes),
            ("total text bytes", self.max_total_text_bytes),
        ] {
            if value == 0 {
                bail!("{name} limit must be greater than zero");
            }
        }
        if self.decode_timeout_ms == 0 {
            bail!("decode timeout must be greater than zero");
        }
        if self.max_project_state_bytes < DEFAULT_MAX_FRAME_BYTES {
            bail!("project state limit must hold at least one maximum frame");
        }
        if self.max_total_text_bytes < self.max_text_file_bytes {
            bail!("total text limit must be at least the per-file text limit");
        }
        Ok(())
    }

    pub fn room_broadcast_capacity(&self) -> usize {
        (self.room_broadcast_bytes / DEFAULT_MAX_FRAME_BYTES).max(1)
    }
}

#[derive(Clone)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    pub database_url: String,
    pub public_url: Url,
    pub mode: RuntimeMode,
    pub master_key: [u8; 32],
    pub setup_token: Option<String>,
    pub dev_bootstrap_token: Option<String>,
    pub dev_trust_loopback_proxy: bool,
    pub auto_migrate: bool,
    pub limits: ServerLimits,
}

impl ServerConfig {
    pub fn from_env() -> Result<Self> {
        let mode = std::env::var("OLEAFLY_REALTIME_MODE")
            .unwrap_or_else(|_| "production".to_owned())
            .parse()?;
        let bind = std::env::var("OLEAFLY_REALTIME_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8787".to_owned())
            .parse()
            .context("invalid OLEAFLY_REALTIME_BIND")?;
        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
        let public_url = std::env::var("OLEAFLY_REALTIME_PUBLIC_URL")
            .unwrap_or_else(|_| format!("http://{bind}"))
            .parse::<Url>()
            .context("invalid OLEAFLY_REALTIME_PUBLIC_URL")?;
        let master_key = parse_master_key(
            &std::env::var("OLEAFLY_REALTIME_MASTER_KEY")
                .context("OLEAFLY_REALTIME_MASTER_KEY is required")?,
        )?;
        let setup_token = std::env::var("OLEAFLY_REALTIME_SETUP_TOKEN").ok();
        let dev_bootstrap_token = std::env::var("OLEAFLY_DEV_BOOTSTRAP_TOKEN").ok();
        let dev_trust_loopback_proxy = parse_bool_env("OLEAFLY_DEV_TRUST_LOOPBACK_PROXY", false)?;
        let auto_migrate = parse_bool_env("OLEAFLY_REALTIME_AUTO_MIGRATE", false)?;
        let defaults = ServerLimits::default();
        let limits = ServerLimits {
            max_connections: parse_env(
                "OLEAFLY_REALTIME_MAX_CONNECTIONS",
                defaults.max_connections,
            )?,
            max_write_buffer_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_WRITE_BUFFER_BYTES",
                defaults.max_write_buffer_bytes,
            )?,
            room_broadcast_bytes: parse_env(
                "OLEAFLY_REALTIME_ROOM_BROADCAST_BYTES",
                defaults.room_broadcast_bytes,
            )?,
            mutation_rate_per_second: parse_env(
                "OLEAFLY_REALTIME_MUTATIONS_PER_SECOND",
                defaults.mutation_rate_per_second,
            )?,
            mutation_burst: parse_env("OLEAFLY_REALTIME_MUTATION_BURST", defaults.mutation_burst)?,
            state_vector_rate_per_second: parse_env(
                "OLEAFLY_REALTIME_STATE_VECTORS_PER_SECOND",
                defaults.state_vector_rate_per_second,
            )?,
            state_vector_burst: parse_env(
                "OLEAFLY_REALTIME_STATE_VECTOR_BURST",
                defaults.state_vector_burst,
            )?,
            presence_rate_per_second: parse_env(
                "OLEAFLY_REALTIME_PRESENCE_PER_SECOND",
                defaults.presence_rate_per_second,
            )?,
            presence_burst: parse_env("OLEAFLY_REALTIME_PRESENCE_BURST", defaults.presence_burst)?,
            auth_rate_per_minute: parse_env(
                "OLEAFLY_REALTIME_AUTH_PER_MINUTE",
                defaults.auth_rate_per_minute,
            )?,
            auth_burst: parse_env("OLEAFLY_REALTIME_AUTH_BURST", defaults.auth_burst)?,
            decode_concurrency: parse_env(
                "OLEAFLY_REALTIME_DECODE_CONCURRENCY",
                defaults.decode_concurrency,
            )?,
            decode_timeout_ms: parse_env(
                "OLEAFLY_REALTIME_DECODE_TIMEOUT_MS",
                defaults.decode_timeout_ms,
            )?,
            max_state_vector_entries: parse_env(
                "OLEAFLY_REALTIME_MAX_STATE_VECTOR_ENTRIES",
                defaults.max_state_vector_entries,
            )?,
            max_update_clients: parse_env(
                "OLEAFLY_REALTIME_MAX_UPDATE_CLIENTS",
                defaults.max_update_clients,
            )?,
            max_update_blocks_per_client: parse_env(
                "OLEAFLY_REALTIME_MAX_UPDATE_BLOCKS_PER_CLIENT",
                defaults.max_update_blocks_per_client,
            )?,
            max_update_elements: parse_env(
                "OLEAFLY_REALTIME_MAX_UPDATE_ELEMENTS",
                defaults.max_update_elements,
            )?,
            max_update_content_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_UPDATE_CONTENT_BYTES",
                defaults.max_update_content_bytes,
            )?,
            max_update_nesting_depth: parse_env(
                "OLEAFLY_REALTIME_MAX_UPDATE_NESTING_DEPTH",
                defaults.max_update_nesting_depth,
            )?,
            max_project_state_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_PROJECT_STATE_BYTES",
                defaults.max_project_state_bytes,
            )?,
            max_materialized_project_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_MATERIALIZED_PROJECT_BYTES",
                defaults.max_materialized_project_bytes,
            )?,
            max_project_nodes: parse_env(
                "OLEAFLY_REALTIME_MAX_PROJECT_NODES",
                defaults.max_project_nodes,
            )?,
            max_file_name_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_FILE_NAME_BYTES",
                defaults.max_file_name_bytes,
            )?,
            max_text_file_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_TEXT_FILE_BYTES",
                defaults.max_text_file_bytes,
            )?,
            max_total_text_bytes: parse_env(
                "OLEAFLY_REALTIME_MAX_TOTAL_TEXT_BYTES",
                defaults.max_total_text_bytes,
            )?,
        };

        let config = Self {
            bind,
            database_url,
            public_url,
            mode,
            master_key,
            setup_token,
            dev_bootstrap_token,
            dev_trust_loopback_proxy,
            auto_migrate,
            limits,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        self.limits.validate()?;
        match self.mode {
            RuntimeMode::Development => {
                let public_is_loopback = self.public_url.host_str().is_some_and(|host| {
                    host == "localhost"
                        || host
                            .parse::<std::net::IpAddr>()
                            .is_ok_and(|ip| ip.is_loopback())
                });
                if self.setup_token.is_some() {
                    bail!("OLEAFLY_REALTIME_SETUP_TOKEN is a production-only setting");
                }
                if self.dev_bootstrap_token.is_some()
                    && !self.bind.ip().is_loopback()
                    && !(self.dev_trust_loopback_proxy && public_is_loopback)
                {
                    bail!(
                        "development bootstrap routes require a loopback bind or an explicitly trusted loopback-only container proxy"
                    );
                }
                if self.public_url.scheme() != "http" && self.public_url.scheme() != "https" {
                    bail!("development public URL must use http or https");
                }
            }
            RuntimeMode::Production => {
                if self.dev_bootstrap_token.is_some() {
                    bail!("OLEAFLY_DEV_BOOTSTRAP_TOKEN is forbidden in production");
                }
                if self.dev_trust_loopback_proxy {
                    bail!("OLEAFLY_DEV_TRUST_LOOPBACK_PROXY is forbidden in production");
                }
                if self.public_url.scheme() != "https" {
                    bail!("production public URL must use https behind an OS-trusted TLS edge");
                }
            }
        }
        for (name, token) in [
            ("OLEAFLY_REALTIME_SETUP_TOKEN", self.setup_token.as_deref()),
            (
                "OLEAFLY_DEV_BOOTSTRAP_TOKEN",
                self.dev_bootstrap_token.as_deref(),
            ),
        ] {
            if token == Some("") {
                bail!("{name} must not be empty");
            }
        }
        Ok(())
    }

    pub fn dev_routes_enabled(&self) -> bool {
        self.mode == RuntimeMode::Development && self.dev_bootstrap_token.is_some()
    }

    pub fn production_routes_enabled(&self) -> bool {
        self.mode == RuntimeMode::Production
    }

    pub fn setup_route_enabled(&self) -> bool {
        self.production_routes_enabled() && self.setup_token.is_some()
    }
}

fn parse_master_key(value: &str) -> Result<[u8; 32]> {
    let decoded = STANDARD
        .decode(value)
        .context("OLEAFLY_REALTIME_MASTER_KEY must be standard base64")?;
    decoded
        .try_into()
        .map_err(|_| anyhow::anyhow!("OLEAFLY_REALTIME_MASTER_KEY must decode to exactly 32 bytes"))
}

fn parse_bool_env(name: &str, default: bool) -> Result<bool> {
    match std::env::var(name) {
        Ok(value) => match value.as_str() {
            "true" | "1" => Ok(true),
            "false" | "0" => Ok(false),
            _ => bail!("{name} must be true, false, 1, or 0"),
        },
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error.into()),
    }
}

fn parse_env<T>(name: &str, default: T) -> Result<T>
where
    T: FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match std::env::var(name) {
        Ok(value) => value.parse().with_context(|| format!("invalid {name}")),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(
        mode: RuntimeMode,
        bind: &str,
        public_url: &str,
        dev_token: Option<&str>,
    ) -> ServerConfig {
        ServerConfig {
            bind: bind.parse().unwrap(),
            database_url: "postgres://unused".to_owned(),
            public_url: public_url.parse().unwrap(),
            mode,
            master_key: [7; 32],
            setup_token: None,
            dev_bootstrap_token: dev_token.map(str::to_owned),
            dev_trust_loopback_proxy: false,
            auto_migrate: false,
            limits: ServerLimits::default(),
        }
    }

    #[test]
    fn production_fails_closed_for_dev_auth_and_plaintext_public_urls() {
        assert!(config(
            RuntimeMode::Production,
            "0.0.0.0:8787",
            "https://realtime.example.test",
            Some("secret")
        )
        .validate()
        .is_err());
        assert!(config(
            RuntimeMode::Production,
            "0.0.0.0:8787",
            "http://realtime.example.test",
            None
        )
        .validate()
        .is_err());
    }

    #[test]
    fn dev_auth_is_loopback_only() {
        assert!(config(
            RuntimeMode::Development,
            "0.0.0.0:8787",
            "http://localhost:8787",
            Some("secret")
        )
        .validate()
        .is_err());
        assert!(config(
            RuntimeMode::Development,
            "127.0.0.1:8787",
            "http://localhost:8787",
            Some("secret")
        )
        .validate()
        .is_ok());
    }

    #[test]
    fn limits_reject_unbounded_or_zero_capacity() {
        let limits = ServerLimits {
            max_connections: 0,
            ..ServerLimits::default()
        };
        assert!(limits.validate().is_err());
        let limits = ServerLimits {
            room_broadcast_bytes: DEFAULT_MAX_FRAME_BYTES - 1,
            ..ServerLimits::default()
        };
        assert!(limits.validate().is_err());
        let limits = ServerLimits {
            presence_burst: 0,
            ..ServerLimits::default()
        };
        assert!(limits.validate().is_err());
    }
}
