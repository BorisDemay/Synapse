#!/usr/bin/env python3
"""Portable exact-set integrity manifest. Backups must be from trusted operators."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys


def digest(path):
    with path.open('rb') as stream:
        value = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
        return value.hexdigest()


def files(root):
    result = {}
    for path in root.rglob('*'):
        mode = path.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise ValueError('backup contains symlink or special file')
        name = path.relative_to(root).as_posix()
        if '\n' in name or '\r' in name or '\\' in name:
            raise ValueError('unsupported backup filename')
        if stat.S_ISREG(mode) and name != 'manifest.sha256':
            if name not in ('postgres.dump', 'backup.json') and not name.startswith('blobs/'):
                raise ValueError('unexpected backup file')
            result[name] = digest(path)
    if not {'postgres.dump', 'backup.json'} <= result.keys() or not (root / 'blobs').is_dir():
        raise ValueError('incomplete backup')
    return result


def main():
    action, directory = sys.argv[1:]
    root = Path(directory)
    actual = files(root)
    metadata = json.loads((root / 'backup.json').read_text())
    if metadata.get('version') != 1:
        raise ValueError('unsupported backup version')
    manifest = root / 'manifest.sha256'
    if action == 'create':
        manifest.write_text(''.join(f'{actual[name]}  {name}\n' for name in sorted(actual)))
    elif action == 'verify':
        expected = {}
        for line in manifest.read_text().splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
            if not match:
                raise ValueError('invalid manifest entry')
            value, name = match.groups()
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or str(path) != name or name in expected:
                raise ValueError('unsafe or duplicate manifest path')
            expected[name] = value
        if expected != actual:
            raise ValueError('backup file set or checksum mismatch')
    else:
        raise ValueError('unknown action')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(f'backup integrity check failed: {error}', file=sys.stderr)
        sys.exit(1)
