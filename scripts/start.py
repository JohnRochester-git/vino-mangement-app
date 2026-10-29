import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

cmd = subprocess.run(["docker", "compose", "up", "--build", "-d", "--wait"], cwd=REPO_ROOT)

if cmd.returncode == 0:
    print("Application is up at http://localhost:8000/health")
    sys.exit(0)
else:
    print("Application startup failed")
    print(cmd.returncode)
    sys.exit(cmd.returncode)