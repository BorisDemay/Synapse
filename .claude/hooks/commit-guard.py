#!/usr/bin/env python3
"""PreToolUse (Bash): keep the git pre-commit review in force for agent commits.
The review itself runs in .githooks/pre-commit; this only refuses commands
that would skip it (--no-verify, -n, a hooksPath override) and blocks commits
until the hook is enabled in the clone or worktree."""
import json
import re
import subprocess
import sys
from pathlib import Path

payload = json.load(sys.stdin)
command = payload.get("tool_input", {}).get("command", "")
# A git invocation up to the next separator: `git [opts] commit ...`, `git config ...`.
GIT_CALL = r"(?:^|[\s;&|(])git\s+(?:[^\n;&|]*?\s)?{sub}\b[^\n;&|]*"
commits = [m.group(0) for m in re.finditer(GIT_CALL.format(sub="commit"), command)]
configs = [m.group(0) for m in re.finditer(GIT_CALL.format(sub="config"), command)]


def block(message):
    print(f"Commit guard: {message}", file=sys.stderr)
    sys.exit(2)


if any(re.search(r"core\.hookspath", c, re.IGNORECASE) and not re.search(r"\.githooks\s*$", c)
       for c in configs):
    block("core.hooksPath must stay `.githooks` so agent commits get the Opus review.")
if not commits:
    sys.exit(0)
if any(re.search(r"--no-verify\b|core\.hookspath|\s-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)", c, re.IGNORECASE)
       for c in commits):
    block("the pre-commit review must not be skipped (--no-verify, -n or a hooksPath override). "
          "Fix the findings instead, or ask the user.")

cwd = payload.get("cwd")
hooks_path = subprocess.run(["git", "config", "--get", "core.hooksPath"], cwd=cwd,
                            capture_output=True, text=True).stdout.strip()
if hooks_path != ".githooks":
    block("the Opus pre-commit review is not enabled in this clone. "
          "Run `git config core.hooksPath .githooks` first.")
toplevel = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd,
                          capture_output=True, text=True).stdout.strip()
if toplevel and not (Path(toplevel) / ".githooks" / "pre-commit").is_file():
    block(f"{toplevel} has no .githooks/pre-commit (a branch older than the review hook?), "
          "so the Opus review would not run. Bring the branch up to date with main first.")
