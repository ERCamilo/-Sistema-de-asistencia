# Exportación enriquecida SA → SplitX

## Alcance

Ampliar los datos exportados antes de modificar el transporte. Conservar el arreglo JSON manual y los campos existentes de cada empleado, así como el protocolo postMessage v1 y sus aliases. No registrar pagos, modificar empleados/asistencias ni incorporar un ID de nómina. El período inclusivo inicio/fin describe el cálculo; no garantiza deduplicación.

Agregar identidad estable y ficha textual, contexto de obra/moneda/período y totales del listado efectivamente exportado, puestos/líderes del trabajo incluido, jornadas equivalentes y detalles económicos. La jornada corresponde a la configuración de la obra, no a la configuración global cuando se trabaja por obra. Cuatro horas sobre una jornada de ocho equivalen a 0.5 días. Separar días ordinarios, extras, feriados y descanso; los factores salariales no multiplican los días.

Los conceptos económicos deben proceder del cálculo de la vista previa, no recalcularse desde las preferencias. Distinguir monto porcentual calculado, porcentaje/base y monto fijo; expresar el signo con signedAmount. Respetar categorías desmarcadas, filtro de líder y alcance de sus posiciones, cuotas y aislamiento entre obras. Conservar precisión monetaria existente.

## Contrato compatible

Nuevo módulo puro PayrollSplitXExport: usa toSplitXRows sin cambiar su contrato base. Añade sourceEmployeeId, employeeNumber, employeeName, workDays, positions, leaders, bonusDetails, deductionDetails y exportContext. exportContext lleva schema sa-splitx-payroll/v1, período, moneda, obra cuando corresponda y totales; se repite por fila para conservar el arreglo manual. El mensaje del puente publica también ese contexto en su nivel superior. No eliminar aliases hasta coordinar el receptor SplitX.

## Verificación

Pruebas de jornadas distintas, fracciones, múltiples posiciones, conceptos porcentuales/fijos y cuotas, no mutación, campos originales, igualdad de datos entre exportación manual/puente, filtros/categorías/obra y contenido real del JSON descargado. Suite Jest completa, guard de escrituras, build de producción y precache. Publicar documentación del contrato y ejemplo ficticio para que SplitX pueda integrarse en paralelo.

## Fuera de esta entrega

Validación central del destino, bloqueo de envíos repetidos, confirmación count:0, recuperación de fallos y negociación/timeout del puente quedan para el siguiente bloque autorizado. Revisión del receptor SplitX y prueba real entre aplicaciones pendientes: este repositorio solo contiene SA.

## Ampliación: empresa y etiqueta del período

Exportar `companyName` desde Ajustes/General y `payrollName` como «Nómina período DD/MM/YYYY - DD/MM/YYYY». Conservar las fechas ISO por separado, el contrato anterior y la separación entre empresa y obra. Ambos campos deben coincidir en portapapeles, archivo y puente. La etiqueta se forma desde las fechas civiles, sin conversiones de zona horaria, y no constituye un ID de nómina.

## Ampliación: tarifa diaria y abonos parciales

- Añadir `positions[].dailyRate`: tarifa por hora registrada en el desglose de cálculo × jornada de la obra. Conservar tarifas individuales y puestos históricos; no inferir la tarifa del neto/días ni del catálogo actual. Si no hay tarifa aplicada disponible o hay varias distintas para el mismo puesto, exportar `null`.
- Añadir `loanBreakdown`: concepto/ID, estado propuesto o ya registrado, deuda anterior, abono, reparto capital/interés y saldo proyectado. Consumir el reparto real del paso 4, incluidos «otro monto», «solo interés», cero, cuotas y préstamos seleccionados sin abono asignado.
- Añadir `loanSummary`: totales de la selección y deuda vigente de todos los préstamos activos del empleado, claramente separados. La proyección requiere saldo previo y abonos no registrados. Si faltan datos, usar `null`/`projectionAvailable:false` sin inventar capital, interés o saldos. La deuda total es la del momento de exportación, no una reconstrucción al cierre del período.
- En abonos ya registrados (`linked`), conservar `paymentId` y el saldo actual si está disponible; no generar otro descuento de deuda. Los nuevos datos son informativos y no cambian el neto ya calculado, pagos, cierres ni persistencia. Mantener los campos legacy intactos.
- Verificar reparto real con varios préstamos, deudas no seleccionadas, categorías excluidas, períodos pagados y comparación de portapapeles/archivo/puente. Actualizar guía y ejemplo completo con un préstamo de 3.000, abono 500 y saldo proyectado 2.500; conservar los dos cargos y la empresa/período ya incorporados.
