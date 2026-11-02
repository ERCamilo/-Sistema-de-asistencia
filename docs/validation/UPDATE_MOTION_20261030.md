# Actualizaciones con progreso visible

Versión 1.7.120.

La descarga prepara una copia verificada antes de ofrecer la instalación. El usuario confirma, se comprueba el guardado y se activa antes de recargar. Las fases muestran animaciones SVG y progreso por archivos cuando existe un total válido; no se inventa un porcentaje de bytes. Movimiento reducido desactiva las animaciones. El arranque de una versión nueva confirmada muestra una sola vez el check de éxito.

La reparación conserva IndexedDB, almacenamiento local, fotos, comprobantes y tutoriales. Descargas bloqueadas, guardado fallido y errores de activación permiten recuperar el control.

## Evidencia

6,844 pruebas Jest aprobadas (681 suites). Compilación, catálogo de lanzamiento y recorrido Chromium con Service Worker real aprobados tras integrar main c957087a.

Las comprobaciones incluyen funcionamiento offline, fallo de descarga, espera bloqueada, reintento, conservación de datos y accesibilidad. No certifican dispositivos físicos ni autenticación real de servicios externos.

Maqueta interactiva: [actualizaciones-sa-mini.html](../maquetas/actualizaciones-sa-mini.html).
