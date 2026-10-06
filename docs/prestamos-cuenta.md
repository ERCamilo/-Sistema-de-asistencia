# Cuenta de préstamos · fase A (cómo se guardan los registros)

Módulo: `js/modules/features/loans/LoanAccount.js`. Pruebas: `js/tests/LoanAccount.test.js`.
Página de pruebas sin conexión: `pruebas/cuenta-prestamos.html`. Carga un respaldo .json en memoria; no guarda ni envía nada.

Esta fase solo agrega el registro y las reglas. Las pantallas actuales no cambian. Los formularios y la pantalla nueva llegan en la fase B, y la conversión de los datos viejos en la fase D.

## Qué es la cuenta

Son todos los préstamos abiertos del empleado en su obra: el `projectId` del préstamo o, si no tiene, el del empleado. Los préstamos llevan un número (#1, #2…) según el orden de creación (`getLoanNumbers`).

## Qué se guarda

| Registro | Dónde | Campos nuevos |
|---|---|---|
| Abono a la cuenta | Un `payment` por cada préstamo que toca | `origin: 'account'`, `accountTxId` (el mismo en todas las partes), `allocation {interest, capital}` (el reparto del momento) |
| Abono directo / de nómina | `payment` | `origin: 'direct' \| 'payroll'`, `allocation` |
| Refinanciamiento | `refinancing` en cada préstamo | `origin`, `accountTxId`, `reason` (`payroll-short`, `not-worked`, `agreement`, `other`), `payrollPeriodStart/End` (la nómina que no alcanzó), `nextDueDate` (la nómina que cobra ahora) |
| Nómina de cobro | `loan.dueDate`, `loan.dueDateSetAt` | `getLoanDueDate` usa el último refinanciamiento, salvo que una edición posterior la haya cambiado |
| Edición | `loan.edits[]` | `before`, `after`, `reason`, `balanceBefore/After`, `closureEdit`, `closureIds`, `voided` |
| Cierre con motivo | `loan.closure`, `loan.closureHistory[]` | `reason` (`error`, `forgiven`, `other`), `note`, `forgiven {capital, interest}` |
| Ajuste de un movimiento cerrado | `payment` con monto negativo o `refinancing` con interés negativo | `adjustment {ofId, ofKind, interest, capital, lockedClosureId}`; el original queda con `adjustedBy` |
| Corrección de un cierre | En el movimiento anulado | `closureFix {reason, by, at, closureIds, before.accountBalance, after.accountBalance}` |
| Acuerdo de pago | `emp.loanAgreements[]` | `amount`, `startPayDate`, `interestMode`/`rate`, `onNewLoan`, `belowInterest`, `replaces`/`replacedBy`, `voided` |

En la sincronización entre dispositivos, `loan.edits[]` y `emp.loanAgreements[]` se unen por id, igual que los abonos (`EmployeeMerge`).

## Reglas

1. **Abono a la cuenta:** primero el interés de todos los préstamos y después el capital del más viejo. No acepta más de lo que debe. Si falla en algún préstamo, no queda nada a medias.
2. **Refinanciar la cuenta:**
   - el motivo es obligatorio, y con «otro» también la nota;
   - por defecto toma todo lo vencido hasta esa nómina;
   - cada préstamo pasa a cobrarse en `nextDueDate`.
3. **Candado por cierre:**
   - un movimiento con `payrollClosureId` de un cierre vigente no se anula directo;
   - un préstamo con al menos uno de esos movimientos está «con cierre»;
   - si el cierre se deshace, el candado desaparece.
4. **Anular algo sin cierre:** se anula, en todos los préstamos si vino de la cuenta. Los abonos a la cuenta posteriores sin cierre se vuelven a repartir; sus partes anteriores quedan anuladas con `voidReason: 'reallocated'`.
5. **Corregir algo con cierre:** hay dos caminos.
   - **Ajuste** en la nómina abierta: devuelve exactamente lo que el movimiento tocó y el cierre no cambia.
   - **Corregir el cierre:** solo por error. Exige motivo y guarda el saldo antes y el resultado.
6. **Editar un préstamo:** sin cierre se puede editar libremente; con cierre el motivo es obligatorio y queda marcado como «cierre editado». Se puede deshacer la última edición.
7. **Cerrar con motivo:**
   - **error:** solo si el préstamo no tiene abonos ni refinanciamientos; queda anulado;
   - **perdonado:** guarda el capital y el interés que se perdonaron;
   - **otro:** exige una nota.
8. **Acuerdo de pago:**
   - el mínimo sugerido cubre el interés pendiente, pero es solo una sugerencia;
   - un acuerdo nuevo reemplaza al anterior y queda enlazado con él;
   - la proyección se hace nómina por nómina.

## Respaldo real (Johan, 2026-10-05)

- 165 préstamos, 43 abiertos y 22 cuentas con saldo: $167,185.40, igual que la suma de saldos de la app.
- La línea de tiempo coincide con el saldo en los 43 préstamos abiertos.
- 17 abonos están ligados a los 2 cierres vigentes.
- 132 de 149 abonos no tienen origen; se muestran como «directo» hasta la fase D.
- Ningún préstamo abierto tiene nómina de cobro guardada; se completa en la fase D.

## Fase B (ficha del empleado)

`LoanAccountView.js` dibuja la ficha nueva y `LoanAccountController.js` maneja sus acciones (`window.la*`). Los estilos están en `css/loan-account.css` y los periodos de nómina en `LoanPayPeriods.js`, que los calcula desde `payPeriod` de la configuración de Nómina.

- **Tarjeta principal:**
  - lo que debe en total, con la barra de lo pagado (interés y capital) y lo pendiente;
  - la próxima nómina: el acuerdo, si hay uno, o lo que vence;
  - lo que gana por periodo y el último abono.
- **Botones:** Abonar, Refinanciar, + Préstamo y Acuerdo.
- **Pestaña «Préstamos»:** los préstamos numerados, que se abren para ver su detalle y sus acciones (Pagar #n, Refinanciar #n, Editar y Anular préstamo).
- **Pestaña «Movimientos de la cuenta»:** cada movimiento con su origen y el candado 🔒 si está en un cierre de nómina, más la ✕ para anular, ajustar o corregir el cierre.
- **Nómina por defecto en las ventanas:**
  - al abonar y al refinanciar, la última nómina ya pagada;
  - al crear un préstamo y en el acuerdo, la próxima.
- Las nóminas que ya tienen un cierre aparecen como «cerrada» y no se pueden elegir.
- **«Vista anterior»** vuelve a la ficha de antes, solo en ese dispositivo (`localStorage` `loans-account-view = classic`). Las pruebas de la ficha anterior la fijan así.
- **Consolidar** solo queda en la vista anterior; se quita en la fase C.

## Fase C (Consolidar se quita; las consolidaciones se deshacen)

Decidido el 2026-10-05: las consolidaciones se deshacen y los préstamos vuelven a ser separados (`LoanConsolidationUndo.js`).

- **Qué hace al deshacer:**
  - **Préstamos de origen:** se reabren con su capital e interés reales.
  - **Interés propio del consolidado y sus refinanciamientos:** pasan a los de origen como refinanciamientos con motivo `consolidation`, repartidos según lo que debía cada uno.
  - **Abonos del consolidado:** se reparten con la regla de la cuenta (`origin: 'conversion'`, `convertedFrom`), con la misma fecha, nómina y cierre. El original queda anulado con `voidReason: 'consolidation-undone'`.
  - **Préstamo consolidado:** queda anulado con `consolidationUndone` (incluye una copia para revertir).
- **Saldo y cierres:**
  - El total por cobrar no cambia.
  - El cierre de nómina tampoco: sigue vigente mientras existan las partes convertidas.
  - Si se deshace el cierre, también se anulan esas partes.
- **Revertir:** «Volver a consolidar» (`restoreConsolidation`) anula las partes convertidas (no las borra, para que la sincronización no las resucite) y reactiva lo original.
- **En la app:**
  - La tarjeta principal avisa de cada consolidación pendiente y abre una vista previa antes de deshacerla.
  - El botón y el formulario de Consolidar se quitaron de la vista anterior.
- **En la página de pruebas:** «Deshacer todas (prueba)» comprueba con un respaldo que el total no cambia.

## Fase D (completar los datos viejos)

`LoanDataBackfill.js` solo rellena lo que falta: no cambia montos, saldos ni abonos. Es determinista (dos dispositivos llegan a lo mismo) y se puede aplicar varias veces.

- **Número fijo** (`loan.number`): por orden de creación. Los préstamos nuevos toman el siguiente (`nextLoanNumber`).
- **Nómina de cobro** (`loan.dueDate`) de pago único: el día de pago del periodo en que se entregó. Los refinanciamientos sin `nextDueDate` reciben la nómina siguiente a su fecha. Con esto se activa «Vencido».
- **Origen de abonos:** del último día del periodo hasta 3 días después del día de pago es descuento de nómina (`origin: 'payroll'`, con su periodo). Fuera de esa ventana queda como directo con `needsReview`. Los anulados no se revisan.
- **En la app:**
  - la pantalla principal de Préstamos muestra «Completar datos de préstamos» (con confirmación);
  - «Abonos por revisar» tiene los botones Nómina y Directo;
  - en movimientos aparece la etiqueta «revisar».
- **Respaldo real del 2026-09-29:**
  - 165 números fijos y 164 nóminas de cobro;
  - 23 refinanciamientos con la nómina siguiente;
  - 137 abonos de nómina, 5 directos anulados y 7 por revisar;
  - lo que se debe no cambia: $167,185.40.

## Pantalla principal de Préstamos

`LoanPortfolio.js` calcula las cifras, `LoanRisk.js` el riesgo, `LoanPortfolioView.js` dibuja el resumen, la línea del mes y los avisos, y `LoanPortfolioList.js` la barra de filtros y la lista. «Usar la vista anterior» (en la (i) de la línea del mes) vuelve a la de siempre, solo en ese dispositivo.

**Diseño:** el de la maqueta (paleta 5 «Neón»): grises neutros, acento amarillo; capital azul, interés amarillo, refinanciamiento morado, pagos verde y avisos rojo. Todo el CSS está bajo `.is-portfolio` en `css/loan-account.css`, así que la vista anterior y la ficha del empleado no cambian.
- **Lista:** una sola tarjeta; «Creado dd/mm/aaaa», un punto morado con la fecha del último refinanciamiento y, a la derecha, el saldo y la última modificación («hace X h» si fue hoy).
- **Barra:** Por empleado / Por préstamo, Con saldo / Todos / Inactivos / Saldados, «+ Agregar nuevo», buscador, Ordenar (Fecha del préstamo, Monto, Nº empleado) y «Filtros avanzados» (saldo, fecha, último pago, última actualización).
- **Historial del saldo:** cabecera con barra capital/interés y «Ocultar»; en «Por mes / Por periodo» no hay botones de rango y la explicación va al final. En teléfono la gráfica se desliza y empieza en lo más reciente.
- **Teléfono:** las 4 cifras en 2×2; al tocar una, su detalle se abre debajo a todo el ancho.

**Qué muestra:**
- **Línea del mes:** saldo al empezar el mes y hoy, sin anulados. La (i) explica el cambio: préstamos nuevos con su interés, refinanciamientos, abonos, cerrados o ajustes, y cuánto cambió el mes anterior.
- **«Avisos que necesitan una decisión»:** repetidos, empleados en riesgo, inactivos con deuda, consolidaciones por deshacer, datos por completar y abonos por revisar.
- **Gráfica por periodo** abierta, con el modo detallado.
- **Resumen de cartera:** a la derecha en escritorio y arriba, en 2×2, en teléfono.
  - **Por cobrar:** capital, interés inicial y de refinanciamientos (estimado), y quién debe más.
  - **Interés ganado:** cobrado de un total igual a cobrado + por cobrar.
  - **Cobrado** y **Prestado**.

**Cómo lee los datos:** la pantalla lee los datos como si ya se hubieran deshecho las consolidaciones y completado los datos viejos (`prepareLoanEmployees`, sobre una copia). Las cachés usan una firma por préstamo.

**«Vencido» con margen** (`VENCIDO_GRACE_DAYS = 3`): un cobro vence 3 días después del día de pago, la misma ventana con la que se anotan los descuentos.

**Riesgo:**
- **Reglas:** las de la maqueta.
- **Lo atrasado:** préstamos cuya nómina de cobro **original** pasó (más el margen). Un refinanciamiento mueve el cobro, pero no quita el atraso.
- **Sueldo:** el mismo cálculo que Nómina, en este orden:
  1. lo que gana en el periodo actual, proyectado, si ya lleva 7 días o más;
  2. si no, el promedio de los 2 periodos anteriores;
  3. si tampoco hay, el sueldo configurado.

**Verificado con el respaldo del 29/09 contra la maqueta:**
- **Coincide:**
  - por cobrar $167,185.40, con todo su desglose;
  - los 5 que más deben;
  - el interés ganado: $66,494 de $94,314;
  - cobrado $443,479;
  - prestado $476,150 (70.7 % devuelto);
  - el riesgo: 12 empleados, 3/5/4.
- **Difiere, por error de la maqueta:** la línea del mes da $87,604 al empezar septiembre, porque la maqueta contaba un préstamo anulado por error.
