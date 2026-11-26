"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const storage = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* Storage is optional. */ } },
};
const state = {
  userId: storage.get("finanzen.user", "demo-user"), currency: "PEN",
  transactions: [], budgets: [], notifications: [], devices: [], summary: null,
  preferences: { budget_enabled: true, device_enabled: true },
  selectedDevice: null, notificationFilter: "all", recommendation: null,
  editBudget: null, editDevice: null, revision: 0, telemetryRevision: 0, reportRevision: 0,
};
const categories = {
  salary: { label: "Sueldo", icon: "+", color: "#398760" },
  sales: { label: "Ventas", icon: "+", color: "#73a987" },
  food: { label: "Alimentación", icon: "A", color: "#d6a16b" },
  transport: { label: "Transporte", icon: "T", color: "#7c98bc" },
  services: { label: "Servicios", icon: "S", color: "#9e8bb8" },
  education: { label: "Educación", icon: "E", color: "#6baca5" },
  entertainment: { label: "Entretenimiento", icon: "O", color: "#c28b8b" },
  other: { label: "Otros", icon: "·", color: "#91a69a" },
};
const expenseKeys = Object.keys(categories).filter((key) => !["salary", "sales"].includes(key));
const titles = { dashboard: "Tu resumen financiero", budgets: "Tus presupuestos", notifications: "Tus alertas", devices: "Tus dispositivos", reports: "Tu reporte semanal" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
const category = (key) => Object.hasOwn(categories, key) ? categories[key] : { ...categories.other, label: key };
const money = (value) => new Intl.NumberFormat("es-PE", { style: "currency", currency: state.currency }).format(Number(value || 0));
const number = (value, digits = 2) => new Intl.NumberFormat("es-PE", { maximumFractionDigits: digits }).format(Number(value || 0));
const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
function localDateTime(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const currentMonth = () => localDateTime().slice(0, 7);
const selectedMonth = () => $("#monthPicker").value;
function dateLabel(value, withTime = false) {
  if (!value) return "Sin lecturas";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(value.length === 10 ? value + "T12:00:00" : value));
}
function monthLabel(value) {
  return new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" }).format(new Date(value + "-01T12:00:00"));
}
function pendingKey(kind) { return "finanzen.pending." + state.userId + "." + kind; }
function lastReadingKey(deviceId) { return "finanzen.last-reading." + state.userId + "." + deviceId; }

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function api(path, options = {}) {
  const { withResponse = false, ...requestOptions } = options;
  let response;
  try {
    response = await fetch(path, {
      ...requestOptions, signal: AbortSignal.timeout(15000),
      headers: { "X-User-Id": state.userId, ...(requestOptions.body ? { "Content-Type": "application/json" } : {}), ...requestOptions.headers },
    });
  } catch {
    throw new ApiError("No pudimos confirmar la respuesta. Puedes reintentar el mismo envío de forma segura.", 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join(". ") : body.detail;
    throw new ApiError(detail || "No se pudo completar la operación.", response.status);
  }
  return withResponse ? { body, response } : body;
}
let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 5500);
}
function empty(title, message, action = "") {
  return '<div class="panel empty-state full-width">' + icon("leaf") + "<h3>" + escapeHtml(title) + "</h3><p>" + escapeHtml(message) + "</p>" + action + "</div>";
}
function progress(budget) {
  return '<progress max="100" value="' + Math.min(100, Number(budget.percentage)) + '" aria-label="' + escapeHtml(category(budget.category).label) + ": " + number(budget.percentage) + ' %"></progress>';
}
function budgetStatus(budget) {
  return budget.status === "exceeded" ? '<span class="tag danger">Límite alcanzado</span>' :
    budget.status === "near_limit" ? '<span class="tag warning">Cerca del límite</span>' : '<span class="tag">Dentro del plan</span>';
}
function openDialog(id) {
  const dialog = $("#" + id);
  dialog.querySelector(".form-message").textContent = "";
  dialog.showModal();
}
function closeMenu() {
  $("#sidebar").classList.remove("open");
  $("#sidebarScrim").hidden = true;
  $("#mobileMenu").setAttribute("aria-expanded", "false");
}
function route() {
  let routeName = location.hash.slice(1) || "dashboard";
  if (routeName === "transactions" || routeName === "analysis") routeName = "dashboard";
  if (!titles[routeName]) routeName = "dashboard";
  $$("[data-view]").forEach((section) => { section.hidden = section.dataset.view !== routeName; });
  $$("[data-route]").forEach((link) => {
    const active = link.dataset.route === routeName;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  $("#pageTitle").textContent = titles[routeName];
  document.title = titles[routeName] + " | FinanZen";
  closeMenu();
  if (routeName === "reports") loadReport();
  if (routeName === "devices") loadTelemetry();
}
function renderDashboard() {
  const summary = state.summary;
  $("#balanceValue").textContent = money(summary?.balance);
  $("#incomeValue").textContent = money(summary?.income);
  $("#expenseValue").textContent = money(summary?.expenses);
  $("#movementCount").textContent = summary?.transaction_count || 0;
  $("#availableValue").textContent = money(state.budgets.reduce((sum, budget) => sum + Number(budget.remaining), 0));
  $("#budgetCount").textContent = state.budgets.length ? state.budgets.length + (state.budgets.length === 1 ? " categoría con presupuesto" : " categorías con presupuesto") : "Aún no tienes presupuestos";
  renderTransactions();
  $("#budgetOverview").innerHTML = state.budgets.length ? state.budgets.slice(0, 3).map((budget) =>
    '<div class="' + budget.status + '"><div class="progress-heading"><strong>' + escapeHtml(category(budget.category).label) + "</strong><span>" + number(budget.percentage) + " %</span></div>" + progress(budget) + '<span class="muted">' + money(budget.spent) + " de " + money(budget.limit_amount) + "</span></div>"
  ).join("") : '<p class="muted full-width">Dale un destino a tu dinero. Crea tu primer presupuesto por categoría.</p>';
}
function renderTransactions() {
  const monthTransactions = state.transactions.filter((item) => item.occurred_at.slice(0, 7) === selectedMonth());
  const filter = $("#transactionFilter").value;
  const visible = monthTransactions.filter((item) => filter === "all" || item.type === filter);
  $("#emptyState").hidden = visible.length > 0;
  $("#transactionRows").innerHTML = visible.map((item) => {
    const detail = category(item.category);
    const income = item.type === "income";
    return '<tr><td><div class="transaction-name"><span class="category-icon">' + escapeHtml(detail.icon) + "</span><div><strong>" + escapeHtml(item.description || detail.label) + "</strong><small>" + (income ? "Ingreso" : "Gasto") + '</small></div></div></td><td class="muted">' + escapeHtml(detail.label) + '</td><td class="muted">' + dateLabel(item.occurred_at) + '</td><td class="align-right ' + (income ? "amount-income" : "amount-expense") + '">' + (income ? "+" : "−") + money(item.amount) + "</td></tr>";
  }).join("");
  const totals = Object.create(null);
  monthTransactions.filter((item) => item.type === "expense").forEach((item) => { totals[item.category] = (totals[item.category] || 0) + Number(item.amount); });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  let cursor = 0;
  const segments = entries.map(([key, amount]) => {
    const start = cursor;
    cursor += amount / total * 100;
    return category(key).color + " " + start + "% " + cursor + "%";
  });
  $("#expenseDonut").style.background = total ? "conic-gradient(" + segments.join(",") + ")" : "#e7eee9";
  $("#expenseDonut").setAttribute("aria-label", total ? entries.map(([key, amount]) => category(key).label + ": " + money(amount)).join(", ") : "Sin gastos en este periodo");
  $("#donutTotal").textContent = money(total);
  $("#expenseLegend").innerHTML = entries.length ? entries.map(([key, amount]) =>
    '<div class="legend-row"><span class="legend-name"><span class="legend-swatch" style="background:' + category(key).color + '"></span>' + escapeHtml(category(key).label) + "</span><strong>" + number(amount / total * 100, 0) + " %</strong></div>"
  ).join("") : '<p class="muted">Aquí verás cómo se distribuyen tus gastos.</p>';
}
function renderBudgets() {
  $("#budgetCards").innerHTML = state.budgets.length ? state.budgets.map((budget) => {
    const detail = category(budget.category);
    return '<article class="panel budget-card ' + budget.status + '"><div class="budget-card-header"><span class="category-icon">' + escapeHtml(detail.icon) + "</span><h3>" + escapeHtml(detail.label) + "</h3>" + budgetStatus(budget) + '</div><p class="budget-amount">' + money(budget.spent) + '</p><p class="budget-limit">de ' + money(budget.limit_amount) + ' presupuestados</p><div class="progress-heading"><span>Avance del mes</span><span>' + number(budget.percentage) + " %</span></div>" + progress(budget) + '<div class="budget-card-footer"><span class="muted">' + (Number(budget.remaining) >= 0 ? money(budget.remaining) + " disponibles" : money(-Number(budget.remaining)) + " sobre el límite") + '</span><button class="text-button" data-action="edit-budget" data-id="' + budget.id + '" aria-label="Editar presupuesto de ' + escapeHtml(detail.label) + '">Editar</button></div></article>';
  }).join("") : empty("Un plan a tu medida", "Crea un presupuesto para empezar a recibir avisos antes de alcanzar tus límites.", '<button class="primary-button" data-action="new-budget">Crear presupuesto</button>');
}
function notificationMessage(item) {
  const data = item.metadata;
  if (item.kind !== "budget") return item.message;
  return "Has alcanzado el " + data.threshold + " % de tu presupuesto de " + category(data.category).label.toLowerCase() + " en " + monthLabel(data.month) + ": " + money(data.spent) + " de " + money(data.limit_amount) + ".";
}
function renderNotifications() {
  const unread = state.notifications.filter((item) => !item.read_at).length;
  $("#notificationCount").textContent = unread;
  $("#notificationCount").hidden = unread === 0;
  const visible = state.notifications.filter((item) => state.notificationFilter === "unread" ? !item.read_at : state.notificationFilter === "failed" ? ["retrying", "failed"].includes(item.status) : true);
  const labels = { delivered: "Entregada", pending: "Pendiente de entrega", retrying: "Reintentando entrega", failed: "Entrega fallida" };
  $("#notificationList").innerHTML = visible.length ? visible.map((item) =>
    '<article class="panel notification-card ' + (item.read_at ? "" : "unread") + '"><span class="summary-icon ' + (item.kind === "budget" ? "income-icon" : "neutral-icon") + '">' + icon(item.kind === "budget" ? "wallet" : "device") + '</span><div class="notification-copy"><h3>' + escapeHtml(item.title) + "</h3><p>" + escapeHtml(notificationMessage(item)) + '</p><div class="notification-meta"><span class="muted">' + dateLabel(item.created_at, true) + '</span><span class="tag ' + (item.status === "failed" ? "danger" : item.status !== "delivered" ? "warning" : "neutral") + '">' + labels[item.status] + '</span><span class="muted">' + item.attempts + ' intento(s)</span></div></div><div class="notification-actions">' +
    (!item.read_at ? '<button class="text-button" data-action="read-notification" data-id="' + escapeHtml(item.id) + '">Marcar como leída</button>' : '<span class="muted">Leída</span>') +
    (["failed", "retrying"].includes(item.status) ? '<button class="secondary-button" data-action="retry-notification" data-id="' + escapeHtml(item.id) + '">Reintentar</button>' : "") + "</div></article>"
  ).join("") : empty(state.notificationFilter === "all" ? "Todo en orden por aquí" : "No hay alertas con este filtro", "Los avisos aparecerán cuando tus presupuestos o dispositivos alcancen sus límites.");
}
function renderDevices() {
  if (!state.devices.some((item) => item.id === state.selectedDevice)) state.selectedDevice = state.devices[0]?.id || null;
  $("#deviceCards").innerHTML = state.devices.length ? state.devices.map((device) =>
    '<article class="panel device-card ' + (device.id === state.selectedDevice ? "selected" : "") + '"><div class="device-top"><span class="summary-icon neutral-icon">' + icon("device") + '</span><span class="status ' + (device.active ? "connected" : "") + '">' + (device.active ? "Conectado" : "Desconectado") + "</span></div><h3>" + escapeHtml(device.name) + "</h3><p>" + (device.source === "simulator" ? "Medidor simulado" : "Meter V1") + " · " + device.reading_count + " lecturas</p><p>Última sincronización: " + dateLabel(device.last_sync_at, true) + "</p><p>Límite: " + number(device.monthly_limit_kwh, 3) + " kWh · Tarifa: " + money(device.tariff_per_kwh) + '/kWh</p><div class="device-card-actions"><button class="text-button" data-action="select-device" data-id="' + device.id + '">Ver consumo</button><button class="text-button" data-action="toggle-device" data-id="' + device.id + '">' + (device.active ? "Desconectar" : "Reconectar") + '</button><button class="text-button device-edit" data-action="edit-device" data-id="' + device.id + '">Editar</button></div></article>'
  ).join("") : empty("Tu consumo también cuenta", "Agrega un medidor simulado para probar tus primeras lecturas.", '<button class="primary-button" data-action="new-device">Agregar dispositivo</button>');
  $("#telemetryPanel").hidden = !state.selectedDevice;
}
async function loadTelemetry() {
  const revision = ++state.telemetryRevision;
  const deviceId = state.selectedDevice;
  if (!deviceId) return;
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device) return;
  $("#telemetryTitle").textContent = device.name;
  $("#simulateButton").hidden = device.source !== "simulator";
  $("#simulateButton").disabled = !device.active;
  $("#repeatReadingButton").hidden = !storage.get(lastReadingKey(deviceId)) || device.source !== "simulator";
  $("#repeatReadingButton").disabled = !device.active;
  try {
    const month = selectedMonth();
    const [summary, readings] = await Promise.all([
      api("/api/v1/devices/" + deviceId + "/consumption?month=" + month),
      api("/api/v1/devices/" + deviceId + "/readings?month=" + month),
    ]);
    if (revision !== state.telemetryRevision) return;
    $("#telemetrySummary").innerHTML = '<div><small>Consumo del mes</small><strong>' + number(summary.kwh, 4) + ' kWh</strong><span>' + number(summary.percentage) + " % de tu límite de " + number(summary.monthly_limit_kwh, 3) + ' kWh</span></div><div><small>Costo estimado</small><strong>' + money(summary.estimated_cost) + '</strong><span>No modifica tu balance financiero</span></div><div><small>Lecturas únicas</small><strong>' + summary.reading_count + '</strong><span>Los reenvíos no suman consumo</span></div>';
    const max = Math.max(...summary.daily.map((day) => Number(day.kwh)), 1);
    $("#consumptionChart").innerHTML = summary.daily.length ? '<p class="muted">Consumo diario en kWh</p><div class="bar-chart" role="img" aria-label="' + escapeHtml(summary.daily.map((day) => day.date + ": " + number(day.kwh, 4) + " kWh").join(", ")) + '">' + summary.daily.map((day) => '<div class="bar-column" title="' + escapeHtml(day.date) + ": " + number(day.kwh, 4) + ' kWh"><div class="bar" style="height:' + Math.max(2, Number(day.kwh) / max * 120) + 'px"></div><span>' + day.date.slice(8) + "</span></div>").join("") + "</div>" : "";
    $("#readingRows").innerHTML = readings.map((reading) => '<tr><td>' + dateLabel(reading.occurred_at, true) + '</td><td>' + number(reading.value, 6) + " kWh</td><td>" + money(reading.estimated_cost) + '</td><td class="muted">' + (reading.source === "simulator" ? "Simulador" : "Meter V1") + "</td></tr>").join("");
    $("#readingEmpty").hidden = readings.length > 0;
  } catch (error) {
    if (revision === state.telemetryRevision) $("#telemetrySummary").innerHTML = '<p class="form-message full-width">' + escapeHtml(error.message) + "</p>";
  }
}
async function loadReport() {
  const revision = ++state.reportRevision;
  const date = $("#weekPicker").value;
  if (!date) return;
  try {
    const report = await api("/api/v1/reports/weekly?week_start=" + date);
    if (revision !== state.reportRevision) return;
    $("#weeklyReport").innerHTML = '<article class="panel"><div class="report-heading"><h2>Del ' + dateLabel(report.week_start) + " al " + dateLabel(report.week_end) + '</h2><p>Presupuestos mensuales correspondientes al inicio de la semana. Los importes de abajo corresponden a los movimientos de la semana.</p></div><div class="telemetry-summary" style="padding-top:24px"><div><small>Ingresos</small><strong>' + money(report.income) + '</strong></div><div><small>Gastos</small><strong>' + money(report.expenses) + '</strong></div><div><small>Balance semanal</small><strong>' + money(report.balance) + '</strong></div></div></article><div class="report-grid"><article class="panel"><div class="panel-heading"><h2>Gastos de la semana</h2></div>' +
      (report.categories.length ? '<table><thead><tr><th>Categoría</th><th class="align-right">Gasto</th></tr></thead><tbody>' + report.categories.map((item) => '<tr><td>' + escapeHtml(category(item.category).label) + '</td><td class="align-right">' + money(item.expenses) + "</td></tr>").join("") + "</tbody></table>" : '<p class="inline-empty">Sin gastos registrados en esta semana.</p>') +
      '</article><article class="panel"><div class="panel-heading"><h2>Para tener en cuenta</h2></div><ul class="suggestions">' + report.suggestions.map((suggestion) => "<li>" + escapeHtml(suggestion.replace(/de ([a-z_]+):/, (_, key) => "de " + category(key).label.toLowerCase() + ":")) + "</li>").join("") + "</ul></article></div>";
  } catch (error) {
    if (revision === state.reportRevision) $("#weeklyReport").innerHTML = empty("No pudimos cargar el reporte", error.message);
  }
}
async function loadAll({ silent = false } = {}) {
  const revision = ++state.revision;
  const month = selectedMonth();
  if (!month) return;
  if (!silent) $("#connectionStatus").textContent = "Actualizando tu información…";
  const requests = [
    ["summary", "/api/v1/summary?month=" + month + "&currency=PEN", "resumen"],
    ["transactions", "/api/v1/transactions", "movimientos"],
    ["budgets", "/api/v1/budgets?month=" + month, "presupuestos"],
    ["notifications", "/api/v1/notifications", "alertas"],
    ["devices", "/api/v1/devices", "dispositivos"],
    ["preferences", "/api/v1/notification-preferences", "preferencias"],
  ];
  const results = await Promise.allSettled(requests.map(([, path]) => api(path)));
  if (revision !== state.revision) return;
  const failures = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") state[requests[index][0]] = result.value;
    else failures.push(requests[index][2]);
  });
  renderDashboard(); renderBudgets(); renderNotifications(); renderDevices();
  $("#serviceWarning").hidden = !failures.length;
  $("#serviceWarning").textContent = "No pudimos actualizar: " + failures.join(", ") + ". Vuelve a intentarlo con el botón Actualizar.";
  $("#connectionStatus").textContent = failures.length ? "Parte de la información no está disponible." : "Información actualizada · " + new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  $("#connectionStatus").classList.toggle("error", failures.length > 0);
  if (location.hash === "#devices") await loadTelemetry();
  if (location.hash === "#reports") await loadReport();
}
function refreshAfterChange() {
  loadAll({ silent: true });
  setTimeout(() => loadAll({ silent: true }), 700);
}
function fillCategories(select, keys) {
  select.innerHTML = keys.map((key) => '<option value="' + escapeHtml(key) + '">' + escapeHtml(category(key).label) + "</option>").join("");
}
function prepareTransaction() {
  const form = $("#transactionForm");
  form.reset();
  fillCategories(form.elements.category, ["salary", "sales", ...expenseKeys]);
  form.elements.occurred_at.value = selectedMonth() === currentMonth() ? localDateTime() : selectedMonth() + "-01T12:00";
  const pending = storage.get(pendingKey("transaction"));
  if (pending?.payload) {
    const payload = pending.payload;
    form.elements.type.value = payload.type;
    form.elements.amount.value = payload.amount;
    if (!categories[payload.category]) fillCategories(form.elements.category, [payload.category, ...Object.keys(categories)]);
    form.elements.category.value = payload.category;
    form.elements.occurred_at.value = localDateTime(new Date(payload.occurred_at));
    form.elements.description.value = payload.description || "";
  }
  openDialog("transactionDialog");
  if (pending?.payload) form.querySelector(".form-message").textContent = "Hay un envío sin confirmar. Se conservará su clave si reintentas los mismos datos.";
}
function prepareBudget(budget = null) {
  state.editBudget = budget?.id || null;
  const form = $("#budgetForm");
  form.reset();
  fillCategories(form.elements.category, budget && !categories[budget.category] ? [budget.category, ...expenseKeys] : expenseKeys);
  form.elements.category.disabled = Boolean(budget);
  if (budget) {
    form.elements.category.value = budget.category;
    form.elements.limit_amount.value = budget.limit_amount;
    if (![50, 75, 80, 90, 100].includes(budget.alert_threshold)) {
      form.elements.alert_threshold.add(new Option(budget.alert_threshold + " % del límite", budget.alert_threshold));
    }
    form.elements.alert_threshold.value = budget.alert_threshold;
  }
  $("#budgetTitle").textContent = budget ? "Editar presupuesto" : "Crear presupuesto";
  $("#budgetPeriod").textContent = "Periodo: " + monthLabel(budget?.month || selectedMonth()) + ". Se contabilizan los gastos ya registrados.";
  openDialog("budgetDialog");
}
function prepareDevice(device = null) {
  state.editDevice = device?.id || null;
  const form = $("#deviceForm");
  form.reset();
  for (const key of ["name", "source", "monthly_limit_kwh", "tariff_per_kwh"]) if (device) form.elements[key].value = device[key];
  form.elements.source.disabled = Boolean(device);
  $("#deviceTitle").textContent = device ? "Editar dispositivo" : "Agregar dispositivo";
  openDialog("deviceDialog");
}
function prepareReading() {
  const device = state.devices.find((item) => item.id === state.selectedDevice);
  if (!device?.active) return;
  $("#readingForm").reset();
  $("#readingDeviceName").textContent = "Dispositivo: " + device.name;
  openDialog("readingDialog");
}
function handleForm(formId, handler) {
  $("#" + formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    const original = button.textContent;
    button.disabled = true; button.textContent = "Guardando…";
    form.querySelector(".form-message").textContent = "";
    try { await handler(form); }
    catch (error) { form.querySelector(".form-message").textContent = error.message; }
    finally { button.disabled = false; button.textContent = original; }
  });
}
handleForm("transactionForm", async (form) => {
  const data = new FormData(form);
  const payload = {
    account_id: "cash-account", type: data.get("type"), amount: data.get("amount"),
    currency: "PEN", category: data.get("category"), occurred_at: new Date(data.get("occurred_at")).toISOString(),
    description: data.get("description") || null,
  };
  const previous = storage.get(pendingKey("transaction"));
  const attempt = previous && JSON.stringify(previous.payload) === JSON.stringify(payload) ? previous : { payload, key: crypto.randomUUID() };
  storage.set(pendingKey("transaction"), attempt);
  await api("/api/v1/transactions", { method: "POST", headers: { "Idempotency-Key": attempt.key }, body: JSON.stringify(attempt.payload) });
  storage.remove(pendingKey("transaction"));
  $("#monthPicker").value = payload.occurred_at.slice(0, 7);
  $("#transactionDialog").close(); toast("Movimiento guardado. Tu resumen se actualizará en un momento."); refreshAfterChange();
});
handleForm("budgetForm", async (form) => {
  const existing = state.budgets.find((item) => item.id === state.editBudget);
  const payload = { category: existing?.category || form.elements.category.value, month: existing?.month || selectedMonth(),
    currency: "PEN", limit_amount: form.elements.limit_amount.value, alert_threshold: Number(form.elements.alert_threshold.value) };
  await api("/api/v1/budgets" + (state.editBudget ? "/" + state.editBudget : ""), { method: state.editBudget ? "PUT" : "POST", body: JSON.stringify(payload) });
  $("#budgetDialog").close(); toast("Presupuesto guardado."); refreshAfterChange();
});
handleForm("deviceForm", async (form) => {
  const payload = { name: form.elements.name.value, monthly_limit_kwh: form.elements.monthly_limit_kwh.value, tariff_per_kwh: form.elements.tariff_per_kwh.value };
  if (!state.editDevice) payload.source = form.elements.source.value;
  const device = await api("/api/v1/devices" + (state.editDevice ? "/" + state.editDevice : ""), { method: state.editDevice ? "PUT" : "POST", body: JSON.stringify(payload) });
  state.selectedDevice = device.id;
  $("#deviceDialog").close(); toast("Dispositivo guardado."); refreshAfterChange();
});
handleForm("readingForm", async (form) => {
  const deviceId = state.selectedDevice;
  const intent = { value: form.elements.value.value, unit: form.elements.unit.value };
  const key = pendingKey("reading." + deviceId);
  const previous = storage.get(key);
  const attempt = previous && JSON.stringify(previous.intent) === JSON.stringify(intent) ? previous : {
    intent, payload: { ...intent, reading_id: crypto.randomUUID(), occurred_at: new Date().toISOString() },
  };
  storage.set(key, attempt);
  await api("/api/v1/devices/" + deviceId + "/simulate", { method: "POST", body: JSON.stringify(attempt.payload) });
  storage.set(lastReadingKey(deviceId), attempt.payload); storage.remove(key);
  $("#monthPicker").value = attempt.payload.occurred_at.slice(0, 7);
  $("#readingDialog").close(); toast("Lectura recibida. El costo se muestra como estimación."); refreshAfterChange();
});
handleForm("preferencesForm", async (form) => {
  state.preferences = await api("/api/v1/notification-preferences", { method: "PUT", body: JSON.stringify({
    budget_enabled: form.elements.budget_enabled.checked, device_enabled: form.elements.device_enabled.checked,
  }) });
  $("#preferencesDialog").close(); toast("Preferencias guardadas.");
});
handleForm("profileForm", async (form) => {
  const userId = form.elements.user_id.value.trim();
  if (!userId) throw new Error("Ingresa un identificador válido.");
  state.userId = userId; storage.set("finanzen.user", userId);
  state.transactions = []; state.budgets = []; state.notifications = []; state.devices = []; state.summary = null;
  state.selectedDevice = null; state.recommendation = null; state.telemetryRevision++; state.reportRevision++;
  $("#userIdLabel").textContent = userId; $("#recommendation").hidden = true;
  $("#profileDialog").close(); renderDashboard(); renderBudgets(); renderNotifications(); renderDevices();
  await loadAll(); toast("Identidad demo actualizada.");
});
async function showRecommendation(button) {
  button.disabled = true;
  $("#recommendation").hidden = false;
  $("#recommendation").innerHTML = '<p class="muted">Preparando tu recomendación…</p>';
  const month = selectedMonth(), user = state.userId;
  try {
    const result = await api("/api/v1/budget-recommendations?month=" + month);
    if (month !== selectedMonth() || user !== state.userId) return;
    state.recommendation = result;
    $("#recommendation").innerHTML = '<p>Ingreso mensual de referencia: <strong>' + money(result.average_monthly_income) + "</strong> · Reserva para ahorro: <strong>" + money(result.savings_target) + '</strong></p><div class="recommendation-items">' +
      result.budgets.map((item) => '<div class="recommendation-item"><span class="muted">' + escapeHtml(category(item.category).label) + "</span><strong>" + money(item.limit_amount) + "</strong></div>").join("") +
      '</div><p class="help-text">' + escapeHtml(result.explanation) + '</p><button class="primary-button" data-action="apply-recommendation">Crear los presupuestos que faltan</button><p class="muted" style="margin-top:10px">Tus presupuestos existentes se conservan.</p>';
  } catch (error) {
    if (month === selectedMonth() && user === state.userId) $("#recommendation").innerHTML = '<p class="muted">' + escapeHtml(error.message) + "</p>";
  } finally { button.disabled = false; }
}
async function action(button) {
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case "new-budget": prepareBudget(); return;
    case "edit-budget": prepareBudget(state.budgets.find((item) => item.id === id)); return;
    case "new-device": prepareDevice(); return;
    case "edit-device": prepareDevice(state.devices.find((item) => item.id === id)); return;
    case "select-device": state.selectedDevice = id; renderDevices(); await loadTelemetry(); return;
    case "toggle-device": {
      const device = state.devices.find((item) => item.id === id);
      await api("/api/v1/devices/" + id + "/connection", { method: device.active ? "DELETE" : "POST" });
      toast(device.active ? "Dispositivo desconectado." : "Dispositivo conectado."); break;
    }
    case "read-notification": await api("/api/v1/notifications/" + encodeURIComponent(id) + "/read", { method: "PATCH" }); break;
    case "retry-notification": await api("/api/v1/notifications/" + encodeURIComponent(id) + "/retry", { method: "POST" }); toast("Reintento solicitado."); break;
    case "apply-recommendation": {
      if (!state.recommendation || state.recommendation.month !== selectedMonth()) return;
      let created = 0;
      const result = state.recommendation;
      for (const budget of result.budgets) {
        if (state.budgets.some((item) => item.category === budget.category)) continue;
        try {
          await api("/api/v1/budgets", { method: "POST", body: JSON.stringify({ month: result.month, currency: "PEN", category: budget.category, limit_amount: budget.limit_amount, alert_threshold: 80 }) });
          created++;
        } catch (error) { if (error.status !== 409) throw error; }
      }
      toast(created ? created + " presupuestos creados." : "Ya tienes presupuestos para todas las categorías recomendadas."); break;
    }
  }
  refreshAfterChange();
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-route]")) closeMenu();
  const opener = event.target.closest("[data-open]");
  if (opener) { if (opener.dataset.open === "transactionDialog") prepareTransaction(); else openDialog(opener.dataset.open); }
  const closer = event.target.closest("[data-close]");
  if (closer) closer.closest("dialog").close();
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  button.disabled = true;
  try { await action(button); } catch (error) { toast(error.message, true); refreshAfterChange(); }
  finally { button.disabled = false; }
});
$$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
}));
$("#monthPicker").value = currentMonth();
$("#weekPicker").value = localDateTime().slice(0, 10);
$("#userIdLabel").textContent = state.userId;
$("#transactionFilter").addEventListener("change", renderTransactions);
$("#refreshButton").addEventListener("click", () => loadAll());
$("#newBudgetButton").addEventListener("click", () => prepareBudget());
$("#newDeviceButton").addEventListener("click", () => prepareDevice());
$("#simulateButton").addEventListener("click", prepareReading);
$("#recommendButton").addEventListener("click", (event) => showRecommendation(event.currentTarget));
$("#preferencesButton").addEventListener("click", () => {
  $("#preferencesForm").elements.budget_enabled.checked = state.preferences.budget_enabled;
  $("#preferencesForm").elements.device_enabled.checked = state.preferences.device_enabled;
  openDialog("preferencesDialog");
});
$("#profileButton").addEventListener("click", () => {
  $("#profileForm").elements.user_id.value = state.userId; openDialog("profileDialog");
});
$("#mobileMenu").addEventListener("click", () => {
  const opened = $("#sidebar").classList.toggle("open");
  $("#sidebarScrim").hidden = !opened; $("#mobileMenu").setAttribute("aria-expanded", String(opened));
});
$("#sidebarScrim").addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
$("#monthPicker").addEventListener("change", () => {
  if (!selectedMonth()) return;
  state.recommendation = null; $("#recommendation").hidden = true;
  state.summary = null; state.budgets = []; renderDashboard(); renderBudgets();
  $("#weekPicker").value = selectedMonth() === currentMonth() ? localDateTime().slice(0, 10) : selectedMonth() + "-01";
  loadAll();
});
$("#weekPicker").addEventListener("change", loadReport);
$$("[data-notification-filter]").forEach((button) => button.addEventListener("click", () => {
  state.notificationFilter = button.dataset.notificationFilter;
  $$("[data-notification-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderNotifications();
}));
$("#repeatReadingButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const payload = storage.get(lastReadingKey(state.selectedDevice));
  if (!payload || button.disabled) return;
  button.disabled = true;
  try {
    const result = await api("/api/v1/devices/" + state.selectedDevice + "/simulate", { method: "POST", body: JSON.stringify(payload), withResponse: true });
    toast(result.response.headers.get("Idempotent-Replayed") === "true" ? "Lectura ya recibida: el consumo se mantiene sin duplicarse." : "Lectura recibida.");
    refreshAfterChange();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
window.addEventListener("hashchange", route);
route(); loadAll();
setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]")) loadAll({ silent: true }); }, 4000);
