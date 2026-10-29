import subprocess
import sys
from pathlib import Path
import urllib.request

REPO_ROOT = Path(__file__).resolve().parent.parent
url = "http://localhost:8000/health"

start = subprocess.run(["docker", "compose", "up", "--build", "-d", "--wait"], cwd=REPO_ROOT)

if start.returncode == 0:
    print("Application is up at http://localhost:8000/health")
    passed = False
    try:
        response = urllib.request.urlopen(url)
        code = response.status
        body = response.read().decode()

        if code == 200 and body == "OK":
            print("Passed health check.")
            passed = True
        else:
            print(f"Unexpected response: {code} {body}")

    except Exception as e:
        print("Failed health check.")
        print(e)

    finally:
        subprocess.run(["docker", "compose", "down"], cwd=REPO_ROOT)

    if passed is True:
        print("PASS")
        sys.exit(0)
    else:
        print("FAIL")
        sys.exit(1)

else:
    subprocess.run(["docker", "compose", "down"], cwd=REPO_ROOT)
    print("Application startup failed")
    print(start.returncode)
    sys.exit(start.returncode)