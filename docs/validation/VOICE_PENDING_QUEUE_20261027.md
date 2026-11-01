# Voz: grabaciones pendientes (#307)

La prueba se publica siempre en `https://feat-voice-position-context.sistema-de-asistencia.pages.dev`. Reutilizar esa rama conserva el origen autorizado en n8n. No se modifica el webhook, el prompt ni el esquema v1.

## Comportamiento

- General → Voz → Grabaciones ofrece Pendientes y el estado de cada audio. Permite escuchar, abrir el borrador y enviar/reintentar una grabación o el conjunto pendiente.
- Sin conexión, un envío solicitado se conserva en IndexedDB. Se reanuda con SA abierta y Voz habilitada, dentro de la misma cuenta y obra. Las grabaciones que nunca se enviaron requieren una acción explícita. Los errores HTTP no generan un bucle de reintentos; 429 respeta Retry-After y 401 intenta renovar el token una vez.
- La cola procesa uno a la vez. Una transacción de IndexedDB adquiere una reserva de dos minutos por grabación entre pestañas del mismo origen. Antes del POST se vuelve a comprobar y renovar la reserva. Una pestaña interrumpida permite reintentar al vencerla; la ventana de procesamiento de 90 segundos incluye renovación de sesión, petición y lectura de respuesta.
- El `requestId` y el contexto originales se mantienen al renovar tokens, recargar y reintentar. Una firma SHA-256 local detecta cambios del audio o del contenido enviado; esos cambios requieren otra grabación/ID. No se envía la firma, ni catálogos, alias o IDs de empleados/posiciones.
- Cerrar un envío solicitado conserva el audio y pausa la petición activa. Grabar otra toma conserva los pendientes anteriores. Las tomas canceladas antes de solicitar un envío conservan su descarte habitual. Se eliminan explícitamente desde Grabaciones.
- Cambiar cuenta/obra, deshabilitar Voz o borrar los datos pausa las peticiones. Las respuestas tardías no se aplican a otra sesión ni recrean audios eliminados. Un resultado no reemplaza ediciones manuales: queda pendiente de aceptación explícita.
- Procesar en segundo plano solo prepara datos locales. Nunca navega ni registra préstamos, gastos o asistencias; se conservan las operaciones y confirmaciones existentes.
- Los borradores/audio pendientes vencen a las 24 horas. Un pendiente vencido deja únicamente un aviso sin audio, transcripción ni borrador durante siete días. Los audios de préstamos conservan la política existente de cero a cinco días. El presupuesto global local de 50 MiB se comprueba en la transacción de guardado; la app avisa al acercarse al límite.

## Validación

Jest con IndexedDB: recarga offline/online, cuenta/obra y vuelta A→B→A, dos pestañas, ediciones durante/después de una respuesta, reserva interrumpida, token tardío, 401/403/429, error de red, cambio de contenido, límite de espacio y vencimiento/borrado durante una petición. Regresiones existentes de voz y suite general.

Chromium con MediaRecorder e IndexedDB reales en 320/390/1280 px: dos grabaciones offline, reconexión, mismos identificadores, revisión sin perder monto/nota, cero escrituras adicionales de negocio y WCAG A/AA. También se verifica la administración de Voz en 320/390/1440 px. El recorrido ampliado forma parte del CI existente.

Pendiente: prueba del usuario con Firebase, audio real de la obra y Gemini, incluyendo un corte de conexión desde un teléfono.

## Alcance de la reserva

La reserva coordina pestañas del mismo navegador/origen. No sustituye la deduplicación durable del servidor: si la respuesta se pierde después de que n8n procese un audio, otro intento podría transcribirlo de nuevo. Se reutiliza el mismo `requestId`; las operaciones de negocio siguen requiriendo la confirmación y protección existentes en SA. No se necesita ni se instala procesamiento de audio con la app cerrada.
