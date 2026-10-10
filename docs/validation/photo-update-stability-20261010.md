# Actualización de fotos — 10 de octubre de 2026

Al recibir o reemplazar una foto, el diff de DOM restauraba el avatar a la
plantilla sin imagen; la hidratación posterior lo mostraba otra vez. También
restauraba el estado cerrado de la ventana de fotos aunque estuviera procesando
una selección. Los fingerprints del avatar y la ventana conservan esos estados
cuando corresponden al mismo empleado. La hidratación sigue aplicando cambios
de foto y eliminaciones; cambiar de empleado no reutiliza su imagen anterior.

Las lecturas locales y el eco de Firebase podían poner de nuevo en la cola la
foto que ya se estaba subiendo. La reproducción enviaba cuatro archivos por un
reemplazo, en lugar del original y la miniatura una sola vez. Ahora se deduplica
la versión activa y se reconoce el eco de la publicación propia antes de
intentar otra subida. Los reemplazos nuevos siguen encolándose.

Cada descarga se comparte únicamente entre solicitudes con la misma revisión
remota e intención local. Se rechazan señales antiguas y resultados obsoletos,
incluido un borrado remoto recibido sin foto todavía en caché. Las verificaciones
se repiten dentro de la cola de escritura. Las señales idénticas comparten una
reconciliación y solo una informa que la imagen cambió. Una descarga antigua
tampoco puede eliminar el cooldown de una revisión nueva que falló.

El original recuperado no se adjunta a una miniatura de otra versión. La
actualización manual tampoco sobrescribe una sincronización más reciente y
recupera originales faltantes aunque la revisión de la miniatura ya coincida.

«Cambiar» distingue el procesamiento/guardado de las actualizaciones de
interfaz posteriores. Un fallo de foco o DOM después del guardado no muestra
«No se pudo guardar». Los fallos reales siguen mostrando el error y permiten
reintentar; la consola registra etapa, nombre y código sin incluir la imagen.
«Actualizar» informa sincronización pendiente o un cambio concurrente sin
presentarlos como un rechazo de la foto.

## Validación

- Catorce reproducciones fallaron contra el código original de `main` y
  pasaron con las correcciones. Se añadieron además guardas de original,
  cooldown y separación entre guardado e interfaz.
- Jest final con Node 20 en paralelo: **5.448 pruebas aprobadas en 580 suites**.
  También pasó la batería completa en serie antes de las dos últimas regresiones.
- Chromium real en dos contextos aislados, escritorio y móvil: reemplazo de
  rojo a azul mediante el controlador de adquisición, WebP procesado realmente,
  IndexedDB real, cliente HTTP real y validación del parser del backend. Cuatro
  subidas totales para dos reemplazos, cero transiciones a cámara durante los
  renders y cero errores JavaScript. Firebase y el transporte remoto se simulan;
  esta comprobación no escribe en cuentas reales.
- `lint:state`, precache y comprobación del diff sin errores.

## Alcance

El usuario observó un aviso parecido a «No se pudo guardar» al elegir una foto
nueva que terminó apareciendo. Se reprodujo el mismo aviso ante un fallo de
interfaz posterior al guardado; esto no identifica por sí solo la excepción
exacta de su dispositivo. Queda por repetir el reemplazo con sus dispositivos
reales sobre la nueva versión, usando los diagnósticos por etapa si reaparece.

La medición con carteras grandes sigue pendiente. No se cambia el contrato de
`404 IMAGE_NOT_FOUND`, la persistencia del borrador ni el backend de imágenes.
