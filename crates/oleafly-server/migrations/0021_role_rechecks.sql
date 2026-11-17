ALTER TABLE comment_rechecks ADD COLUMN role TEXT;
ALTER TABLE comment_rechecks ADD COLUMN comments_off INTEGER NOT NULL DEFAULT 0 CHECK (comments_off IN (0, 1));
