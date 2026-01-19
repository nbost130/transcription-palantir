#!/usr/bin/env python3
"""Refresh docs/github-issues.md with the latest GitHub issue snapshot."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import sys
import urllib.request

DEFAULT_REPO = "nbost130/transcription-palantir"
DEFAULT_OUTPUT = Path("docs/github-issues.md")

def fetch_issues(repo: str) -> list[dict]:
    url = f"https://api.github.com/repos/{repo}/issues?state=all&per_page=100"
    with urllib.request.urlopen(url, timeout=15) as resp:  # noqa: S310
        return json.load(resp)

def summarize(text: str, limit: int = 140) -> str:
    summary = " ".join((text or "").strip().split())
    if not summary:
        return "No description"
    return summary if len(summary) <= limit else summary[: limit - 3] + "..."

def build_table(issues: list[dict], *, open_only: bool) -> list[str]:
    rows: list[str] = []
    if open_only:
        if not issues:
            rows.append("- None\n")
            return rows
        rows.append("| # | Title | Labels | Created | Notes |")
        rows.append("| --- | --- | --- | --- | --- |")
        for issue in issues:
            labels = ", ".join(label["name"] for label in issue.get("labels", [])) or "—"
            created = issue["created_at"][:10]
            rows.append(
                f"| {issue['number']} | {issue['title']} | {labels} | {created} | {summarize(issue.get('body', ''))} |"
            )
        rows.append("")
    else:
        rows.append("| # | Title | Closed | Notes |")
        rows.append("| --- | --- | --- | --- |")
        for issue in issues:
            closed = (issue.get("closed_at") or "")[:10] or "—"
            rows.append(
                f"| {issue['number']} | {issue['title']} | {closed} | {summarize(issue.get('body', ''))} |"
            )
    return rows

def generate(repo: str, output: Path) -> None:
    issues = fetch_issues(repo)
    open_issues = [issue for issue in issues if issue["state"] == "open"]
    closed_issues = [issue for issue in issues if issue["state"] == "closed"]
    lines: list[str] = ["# GitHub Issues Snapshot", ""]
    refresh_cmd = (
        "python3 scripts/update_github_issues_snapshot.py"
        if repo == DEFAULT_REPO and output == DEFAULT_OUTPUT
        else f"python3 scripts/update_github_issues_snapshot.py --repo {repo} --output {output}"
    )
    lines.append(
        "**Refresh this snapshot** whenever you start a planning workflow or notice major GitHub issue churn.\n"
        "Run:\n\n"
        f"```bash\n{refresh_cmd}\n```\n"
    )
    lines.append(f"*Generated:* {dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}\n")
    lines.append("## Open Issues")
    lines.extend(build_table(open_issues, open_only=True))
    lines.append("## Recently Closed Issues")
    closed_sorted = sorted(closed_issues, key=lambda issue: issue.get("closed_at") or "", reverse=True)[:5]
    lines.extend(build_table(closed_sorted, open_only=False))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repo in owner/name form")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to markdown file to write")
    args = parser.parse_args()
    generate(args.repo, Path(args.output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - CLI convenience
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
