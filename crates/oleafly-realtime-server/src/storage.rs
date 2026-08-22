use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use oleafly_realtime_protocol::{
    ActorId, ClientUpdateId, DurableReceiptV1, MutationEnvelopeV1, ProjectCapability, ProjectRole,
    ReplicaId, SharedProjectId,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, Postgres, Row, Transaction};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{
    digest, EnvelopeCrypto, JOURNAL_ENVELOPE_VERSION, KEY_VERSION, LEGACY_JOURNAL_ENVELOPE_VERSION,
    SNAPSHOT_ENVELOPE_VERSION,
};

const TICKET_LIFETIME: Duration = Duration::from_secs(60);
const ACCESS_TOKEN_LIFETIME: Duration = Duration::from_secs(5 * 60);
const SNAPSHOT_INTERVAL: i64 = 64;

#[derive(Clone)]
pub struct Storage {
    pool: PgPool,
    crypto: EnvelopeCrypto,
}

#[derive(Clone, Debug)]
pub struct TicketSession {
    pub actor_id: ActorId,
    pub project_id: SharedProjectId,
    pub replica_id: ReplicaId,
    pub role: ProjectRole,
    pub authorization_epoch: u64,
    pub display_name: String,
    pub color_token: String,
}

#[derive(Debug)]
pub struct LoadedProject {
    pub project_key: Zeroizing<[u8; 32]>,
    pub snapshot: Option<Vec<u8>>,
    pub updates: Vec<Vec<u8>>,
    pub through_server_sequence: u64,
}

#[derive(Debug)]
pub enum CommitMutation {
    New(DurableReceiptV1),
    Recovered(DurableReceiptV1),
    Duplicate(DurableReceiptV1),
}

#[derive(Debug)]
pub struct RoomMustReload {
    reason: String,
}

impl RoomMustReload {
    pub(crate) fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

impl std::fmt::Display for RoomMustReload {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}; authoring room must reload", self.reason)
    }
}

impl std::error::Error for RoomMustReload {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBootstrap {
    pub project_id: SharedProjectId,
    pub clients: Vec<DevClient>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevClient {
    pub actor_id: ActorId,
    pub replica_id: ReplicaId,
    pub display_name: String,
    pub ticket: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug)]
pub enum BootstrapResult {
    Created(ProductionBootstrap),
    AlreadyInitialized,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionBootstrap {
    pub actor_id: ActorId,
    pub project_id: SharedProjectId,
    pub username: String,
}

#[derive(Debug)]
pub struct LocalAccountCredential {
    pub actor_id: ActorId,
    pub password_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EncryptedJournalPayloadV2 {
    mutation: MutationEnvelopeV1,
}

impl Storage {
    pub async fn connect(database_url: &str, master_key: [u8; 32]) -> Result<Self> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(20)
            .connect(database_url)
            .await
            .context("connect to PostgreSQL")?;
        Ok(Self {
            pool,
            crypto: EnvelopeCrypto::new(master_key),
        })
    }

    pub async fn migrate(&self) -> Result<()> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .context("run realtime server migrations")?;
        Ok(())
    }

    pub async fn ready(&self) -> bool {
        sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .is_ok()
    }

    pub async fn instance_id(&self) -> Result<Uuid> {
        let candidate = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO realtime_instance (singleton, instance_id) VALUES (true, $1) ON CONFLICT (singleton) DO NOTHING",
        )
        .bind(candidate)
        .execute(&self.pool)
        .await
        .context("initialize realtime instance ID")?;
        sqlx::query_scalar("SELECT instance_id FROM realtime_instance WHERE singleton = true")
            .fetch_one(&self.pool)
            .await
            .context("read realtime instance ID")
    }

    pub async fn is_initialized(&self) -> Result<bool> {
        Ok(sqlx::query_scalar::<_, bool>(
            "SELECT initialized_at IS NOT NULL FROM realtime_instance WHERE singleton = true",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn production_bootstrap(
        &self,
        username: String,
        password_hash: String,
        display_name: String,
    ) -> Result<BootstrapResult> {
        let actor_id = Uuid::new_v4();
        let project_id = Uuid::now_v7();
        let project_key = Zeroizing::new(self.crypto.generate_project_key());
        let wrapped = self.crypto.wrap_project_key(project_id, &project_key)?;
        let mut tx = self.pool.begin().await?;
        let initialized: bool = sqlx::query_scalar(
            "SELECT initialized_at IS NOT NULL FROM realtime_instance WHERE singleton = true FOR UPDATE",
        )
        .fetch_one(&mut *tx)
        .await?;
        if initialized {
            tx.rollback().await?;
            return Ok(BootstrapResult::AlreadyInitialized);
        }
        sqlx::query(
            "INSERT INTO actors (actor_id, display_name, color_token) VALUES ($1, $2, 'leaf')",
        )
        .bind(actor_id)
        .bind(&display_name)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO local_accounts (actor_id, username, password_hash) VALUES ($1, $2, $3)",
        )
        .bind(actor_id)
        .bind(&username)
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO projects (project_id, key_version, key_nonce, key_ciphertext) VALUES ($1, $2, $3, $4)",
        )
        .bind(project_id)
        .bind(KEY_VERSION)
        .bind(wrapped.nonce.as_slice())
        .bind(wrapped.ciphertext)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO project_memberships (project_id, actor_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(project_id)
        .bind(actor_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE realtime_instance SET initialized_at = clock_timestamp() WHERE singleton = true",
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(BootstrapResult::Created(ProductionBootstrap {
            actor_id: ActorId::parse(&actor_id.to_string())?,
            project_id: SharedProjectId::parse(&project_id.to_string())?,
            username,
        }))
    }

    pub async fn local_account_credential(
        &self,
        username: &str,
    ) -> Result<Option<LocalAccountCredential>> {
        let row = sqlx::query(
            "SELECT actor_id, password_hash FROM local_accounts WHERE username = $1 AND disabled_at IS NULL",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            let actor_id: Uuid = row.try_get("actor_id")?;
            Ok(LocalAccountCredential {
                actor_id: ActorId::parse(&actor_id.to_string())?,
                password_hash: row.try_get("password_hash")?,
            })
        })
        .transpose()
    }

    pub async fn issue_access_token(&self, actor_id: ActorId) -> Result<[u8; 32]> {
        for _ in 0..4 {
            let mut token = [0; 32];
            rand::rng().fill_bytes(&mut token);
            let result = sqlx::query(
                "INSERT INTO access_tokens (token_hash, actor_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes') ON CONFLICT (token_hash) DO NOTHING",
            )
            .bind(digest(&token).as_slice())
            .bind(*actor_id.as_uuid())
            .execute(&self.pool)
            .await?;
            if result.rows_affected() == 1 {
                return Ok(token);
            }
        }
        bail!("could not allocate a unique access token")
    }

    pub async fn authenticate_access_token(&self, token: &[u8; 32]) -> Result<ActorId> {
        let actor_id: Uuid = sqlx::query_scalar(
            "SELECT t.actor_id FROM access_tokens t JOIN local_accounts a ON a.actor_id = t.actor_id WHERE t.token_hash = $1 AND t.expires_at > now() AND a.disabled_at IS NULL",
        )
        .bind(digest(token).as_slice())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow!("access token is invalid, expired, or revoked"))?;
        ActorId::parse(&actor_id.to_string()).map_err(Into::into)
    }

    pub async fn dev_bootstrap(&self) -> Result<DevBootstrap> {
        let project_id = Uuid::now_v7();
        let project_key = Zeroizing::new(self.crypto.generate_project_key());
        let wrapped = self.crypto.wrap_project_key(project_id, &project_key)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO projects (project_id, key_version, key_nonce, key_ciphertext) VALUES ($1, $2, $3, $4)",
        )
        .bind(project_id)
        .bind(KEY_VERSION)
        .bind(wrapped.nonce.as_slice())
        .bind(wrapped.ciphertext)
        .execute(&mut *tx)
        .await?;

        let specs = [("Alice", "leaf"), ("Bob", "sky")];
        let mut clients = Vec::with_capacity(specs.len());
        for (display_name, color_token) in specs {
            let actor_id = Uuid::new_v4();
            let replica_id = Uuid::now_v7();
            sqlx::query(
                "INSERT INTO actors (actor_id, display_name, color_token) VALUES ($1, $2, $3)",
            )
            .bind(actor_id)
            .bind(display_name)
            .bind(color_token)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO project_memberships (project_id, actor_id, role) VALUES ($1, $2, 'editor')",
            )
            .bind(project_id)
            .bind(actor_id)
            .execute(&mut *tx)
            .await?;
            let raw_ticket = self
                .insert_ticket(&mut tx, project_id, actor_id, replica_id, 1)
                .await?;
            clients.push(DevClient {
                actor_id: ActorId::parse(&actor_id.to_string())?,
                replica_id: ReplicaId::parse(&replica_id.to_string())?,
                display_name: display_name.to_owned(),
                ticket: encode_secret(&raw_ticket),
                expires_in_seconds: TICKET_LIFETIME.as_secs(),
            });
        }
        tx.commit().await?;
        Ok(DevBootstrap {
            project_id: SharedProjectId::parse(&project_id.to_string())?,
            clients,
        })
    }

    pub async fn issue_member_ticket(
        &self,
        project_id: SharedProjectId,
        actor_id: ActorId,
        replica_id: ReplicaId,
    ) -> Result<[u8; 32]> {
        let mut tx = self.pool.begin().await?;
        let epoch: i64 = sqlx::query_scalar(
            "SELECT authorization_epoch FROM project_memberships WHERE project_id = $1 AND actor_id = $2",
        )
        .bind(*project_id.as_uuid())
        .bind(*actor_id.as_uuid())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| anyhow!("actor is not a project member"))?;
        let epoch = u64::try_from(epoch).context("negative authorization epoch")?;
        let raw = self
            .insert_ticket(
                &mut tx,
                *project_id.as_uuid(),
                *actor_id.as_uuid(),
                *replica_id.as_uuid(),
                epoch,
            )
            .await?;
        tx.commit().await?;
        Ok(raw)
    }

    pub async fn issue_dev_ticket(
        &self,
        project_id: SharedProjectId,
        actor_id: ActorId,
        replica_id: ReplicaId,
    ) -> Result<[u8; 32]> {
        self.issue_member_ticket(project_id, actor_id, replica_id)
            .await
    }

    async fn insert_ticket(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        project_id: Uuid,
        actor_id: Uuid,
        replica_id: Uuid,
        authorization_epoch: u64,
    ) -> Result<[u8; 32]> {
        let authorization_epoch = i64::try_from(authorization_epoch)?;
        for _ in 0..4 {
            let mut ticket = [0; 32];
            rand::rng().fill_bytes(&mut ticket);
            let result = sqlx::query(
                "INSERT INTO sync_tickets (ticket_hash, project_id, actor_id, replica_id, authorization_epoch, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '60 seconds') ON CONFLICT (ticket_hash) DO NOTHING",
            )
            .bind(digest(&ticket).as_slice())
            .bind(project_id)
            .bind(actor_id)
            .bind(replica_id)
            .bind(authorization_epoch)
            .execute(&mut **tx)
            .await?;
            if result.rows_affected() == 1 {
                return Ok(ticket);
            }
        }
        bail!("could not allocate a unique sync ticket")
    }

    pub async fn consume_ticket(&self, ticket: &[u8; 32]) -> Result<TicketSession> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT t.project_id, t.actor_id, t.replica_id, t.authorization_epoch AS ticket_epoch, m.authorization_epoch AS membership_epoch, m.role, a.display_name, a.color_token, p.lifecycle
             FROM sync_tickets t
             JOIN project_memberships m ON m.project_id = t.project_id AND m.actor_id = t.actor_id
             JOIN actors a ON a.actor_id = t.actor_id
             JOIN projects p ON p.project_id = t.project_id
             WHERE t.ticket_hash = $1 AND t.consumed_at IS NULL AND t.expires_at > now()
             FOR UPDATE OF t",
        )
        .bind(digest(ticket).as_slice())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| anyhow!("sync ticket is invalid, expired, revoked, or already used"))?;

        let ticket_epoch: i64 = row.try_get("ticket_epoch")?;
        let membership_epoch: i64 = row.try_get("membership_epoch")?;
        let role = parse_role(row.try_get("role")?)?;
        if ticket_epoch != membership_epoch || row.try_get::<String, _>("lifecycle")? != "active" {
            bail!("sync ticket authorization is stale");
        }
        if !role.has(ProjectCapability::SourceRead) || !role.has(ProjectCapability::PresenceJoin) {
            bail!("project role cannot join realtime authoring");
        }
        sqlx::query(
            "UPDATE sync_tickets SET consumed_at = clock_timestamp() WHERE ticket_hash = $1",
        )
        .bind(digest(ticket).as_slice())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        let project_id: Uuid = row.try_get("project_id")?;
        let actor_id: Uuid = row.try_get("actor_id")?;
        let replica_id: Uuid = row.try_get("replica_id")?;
        Ok(TicketSession {
            actor_id: ActorId::parse(&actor_id.to_string())?,
            project_id: SharedProjectId::parse(&project_id.to_string())?,
            replica_id: ReplicaId::parse(&replica_id.to_string())?,
            role,
            authorization_epoch: u64::try_from(membership_epoch)?,
            display_name: row.try_get("display_name")?,
            color_token: row.try_get("color_token")?,
        })
    }

    pub async fn authorize_session(
        &self,
        session: &TicketSession,
        capability: ProjectCapability,
    ) -> Result<()> {
        let row = sqlx::query(
            "SELECT m.role, m.authorization_epoch, p.lifecycle FROM project_memberships m JOIN projects p ON p.project_id = m.project_id WHERE m.project_id = $1 AND m.actor_id = $2",
        )
        .bind(*session.project_id.as_uuid())
        .bind(*session.actor_id.as_uuid())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow!("project membership was revoked"))?;
        let epoch = u64::try_from(row.try_get::<i64, _>("authorization_epoch")?)?;
        let role = parse_role(row.try_get("role")?)?;
        if epoch != session.authorization_epoch {
            bail!("session authorization epoch is stale");
        }
        if row.try_get::<String, _>("lifecycle")? != "active" {
            bail!("project is not active");
        }
        if !role.has(capability) {
            bail!("project role no longer has the required capability");
        }
        Ok(())
    }

    pub async fn load_project(&self, project_id: SharedProjectId) -> Result<LoadedProject> {
        let project_uuid = *project_id.as_uuid();
        let row = sqlx::query(
            "SELECT key_version, key_nonce, key_ciphertext FROM projects WHERE project_id = $1",
        )
        .bind(project_uuid)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow!("project does not exist"))?;
        let key_version: i32 = row.try_get("key_version")?;
        if key_version != KEY_VERSION {
            bail!("unsupported project key version {key_version}");
        }
        let project_key = Zeroizing::new(self.crypto.unwrap_project_key(
            project_uuid,
            row.try_get::<Vec<u8>, _>("key_nonce")?.as_slice(),
            row.try_get::<Vec<u8>, _>("key_ciphertext")?.as_slice(),
        )?);

        let snapshot_row = sqlx::query(
            "SELECT through_server_sequence, envelope_version, envelope_nonce, envelope_ciphertext FROM authoring_snapshots WHERE project_id = $1 ORDER BY through_server_sequence DESC LIMIT 1",
        )
        .bind(project_uuid)
        .fetch_optional(&self.pool)
        .await?;
        let (snapshot, snapshot_watermark) = if let Some(row) = snapshot_row {
            let envelope_version: i32 = row.try_get("envelope_version")?;
            if envelope_version != SNAPSHOT_ENVELOPE_VERSION {
                bail!("unsupported authoring snapshot envelope version {envelope_version}");
            }
            let sequence: i64 = row.try_get("through_server_sequence")?;
            let state = self.crypto.decrypt_snapshot(
                project_uuid,
                sequence,
                &project_key,
                row.try_get::<Vec<u8>, _>("envelope_nonce")?.as_slice(),
                row.try_get::<Vec<u8>, _>("envelope_ciphertext")?.as_slice(),
            )?;
            (Some(state), sequence)
        } else {
            (None, 0)
        };

        let rows = sqlx::query(
            "SELECT server_sequence, envelope_version, envelope_nonce, envelope_ciphertext FROM authoring_journal WHERE project_id = $1 AND server_sequence > $2 ORDER BY server_sequence",
        )
        .bind(project_uuid)
        .bind(snapshot_watermark)
        .fetch_all(&self.pool)
        .await?;
        let mut updates = Vec::with_capacity(rows.len());
        let mut through_server_sequence = snapshot_watermark;
        for row in rows {
            let envelope_version: i32 = row.try_get("envelope_version")?;
            let sequence: i64 = row.try_get("server_sequence")?;
            if sequence != through_server_sequence + 1 {
                bail!(
                    "authoring journal is not contiguous after server sequence {through_server_sequence}"
                );
            }
            let plaintext = match envelope_version {
                LEGACY_JOURNAL_ENVELOPE_VERSION => self.crypto.decrypt_legacy_journal(
                    project_uuid,
                    sequence,
                    &project_key,
                    row.try_get::<Vec<u8>, _>("envelope_nonce")?.as_slice(),
                    row.try_get::<Vec<u8>, _>("envelope_ciphertext")?.as_slice(),
                )?,
                JOURNAL_ENVELOPE_VERSION => {
                    let plaintext = self.crypto.decrypt_journal(
                        project_uuid,
                        sequence,
                        &project_key,
                        row.try_get::<Vec<u8>, _>("envelope_nonce")?.as_slice(),
                        row.try_get::<Vec<u8>, _>("envelope_ciphertext")?.as_slice(),
                    )?;
                    serde_json::from_slice::<EncryptedJournalPayloadV2>(&plaintext)
                        .context("decode encrypted journal payload")?
                        .mutation
                        .update
                }
                _ => bail!("unsupported authoring journal envelope version {envelope_version}"),
            };
            updates.push(plaintext);
            through_server_sequence = sequence;
        }
        Ok(LoadedProject {
            project_key,
            snapshot,
            updates,
            through_server_sequence: u64::try_from(through_server_sequence)?,
        })
    }

    pub async fn commit_mutation(
        &self,
        session: &TicketSession,
        envelope: &MutationEnvelopeV1,
        project_key: &[u8; 32],
        candidate_snapshot: &[u8],
        expected_room_watermark: u64,
    ) -> Result<CommitMutation> {
        if envelope.replica_id != session.replica_id {
            bail!("mutation replica does not match the authenticated session");
        }
        let client_sequence = i64::try_from(envelope.client_sequence)
            .context("client sequence exceeds PostgreSQL bigint")?;
        let journal_payload = serde_json::to_vec(&EncryptedJournalPayloadV2 {
            mutation: envelope.clone(),
        })?;
        let mutation_digest = digest(&journal_payload);
        let update_digest = digest(&envelope.update);
        let mut tx = self.pool.begin().await?;
        let project_row = sqlx::query(
            "SELECT next_server_sequence, lifecycle FROM projects WHERE project_id = $1 FOR UPDATE",
        )
        .bind(*session.project_id.as_uuid())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| anyhow!("project does not exist"))?;
        if project_row.try_get::<String, _>("lifecycle")? != "active" {
            bail!("project is not writable");
        }
        let current_epoch = lock_mutation_authorization(&mut tx, session).await?;

        if let Some(existing) = sqlx::query(
            "SELECT client_update_id, replica_id, client_sequence, update_sha256, mutation_sha256, envelope_version, server_sequence, authorization_epoch, floor(extract(epoch from committed_at) * 1000)::bigint AS committed_ms
             FROM authoring_journal
             WHERE project_id = $1 AND (client_update_id = $2 OR (replica_id = $3 AND client_sequence = $4))",
        )
        .bind(*session.project_id.as_uuid())
        .bind(*envelope.client_update_id.as_uuid())
        .bind(*envelope.replica_id.as_uuid())
        .bind(client_sequence)
        .fetch_optional(&mut *tx)
        .await?
        {
            let same_identity = existing.try_get::<Uuid, _>("client_update_id")?
                == *envelope.client_update_id.as_uuid()
                && existing.try_get::<Uuid, _>("replica_id")? == *envelope.replica_id.as_uuid()
                && existing.try_get::<i64, _>("client_sequence")? == client_sequence;
            let same_mutation = match existing.try_get::<i32, _>("envelope_version")? {
                LEGACY_JOURNAL_ENVELOPE_VERSION => {
                    existing.try_get::<Vec<u8>, _>("update_sha256")? == update_digest.as_slice()
                }
                JOURNAL_ENVELOPE_VERSION => {
                    existing.try_get::<Vec<u8>, _>("mutation_sha256")?
                        == mutation_digest.as_slice()
                }
                _ => false,
            };
            if !same_identity || !same_mutation {
                bail!("mutation idempotency key was reused with different data");
            }
            let receipt = receipt_from_row(&existing)?;
            tx.commit().await?;
            return Ok(CommitMutation::Duplicate(receipt));
        }

        let server_sequence: i64 = project_row.try_get("next_server_sequence")?;
        let expected_room_watermark = i64::try_from(expected_room_watermark)
            .context("room watermark exceeds PostgreSQL bigint")?;
        if expected_room_watermark != server_sequence - 1 {
            return Err(RoomMustReload::new(format!(
                "room watermark {expected_room_watermark} does not precede database sequence {server_sequence}"
            ))
            .into());
        }
        let encrypted = self.crypto.encrypt_journal(
            *session.project_id.as_uuid(),
            server_sequence,
            project_key,
            &journal_payload,
        )?;
        let row = sqlx::query(
            "INSERT INTO authoring_journal (
                project_id, server_sequence, client_update_id, replica_id, client_sequence,
                actor_id, authorization_epoch, edit_session_id, origin, update_sha256,
                mutation_sha256, envelope_version, envelope_nonce, envelope_ciphertext
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING client_update_id, replica_id, client_sequence, server_sequence,
                 authorization_epoch, floor(extract(epoch from committed_at) * 1000)::bigint AS committed_ms",
        )
        .bind(*session.project_id.as_uuid())
        .bind(server_sequence)
        .bind(*envelope.client_update_id.as_uuid())
        .bind(*envelope.replica_id.as_uuid())
        .bind(client_sequence)
        .bind(*session.actor_id.as_uuid())
        .bind(current_epoch)
        .bind(*envelope.edit_session_id.as_uuid())
        .bind(origin_name(envelope))
        .bind(update_digest.as_slice())
        .bind(mutation_digest.as_slice())
        .bind(JOURNAL_ENVELOPE_VERSION)
        .bind(encrypted.nonce.as_slice())
        .bind(encrypted.ciphertext)
        .fetch_one(&mut *tx)
        .await?;
        if server_sequence == 1 || server_sequence % SNAPSHOT_INTERVAL == 0 {
            let snapshot = self.crypto.encrypt_snapshot(
                *session.project_id.as_uuid(),
                server_sequence,
                project_key,
                candidate_snapshot,
            )?;
            let inserted = sqlx::query(
                "INSERT INTO authoring_snapshots (project_id, through_server_sequence, envelope_version, envelope_nonce, envelope_ciphertext)
                 SELECT project_id, $2, $3, $4, $5 FROM projects
                 WHERE project_id = $1 AND next_server_sequence = $6",
            )
            .bind(*session.project_id.as_uuid())
            .bind(server_sequence)
            .bind(SNAPSHOT_ENVELOPE_VERSION)
            .bind(snapshot.nonce.as_slice())
            .bind(snapshot.ciphertext)
            .bind(server_sequence)
            .execute(&mut *tx)
            .await?;
            if inserted.rows_affected() != 1 {
                return Err(RoomMustReload::new(
                    "snapshot predecessor no longer matches the locked project watermark",
                )
                .into());
            }
            sqlx::query(
                "DELETE FROM authoring_snapshots WHERE project_id = $1 AND through_server_sequence < $2",
            )
            .bind(*session.project_id.as_uuid())
            .bind(server_sequence)
            .execute(&mut *tx)
            .await?;
        }
        let advanced = sqlx::query(
            "UPDATE projects SET next_server_sequence = next_server_sequence + 1
             WHERE project_id = $1 AND next_server_sequence = $2",
        )
        .bind(*session.project_id.as_uuid())
        .bind(server_sequence)
        .execute(&mut *tx)
        .await?;
        if advanced.rows_affected() != 1 {
            return Err(RoomMustReload::new(
                "project watermark changed while committing the mutation",
            )
            .into());
        }
        let receipt = receipt_from_row(&row)?;
        if let Err(commit_error) = tx.commit().await {
            return self
                .resolve_ambiguous_commit(
                    session,
                    envelope,
                    mutation_digest.as_slice(),
                    update_digest.as_slice(),
                    commit_error,
                )
                .await;
        }
        Ok(CommitMutation::New(receipt))
    }

    async fn resolve_ambiguous_commit(
        &self,
        session: &TicketSession,
        envelope: &MutationEnvelopeV1,
        mutation_digest: &[u8],
        update_digest: &[u8],
        commit_error: sqlx::Error,
    ) -> Result<CommitMutation> {
        // `Transaction::commit` consumes its connection. Check the idempotency keys through a
        // newly acquired pool connection before deciding whether the exact staged candidate is
        // durable. Absence is not proof of rollback after a transport error, so callers must fence
        // the room rather than continue from an in-memory watermark.
        let mut connection = self.pool.acquire().await.map_err(|lookup_error| {
            RoomMustReload::new(format!(
                "database commit failed ({commit_error}) and durability lookup failed ({lookup_error})"
            ))
        })?;
        let existing = lookup_mutation(
            &mut connection,
            session,
            envelope,
            mutation_digest,
            update_digest,
        )
        .await
        .map_err(|lookup_error| {
            RoomMustReload::new(format!(
                "database commit failed ({commit_error}) and durability lookup failed ({lookup_error})"
            ))
        })?;
        match existing {
            Some(receipt) => Ok(CommitMutation::Recovered(receipt)),
            None => Err(RoomMustReload::new(format!(
                "database commit returned an error and durable outcome could not be proven: {commit_error}"
            ))
            .into()),
        }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

async fn lock_mutation_authorization(
    tx: &mut Transaction<'_, Postgres>,
    session: &TicketSession,
) -> Result<i64> {
    // Mutation and future membership/grant writers must lock the project first, then this
    // membership row. If revocation commits first, this read observes the new epoch and rejects the
    // mutation. If mutation obtains both locks first, it is the earlier operation and revocation
    // waits for its durable commit.
    let membership = sqlx::query(
        "SELECT role, authorization_epoch FROM project_memberships
         WHERE project_id = $1 AND actor_id = $2
         FOR UPDATE",
    )
    .bind(*session.project_id.as_uuid())
    .bind(*session.actor_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| anyhow!("project membership was revoked"))?;
    let current_epoch: i64 = membership.try_get("authorization_epoch")?;
    if u64::try_from(current_epoch)? != session.authorization_epoch {
        bail!("session authorization epoch is stale");
    }
    if !parse_role(membership.try_get("role")?)?.has(ProjectCapability::SourceWrite) {
        bail!("project role cannot mutate source");
    }
    Ok(current_epoch)
}

async fn lookup_mutation(
    connection: &mut PgConnection,
    session: &TicketSession,
    envelope: &MutationEnvelopeV1,
    mutation_digest: &[u8],
    update_digest: &[u8],
) -> Result<Option<DurableReceiptV1>> {
    let client_sequence = i64::try_from(envelope.client_sequence)
        .context("client sequence exceeds PostgreSQL bigint")?;
    let existing = sqlx::query(
        "SELECT client_update_id, replica_id, client_sequence, actor_id, update_sha256,
                mutation_sha256, envelope_version, server_sequence, authorization_epoch,
                floor(extract(epoch from committed_at) * 1000)::bigint AS committed_ms
         FROM authoring_journal
         WHERE project_id = $1
           AND (client_update_id = $2 OR (replica_id = $3 AND client_sequence = $4))",
    )
    .bind(*session.project_id.as_uuid())
    .bind(*envelope.client_update_id.as_uuid())
    .bind(*envelope.replica_id.as_uuid())
    .bind(client_sequence)
    .fetch_optional(connection)
    .await?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    let same_identity = existing.try_get::<Uuid, _>("client_update_id")?
        == *envelope.client_update_id.as_uuid()
        && existing.try_get::<Uuid, _>("replica_id")? == *envelope.replica_id.as_uuid()
        && existing.try_get::<i64, _>("client_sequence")? == client_sequence
        && existing.try_get::<Uuid, _>("actor_id")? == *session.actor_id.as_uuid();
    let same_mutation = match existing.try_get::<i32, _>("envelope_version")? {
        LEGACY_JOURNAL_ENVELOPE_VERSION => {
            existing.try_get::<Vec<u8>, _>("update_sha256")? == update_digest
        }
        JOURNAL_ENVELOPE_VERSION => {
            existing.try_get::<Vec<u8>, _>("mutation_sha256")? == mutation_digest
        }
        _ => false,
    };
    if !same_identity || !same_mutation {
        bail!("mutation idempotency key was reused with different data");
    }
    Ok(Some(receipt_from_row(&existing)?))
}

fn receipt_from_row(row: &sqlx::postgres::PgRow) -> Result<DurableReceiptV1> {
    let client_update_id: Uuid = row.try_get("client_update_id")?;
    let replica_id: Uuid = row.try_get("replica_id")?;
    Ok(DurableReceiptV1 {
        client_update_id: ClientUpdateId::parse(&client_update_id.to_string())?,
        replica_id: ReplicaId::parse(&replica_id.to_string())?,
        client_sequence: u64::try_from(row.try_get::<i64, _>("client_sequence")?)?,
        server_sequence: u64::try_from(row.try_get::<i64, _>("server_sequence")?)?,
        authorization_epoch: u64::try_from(row.try_get::<i64, _>("authorization_epoch")?)?,
        committed_at_unix_ms: u64::try_from(row.try_get::<i64, _>("committed_ms")?)?,
    })
}

fn parse_role(value: &str) -> Result<ProjectRole> {
    match value {
        "viewer" => Ok(ProjectRole::Viewer),
        "commenter" => Ok(ProjectRole::Commenter),
        "editor" => Ok(ProjectRole::Editor),
        "owner" => Ok(ProjectRole::Owner),
        _ => bail!("database contains an unknown project role"),
    }
}

fn origin_name(envelope: &MutationEnvelopeV1) -> &'static str {
    use oleafly_realtime_protocol::MutationOrigin;
    match envelope.origin {
        MutationOrigin::Human => "human",
        MutationOrigin::SuggestionAccept => "suggestion_accept",
        MutationOrigin::VersionRestore => "version_restore",
        MutationOrigin::ExternalSmallSave => "external_small_save",
        MutationOrigin::ExternalBulkApply => "external_bulk_apply",
        MutationOrigin::Import => "import",
    }
}

pub fn encode_secret(secret: &[u8; 32]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(secret)
}

pub fn decode_secret(value: &str) -> Result<[u8; 32]> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD
        .decode(value)?
        .try_into()
        .map_err(|_| anyhow!("credential has an invalid length"))
}

pub fn encode_ticket(ticket: &[u8; 32]) -> String {
    encode_secret(ticket)
}

pub const fn access_token_lifetime_seconds() -> u64 {
    ACCESS_TOKEN_LIFETIME.as_secs()
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use oleafly_realtime_protocol::{ClientUpdateId, EditSessionId, MutationOrigin};

    use super::*;

    #[derive(Deserialize)]
    struct AuthoringFixture {
        #[serde(rename = "yjsUpdateV1Base64")]
        yjs_update_v1_base64: String,
    }

    #[tokio::test]
    #[ignore = "requires OLEAFLY_REALTIME_TEST_DATABASE_URL"]
    async fn ambiguous_commit_lookup_recovers_an_exact_durable_mutation() -> Result<()> {
        let database_url = std::env::var("OLEAFLY_REALTIME_TEST_DATABASE_URL")?;
        let storage = Storage::connect(&database_url, [42; 32]).await?;
        storage.migrate().await?;
        sqlx::query(
            "TRUNCATE TABLE realtime_instance, access_tokens, local_accounts, sync_tickets, authoring_snapshots, authoring_journal, project_memberships, projects, actors CASCADE",
        )
        .execute(storage.pool())
        .await?;
        let bootstrap = storage.dev_bootstrap().await?;
        let client = &bootstrap.clients[0];
        let ticket = decode_secret(&client.ticket)?;
        let session = storage.consume_ticket(&ticket).await?;
        let loaded = storage.load_project(bootstrap.project_id).await?;
        let fixture: AuthoringFixture = serde_json::from_str(include_str!(
            "../../../fixtures/realtime/authoring-doc-v1.json"
        ))?;
        let update = STANDARD.decode(fixture.yjs_update_v1_base64)?;
        let envelope = MutationEnvelopeV1 {
            client_update_id: ClientUpdateId::parse(&Uuid::now_v7().to_string())?,
            replica_id: client.replica_id,
            client_sequence: 1,
            edit_session_id: EditSessionId::parse(&Uuid::now_v7().to_string())?,
            origin: MutationOrigin::Human,
            assistance: None,
            update: update.clone(),
        };
        let committed = storage
            .commit_mutation(&session, &envelope, &loaded.project_key, &update, 0)
            .await?;
        let CommitMutation::New(committed) = committed else {
            bail!("fault-injection setup did not create a new mutation");
        };
        let payload = serde_json::to_vec(&EncryptedJournalPayloadV2 {
            mutation: envelope.clone(),
        })?;
        let recovered = storage
            .resolve_ambiguous_commit(
                &session,
                &envelope,
                digest(&payload).as_slice(),
                digest(&update).as_slice(),
                sqlx::Error::Protocol("injected ambiguous commit result".to_owned()),
            )
            .await?;
        let CommitMutation::Recovered(recovered) = recovered else {
            bail!("durability lookup did not classify the mutation as recovered");
        };
        assert_eq!(recovered.server_sequence, committed.server_sequence);
        assert_eq!(recovered.client_update_id, committed.client_update_id);
        assert_eq!(recovered.replica_id, committed.replica_id);
        assert_eq!(recovered.client_sequence, committed.client_sequence);
        Ok(())
    }
}
