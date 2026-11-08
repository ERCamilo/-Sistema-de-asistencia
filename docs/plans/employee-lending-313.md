# Posiciones con otro líder pagador · propuesta simplificada de #313

**Estado:** diseño para revisión, 08/11/2026. Incluye líder predeterminado editable por empleado y préstamo con pagador separado. No implementado; esta entrega solo modifica documentación y ejemplos ficticios.

Issue: https://github.com/ERCamilo/-Sistema-de-asistencia/issues/313. Código de referencia: `92272bec` (SA 1.7.128).

## Regla acordada más reciente

Cada posición asignada muestra siempre **Líder del equipo**, inicialmente seleccionado desde el líder predeterminado del puesto. Como ocurre con la tarifa sugerida, se puede cambiar desde esa misma tarjeta solo para ese empleado, sin cambiar el catálogo ni a sus compañeros. Esto también se permite en su posición principal y no exige marcarla como préstamo.

El switch **Posición de préstamo** muestra la etiqueta sólida **Préstamo** y expande únicamente **Líder que paga**. Se sugiere desde el líder efectivo de la posición principal/primera y se puede cambiar en una lista desplegable. Sin préstamo, paga el líder efectivo del equipo, incluido un líder distinto del predeterminado del catálogo.

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

Se reutiliza la tarjeta de posición asignada, con su tarifa, unidad, SVG y color actuales.

- **Líder del equipo:** desplegable siempre visible, junto a la tarifa. Al asignar un puesto muestra seleccionado su líder predeterminado, identificado por una nota breve. Puede cambiarse para ese empleado sin activar préstamo, también en la posición principal. Una nota breve distingue el valor del catálogo de una elección individual.
- **Switch «Posición de préstamo»:** inicialmente apagado para datos sin configuración. Al activarlo aparece la etiqueta sólida **Préstamo** y se expande únicamente el selector del pagador. No oculta ni reinicia el líder del equipo.
- **Líder del equipo con préstamo:** su nómina recibe el grupo de descuento cuando paga otro líder.
- **Líder que paga:** nómina en la que se paga el importe completo. Se sugiere desde la primera posición y puede cambiarse en un desplegable.
- **Ayuda «?» junto al título del switch:** pulsable con ratón, teclado y teléfono; abre un modal contextual independiente con una explicación breve y un diagrama. No depende de pasar el cursor ni expande la tarjeta.

El modal **Equipo y pagador** mantiene la tarjeta de posición detrás, sin reemplazarla ni modificar sus campos. Se cierra con **Entendido**, la X, Escape o pulsando fuera. Mientras está abierto, el foco queda dentro de la ayuda; al cerrar vuelve a «?» y se conserva el scroll y los líderes seleccionados. En pantallas bajas, solo se desplaza el contenido de ayuda y el botón de cierre sigue accesible.

La ayuda muestra dos recorridos, para no dar a entender que dos líderes pagan el mismo sueldo:

```text
Luis (paga)    → nómina de Luis   → Juan recibe su sueldo
Marcos (equipo) → su nómina      → descuento por ese trabajo
```

Las dos rutas representan un salario único y un ajuste separado. No se dibuja «Luis paga a nómina de Marcos y Marcos vuelve a pagar a Juan», porque la regla confirmada ubica el sueldo en la nómina de Luis. Si equipo y pagador coinciden, se indica «Mismo líder: sin descuento entre nóminas».

Los campos y la ayuda pertenecen a la posición de ese empleado, sin modificar el catálogo global. Con el switch apagado, solo se oculta el pagador alternativo y se ignora su valor guardado: el líder elegido para el equipo sigue visible y recibe el salario en su nómina. Volver al líder predeterminado se hace seleccionándolo en la misma lista, sin otra pantalla.

**Ejemplo sin préstamo:** Albañil tiene a Luis como líder de catálogo. Juan es Albañil, pero se elige a Marcos en su tarjeta. Marcos es su líder y paga el sueldo completo; no hay etiqueta Préstamo ni descuento entre nóminas. Luis sigue siendo el predeterminado de Albañil y la configuración de otros empleados no cambia.

En un borrador nuevo, el pagador sugerido acompaña los cambios del líder de la posición principal mientras no se haya elegido uno manualmente. Una elección manual se conserva, aunque cambie el líder principal o se desactive/reactive el préstamo. Guardar la asignación fija los valores aceptados: editar luego el catálogo o la posición principal no cambia silenciosamente pagadores ya guardados ni períodos anteriores.

Al reactivar dentro del borrador se conservan las selecciones válidas del usuario. Con préstamo activado son obligatorios el líder del equipo y el pagador. Sin préstamo se respeta el caso normal de SA sin líder asignado; esta mejora no convierte en obligatorios líderes que hoy son opcionales. Los datos antiguos conservan su compatibilidad hasta editar/configurar el caso. Si faltan datos, el formulario los deja pendientes y explica qué seleccionar; no se inventa un líder ni un pago.

El switch no es el checkbox del grupo de descuento: **el switch configura la posición para trabajo nuevo; el checkbox del grupo aplica/excluye ese ajuste del líder en el período**. Desmarcar la posición no borra ni reinterpreta tramos ya registrados o cierres históricos: el estado del switch y los responsables quedan versionados/conservados con el trabajo.

Cambiar el pagador no cambia la tarifa configurada. Editar tarifa, responsables o estado del switch requiere una versión/fecha efectiva. Los líderes/puestos archivados siguen identificados en el historial.

### Animación de la tarjeta y aparición del contenido

La revisión de la maqueta usa geometría real: la tarjeta crece/recoge su contenido sin escalar el texto ni sustituir sus nodos. La expansión dura aproximadamente 300 ms y el cierre 280 ms, con la curva de `design.md`.

- El líder del equipo está siempre visible. El pagador entra con opacidad y un desplazamiento de 6 px al activar el préstamo; su nota aparece después. El contenido saliente se desvanece antes de terminar de recoger el espacio.
- La etiqueta Préstamo entra con una transición suave de opacidad/escala propia, sin un salto de altura en el encabezado. El borde acompaña el cambio.
- La ayuda abre un modal propio con entrada de 180 ms y salida de 140 ms, mediante opacidad y desplazamiento breve. Entran primero las definiciones y después las dos rutas. La tarjeta de fondo no cambia de altura al abrir o cerrar la ayuda.
- Invertir el switch durante una transición retoma desde el estado visual actual. No hay temporizadores finales que oculten tarde una tarjeta que el usuario ya reabrió.
- La tarjeta y sus selectores permanecen montados. Desactivar el préstamo vuelve inerte solo el pagador oculto; las selecciones se conservan. La ayuda usa otro diálogo modal sin desmontar el editor; al cerrarla restituye el foco a «?» y la posición de lectura guardada al abrirla. Ningún cierre tardío puede ocultar una ayuda reabierta.
- El ancho se mantiene estable cuando aparece la barra de desplazamiento. Los cambios de valor no reinician la entrada de campos ya visibles.
- Con `prefers-reduced-motion`, los estados se aplican inmediatamente, sin retardos de entrada ni animaciones pendientes.

Verificación de esta revisión: 320/390/1280 px, muestras intermedias de la altura/opacidad, entrada escalonada de la ayuda, reversión a mitad del cierre sin salto geométrico, mismos nodos/foco, salida completa y reducción de movimiento. Los importes del ejemplo se mantienen ($500−$900=−$400; al excluir el grupo, $500), y las vistas examinadas pasan WCAG A/AA. Es una mejora de la maqueta, no una modificación del cálculo de SA.

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

El libro muestra ejemplos con el switch de posición activado. Su selector Aplicar descuento corresponde al checkbox del grupo del período, no al switch de configuración de la posición.

Archivos de revisión: [datos ficticios](employee-lending-313/ejemplos.json), [Excel comparativo](employee-lending-313/ejemplos-cesion.xlsx) y [fuente de maqueta](employee-lending-313/maqueta.html.example). Descargar/renombrar la fuente como `.html` permite abrirla sin conexión. Solo simula datos en memoria.

## Filtros, períodos y riesgos que hay que resolver

- **Saldo negativo de líder:** no confundirlo con salario negativo de empleado. Permitir inspeccionar/cerrar la nómina de empleados según sus validaciones, sin un falso bloqueo causado por la fila especial. El saldo firmado se conserva como resumen del período; su cobro o arrastre automático queda fuera de esta entrega.
- **Base duplicada:** el resultado aprobado es $500 − $900 = −$400. No reintroducir a Juan como salario positivo del líder 2 ni agregar otra base para cancelar el descuento. Tampoco restar dos veces el mismo grupo.
- **Selección parcial de empleados:** calcular la nómina de un subconjunto no debe aplicar automáticamente el ajuste de todo el líder o aplicarlo de nuevo al cerrar otro subconjunto. El grupo necesita una identidad de líder/período y una aplicación única. Cuando un filtro muestre solo una parte, debe indicarse; no confirmar un ajuste global desde una vista parcial sin una decisión clara.
- **Cobros y bonificaciones masivos:** la fila especial y sus empleados de detalle no son candidatos. Los comandos deben operar únicamente sobre partes de salario real a cargo del pagador.
- **Horas entre posiciones:** un empleado puede tener trabajo normal y trabajo con otro pagador. No cargar su sueldo entero en cada posición ni usar el puesto principal para reinterpretar el historial.
- **Cierre, anulación y reexportación:** si el ajuste se llega a contabilizar, su referencia tiene que ser única y reversible por el mismo cierre; no duplicarlo al exportar o reintentar. Esta entrega de diseño no crea ese asiento ni define una liquidación financiera nueva.
- **Datos viejos o incompletos:** las asignaciones antiguas sin los campos nuevos mantienen el comportamiento legacy hasta configurar el caso. Una asignación nueva sin préstamo usa su líder del equipo como pagador efectivo y no exige un pagador alternativo. No asignar pagadores históricos ni crear compensaciones retroactivas silenciosas.

## Modelo técnico propuesto para implementar después de revisar el diseño

Separar trabajo, salario por pagar y ajuste del líder. Los nombres siguientes son ilustrativos:

- Asignación del empleado: `isLoanPosition`, `workLeaderId`, `payerLeaderId`, tarifa vigente y versión/fecha efectiva. `workLeaderId` admite elección individual con el switch apagado. El catálogo solo inicializa el líder de una asignación nueva; la primera posición sugiere el pagador del préstamo durante el borrador hasta que haya elección manual. Los valores aceptados se conservan explícitamente por asignación; no son modificaciones globales ni enlaces dinámicos que reescriban otras asignaciones. Con préstamo apagado, el pagador efectivo es `workLeaderId` y el pagador alternativo guardado se ignora.
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

La maqueta se comprobó en Chromium a 320, 390 y 1280 px: campos por empleado, salario completo, 500−900=−400, grupo único con varios empleados, detalle y checkbox independientes, selección de otro pagador y coincidencia equipo/pagador. Se conserva foco/scroll y el editor montado detrás de la ayuda, pie visible y ausencia de desbordamiento horizontal. No realiza peticiones a servicios externos; WCAG A/AA en las vistas comprobadas.

El Excel compara el estado aplicado/desactivado y los casos de uno/dos empleados. Sus fórmulas y valores iniciales fueron revisados para −400/−800 al aplicar y $500 al desactivar, sin cambiar los salarios de los empleados. Medio día $450, tarifa efectiva $1,200, recargo de ejemplo $1,800 y extra de ejemplo $1,203.75 coinciden con sus importes detallados. No se ejecutaron operaciones de SA.

La implementación deberá demostrar además:

- Sin configuración nueva, los resultados legacy se conservan. En una asignación configurada sin préstamo, el salario pertenece al líder elegido del equipo aunque difiera del catálogo; el pagador alternativo oculto no tiene efecto.
- Al asignar una posición, su líder predeterminado aparece seleccionado y se puede cambiar desde la misma tarjeta, también en la posición principal. Cambiarlo solo afecta a ese empleado y no altera la tarifa.
- Al activar el préstamo, aparecen la etiqueta y el pagador; al desactivarlo se oculta solo el pagador. El líder del equipo, las selecciones y el historial no se borran.
- El pagador sugerido de un borrador sigue al líder principal hasta una elección manual; editarlo después no sustituye una elección manual ni una asignación ya guardada.
- En el líder del equipo solo hay empleados normales por sus salarios reales y una fila de ajuste separada; Juan no aparece como otro empleado pagable por el mismo tramo.
- El grupo y sus hijos no admiten descuentos, bonos, préstamos ni selección en acciones masivas; tampoco aumentan el conteo de empleados a pagar de ese líder.
- Contraer/expandir no cambia importes; el checkbox cambia únicamente el ajuste del líder.
- Un saldo negativo del líder no entra en el neto ni las validaciones de salario de un empleado; las validaciones de empleados reales siguen activas.
- El grupo se aplica una sola vez por líder/período, también con cierres parciales, reintentos y exportaciones repetidas; el cierre conserva el estado del checkbox y el saldo firmado.
- Las tarifas, puestos, responsables e importes históricos no se reescriben al editar perfiles o catálogos posteriormente.
- Resumen de salarios y saldo de líderes se identifican por separado; no se presenta uno como si fuera el otro.

La autorización actual cubre esta propuesta de diseño. El PR de documentación no habilita la función ni sustituye el PR de implementación posterior.

### Revisión del switch y la ayuda

Maqueta comprobada en 320/390/1280 px: switch accesible, etiqueta Préstamo, líder de catálogo seleccionado y editable con el switch apagado, expansión solo del pagador, ayuda en modal separado con dos rutas, cierre por X/Entendido/Escape/fondo, foco contenido y retorno a «?», selección obligatoria de líderes, preservación al desactivar/reactivar y ausencia de efectos del pagador oculto cuando el switch está apagado. El checkbox del grupo cambia únicamente el ajuste del líder, manteniendo marcada la posición y el sueldo del pagador. Cuando ambos líderes coinciden, se conserva la etiqueta solicitada pero no se crea un descuento contra el mismo líder. Las vistas revisadas pasan WCAG A/AA y no usan servicios externos.
