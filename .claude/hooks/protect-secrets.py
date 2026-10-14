#!/usr/bin/env python3
"""PreToolUse: refuse agent edits to secret-bearing files (.env, keys)."""
import json
import re
import sys
from pathlib import PurePath

ALLOWED = {".env.example", ".env.development.example"}
BLOCKED = re.compile(r"^(\.env(\..+)?|id_(rsa|ed25519|ecdsa)|.*\.(pem|key|p12|pfx))$")

payload = json.load(sys.stdin)
tool_input = payload.get("tool_input", {})
path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
name = PurePath(path).name

if name and name not in ALLOWED and BLOCKED.match(name):
    print(
        f"Blocked: {name} may hold secrets and must not be edited by an agent. "
        "Edit the matching .example file or ask the user to change it.",
        file=sys.stderr,
    )
    sys.exit(2)
