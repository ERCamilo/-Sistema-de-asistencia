# Ajustes: guardado contextual y mensajes de recuperación

Base: `16c89b6c` de main, v1.7.64. Primera entrega del plan de mejoras de Ajustes: guardado claro/protección del borrador y mensajes fiables.

## Comportamiento

- Ajustes deja de mostrar el botón general de Guardar al pie de las cuatro pestañas. La barra contextual ofrece una sola acción «Guardar cambios» y «Descartar» cuando existe un borrador. Datos y Tests conservan sus acciones propias.
- Los campos pendientes se identifican con «Al guardar» y los controles inmediatos con «Automático», junto a una explicación breve. Las etiquetas describen cómo se aplica el cambio; no afirman una escritura ya confirmada. Los ajustes no cambian de familia de persistencia.
- Descartar revierte solo el borrador, no las preferencias automáticas ya aplicadas. Se conservan la validación, la protección frente a conflictos remotos y el ámbito del proyecto.
- «Limpiar caché y recargar» avisa explícitamente de que se perderán los cambios pendientes. Cancelar conserva el borrador. Si cambia mientras el diálogo está abierto, se exige una nueva confirmación. Sin mecanismo de confirmación disponible se bloquea la recarga de un borrador. Un fallo al limpiar caché deja los valores intactos y explica el error inline; sigue registrándose y traduciéndose el error técnico.
- Los errores de validación se muestran junto al campo, con su relación accesible, desplazamiento al campo y foco. La corrección del campo elimina su error. Un render ajeno preserva el error y el borrador; cambiar de ámbito/proyecto no hereda el error anterior. El fallo de guardado de configuración de un proyecto se explica inline, conserva los valores pendientes y permite volver a guardar. Una respuesta tardía de otro ámbito no muestra el error en el nuevo.
- El indicador de audios explica cuándo hace falta sesión, cuándo está consultando y cuándo no se pudo obtener la información. Un fallo ofrece «Reintentar consulta»; no sustituye cifras desconocidas por cero. La consulta de mantenimiento/espacio tiene un plazo de 8 segundos. Las consultas concurrentes comparten una promesa y los resultados de cuentas anteriores o lecturas vencidas no sobrescriben el estado actual.
- Los renders ajenos reutilizan el estado de espacio de audios sin reiniciar el indicador ni repetir una lectura de todas las grabaciones. Se consulta de nuevo al cambiar cuenta/retención, al reintentar, en las acciones explícitas existentes y cada cinco minutos. Los botones «Escuchar audio» siguen comprobando por separado su grabación, empleado, préstamo, proyecto y vencimiento al abrir/renderizar una cuenta.
- `SaveOutcomeNotifier` mantiene la distinción entre escritura local confirmada, nube pendiente y nube confirmada. Si el guardado no llega a informar de su resultado local, el timeout dice que no pudo confirmarse, en vez de afirmar «solo en este equipo». La respuesta de nube anterior no confirma un nuevo guardado que todavía espera su resultado local.

## Validación

- Node 20: **5.776 pruebas / 605 suites aprobadas**. Build de producción, precache, guard de estado y smoke tests Chromium de Settings/visor aprobados.

- 30 casos nuevos: guardado contextual y recarga (15), espacio/botones de audio (11) y honestidad de resultados (4). El handler de guardado usado por las pruebas es el bloque real de `app.js`.
- La regresión de resultado local sin confirmar falla contra el código anterior de `16c89b6c`: el timeout devolvía «Configuración guardada · solo en este equipo (aún no en la nube)» sin haber recibido un resultado local. El código corregido expresa la incertidumbre.
- Se actualizó el contrato de registro de errores de caché para buscar el bloque completo de la acción, sustituyendo el límite arbitrario de 700 caracteres; se añadió además la comprobación del registro real durante un fallo de limpieza.
- El smoke test de Settings en Chromium ahora carga `SettingsTab` y los controladores reales, revisa las cuatro pestañas a 1440/820/390/320 px, verifica una sola acción contextual, campos etiquetados, reflujo normal y convivencia de la barra con la navegación inferior. También ejecuta el handler real para error inline → render conservando el borrador → corrección → guardado.
- El fixture conserva las comprobaciones de almacenamiento con Blobs/IndexedDB reales y de offline/reconexión sin falsos éxitos. Usa una cuenta sintética y sustituye Firebase en su frontera de acceso; no realiza solicitudes a cuentas reales.
- Build, precache, guard de escrituras a estado, suite completa y smoke de recuperación del visor se ejecutan antes de publicar el PR. Los resultados finales se registran en la descripción del PR.

## Alcance y límites

Los estilos nuevos usan tokens canónicos para indicadores y errores. La migración completa de tipografía/colores, la reorganización de Tests, la revisión de contraste general y el reflujo con texto al 200 % pertenecen a las entregas siguientes. No se incorporan nuevos flujos de teclado.

El límite de consulta de audios acota la espera de la UI; no cancela por la fuerza una transacción de IndexedDB que ya esté en curso. El espacio del dispositivo puede tardar hasta el próximo refresco en reflejar cambios de otra pestaña; abrir la gestión de audios fuerza la consulta existente. Los mensajes de cuota/retención conservan su significado previo. La prueba Chromium de guardado sustituye la persistencia por un contador y no acredita transporte real entre dispositivos.
