"""Smoke test for a deployed Vino site.

    python3 scripts/smoke_test.py https://vino.noahvastola.workers.dev
    python3 scripts/smoke_test.py https://vino.noahvastola.workers.dev --version <worker-version-id>

Checks that the pages load, the backend answers and it can reach the database.
With --version, also checks that the health check and API answers come from
that Worker version (the X-Vino-Version header the Worker adds). Pages are
served by Cloudflare without running the Worker, so they don't carry it.


A new deploy can take a few minutes while the container starts, so it retries
until every check passes or --timeout seconds have gone by.
Exits 0 when everything passes, 1 otherwise.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

USER_AGENT = "vino-smoke-test"


def fetch(url, method="GET", body=None):
    """Returns (status, headers, text). HTTP errors like 401 are answers, not failures."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("User-Agent", USER_AGENT)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.headers, response.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.headers, err.read().decode()


def error_code(text):
    """The API's error code, from {"error": {"code": ...}}, or None."""
    try:
        return json.loads(text)["error"]["code"]
    except (ValueError, KeyError, TypeError):
        return None


def run_checks(base, version):
    """Runs every check once. Returns a list of (name, passed, detail)."""
    results = []

    def check(name, passed, detail, headers, versioned=True):
        if version and versioned and passed:
            answered_by = headers.get("X-Vino-Version")
            if answered_by != version:
                passed = False
                detail = f"answered by version {answered_by}, expected {version}"
        results.append((name, passed, detail))

    status, headers, text = fetch(base + "/health")
    check("health check", status == 200 and text.strip() == "OK", f"{status} {text.strip()[:40]}", headers)

    status, headers, text = fetch(base + "/login")
    check("login page", status == 200 and "<form" in text, f"{status}", headers, versioned=False)

    status, headers, text = fetch(base + "/api/v1/auth/me")
    code = error_code(text)
    check("API reachable", status == 401 and code == "not_authenticated", f"{status} {code}", headers)

    # A made-up account: the backend has to look it up in D1 to say "no match".
    # After 5 failed logins it says "too many attempts" instead, which also
    # comes from a D1 query, so either answer proves the database is reachable.
    status, headers, text = fetch(
        base + "/api/v1/auth/login",
        method="POST",
        body={"userEmail": "smoke-test@example.invalid", "password": "not-a-real-password"},
    )
    code = error_code(text)

    reached_db = (status, code) in [(401, "invalid_credentials"), (429, "too_many_attempts")]
    check("database reachable", reached_db, f"{status} {code}", headers)

    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="site to test, e.g. https://vino.noahvastola.workers.dev")
    parser.add_argument("--version", help="Worker version ID the answers must come from")
    parser.add_argument("--timeout", type=int, default=300, help="seconds to keep retrying (default 300)")
    parser.add_argument("--interval", type=int, default=15, help="seconds between attempts (default 15)")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    deadline = time.monotonic() + args.timeout
    attempt = 0
    while True:
        attempt += 1
        try:
            results = run_checks(base, args.version)
        except Exception as err:  # network errors, timeouts: try again
            results = [("site reachable", False, str(err))]

        failed = [r for r in results if not r[1]]
        if not failed or time.monotonic() >= deadline:
            break
        print(f"Attempt {attempt}: {len(failed)} check(s) failing, retrying in {args.interval}s")
        time.sleep(args.interval)

    for name, passed, detail in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}  ({detail})")
    if failed:
        print(f"SMOKE TEST FAILED after {attempt} attempt(s)")
        sys.exit(1)
    print(f"SMOKE TEST PASSED on attempt {attempt}")


if __name__ == "__main__":
    main()
