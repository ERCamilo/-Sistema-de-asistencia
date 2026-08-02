# Préstamos en Nómina: comportamiento implementado

La revisión de Nómina calcula préstamos de pago único y en cuotas sin registrar pagos automáticamente. El operador conserva el control: una cuota se selecciona por defecto, puede ampliar la selección a varias cuotas consecutivas o a todas las restantes y, después de pagar la Nómina, registra los abonos mediante una confirmación separada.

## Flujo actual

1. Registrar el préstamo desde Cuentas por Cobrar para un empleado activo o inactivo.
2. Revisar Nómina dentro de un período definido.
3. Confirmar la selección temporal: saldo completo para pago único o una cuota exigible para préstamos en cuotas.
4. Aumentar, reducir o seleccionar todas las cuotas si el empleado desea adelantar pagos.
5. Resolver cualquier neto igual o menor que cero y revisar la vista previa.
6. Confirmar que esa versión exacta de la Nómina fue pagada.
7. Abrir el resumen de cierre, verificar los pagos y aceptar su registro.
8. Si hubo un error, deshacer el lote durante los 30 segundos siguientes.

> Seleccionar o exportar nunca crea abonos. Los pagos sólo se registran al aceptar el modal final del paso 5.

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
- La confirmación de Nómina pagada se invalida si cambia el período, un importe o la selección de cargos.
- Los saldos y planes de cuotas se revalidan antes de mutar; un conflicto aborta todo el lote.
- Un doble clic, reintento o repetición desde otro dispositivo no duplica pagos.
- Un lote parcial recibido por sincronización queda bloqueado hasta recibir todos sus pagos.
- El resumen cerrado se reconstruye desde los abonos persistidos y no cambia al reducirse los saldos.
- Deshacer anula lógicamente todos los pagos del lote y conserva el historial.

## Cierre de préstamos desde Nómina

El botón amarillo se ubica al final del paso 5, Vista previa. Permanece deshabilitado salvo que se cumplan simultáneamente estas condiciones:

1. Existe al menos un préstamo o una cuota aplicado al resumen.
2. No quedan empleados con neto igual o menor que cero ni otros conflictos bloqueantes.
3. El operador confirmó que la Nómina fue pagada.
4. La confirmación corresponde exactamente al período y a la versión actual de la vista previa.

La confirmación de pago de Nómina se vincula a una identidad canónica de la vista previa. Cualquier cambio en el período, la asistencia, los importes o la selección de préstamos invalida esa confirmación y vuelve a deshabilitar el botón. Esto evita registrar abonos sobre una Nómina distinta de la que realmente se pagó.

### Modal de verificación

El modal es deliberadamente resumido. Muestra por empleado:

- préstamos o cuotas que se registrarán;
- total que se descontó en la Nómina;
- saldo pendiente después del pago;
- indicación de si queda un pago futuro.

También muestra los totales del lote. El operador debe marcar la verificación explícita antes de aceptar. Cerrar, cancelar o volver atrás antes de confirmar no modifica préstamos.

### Persistencia y deshacer

Antes de guardar se revalidan todos los saldos y cuotas. Cada lote tiene una identidad estable y cada cargo usa una clave idempotente por período, empleado, préstamo y cuota; un doble clic, reintento o sincronización repetida no puede duplicar pagos.

El lote confirmado conserva una instantánea compacta del resumen cerrado para que registrar los abonos no cambie retroactivamente la vista previa. Durante 30 segundos se puede deshacer el lote completo desde la notificación o el panel del paso 5. Deshacer anula lógicamente los pagos vinculados y restaura los saldos; no borra el historial.

### Fase futura: constancia PDF

La generación y el envío o respaldo de una constancia PDF conjunta de Nómina y préstamos quedan fuera del siguiente incremento. El proyecto dispone de exportación PDF local y de infraestructura Supabase enfocada actualmente en Caja Chica, pero el cierre de Nómina necesitará un diseño propio de permisos, destinatarios, retención, reintentos y auditoría antes de reutilizar esa infraestructura.

Los recordatorios o notificaciones por fecha también permanecen fuera de alcance.

## Verificación

```powershell
npx jest --runInBand --modulePathIgnorePatterns="\.codex-" --findRelatedTests js/modules/features/payroll/PayrollLoanSettlement.js js/modules/features/payroll/PayrollLoanSettlementUI.js js/modules/features/payroll/PayrollUI.js js/modules/features/loans/LoansService.js js/modules/utils/UndoManager.js --silent
npm run lint:state
git diff --check
```

Resultado al 2 de agosto de 2026: **40 suites relacionadas y 438 pruebas aprobadas**. La prueba aislada en Chrome verificó escritorio y móvil, carga de módulos sin errores, modal cancelable y el ciclo aplicar/deshacer con restauración exacta del saldo. El control de escrituras directas a `state` no detectó deuda nueva.

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
| Regla de habilitación | `bc9e755` | Vincula la confirmación de pago a la vista previa exacta. |
| Lotes persistentes | `71dac8e` | Registra pagos idempotentes y conserva el resumen cerrado. |
| Sincronización parcial | `618728d` | Bloquea lotes incompletos recibidos desde otro dispositivo. |
| Botón, modal y deshacer | `bd197e5` | Implementa el cierre guiado en el paso 5 y la ventana de 30 segundos. |
| Endurecimiento final | `d3c0ed8` | Compacta la instantánea, renueva la ventana al registrar y evita reutilizar pagos. |
