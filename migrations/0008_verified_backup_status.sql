-- Operational timestamp only; no vault content or backup path is stored here.
CREATE TABLE IF NOT EXISTS backup_status (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    verified_at TIMESTAMPTZ NOT NULL
);
