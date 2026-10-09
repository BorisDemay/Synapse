ALTER TABLE users
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_activations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Re-running migrations must not activate accounts that still have an unused
-- challenge. Only legacy rows without an activation mail are backfilled.
UPDATE users
SET activated_at = created_at
WHERE activated_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM account_activations AS challenge WHERE challenge.user_id = users.id
  );
