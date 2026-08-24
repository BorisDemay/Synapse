#!/usr/bin/env bash
# `just desktop` must be a single recipe that starts Postgres, the API, and Tauri.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import json
import subprocess
import sys

dump = json.loads(
    subprocess.check_output(["just", "--dump", "--dump-format", "json"], text=True)
)
recipes = dump["recipes"]


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def dep_names(recipe: dict) -> list[str]:
    names: list[str] = []
    for dep in recipe.get("dependencies", []):
        if isinstance(dep, dict) and dep.get("recipe"):
            names.append(dep["recipe"])
        elif isinstance(dep, str):
            names.append(dep)
    return names


def body_text(recipe: dict) -> str:
    lines: list[str] = []
    for line in recipe.get("body", []):
        if isinstance(line, list):
            lines.append("".join(line))
        else:
            lines.append(str(line))
    return "\n".join(lines)


def collect(name: str, seen: set[str] | None = None) -> set[str]:
    seen = seen if seen is not None else set()
    if name in seen:
        return seen
    if name not in recipes:
        fail(f"just recipe {name!r} is missing")
    seen.add(name)
    for dep in dep_names(recipes[name]):
        collect(dep, seen)
    return seen


if "desktop" not in recipes:
    fail("missing just desktop recipe — one command must launch the native client")

desktop = recipes["desktop"]
if "parallel" not in desktop.get("attributes", []):
    fail("just desktop must start the API and Tauri in parallel")

graph = collect("desktop")
combined = "\n".join(body_text(recipes[name]) for name in sorted(graph))

if "cargo run -p synapse-server" not in combined:
    fail("just desktop must start the local synapse-server API")
if (
    "pnpm --filter @synapse/desktop tauri dev" not in combined
    and "just tauri" not in combined
):
    fail("just desktop must start the Tauri desktop client")
if "db" not in graph:
    fail("just desktop must start PostgreSQL via the db recipe")
if "/health/ready" not in combined:
    fail("just desktop must wait for the API readiness endpoint before opening Tauri")
if "$$(" in combined:
    fail("just desktop readiness loop must not pass an unexpanded command substitution to Bash")

print("just desktop launches postgres, the API, and Tauri")
PY
