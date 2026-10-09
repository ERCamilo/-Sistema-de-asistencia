# MVP de voz: SA y Gemini/n8n

Implementación del cliente de voz. Las operaciones financieras y de asistencia
conservan sus reglas y módulos existentes. n8n solo devuelve datos extraídos.

## Uso

Con una sesión Firebase activa, abrir **Voz · MVP**, grabar y detener. El audio
se conserva en IndexedDB (`sa-voice-mvp-v1`) por cuenta y proyecto. En
**Configuración de la prueba**, se muestra la URL ya configurada del workflow separado:
`http://100.91.16.14:5678/webhook/sa-voice-v1-dev`.
El navegador debe tener acceso a Tailscale. La excepción HTTP admite únicamente
esa URL exacta desde `http://127.0.0.1:8080`; no acepta localhost, otro puerto,
otra ruta ni orígenes HTTPS. Fuera de esta excepción, el transporte requiere
HTTPS. No se reutiliza el endpoint OCR. Una URL personalizada previamente guardada
por la cuenta sigue teniendo prioridad; puede borrarse para usar el valor configurado.
El ajuste de URL es local, por cuenta, y no admite credenciales.

Procesar devuelve transcripción, intención y campos editables. Seleccionar un
empleado entre posibles coincidencias o todos los del proyecto. La variante se
aprende únicamente con **Guardar esta coincidencia**. Pueden eliminarse los alias
locales del empleado. No se envían lista, IDs, alias, saldos ni el borrador editado
al webhook. Los empleados ficticios están en `js/tests/fixtures/voice-employees.js`;
no se insertan automáticamente en los datos reales.

Las proyecciones usan `getTotalDue`, `generateInstallmentSchedule` y
`getAccountSummary`. **Revisar en el formulario habitual** traslada los campos
completos y validados al formulario existente. No registra un préstamo: el usuario
lo guarda por el flujo normal, incluidos detección de duplicados y persistencia.
Los botones Perfil/Asistencia/Préstamos solo navegan. Una instrucción negada o no
reconocida no ofrece una acción confirmable; necesita una grabación nueva.

## Contrato y errores

Solicitud v1: schemaVersion, requestId, fileBase64, mimeType, fileName, idToken,
context (language, timeZone, localDate). Contexto e identidad se crean al grabar y
se conservan al reintentar; un token renovado no cambia requestId. La respuesta
requiere ok=true, schemaVersion=1, el mismo requestId y el result especificado.
Tipos e intención se validan antes de crear el borrador; faltantes son null.

Un 401 renueva el token una vez. 403 informa acceso denegado; 429 conserva y respeta
Retry-After (30 segundos si no está presente). Errores HTTP/red/timeout conservan
audio y ediciones; reintento manual. El timeout del cliente es 90 segundos. Un
resultado nuevo tras ediciones manuales queda pendiente: aplicarlo exige confirmar
explícitamente el reemplazo. needsReview/issues exigen revisión y los campos
obligatorios deben completarse antes del traslado al formulario.

## Grabación y conservación

MediaRecorder negocia formatos soportados y conserva el MIME efectivo. El límite
es 60 segundos y 10 MiB; el temporizador solicita parada un poco antes de 60 s y
un audio que exceda el límite no se envía. La pestaña puede retrasar temporizadores,
por lo que el servidor también debe validar duración/bytes reales. El micrófono
se libera al detener, cancelar, fallar o cambiar de cuenta. Se pueden reproducir,
reabrir tras recargar y borrar grabaciones manualmente. Borrar todos los datos locales de SA también elimina audios, alias y endpoint
del MVP. No hay borrado automático
por días en este MVP ni sincronización o backup de audios/alias; no prometer
conservación si el usuario/navegador elimina el almacenamiento del origen.

## Despliegue pendiente

Una vista previa pública de Cloudflare Pages permite abrir SA y grabar desde
un origen HTTPS. El endpoint HTTP de Tailscale configurado para desarrollo
no funciona desde esa vista previa: el navegador bloquea contenido mixto y
el cliente restringe esa excepción a `http://127.0.0.1:8080`. Para procesar
voz desde la vista previa, configurar en **Configuración de la prueba** un
endpoint HTTPS accesible desde el dispositivo y autorizar en n8n su origen
exacto en CORS (OPTIONS y respuestas POST, incluidos errores). La autenticación
Firebase sigue siendo obligatoria. No sustituirlo por el dominio de n8n
bloqueado por Cloudflare Access ni incluir secretos de acceso en el cliente.
El dominio de vista previa también debe estar autorizado en Firebase si el
método de inicio de sesión usado lo requiere. El almacenamiento local pertenece
a cada origen: los audios locales del desarrollo no aparecen en la vista previa.

Origen comprobado: `http://127.0.0.1:8080`; `localhost:8080` es distinto. No hay
dominio HTTPS móvil confirmado. Cloudflare Pages permite microphone=(self),
manteniendo cámara/geolocalización deshabilitadas. El backend debe autorizar
exactamente los orígenes; Cloudflare Access debe permitir OPTIONS sin token
Firebase y sin procesar audio. POST conserva autenticación y autorización.
No colocar secretos de Cloudflare/Gemini en el navegador.

Según la confirmación del responsable de n8n, SA Voice está activo, la preflight
por Tailscale devuelve 204 y un POST vacío devuelve JSON 400. Esa comprobación
externa no valida una sesión Firebase ni el procesamiento completo desde SA.
Desde este entorno cloud, el proxy respondió 403 «Domain forbidden» al endpoint;
no atribuir esa respuesta a n8n ni afirmar que Tailscale está desconectado.

Pendientes: grabación real desde SA con una sesión Firebase de desarrollo y
Tailscale, prueba de Safari/iPhone, validación de duración/codec en servidor,
deduplicación durable, rate limiting y autorización por organización. Para
producción sigue pendiente un endpoint HTTPS apropiado.

## Verificación

Jest cubre contrato, rechazo de resultados malformados, aislamiento de cuenta,
MIME negociado, cancelación y límites, renovación 401, backoff 429, selección
ambigua y números con ceros. Prueba Chromium con micrófono sintético cubre audio
real, IndexedDB tras recarga, borrador/alias, negación y reintento sin perder
ediciones. En Chromium se capturó `audio/webm;codecs=opus`; Safari/iPhone sigue
pendiente. La página de prueba aislada carga los módulos reales con adaptadores
de prueba y un webhook simulado, no una sesión Firebase o Gemini reales. Pruebas de transporte usan webhook simulado; no prueban Gemini ni
Cloudflare Access reales. Se ejecutan también guard de estado y suite de SA.
