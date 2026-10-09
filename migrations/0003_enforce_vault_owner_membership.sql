CREATE UNIQUE INDEX IF NOT EXISTS vault_members_one_owner
    ON vault_members (vault_id)
    WHERE role = 'owner';

CREATE OR REPLACE FUNCTION vault_must_have_matching_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM vaults WHERE id = NEW.id)
        AND NOT EXISTS (
            SELECT 1
            FROM vault_members
            WHERE vault_id = NEW.id
              AND user_id = NEW.owner_user_id
              AND role = 'owner'
        ) THEN
        RAISE EXCEPTION 'vault owner membership is required';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION vault_membership_must_match_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    affected_vault_id UUID := COALESCE(NEW.vault_id, OLD.vault_id);
BEGIN
    IF EXISTS (SELECT 1 FROM vaults WHERE id = affected_vault_id)
        AND NOT EXISTS (
            SELECT 1
            FROM vaults
            JOIN vault_members ON vault_members.vault_id = vaults.id
            WHERE vaults.id = affected_vault_id
              AND vault_members.user_id = vaults.owner_user_id
              AND vault_members.role = 'owner'
        ) THEN
        RAISE EXCEPTION 'vault owner membership is required';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS vault_requires_owner_membership ON vaults;
CREATE CONSTRAINT TRIGGER vault_requires_owner_membership
AFTER INSERT OR UPDATE OF owner_user_id ON vaults
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION vault_must_have_matching_owner();

DROP TRIGGER IF EXISTS vault_membership_requires_owner ON vault_members;
CREATE CONSTRAINT TRIGGER vault_membership_requires_owner
AFTER INSERT OR UPDATE OR DELETE ON vault_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION vault_membership_must_match_owner();
