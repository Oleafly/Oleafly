ALTER TABLE device_authorizations ADD COLUMN requested_from TEXT;
ALTER TABLE device_authorizations ADD COLUMN grace_reply BLOB;
