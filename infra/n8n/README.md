# Flujos de n8n

Copias de los flujos que usa la app, para versionarlos y probarlos.

| Archivo | Webhook | Usado por |
|---|---|---|
| `caja-chica-ocr.json` | `caja-chica-ocr` (`APP_CONFIG.OCR_WEBHOOK_URL`) | Lector de facturas de Caja chica |

## Respuesta del lector de facturas

Devuelve `ok`, `emisor`, `rncEmisor`, `cliente`, `rncCliente`, `ncf`, `fecha`, `subtotal`, `itbis`, `total`, `concepto`, `categoria`, `notas`, `items` y `boxes`, más cuatro campos fiscales para explicar totales que no cuadran:

- `descuento`: monto total del descuento (número, `null` si no hay).
- `propina`: propina legal / "Ley 10%" / servicio (número, `null` si no hay).
- `exento`: monto de artículos exentos de ITBIS (número, `null` si no se muestra).
- `itbisIncluido`: `true` si los precios o el subtotal ya incluyen el ITBIS, `false` si se suma aparte, `null` si no se sabe.

`subtotal` es el monto antes de descuento e ITBIS cuando así viene impreso.

`fecha` sale siempre como `AAAA-MM-DD`. Las facturas dominicanas imprimen la fecha como DÍA/MES/AÑO (03/11/2026 es el 3 de noviembre): se le explica al lector y el nodo «Parsear JSON» convierte `dd/mm/aaaa` y deja `null` una fecha imposible.

Si la respuesta de Gemini se corta (`finishReason` = `MAX_TOKENS`), el error lo dice y la respuesta incluye `finishReason`. Revísalo en **Executions** cuando una factura falle.

## Cómo actualizar un flujo

1. Cambia el JSON aquí y corre sus pruebas: `npx jest js/tests/N8nReceiptOcrWorkflow.test.js`.
   Las pruebas ejecutan el código real de cada nodo "Code".
2. En n8n, para no romper la lectura actual:
   1. Exporta el flujo que está activo (⋯ → **Download**) como respaldo.
   2. Desactívalo. n8n no deja activar dos flujos con la misma ruta `caja-chica-ocr`; deja **un solo** webhook activo.
   3. Importa (⋯ → **Import from File**), revisa la credencial, guarda y **actívalo**.
   4. Sube una factura de prueba y mira **Executions**.
   Si algo falla, desactiva el nuevo y reactiva el respaldo.
   Las credenciales se enlazan por id. Si n8n pide elegirla, usa "Google Gemini(PaLM) Api account".
3. Si cambias el flujo directamente en n8n, expórtalo (⋯ → **Download**) y reemplaza el archivo aquí.

El archivo no guarda secretos: la clave de Gemini está en las credenciales de n8n, y la clave web de Firebase es pública (es la misma de `Config.js`).
