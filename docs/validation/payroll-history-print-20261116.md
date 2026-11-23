# Imprimir un cierre de nómina

En Historial → detalle del cierre aparece una única acción nueva: Imprimir. Se abre un documento independiente que invoca la impresión del navegador y permite guardar como PDF. Si el navegador bloquea la ventana se informa el error y se conserva el detalle; el documento también contiene un botón para reintentar la impresión.

El reporte reutiliza el detalle histórico, con sus filas ordenadas por ficha y su filtro de líder histórico. Usa los importes del cierre cargado, incluyendo el neto guardado; nunca llama al cálculo de la nómina vigente. Las simulaciones de bonificaciones, deducciones o préstamos de la pantalla no se trasladan a la impresión; esto se explica junto al detalle y en el reporte. Los ajustes entre líderes se muestran aparte, con sus empleados y saldos, y se expanden para imprimir. Se identifican los cierres anulados. El documento no contiene controles de modificación ni accede al almacenamiento.

Diseño de impresión: A4 horizontal, fondo blanco, columnas opcionales según los importes guardados, encabezados de tabla repetidos y filas sin corte. No carga fuentes ni dependencias externas. La ventana conserva una copia del reporte aunque cambien los filtros o datos de la pantalla original.

## Verificación

- `js/tests/PayrollHistoryPrint.test.js`: importes históricos, neto guardado, orden de fichas, filtro de líder, separación de simulaciones, ajustes entre líderes con saldo negativo, anulaciones, escape de texto, detalle vacío, consulta de solo lectura, ventana bloqueada y reintento.
- Pruebas existentes de historial, cierres operativos y permisos de consulta.
- `npm run test:payroll-history-print`: Chromium a 390 y 1280 px; pulsa la acción delegada real desde el detalle, respeta el filtro histórico y conserva las simulaciones en la pantalla. Genera un PDF de varias páginas con 40 empleados ficticios y un neto histórico de $36,000.00; verifica que no haya escrituras del cierre. El PDF local se comprobó además con pdftotext: aparecen los 40 empleados y el total, sin simulaciones ni acciones de edición.
- El mismo control de navegador se ejecuta en CI, junto a Jest, build, precache y las verificaciones de release.

Queda que el usuario compruebe la impresión/Guardar como PDF en el navegador de su dispositivo, especialmente Safari/iOS o navegadores integrados. No se ha añadido exportación a Excel en esta entrega.

Siguientes pasos: agente SA entrega PR y vista previa; usuario prueba un cierre y el filtro de líder; agente SA atiende resultados e integra después de la revisión.
