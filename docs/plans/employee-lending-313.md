# Posiciones con otro líder pagador · propuesta simplificada de #313

**Estado:** diseño para revisión, 07/11/2026. Recoge la última simplificación del usuario. No implementado; esta entrega solo modifica documentación y ejemplos ficticios.

Issue: https://github.com/ERCamilo/-Sistema-de-asistencia/issues/313. Código de referencia: `92272bec` (SA 1.7.128).

## Regla acordada más reciente

Una posición distingue **Líder** (equipo al que corresponde el trabajo) y **Quién paga** (líder en cuya nómina se paga al empleado). El pagador se sugiere desde la posición principal/primera y se puede cambiar en una lista desplegable.

El importe completo que ya corresponde a la posición/asignación, con las reglas salariales normales de SA, se paga una sola vez en la nómina del pagador. En la nómina del líder del equipo aparece una deducción especial por el personal pagado desde otras nóminas.

Ya **no se propone repartir el salario entre dos pagadores**, elegir tres modalidades ni registrar una diferencia externa. Un regalo o acuerdo entre el empleado y el otro líder queda fuera de SA. Si la tarifa efectiva asignada es $900, SA maneja esos $900; no infiere otros $300 a partir de una tarifa habitual de $1,200.

Las horas parciales y recargos se calculan como en las posiciones normales; el usuario confirmó esa regla para este diseño simplificado.

## Ubicación y efecto confirmados por el usuario

Los campos se configuran **en la posición de cada empleado**, no en el puesto global para todos. Juan y otro empleado del mismo puesto pueden tener condiciones distintas. El líder del equipo se sugiere desde el puesto y el pagador desde la posición principal/primera, pero los valores aceptados pertenecen a la asignación del empleado.

El ejemplo aprobado es:

| Concepto | Importe |
| --- | ---: |
| Nómina de empleados propios del líder 2 | $500 |
| Juan, pagado desde la nómina del líder 1 | $900 |
| Grupo especial en la nómina del líder 2 | −$900 |
| **Saldo del líder 2 con el grupo activado** | **−$400** |
| Salarios individuales de empleados del líder 2 | **Se mantienen en $500** |
| Nómina de Juan en el líder 1 | **Se mantiene en $900** |

Es un **descuento real al saldo del líder 2**, no una simple reclasificación de un salario ya incluido. No se agrega una base artificial de $900 al líder 2 para neutralizarlo. Juan no vuelve a aparecer como salario positivo en su tabla de empleados.

El salario global de empleados ($1,400 en este ejemplo) y la suma de saldos a liquidar entre líderes ($500 con el ajuste) son dimensiones distintas y deben estar rotuladas. La diferencia procede del descuento de $900 al líder 2; no se presenta como si los empleados solo hubieran ganado $500.

Al desactivar el checkbox, se quita el ajuste de ese líder y su saldo vuelve a $500. Juan sigue cobrando $900 en la otra nómina. **Contraer el detalle nunca cambia importes.**

Un saldo negativo del líder no debe disparar las validaciones de salario negativo de un empleado ni bloquear por ese motivo la nómina. Se conserva firmado en el resumen/cierre del período, separado de los netos de empleados. No se crea una orden de pago negativa a un trabajador. No se propone cobrarlo o arrastrarlo automáticamente a otro período; eso requeriría un alcance posterior.

## Interfaz propuesta

### 1. Posición: líder y pagador

Se reutiliza la tarjeta de posición asignada y su tarifa, unidad, SVG y color actuales. Los campos son **Líder del equipo** y **Quién paga**, ambos por empleado/asignación. El pagador se elige en un desplegable y se sugiere desde la primera posición. Cambiar uno de estos valores no modifica el puesto global ni los demás empleados.

No hace falta otro selector de modalidad. Si líder y pagador coinciden, se paga en su nómina normal y no se genera una compensación consigo mismo. La marca de trabajo con distinto pagador puede derivarse de esos dos valores, sin sumar otro interruptor de configuración innecesario.

Cambiar el pagador no cambia la tarifa que el usuario ya configuró. Cambiar la tarifa o los responsables requiere versión/fecha efectiva para no reinterpretar lo trabajado. Deben seguir siendo legibles las identidades históricas de líderes/puestos archivados.

### 2. Asistencia y nómina del pagador

La asistencia se registra con el flujo habitual. Cada tramo usa su tarifa efectiva, calendario y recargos normales, resueltos para la posición/líder de trabajo efectivo. Cambiar únicamente el pagador no cambia el salario ni sus recargos. El registro identifica quién recibe el trabajo y quién lo paga. Seleccionar una posición no duplica las horas ni copia un sueldo completo en dos nóminas.

Juan aparece como empleado normal en la nómina del pagador, con las acciones habituales según las reglas actuales. Si también trabajó horas normales para otro líder, solo esas otras horas forman una fila/parte normal de ese líder; el trabajo que otro pagó no se vuelve a presentar como salario pagable allí.

Los préstamos monetarios, descuentos y bonificaciones siguen perteneciendo al empleado y deben aplicarse una sola vez conforme a su nómina real. El grupo especial no es otra instancia del empleado ni otro lugar donde cobrarle.

### 3. Nómina del líder del equipo: una fila especial al final

Se añade una única fila **Personal pagado por otros líderes**, al final del bloque correspondiente al líder:

- **Checkbox Aplicar descuento:** activa/desactiva el grupo completo. No cambia el salario ya atribuido al pagador.
- **Total negativo:** suma de los importes de trabajo del equipo pagados desde otra nómina, descontados realmente del subtotal del líder, según el ejemplo confirmado.
- **Desplegable de detalle:** lista de empleados y puestos, con pagador, horas/jornadas, tarifa efectiva e importe. Ejemplo: «Juan #113 · paga Luis · 1 día × $900 = $900».
- **Solo lectura:** no tiene descuentos personales, bonificaciones, selector de préstamos, cobros, recomendaciones de cobro ni selección para acciones masivas.

El checkbox y el desplegable son controles independientes. Desplegar o contraer no incluye/excluye importes. Desactivar muestra el grupo como desactivado y permite inspeccionar el detalle sin aplicarlo.

Las filas de detalle no se insertan en los arrays de empleados pagables. No basta con esconder botones: deben quedar fuera del cálculo de elegibilidad de préstamos, los comandos masivos, los conteos de salarios negativos y las validaciones por empleado. Se mantiene la validación normal para empleados reales; el ajuste y el saldo del líder admiten signo negativo sin convertirse en salarios de empleado.

Si hay varios empleados, una fila agregada contiene el total y el detalle conserva los importes de cada uno. Si hay varias tarifas/puestos por empleado, se separan sus líneas; no se inventa una tarifa media que impida conciliar.

### 4. Reportes y cierres

El Excel de **Reporte de Personal/Empleados → `report-controls-card`** conserva el trabajo real una sola vez. Las hojas de líderes separan trabajo recibido, nómina pagable, ajuste especial y saldo. Dashboard/Resumen General no suman los ajustes como otro salario ni como asistencia negativa.

Los PDF/reportes de Nómina deben usar el mismo estado del checkbox y del grupo; el ajuste no puede existir solo en el Excel y producir un total distinto en la pantalla.

La elección de aplicar el ajuste se conserva por cuenta, obra, líder y período/borrador, con el mecanismo de estado existente que se acuerde. El cierre captura explícitamente esa elección, las filas del grupo y sus importes. Reexportar no genera nuevos descuentos ni movimientos financieros.

## Ejemplos de importes de la posición

Datos ficticios; jornada de ejemplo de 8 h. La tarifa y factores son parámetros ilustrativos y no cambios a SA.

| Trabajo pagado desde otra nómina | Nómina del pagador | Grupo del líder del equipo si está activado |
| --- | ---: | ---: |
| 1 día a tarifa efectiva $900 | $900 | −$900 |
| Medio día a tarifa efectiva $900/día | $450 | −$450 |
| 1 día a tarifa efectiva $1,200 | $1,200 | −$1,200 |
| 1 día a $900 con factor 2 de ejemplo | $1,800 | −$1,800 |
| Juan: 1 día × $900; Pedro: 0.5 día × $800 | $1,300 entre ambos | Una sola fila −$1,300, con dos líneas de detalle |

Con horas extra se muestra su cálculo aparte, usando la regla existente. Por ejemplo, con $900/8 h y factor extra ilustrativo 1.35, 8 h base + 2 h extra son $900 + $303.75 = $1,203.75; no basta una fila «1 día × $900» para explicar todo el descuento.

Un feriado de 8 h sigue siendo 1 jornada real. Si el pago usa un factor 2, el detalle puede decir «1 día × $900 × 2 = $1,800», manteniendo separados días reales y equivalentes de pago. No crear un segundo día de asistencia.

Si la tarifa del puesto es habitualmente $1,200 pero Juan tiene una tarifa efectiva aceptada de $900, se calculan $900. SA no registra ni deduce un posible regalo de $300 que desconoce.

Archivos de revisión: [datos ficticios](employee-lending-313/ejemplos.json), [Excel comparativo](employee-lending-313/ejemplos-cesion.xlsx) y [fuente de maqueta](employee-lending-313/maqueta.html.example). Descargar/renombrar la fuente como `.html` permite abrirla sin conexión. Solo simula datos en memoria.

## Filtros, períodos y riesgos que hay que resolver

- **Saldo negativo de líder:** no confundirlo con salario negativo de empleado. Permitir inspeccionar/cerrar la nómina de empleados según sus validaciones, sin un falso bloqueo causado por la fila especial. El saldo firmado se conserva como resumen del período; su cobro o arrastre automático queda fuera de esta entrega.
- **Base duplicada:** el resultado aprobado es $500 − $900 = −$400. No reintroducir a Juan como salario positivo del líder 2 ni agregar otra base para cancelar el descuento. Tampoco restar dos veces el mismo grupo.
- **Selección parcial de empleados:** calcular la nómina de un subconjunto no debe aplicar automáticamente el ajuste de todo el líder o aplicarlo de nuevo al cerrar otro subconjunto. El grupo necesita una identidad de líder/período y una aplicación única. Cuando un filtro muestre solo una parte, debe indicarse; no confirmar un ajuste global desde una vista parcial sin una decisión clara.
- **Cobros y bonificaciones masivos:** la fila especial y sus empleados de detalle no son candidatos. Los comandos deben operar únicamente sobre partes de salario real a cargo del pagador.
- **Horas entre posiciones:** un empleado puede tener trabajo normal y trabajo con otro pagador. No cargar su sueldo entero en cada posición ni usar el puesto principal para reinterpretar el historial.
- **Cierre, anulación y reexportación:** si el ajuste se llega a contabilizar, su referencia tiene que ser única y reversible por el mismo cierre; no duplicarlo al exportar o reintentar. Esta entrega de diseño no crea ese asiento ni define una liquidación financiera nueva.
- **Datos viejos o incompletos:** sin pagador explícito se mantiene el comportamiento legacy hasta configurar el caso. No asignar pagadores históricos ni crear compensaciones retroactivas silenciosas.

## Modelo técnico propuesto para implementar después de revisar el diseño

Separar trabajo, salario por pagar y ajuste del líder. Los nombres siguientes son ilustrativos:

- Asignación del empleado: `workLeaderId`, `payerLeaderId`, tarifa vigente y versión/fecha efectiva. El primero puede sugerirse desde el catálogo y el segundo desde la primera posición; no son modificaciones globales del puesto.
- Tramo de asistencia: posición, horas base/extra y datos históricos de equipo, pagador y condiciones aceptadas. Las horas tienen una sola fuente.
- Nómina canónica de empleados: salarios reales con sus pagadores, sin filas falsas de empleado para representar la deducción del líder.
- `leaderPayrollAdjustment`: colección separada, con líder afectado, período/obra, `enabled`, total y detalle de trabajo pagado por otros líderes. No participa en los ajustes ni préstamos personales.
- Resumen del líder: subtotal de empleados pagables, ajuste opcional y saldo firmado. Fórmula: saldo = subtotal − ajuste activado. Los netos de empleados se conservan. No sustituye el neto de cada empleado.

El cierre congela la configuración, las identidades, los factores, los importes y el estado del checkbox. Cambiar después un puesto, pagador o catálogo no reescribe los cierres históricos. Mini/SplitX y respaldos requieren compatibilidad explícita; un cliente antiguo no debe borrar información nueva que desconoce.

## Puntos que exigiría el código actual

Base revisada: `92272bec`.

- `EmployeePositionEditor.js` / `EmployeeEditorDraft.js`: incluir los campos en borradores, validación y resolución de cambios sin perder tarifas editadas.
- `Attendance.js` / `AttendanceService.js`: conservar reparto y datos históricos; revisar agrupación por posición ante cambios de versión/pagador.
- `PayrollService.js` y resolución de tarifas: reutilizar el cálculo salarial vigente; atribuir cada parte al pagador sin otra fórmula en el reporte.
- `PayrollPreview.js: filterPayrollRowsByLeader`: hoy filtra por puestos del líder. Debe diferenciar trabajo del equipo y salario pagable, con un resumen separado para el ajuste.
- `PayrollReviewTable`, `PayrollLoans`, descuentos/bonificaciones y acciones masivas: excluir el grupo especial de los modelos de empleado, no solo de la interfaz.
- `PayrollClosure*` y fingerprints: impedir doble aplicación en cierres parciales o reintentos, conservar el estado del checkbox y no cerrar como pagado un saldo negativo del líder.
- `EmployeeReportData.js` / `AnalyticsUI.js: exportEmployeeReportExcel, generateLeaderSheets`: presentar trabajo y compensación por separado, sin días negativos ni salarios duplicados en el resumen.
- Respaldos, sync e importaciones: respetar cuenta/obra y versiones; no reinterpretar datos anteriores ni ignorar cambios de asignación al restaurar.

## Secuencia propuesta y responsables

1. **Usuario:** revisar la maqueta y el Excel con las reglas ya confirmadas; validar presentación y alcance.
2. **Agente SA:** cerrar el modelo de asignaciones, compatibilidad y aplicación única en cierres parciales. Los saldos negativos de líderes se separan de las validaciones de empleados.
3. **Agente SA:** implementar campos, reparto histórico, atribución salarial y grupo opcional; conservar fórmulas salariales vigentes.
4. **Agente SA:** revisar filtros, préstamos, acciones masivas, validaciones y cierres/exportaciones para que el grupo no actúe como un empleado.
5. **Agente SA y usuario:** validar día/medio día/recargos, varios empleados, pagador igual al líder, checkbox, detalles, filtros, cierres/reintentos y móvil antes de integrar.

La fase actual sigue siendo el diseño. Las modalidades de reparto y el seguimiento del pago externo de la versión anterior de la propuesta quedan descartados por la última instrucción del usuario.

## Verificación del diseño y criterios de la implementación futura

La maqueta se comprobó en Chromium a 320, 390 y 1280 px: campos por empleado, salario completo, 500−900=−400, grupo único con varios empleados, detalle y checkbox independientes, selección de otro pagador y coincidencia equipo/pagador. Se conserva foco/scroll, un solo shell, pie visible y ausencia de desbordamiento horizontal. No realiza peticiones a servicios externos; WCAG A/AA en las vistas comprobadas.

El Excel compara el estado aplicado/desactivado y los casos de uno/dos empleados. Sus fórmulas y valores iniciales fueron revisados para −400/−800 al aplicar y $500 al desactivar, sin cambiar los salarios de los empleados. Medio día $450, tarifa efectiva $1,200, recargo de ejemplo $1,800 y extra de ejemplo $1,203.75 coinciden con sus importes detallados. No se ejecutaron operaciones de SA.

La implementación deberá demostrar además:

- Sin otra nómina pagadora, los resultados actuales se conservan.
- En el líder del equipo solo hay empleados normales por sus salarios reales y una fila de ajuste separada; Juan no aparece como otro empleado pagable por el mismo tramo.
- El grupo y sus hijos no admiten descuentos, bonos, préstamos ni selección en acciones masivas; tampoco aumentan el conteo de empleados a pagar de ese líder.
- Contraer/expandir no cambia importes; el checkbox cambia únicamente el ajuste del líder.
- Un saldo negativo del líder no entra en el neto ni las validaciones de salario de un empleado; las validaciones de empleados reales siguen activas.
- El grupo se aplica una sola vez por líder/período, también con cierres parciales, reintentos y exportaciones repetidas; el cierre conserva el estado del checkbox y el saldo firmado.
- Las tarifas, puestos, responsables e importes históricos no se reescriben al editar perfiles o catálogos posteriormente.
- Resumen de salarios y saldo de líderes se identifican por separado; no se presenta uno como si fuera el otro.

La autorización actual cubre esta propuesta de diseño. El PR de documentación no habilita la función ni sustituye el PR de implementación posterior.
