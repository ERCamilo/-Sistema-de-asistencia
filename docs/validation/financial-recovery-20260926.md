# Recuperación financiera y revisión de Claude — 2026-09-26

Rama: fix/r07-petty-cash-projects-20260924. Base publicada: 237c643.
Continuación de la implementación parcial existente en este worktree.

## Comportamiento
- Asignar todo permite incluir préstamos, abonos, planes con cuotas aplicadas y cierres sin obra válida.
- Solo se recuperan datos de personas seleccionadas o ya pertenecientes al destino. Una fila solo de asistencia no traslada las finanzas de un empleado de otra obra válida.
- Los cierres originales se conservan; la identidad recuperada pertenece al destino y sus referencias se actualizan sin recalcular importes.
- Una relación ausente, contradictoria o compartida con personas fuera de la selección bloquea la operación completa antes del commit.
- La configuración de nómina puede recuperarse mediante elección explícita si el destino no tiene configuración; no se reemplazan reglas existentes. Su almacenamiento sigue siendo local, según ProjectPayrollConfigStore.
- Los cambios locales y las entradas de cierres recuperados se guardan en una transacción. Los fallos de encolado posterior de entidades mantienen el aviso existente de sincronización pendiente.

## Revisión de Claude Code
Fuente: sesión af5a967b-bc56-4e38-b44f-1354fd5b58e1, revisión de 0cd753b en la rama previa sa-r07-existing-unscoped-20260923. Se contrastaron los hallazgos con esta rama.
- H1 corregido: una asistencia asignada a otra obra no hereda el puesto actual del empleado. Se preservan horas y el empleado original.
- M1 ya estaba corregido en la rama actual: asignación solo de catálogo habilitada, cubierta por prueba.
- M2 corregido: deseleccionar empleados elimina decisiones de líderes sin uso; el servicio también rechaza copias que ningún empleado o puesto vaya a usar.
- M3 corregido: el resumen muestra los conflictos aunque se haya saltado la etapa de puestos.
- M4 pendiente: crear desde el asistente un puesto cuya definición original no existe. Se mantiene el bloqueo seguro; requiere reconstruir la definición explícitamente, sin inventar salarios.
- Observaciones LOW sobre rendimiento, líderes de puestos reemplazados, referencias rotas preexistentes de catálogo, durabilidad de no-op y código sin uso no se dan por resueltas en esta entrega.

## Evidencia
- Antes de las correcciones de Claude: 3 FAIL / 12 PASS en las dos suites de regresión.
- Después: 25/25 pruebas de recuperación financiera, asistencia huérfana y asistente.
- Suite completa: 485 suites / 4696 pruebas PASS.
- scripts/check-financial-recovery.cjs: PASS escritorio/map y móvil/create, confirmación sin escrituras previas, regreso sin guardar, conservación de importes, cuotas, cierre original, horas, salarios y recarga.
- Navegador nuevo y datos ficticios; solicitudes a APIs Firebase bloqueadas. Sin cuenta ni datos de producción.
- La prueba de navegador incluye el filtro final de empleados financieros que no deben migrar desde otras obras válidas.

## Límites
- La suite y las pruebas de navegador no sustituyen la conciliación de una copia aislada del respaldo real.
- No se certificó sincronización autenticada de esta nueva recuperación de cierres entre dos dispositivos; las pruebas de laboratorio anteriores cubren otras correcciones de la rama.
- No se fusionó ni desplegó producción. Una publicación de la rama solo genera preview.
