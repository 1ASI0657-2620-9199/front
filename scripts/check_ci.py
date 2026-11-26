"""Reproducible browser checks with a temporary local API suite."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import httpx

FRONT = Path(__file__).resolve().parents[1]
BACK = FRONT.parent / "back"


def main(channel: str):
    if not (BACK / "app/suite.py").is_file():
        raise SystemExit("Use a sibling back checkout that includes app/suite.py.")
    reports = FRONT / "reports"
    reports.mkdir(exist_ok=True)
    environment = dict(os.environ)
    for variable in ("DATABASE_URL", "BUDGET_DATABASE_URL", "NOTIFICATION_DATABASE_URL", "TELEMETRY_DATABASE_URL"):
        environment.pop(variable, None)
    # Choose a free loopback port without relying on socket inheritance on Windows.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", int(os.getenv("FINANZEN_TEST_PORT", "0"))))
        port = probe.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="finanzen-browser-") as data, (reports / "server.log").open("w", encoding="utf-8") as log:
        environment["FINANZEN_DATA_DIR"] = data
        environment["FINANZEN_FRONTEND_PATH"] = str(FRONT)
        process = subprocess.Popen(
            [sys.executable, "scripts/run_local.py", "--port", str(port)], cwd=BACK, env=environment,
            stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(timeout=1) as client:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError("API startup failed; see reports/server.log.")
                    try:
                        if client.get(url + "/health").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.15)
                else:
                    raise RuntimeError("API readiness timed out.")
            subprocess.run([sys.executable, str(FRONT / "scripts/test_browser.py"),
                            "--base-url", url, "--channel", channel], check=True, cwd=FRONT)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default="chrome")
    args = parser.parse_args()
    main(args.channel)
