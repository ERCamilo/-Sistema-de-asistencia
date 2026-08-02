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
| Cuotas | Selecciona por defecto la cuota impaga más próxima cuya fecha vence dentro del período de Nómina. |
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

## Siguiente incremento

Quedan deliberadamente fuera de este cambio:

- Botón amarillo para confirmar préstamos o cuotas desde Nómina.
- Modal de confirmación por empleado y préstamo.
- Registro persistente de los abonos confirmados.
- Acción para deshacer una confirmación errónea.
- Recordatorios o notificaciones por fecha.

La confirmación futura debe revalidar el saldo en el momento de guardar y usar una clave idempotente por período, empleado, préstamo y cargo. El pago y su marca de aplicación deben persistirse como una sola operación lógica; deshacer debe anular esos pagos vinculados, no borrarlos.

## Verificación

```powershell
npm test -- --runInBand --testPathIgnorePatterns="\.codex-" --silent
npm run lint:state
git diff --check
```

Resultado al 1 de agosto de 2026: **234 suites y 2454 pruebas aprobadas**, sin deuda nueva de escrituras directas a `state`.

Los avisos de mocks duplicados provienen de carpetas de trabajo `.codex-*` preexistentes; no representan fallos de las suites ni forman parte de esta implementación.

## Historial por fase

| Fase | Commit | Resultado |
|---|---|---|
| Contrato de cargos | `7ec1c21` | Expone cuotas restantes y cargo exigible. |
| Cálculo de Nómina | `bb0e2da` | Resuelve una, varias o todas las cuotas consecutivas. |
| Interfaz de Nómina | `1ae8110` | Agrega controles de cantidad y refleja el monto seleccionado. |
| Libro e inactivos | `7aa2713` | Distingue modalidades y permite préstamos a inactivos sin incluirlos en Nómina. |
