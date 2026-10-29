# Asociación NFC: MVP sin Firebase y contrato v1

Seguimiento: [#320](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/320), contrato [#321](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/321), backend [#322](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/322).

## Estado real

El usuario confirmó lectura del mismo UID desde el Samsung y el ESP32, salvo separadores. Por indicación del usuario, este MVP funciona sin Firebase ni inicio de sesión. Permite activar asociaciones, leer desde el editor y consultar/registrar con el contrato siguiente. El usuario confirmó posteriormente la consulta y asociación real, el bloqueo de una tarjeta ocupada y el reintento tras una respuesta perdida en su instalación de n8n/Google Sheets. La evidencia y los criterios pendientes se conservan en [#326](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/326).

No basta con importar el cliente o responder HTTP 200 para registrar una tarjeta. El backend de referencia y sus instrucciones están en [EPS32-Asistencia](https://github.com/ERCamilo/EPS32-Asistencia/blob/main/apps_script/RegistroNFC.gs). La validación física es reportada por el usuario; los tests de navegador de SA usan un registro simulado y datos ficticios y no demuestran por sí solos persistencia real.

## Uso del cliente

1. En Chrome para Android, entrar a SA. No hace falta iniciar sesión ni autorizar el dominio en Firebase para usar NFC. Activar Pruebas tocando siete veces la versión al pie de Ajustes si la pestaña no aparece.
2. En Ajustes → Pruebas → Tarjetas NFC, activar **Asociación de tarjetas**. La preferencia se guarda solo en este navegador; por defecto está apagada.
3. Elegir **Test** (predeterminado), **Producción** o **Personalizado**. El personalizado requiere una URL HTTPS válida y pulsar Guardar URL. Se envían datos del empleado al destino elegido; usar el webhook previsto para estas pruebas.
4. Abrir un empleado guardado y pulsar Asociar tarjeta NFC. Un empleado nuevo se guarda primero. Se envían nombre y número guardados; los cambios pendientes del formulario no se pierden ni se confunden con datos guardados.
5. Pulsar Leer tarjeta y autorizar NFC. El mismo modal del diagnóstico muestra el empleado, UID y destino.
6. Si la consulta confirma disponible, revisar y pulsar Guardar asociación. Si ya es de ese empleado, se indica sin duplicar. Si pertenece a otro, no se permite reemplazar.
7. El éxito solo aparece tras una confirmación válida del servidor. Si se pierde la respuesta de un guardado, puede haberse aplicado: Reintentar conserva petición, identificador y destino. Cerrar el modal no revierte el servidor.

Ocultar Pruebas no desactiva la preferencia. Desactivar asociaciones cancela el lector y las solicitudes del cliente, y retira el acceso del editor sin reemplazar su borrador. La prueba de lectura sin empleado sigue disponible y no envía datos.

## Destinos

- Test: `https://n8n.erlin.do/webhook-test/ee769b3a-edb0-411e-8c3f-8ad22f7eeb4d`
- Producción: `https://n8n.erlin.do/webhook/ee769b3a-edb0-411e-8c3f-8ad22f7eeb4d`

En Test se necesita activar Listen for test event para cada ejecución según el comportamiento de n8n. Para una prueba completa se reciben consulta y asociación como operaciones separadas; puede ser necesario reactivar la escucha antes de guardar. Producción requiere flujo publicado/activo. No hay cambio automático de Test a Producción ni reintentos en segundo plano.

## Transporte sin Firebase

`POST`, `Content-Type: application/json`. Este piloto no envía `Authorization`, ID token, cookies ni UID de cuenta Firebase, y no espera a Google para leer, consultar o registrar. No se necesita cambiar dominios autorizados de Firebase para este flujo.

La configuración de activación/destino es local al navegador. Las preferencias anteriores por cuenta no se heredan: el piloto comienza apagado y en Test. Cambiar de obra, empresa, empleado, destino o reemplazar el editor invalida el trabajo pendiente. Los borrados de datos siguen cancelando operaciones.

El registro/hoja de destino lo determina la configuración del flujo n8n, no una identidad inventada del cliente. Empresa y obra son metadatos, no autenticación ni prueba de pertenencia. Para el MVP usar el registro de pruebas configurado en ese webhook. La autenticación y el aislamiento por cuenta mediante Firebase se integrarán después.

Configurar CORS/preflight para los orígenes de prueba, permitiendo POST, OPTIONS y Content-Type. Credenciales de Google Sheets/base de datos permanecen en n8n. SA sigue omitiendo caché y redirecciones y solo confirma las respuestas correlacionadas del contrato.

Al pasar de la vista previa al sitio principal, activar la opción y elegir el destino nuevamente: localStorage no se comparte entre dominios. Usar el mismo registro existente si ese es el configurado en n8n; el cambio de dominio no requiere otra hoja ni migrar tarjetas. Si CORS está restringido a la preview, añadir también el origen exacto del sitio principal en el webhook. Esto no es un dominio autorizado de Firebase.

## Petición

```json
{
  "schemaVersion": 1,
  "action": "consultar",
  "requestId": "uuid-de-esta-operacion",
  "cardUid": "0400ABCDEF1234",
  "employee": { "id": "emp-107", "number": "00107", "name": "Juan Pérez" },
  "context": { "companyName": "Contrutek", "projectId": "obra-1" },
  "source": "sa-web-nfc",
  "requestedAt": "2026-10-27T17:00:00Z"
}
```

Para registrar, `action` es `asociar` y tiene su propio requestId. Un reintento de ese registro conserva el mismo body, incluida la fecha solicitada, y la misma URL. `projectId` es null en datos legacy; es contexto y no decide qué registro/hoja abre el servidor.

El UID se conserva como texto hexadecimal mayúsculo, sin espacios ASCII/Unicode, dos puntos ni guiones, y con ceros iniciales. Para asociación RC522 se aceptan 4, 7 o 10 bytes. Rechazar caracteres arbitrarios, UID vacío o incompleto. Número de empleado también es texto. No enviar salarios, préstamos, fotos ni todo el respaldo.

## Respuestas de consulta

Siempre devolver schemaVersion, requestId y cardUid normalizado correspondientes a la petición. Nunca responder con el UID de otra solicitud.

Disponible:
```json
{"schemaVersion":1,"ok":true,"requestId":"uuid-de-esta-operacion","cardUid":"0400ABCDEF1234","status":"disponible","employeeId":null}
```

Mismo empleado:
```json
{"schemaVersion":1,"ok":true,"requestId":"uuid-de-esta-operacion","cardUid":"0400ABCDEF1234","status":"mismo_empleado","employeeId":"emp-107"}
```

Otro empleado del registro de este webhook:
```json
{"schemaVersion":1,"ok":true,"requestId":"uuid-de-esta-operacion","cardUid":"0400ABCDEF1234","status":"otro_empleado","employeeId":"emp-999"}
```

No es necesario devolver información personal del otro empleado; SA muestra que la tarjeta está ocupada. El servidor trabaja con la hoja/registro configurado para este piloto.

## Confirmación de asociación

Después de persistir, HTTP 200 o 201:
```json
{"schemaVersion":1,"ok":true,"requestId":"uuid-del-registro","cardUid":"0400ABCDEF1234","status":"registrada","employeeId":"emp-107","registeredAt":"2026-10-27T17:00:01Z"}
```

Si ya estaba registrada para ese empleado, `status: mismo_empleado`, con el mismo employeeId y registeredAt original. Para una asociación, la fecha del servidor es obligatoria. Un `{ok:true}` genérico, HTML, datos incompletos o IDs diferentes no se aceptan como confirmación.

Errores: HTTP 400/422 para payload inválido, 401/403 si el destino rechaza acceso (no disparan un login de Firebase), 409 para asociación incompatible/requestId reutilizado con otros datos, 5xx para fallos de persistencia. No usar una respuesta exitosa cuando Sheets/base de datos falla. El cliente no imprime cuerpos técnicos con posibles credenciales.

## Reglas del registro

- Clave única `(registro configurado en el webhook, cardUid)`. Validar y bloquear la asociación en una operación atómica, no solamente consultar y luego append en Sheets.
- El registro de referencia rechaza una segunda tarjeta distinta para el mismo empleado. El cliente no reasigna ni elimina tarjetas existentes; cualquier asociación incompatible se rechaza con HTTP 409.
- Idempotencia por `(registro, requestId)`: mismo contenido devuelve la confirmación original; otro contenido se rechaza. No crear otra fila por una respuesta perdida.
- Conservar la fecha definitiva del primer guardado. No reescribir asistencia/historial al asociar una tarjeta.
- Probar concurrencia real. El usuario aportó un ensayo integrado con una ganadora, una respuesta 409 y una sola asociación; revisar el solapamiento de ejecuciones si n8n impone una cola. Una cola simulada en los tests del cliente no demuestra unicidad del backend.

## Verificación y siguiente paso

Cliente: `npm test -- --runInBand js/tests/NfcCore.test.js js/tests/NfcIntegration.test.js js/tests/NfcReadTest.test.js` y `CHROMIUM_PATH=/usr/bin/chromium npm run test:nfc-read`.

La integración a main publica el mismo cliente validado en la rama de prueba. Comprobar de nuevo la consulta desde ese dominio, el destino elegido y CORS. Los pendientes de aceptación permanecen en #326; no dar por probadas la autorización futura de Firebase ni la importación de asistencia a SA. La gestión de correcciones históricas desde un menú de SA se planifica aparte.
