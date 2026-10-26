"""Read-only Compose contract checks; no daemon or database connection needed."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def configuration(**overrides):
    environment = {
        **os.environ,
        "AVERO_DB_PASSWORD": "non-secret-config-test-value",
        "AVERO_AUTH_JWT_SECRET": "non-secret-config-test-value-with-32-bytes",
        "AVERO_HTTP_PORT": "8080",
        **overrides,
    }
    return subprocess.run(
        ["docker", "compose", "--env-file", ".env.compose.example", "config", "--format", "json"],
        cwd=ROOT, env=environment, capture_output=True, text=True, check=False,
    )


class ComposeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = configuration()
        if result.returncode:
            raise AssertionError("Compose config validation failed")
        cls.config = json.loads(result.stdout)
        cls.services = cls.config["services"]

    def test_isolated_project_database_and_volume(self):
        self.assertEqual(self.config["name"], "avero-local")
        database = self.services["postgres"]
        self.assertEqual(database["environment"]["POSTGRES_DB"], "avero_compose")
        self.assertEqual(database["volumes"][0]["source"], "postgres_phase8_data")
        volume = self.config["volumes"]["postgres_phase8_data"]
        self.assertEqual(volume["name"], "avero-local_postgres_phase8_data")
        self.assertFalse(volume.get("external", False))

    def test_only_frontend_publishes_loopback_port(self):
        for name, service in self.services.items():
            if name != "frontend":
                self.assertFalse(service.get("ports"), name)
        ports = self.services["frontend"]["ports"]
        self.assertEqual(len(ports), 1)
        self.assertEqual(ports[0]["host_ip"], "127.0.0.1")
        self.assertEqual(ports[0]["published"], "8080")
        self.assertEqual(ports[0]["target"], 80)

    def test_health_and_migration_gates(self):
        self.assertEqual(self.services["migrate"]["depends_on"]["postgres"]["condition"], "service_healthy")
        self.assertEqual(self.services["backend"]["depends_on"]["migrate"]["condition"], "service_completed_successfully")
        self.assertEqual(self.services["frontend"]["depends_on"]["backend"]["condition"], "service_healthy")
        for name in ("postgres", "backend", "frontend"):
            self.assertIn("healthcheck", self.services[name])

    def test_api_and_browser_origin_match(self):
        api = self.services["frontend"]["build"]["args"]["VITE_API_BASE_URL"]
        origins = json.loads(self.services["backend"]["environment"]["CORS_ALLOWED_ORIGINS"])
        self.assertEqual(api, origins[0] + "/api/v1")
        self.assertEqual(self.services["backend"]["environment"]["APP_ENV"], "development")

    def test_custom_port_updates_all_origins(self):
        result = configuration(AVERO_HTTP_PORT="18080")
        self.assertEqual(result.returncode, 0)
        services = json.loads(result.stdout)["services"]
        self.assertEqual(services["frontend"]["ports"][0]["published"], "18080")
        self.assertEqual(services["frontend"]["build"]["args"]["VITE_API_BASE_URL"], "http://127.0.0.1:18080/api/v1")
        self.assertEqual(json.loads(services["backend"]["environment"]["CORS_ALLOWED_ORIGINS"]), ["http://127.0.0.1:18080"])

    def test_missing_secrets_fail_closed(self):
        for name in ("AVERO_DB_PASSWORD", "AVERO_AUTH_JWT_SECRET"):
            self.assertNotEqual(configuration(**{name: ""}).returncode, 0)

    def test_no_host_environment_or_database_mounts(self):
        for name, service in self.services.items():
            self.assertNotIn("env_file", service, name)
            for volume in service.get("volumes", []):
                self.assertEqual(volume["type"], "volume", name)
        self.assertEqual(self.services["backend"]["environment"], self.services["migrate"]["environment"])
        self.assertTrue(self.services["backend"]["environment"]["DATABASE_URL"].endswith("@postgres:5432/avero_compose"))

    def test_secret_generation_is_private_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docker").mkdir()
            script = root / "docker" / "init-env.py"
            script.write_text((ROOT / "docker" / "init-env.py").read_text())
            generated = subprocess.run([sys.executable, str(script)], capture_output=True)
            self.assertEqual(generated.returncode, 0)
            target = root / ".env.compose.local"
            content = target.read_bytes()
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            repeated = subprocess.run([sys.executable, str(script)], capture_output=True)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertEqual(target.read_bytes(), content)
            for line in content.splitlines()[:2]:
                value = line.split(b"=", 1)[1]
                self.assertGreaterEqual(len(value), 32)
                self.assertNotIn(value, generated.stdout + generated.stderr + repeated.stdout + repeated.stderr)


if __name__ == "__main__":
    unittest.main()
