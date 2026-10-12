# Lector de facturas (OCR): mejoras pendientes

Anotado el 11 oct 2026 al diseñar la cámara de facturas nueva. **Aún no se cambia el flujo de n8n**; la cámara nueva funciona con lo que el lector devuelve hoy.

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

Cada aviso de la vista previa con posición muestra "⌖ Ver en la foto". Al tocarlo, la foto se acerca a ese dato y lo marca. Sin `boxes`, el aviso funciona como hoy. Solo falta que el flujo de n8n agregue ese campo.

Antes de cambiar el flujo, probarlo con 5–10 fotos reales de facturas.

## Pendiente 2: verificar el RNC de la compañía

**Objetivo.** Enviar en la petición al lector el RNC de la empresa (cliente) para que el flujo confirme si aparece en la factura.

- Una factura con crédito fiscal debe estar a nombre de la empresa.
- Respuesta sugerida: `{ clientRncFound: true | false | null }`.
- La app lo mostraría en la vista previa: "RNC de la empresa encontrado" o "No aparece el RNC de la empresa".
