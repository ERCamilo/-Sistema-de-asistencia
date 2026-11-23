# Voz: notas y abonos

SA añade dos intenciones a la respuesta `schemaVersion: 1`: `crear_nota` y `registrar_abono`. Las respuestas de las acciones anteriores siguen siendo compatibles. n8n conserva autenticación, límites de audio y CORS; no escribe datos de negocio. La lista de empleados, IDs y pronunciaciones se resuelve solo en SA.

## Actualización del workflow — responsable: agente de n8n

El export recibido usa la ruta HTTP de audio estructurado a Gemini. Su `AI Agent` y los modelos conectados a ese agente no reciben entradas del flujo principal. Para estas dos acciones no hace falta conectarlos ni hacer otra llamada de IA.

1. Respalda el workflow actual. Prueba primero con su copia de desarrollo.
2. Cambia únicamente estos tres contenidos, conservando nodos, conexiones y credenciales:
   - `Orden para Gemini` → asignación **GeminiPromp**: [prompt.txt](prompt.txt).
   - `Preparar solicitud Gemini` → código: [prepare-request.js](prepare-request.js).
   - `Validar respuesta Gemini v1` → código: [validate-response.js](validate-response.js).
3. El export recibido conserva el webhook `sa-voice-v1-dev`. No actives otra copia con el mismo método/ruta. Para usar la copia importada, comprueba credenciales y CORS y elige una ruta de desarrollo distinta; o tras validar copia los tres contenidos al workflow actual. No cambies el origen de la vista previa estable.
4. El helper offline `node update-export.cjs entrada.json salida-nueva.json` aplica esos contenidos a una exportación, elimina `pinData` y la identidad del workflow y lo deja **inactivo**. Conserva el resto de configuración y referencias de credenciales. No contacta con n8n, Gemini ni los nodos Telegram existentes. Revisa y reconecta credenciales si se importa en otra instancia.

No guardes el export original en Git: incluye datos fijados de peticiones, que pueden contener audio y un ID token. El ejemplo de revisión generado no incluye esos datos. La actualización no aborda duración/codec en servidor, deduplicación durable del webhook, cuotas o autorización de organización pendientes del MVP.

## Contrato adicional

Además del envelope habitual (`ok`, `schemaVersion`, `requestId`, `result`), el resultado incorpora estos campos. Deben ser `null` para otras acciones. Los campos no oídos quedan `null`; SA aplica hoy como fecha inicial editable en su formulario.

```json
{
  "transcript": "Carlos abonó quinientos en efectivo, nota: anticipo",
  "intent": "registrar_abono",
  "employee": { "spokenName": "Carlos", "spokenNumber": null },
  "loan": null,
  "pettyCash": null,
  "extracted": null,
  "note": null,
  "payment": {
    "amount": 500,
    "date": null,
    "note": "anticipo",
    "spokenLoanNumber": null,
    "channel": "cash",
    "payrollDate": null
  },
  "needsReview": false,
  "issues": [],
  "evidence": {
    "employee": "Carlos",
    "principal": null,
    "interestRate": null,
    "installmentCount": null,
    "installmentFrequencyWeeks": null
  }
}
```

Para `crear_nota`, sustituye `payment` por `null` y usa `note: {"text":"no vino hoy", "date":null}`. `employee` sigue siendo literal. `note` (objeto de nueva nota) es distinto de `payment.note` (concepto del abono).

`channel`: `payroll`, `cash`, `transfer` o `null`. No inferir nómina si no se dijo. `spokenLoanNumber` es el número visible del préstamo, nunca un ID ni el número del empleado. Sin número, SA permite aplicar el abono a toda la cuenta con el reparto existente. Si se dijo un número no encontrado, exige elegir destino. Para nómina, el usuario debe elegir un período abierto; SA no calcula importes con Gemini.

El validador comprueba las **claves**, no la presencia de palabras como «saldo» en texto libre. «Anota que Carlos no vino» no cancela la creación de la nota. «No registres ese abono» devuelve `NEGATED_ACTION`; `MULTIPLE_ACTIONS` también bloquea el registro.

## Comportamiento de SA — responsable: agente de SA

- Resuelve localmente al empleado con el mismo selector, alias y niveles existentes.
- Abre el editor habitual de notas o el modal habitual de abonos. Transcripción, dudas, fecha y datos permanecen visibles/editables. El usuario confirma con el botón normal de guardar.
- «Cambiar empleado» vuelve al selector conservando el texto/importe. Un préstamo específico del empleado anterior no se traslada silenciosamente al nuevo.
- Notas: se **añaden** al texto más reciente del mismo empleado/día, conservando horas y presencia. No se revive una asistencia eliminada. Los cambios de obra/cuenta bloquean guardar desde una sesión anterior.
- Abonos: usa `recordAccountPayment` / `recordDirectPayment` y su asignación de interés/capital. La procedencia de voz es metadato; no se usa como `accountTxId` de un pago directo.
- La edición del formulario se conserva en el borrador local. Al guardar, el `requestId` y el UID quedan como procedencia para impedir repetir esa misma grabación en ese cliente. **No es una transacción ni un bloqueo distribuido**: dos dispositivos desconectados pueden generar operaciones concurrentes; no se promete deduplicación global.
- El audio de notas/abonos es temporal del borrador, se elimina al guardar; no se adjunta como evidencia ni se ofrece en el historial. Los audios de nuevos préstamos conservan su política actual. Los borradores siguen la caducidad local existente.

## Validación y siguiente paso

La suite prueba el contrato de los nodos Code y los formularios originales con datos ficticios, sin llamadas al proveedor. La comprobación real pendiente (agente de n8n + usuario): actualizar los tres nodos y probar desde la vista previa estable con sesión Firebase, voz real y un empleado ficticio. Revisar nota con negación interna, abono efectivo, abono sin canal, préstamo específico inexistente, empleado ambiguo y cancelar antes de guardar. Comprobar saldo y registro final una sola vez. Mantener producción hasta validar esa prueba; no hay despliegue/activación automática de n8n.
