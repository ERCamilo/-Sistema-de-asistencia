# Ajustes: almacenamiento compacto y agrupación de opciones

Revisión del 12 de octubre de 2026. Base: `4e77721e` de main, v1.7.75. Referencia: `design.md`, en particular comunicación breve, decisiones directas y controles táctiles. Esta entrega modifica el almacenamiento; las demás agrupaciones de esta revisión son propuestas.

## Cambio realizado

La cabecera de las cuatro pestañas repetía el porcentaje, LocalStorage, fotos, audios, explicación de la cuota y actualización manual. El selector de almacenamiento y sus conteos estaban separados, en Datos.

Ahora la cabecera muestra solo uso, espacio disponible y un acceso a Datos. El desglose completo, la actualización manual, el selector de almacenamiento y los conteos quedan juntos en **Datos → Datos locales → Almacenamiento de este dispositivo**. No se crea otro modal ni se mezclan las cifras con la ventana que gestiona los audios de voz.

Las cifras corresponden al almacenamiento del sitio estimado por el navegador, no a RAM ni al espacio libre total del teléfono. Si la API no informa una cuota, no se inventa espacio disponible. Se conservan los avisos de uso elevado, los archivos separados por tipo y los límites de las mediciones anteriores.

El acceso reutiliza la navegación con protección de borradores. El resumen y el desglose reciben la misma medición almacenada en caché; los dos nodos se actualizan localmente sin reconstruir el formulario ni multiplicar las lecturas de IndexedDB. Se conservan los intervalos y la deduplicación existentes.

La revisión visual detectó botones de Mantenimiento comprimidos en móvil, con texto casi vertical. Sus filas ahora usan el patrón de acciones que permite reflujo y un ancho mínimo limitado por el contenedor; la prueba de Chromium comprueba que no vuelven a adoptar esa forma a 100/200 %.

## Revisión de agrupaciones

| Orden | Opciones relacionadas y situación actual | Agrupación recomendada | Coste / beneficio |
| --- | --- | --- | --- |
| 1 | `weatherEnabled`, `weatherApiKey` y `weatherLocationInput` están bajo Interfaz de Navegación, con otros controles entre el interruptor y su configuración. | Una sección **Clima** en General, con activación y configuración juntas. | Bajo / alto: elimina una relación dispersa sin cambiar pestaña ni guardado. |
| 2 | `attendancePositionWatermarks`, tamaño/contenido de marca, `showAttendanceCardDeficit` y `attendanceDeficitUnit` se mezclan con navegación y clima. | **Vista de asistencia** en General, con dos subgrupos: marcas y déficit. Mantener las horas y factores de cálculo en Calendario. | Bajo / alto: distingue presentación de cálculo. |
| 3 | `hideDuplicateAlerts` está en General, mientras la herramienta Duplicados está en Salud de los Datos. | Situar la preferencia junto a **Datos → Salud de los datos**. Explicar que oculta el aviso y no corrige duplicados. | Bajo a medio / alto: une aviso y resolución; verificar el guardado automático al cambiar de pestaña. |
| 4 | `backupFrequency`, creación de copia y lista de versiones están separados; `mirrorCadence` aparece al lado de la frecuencia de copias, aunque controla sincronización. | **Respaldos** con copia manual, frecuencia y versiones; **Sincronización** con cadencia y acciones de sincronizar. El archivo JSON queda como otro tipo de respaldo claramente identificado. | Medio / alto: reduce la confusión entre actualizar datos y crear una copia recuperable. |
| 5 | `miniConnectedReviewMode` y borrar coincidencias de Mini están dentro de Mantenimiento de General; configurar el proyecto y resolver relaciones están en otros lugares. | **Conexiones con Mini**, junto a la configuración de proyecto, con enlaces al flujo de conciliación. | Medio / alto: organiza un flujo completo; moverlo a un modal requiere adaptar la captura de borradores y su protección. |
| 6 | Activación de voz, sonido, intención ambigua, tasa anterior y conservación de audio aparecen seguidos en Voz. | Subgrupos **Grabación**, **Interpretación y préstamos**, **Audios guardados** dentro de Voz. Mantener la gestión de audios en su ventana existente; desde almacenamiento puede ofrecerse un acceso. | Bajo a medio / medio: aclara qué cambia cada opción. No duplicar los mismos inputs en dos pantallas. |
| 7 | Limpiar caché y exportar registro técnico comparten Mantenimiento con preferencias de Mini; el diagnóstico detallado está en Pruebas, oculta por modo desarrollador. | Un grupo visible **Ayuda y mantenimiento** para actualización y soporte; conservar las simulaciones en Pruebas. | Bajo / medio: facilita soporte sin exigir activar el modo desarrollador. |

## Relaciones que conviene conservar

- El período, fecha de pago, festivos, horas y factores pertenecen al mismo flujo de Calendario y cálculo de asistencia. No mover los factores a Vista de asistencia solo por compartir el término «asistencia».
- Borrar datos locales, reemplazar desde la nube y borrar datos de la nube deben conservar su separación, destino y confirmaciones. Agrupar respaldos no debe hacer que estas acciones parezcan equivalentes a sincronizar.
- El interruptor `voiceReviewBeforeSend` permanece en Pruebas porque main lo presenta como experimental. Su relación con Grabación debe revisarse cuando deje de ser experimental, sin cambiar esa decisión en esta entrega.
- La elección de almacenamiento y la conservación de audios tienen consecuencias distintas. Cambiar Local/IndexedDB no convierte los audios locales en archivos compartidos entre dispositivos.

## Validación y límites

- Node 20: 5.873 pruebas / 613 suites aprobadas; después se añadió y aprobó el caso del acceso con borrador (16 casos de SettingsSaveFeedback).
- Build de producción aprobado: 402 módulos, 25 recursos precacheados.
- Chromium real verifica que el resumen no repite los archivos y que su acceso abre Datos, donde aparecen las mediciones de fotos/audios de IndexedDB real.
- Se conservan las comprobaciones de las cuatro pestañas a 1440/820/390/320 px, contraste, controles táctiles y texto 100/200 %, además del modo normal sin Pruebas.
- Casos de regresión verifican cuota no disponible/agotada, actualización de ambos nodos desde una sola medición, preservación de texto/foco y protección del borrador al abrir Datos.
- Los fixtures usan datos sintéticos y Firebase sustituido; no acreditan transporte entre dispositivos ni el comportamiento de todos los navegadores móviles.

Las propuestas se ordenan por coste/beneficio. Los tres primeros grupos pueden abordarse en una entrega de organización de General/Datos; respaldos y Mini necesitan una revisión específica de navegación y guardado antes de mover controles entre ventanas.
