#!/usr/bin/env python3
"""PostToolUse: after an edit in a security or sync area, remind the agent once
per session to run the security-reviewer subagent before calling it done."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

SENSITIVE = re.compile(
    r"^(crates/synapse-(crypto|sync|protocol|local-store)/"
    r"|migrations/"
    r"|apps/server/src/.*(auth|session|csrf|invite|storage|blob|sync|ws)"
    r"|apps/desktop/src-tauri/capabilities/"
    r"|apps/(web|desktop)/src/.*(crypto|sync|vault-key|session|unlock))"
)

if os.environ.get("SYNAPSE_COMMIT_REVIEW"):
    sys.exit(0)  # headless commit reviewer: read-only, nothing to check

payload = json.load(sys.stdin)
path = payload.get("tool_input", {}).get("file_path", "")
root = os.environ.get("CLAUDE_PROJECT_DIR", payload.get("cwd", ""))
try:
    rel = Path(path).resolve().relative_to(Path(root).resolve()).as_posix()
except ValueError:
    sys.exit(0)
if not SENSITIVE.match(rel):
    sys.exit(0)

marker = Path(tempfile.gettempdir()) / f"synapse-review-{payload.get('session_id', 'none')}"
if marker.exists():
    sys.exit(0)
marker.touch()

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": (
            f"{rel} is in a security/sync area. Follow skills/synapse-security and "
            "skills/synapse-sync, and have the security-reviewer subagent review the "
            "diff before declaring the change done. The review does not replace the "
            "validation commands."
        ),
    }
}))
