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
        self.git("config", "core.hooksPath", str(self.repo / ".githooks"))
        # The root commit predates the review: worktrees of it stand for older branches.
        self.git("commit", "-q", "--allow-empty", "-m", "root")
        agents = self.repo / ".claude" / "agents"
        agents.mkdir()
        (agents / "security-reviewer.md").write_text("reviewer\n")
        self.git("add", ".claude/agents")
        self.git("commit", "-q", "-m", "reviewer", CLAUDECODE="")

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
        self.assertEqual(self.git("rev-list", "--count", "HEAD").stdout.strip(), "2")

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
        self.assertIn("review of the staged diff", result.stderr)

    def test_worktree_on_a_branch_older_than_the_review_fails_closed(self):
        worktree = Path(self.tmp.name) / "old"
        self.git("worktree", "add", "-q", "--detach", str(worktree), "HEAD~1")
        self.write("b.txt", cwd=worktree)
        self.git("add", "b.txt", cwd=worktree)
        result = self.git("commit", "-m", "x", cwd=worktree)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("older than the review", result.stderr)

    def test_merge_commits_are_reviewed(self):
        self.git("checkout", "-q", "-b", "topic")
        self.write("c.txt")
        self.git("add", "c.txt")
        self.git("commit", "-q", "-m", "topic", CLAUDECODE="")
        self.git("checkout", "-q", "-")
        result = self.git("merge", "--no-ff", "-m", "merge", "topic", STUB_VERDICT="BLOCK")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("review of the staged diff", result.stderr)

    def test_oversized_diff_missing_cli_and_timeout_abort(self):
        self.write(text="x" * 310_000)
        self.git("add", "a.txt")
        self.assertIn("over", self.git("commit", "-m", "x").stderr)
        self.write(text="small\n")
        self.git("add", "a.txt")
        self.assertNotEqual(self.git("commit", "-m", "x", CLAUDE_BIN="/nonexistent").returncode, 0)
        Path(self.env["CLAUDE_BIN"]).write_text("#!/bin/sh\nsleep 5\n")
        result = self.git("commit", "-m", "x", SYNAPSE_REVIEW_TIMEOUT="1")
        self.assertIn("timed out", result.stderr)
        result = self.git("commit", "-m", "x", SYNAPSE_REVIEW_TIMEOUT="soon")
        self.assertIn("number of seconds", result.stderr)

    def test_human_commits_are_not_reviewed(self):
        self.write()
        self.git("add", "a.txt")
        self.assertEqual(self.git("commit", "-m", "x", CLAUDECODE="", STUB_VERDICT="BLOCK").returncode, 0)


class CommitGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.hooks = self.repo / ".githooks"
        self.hooks.mkdir()
        for name in ("pre-commit", "pre-merge-commit"):
            (self.hooks / name).write_text("#!/bin/sh\n")
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        self.set_hooks_path(str(self.hooks))
        self.fake = Path(self.tmp.name) / "elsewhere" / ".githooks"

    def tearDown(self):
        self.tmp.cleanup()

    def set_hooks_path(self, value):
        subprocess.run(["git", "config", "core.hooksPath", value], cwd=self.repo, check=True)

    def guard(self, command):
        payload = json.dumps({"tool_input": {"command": command}, "cwd": str(self.repo)})
        return subprocess.run([sys.executable, str(HOOKS / "commit-guard.py")], input=payload,
                              text=True, capture_output=True).returncode

    def test_allows_normal_commands_and_commits(self):
        for command in ("ls -la", "git status", 'git commit -m "feat: add -a flag docs"',
                        "git commit -am x", "git add a && git commit -m x", "git merge topic",
                        'git commit -m "handle -n flag"', "git commit -uno -m x",
                        "git config --get core.hooksPath", "git merge -n topic",
                        'git commit -m "document core.hooksPath"',
                        "git grep -n core.hooksPath", "git log -S core.hooksPath",
                        "bash -c 'git status'", 'git commit -m "doc: explain git commit -n"',
                        'git commit -m "fix: don\'t break git status"',
                        'git config core.hooksPath "$PWD/.githooks"',
                        "git commit -q -F - <<'EOF'\nfix: handle -n and --no-verify text\nEOF",
                        "echo $((1<<2))\ngit status\n2\nls"):
            self.assertEqual(self.guard(command), 0, command)

    def test_blocks_skipping_the_review(self):
        for command in ("git commit --no-verify -m x", "git commit --no-veri -m x",
                        "git commit -n -m x", "git commit -qn -m x", "git merge --no-verify topic",
                        "git -c core.hooksPath=/dev/null commit -m x",
                        'git commit "--no-verify" -m x', "git commit -m x '-n'",
                        'git -c "core.hooksPath=/dev/null" commit -m x', "git pull --no-verify",
                        "bash <<'EOF'\ngit commit --no-verify -m wip\nEOF",
                        "git commit -u -n -m x", "git commit -S -n -m x",
                        "git --config-env core.hooksPath=V commit -m x",
                        "git --config-env=core.hooksPath=V commit -m x",
                        "git --git-dir .git commit -n -m x",
                        "bash -c 'cd sub && git commit -n -m x'",
                        "sh -c 'git -c core.hooksPath=/dev/null commit -m x'",
                        "cat > x.md <<'EOF'\nl'agent\nEOF\ngit commit -n -m x",
                        "(git status);git commit -n -m x", "git add .&&(git commit -n -m x)",
                        "eval 'git commit -n -m x'", "/bin/bash -lc 'git commit -n -m x'"):
            self.assertEqual(self.guard(command), 2, command)

    def test_ignores_text_that_only_mentions_git_or_hooks(self):
        for command in ('self.git("commit", "-n")', "echo core.hooksPath", "grep -n commit f"):
            self.assertEqual(self.guard(command), 0, command)

    def test_blocks_changing_the_hooks_path(self):
        for command in ("git config --unset core.hooksPath", "git config core.hooksPath /tmp/x",
                        "git config core.hooksPath .githooks", "git config unset core.hooksPath"):
            self.assertEqual(self.guard(command), 2, command)

    def test_blocks_commits_until_an_absolute_complete_hooks_path_is_set(self):
        self.set_hooks_path(".githooks")
        self.assertEqual(self.guard("git commit -m x"), 2, "relative paths break older worktrees")
        self.set_hooks_path(str(self.hooks))
        self.fake.mkdir(parents=True)
        for name in ("pre-commit", "pre-merge-commit"):
            (self.fake / name).write_text("#!/bin/sh\n")
        self.set_hooks_path(str(self.fake))
        self.assertEqual(self.guard("git commit -m x"), 2, "only this repository's hooks count")
        self.set_hooks_path(str(self.hooks))
        (self.hooks / "pre-merge-commit").unlink()
        self.assertEqual(self.guard("git commit -m x"), 2)
        (self.hooks / "pre-merge-commit").write_text("#!/bin/sh\n")
        (self.hooks / "pre-commit").unlink()
        self.assertEqual(self.guard("git commit -m x"), 2)
        subprocess.run(["git", "config", "--unset", "core.hooksPath"], cwd=self.repo, check=True)
        self.assertEqual(self.guard("git commit -m x"), 2)
        self.assertEqual(self.guard("(git status);git commit -m x"), 2)


if __name__ == "__main__":
    unittest.main()
