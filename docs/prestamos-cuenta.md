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
- **Historial del saldo:** cabecera con barra capital/interés y «Ocultar»; en «Por mes / Por periodo» no hay botones de rango y la explicación va al final. En teléfono la gráfica se desliza y empieza en lo más reciente. Colores de la gráfica: lo que venía de antes en azul oscuro (su parte refinanciada más oscura) y lo que faltó en azul tenue; el interés siempre separado (al prestar, por refinanciar y cobrado), también sin «Detallado». La barra izquierda es todo lo que se debía en el periodo, no el saldo: una línea punteada marca el saldo al cerrar cada periodo.
- **Teléfono:** las 4 cifras en 2×2; al tocar una, su detalle se abre debajo a todo el ancho.
- **Detalle de cada cifra** (una abierta a la vez; «Por cobrar» por defecto), con su barra, filas, (i) y «Qué hacer»:
  - **Interés ganado:** ganado del interés inicial y de refinanciamientos (estimado: los abonos cubren primero el inicial), por cobrar todavía e interés total; la (i) dice lo perdonado y los anulados.
  - **Cobrado:** capital devuelto, interés, pagado de más (rayado) y «Cómo entró»: descontado en nómina (origen nómina o con cierre) o abonado directamente.
  - **Prestado:** ya devuelto, por devolver, perdonado y número de préstamos; la (i) dice cuántos préstamos se anularon por error y por cuánto. Los consolidados deshechos no cuentan como anulados.

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

## Exportar (Excel y PDF)

Botón «Exportar» en la línea del mes de la pantalla principal (`LoanExportPanel.js`; los datos en `LoanExport.js`, funciones puras con pruebas).

- **Rango:** mes, periodo de nómina o personalizado. El mes o periodo en curso termina hoy.
- **Qué incluir:** resumen (cómo cambió el saldo en el rango y la cartera hoy), lista por empleado, lista por préstamo (opcionalmente con los anulados), movimientos del rango e historial.
- **Vista previa:** saldo al empezar + préstamos nuevos con su interés + refinanciamientos − abonos − cerrados = saldo al terminar; cuadra con la gráfica por mes o periodo.
- **Excel** (ExcelJS, se carga al usarlo): una hoja por parte, montos como números con formato de moneda, encabezado fijo. El historial es el saldo día por día.
- **PDF** (jsPDF + autotable): encabezado con la obra, el rango y la fecha de emisión; resumen en dos columnas, gráfica del saldo al cerrar con lo prestado y lo cobrado por periodo (los periodos completos que tocan el rango) y las tablas.
- Se exporta la obra activa, leída igual que la pantalla (interés primero, consolidaciones deshechas, datos completados en una copia).

### Gráfica por mes / por periodo (una sola vista) y puente

- Ya no hay casilla «Detallado»: queda una sola gráfica. A la izquierda va lo que se debía (lo que venía de antes en azul oscuro, más el capital, el interés al prestar y el interés por refinanciar). A la derecha va lo cobrado (interés y capital). La línea punteada marca el saldo al cerrar.
- Al tocar una barra aparece el **puente** de ese mes o periodo (`renderFlowBridge`): venía de antes → + capital → + interés → + por refinanciar → − cobrado a interés → − cobrado a capital → saldo. La tabla anterior queda plegada en «Ver el desglose en tabla».

### Exportar «Para IA» (Markdown sin datos personales)

`LoanAiReport.js` (función pura) arma un `.md` para pedirle un análisis a una IA:
- **Contenido:**
  - contexto de cómo funcionan los préstamos y los cobros;
  - calidad de los datos: repetidos, abonos por revisar, nóminas ya pasadas sin descuentos registrados y periodos sin asistencia guardada;
  - la cartera hoy;
  - el historial por periodo y por mes;
  - los descuentos de nómina por periodo (y si están en un cierre);
  - la antigüedad de la deuda;
  - el riesgo con sus razones;
  - por empleado: préstamos, abonos y lo que ganó en los últimos 6 periodos frente a su sueldo normal (lectura: faltó, normal o con horas extra);
  - preguntas sugeridas.
- **Sin datos personales:** los empleados van solo por su número de empleado. No lleva nombres, notas, conceptos ni identificadores internos.
- **De dónde sale lo ganado:** del mismo cálculo de asistencia que Nómina (`computeAttendanceDetailEarnings`). Lo normal sale de `getEmployeePeriodSalary` para un periodo completo.

### Decisiones del 06/10 (orden del mismo día, refinanciar sin interés, historial completo)

- **Mismo día:** un abono y un refinanciamiento del mismo día se reproducen en el orden en que se registraron (`recordedAt` / `createdAt`). Lo normal es cobrar en nómina y refinanciar lo que quedó. Sin hora, el refinanciamiento va primero, como antes. El total no cambia; solo el reparto entre interés y capital. Con el respaldo del 05/10 cambian 4 préstamos: pasan $2,474 de «interés cobrado» a «capital cobrado».
- **Refinanciar sin interés:** el formulario pregunta «¿Cobrar interés por refinanciar?». Con «No» solo pasa el cobro a la nómina siguiente, sin cargo, para aliviar al empleado. El servicio solo acepta tasa 0 con `noInterest: true`. Por defecto se cobra sobre el saldo, que incluye el interés pendiente; se puede elegir «Solo capital».
- **Exportar:** nuevo rango «Todo el historial», desde el primer préstamo hasta hoy.

### Nómina paso 4: cuánto descontar de préstamos y planes guardados

- **Cuánto descontar** (por empleado, dentro de «Préstamos del período»): Todo, Solo interés u Otro monto.
  - Se guarda en la selección de la nómina como `mode` y `amount` (`PayrollLoans.js`).
  - Solo interés y Otro monto se reparten como un abono a la cuenta: primero el interés de todos los préstamos marcados y después el capital del más viejo, sin pasar de lo que se cobraría en esa nómina por préstamo.
  - Al cerrar la nómina se registra exactamente lo repartido en cada préstamo.
  - Se mantienen el encabezado, «Aplicar próximos cargos», «Limpiar selección», el «+» y la casilla de tres estados:
    - completo: todo marcado y «Todo»;
    - parcial: solo interés, otro monto o algunos préstamos;
    - ninguno.
  - El encabezado «Intereses» sigue siendo el interés total de los préstamos marcados.
- **Planes programados** (`PayrollAdjustmentPlanEdit.js`):
  - **Editar** (activo o pausado): sin cuotas aplicadas se cambia todo; con cuotas aplicadas en nóminas cerradas, esas quedan con candado y solo cambia lo pendiente, desde una nómina posterior a la última aplicada.
    - Las cuotas pendientes reemplazadas quedan canceladas, sin borrarse, para que una copia vieja de otro dispositivo no las reactive.
    - La edición se guarda en `plan.edits` con el antes y el después.
  - **Borrar / Borrar lo pendiente:** igual que antes.
  - **Quitar de la lista** (completado o cancelado): lo oculta de Programados (`archivedAt`) y conserva el historial.

### Pantalla principal: todo plegado por defecto

Los avisos, el historial del saldo y las tarjetas del resumen empiezan plegados. Si el usuario los deja abiertos, se recuerda solo en ese dispositivo (`LoanUiMemory.js`, `localStorage` `loans-main-ui`).

### Consolidación de una consolidación

Si C2 consolidó a C1, y C1 a su vez consolidó a A y B:
- **Orden:** se deshacen de afuera hacia adentro (`consolidationUndoOrder`), en «Deshacer todas» y en la lectura de la pantalla principal.
- **Bloqueos:** deshacer C1 mientras sigue dentro de C2 se bloquea, porque contaría la deuda dos veces. «Volver a consolidar» C2 pide antes volver a consolidar C1.
- **Las dos marcas:** un préstamo reabierto guarda `consolidationUndone.from`; un consolidado deshecho guarda `sourceIds` y `snapshot`.
- **Comprobado con el respaldo de prueba del 27/09:** antes, la pantalla principal mostraba $136,709 en lugar de $114,175.
