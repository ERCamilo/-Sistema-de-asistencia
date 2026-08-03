# Préstamos en Nómina: comportamiento implementado

La revisión de Nómina calcula préstamos de pago único y en cuotas sin registrar pagos automáticamente. El operador conserva el control: una cuota se selecciona por defecto y puede ampliar la selección a varias cuotas consecutivas o a todas las restantes. Después de pagar la Nómina, un cierre general guarda la instantánea histórica y registra los abonos seleccionados en la misma operación local.

## Flujo actual

1. Registrar el préstamo desde Cuentas por Cobrar para un empleado activo o inactivo.
2. Revisar Nómina dentro de un período definido.
3. Confirmar la selección temporal: saldo completo para pago único o una cuota exigible para préstamos en cuotas.
4. Aumentar, reducir o seleccionar todas las cuotas si el empleado desea adelantar pagos.
5. Resolver cualquier neto igual o menor que cero y revisar la vista previa.
6. Confirmar que esa versión exacta de la Nómina fue pagada.
7. Abrir el resumen de cierre, verificar la Nómina y los pagos opcionales y aceptar.
8. Consultar el cierre desde `Nómina > Historial`.
9. Si hubo un error, deshacer el cierre durante los 30 segundos siguientes; también se restauran los bonos y deducciones puntuales aplicados.

> Seleccionar, revisar o exportar nunca crea abonos. Los pagos sólo se registran al aceptar el cierre verificado del paso 5.

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
- La vista previa siempre se recalcula desde el estado actual; nunca se reemplaza por una Nómina cerrada.
- Cada cierre conserva filas, totales, operador y pagos vinculados en un registro histórico inmutable.
- Deshacer anula lógicamente el cierre, los pagos vinculados y los ajustes puntuales sin borrar la auditoría.
- Un cierre corregido referencia al anterior en lugar de sobrescribirlo.
- Los lotes legacy incompletos no se migran hasta que estén presentes todos sus pagos e instantánea.
- El tamaño se valida antes de mutar préstamos o escribir localmente y conserva margen bajo el límite remoto.

## Cierre general desde Nómina

El botón amarillo `Cerrar nómina` se ubica al final del paso 5, Vista previa. También permite cerrar nóminas sin préstamos. Permanece deshabilitado salvo que se cumplan simultáneamente estas condiciones:

1. Existe al menos una fila pagable.
2. No quedan empleados con neto igual o menor que cero ni otros conflictos bloqueantes.
3. El operador confirmó que la Nómina fue pagada.
4. La confirmación corresponde exactamente al período y a la versión actual de la vista previa.
5. No existe el mismo cierre ni otro cierre vigente del período sin preparar una corrección explícita.

La confirmación de pago de Nómina se vincula a una identidad canónica de la vista previa. Cualquier cambio en el período, la asistencia, los importes o la selección de préstamos invalida esa confirmación y vuelve a deshabilitar el botón. Esto evita registrar abonos sobre una Nómina distinta de la que realmente se pagó.

### Modal de verificación

El modal es deliberadamente resumido. Siempre muestra el total neto y la cantidad de empleados. Cuando existen préstamos seleccionados, también muestra por empleado:

- préstamos o cuotas que se registrarán;
- total que se descontó en la Nómina;
- saldo pendiente después del pago;
- indicación de si queda un pago futuro.

También muestra los totales del lote. El operador debe marcar la verificación explícita antes de aceptar. Cerrar, cancelar o volver atrás antes de confirmar no modifica préstamos.

### Persistencia y deshacer

Antes de guardar se revalidan todos los saldos y cuotas. Cada lote tiene una identidad estable y cada cargo usa una clave idempotente por período, empleado, préstamo y cuota; un doble clic, reintento o sincronización repetida no puede duplicar pagos.

El cierre y los empleados afectados se escriben en una única transacción de IndexedDB junto con la intención de sincronización. Un reintento idéntico no reescribe empleados ni duplica la cola. Durante 30 segundos se puede deshacer desde el panel del paso 5 o desde el detalle histórico. Deshacer anula lógicamente los pagos vinculados, restaura los saldos y recupera una sola vez los bonos y deducciones puntuales; no elimina el cierre.

## Historial de Nómina

`Nómina > Historial` lista cierres locales en orden descendente y permite filtrar por estado y período. Cada detalle conserva los nombres, puestos e importes vigentes al cerrar, aunque después cambien empleados, asistencia o préstamos.

El historial se carga únicamente al abrir esa vista y muestra hasta 10 cierres por página. Dentro de cada cierre, los empleados se ordenan por su número histórico y pueden filtrarse por el líder congelado al cerrar. Si el número del empleado cambió, se conserva el anterior y se muestra el actual como referencia; la posición histórica nunca se sustituye por un ascenso posterior.

- `Cerrada` y `Anulada` son estados auditables; no existe borrado físico desde la interfaz.
- Bonificaciones, deducciones y préstamos sólo aparecen como columnas cuando tienen importes.
- Los préstamos usan el acento amarillo para distinguirse.
- `Pendiente de sincronizar` y `Error de sincronización` reflejan la cola local, no el estado financiero.
- La tabla es navegable por teclado y desplaza sus columnas dentro del contenedor en móvil.
- Un enlace desde el generador abre directamente el cierre vigente del período.
- Los controles de simulación permiten recalcular el neto visible sin préstamos, bonificaciones o deducciones; el resultado es sólo de consulta y no modifica el cierre.

Los cierres creados antes de guardar líderes históricos siguen siendo consultables, pero su selector de líder muestra únicamente `Todos` porque esa relación no puede reconstruirse con exactitud.

Al iniciar, los lotes históricos antiguos con `previewRows` completos se convierten de forma idempotente. Los lotes parciales se omiten y se vuelven a evaluar en otro arranque; un lote corrupto o demasiado grande se aísla para no bloquear los demás. Las nóminas antiguas sin evidencia persistida no se reconstruyen.

### Fase futura: constancia PDF

La generación y el envío o respaldo de una constancia PDF conjunta de Nómina y préstamos quedan fuera del siguiente incremento. El proyecto dispone de exportación PDF local y de infraestructura Supabase enfocada actualmente en Caja Chica, pero el cierre de Nómina necesitará un diseño propio de permisos, destinatarios, retención, reintentos y auditoría antes de reutilizar esa infraestructura.

Los recordatorios o notificaciones por fecha también permanecen fuera de alcance.

## Verificación

```powershell
npx jest --runInBand --modulePathIgnorePatterns="\.codex-" --findRelatedTests js/modules/features/payroll/PayrollLoanSettlement.js js/modules/features/payroll/PayrollLoanSettlementUI.js js/modules/features/payroll/PayrollUI.js js/modules/features/loans/LoansService.js js/modules/utils/UndoManager.js --silent
npm run lint:state
git diff --check
```

La verificación de esta entrega cubre dominio, persistencia, sincronización, migración legacy, límite de documento, privacidad, historial responsive y el ciclo aplicar/deshacer. Chrome real valida carga de módulos, IndexedDB, filtros y ausencia de desbordamiento móvil. El control de escrituras directas a `state` no detecta deuda nueva.

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
| Cierre general e historial | `99fea49` … `88b0e2d` | Persiste cierres inmutables, los sincroniza, migra evidencia legacy y separa el cálculo vivo. |
| Consistencia y paginación | `830a9e5` … `d84e745` | Unifica la huella, sincroniza empleados antes del cierre y pagina de forma diferida con filtros. |
| Anulación integral | `e571ecd` | Restaura ajustes puntuales y anula sus efectos junto con pagos de préstamos. |
| Historial interactivo | `e3f1755` | Congela organización histórica, ordena por número y agrega filtro y neto configurable. |
