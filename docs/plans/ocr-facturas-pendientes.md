# Lector de facturas (OCR): mejoras pendientes

Anotado el 11 oct 2026 al diseñar la cámara de facturas nueva.

**12 oct 2026:** el flujo vive ahora en el repositorio, en `infra/n8n/caja-chica-ocr.json` (se importa en n8n). Sus nodos de código tienen pruebas en `js/tests/N8nReceiptOcrWorkflow.test.js`. Esta versión ya pide y devuelve `boxes` (ver Pendiente 1).

## Hoy

El flujo `caja-chica-ocr` (n8n, `APP_CONFIG.OCR_WEBHOOK_URL`) devuelve solo valores: emisor, RNC, NCF, cliente, subtotal, ITBIS, total, fecha, concepto, categoría e ítems (`normalizeReceiptOcr` en `PettyCashReceiptOCR.js`). No dice dónde está cada dato en la foto ni qué tan seguro está.

Por eso lo que se marca "por revisar" sale de revisiones locales y exactas (`PettyCashReceiptChecks.js`):

- subtotal + ITBIS = total;
- dígito verificador del RNC o cédula;
- formato del NCF (B/E) y que no esté repetido;
- fecha dentro del periodo.

## Pendiente 1: recuadros con bajo nivel de certeza

**Objetivo.** En la vista previa, marcar sobre la foto los datos dudosos.

1. Pedir al modelo (Gemini) que devuelva, por cada campo, su `box_2d` (`[y_min, x_min, y_max, x_max]`, normalizado 0–1000).
   - Desactivar el "thinking" para esa llamada: con razonamiento activo las cajas salen peor.
2. Calcular la certeza a partir de señales comprobables, no del porcentaje que da el modelo, que no es fiable:
   - las revisiones locales de arriba;
   - una segunda lectura que coincida o no con la primera;
   - si hace falta, Tesseract en el teléfono para ubicar la palabra exacta del total.
3. Contrato sugerido por campo: `{ value, box: [y0, x0, y1, x1] | null, certainty: 'high' | 'low' }`.
   - La app dibuja solo los recuadros con certeza `low`.

**La app ya está lista para recibir las posiciones.** Si la respuesta del lector trae `boxes`, se guardan en el gasto (`ocrBoxes`):

```json
"boxes": { "total": [880, 100, 910, 900], "fecha": [120, 600, 140, 900], "ncf": [...], "rncEmisor": [...], "itbis": [...], "subtotal": [...] }
```

Cada aviso de la vista previa con posición muestra "⌖ Ver en la foto". Al tocarlo, la foto se acerca a ese dato y lo marca. Sin `boxes`, el aviso funciona como hoy.

**Hecho en `infra/n8n/caja-chica-ocr.json` (paso 1, sin certeza todavía):**
- el prompt pide `boxes` con `total`, `subtotal`, `itbis`, `ncf`, `rnc_emisor` y `fecha`, solo sobre el valor, y `null` en PDF o varias páginas;
- "Parsear JSON" los pasa como `boxes` (con `rncEmisor`) y descarta los mal formados: fuera de 0–1000, invertidos o de otro largo;
- `maxOutputTokens` sube de 2048 a 4096 para que quepan;
- el "thinking" no se toca: `gemini-3.1-flash-lite-preview` lo trae bajo, y un parámetro que el modelo no acepte rompería la llamada. Si las cajas salen corridas, probarlo aparte.

**Siguiente:** probarlo con 10–20 fotos reales y ver con "⌖ Ver en la foto" si los recuadros caen bien. Si no bastan, el plan B es un servicio RapidOCR (los modelos de PaddleOCR en ONNX): Gemini dice de qué línea del OCR sacó cada dato, el recuadro sale exacto del OCR, y cuando el texto del OCR y el de Gemini no coinciden, el dato se marca como dudoso.

## Hecho: RNC de la empresa por proyecto

- Cada proyecto de caja chica guarda `companyRnc` y `consumerNoteMin` (botón 🧾 "Datos fiscales").
- Crédito fiscal (B01/E31) cuyo RNC del cliente no es el de la empresa: aviso `client-rnc`, con escribir el RNC o "Dejar así".
- Consumo (B02/E32): nota "no da crédito fiscal", en todas o solo desde un monto.
- El lector ya devolvía `rnc_cliente`; no hizo falta tocar n8n. Mejora posible: enviarle el RNC de la empresa para que lo busque a propósito.

## Hecho: totales con descuento, ITBIS incluido y propina

- El lector devuelve también `descuento`, `propina`, `exento` e `itbis_incluido`.
- `explainTotal` prueba la suma normal, el ITBIS incluido y la propina legal deducida antes de avisar; `receiptNotes` explica cómo cuadró.
