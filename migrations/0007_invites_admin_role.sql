-- Invitations may grant the administrator role, so an invited account can be
-- created either as a regular user or as an administrator.
ALTER TABLE invites
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
