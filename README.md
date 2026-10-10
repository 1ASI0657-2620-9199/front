# FinanZen — Front

Repositorio independiente del panel web del MVP, desarrollado con HTML, CSS y
JavaScript. No necesita Node.js para ejecutarse ni un proceso de compilación.

[Todos los repositorios](https://github.com/orgs/1ASI0657-2620-9199/repositories) ·
[Backend](https://github.com/1ASI0657-2620-9199/back) ·
[Reporte](https://github.com/1ASI0657-2620-9199/report)

## Archivos

- `index.html`: panel, movimientos, análisis y formulario de registro.
- `styles.css`: diseño adaptable.
- `app.js`: solicitudes a la API y actualización de la interfaz.
- `scripts/verificar_integracion.py`: comprobación del frontend con el backend.

## Ejecutar

Clonar ambos repositorios en un mismo directorio:

```powershell
git clone https://github.com/1ASI0657-2620-9199/front.git
git clone https://github.com/1ASI0657-2620-9199/back.git
cd back
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Abrir http://127.0.0.1:8000. El backend sirve los archivos de la carpeta vecina
`front` y la API desde el mismo origen. Para otra ubicación, configurar
`FINANZEN_FRONTEND_PATH` antes de iniciar el backend.

La interfaz requiere la API para registrar y consultar movimientos. Abrir
`index.html` directamente como archivo no conecta el servicio.

## Funcionalidades

- Resumen mensual de ingresos, gastos, saldo y cantidad de movimientos.
- Tabla filtrada por mes y gráfico de gastos por categoría.
- Formulario para registrar ingresos y gastos.
- Estado de conexión, errores y navegación adaptable.

La demostración usa `demo-user`, moneda `PEN` y cuenta `cash-account`.
Autenticación, proyecciones, cursos y alertas de presupuesto siguen pendientes.

## Validación

Con Node.js instalado, `node --check app.js` comprueba la sintaxis. Con las
dependencias del backend instaladas y los repositorios juntos:

```powershell
python scripts/verificar_integracion.py
```

El workflow valida sintaxis e integración clonando `back` como repositorio
independiente. Se utilizan bases temporales.
