# Posiciones de préstamo en Excel

## Comportamiento

En Reportes → Personal → Exportar Excel, la primera opción permite elegir:

- **Filas separadas** (predeterminado): conserva las filas por puesto y el sufijo `b` de la ficha.
- **En la fila principal**: reúne solamente los tramos marcados como préstamo en la fila del puesto principal. Los puestos secundarios normales mantienen sus filas.

En la hoja de quien paga, las celdas de préstamo son numéricas, amarillas y tienen notas con puestos, horas y «Se le descuenta a Marcos». La tarifa del puesto principal no se usa para recalcular los tramos reunidos.

En la hoja de Marcos, el apartado «Personal pagado por otros líderes» conserva un único ajuste monetario. Debajo, cada empleado tiene sus días negativos por fecha (`-1`, `-0.5`, etc.), sin bruto ni neto adicionales. Los factores de feriado/descanso son los del reporte actual: una fracción de día valorada en `0.75` se refleja como `-0.75`.

Desactivar el ajuste deja sus días en cero y sus notas lo indican. El historial de equipo/pagador se respeta por día. No se modifican asistencias, asignaciones, cobros de préstamos ni datos de la nube.

La elección usa el estado de las demás opciones de exportación y dura la sesión. Los resúmenes generales y las hojas por puesto conservan su presentación.

## Comprobación reproducible

```sh
npm test -- --runInBand --runTestsByPath js/tests/EmployeeReportExcelExportTests.test.js js/tests/EmployeeReportAssignedTerms.test.js js/tests/EmployeeReportDataTests.test.js
node scripts/check-excel-loan-layout.cjs
```

El script usa Chromium y la misma versión de ExcelJS que la app (4.3.0). Descarga el bundle antes de arrancar el navegador si no se proporciona `EXCELJS_BUNDLE`. Firebase está sustituido y el navegador bloquea todas las peticiones externas. `CHROMIUM_PATH` permite indicar otro ejecutable.

Comprueba el modal a 320, 390 y 1280 px y escribe/reabre cuatro archivos reales: ambas presentaciones, con el ajuste activado y desactivado. Revisa tipos numéricos, notas, referencias de fórmulas, color amarillo en domingo y un solo descuento monetario. Guarda capturas y archivos en `/tmp/sa-excel-loan-layout` (configurable con `EXCEL_LOAN_ARTIFACT_DIR`).

Los tests de exportación también cubren días completos/repartidos, salario con tarifas distintas, puesto principal sin trabajo, puestos con el mismo nombre, cambio histórico de equipo/pagador, trabajo propio y cedido del mismo empleado y totales simples/duales con/sin fórmulas.

Resultado local: la ejecución completa recorrió 721 suites y 7416 pruebas; solo falló la comprobación del manifiesto de precarga, porque faltaba el módulo nuevo. Tras regenerarlo, las seis suites afectadas (exportación, reporte, precarga y publicación) pasaron sus 61 pruebas. El script de navegador pasó las tres anchuras y los cuatro archivos reales. Build de producción y control de escrituras a estado sin deuda nueva.

## Validación pendiente del usuario

Abrir una exportación de prueba en la versión habitual de Microsoft Excel, mostrar las notas amarillas y contrastar un empleado prestado entre las hojas del pagador y del líder descontado. La relectura automatizada de ExcelJS no sustituye esa comprobación de compatibilidad visual con Excel de escritorio/móvil.
