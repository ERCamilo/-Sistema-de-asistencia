# Voz: datos parciales, destino y corrección de tipo

SA conserva la respuesta original y separa la intención elegida por el usuario.
Nunca convierte automáticamente una grabación en una escritura de negocio.

## Reglas del cliente

- Solo nombre/número: continúa la búsqueda actual de empleado.
- Nombre/número y monto con acción desconocida: propone préstamo por defecto.
- Configuración → General → Voz permite Proponer préstamo, Proponer caja chica
  o Preguntar siempre. Sin datos suficientes para aplicar la preferencia,
  muestra «¿Qué quieres hacer?» y conserva transcripción/audio.
- `AMBIGUOUS_INTENT`, `UNCLEAR_INTENT` y `UNKNOWN_INTENT` también activan la
  recuperación, aunque el proveedor haya propuesto tentativamente una acción.
- Las negaciones y `MULTIPLE_ACTIONS` conservan su bloqueo. La selección de tipo
  no permite saltarlo. Se muestran texto y motivos para aclarar la instrucción.
- Coincidencias aproximadas o compartidas siguen exigiendo seleccionar empleado.
- Préstamo y Caja Chica tienen botones para cambiar de tipo antes de registrar.
  Comparten el monto actual; el resto de cada borrador se conserva al regresar
  (empleado, tasa, cobro, concepto, categoría, fecha y foto). La nota se traslada
  al crear el segundo borrador; posteriormente se conservan las ediciones
  propias de cada tipo. El nombre del empleado no se convierte en proveedor.
- Las fechas de cargo, creación y cobro conservan su significado. No se aplica
  una fecha de cobro como fecha de factura.
- Un registro confirmado o pendiente no permite cambiar de tipo con la misma
  grabación. Se mantienen las protecciones originales contra duplicados.
- Al registrar un préstamo se elimina el borrador de Caja Chica no utilizado,
  incluida su foto temporal, antes de aplicar la retención de audio del préstamo.

## Captura

La app guarda el audio localmente y luego lo envía al terminar. Mientras espera,
muestra procesamiento y Cancelar, sin requerir otro botón Enviar. El registro
del gasto/préstamo sigue necesitando revisión y confirmación.

Configuración → Tests ofrece **Revisar audio antes de enviar**, apagado por
defecto. Al activarlo se conserva el recorrido anterior de escuchar/Enviar.
Errores de captura o guardado local no disparan el envío automático; los fallos
de transporte conservan audio y borrador para reintentar con el mismo requestId.
Cancelar aborta la espera e impide aplicar respuestas tardías; una solicitud ya
enviada puede haber consumido procesamiento del proveedor.

## Contrato para el agente de n8n

La solicitud v1 no cambia. No enviar catálogos, alias ni IDs de empleados o
destinos a Gemini. n8n sigue validando identidad y solo extrae datos.

El prompt debe conservar los campos entendidos aunque falle la clasificación.
Añadir `result.extracted`, independiente de `intent`, con los siguientes campos
opcionales/nullable. No inventar valores; monto es número finito, otros campos
son texto. Si se reconoce una fecha, normalizar a YYYY-MM-DD; si es incierta,
dejar null y registrar el issue. Para una clasificación tentativa incierta,
usar `AMBIGUOUS_INTENT` o `UNCLEAR_INTENT`; para negación o varias operaciones,
mantener sus códigos separados y explícitos.

Ejemplo de «Carlo cinco mil» con ruido que impide entender la acción:

```json
{
  "ok": true,
  "schemaVersion": 1,
  "requestId": "EL_ID_RECIBIDO",
  "result": {
    "transcript": "Carlo cinco mil",
    "intent": "desconocida",
    "employee": { "spokenName": "Carlo", "spokenNumber": null },
    "loan": null,
    "pettyCash": null,
    "extracted": {
      "amount": 5000,
      "spokenName": "Carlo",
      "spokenNumber": null,
      "concept": null,
      "note": null,
      "date": null,
      "paidTo": null,
      "spokenCategory": null
    },
    "needsReview": true,
    "issues": [{ "code": "UNCLEAR_INTENT", "field": "intent", "message": "Se reconocieron nombre y monto, pero la acción no está clara." }]
  }
}
```

Mantener los campos habituales `employee`, `loan` y `pettyCash` según el
contrato anterior cuando se conoce la acción. El cliente nuevo también admite
extraer solo en `extracted` y completar el borrador, pero los clientes antiguos
necesitan sus estructuras habituales. No vaciar los datos por ruido ni inferir
que una intención dudosa significa negación. SA decide el destino según su
preferencia y los datos, usando sus validadores y operaciones existentes.

Si se reconocen datos específicos de préstamo, como tasa o cuotas, conservarlos
en `loan` también con intención desconocida: devolver su estructura completa
con null en los campos no reconocidos. SA combina el monto genérico con esos
datos, sin sustituir una tasa indicada por la tasa predeterminada. Expresiones
como «sin factura» o «no tengo factura» no son negaciones de registrar un gasto.

Esta entrega modifica SA; el prompt/workflow de voz debe actualizarlo el agente
de n8n. La validación local usa respuestas simuladas y datos de prueba.
