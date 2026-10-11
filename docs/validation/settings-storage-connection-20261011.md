# Settings: almacenamiento y conexión

El resumen anterior medía únicamente LocalStorage contra un límite fijo de 5 MB y mostraba «Conectado» al encontrar una sesión. Ahora separa los tipos de almacenamiento y las señales de sesión, red y sincronización.

## Comportamiento

- Uso del sitio y cuota disponible: estimación de `navigator.storage.estimate()`, etiquetada como estimación del navegador para IndexedDB y caché. LocalStorage se muestra aparte en bytes UTF-16; no se suman medidas que puedan solaparse ni se inventa una cuota cuando falta la API.
- Fotos de empleados: bytes de original y miniatura y cantidad de registros. Audios: bytes y cantidad de archivos conservados en el archivo de voz del dispositivo, incluidas otras cuentas locales. Son tamaños de los archivos, no el espacio físico de sus metadatos.
- Se conservan los conteos de empleados, puestos, líderes y asistencias en la pestaña Datos. Se obtienen con `count()`, sin recorrer esos registros, y se explica que fotos y audios usan IndexedDB incluso cuando los datos principales usan LocalStorage.
- Sesión y red se muestran por separado. `navigator.onLine` es una señal del navegador, no una prueba de acceso al servidor; la interfaz lo aclara. El resumen distingue falta de sesión, falta de red, pausas de subida/descarga, errores, sincronización activa, operaciones pendientes y última escritura confirmada.
- Las colas consultadas son `mainSyncOutbox`, `pettyCashOutbox` y `pettyCashMirrorOutbox`. Sus cantidades son entradas pendientes o `dead`, no un conteo de todos los cambios posibles ni de las subidas de fotos. «Última sync confirmada» informa un éxito registrado por `SyncStatus`; no garantiza que todos los datos estén ya replicados.
- Los eventos online/offline refrescan `SyncStatus` sin cambiar la fecha, borrar errores ni anunciar un éxito. No se utiliza el antiguo flag `autoSyncEnabled` para inferir una pausa: ese flag no controla las escrituras actuales.
- Solo se actualizan las celdas de diagnóstico, conservando formularios y foco. Mientras Settings está montado se consultan las colas cada 5 s y el almacenamiento cada 30 s; las lecturas simultáneas se comparten. También se puede actualizar manualmente. Al salir se detiene el intervalo.
- Las consultas son de lectura, cierran sus conexiones y no inicializan ni migran bases ausentes. Aperturas, transacciones y estimaciones tienen límites de espera. Si una lectura falla, la pantalla informa «No disponible» en lugar de cero.

## Validación

- Node 20: **5.539 pruebas / 587 suites aprobadas**, incluidas **31 pruebas nuevas** en `DeviceDiagnostics.test.js` y `SettingsDiagnostics.test.js`.
- IndexedDB con `fake-indexeddb`: ambos tamaños de foto, audios de distintas cuentas, conteos, colas pendientes/fallidas, bases ausentes sin creación, permisos denegados, estimaciones inválidas y llamadas bloqueadas o tardías.
- DOM: estados separados, escape de correo, cuotas desconocidas o excedidas, listeners reales de red extraídos de app.js, conservación de texto/foco, deduplicación de lecturas, parada al salir y descarte de resultados de una instancia sustituida.
- Chromium con IndexedDB y Blobs reales: foto de 6 MB más miniatura, audio de 1 MB, dos entradas pendientes y una fallida; desconexión/reconexión sin inventar una fecha de éxito. Comprobación integrada en `npm run test:settings-layout` y en CI.
- Diseño a 1440, 820, 390 y 320 px: sin desbordamiento, etiquetas accesibles, barra de borradores y navegación. Sin errores JavaScript.
- Aplicación fuente y bundle de producción en Chromium: las cuatro pestañas, ayuda por teclado, validación numérica, persistencia de 0 % tras recargar y resolución de borradores frente a cambios externos siguen funcionando.
- Build de producción, precache actualizado, guard de estado y revisión del diff aprobados.

No se usaron cuentas reales ni se escribió en servicios remotos. Los registros del navegador fueron sintéticos; la sincronización real entre dispositivos sigue requiriendo la comprobación manual indicada en las entregas anteriores. La estimación del navegador puede redondear el uso y cambiar su cuota; el desglose de archivos no mide la caché ni otros metadatos.
