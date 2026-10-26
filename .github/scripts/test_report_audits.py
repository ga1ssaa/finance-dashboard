from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from report_audits import main, summarize


class AuditReportTests(unittest.TestCase):
    def test_clean_reports_pass(self):
        summary, blocked = summarize({"vulnerabilities": {}}, {"dependencies": []})
        self.assertFalse(blocked)
        self.assertIn("No findings", summary)

    def test_npm_severity_gate_keeps_lower_severity_visible(self):
        for severity in ("info", "low", "moderate", "high", "critical"):
            with self.subTest(severity=severity):
                summary, blocked = summarize({"vulnerabilities": {"fixture": {
                    "severity": severity, "range": "<2", "fixAvailable": True,
                }}}, {"dependencies": []})
                self.assertEqual(blocked, severity in {"high", "critical"})
                self.assertIn(f"fixture | {severity}", summary)

    def test_unrated_python_findings_block_and_include_fix(self):
        summary, blocked = summarize({"vulnerabilities": {}}, {"dependencies": [{
            "name": "fixture", "version": "1", "vulns": [{"id": "CVE-fixture", "fix_versions": ["2"]}],
        }]})
        self.assertTrue(blocked)
        self.assertIn("unrated", summary)
        self.assertIn("CVE-fixture | 2", summary)

    def test_service_errors_and_missing_reports_fail_closed(self):
        for npm, python in [({}, {"dependencies": []}),
                            ({"error": {"code": "NETWORK"}, "vulnerabilities": {}}, {"dependencies": []}),
                            ({"vulnerabilities": {}}, {})]:
            with self.assertRaises(ValueError):
                summarize(npm, python)

    def test_skipped_python_dependencies_fail_closed(self):
        with self.assertRaises(ValueError):
            summarize({"vulnerabilities": {}}, {"dependencies": [{"name": "fixture", "skip_reason": "unknown"}]})

    def test_unknown_severity_fails_closed(self):
        with self.assertRaises(ValueError):
            summarize({"vulnerabilities": {"fixture": {"severity": "unknown", "range": "*"}}}, {"dependencies": []})

    def test_available_fix_version_is_reported(self):
        summary, _ = summarize({"vulnerabilities": {"fixture": {
            "severity": "high", "range": "<2", "fixAvailable": {"name": "fixture", "version": "2"},
        }}}, {"dependencies": []})
        self.assertIn("fixture@2", summary)

    def test_command_exit_codes_and_job_summary(self):
        for severity, code in ((None, 0), ("high", 1)):
            with self.subTest(severity=severity), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                npm = {"vulnerabilities": {}}
                if severity:
                    npm["vulnerabilities"]["fixture"] = {"severity": severity, "range": "<2"}
                (root / "npm.json").write_text(json.dumps(npm))
                (root / "python.json").write_text(json.dumps({"dependencies": []}))
                argv = ["report", "--npm", str(root / "npm.json"), "--python", str(root / "python.json")]
                with patch("sys.argv", argv), patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(root / "summary")}), redirect_stdout(io.StringIO()):
                    self.assertEqual(main(), code)
                self.assertIn("Dependency security", (root / "summary").read_text())

    def test_malformed_json_returns_error_instead_of_clean_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            path.write_text("incomplete advisory response")
            with patch("sys.argv", ["report", "--npm", str(path), "--python", str(path)]), redirect_stdout(io.StringIO()):
                self.assertEqual(main(), 2)


if __name__ == "__main__":
    unittest.main()
