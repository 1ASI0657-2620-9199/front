# FinanZen — Panel web

Panel de HTML, CSS y JavaScript para Financial Records, Budget, Notification y
Device Integration. Conserva la identidad visual verde de FinanZen y funciona
en escritorio y móvil sin compilación ni dependencias de Node en ejecución.

## Iniciar

Con Docker y Kafka, desde el repositorio hermano back/:

~~~powershell
docker compose up -d --build --wait --wait-timeout 240
~~~

Abrir **http://127.0.0.1:8080**. La imagen Nginx sirve el panel y enruta las
peticiones a las cuatro APIs independientes. [Guía Docker del backend](https://github.com/1ASI0657-2620-9199/back/blob/main/DOCKER.md).
No requiere Node o Python en el host para arrancar.

Para desarrollo local sin Docker:

Colocar front/ y back/ uno al lado del otro. Desde back/:

~~~powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts/run_local.py
~~~

Abrir http://127.0.0.1:8000. El servidor local sirve el panel y todas las APIs
desde el mismo origen. No abrir index.html como archivo.

Para una ruta distinta configurar FINANZEN_FRONTEND_PATH. Este incremento
requiere el backend de la misma rama feature/sprint-2-3-apis-ui, o main después
de integrar ese backend. El servicio financiero aislado del Sprint 1 no expone
las nuevas capacidades.

## Pantallas

- **Resumen:** movimientos, ingresos/gastos, balance, categorías y presupuestos.
- **Presupuestos:** límites por mes/categoría, progreso, edición y recomendación
  basada en ingresos y gastos anteriores.
- **Alertas:** bandeja, leídas/sin leer, preferencias y reintento de entregas fallidas.
- **Dispositivos:** registro/configuración, conexión/revocación, simulación,
  historial, gráfico diario y costos estimados.
- **Reportes:** consulta semanal de movimientos y sugerencias.

La moneda del panel es PEN. Cuenta demo permite cambiar X-User-Id para probar
datos separados; no es un inicio de sesión.

El formulario financiero conserva su Idempotency-Key durante un reintento y
puede restaurar un envío sin confirmar después de recargar. El simulador
conserva el identificador de lectura y permite reenviar la última para comprobar
deduplicación. Los costos IoT no se agregan a las transacciones financieras.

Las alertas actuales son dentro de la aplicación y el reporte semanal se consulta
bajo demanda. Docker Compose y Kafka están implementados. La autenticación real
y publicación externa siguen pendientes.

## Validación

Desde front/, con el entorno virtual de back/ disponible:

~~~powershell
node --check app.js
..\back\.venv\Scripts\python.exe scripts/verificar_integracion.py
..\back\.venv\Scripts\python.exe -m pip install -r requirements-browser.txt
..\back\.venv\Scripts\python.exe scripts/test_browser.py --base-url http://127.0.0.1:8000
~~~

La prueba del navegador utiliza Chrome instalado. Para usar Chromium de
Playwright en otra máquina:

~~~powershell
..\back\.venv\Scripts\python.exe -m playwright install chromium
..\back\.venv\Scripts\python.exe scripts/test_browser.py --channel chromium
~~~

Para iniciar un servidor temporal, ejecutar la prueba y cerrarlo automáticamente:

~~~powershell
..\back\.venv\Scripts\python.exe scripts/check_ci.py
~~~

La prueba crea un usuario sintético y recorre presupuesto → gasto → alerta,
lectura → reenvío → consumo, revocación, recomendaciones y reporte. También
simula perder la respuesta de un movimiento confirmado y reintentarlo después
de recargar la página. Verifica las cinco rutas a 390 px y errores JavaScript.

Las capturas se guardan en reports/browser/, ignoradas por Git. No se agregan
capturas de pruebas al informe automáticamente.

El workflow usa la misma rama en back y front; BACKEND_REF, como variable del
repositorio, permite seleccionar otra referencia durante la integración.
Ambos repositorios conservan main como rama principal.
