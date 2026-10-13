# Ajustes: estado compacto solo en Datos

Base: main `56a54a40`, v1.7.82. La cabecera repetía las tarjetas de almacenamiento, sincronización y personal antes de las pestañas, ocupando casi toda la pantalla móvil incluso en General y Calendario.

Ahora las pestañas aparecen inmediatamente después del título. El resumen de dispositivo solo aparece en Datos, dentro de un desplegable nativo cerrado por defecto. Su encabezado muestra el estado real de sincronización; los detalles de almacenamiento, sesión, colas y personal quedan accesibles al abrirlo. El desglose de archivos y la actualización manual permanecen en Almacenamiento de este dispositivo.

El resumen y la tarjeta detallada usan la misma decisión de estado: sin sesión, sin conexión, pausado, error, sincronizando, pendiente o última sincronización confirmada. Un error o un pendiente sigue visible con el desplegable cerrado. Abrir/cerrar no cambia ajustes ni provoca navegación. El estado abierto se conserva en el parcheo reactivo; salir de Datos y volver lo inicia cerrado.

El refresco modifica únicamente los nodos de diagnóstico, conservando el desplegable. Las mediciones comparten la caché y la deduplicación existentes. Fuera de Datos se suspende el temporizador de diagnósticos y no se consultan los archivos solo por estar en General/Calendario/Pruebas. Esto no modifica el proceso de sincronización de la aplicación.

## Validación

Node 20: **5.935 pruebas / 617 suites aprobadas**. Build de producción aprobado (406 módulos, 25 recursos precacheados), guard de estado sin deuda nueva y diff sin errores.

- Chromium: las cuatro pestañas a 1440/820/390/320 px; fuera de Datos no existe el dashboard. En Datos se comprueba que queda después de las pestañas, cerrado, con altura de hasta 120 px en los escenarios de texto normal, y que se puede abrir/cerrar y conserva su apertura tras un render.
- Chromium adicional: texto 100/200 %, herramientas abiertas, contraste y áreas táctiles; modo normal sin pestaña de desarrollador y handler real de guardado.
- Regresiones: ubicación/apertura inicial, conservación de apertura durante DOMDiff, igualdad de estados del resumen y el detalle, actualización del error con la tarjeta cerrada, suspensión de lecturas fuera de Datos y reanudación al volver.
- El test de protección del borrador verifica el botón Datos de la navegación; se elimina el acceso redundante a Datos desde una tarjeta que ya vive dentro de esa pestaña.

Los fixtures usan datos sintéticos, IndexedDB real y Firebase sustituido. No acreditan sincronización entre cuentas/dispositivos reales ni todos los navegadores móviles. Los casos incompletos de contraste se siguen reportando sin contarlos como aprobados.
