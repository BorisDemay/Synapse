import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'infra/scripts/check-deployment-layout.py'


def compatible_compose():
    return {
        'name': 'synapse',
        'services': {
            'postgres': {
                'image': 'postgres:17-alpine',
                'volumes': ['postgres_data:/var/lib/postgresql/data'],
            },
            'server': {
                'image': 'synapse-server:old',
                'volumes': ['blob_data:/var/lib/synapse/blobs'],
            },
        },
        'volumes': {'postgres_data': {}, 'blob_data': {}},
    }


class DeploymentLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)

    def write_compose(self, name, compose):
        path = self.path / name
        path.write_text(json.dumps(compose))
        return path

    def run_checker(self, *args):
        return subprocess.run(
            ['python3', str(CHECKER), *map(str, args)],
            capture_output=True,
            text=True,
        )

    def write_docker_renderer(self):
        docker = self.path / 'docker'
        docker.write_text(
            '#!/usr/bin/env bash\n'
            'printf "%s\\n" "$*" >> "$DOCKER_LOG"\n'
            '[[ "$1" == compose && "$2" == --env-file && "$4" == -f && "$6" == config && "$7" == --format && "$8" == json ]] || exit 71\n'
            'if [[ "$5" == "$CURRENT_COMPOSE" ]]; then\n'
            '  printf "%s" "$CURRENT_RENDER"\n'
            'else\n'
            '  printf "%s" "$CANDIDATE_RENDER"\n'
            'fi\n'
        )
        docker.chmod(0o755)

    def run_rendered_checker(self, env_file, current, candidate, current_render, candidate_render):
        log = self.path / 'docker.log'
        self.write_docker_renderer()
        return subprocess.run(
            ['python3', str(CHECKER), str(env_file), str(current), str(candidate)],
            capture_output=True,
            text=True,
            env=dict(
                os.environ,
                CANDIDATE_COMPOSE=str(candidate),
                CANDIDATE_RENDER=json.dumps(candidate_render),
                CURRENT_COMPOSE=str(current),
                CURRENT_RENDER=json.dumps(current_render),
                DOCKER_LOG=str(log),
                PATH=f'{self.path}:{os.environ["PATH"]}',
            ),
        )

    def test_renders_both_compose_files_with_deployment_environment_before_accepting_server_image_update(self):
        env_file = self.path / '.env'
        env_file.write_text('POSTGRES_PASSWORD=do-not-display-this-value\n')
        current = self.write_compose('current.yml', compatible_compose())
        candidate = compatible_compose()
        candidate['services']['server']['image'] = 'synapse-server:new'
        next_compose = self.write_compose('next.yml', candidate)

        result = self.run_rendered_checker(
            env_file, current, next_compose, compatible_compose(), candidate
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            (self.path / 'docker.log').read_text().splitlines(),
            [
                f'compose --env-file {env_file} -f {current} config --format json',
                f'compose --env-file {env_file} -f {next_compose} config --format json',
            ],
        )

    def test_rejects_missing_or_unexpected_cli_arguments_without_echoing_them(self):
        secret = 'do-not-display-this-value'
        for args in ((), (secret,), (secret, secret), (secret, secret, secret, secret)):
            with self.subTest(args=len(args)):
                result = self.run_checker(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(secret, result.stdout + result.stderr)

    def test_rejects_invalid_compose_without_echoing_configuration(self):
        env_file = self.path / '.env'
        env_file.write_text('POSTGRES_PASSWORD=do-not-display-this-value\n')
        current = self.write_compose('current.yml', compatible_compose())
        invalid = self.path / 'invalid.yml'
        invalid.write_text('services: [not a mapping]\n')

        result = self.run_rendered_checker(
            env_file,
            current,
            invalid,
            compatible_compose(),
            {'services': ['not a mapping'], 'secret': 'do-not-display-this-value'},
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('do-not-display-this-value', result.stdout + result.stderr)

    def test_rejects_required_server_image_missing(self):
        env_file = self.path / '.env'
        env_file.write_text('POSTGRES_PASSWORD=test\n')
        current = self.write_compose('current.yml', compatible_compose())
        candidate = compatible_compose()
        candidate['services']['server'].pop('image')

        next_compose = self.write_compose('missing-server-image.yml', candidate)
        result = self.run_rendered_checker(
            env_file, current, next_compose, compatible_compose(), candidate
        )

        self.assertNotEqual(result.returncode, 0)

    def test_rejects_postgres_image_or_storage_layout_change(self):
        env_file = self.path / '.env'
        env_file.write_text('POSTGRES_PASSWORD=test\n')
        current = self.write_compose('current.yml', compatible_compose())
        for name, change in (
            ('postgres-image.yml', lambda compose: compose['services']['postgres'].update(image='postgres:18-alpine')),
            ('postgres-mount.yml', lambda compose: compose['services']['postgres'].update(volumes=['other:/var/lib/postgresql/data'])),
            ('server-mount.yml', lambda compose: compose['services']['server'].update(volumes=['other:/var/lib/synapse/blobs'])),
            ('project.yml', lambda compose: compose.update(name='other')),
            ('volume-definition.yml', lambda compose: compose.update(volumes={'postgres_data': {'driver': 'local'}, 'blob_data': {}})),
        ):
            with self.subTest(name=name):
                candidate = compatible_compose()
                change(candidate)
                next_compose = self.write_compose(name, candidate)
                result = self.run_rendered_checker(
                    env_file, current, next_compose, compatible_compose(), candidate
                )
                self.assertNotEqual(result.returncode, 0)

    def test_deploy_refuses_invalid_candidate_before_docker_load(self):
        deploy_root = self.path / 'deploy'
        stage = deploy_root / 'staging' / ('0.1.1-' + 'a' * 40)
        stage.mkdir(parents=True)
        (deploy_root / 'infra/scripts').mkdir(parents=True)
        (deploy_root / 'infra/scripts/check-deployment-layout.py').write_text(CHECKER.read_text())
        (deploy_root / '.env').write_text('POSTGRES_PASSWORD=do-not-display-this-value\n')
        release_marker = b'release archive verified'
        (stage / 'release-marker').write_bytes(release_marker)
        (stage / 'SHA256SUMS').write_text(
            f'{hashlib.sha256(release_marker).hexdigest()}  release-marker\n'
        )
        (stage / 'validate-release.mjs').write_text('')
        (deploy_root / 'docker-compose.yml').write_text(json.dumps(compatible_compose()))
        (stage / 'docker-compose.yml').write_text('services: [invalid]\n')
        log = self.path / 'docker.log'
        docker = self.path / 'docker'
        docker.write_text(
            '#!/usr/bin/env bash\n'
            'printf "%s\\n" "$*" >> "$DOCKER_LOG"\n'
            'if [[ "$1" == compose ]]; then printf "%s" "{\\"services\\": [\\"invalid\\"]}"; fi\n'
        )
        docker.chmod(0o755)
        node = self.path / 'node'
        node.write_text('#!/usr/bin/env bash\nexit 0\n')
        node.chmod(0o755)

        result = subprocess.run(
            ['bash', str(ROOT / 'infra/scripts/deploy-release.sh'), '0.1.1', 'a' * 40],
            env=dict(os.environ, SYNAPSE_DEPLOY_ROOT=str(deploy_root), DOCKER_LOG=str(log), PATH=f'{self.path}:{os.environ["PATH"]}'),
            capture_output=True,
            text=True,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            log.read_text().splitlines(),
            [
                'compose --env-file '
                f'{deploy_root}/.env -f {deploy_root}/docker-compose.yml config --format json'
            ],
            result.stderr,
        )
        self.assertNotIn('load', log.read_text(), result.stderr)

    def test_provision_installs_layout_checker(self):
        commands = self.path / 'commands.log'
        for command, body in {
            'id': 'exit 0',
            'getent': 'printf "synapse-deploy:x:1:1::%s:/usr/sbin/nologin\\n" "$TEST_HOME"',
            'install': 'printf "install %s\\n" "$*" >> "$TEST_LOG"',
            'useradd': 'exit 0',
            'chown': 'exit 0',
            'chmod': 'exit 0',
            'visudo': 'exit 0',
        }.items():
            path = self.path / command
            path.write_text(f'#!/usr/bin/env bash\n{body}\n')
            path.chmod(0o755)
        home = self.path / 'home'
        home.mkdir()
        (home / '.ssh').mkdir()
        deploy_root = self.path / 'deploy'

        result = subprocess.run(
            ['bash', str(ROOT / 'infra/scripts/provision-deploy-account.sh')],
            cwd=ROOT,
            env=dict(
                os.environ,
                SYNAPSE_DEPLOY_PUBLIC_KEY='ssh-ed25519 test public-key',
                SYNAPSE_DEPLOY_ROOT=str(deploy_root),
                TEST_LOG=str(commands),
                TEST_HOME=str(home),
                PATH=f'{self.path}:{os.environ["PATH"]}',
            ),
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            f'infra/scripts/check-deployment-layout.py {deploy_root}/infra/scripts/check-deployment-layout.py',
            commands.read_text(),
        )


if __name__ == '__main__':
    unittest.main()
