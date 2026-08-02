# Préstamos en Nómina: comportamiento implementado

La revisión de Nómina ya calcula préstamos de pago único y en cuotas sin registrar pagos automáticamente. El operador conserva el control: una cuota exigible se selecciona por defecto y puede ampliar la selección a varias cuotas consecutivas o a todas las restantes.

## Flujo actual

1. Registrar el préstamo desde Cuentas por Cobrar para un empleado activo o inactivo.
2. Revisar Nómina dentro de un período definido.
3. Confirmar la selección temporal: saldo completo para pago único o una cuota exigible para préstamos en cuotas.
4. Aumentar, reducir o seleccionar todas las cuotas si el empleado desea adelantar pagos.
5. Exportar o revisar la Nómina con el descuento calculado.

> La selección actual calcula el descuento, pero todavía no crea un abono en el préstamo.

## Reglas de negocio

| Tema | Decisión |
|---|---|
| Concepto | Adelantos y compras personales se distinguen únicamente por el texto del concepto. |
| Pago único | Descuenta el saldo pendiente completo. |
| Cuotas | Selecciona por defecto la próxima cuota impaga, aunque su fecha sea posterior al período de Nómina. |
| Pagos adelantados | Permite seleccionar varias cuotas consecutivas o todas las restantes. |
| Cuota parcial | Cobra primero el remanente de la cuota parcialmente pagada. |
| Saldo adicional | El interés de un refinanciamiento que exceda el plan original se conserva como cargo explícito. |
| Empleado inactivo | Puede recibir y gestionar préstamos, aparece identificado en Cuentas por Cobrar y nunca se incluye en Nómina. |
| Cambio de período | Limpia la selección temporal para no reutilizar vencimientos calculados con otras fechas. |

## Garantías verificadas

- Los cálculos y la selección no mutan préstamos ni pagos persistidos.
- Los identificadores numéricos y de texto se normalizan al resolver selecciones.
- Las cuotas se deduplican y la cantidad elegida se limita al plan pendiente.
- Un saldo de `0.01` continúa siendo cobrable.
- Un neto de Nómina igual o menor que cero queda marcado como inválido.
- La exclusión de empleados inactivos ocurre antes de evaluar asistencia o filtros por líder.

## Siguiente incremento: cierre de préstamos desde Nómina

El botón amarillo se ubicará al final del paso 5, Vista previa. Permanecerá deshabilitado salvo que se cumplan simultáneamente estas condiciones:

1. Existe al menos un préstamo o una cuota aplicado al resumen.
2. No quedan empleados con neto igual o menor que cero ni otros conflictos bloqueantes.
3. El operador confirmó que la Nómina fue pagada.
4. La confirmación corresponde exactamente al período y a la versión actual de la vista previa.

La confirmación de pago de Nómina se vinculará a una huella de la vista previa. Cualquier cambio en el período, la asistencia, los importes o la selección de préstamos invalidará esa confirmación y volverá a deshabilitar el botón. Esto evita registrar abonos sobre una Nómina distinta de la que realmente se pagó.

### Modal de verificación

El modal será deliberadamente resumido. Mostrará por empleado:

- préstamos o cuotas que se registrarán;
- total que se descontó en la Nómina;
- saldo pendiente después del pago;
- indicación de si queda un pago futuro.

También mostrará los totales del lote. El operador deberá verificar el resumen y aceptarlo antes de persistir los pagos. Podrá cancelar sin cambios en cualquier etapa previa a la confirmación.

### Persistencia y deshacer

Antes de guardar se revalidarán los saldos. Cada lote tendrá una identidad estable y cada cargo usará una clave idempotente por período, empleado, préstamo y cuota; un doble clic, reintento o sincronización repetida no podrá duplicar pagos.

El lote confirmado conservará el resumen cerrado de la Nómina para que registrar los abonos no cambie retroactivamente su vista previa. Durante una ventana configurable se podrá deshacer el lote completo. Deshacer anulará lógicamente los pagos vinculados y restaurará el estado anterior; no borrará el historial.

### Fase futura: constancia PDF

La generación y el envío o respaldo de una constancia PDF conjunta de Nómina y préstamos quedan fuera del siguiente incremento. El proyecto dispone de exportación PDF local y de infraestructura Supabase enfocada actualmente en Caja Chica, pero el cierre de Nómina necesitará un diseño propio de permisos, destinatarios, retención, reintentos y auditoría antes de reutilizar esa infraestructura.

Los recordatorios o notificaciones por fecha también permanecen fuera de alcance.

## Verificación

```powershell
npm test -- --runInBand --testPathIgnorePatterns="\.codex-" --silent
npm run lint:state
git diff --check
```

Resultado al 2 de agosto de 2026: **7 suites Jest directamente afectadas y 41 pruebas aprobadas**, además de las pruebas funcionales y visuales de cada fase. La suite global no finalizó dentro del límite de diez minutos, por lo que no se declara como aprobada. El control de escrituras directas a `state` y la validación del diff se ejecutan nuevamente antes de publicar.

Los avisos de mocks duplicados provienen de carpetas de trabajo `.codex-*` preexistentes; no representan fallos de las suites ni forman parte de esta implementación.

## Historial por fase

| Fase | Commit | Resultado |
|---|---|---|
| Contrato de cargos | `86f5004` | Expone cuotas restantes y cargos seleccionables. |
| Cálculo de Nómina | `d2f4d44` | Resuelve una, varias o todas las cuotas consecutivas. |
| Interfaz de Nómina | `b1fc5b1` | Agrega controles de cantidad y refleja el monto seleccionado. |
| Libro e inactivos | `7aeff1f` | Distingue modalidades y permite préstamos a inactivos sin incluirlos en Nómina. |
| Próxima cuota | `772a190` | Selecciona la siguiente cuota impaga en las acciones masivas. |
| Pago desde el libro | `ceb1a0b` | Ofrece pagar una cuota, varias cuotas o el saldo completo. |
