ALTER TABLE operations
    ADD COLUMN IF NOT EXISTS note_id UUID;

UPDATE operations
SET note_id = id
WHERE note_id IS NULL;

ALTER TABLE operations
    ALTER COLUMN note_id SET NOT NULL;

ALTER TABLE sync_cursors
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE sync_cursors
SET id = md5(vault_id::text || user_id::text || revision::text)::uuid
WHERE id IS NULL;

UPDATE sync_cursors
SET expires_at = updated_at + INTERVAL '30 days'
WHERE expires_at IS NULL;

ALTER TABLE sync_cursors
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN expires_at SET NOT NULL,
    ALTER COLUMN expires_at SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days');

ALTER TABLE sync_cursors
    DROP CONSTRAINT IF EXISTS sync_cursors_pkey;

ALTER TABLE sync_cursors
    ADD PRIMARY KEY (id);
