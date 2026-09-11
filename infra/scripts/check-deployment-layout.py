#!/usr/bin/env python3
"""Reject deployment candidates that would change persistent Compose layout."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any


class InvalidLayout(Exception):
    pass


def required_mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvalidLayout
    return value


def required_string(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise InvalidLayout
    return value


def required_mounts(value: Any) -> list[Any]:
    if not isinstance(value, list):
        raise InvalidLayout
    return value


def render_layout(env_file: str, compose_file: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                env_file,
                "-f",
                compose_file,
                "config",
                "--format",
                "json",
            ],
            capture_output=True,
            check=True,
            text=True,
            timeout=30,
        )
        document = json.loads(result.stdout)
    except (
        FileNotFoundError,
        json.JSONDecodeError,
        OSError,
        subprocess.SubprocessError,
        UnicodeError,
    ):
        raise InvalidLayout from None

    compose = required_mapping(document)
    services = required_mapping(compose.get("services"))
    postgres = required_mapping(services.get("postgres"))
    server = required_mapping(services.get("server"))
    volumes = required_mapping(compose.get("volumes"))
    required_string(server.get("image"))
    return {
        "name": required_string(compose.get("name")),
        "volumes": volumes,
        "postgres_image": required_string(postgres.get("image")),
        "postgres_mounts": required_mounts(postgres.get("volumes")),
        "server_mounts": required_mounts(server.get("volumes")),
    }


def main(arguments: list[str]) -> int:
    if len(arguments) != 3:
        print("invalid deployment layout arguments", file=sys.stderr)
        return 2

    try:
        current = render_layout(arguments[0], arguments[1])
        candidate = render_layout(arguments[0], arguments[2])
    except InvalidLayout:
        print("invalid deployment layout", file=sys.stderr)
        return 1

    if current != candidate:
        print("deployment layout is incompatible", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
