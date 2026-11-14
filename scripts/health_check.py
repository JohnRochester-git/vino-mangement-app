"""Scheduled health check for the live Vino site.

    python3 scripts/health_check.py https://www.vinowine.org
    python3 scripts/health_check.py https://www.vinowine.org --test-alert

Checks the health endpoint, the login page and the API once, records how long
each took, and exits 1 if any failed. If DISCORD_WEBHOOK_URL is set, a failure
also posts an alert to Discord. --test-alert sends a test message and exits.

With --max-backup-age-hours, it also checks when the nightly backup last
succeeded (via the GitHub CLI) and alerts if that's too long ago.

In GitHub Actions it writes a results table to the run's summary page.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

USER_AGENT = "vino-health-check"
SLOW_SECONDS = 3.0


def fetch(url, timeout=20):
    """Returns (status, text, seconds). Connection problems give status 0."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status, text = response.status, response.read().decode(errors="replace")
    except urllib.error.HTTPError as err:
        status, text = err.code, err.read().decode(errors="replace")
    except Exception as err:  # DNS, TLS, timeout
        status, text = 0, str(err)
    return status, text, time.monotonic() - start


def check_site(base):
    """Runs each check, retrying once to avoid alerting on a single blip."""
    checks = [
        ("health", "/health", lambda s, t: s == 200 and t.strip() == "OK"),
        ("login page", "/login", lambda s, t: s == 200 and "<form" in t),
        ("API", "/api/v1/auth/me", lambda s, t: s == 401 and '"not_authenticated"' in t),
    ]
    results = []
    for name, path, ok in checks:
        for attempt in (1, 2):
            status, text, seconds = fetch(base + path)
            passed = ok(status, text)
            if passed or attempt == 2:
                break
            time.sleep(5)
        results.append({"name": name, "path": path, "passed": passed, "status": status, "seconds": round(seconds, 2)})
    return results


def last_backup_age_hours(repo, workflow="backup.yml"):
    """Hours since the backup workflow last succeeded, or None if it never has."""
    output = subprocess.run(
        ["gh", "run", "list", "--repo", repo, "--workflow", workflow, "--status", "success",
         "--limit", "1", "--json", "createdAt"],
        check=True, capture_output=True, text=True,
    ).stdout
    runs = json.loads(output)
    if not runs:
        return None
    finished = datetime.fromisoformat(runs[0]["createdAt"].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - finished).total_seconds() / 3600


def send_discord(webhook, message):
    body = json.dumps({"username": "Vino Alerts", "content": message}).encode()
    request = urllib.request.Request(
        webhook, data=body, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status


def write_summary(base, results, problems):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = [f"## Health check: {base}", "", "| Check | Result | Status | Seconds |", "| --- | --- | --- | --- |"]
    for r in results:
        lines.append(f"| {r['name']} | {'✅' if r['passed'] else '❌'} | {r['status']} | {r['seconds']} |")
    if problems:
        lines += ["", "**Problems:**"] + [f"- {p}" for p in problems]
    with open(path, "a") as f:
        f.write("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="site to check, e.g. https://www.vinowine.org")
    parser.add_argument("--test-alert", action="store_true", help="send a test message to Discord and exit")
    parser.add_argument("--max-backup-age-hours", type=float, help="alert if the last successful backup is older")
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"), help="owner/repo for the backup check")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    webhook = os.environ.get("DISCORD_WEBHOOK_URL")

    if args.test_alert:
        if not webhook:
            sys.exit("DISCORD_WEBHOOK_URL isn't set")
        send_discord(webhook, f"🧪 Test alert from the Vino health check ({base}). Alerts are working.")
        print("Test alert sent.")
        return

    results = check_site(base)
    problems = [f"{r['name']} ({r['path']}) failed: status {r['status']}" for r in results if not r["passed"]]
    slow = [f"{r['name']} took {r['seconds']}s" for r in results if r["passed"] and r["seconds"] > SLOW_SECONDS]

    if args.max_backup_age_hours is not None:
        try:
            age = last_backup_age_hours(args.repo)
            if age is None:
                problems.append("no successful backup run found")
            elif age > args.max_backup_age_hours:
                problems.append(f"last successful backup was {age:.0f} hours ago (limit {args.max_backup_age_hours:.0f})")
        except Exception as err:
            problems.append(f"couldn't check the backup: {err}")

    for r in results:
        print(f"{'PASS' if r['passed'] else 'FAIL'}  {r['name']:<10} status {r['status']:<3}  {r['seconds']}s")
    for p in slow:
        print(f"SLOW  {p}")
    for p in problems:
        print(f"PROBLEM  {p}")
    write_summary(base, results, problems + [f"slow: {p}" for p in slow])

    if problems:
        if webhook:
            run_url = ""
            if os.environ.get("GITHUB_RUN_ID"):
                run_url = f"\n{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
            message = "🚨 **Vino health check failed** for " + base + "\n" + "\n".join(f"• {p}" for p in problems) + run_url
            try:
                send_discord(webhook, message)
                print("Discord alert sent.")
            except Exception as err:
                print(f"Couldn't send the Discord alert: {err}")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
