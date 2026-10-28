# Asociación NFC: cliente SA y contrato v1

Seguimiento: [#320](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/320), contrato [#321](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/321), backend [#322](https://github.com/ERCamilo/-Sistema-de-asistencia/issues/322).

## Estado real

El usuario confirmó lectura del mismo UID desde el Samsung y el ESP32, salvo separadores. Este cliente permite activar asociaciones, leer desde el editor y consultar/registrar con el contrato siguiente. **El usuario confirmó que el flujo n8n actual solo recibe datos. No se considera implementado ni probado el registro real en la base de datos.**

No basta con importar el cliente o responder HTTP 200 para registrar una tarjeta. La disponibilidad, unicidad, autenticación, persistencia y confirmación deben implementarse en n8n/almacenamiento antes de completar la prueba de extremo a extremo. Los tests de navegador usan un registro simulado y datos ficticios.

## Uso del cliente

1. En Chrome para Android, entrar a SA e iniciar sesión. Activar Pruebas tocando siete veces la versión al pie de Ajustes si la pestaña no aparece.
2. En Ajustes → Pruebas → Tarjetas NFC, activar **Asociación de tarjetas**. La preferencia se guarda solo para esta cuenta y navegador; por defecto está apagada.
3. Elegir **Test** (predeterminado), **Producción** o **Personalizado**. El personalizado requiere una URL HTTPS válida y pulsar Guardar URL. El destino recibe la identidad de la sesión, así que debe ser un servidor controlado por el usuario. No incluir tokens en la URL.
4. Abrir un empleado guardado y pulsar Asociar tarjeta NFC. Un empleado nuevo se guarda primero. Se envían nombre y número guardados; los cambios pendientes del formulario no se pierden ni se confunden con datos guardados.
5. Pulsar Leer tarjeta y autorizar NFC. El mismo modal del diagnóstico muestra el empleado, UID y destino.
6. Si la consulta confirma disponible, revisar y pulsar Guardar asociación. Si ya es de ese empleado, se indica sin duplicar. Si pertenece a otro, no se permite reemplazar.
7. El éxito solo aparece tras una confirmación válida del servidor. Si se pierde la respuesta de un guardado, puede haberse aplicado: Reintentar conserva petición, identificador y destino. Cerrar el modal no revierte el servidor.

Ocultar Pruebas no desactiva la preferencia. Desactivar asociaciones cancela el lector y las solicitudes del cliente, y retira el acceso del editor sin reemplazar su borrador. La prueba de lectura sin empleado sigue disponible y no envía datos.

## Destinos

- Test: `https://n8n.erlin.do/webhook-test/ee769b3a-edb0-411e-8c3f-8ad22f7eeb4d`
- Producción: `https://n8n.erlin.do/webhook/ee769b3a-edb0-411e-8c3f-8ad22f7eeb4d`

En Test se necesita activar Listen for test event para cada ejecución según el comportamiento de n8n. Para una prueba completa se reciben consulta y asociación como operaciones separadas; puede ser necesario reactivar la escucha antes de guardar. Producción requiere flujo publicado/activo. No hay cambio automático de Test a Producción ni reintentos en segundo plano.

## Transporte e identidad

`POST`, `Content-Type: application/json`, `Authorization: Bearer <Firebase ID token de la sesión>`. SA omite cookies, redirecciones y caché. El token se envía solo en el header, no en cuerpo, preferencias, errores o diagnóstico copiado.

El backend debe verificar el token para **el proyecto Firebase configurado en el servidor** y obtener el UID autenticado. No confiar en `context.ownerUid`, en decodificar un JWT sin verificar su firma ni en una clave de proyecto recibida del cliente. Se puede usar el SDK Admin; otra opción es verificar el ID token mediante `accounts:lookup` de Identity Toolkit con la API key del proyecto esperado, desde el servidor, y comparar el `localId` devuelto con la cuenta solicitada.

Configurar CORS/preflight en el webhook para los orígenes SA autorizados, permitiendo POST, OPTIONS y headers Content-Type/Authorization. Revisar la retención/redacción de ejecuciones en n8n para no guardar tokens en logs. Credenciales de Google/almacenamiento solo en el servidor.

## Petición

```json
{
  "schemaVersion": 1,
  "action": "consultar",
  "requestId": "uuid-de-esta-operacion",
  "cardUid": "0400ABCDEF1234",
  "employee": { "id": "emp-107", "number": "00107", "name": "Juan Pérez" },
  "context": { "ownerUid": "uid-cuenta-autenticada", "companyName": "Contrutek", "projectId": "obra-1" },
  "source": "sa-web-nfc",
  "requestedAt": "2026-10-27T17:00:00Z"
}
```

Para registrar, `action` es `asociar` y tiene su propio requestId. Un reintento de ese registro conserva el mismo body, incluida la fecha solicitada, y la misma URL. Renovar el ID token no modifica el body. `projectId` es null en datos legacy; es contexto y no forma parte de la unicidad del UID por cuenta.

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

Otro empleado de la misma cuenta autorizada:
```json
{"schemaVersion":1,"ok":true,"requestId":"uuid-de-esta-operacion","cardUid":"0400ABCDEF1234","status":"otro_empleado","employeeId":"emp-999"}
```

No es necesario devolver información personal del otro empleado; SA muestra que la tarjeta está ocupada. Una tarjeta registrada en otra cuenta no permite consultar sus datos.

## Confirmación de asociación

Después de persistir, HTTP 200 o 201:
```json
{"schemaVersion":1,"ok":true,"requestId":"uuid-del-registro","cardUid":"0400ABCDEF1234","status":"registrada","employeeId":"emp-107","registeredAt":"2026-10-27T17:00:01Z"}
```

Si ya estaba registrada para ese empleado, `status: mismo_empleado`, con el mismo employeeId y registeredAt original. Para una asociación, la fecha del servidor es obligatoria. Un `{ok:true}` genérico, HTML, datos incompletos o IDs diferentes no se aceptan como confirmación.

Errores: HTTP 400/422 para payload inválido, 401/403 para acceso, 409 para asociación incompatible/requestId reutilizado con otros datos, 5xx para fallos de persistencia. No usar una respuesta exitosa cuando Sheets/base de datos falla. El cliente no imprime cuerpos técnicos con posibles credenciales.

## Reglas del registro pendientes de implementar en #322

- Clave única `(cuenta autenticada, cardUid)`. Validar y bloquear la asociación en una operación atómica, no solamente consultar y luego append en Sheets.
- Resolver explícitamente la política de una o varias tarjetas por empleado antes de publicar el backend. El cliente no reasigna ni elimina tarjetas existentes; cualquier asociación incompatible se rechaza con HTTP 409.
- Idempotencia por `(cuenta, requestId)`: mismo contenido devuelve la confirmación original; otro contenido se rechaza. No crear otra fila por una respuesta perdida.
- Conservar la fecha definitiva del primer guardado. No reescribir asistencia/historial al asociar una tarjeta.
- Probar concurrencia real. Una cola simulada en los tests del cliente no demuestra unicidad del backend.

## Verificación y siguiente paso

Cliente: `npm test -- --runInBand js/tests/NfcCore.test.js js/tests/NfcIntegration.test.js js/tests/NfcReadTest.test.js` y `CHROMIUM_PATH=/usr/bin/chromium npm run test:nfc-read`.

Backend pendiente: implementar primero consultar y asociar con estas respuestas, validación de identidad y persistencia; después realizar lectura física y registro de un empleado ficticio en Test, verificar el dato guardado y repetir sin duplicados. No marcar #322/#326 completos con pruebas simuladas del cliente.
