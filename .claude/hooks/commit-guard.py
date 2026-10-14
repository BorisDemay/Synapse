#!/usr/bin/env python3
"""PreToolUse (Bash): keep the git review hooks in force for agent commits.
The review itself runs in .githooks/pre-commit and pre-merge-commit; this only
refuses commands that would skip it (--no-verify, -n, a hooksPath change) and
blocks commits until core.hooksPath is the absolute path of this repository's
.githooks, so every worktree and branch, including ones older than the hook,
runs the same review. It guards a cooperative agent against accidents, not a
deliberate bypass."""
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

COMMITTING = {"commit", "merge", "pull"}
SHELLS = {"sh", "bash", "zsh", "dash"}


def is_separator(token):
    # shlex glues adjacent punctuation (`);`, `&&(`), so any all-punctuation token separates.
    return re.fullmatch(r"[;&|()]+", token) is not None
COMMIT_WITH_VALUE = set("mFCct")
COMMIT_ATTACHED_VALUE = set("uS")  # `-uno`, `-SKEY`: never the next token
GLOBAL_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
                     "--super-prefix"}
LONG_WITH_VALUE = {"--message", "--file", "--reuse-message", "--reedit-message", "--author",
                   "--date", "--template", "--cleanup", "--fixup", "--squash", "--trailer"}


def block(message):
    print(f"Commit guard: {message}", file=sys.stderr)
    sys.exit(2)


def strip_message_heredocs(text):
    """Drop heredoc bodies that only feed a commit message (`git commit -F - <<'EOF'`).
    Other heredocs may be scripts that run git, so they stay in the scanned text."""
    out, terminator = [], None
    for line in text.split("\n"):
        if terminator is not None:
            if line.strip() == terminator:
                terminator = None
            continue
        out.append(line)
        marker = re.search(r"(?<!<)<<(?!<)-?\s*(['\"]?)([A-Za-z_]\w*)\1", line)
        if marker and re.search(r"\bcommit\b.*(\s-F\s*-|--file[=\s]-)(\s|$)", line):
            terminator = marker.group(2)
    return "\n".join(out)


def tokens_of(text):
    lexer = shlex.shlex(text.replace("\n", " ; "), posix=True, punctuation_chars=";&|()")
    lexer.whitespace_split = True
    lexer.commenters = ""
    return list(lexer)


def hooks_path_value_ok(value):
    # `$PWD/.githooks` is expanded by the shell; the commit-time check verifies the result.
    absolute = Path(value).is_absolute() or value.startswith(("$PWD/", "${PWD}/"))
    return absolute and value.rstrip("/").endswith("/.githooks")


def check_global_config(value):
    if value.partition("=")[0].lower() == "core.hookspath":
        block("the review hooks must not be overridden with -c core.hooksPath.")


def check_config(args):
    keys = [i for i, a in enumerate(args) if a.lower() == "core.hookspath"]
    if not keys:
        return
    if any(a.startswith(("--unset", "--remove-section", "--rename-section", "--replace-all", "--add"))
           or a in ("unset", "remove-section", "rename-section") for a in args):
        block("core.hooksPath must stay set so agent commits get the Opus review.")
    value = args[keys[0] + 1] if keys[0] + 1 < len(args) else None
    if value is not None and not value.startswith("-") and not hooks_path_value_ok(value):
        block("core.hooksPath must be the absolute path of this repository's .githooks.")


def skips_review(sub, args):
    i = 0
    while i < len(args):
        arg = args[i]
        name = arg.split("=", 1)[0]
        if re.fullmatch(r"--no-veri\w*", name):  # git accepts unambiguous prefixes
            return True
        if sub == "commit" and arg.startswith("--"):
            i += 2 if name in LONG_WITH_VALUE and "=" not in arg else 1
            continue
        if sub == "commit" and re.fullmatch(r"-[a-zA-Z]+", arg):
            for pos, flag in enumerate(arg[1:]):
                if flag == "n":
                    return True
                if flag in COMMIT_WITH_VALUE:
                    i += 0 if pos < len(arg) - 2 else 1  # value attached, or the next token
                    break
                if flag in COMMIT_ATTACHED_VALUE:
                    break
        i += 1
    return False


def scan(tokens):
    """Return True when the command creates commits; block when it skips the review."""
    committing = False
    i = 0
    while i < len(tokens):
        nested = (tokens[i] == "eval" or (Path(tokens[i]).name in SHELLS and i + 1 < len(tokens)
                                           and re.fullmatch(r"-\w*c\w*", tokens[i + 1])))
        if nested:  # `bash -c '... git commit ...'`, `eval '...'`: scan the script too
            j = i + 1 if tokens[i] == "eval" else i + 2
            while j < len(tokens) and not is_separator(tokens[j]):
                committing |= scan(tokens_of(tokens[j]))
                j += 1
        if tokens[i] != "git" and not tokens[i].endswith("/git"):
            i += 1
            continue
        i += 1
        while i < len(tokens) and tokens[i].startswith("-"):
            option, _, attached = tokens[i].partition("=")
            if option in ("-c", "--config-env"):
                check_global_config(attached or (tokens[i + 1] if i + 1 < len(tokens) else ""))
            elif option.startswith("-c") and not option.startswith("--"):
                check_global_config(option[2:])
            i += 2 if option in GLOBAL_WITH_VALUE and not attached else 1
        if i >= len(tokens):
            break
        sub, i = tokens[i], i + 1
        args = []
        while i < len(tokens) and not is_separator(tokens[i]):
            args.append(tokens[i])
            i += 1
        if sub == "config":
            check_config(args)
        elif sub in COMMITTING and any(a.lower().startswith("core.hookspath") for a in args):
            block("the review hooks must not be overridden (core.hooksPath).")
        if sub in COMMITTING:
            committing = True
            if skips_review(sub, args):
                block("the pre-commit review must not be skipped (--no-verify, -n or a hooksPath "
                      "override). Fix the findings instead, or ask the user.")
    return committing


payload = json.load(sys.stdin)
command = strip_message_heredocs(payload.get("tool_input", {}).get("command", ""))
if not re.search(r"\bgit\b", command):
    sys.exit(0)
try:
    committing = scan(tokens_of(command))
except ValueError:
    # Unbalanced quotes (an apostrophe in a heredoc, say): fail closed on anything that commits.
    lines = [line for line in command.split("\n") if re.search(r"(^|[\s;&|(])git\s", line)]
    if re.search(r"\b(commit|merge|pull)\b", "\n".join(lines)):
        block("could not parse the command, so it cannot be checked for review bypasses. "
              "Run the commit as a separate, simple command.")
    sys.exit(0)
if not committing:
    sys.exit(0)

cwd = payload.get("cwd")


def git(*args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True).stdout.strip()


common_dir = git("rev-parse", "--path-format=absolute", "--git-common-dir")
expected = Path(common_dir).parent / ".githooks" if common_dir else None
hooks = Path(git("config", "--get", "core.hooksPath") or ".")
if not (expected and hooks.is_absolute() and hooks.resolve() == expected.resolve()
        and (hooks / "pre-commit").is_file() and (hooks / "pre-merge-commit").is_file()):
    block("the Opus commit review is not enabled. From the main checkout, run "
          "`git config core.hooksPath \"$PWD/.githooks\"` first.")
