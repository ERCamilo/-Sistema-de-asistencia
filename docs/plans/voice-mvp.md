# MVP de voz: SA y Gemini/n8n

Implementación del cliente de voz. Las operaciones financieras y de asistencia
conservan sus reglas y módulos existentes. n8n solo devuelve datos extraídos.

## Uso

Activar **Configuración → Tests → Activar botón de voz · MVP**. Está apagado
por defecto; el interruptor se guarda y sincroniza como los demás ajustes.
El botón aparece con una sesión activa. Desactivar la opción cierra el panel
y cancela la grabación en curso. Descarta el borrador pendiente y conserva los audios de préstamos dentro de su plazo y los alias locales.

Con una sesión Firebase activa, mantener pulsado el botón flotante y soltar para terminar. Las ondas reaccionan al volumen; movimiento reducido usa un indicador estático. Con teclado o tecnología asistiva, pulsar inicia y la siguiente pulsación detiene. Una liberación durante el permiso de micrófono cancela la captura pendiente. El audio
se conserva en IndexedDB (`sa-voice-mvp-v1`) por cuenta y proyecto. En
**Configuración de la prueba**, se muestra la URL ya configurada del workflow separado:
`https://n8n.erlin.do/webhook/sa-voice-v1-dev`.
La vista previa está en `https://test-sa-voice-mvp.sistema-de-asistencia.pages.dev`.
Para una prueba local por Tailscale, la excepción HTTP admite únicamente
`http://100.91.16.14:5678/webhook/sa-voice-v1-dev` desde `http://127.0.0.1:8080`; no acepta localhost, otro puerto,
otra ruta ni orígenes HTTPS. Fuera de esta excepción, el transporte requiere
HTTPS. No se reutiliza el endpoint OCR. Una URL personalizada previamente guardada
por la cuenta sigue teniendo prioridad; **Usar URL predeterminada** permite restaurarla.
En un origen HTTPS se sustituye la preferencia antigua HTTP de Tailscale por la
URL predeterminada HTTPS, sin borrar audios, alias ni otras URL personalizadas.
El ajuste de URL es local, por cuenta, y no admite credenciales.

Las vistas de audio, selección de empleado y revisión del préstamo son componentes
separados (`VoiceAudioView`, `VoiceEmployeeView`, `VoiceLoanView`). Comparten el
shell visual y transiciones de `design.md`, sin mostrar todas las etapas como una
lista. El rediseño aprobado usa negro/gris y acentos amarillos; el préstamo tiene
fondo amarillo, identidad del empleado en negro, monto destacado, tasa y cuotas,
nómina de cobro, nota opcional y proyección total/saldo. Las opciones secundarias
están plegadas. Cambiar empleado conserva los datos del préstamo. Las advertencias
se muestran en los campos o en el selector de empleado, sin una etapa independiente
de “revisar instrucción”; el reconocimiento que requiere revisión sigue bloqueando
la confirmación hasta que el usuario revise los datos. El reproductor permite
reproducir/pausar y mover la posición, con una forma de onda basada en el volumen
capturado (sin muestras disponibles se muestra una línea neutra).
El audio ofrece Enviar y Cancelar, con Volver a grabar y configuración en un
desplegable. Solo Enviar llama a n8n. En Audio guardado, las tarjetas de 0–5 días
usan los mismos ajustes existentes; desactivar la conservación requiere confirmar
la eliminación de audios de préstamos de la cuenta en este navegador.

Una coincidencia exacta y única de nombre, número o alias continúa directamente.
Las coincidencias compartidas, aproximadas y los conflictos entre nombre y número
exigen selección. El selector muestra tarjetas de sugerencias y “Ver todos”; el resto
se ordena por número. Escribir en el buscador incluye automáticamente toda la lista,
sin repetir candidatos. Conserva alfabetos no latinos. Recordar una pronunciación
es opcional y nunca está marcado por defecto. Los alias son locales al proyecto y cuenta.
Decir solo el nombre o pedir buscarlo debe producir `intent: buscar_empleado` en
n8n (sin cambios al contrato v1). Después de resolver una búsqueda, SA abre la vista
diaria de Asistencia, ubica la tarjeta y usa la misma acción que tocarla: panel
flotante en móvil o detalle lateral en escritorio. Si los filtros ocultan al
empleado, se limpian los filtros de búsqueda, posición, líder y estado. Se conserva
la fecha seleccionada; si el empleado no está visible en esa fecha, se abre su
panel y se informa esa limitación. No se registra asistencia. Se elimina el audio
de la búsqueda. Negaciones, acciones desconocidas y ambigüedad conservan sus bloqueos.
Una negación o acciones múltiples nunca ofrecen registro de préstamo.

## Comparación de nombres y enseñanza

SA combina similitud de Levenshtein (75 %) y Jaro-Winkler (25 %). Compara el nombre
completo, sus palabras y las variantes confirmadas; para consultas con varias
palabras también alinea tokens uno a uno, ponderando las partes menos comunes en
el listado local. Estas puntuaciones son parecido de escritura, no probabilidades
ni IPA. Mantiene coincidencias exactas de nombre/alias y número, incluidos alfabetos
no latinos y nombres completos en distinto orden.

La búsqueda usa niveles inclusivos ≥60 %, ≥50 %, ≥40 %. Solo baja si el nivel
anterior no devuelve candidatos. El selector indica cuándo amplió el nivel.
Las aproximaciones nunca continúan automáticamente; una variante compartida con
otro alias o nombre exacto exige selección. Debe evaluarse con ejemplos reales de
la obra antes de afirmar una mejora de precisión general.

Con Voz habilitada en Configuración → Tests, el formulario de Personal muestra
**Enseñar nombre por voz**. Los empleados nuevos deben guardarse primero. El panel
permite grabar cómo lo llaman, enviar el audio al mismo workflow v1, revisar/editar
el nombre entendido y confirmar una variante. También permite añadir una variante
escrita, ver cuántas variantes distintas hay y eliminar variantes individuales.
Gemini no recibe la lista ni el ID del empleado; tampoco se entrena el modelo.
La asociación ocurre solo en SA después de la confirmación.

Las variantes se deduplican y conservan en IndexedDB por cuenta/proyecto/origen,
con el límite existente de 50 por empleado; no se incluyen en sincronización ni
backups de negocio. El audio de enseñanza es un borrador temporal: se elimina al
confirmar o cancelar. Si el navegador se cierra abruptamente, se aplica la limpieza
existente de borradores a las 24 horas cuando SA vuelva a abrirse. Los audios de
enseñanza no se restauran como instrucciones de búsqueda o préstamo.

En el selector de empleado de una búsqueda normal, **Recordar «variante»** está
visible y desmarcado por defecto. Solo aprende al marcarlo y seleccionar a la
persona. Una selección automática no enseña alias. Las variantes que coinciden
con el nombre/alias de otra persona mantienen la ambigüedad; el panel de enseñanza
advierte el conflicto. No hay todavía un asistente de grabación por lotes.

No se envían lista, IDs, alias, saldos ni el borrador editado
al webhook. Los empleados ficticios están en `js/tests/fixtures/voice-employees.js`;
no se insertan automáticamente en los datos reales.

Las proyecciones usan `getTotalDue`, `generateInstallmentSchedule` y
`getAccountSummary`. La tarjeta propone 20 % y un pago único si la extracción
no especifica otros valores; monto ausente sigue pendiente. Usa el calendario
de nómina de la obra activa y elige el primer día de pago estrictamente posterior
a hoy. La fecha del préstamo y la nómina de cobro son campos separados. No se
pregunta frecuencia semanal; las cuotas explícitas conservan las reglas del
sistema de préstamos, y sus fechas se muestran en la proyección.

**Configuración → Tests → Usar la tasa anterior del empleado** permite tomar
su última tasa válida cuando la voz no indicó interés. Está apagado por defecto;
sin historial se usa 20 %. Una tasa indicada o editada, incluso 0 %, tiene prioridad.
La tarjeta permite aplicar explícitamente cualquier tasa anterior válida. Al cambiar de empleado se conservan TODOS los campos del borrador, incluida la tasa; se recalcula solo su saldo/proyección. La preferencia de tasa anterior se aplica a la selección inicial, nunca a un cambio posterior.

**Agregar préstamo** es la confirmación final. Reutiliza el mismo
registro de la cuenta actual de préstamos: validación, numeración, revisión de
duplicados y persistencia. Luego abre esa cuenta en la pestaña Préstamos. n8n
sigue sin escrituras. La nota siempre incluye `voice - el DD/MM/AAAA a las HH:mm`
con la fecha/hora de la grabación en su zona horaria, más el concepto opcional.
Se guarda `voiceRequestId` en el préstamo y el ID del préstamo en el audio local
para impedir volver a registrar la misma grabación. No confirma automáticamente
una posible duplicación. Si faltan empleado, monto o una nómina futura para un
pago único, el registro se bloquea; las ediciones se conservan.
Perfil/Asistencia/Préstamos solo navegan y eliminan la grabación de búsqueda. Una instrucción negada o no
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
se libera al detener, cancelar, fallar, ocultar la pestaña o cambiar de cuenta.
Los audios cancelados, reemplazados y de búsquedas finalizadas se eliminan. Un
error conserva la grabación para reintentar; los borradores abandonados se limpian
a las 24 horas, sin extender el plazo por reintentos. Borrar todos los datos
locales también elimina audio, alias y endpoint del MVP.

### Audio de préstamos

Configuración → Tests permite conservar audio (predeterminado: sí), elegir de
1 a 5 días desde REGISTRAR el préstamo (predeterminado: 5) o no conservarlo.
Desactivar conservación elimina los audios de préstamos existentes de la cuenta;
no elimina un audio pendiente de enviar mientras se ofrece reintentar. Acortar
el plazo aplica a los audios existentes; alargarlo no extiende una fecha que ya
se acortó ni recupera datos borrados. En el detalle del préstamo hay “Escuchar
audio”; al vencer, eliminarse o faltar en otro navegador queda “Audio no disponible”.
La consulta valida cuenta, proyecto, empleado e ID del préstamo.

Hay un presupuesto de 50 MiB para los audios del navegador: aviso al 80 %, o
cuando la estimación de almacenamiento del navegador supera el 85 %. Esta cuota
estimada incluye otros datos del origen; no equivale a RAM ni espacio exclusivo
de voz. Si el presupuesto se supera al registrar, no se conserva el nuevo audio.
Si falla su guardado después del registro, se informa el fallo y no se registra
el préstamo otra vez: la idempotencia conserva `voiceRequestId` en el préstamo.
Configuración también permite eliminar los audios de la cuenta sin borrar préstamos.

La limpieza se ejecuta al iniciar/iniciar sesión, al cambiar ajustes y cada cinco
minutos mientras SA esté abierta. No se garantiza eliminación puntual con la app
cerrada. No hay sincronización ni backup de audio/alias: pertenecen al navegador y
origen, y pueden perderse si se elimina ese almacenamiento. Las grabaciones son
instrucciones del operador, no aceptación contractual del trabajador.

## Despliegue y comprobaciones pendientes

La vista previa pública de Cloudflare Pages usa el endpoint HTTPS confirmado
por el usuario. Se comprobó OPTIONS: 204 con el origen exacto de la vista previa,
POST y Content-Type permitidos. Esto no valida una sesión Firebase ni una
respuesta real de Gemini desde este entorno. POST debe conservar autenticación
y CORS incluso en errores. No incluir secretos de acceso en el cliente.
El dominio de vista previa también debe estar autorizado en Firebase si el
método de inicio de sesión usado lo requiere. El almacenamiento local pertenece
a cada origen: los audios locales del desarrollo no aparecen en la vista previa.

Orígenes de prueba: `http://127.0.0.1:8080` y la vista previa HTTPS;
`localhost:8080` es distinto. Cloudflare Pages permite microphone=(self),
manteniendo cámara/geolocalización deshabilitadas. El backend debe autorizar
exactamente los orígenes; Cloudflare Access debe permitir OPTIONS sin token
Firebase y sin procesar audio. POST conserva autenticación y autorización.
No colocar secretos de Cloudflare/Gemini en el navegador.

SA Voice está activo. El 10 de octubre de 2026 se comprobó desde Chromium que
el endpoint público HTTPS permite leer sus respuestas desde el origen exacto de
la vista previa: POST vacío devuelve JSON 400 y POST v1 con un token de prueba
inválido devuelve JSON 401. Estas pruebas verifican transporte y CORS en esas
rutas; no prueban la respuesta al procesar audio con una sesión válida.
El origen de producción `https://sistema-de-asistencia.pages.dev` no superó
esa prueba CORS: el servidor devolvió el origen de la vista previa. Debe
configurarse y verificarse antes de habilitar voz en producción.

El usuario confirmó grabación, reconocimiento de nombres con el workflow HTTPS
y que la conexión volvió a funcionar después de reportar un error. Esta es una
confirmación del usuario, no una ejecución autenticada realizada por este agente.
Pendientes desde este entorno: procesamiento real con una
sesión Firebase de desarrollo, prueba de Safari/iPhone, validación de duración/codec en servidor,
deduplicación durable, rate limiting y autorización por organización. Para
producción siguen pendientes estas verificaciones del servidor.

## Verificación

Jest cubre contrato, rechazo de resultados malformados, aislamiento de cuenta,
MIME negociado, cancelación y límites, renovación 401, backoff 429, selección
ambigua y números con ceros. Prueba Chromium con micrófono sintético cubre audio
real, IndexedDB tras recarga, borrador/alias, negación y reintento sin perder
ediciones. En Chromium se capturó `audio/webm;codecs=opus`; Safari/iPhone sigue
pendiente. La página de prueba aislada carga los módulos reales con adaptadores
de prueba y un webhook simulado, no una sesión Firebase o Gemini reales. Pruebas de transporte usan webhook simulado; no prueban Gemini ni
Cloudflare Access reales. Se ejecutan también guard de estado y suite de SA.

## Prueba piloto y responsables

Usar empleados y proyecto de prueba para comparar el préstamo por voz con el
formulario habitual.

| Prueba | Resultado esperado | Responsable |
| --- | --- | --- |
| Decir un nombre o «Busca a…» | Abrir Asistencia y el panel del empleado; no registrar asistencia. | Usuario, desde la vista previa con sesión real. |
| Decir un nombre poco común o parecido | Mostrar sugerencias; una coincidencia aproximada exige selección. | Usuario, con ejemplos de la obra. |
| Marcar Recordar y seleccionar empleado | Tras otra grabación y recarga, recuperar la variante en la misma cuenta, proyecto y navegador. | Usuario; agente SA revisa fallos. |
| Personal → Enseñar nombre por voz | Revisar y confirmar la variante; una colisión sigue mostrando ambos empleados. | Usuario; agente SA revisa fallos. |
| Preparar préstamo y cambiar empleado | Mantener monto, tasa y nota; permitir aplicar tasa anterior explícitamente. | Usuario, con datos de prueba. |
| Cancelar o decir una negación | No crear préstamo ni asistencia. | Usuario; agente SA revisa fallos. |
| Confirmar préstamo de prueba | Usar la operación original, una cuota por defecto, próxima fecha de pago posterior a hoy y nota con prefijo voice. Reintentar no duplica el préstamo. | Usuario; agente SA compara el resultado con el formulario habitual. |
| Conservación de audio | Poder escucharlo en el mismo navegador; respetar el plazo de 1–5 días o desactivar conservación. | Usuario; agente SA revisa almacenamiento y vencimiento. |
| Safari/iPhone | Verificar grabación, MIME efectivo, transcripción y permisos. | Usuario con dispositivo; agente SA revisa compatibilidad. |
| Límites y acceso del servicio | Verificar codec/duración, deduplicación durable, rate limiting y autorización por organización. | Agente de n8n, antes de producción. |

El agente SA mantiene la rama de pruebas y resuelve los fallos reportados. Para
diagnosticar transporte, compartir origen, endpoint, hora, requestId y estados
HTTP de OPTIONS/POST; no compartir el token ni el cuerpo de la solicitud.
