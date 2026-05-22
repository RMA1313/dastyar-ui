# noqa: INP001
import os
import shutil
import subprocess
import sys
import urllib.request
from sys import stderr

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


def env_true(name: str) -> bool:
    return os.getenv(name, '').strip().lower() == 'true'


def probe_url(url: str, timeout: int = 5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout):
            return True
    except Exception:
        return False


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        super().initialize(version, build_data)
        stderr.write('>>> Building Open Webui frontend\n')
        npm = shutil.which('npm')
        if npm is None:
            raise RuntimeError('NodeJS `npm` is required for building Open Webui but it was not found')
        use_nexus = env_true('USE_NEXUS')
        nexus_base_url = os.getenv('NEXUS_BASE_URL', 'http://host.docker.internal:8081/repository').rstrip('/')
        npm_registry = os.getenv('NPM_CONFIG_REGISTRY', '')
        if use_nexus and not npm_registry:
            candidate = f'{nexus_base_url}/npm-proxy/'
            if probe_url(candidate):
                npm_registry = candidate
        install_cmd = [npm, 'ci', '--force']
        if npm_registry:
            install_cmd.extend(['--registry', npm_registry])
        stderr.write('### npm ci\n')
        subprocess.run(install_cmd, check=True)  # noqa: S603
        stderr.write('\n### npm run build\n')
        os.environ['APP_BUILD_HASH'] = version
        subprocess.run([npm, 'run', 'build'], check=True)  # noqa: S603
