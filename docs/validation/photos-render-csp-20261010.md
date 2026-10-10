# Fotos, renders y CSP — revisión del 10 de octubre de 2026

Esta entrega reduce consultas repetidas de fotos fallidas, agrupa los renders
globales y conserva la edición del empleado ante cambios ajenos al formulario.
Las fotos nuevas o reemplazadas se procesan como WebP, con alternativa JPEG si
el navegador no puede codificar WebP. La extensión enviada coincide con el MIME
real de cada imagen, incluidas las subidas antiguas pendientes.

Se mantiene `404 IMAGE_NOT_FOUND` para una imagen inexistente. Los errores de
sesión locales y del backend no retrasan la recuperación tras renovar la sesión.
Abrir manualmente la foto original permite reintentar; una descarga fallida no
oculta una miniatura válida. Las consultas simultáneas se comparten.

## Revisión independiente

Se realizaron seis revisiones separadas, sin modificar el repositorio desde los
subagentes: CSP/Service Worker, render/estado, editor de empleado, reintentos de
fotos, visor y WebP. La revisión de reintentos encontró que los errores backend
`401 INVALID_FIREBASE_TOKEN` y `401 MISSING_ID_TOKEN` imponían el cooldown incluso
tras recuperar la sesión. Se corrigió y se añadieron reproducciones con el
cliente real y respuestas HTTP simuladas. Los otros grupos no encontraron
regresiones bloqueantes en su alcance.

Las actualizaciones idénticas de valores simples y los borrados de propiedades
inexistentes no solicitan renders. Crear o borrar una propiedad con valor
`undefined` sí es un cambio; los objetos continúan convirtiéndose en snapshots
sin proxies. `batchSetState` conserva su comportamiento.

## Comprobaciones

- Jest: 5.316 pruebas aprobadas en 569 suites, incluidas las nuevas regresiones de auth, edición,
  deduplicación y WebP.
  La ejecución paralela presentó dos fallos temporales en
  `P2PAttendanceBridgeTests` (esperas de 25/250 ms); se verificó nuevamente con
  la batería en serie para evitar competencia entre workers.
- `npm run lint:state`: sin deuda nueva.
- `node scripts/sw-precache.cjs --check`: manifiesto actualizado.
- Chromium: borrador y foco de escritorio conservados; modal de edición móvil
  conserva su borrador ante renders ajenos.
- Chromium: WebP real validado por el parser del backend, cacheado en IndexedDB,
  descargado por el cliente y decodificado. Original 1600 × 1067 y miniatura
  256 × 256 en el fixture; alternativa JPEG también validada. Transporte y
  backend simulados, sin escribir en cuentas reales.
- Chromium con el Service Worker real: actualización entre dos builds,
  eliminación de la caché anterior, código nuevo disponible offline y encabezado
  CSP correcto. La comprobación espera que la activación termine; una captura
  anterior durante `activating` no demuestra un fallo de limpieza.
- Los hooks de commit estampan la misma versión en `sw.js` y `BuildInfo.js`.
  La CSP conserva Report-Only y permite el origen exacto de las fotos de Google
  en `img-src` y `connect-src`.

El usuario confirmó que las fotos se comparten entre sus dispositivos. Falta
verificar el alojamiento y una instalación existente después del despliegue.

## Pendientes separados

- Proteger el borrador ante cambios relevantes del empleado, puestos o nómina;
  hoy esos cambios reconstruyen el editor. Requiere definir la resolución de
  cambios externos antes de guardar.
- Carrera preexistente de fotos: si llega la señal de revisión v2 mientras se
  descarga v1, ambas pueden compartir la descarga y guardar los bytes de v1
  como v2. Reproducida tanto en HEAD como en esta entrega; requiere aislar las
  descargas por revisión y descartar resultados obsoletos.
- El visor se cierra sin explicación si no consigue el original. Conserva la
  miniatura para reintentar; un mensaje breve sería una mejora posterior.
- Medir con carteras grandes antes de ampliar las optimizaciones. Algunos
  callbacks anónimos de PayrollUI pueden solicitar un frame adicional; la
  detección de batches vacíos también queda fuera de esta entrega.
