"""Browser acceptance against a running local FinanZen suite.

python scripts/test_browser.py --base-url http://127.0.0.1:8010
Uses an isolated synthetic user. Outputs screenshots under ignored reports/.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from playwright.sync_api import expect, sync_playwright


def main(base_url: str, channel: str):
    output = Path(__file__).resolve().parents[1] / "reports/browser"
    output.mkdir(parents=True, exist_ok=True)
    user = "browser-" + str(uuid4())[:8]
    headers = {"X-User-Id": user}
    api = httpx.Client(base_url=base_url, headers=headers, timeout=20)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    errors = []
    with sync_playwright() as playwright:
        options = {"headless": True}
        if channel and channel != "chromium":
            options["channel"] = channel
        browser = playwright.chromium.launch(**options)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, locale="es-PE")
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base_url)
        page.get_by_role("button", name="Cuenta demo").click()
        page.locator("#profileForm input[name=user_id]").fill(user)
        page.get_by_role("button", name="Cambiar cuenta demo", exact=True).click()
        expect(page.locator("#userIdLabel")).to_have_text(user)

        page.locator('[data-route="budgets"]').click()
        page.locator("#newBudgetButton").click()
        page.locator("#budgetForm select[name=category]").select_option("food")
        page.locator("#budgetForm input[name=limit_amount]").fill("100")
        page.get_by_role("button", name="Guardar presupuesto", exact=True).click()
        expect(page.locator("#budgetDialog")).not_to_be_visible()
        expect(page.locator(".budget-card")).to_have_count(1)

        page.locator('[data-route="dashboard"]').click()
        page.locator(".hero button").click()
        page.locator('#transactionForm input[name=type][value=expense]').check(force=True)
        page.locator("#transactionForm select[name=category]").select_option("food")
        page.locator("#transactionForm input[name=amount]").fill("85")
        page.locator("#transactionForm input[name=description]").fill("Compra de prueba")
        page.get_by_role("button", name="Guardar movimiento", exact=True).click()
        expect(page.locator("#transactionDialog")).not_to_be_visible()
        expect(page.locator("#transactionRows")).to_contain_text("Compra de prueba")
        page.locator('[data-route="budgets"]').click()
        expect(page.locator(".budget-card")).to_contain_text("Cerca del límite", timeout=12000)
        page.screenshot(path=str(output / "02-presupuestos.png"), full_page=True, animations="disabled", style="#toast { visibility: hidden !important; }")
        page.locator('[data-route="notifications"]').click()
        expect(page.locator("#notificationList")).to_contain_text("Tu presupuesto se acerca al límite", timeout=12000)
        page.get_by_role("button", name="Marcar como leída", exact=True).click()
        expect(page.locator("#notificationList")).to_contain_text("Leída")
        page.screenshot(path=str(output / "03-alertas.png"), full_page=True, animations="disabled", style="#toast { visibility: hidden !important; }")

        # Simulate a lost HTTP response after a successful database commit.
        page.locator('[data-route="dashboard"]').click()
        page.locator(".hero button").click()
        page.locator('#transactionForm input[name=type][value=expense]').check(force=True)
        page.locator("#transactionForm select[name=category]").select_option("transport")
        page.locator("#transactionForm input[name=amount]").fill("7.75")
        page.locator("#transactionForm input[name=description]").fill("Respuesta perdida")
        def lose_response(route):
            if route.request.method == "POST":
                response = route.fetch()
                assert response.status == 201
                route.abort("failed")
            else:
                route.continue_()
        page.route("**/api/v1/transactions", lose_response)
        page.get_by_role("button", name="Guardar movimiento", exact=True).click()
        expect(page.locator("#transactionForm .form-message")).to_contain_text("No pudimos confirmar")
        assert len(api.get("/api/v1/transactions").json()) == 2
        page.unroute("**/api/v1/transactions", lose_response)
        page.reload()
        page.locator(".hero button").click()
        expect(page.locator("#transactionForm input[name=description]")).to_have_value("Respuesta perdida")
        page.get_by_role("button", name="Guardar movimiento", exact=True).click()
        expect(page.locator("#transactionDialog")).not_to_be_visible()
        assert len(api.get("/api/v1/transactions").json()) == 2

        page.locator('[data-route="devices"]').click()
        page.locator("#newDeviceButton").click()
        page.locator("#deviceForm input[name=name]").fill("Medidor del hogar")
        page.locator("#deviceForm input[name=monthly_limit_kwh]").fill("20")
        page.get_by_role("button", name="Guardar dispositivo", exact=True).click()
        expect(page.locator("#deviceDialog")).not_to_be_visible()
        expect(page.locator("#telemetryPanel")).to_be_visible()
        page.locator("#simulateButton").click()
        page.locator("#readingForm input[name=value]").fill("15")
        page.get_by_role("button", name="Enviar lectura", exact=True).click()
        expect(page.locator("#readingDialog")).not_to_be_visible()
        expect(page.locator("#telemetrySummary")).to_contain_text("15 kWh", timeout=12000)
        expect(page.locator("#readingRows tr")).to_have_count(1)
        page.locator("#repeatReadingButton").click()
        expect(page.locator("#toast")).to_contain_text("sin duplicarse")
        expect(page.locator("#readingRows tr")).to_have_count(1)
        page.locator("#simulateButton").click()
        page.locator("#readingForm input[name=value]").fill("10")
        page.get_by_role("button", name="Enviar lectura", exact=True).click()
        expect(page.locator("#readingDialog")).not_to_be_visible()
        expect(page.locator("#telemetrySummary")).to_contain_text("25 kWh", timeout=12000)
        expect(page.locator("#readingRows tr")).to_have_count(2)
        assert len(api.get("/api/v1/transactions").json()) == 2
        page.screenshot(path=str(output / "04-dispositivos.png"), full_page=True, animations="disabled", style="#toast { visibility: hidden !important; }")
        page.get_by_role("button", name="Desconectar", exact=True).click()
        expect(page.locator("#simulateButton")).to_be_disabled()
        page.get_by_role("button", name="Reconectar", exact=True).click()
        expect(page.locator("#simulateButton")).to_be_enabled()

        page.locator('[data-route="reports"]').click()
        expect(page.locator("#weeklyReport")).to_contain_text("Gastos de la semana")
        page.screenshot(path=str(output / "05-reporte.png"), full_page=True, animations="disabled", style="#toast { visibility: hidden !important; }")
        page.locator('[data-route="dashboard"]').click()
        expect(page.locator("#expenseValue")).to_contain_text("92.75")
        page.screenshot(path=str(output / "01-resumen.png"), full_page=True, animations="disabled", style="#toast { visibility: hidden !important; }")
        # Supply previous-month history for the recommendation flow.
        year, mon = map(int, month.split("-"))
        previous = f"{year - (mon == 1):04d}-{12 if mon == 1 else mon - 1:02d}"
        response = api.post("/api/v1/transactions", headers={"Idempotency-Key": "browser-history-001"}, json={
            "account_id": "cash-account", "type": "income", "amount": "2000", "currency": "PEN",
            "category": "salary", "occurred_at": previous + "-03T12:00:00Z",
        })
        assert response.status_code == 201
        page.wait_for_timeout(800)
        page.locator('[data-route="budgets"]').click()
        page.locator("#recommendButton").click()
        expect(page.locator("#recommendation")).to_contain_text("Reserva para ahorro")
        page.get_by_role("button", name="Crear los presupuestos que faltan").click()
        expect(page.locator(".budget-card")).to_have_count(6, timeout=12000)

        page.set_viewport_size({"width": 390, "height": 844})
        for route_name in ("dashboard", "budgets", "notifications", "devices", "reports"):
            page.locator("#mobileMenu").click()
            page.locator('[data-route="' + route_name + '"]').click()
            page.wait_for_timeout(250)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), route_name
        page.locator("#mobileMenu").click()
        page.locator('[data-route="dashboard"]').click()
        page.screenshot(path=str(output / "06-movil.png"), full_page=True, animations="disabled", style="#toast { visibility: hidden !important; }")
        assert not errors, errors
        browser.close()
    api.close()
    print("Browser OK: budget -> expense -> alert, read state, lost-response retry after reload,")
    print("device -> readings -> duplicate replay -> consumption alert, disconnect/reconnect,")
    print("recommendations, weekly report, five mobile routes, and no JavaScript errors.")
    print("Synthetic user:", user)
    print("Screenshots:", output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--channel", default="chrome", help="chrome or chromium (installed through Playwright)")
    args = parser.parse_args()
    main(args.base_url.rstrip("/"), args.channel)
