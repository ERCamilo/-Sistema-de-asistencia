# CI y recuperación del visor de fotos

Base: `96454891` de main, que ya incluye las entregas de estabilidad de fotos y Settings.

## Pruebas P2P y diagnósticos de CI

Se confirmó una fragilidad de las pruebas: esperaban 10–25 ms antes de asumir que la conexión/autenticación o el procesamiento del modal habían terminado. Al ejecutar la prueba anterior de `attendance-ready` con una apertura de canal retrasada 40 ms, falló con una solicitud esperada y cero recibidas. Esto reproduce el problema de la prueba, no identifica por sí solo la causa del fallo de CI del PR #241: GitHub sigue devolviendo HTTP 403 al descargar el registro de su primera ejecución.

- Las pruebas esperan la apertura del canal y el envío real de la solicitud mediante promesas del fixture. La autenticación se completa explícitamente después del mensaje temprano de Mini. Se prueban aperturas con 0 y 40 ms de retraso usando el reloj virtual de Jest.
- El timeout se comprueba avanzando el reloj virtual y verificando el cierre de la sesión. La carrera con una sesión RTC tardía usa una promesa controlada y verifica que se cierre al completarla. Los clics del modal esperan la promesa real de `handleFetchConnected`, conservando la comprobación de prevención de solicitudes duplicadas.
- No se modifican el protocolo P2P ni sus plazos en producción.
- CI guarda el JSON de Jest en `RUNNER_TEMP` y publica nombres y causas de pruebas fallidas en anotaciones de GitHub y en el resumen del job. Las anotaciones pueden consultarse mediante la API aun cuando la descarga del log falle. Conserva el código de salida de Jest: no ignora fallos ni añade reintentos automáticos.
- El reporte limita la cantidad y longitud de mensajes, escapa comandos de workflow y HTML, e incluye errores de carga de suites. Los informes no entran en el build publicado.

## Visor

- Una lectura fallida, un original no disponible, un fallo de creación de URL o una imagen que no puede decodificarse dejan el diálogo abierto, con una explicación y «Reintentar». Si el navegador está sin conexión, el mensaje indica que se reintente cuando vuelva la red. La miniatura del empleado se conserva; no se realizan reintentos automáticos.
- El reintento usa el mismo diálogo y una nueva lectura explícita del original. Los botones de reintento/actualización quedan bloqueados durante la lectura y decodificación para evitar operaciones duplicadas.
- Al actualizar, la imagen anterior permanece visible hasta que la nueva emite `load`. Si emite `error`, se conserva la anterior y se muestra el error. También se puede recuperar un original mediante «Actualizar» cuando el servidor indica que la versión ya es actual.
- Se descartan resultados de ventanas cerradas o sustituidas, y versiones que cambian durante la apertura/decodificación. Las URLs de candidatos fallidos, reemplazados y del diálogo cerrado se liberan.
- Tab/Escape, foco después de reintentar/cerrar y las acciones Cambiar/Eliminar se mantienen. Una eliminación confirmada desde el servicio conserva el cierre y restablecimiento del avatar anteriores.
- El CSS respeta los atributos `hidden` del visor, incluidos imagen, indicador de carga y botón de reintento.

## Validación

- Node 20: **5.637 pruebas / 594 suites aprobadas**. Los tres archivos directamente afectados reúnen **59 casos**, con 12 casos adicionales: dos variantes de latencia, siete regresiones del visor y tres del reporte de CI.
- Baseline P2P con latencia de 40 ms: una prueba fallida; versión corregida aprobada para ese retraso y para apertura inmediata. Los fallos de descarga/lectura e imagen dañada anteriores cerraban el visor por diseño; sus expectativas ahora comprueban el diálogo y la recuperación.
- Chromium con código real del controlador, Blobs WebP válidos y dañados: fallo inicial, fallo de decodificación, reintento por Enter, exclusión de clics durante la lectura, conservación de la foto visible al fallar una actualización, recorrido del foco, Escape y liberación de todas las URLs.
- Diseño a 1440, 390 y 320 px; mensaje, reintento y acciones dentro del diálogo y sin solaparse. Fixture sin cuentas ni llamadas externas, con Firebase sustituido en su frontera de acceso. Comando `npm run test:photo-viewer`, integrado en CI.
- Comprobaciones existentes de Settings en Chromium aprobadas a 1440/820/390/320 px. Build, precache, guard de estado y revisión del diff aprobados.

Las pruebas del visor usan un servicio sintético y no verifican el transporte entre dispositivos con cuentas reales. El reintento es manual y puede volver a fallar si el archivo sigue dañado o falta el original. La causa de la primera ejecución fallida del PR #241 sigue sin confirmar; las anotaciones nuevas permiten diagnosticar fallos posteriores.
