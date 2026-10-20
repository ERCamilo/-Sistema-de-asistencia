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
