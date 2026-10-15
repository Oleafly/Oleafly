ALTER TABLE projects ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1));
