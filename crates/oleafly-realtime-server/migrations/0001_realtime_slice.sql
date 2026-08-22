CREATE TABLE realtime_instance (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    instance_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE actors (
    actor_id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
    color_token text NOT NULL CHECK (char_length(color_token) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    project_id uuid PRIMARY KEY,
    lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('staging', 'active', 'archived_read_only', 'delete_pending')),
    next_server_sequence bigint NOT NULL DEFAULT 1 CHECK (next_server_sequence > 0),
    key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
    key_nonce bytea NOT NULL,
    key_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_memberships (
    project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES actors(actor_id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
    authorization_epoch bigint NOT NULL DEFAULT 1 CHECK (authorization_epoch > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, actor_id)
);

CREATE TABLE sync_tickets (
    ticket_hash bytea PRIMARY KEY CHECK (octet_length(ticket_hash) = 32),
    project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES actors(actor_id) ON DELETE CASCADE,
    replica_id uuid NOT NULL,
    authorization_epoch bigint NOT NULL CHECK (authorization_epoch > 0),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_tickets_expiry_idx ON sync_tickets (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE authoring_journal (
    project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    server_sequence bigint NOT NULL CHECK (server_sequence > 0),
    client_update_id uuid NOT NULL,
    replica_id uuid NOT NULL,
    client_sequence bigint NOT NULL CHECK (client_sequence >= 0),
    actor_id uuid NOT NULL REFERENCES actors(actor_id),
    authorization_epoch bigint NOT NULL CHECK (authorization_epoch > 0),
    edit_session_id uuid NOT NULL,
    origin text NOT NULL,
    assistance jsonb,
    update_sha256 bytea NOT NULL CHECK (octet_length(update_sha256) = 32),
    envelope_version integer NOT NULL DEFAULT 1 CHECK (envelope_version = 1),
    envelope_nonce bytea NOT NULL CHECK (octet_length(envelope_nonce) = 12),
    envelope_ciphertext bytea NOT NULL,
    committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (project_id, server_sequence),
    UNIQUE (project_id, client_update_id),
    UNIQUE (project_id, replica_id, client_sequence)
);

CREATE TABLE authoring_snapshots (
    project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    through_server_sequence bigint NOT NULL CHECK (through_server_sequence >= 0),
    envelope_version integer NOT NULL DEFAULT 1 CHECK (envelope_version = 1),
    envelope_nonce bytea NOT NULL CHECK (octet_length(envelope_nonce) = 12),
    envelope_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, through_server_sequence)
);

