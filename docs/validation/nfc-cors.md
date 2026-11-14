# NFC — comprobación independiente de CORS

Seguimiento: SA #322 (registro n8n) y SA #326 (aceptación).

El comprobador es de solo lectura: hace exclusivamente solicitudes HTTP OPTIONS. No hace POST, no envía UID, datos de empleados, credenciales ni modifica la hoja o las asociaciones NFC.

## Comando

    node scripts/check-nfc-cors.cjs --live

Lee el NFC_ENDPOINT directamente de js/modules/features/nfc/NfcCore.js y solo permite consultar HTTPS en n8n.erlin.do/webhook/.... Verifica los orígenes principal (https://sistema-de-asistencia.pages.dev) y preview (https://test-nfc-web-reader.sistema-de-asistencia.pages.dev), y exige que uno sintético no se autorice (https://untrusted-nfc-cors.invalid).

Para los dos orígenes permitidos exige HTTP 2xx, Access-Control-Allow-Origin idéntico al origen solicitado, método POST y encabezado content-type. Para el origen desconocido rechaza '*' o la reflexión de ese origen. Si falta Vary: Origin emite advertencia sobre cachés, no un fallo automático.

## Resultado verificado — 2026-11-07

En una auditoría inicial el preflight de producción devolvía solo el origen de la preview NFC, incluso ante una solicitud desde el dominio principal. En la nueva revisión el comportamiento cambió sin intervención de este equipo: los tres orígenes dieron el resultado esperado en tres rondas sucesivas de comprobación.

| Origen | HTTP | Access-Control-Allow-Origin | Veredicto |
| --- | --- | --- | --- |
| Principal | 204 | Principal | PASS |
| Preview NFC | 204 | Preview NFC | PASS |
| Dominio desconocido | 204 | Preview NFC (no coincide) | PASS: denegado al navegador |

Todas las respuestas incluyeron Access-Control-Allow-Methods: OPTIONS, POST y Access-Control-Allow-Headers: content-type. Cloudflare indicó cf-cache-status: DYNAMIC. No se observó Vary: Origin; revisar la caché si se habilita almacenamiento de respuestas OPTIONS.

**No afirmar que el equipo corrigió CORS:** no se tuvo acceso autenticado a n8n y no se alteraron sus workflows. GET / a n8n.erlin.do redirige a Cloudflare Access. El servidor a2 no aloja n8n ni tiene N8N_API_KEY en su entorno. No se inspeccionó la versión/configuración actual.

## Qué falta para certificar #322/#326

1. Acceso autorizado a la administración del workflow de asociación (diferente del workflow de marcaciones ESP32), con respaldo previo y versión comprobada. No modificar los orígenes ahora que el preflight pasa.
2. Con datos ficticios y autorización, verificar también los encabezados CORS del POST real y que el webhook solo confirme éxito después de persistir el registro.
3. Reabrir la app y consultar la misma tarjeta; confirmar que no se duplica el registro y que un segundo empleado no puede ocupar la tarjeta.
4. Probar la lectura en Samsung con permisos NFC y flujo controlado, sin alterar asociaciones existentes.

## Notas técnicas

n8n documenta Allowed Origins (CORS) como lista de URLs separadas por coma. Algunas versiones anteriores podían devolver siempre el primer origen; ese bug se reportó como corregido en n8n 1.109.0. Sin conocer la versión instalada no atribuir esta causa. CORS no es autenticación ni reemplaza controles de acceso y validación de requests.

Documentación n8n: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
Reporte histórico: https://github.com/n8n-io/n8n/issues/18528
