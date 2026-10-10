"""Check front against an independent sibling back repository."""

import gc
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch


FRONT = Path(__file__).resolve().parents[1]
BACK = FRONT.parent / "back"


def main() -> None:
    if not (BACK / "app/main.py").is_file():
        raise SystemExit("Clone the back repository beside front before running this check.")
    sys.path.insert(0, str(BACK))
    from fastapi.testclient import TestClient
    from app.main import create_app

    with TemporaryDirectory(prefix="finanzen-integration-") as temporary:
        with patch.dict(os.environ):
            os.environ.pop("FINANZEN_FRONTEND_PATH", None)
            application = create_app(str(Path(temporary) / "integration.db"))
        try:
            with TestClient(application) as client:
                for route, filename in (("/", "index.html"), ("/styles.css", "styles.css"), ("/app.js", "app.js")):
                    response = client.get(route)
                    assert response.status_code == 200, (route, response.status_code)
                    assert response.content == (FRONT / filename).read_bytes(), route
                assert client.get("/health").json()["status"] == "ok"
                assert client.get("/docs").status_code == 200
                assert client.get("/openapi.json").status_code == 200
                payload = {
                    "account_id": "cash-account", "type": "income", "amount": "1500.00",
                    "currency": "PEN", "category": "salary", "occurred_at": "2026-10-01T10:00:00Z",
                }
                response = client.post(
                    "/api/v1/transactions", json=payload,
                    headers={"X-User-Id": "integration-user", "Idempotency-Key": "integration-0001"},
                )
                assert response.status_code == 201
                headers = {"X-User-Id": "integration-user"}
                movements = client.get("/api/v1/transactions", headers=headers)
                assert movements.status_code == 200
                assert len(movements.json()) == 1
                summary = client.get("/api/v1/summary?month=2026-10&currency=PEN", headers=headers)
                assert summary.status_code == 200
                assert summary.json()["balance"] == "1500.00"
        finally:
            gc.collect()
    print("Independent front/back integration OK.")


if __name__ == "__main__":
    main()
