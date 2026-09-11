#!/usr/bin/env python3
"""Reject deployment candidates that would change persistent Compose layout."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - depends on deployment host packaging
    yaml = None


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


def read_layout(path: str) -> dict[str, Any]:
    if yaml is None:
        raise InvalidLayout
    try:
        with Path(path).open(encoding="utf-8") as compose_file:
            document = yaml.safe_load(compose_file)
    except (OSError, yaml.YAMLError, UnicodeError):
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
    if len(arguments) != 2:
        print("invalid deployment layout arguments", file=sys.stderr)
        return 2

    try:
        current = read_layout(arguments[0])
        candidate = read_layout(arguments[1])
    except InvalidLayout:
        print("invalid deployment layout", file=sys.stderr)
        return 1

    if current != candidate:
        print("deployment layout is incompatible", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
