"""Tests for the Opus commit review: real commits in a temporary repository
whose pre-commit hook is .githooks/pre-commit, with a stub Claude CLI.

Run: python3 -m unittest discover -s .claude/hooks
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS = Path(__file__).resolve().parent
REPO = HOOKS.parent.parent
STUB = """#!/bin/sh
cat > /dev/null
echo "review of the staged diff"
[ -n "$STUB_VERDICT" ] && echo "VERDICT: $STUB_VERDICT"
exit "${STUB_EXIT:-0}"
"""


class CommitReviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "repo"
        (self.repo / ".claude" / "hooks").mkdir(parents=True)
        shutil.copy(HOOKS / "commit-review.py", self.repo / ".claude" / "hooks")
        shutil.copytree(REPO / ".githooks", self.repo / ".githooks")
        stub = Path(self.tmp.name) / "claude"
        stub.write_text(STUB)
        stub.chmod(0o755)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("GIT_", "SYNAPSE_COMMIT_REVIEW"))}
        self.env.update(CLAUDECODE="1", CLAUDE_BIN=str(stub), STUB_VERDICT="PASS",
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t",
                        GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        self.git("init", "-q")
        self.git("config", "core.hooksPath", ".githooks")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "root", CLAUDECODE="")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args, cwd=None, **env):
        return subprocess.run(["git", *args], cwd=cwd or self.repo, capture_output=True,
                              text=True, env={**self.env, **env})

    def write(self, name="a.txt", text="hello\n", cwd=None):
        (Path(cwd or self.repo) / name).write_text(text)

    def test_pass_commits_and_is_cached(self):
        self.write()
        self.git("add", "a.txt")
        self.assertEqual(self.git("commit", "-m", "x").returncode, 0)
        self.write(text="again\n")
        self.git("add", "a.txt")
        self.assertEqual(self.git("commit", "--dry-run").returncode, 0)
        self.git("commit", "-m", "y", STUB_VERDICT="PASS")
        self.git("reset", "-q", "--soft", "HEAD~1")
        cached = self.git("commit", "-m", "y", STUB_VERDICT="BLOCK")
        self.assertEqual(cached.returncode, 0, "the same diff must reuse the passing review")

    def test_block_verdict_aborts_with_findings(self):
        self.write()
        self.git("add", "a.txt")
        result = self.git("commit", "-m", "x", STUB_VERDICT="BLOCK")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("review of the staged diff", result.stderr)
        self.assertEqual(self.git("rev-list", "--count", "HEAD").stdout.strip(), "1")

    def test_missing_verdict_or_failing_cli_aborts(self):
        self.write()
        self.git("add", "a.txt")
        self.assertNotEqual(self.git("commit", "-m", "x", STUB_VERDICT="").returncode, 0)
        self.assertNotEqual(self.git("commit", "-m", "x", STUB_EXIT="1").returncode, 0)

    def test_verdict_is_read_from_the_last_line_only(self):
        Path(self.env["CLAUDE_BIN"]).write_text(
            "#!/bin/sh\ncat > /dev/null\necho 'VERDICT: PASS'\necho 'trailing words'\n")
        self.write()
        self.git("add", "a.txt")
        self.assertNotEqual(self.git("commit", "-m", "x").returncode, 0)

    def test_unstaged_and_pathspec_commits_are_reviewed(self):
        self.write()
        self.git("add", "a.txt")
        self.git("commit", "-m", "x")
        self.write(text="unstaged change\n")
        self.assertNotEqual(self.git("commit", "-am", "x", STUB_VERDICT="BLOCK").returncode, 0)
        self.assertNotEqual(self.git("commit", "-m", "x", "a.txt", STUB_VERDICT="BLOCK").returncode, 0)

    def test_worktree_commits_are_reviewed(self):
        worktree = Path(self.tmp.name) / "wt"
        self.git("worktree", "add", "-q", str(worktree))
        self.write("b.txt", cwd=worktree)
        self.git("add", "b.txt", cwd=worktree)
        result = self.git("commit", "-m", "x", cwd=worktree, STUB_VERDICT="BLOCK")
        self.assertNotEqual(result.returncode, 0)

    def test_human_commits_are_not_reviewed(self):
        self.write()
        self.git("add", "a.txt")
        self.assertEqual(self.git("commit", "-m", "x", CLAUDECODE="", STUB_VERDICT="BLOCK").returncode, 0)


class CommitGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "core.hooksPath", ".githooks"], cwd=self.repo, check=True)

    def tearDown(self):
        self.tmp.cleanup()

    def guard(self, command):
        payload = json.dumps({"tool_input": {"command": command}, "cwd": str(self.repo)})
        return subprocess.run([sys.executable, str(HOOKS / "commit-guard.py")], input=payload,
                              text=True, capture_output=True).returncode

    def test_allows_normal_commands_and_commits(self):
        (self.repo / ".githooks").mkdir()
        (self.repo / ".githooks" / "pre-commit").write_text("#!/bin/sh\n")
        for command in ("ls -la", "git status", 'git commit -m "feat: add -a flag docs"',
                        "git commit -am x", "git add a && git commit -m x"):
            self.assertEqual(self.guard(command), 0, command)

    def test_blocks_skipping_the_review(self):
        (self.repo / ".githooks").mkdir()
        (self.repo / ".githooks" / "pre-commit").write_text("#!/bin/sh\n")
        for command in ("git commit --no-verify -m x", "git commit -n -m x", "git commit -qn -m x",
                        "git -c core.hooksPath=/dev/null commit -m x"):
            self.assertEqual(self.guard(command), 2, command)

    def test_blocks_commits_when_the_hook_file_is_missing(self):
        self.assertEqual(self.guard("git commit -m x"), 2)
        (self.repo / ".githooks").mkdir()
        (self.repo / ".githooks" / "pre-commit").write_text("#!/bin/sh\n")
        self.assertEqual(self.guard("git commit -m x"), 0)

    def test_ignores_text_that_only_mentions_git_or_hooks(self):
        (self.repo / ".githooks").mkdir()
        (self.repo / ".githooks" / "pre-commit").write_text("#!/bin/sh\n")
        for command in ('self.git("commit", "-n")', "echo core.hooksPath", "grep -n commit f"):
            self.assertEqual(self.guard(command), 0, command)

    def test_blocks_changing_the_hooks_path(self):
        self.assertEqual(self.guard("git config --unset core.hooksPath"), 2)
        self.assertEqual(self.guard("git config core.hooksPath .githooks"), 0)

    def test_blocks_commits_until_the_hook_is_enabled(self):
        subprocess.run(["git", "config", "--unset", "core.hooksPath"], cwd=self.repo, check=True)
        self.assertEqual(self.guard("git commit -m x"), 2)


if __name__ == "__main__":
    unittest.main()
