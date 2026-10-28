CREATE TABLE project_outputs (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('pdf', 'synctex')),
    blob_hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    compiled_by TEXT NOT NULL,
    compiled_at INTEGER NOT NULL,
    main_file TEXT NOT NULL,
    PRIMARY KEY (project_id, kind)
) STRICT;

CREATE INDEX project_outputs_hash ON project_outputs (blob_hash);
