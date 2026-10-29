import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

cmd = subprocess.run(["docker", "compose", "down"], cwd=REPO_ROOT)

if cmd.returncode == 0:
    print("Application has stopped.")
    sys.exit(0)
else:
    print("Application failed to stop.")
    print(cmd.returncode)
    sys.exit(cmd.returncode)