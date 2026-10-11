# Caja Chica por voz: contrato e integración propuesta

Estado: revisión del código terminada; extensión propuesta, aún sin soporte en
el cliente ni en el workflow. El endpoint de voz actual solo acepta las
intenciones anteriores. Coordinar el contrato con el agente de n8n antes de
activar la nueva intención. El registro de préstamos permanece sin cambios.

## Alcance acordado

El botón de voz existente prepara un gasto de Caja Chica, especialmente sin
factura o con comprobante manuscrito. El borrador tiene su propio modal, según
`design.md`, con monto destacado, concepto, fecha editable y nota opcional.
Puede adjuntarse una foto utilizando la captura actual de Caja Chica. Una foto
ilegible sigue siendo comprobante adjunto; el OCR no es requisito para guardar.

No se añade por ahora un segundo botón flotante global. Caja Chica ya tiene
accesos a cámara individual y por lotes; se conserva ese recorrido.

## Qué existe y se reutiliza

En `js/modules/features/pettycash/PettyCashUI.js`:

- `pcOpenForm('gasto')` inicia el formulario actual con un ID de movimiento.
- `pcPhotoNew(input)` conserva el original en IndexedDB, prepara la miniatura y
  marca el borrador con comprobante. La cámara usa un input de archivo
  `accept="image/*" capture="environment"`, sin `getUserMedia`: no requiere
  cambiar `camera=()` en `_headers` para este mecanismo.
- `pcRemovePhotoNew()` y `pcCancelForm()` eliminan el comprobante temporal.
- `pcScanReceipt()` usa el workflow OCR existente. Actualmente aplica los datos
  directamente al formulario y sus inputs; no llamarlo sin adaptación desde el
  modal de voz, porque reemplazaría valores dictados o editados.
- `pcSaveMovement()` valida el monto, asigna la numeración, crea el movimiento
  en su periodo, confirma el comprobante y llama a la persistencia habitual.
  El nuevo modal debe terminar en esta operación; no escribir directamente en
  `PettyCashStore` ni crear otra operación de registro.

En `PettyCashPhoto.js`, reutilizar `validateReceiptFile`,
`prepareReceiptForOcr`, `createReceiptPreview` y la conservación del original.
En `PettyCashReceiptOCR.js`, reutilizar `requestReceiptOcr`,
`normalizeReceiptOcr` y `applyReceiptOcrToForm`; la aplicación se realiza sobre
una copia propuesta, que el usuario acepta antes de modificar el borrador vivo.

El código actual lee campos DOM `pc-amount`, `pc-date`, `pc-desc`, `pc-tienda`,
`pc-cat` y `pc-receipt`, además de `state.pettyCash.form`. La integración debe
adaptar el formulario compartido y su presentación, evitando dos formularios
con esos mismos IDs simultáneamente. Captura, cancelación y guardado deben
seguir usando el mismo borrador. Proteger cualquier formulario previo mediante
la confirmación de reemplazo habitual.

## Destino, fechas y datos

- Mostrar caja/obra y periodo de Caja Chica en el modal. Usar la selección
  actual solo si sigue disponible y admite el registro; si falta, seleccionar
  antes de confirmar. No confundir un proyecto de SA con un proyecto de Caja
  Chica: verificar su vínculo existente, no inferir IDs por nombre.
- Al cambiar el destino conservar monto, concepto, fecha, nota y foto; volver
  a comprobar sesión y destino antes de guardar. Invalidar callbacks antiguos
  al cerrar, cambiar de cuenta o reemplazar el borrador.
- La fecha editable es `movement.date`, fecha del cargo. `createdAt` sigue
  siendo el timestamp real asignado por el registro original. No editarlo para
  simular la fecha de una factura.
- Si no se dictó una fecha, SA usa la fecha local de hoy según el contexto de
  la grabación. Si se dictó una fecha ambigua, mostrar el pendiente y no aplicar
  hoy silenciosamente. Conservar el contexto al reintentar la misma grabación.
- Concepto corresponde a `description`; proveedor, cuando se menciona, a
  `paidTo`. La categoría se resuelve contra el catálogo local existente. Si no
  se reconoce, ofrecer selección sin inventar una categoría ni asignar
  Materiales por accidente.
- La UI mantiene concepto y nota separados. Para reutilizar el registro sin
  añadir un campo financiero, serializar en `description` el concepto y,
  cuando exista, una línea `Nota: …`. Conservar ambos valores separados en el
  borrador para no concatenarlos de nuevo al reintentar. No usar `notas`, que
  actualmente pertenece a los datos fiscales del OCR.
- No inventar NCF, RNC, ITBIS, proveedor ni una factura. Sin foto y sin
  comprobante marcado, `hasReceipt=false`. Con foto adjunta, se aplica el
  comportamiento actual aunque el OCR falle.

## Extensión propuesta de respuesta para n8n

Mantener la solicitud v1 de audio: `schemaVersion`, `requestId`, `fileBase64`,
`mimeType`, `fileName`, `idToken`, `context`. No enviar empleados, categorías,
proyectos, periodos o IDs de negocio. Firebase ID token sigue siendo validado
por n8n y no se envía a Gemini. El flujo no escribe operaciones de negocio.

Proponer una extensión aditiva de respuesta v1 con intención
`registrar_gasto_caja_chica` y objeto `pettyCash`. Esta extensión requiere
actualizar la lista de intenciones y validación de SA: los clientes anteriores
la rechazan como respuesta incompatible, sin guardar datos.

Ejemplo para «Reporta en caja chica ochocientos pesos por transporte de
materiales, nota: viaje a la ferretería»:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "requestId": "EL_MISMO_REQUEST_ID_RECIBIDO",
  "result": {
    "transcript": "Reporta en caja chica ochocientos pesos por transporte de materiales, nota: viaje a la ferretería",
    "intent": "registrar_gasto_caja_chica",
    "employee": { "spokenName": null, "spokenNumber": null },
    "loan": null,
    "pettyCash": {
      "amount": 800,
      "concept": "Transporte de materiales",
      "date": null,
      "note": "Viaje a la ferretería",
      "spokenCategory": null,
      "paidTo": null
    },
    "needsReview": false,
    "issues": []
  }
}
```

`amount` es número finito o null; los demás campos son texto o null; `date`
es YYYY-MM-DD o null. n8n conserva null para datos ausentes; SA aplica únicamente
los defaults acordados. Categoría y proveedor solo se extraen si se mencionan.
No devolver valores de préstamo dentro de esta intención. Consultas de saldo,
reposiciones, negaciones y varias acciones no deben convertirse en un gasto.
Si faltan monto/concepto o hay dudas, usar `needsReview=true` con `issues`;
negación y acciones múltiples mantienen el bloqueo existente.

## Modal y recorrido

1. Pulsar/soltar, escuchar y enviar como en el flujo de voz actual.
2. Para esta intención, abrir el modal de Caja Chica sin resolver empleados.
   Mostrar concepto, monto, fecha, destino y chip «Sin comprobante» o miniatura.
   Proveedor, categoría, nota y transcripción pueden estar en detalles plegables.
3. «Agregar foto» llama al mecanismo actual. Capturar no registra el cargo ni
   inicia otra instrucción de voz. «Leer foto» consulta el OCR existente.
4. OCR genera una propuesta separada: mostrar campos encontrados y diferencias,
   y permitir aplicar los seleccionados. No sobrescribir ediciones. Un error
   conserva la foto y el borrador; permitir registrar sin lectura automática.
5. «Registrar gasto» confirma con la operación original de Caja Chica y abre
   su registro. El modal muestra el resultado real de persistencia; si una
   escritura falla, conservar el borrador sin insertar otra copia al reintentar.
6. Asociar el mismo ID de movimiento al mismo requestId, localmente y en
   metadatos del registro si hace falta, para recuperar el resultado de una
   confirmación previa. No tratar «Guardar» repetido como un cargo nuevo.
7. Cancelar no crea movimientos contables. El audio de gastos no se conserva
   después del registro; la política de 1–5 días permanece exclusiva de los
   préstamos. La foto conserva las reglas actuales de comprobantes.

## Entregas y responsables

1. Agente SA: contrato y parser, borrador sin empleados, modal independiente y
   destino, adaptación del formulario compartido, propuestas OCR, registro
   habitual e idempotencia. Mantenerlo detrás de Voz en Configuración → Tests.
2. Agente n8n: aceptar el contrato coordinado, extraer la nueva intención,
   preservar las anteriores, mantener identidad/CORS y no hacer escrituras.
   El workflow OCR sigue separado y con su contrato actual.
3. Agente SA: pruebas de contrato, campos ausentes, fechas, negación, cambio
   de destino, ediciones frente a OCR, foto ilegible, cancelación, errores de
   persistencia y reintentos sin duplicación.
4. Usuario: piloto con sesión real, gasto sin comprobante, factura manuscrita,
   foto legible y cambio de monto después del OCR.

Esta revisión no implementa ni activa la extensión. No se enviaron audios,
fotos o cargos reales a n8n para elaborar el plan.
