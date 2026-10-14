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

## Cómo actualizar un flujo

1. Cambia el JSON aquí y corre sus pruebas: `npx jest js/tests/N8nReceiptOcrWorkflow.test.js`.
   Las pruebas ejecutan el código real de cada nodo "Code".
2. En n8n: abre el flujo → menú ⋯ → **Import from File** (o pega el JSON en el lienzo) y guarda.
   Las credenciales se enlazan por id. Si n8n pide elegirla, usa "Google Gemini(PaLM) Api account".
3. Si cambias el flujo directamente en n8n, expórtalo (⋯ → **Download**) y reemplaza el archivo aquí.

El archivo no guarda secretos: la clave de Gemini está en las credenciales de n8n, y la clave web de Firebase es pública (es la misma de `Config.js`).
