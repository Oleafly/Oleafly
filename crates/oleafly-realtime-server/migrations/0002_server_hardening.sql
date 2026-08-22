ALTER TABLE realtime_instance
    ADD COLUMN initialized_at timestamptz;

CREATE TABLE local_accounts (
    actor_id uuid PRIMARY KEY REFERENCES actors(actor_id) ON DELETE CASCADE,
    username text NOT NULL UNIQUE
        CHECK (username = lower(username))
        CHECK (char_length(username) BETWEEN 3 AND 100),
    password_hash text NOT NULL,
    disabled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_tokens (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    actor_id uuid NOT NULL REFERENCES actors(actor_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_tokens_expiry_idx ON access_tokens (expires_at);

ALTER TABLE authoring_journal
    ADD COLUMN mutation_sha256 bytea;
UPDATE authoring_journal SET mutation_sha256 = update_sha256;
ALTER TABLE authoring_journal
    ALTER COLUMN mutation_sha256 SET NOT NULL,
    ADD CHECK (octet_length(mutation_sha256) = 32),
    DROP COLUMN assistance,
    DROP CONSTRAINT authoring_journal_envelope_version_check,
    ADD CHECK (envelope_version IN (1, 2));
