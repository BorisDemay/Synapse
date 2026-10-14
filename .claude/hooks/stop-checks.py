#!/usr/bin/env python3
"""Stop: typecheck the JS packages and cargo-check the Rust crates touched by the
working tree. Skips when nothing changed since the last passing run; a failure
blocks the stop and hands the error back to the agent."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

if os.environ.get("SYNAPSE_COMMIT_REVIEW"):
    sys.exit(0)  # headless commit reviewer: read-only, nothing to check

payload = json.load(sys.stdin)
if payload.get("stop_hook_active"):
    sys.exit(0)

root = Path(os.environ.get("CLAUDE_PROJECT_DIR", payload.get("cwd", "."))).resolve()
env = dict(os.environ)
for extra in ("/root/.nvm/versions/node/v22.23.2/bin", "/root/.cargo/bin"):
    if Path(extra).is_dir():
        env["PATH"] = f"{extra}:{env.get('PATH', '')}"
if Path("/root/.rustup").is_dir():
    env.setdefault("RUSTUP_HOME", "/root/.rustup")
    env.setdefault("CARGO_HOME", "/root/.cargo")


def git(*args):
    return subprocess.run(["git", *args], cwd=root, env=env, capture_output=True, text=True).stdout


changed = [line[3:].split(" -> ")[-1] for line in git("status", "--porcelain", "-uall").splitlines()]
if not changed:
    sys.exit(0)

digest = hashlib.sha256(git("diff", "HEAD").encode())
for path in changed:
    file = root / path
    if file.is_file() and path.endswith((".ts", ".vue", ".mts", ".tsx", ".rs", ".toml")):
        digest.update(path.encode() + file.read_bytes())
stamp = Path(tempfile.gettempdir()) / f"synapse-stop-{hashlib.sha256(str(root).encode()).hexdigest()[:12]}"
if stamp.exists() and stamp.read_text() == digest.hexdigest():
    sys.exit(0)

JS_PACKAGES = {
    "apps/web/": "@synapse/web",
    "apps/desktop/src/": "@synapse/desktop",
    "packages/api-client/": "@synapse/api-client",
    "packages/ui/": "@synapse/ui",
}
commands = []
for prefix, name in JS_PACKAGES.items():
    if any(p.startswith(prefix) and p.endswith((".ts", ".vue", ".mts", ".tsx")) for p in changed):
        commands.append(["pnpm", "--filter", name, "typecheck"])

rust = [p for p in changed if p.endswith((".rs", "Cargo.toml"))]
crates = sorted({p.split("/")[1] for p in rust if p.startswith("crates/")})
if any(p.startswith("apps/server/") for p in rust):
    crates.append("synapse-server")
if crates:
    cmd = ["cargo", "check", "--offline", "--all-targets"]
    for crate in crates:
        cmd += ["-p", crate]
    commands.append(cmd)
if any(p.startswith("apps/desktop/src-tauri/") for p in rust):
    commands.append(["cargo", "check", "--offline", "--all-targets",
                     "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"])

for cmd in commands:
    result = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        output = (result.stdout + result.stderr).strip().splitlines()
        print(f"`{' '.join(cmd)}` failed:\n" + "\n".join(output[-60:]), file=sys.stderr)
        sys.exit(2)

stamp.write_text(digest.hexdigest())
