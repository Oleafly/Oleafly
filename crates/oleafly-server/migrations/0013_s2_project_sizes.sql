-- What each project stores, kept as running totals by triggers so every
-- write keeps them right and a change checked against the project's size
-- limit doesn't sum the whole change log.
ALTER TABLE projects ADD COLUMN log_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN file_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE projects
SET log_bytes = (
    SELECT COALESCE(SUM(length(envelope)), 0) FROM project_updates
    WHERE project_updates.project_id = projects.id
)
WHERE id IN (SELECT project_id FROM project_updates);

UPDATE projects
SET file_bytes = (
    SELECT COALESCE(SUM(size), 0) FROM project_blobs
    WHERE project_blobs.project_id = projects.id
)
WHERE id IN (SELECT project_id FROM project_blobs);

CREATE TRIGGER project_updates_counted AFTER INSERT ON project_updates
BEGIN
    UPDATE projects SET log_bytes = log_bytes + length(NEW.envelope)
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_updates_uncounted AFTER DELETE ON project_updates
BEGIN
    UPDATE projects SET log_bytes = MAX(log_bytes - length(OLD.envelope), 0)
    WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_blobs_counted AFTER INSERT ON project_blobs
BEGIN
    UPDATE projects SET file_bytes = file_bytes + NEW.size
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_blobs_uncounted AFTER DELETE ON project_blobs
BEGIN
    UPDATE projects SET file_bytes = MAX(file_bytes - OLD.size, 0)
    WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_blobs_resized AFTER UPDATE OF size ON project_blobs
BEGIN
    UPDATE projects SET file_bytes = MAX(file_bytes - OLD.size + NEW.size, 0)
    WHERE id = NEW.project_id;
END;
