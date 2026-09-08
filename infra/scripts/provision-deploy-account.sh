#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "run as root on the NAS" >&2; exit 1; }
DEPLOY_USER="${SYNAPSE_DEPLOY_USER:-synapse-deploy}"
DEPLOY_ROOT="${SYNAPSE_DEPLOY_ROOT:-/mnt/nas1/synapse}"
PUBLIC_KEY="${SYNAPSE_DEPLOY_PUBLIC_KEY:-}"
[[ -n "$PUBLIC_KEY" ]] || { echo "SYNAPSE_DEPLOY_PUBLIC_KEY is required" >&2; exit 2; }

id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin "$DEPLOY_USER"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 "$DEPLOY_ROOT/incoming" "$DEPLOY_ROOT/staging"
install -d -o root -g root -m 0755 "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/backups"
install -d -o root -g root -m 0755 "$DEPLOY_ROOT/infra/scripts"
install -o root -g root -m 0755 infra/scripts/backup.sh "$DEPLOY_ROOT/infra/scripts/backup.sh"
install -o root -g root -m 0644 infra/scripts/backup_manifest.py "$DEPLOY_ROOT/infra/scripts/backup_manifest.py"
install -o root -g root -m 0755 infra/scripts/deploy-release.sh /usr/local/sbin/synapse-deploy
install -o root -g root -m 0755 infra/scripts/synapse-deploy-ssh /usr/local/sbin/synapse-deploy-ssh

HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$HOME_DIR/.ssh"
printf 'restrict,command="/usr/local/sbin/synapse-deploy-ssh" %s\n' "$PUBLIC_KEY" > "$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 0600 "$HOME_DIR/.ssh/authorized_keys"

printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/synapse-deploy 0.1.* *\n' "$DEPLOY_USER" > /etc/sudoers.d/synapse-deploy
chmod 0440 /etc/sudoers.d/synapse-deploy
visudo -cf /etc/sudoers.d/synapse-deploy
