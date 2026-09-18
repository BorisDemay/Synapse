import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.backup = self.path / 'backup'
        self.backup.mkdir()
        (self.backup / 'blobs').mkdir()
        (self.backup / 'postgres.dump').write_bytes(b'dump')
        (self.backup / 'blobs' / 'cipher').write_bytes(b'encrypted')
        (self.backup / 'backup.json').write_text(json.dumps({'version': 1}))
        self.manifest()
        self.log = self.path / 'commands'
        docker = self.path / 'docker'
        docker.write_text('#!/bin/bash\necho "$*" >> "$TEST_LOG"\nexit 91\n')
        docker.chmod(0o755)
        self.env = dict(os.environ, PATH=f'{self.path}:{os.environ["PATH"]}', TEST_LOG=str(self.log))

    def manifest(self):
        files = sorted(p for p in self.backup.rglob('*') if p.is_file() and p.name != 'manifest.sha256')
        (self.backup / 'manifest.sha256').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(self.backup)}\n' for p in files))

    def refuse_before_docker(self):
        result = subprocess.run(['bash', str(ROOT / 'infra/scripts/restore.sh'), '--yes', str(self.backup)], env=self.env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists(), result.stderr.decode())

    def test_corrupt_dump(self):
        (self.backup / 'postgres.dump').write_bytes(b'corrupted')
        self.refuse_before_docker()

    def test_missing_blob(self):
        (self.backup / 'blobs/cipher').unlink()
        self.refuse_before_docker()

    def test_unlisted_blob(self):
        (self.backup / 'blobs/extra').write_bytes(b'extra')
        self.refuse_before_docker()

    def test_symlink(self):
        (self.backup / 'blobs/cipher').unlink()
        (self.backup / 'blobs/cipher').symlink_to('/etc/passwd')
        self.refuse_before_docker()

    def test_traversal_manifest(self):
        with (self.backup / 'manifest.sha256').open('a') as f:
            f.write('0' * 64 + '  ../outside\n')
        self.refuse_before_docker()

    def test_missing_manifest(self):
        (self.backup / 'manifest.sha256').unlink()
        self.refuse_before_docker()

    def test_duplicate_manifest(self):
        manifest = self.backup / 'manifest.sha256'
        manifest.write_text(manifest.read_text() * 2)
        self.refuse_before_docker()

    def test_relocated_manifest(self):
        moved = self.path / 'relocated directory'
        self.backup.rename(moved)
        result = subprocess.run(['python3', str(ROOT / 'infra/scripts/backup_manifest.py'), 'verify', str(moved)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def fake_docker(self, fail='', running='true'):
        (self.path / 'docker').write_text("""#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
  *'ps -a -q server'*) echo container ;;
  inspect*) echo "$RUNNING" ;;
  *'pg_dump '*) printf archive ;;
  cp*) [[ "$FAIL" != copy ]] || exit 8 ;;
  *'pg_restore --exit-on-error'*) [[ "$FAIL" != restore ]] || exit 9 ;;
esac
exit 0
""")
        self.env.update(FAIL=fail, RUNNING=running)

    def test_copy_failure_resumes_api_without_publishing(self):
        self.fake_docker(fail='copy')
        destination = self.path / 'output'
        destination.mkdir()
        (destination / 'previous').mkdir()
        (destination / 'latest').symlink_to('previous')
        result = subprocess.run(['bash', str(ROOT / 'infra/scripts/backup.sh'), str(destination)], env=self.env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        commands = self.log.read_text()
        self.assertIn('stop server', commands)
        self.assertIn('start server', commands)
        self.assertEqual(os.readlink(destination / 'latest'), 'previous')

    def test_previously_stopped_api_stays_stopped(self):
        self.fake_docker(running='false')
        result = subprocess.run(['bash', str(ROOT / 'infra/scripts/backup.sh'), str(self.path / 'output')], env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertNotIn('start server', self.log.read_text())
        self.assertNotIn('stop server', self.log.read_text())

    def test_restore_error_keeps_api_stopped(self):
        self.fake_docker(fail='restore')
        result = subprocess.run(['bash', str(ROOT / 'infra/scripts/restore.sh'), '--yes', str(self.backup)], env=self.env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stop server', self.log.read_text())
        self.assertNotIn('up -d --wait postgres server', self.log.read_text())
        self.assertNotIn('restore completed', result.stdout.decode())


if __name__ == '__main__':
    unittest.main()
