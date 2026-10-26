"""Summarize advisory JSON; fail on high/critical npm or any Python finding.

pip-audit does not provide severity in its JSON schema. Such findings are shown
as unrated and block conservatively; no severity or remediation is invented.
Audit service/format errors fail closed instead of appearing as clean scans.
"""

import argparse
import json
import os
from pathlib import Path


def cell(value):
    return str(value).replace("\r", " ").replace("\n", " ").replace("|", "\\|")


def summarize(npm, python):
    if not isinstance(npm, dict) or npm.get("error") or not isinstance(npm.get("vulnerabilities"), dict):
        raise ValueError("npm audit did not return a valid vulnerability report; check registry connectivity")
    if not isinstance(python, dict) or not isinstance(python.get("dependencies"), list):
        raise ValueError("pip-audit did not return a valid dependency report; check advisory connectivity")
    lines = ["## Dependency security", "", "### npm (package-lock.json)", "",
             "| Package | Severity | Affected range | Remediation available |",
             "| --- | --- | --- | --- |"]
    blocked = False
    for name, finding in sorted(npm["vulnerabilities"].items()):
        severity = finding["severity"]
        if severity not in {"info", "low", "moderate", "high", "critical"}:
            raise ValueError("npm audit returned an unknown severity")
        blocked |= severity in {"high", "critical"}
        available = finding.get("fixAvailable")
        if isinstance(available, dict):
            fix = f"{available['name']}@{available['version']} (review separately)"
        else:
            fix = "yes (review separately)" if available else "not reported"
        lines.append("| " + " | ".join(map(cell, [name, severity, finding["range"], fix])) + " |")
    if not npm["vulnerabilities"]:
        lines.append("| No findings | — | — | — |")
    lines += ["", "### Python (resolved backend and test dependencies)", "",
              "| Package | Installed version | Severity | Advisory | Fixed versions |",
              "| --- | --- | --- | --- | --- |"]
    count = 0
    for dependency in python["dependencies"]:
        if "skip_reason" in dependency or "vulns" not in dependency:
            raise ValueError("pip-audit skipped a dependency; inspect the resolved requirements")
        for vulnerability in dependency["vulns"]:
            count += 1
            fixes = ", ".join(vulnerability.get("fix_versions", [])) or "not reported"
            lines.append("| " + " | ".join(map(cell, [dependency["name"], dependency["version"],
                         "unrated (scanner supplies no severity)", vulnerability["id"], fixes])) + " |")
    blocked |= count > 0
    if not count:
        lines.append("| No findings | — | — | — | — |")
    lines += ["", "Policy: high/critical npm findings and every Python finding block CI. "
              "Unrated is not a claim of low severity. Moderate/low npm findings remain visible. "
              "No dependencies are upgraded automatically.", ""]
    return "\n".join(lines), blocked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--npm", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    args = parser.parse_args()
    try:
        summary, blocked = summarize(json.loads(args.npm.read_text()), json.loads(args.python.read_text()))
    except (OSError, ValueError, KeyError, TypeError):
        print("::error::Dependency review is incomplete: invalid, skipped or unavailable audit data. "
              "Check the audit steps and advisory services, then rerun.")
        return 2
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as file:
            file.write(summary)
    if blocked:
        print("::error::Dependency security gate failed. Review affected packages and fixed versions "
              "in the job summary; remediate in a separately reviewed dependency change.")
    return int(blocked)


if __name__ == "__main__":
    raise SystemExit(main())
