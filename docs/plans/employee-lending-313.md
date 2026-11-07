# Préstamo de personal por posición asignada · diseño de #313

**Estado:** propuesta para revisión, 07/11/2026. Configuración y modalidades recogidas del usuario; las decisiones pendientes se distinguen abajo. Esta entrega no implementa la función ni modifica datos o reglas de SA.

Issue: https://github.com/ERCamilo/-Sistema-de-asistencia/issues/313. Base de código revisada: `92272bec` (SA 1.7.128).

## Lo definido por el usuario

La configuración pertenece a la **segunda posición asignada al empleado**, o a una secundaria que ya estuviera asignada. En esa tarjeta se agregan:

1. **Es posición de préstamo:** marca de préstamo al equipo del puesto seleccionado. Ese puesto debe tener líder.
2. **Quién paga:** lista desplegable de líderes. Sugiere el líder de la posición principal/primera, pero permite elegir otro.

El receptor se obtiene del líder de esa segunda posición: no se añade otro selector de receptor ni se obliga a crear un puesto global exclusivo para préstamos. Los datos son propios de la asignación de ese empleado; marcar el puesto de Juan no cambia el de los demás empleados.

El usuario también definió tres modalidades con el ejemplo de Juan: primera posición $900 por jornada, segunda posición $1,200 por la misma jornada, líder 1 Luis y líder 2 Marcos.

| Modalidad | Nómina Luis | Nómina Marcos | Importe fuera de nómina | Compensación a Luis / a cargo de Marcos | Total correspondiente a Juan |
| --- | ---: | ---: | ---: | --- | ---: |
| **A · Repartido en nómina** | $900 | $300 | $0 | +$900 / −$900 **por confirmar** | $1,200 |
| **B · Pagador cubre todo** | $1,200 | $0 | $0 | +$1,200 / −$1,200 | $1,200 |
| **C · Diferencia fuera de nómina** | $900 | $0 | $300 | +$900 / −$900 | $1,200 |

Son **tres alternativas para el mismo trabajo**, no tres jornadas para sumar. Los importes son brutos y comparables en la misma unidad; la jornada de 8 horas de los ejemplos es ilustrativa, no una nueva configuración de SA.

En C, el saldo de $300 restante en el presupuesto del receptor no debe convertirse automáticamente en otra orden de pago de nómina a Juan. Ese importe se identifica por separado como fuera de nómina. Declarar la modalidad no demuestra que ya se haya pagado.

## Preguntas que siguen abiertas

Se solicitaron estas confirmaciones al usuario mientras se prepara el diseño:

- **A:** confirmar que la compensación es $900: Marcos recibe trabajo valorado en $1,200, compensa $900 a Luis y paga los $300 restantes a Juan por nómina.
- **C:** elegir si los $300 externos se muestran solo como importe gestionado fuera de SA o si se desea registrar un pago externo confirmado. La maqueta propone la primera opción, sin marcarlo como pagado.
- **Proporción:** confirmar el reparto por horas y recargos: media jornada cedida $450 + $150; jornada cedida con factor 2, $1,800 + $600. Los ejemplos adicionales asumen esta recomendación y se marcan como pendientes de validar.

Otras decisiones necesarias antes de implementar:

- **Descuentos, préstamos monetarios y bonos:** se calculan una sola vez por empleado. Falta acordar cómo repartir el neto entre pagadores, y qué ocurre si los descuentos superan la parte pagada por nómina en C. No se debe cargar un descuento completo en cada líder ni dar por cobrado un importe externo. Los ejemplos muestran bruto sin estos ajustes.
- **Segunda posición más barata que la principal:** definir si se paga la tarifa de la segunda, existe garantía de la primera o se usa otra regla. No generar diferencias negativas ni completar un mínimo sin acuerdo.
- **Cambios de tarifa/posición principal:** definir desde qué fecha cambia la referencia. La recomendación es versionar los valores aceptados y no reinterpretar trabajo ya registrado.
- **Cierres por líder:** acordar cómo confirmar pagos parciales cuando un empleado aparece repartido entre líderes. Un cierre del primer pagador no puede marcar como pagada la parte del segundo. Se recomienda un registro canónico por empleado/período con desglose de pagadores, y no habilitar cierres parciales hasta resolver sus estados e idempotencia.
- **Columnas de días en las compensaciones:** el +1/−1 original de #313 representa bien B, donde se traslada todo el pago. En A/C, una sola pareja +1/−1 ocultaría el reparto monetario. La propuesta es mostrar jornadas reales y ajustes monetarios separados; no inventar 0.75 días trabajados para representar $900 de $1,200. Confirmar si se desea además una columna de financiación equivalente, siempre rotulada como tal.

## Interfaz propuesta

### 1. Personal → editar empleado → segunda posición

Se reutiliza la tarjeta actual de puesto, su SVG, color, tarifa y modo hora/día. Bajo esa información aparece el interruptor **Es posición de préstamo**. Si el puesto no tiene líder, queda deshabilitado y se explica «Este puesto necesita un líder»; no se modifica el catálogo silenciosamente.

Al activarlo aparece **Quién paga**, con la lista de líderes activos de la obra y el predeterminado solicitado. Si la primera posición no tiene líder, se deja pendiente de selección. El equipo receptor se muestra como información del puesto, no como otro campo editable.

Para conservar la tarjeta compacta, un botón **Definir reparto** abre una vista/modal propia con tres opciones visuales:

- **Repartido en nómina:** pagador cubre la referencia de la primera posición y receptor la diferencia.
- **Pagador cubre todo:** el pagador seleccionado cubre el salario completo de la posición prestada.
- **Diferencia fuera de nómina:** pagador cubre la referencia; diferencia identificada como externa.

Cada opción previsualiza los importes antes de aplicarla. Receptor, pagador, salario y compensación tienen etiquetas distintas. Configurar una asignación no registra asistencia, pagos ni movimientos entre líderes.

La lista de pagadores no debe excluir automáticamente al receptor: si el usuario lo elige, se conserva el indicador de personal prestado, se suman sus partes de nómina una sola vez y no se crean compensaciones del líder consigo mismo. Este comportamiento se propone para revisar; no se reasigna al empleado a otro líder principal.

No se añaden fechas obligatorias a los dos campos solicitados. Los cambios de configuración deben tener versión/fecha efectiva para proteger lo ya registrado. Finalizar el préstamo desmarca la asignación para trabajo posterior, sin borrar su historial.

### 2. Asistencia → empleado → posición del día

Al seleccionar la segunda posición se muestra su indicador **Prestado**, equipo receptor, pagador y modalidad. Las horas se registran con el flujo habitual; la marca no genera presencia automática.

Para días mixtos se utiliza el reparto existente por posiciones. Cada hora base y extra debe pertenecer a un solo tramo. Ejemplo de 8 horas: 4 en la primera posición y 4 en la segunda consumen esas mismas 8 horas, no 16.

Los importes del reparto se obtienen de las reglas salariales de SA. No se divide todo el sueldo del día por dos si las posiciones tienen tarifas diferentes. El panel muestra por separado el bruto total, las partes de nómina y la parte externa.

### 3. Nómina y Reporte de Personal

Un empleado puede tener más de un pagador, pero conserva un cálculo global único. En A, Luis muestra $900 y Marcos $300; el total de Juan es $1,200. En B, Luis muestra $1,200 y Marcos $0. En C, la parte gestionada por nómina es $900 y los $300 externos quedan identificados, sin pagarlos otra vez.

El Excel se exporta desde **Reporte de Personal/Empleados → `report-controls-card`**, no desde el PDF de Nómina ni desde SplitX. Cada hoja de líder separa:

1. **Trabajo recibido:** puesto, empleado/número, horas y jornadas reales.
2. **Nómina de Juan a cargo del líder:** la parte que le corresponde según la modalidad.
3. **Compensación entre líderes:** a favor del pagador (+) / a cargo del receptor (−). Se calcula aparte del sueldo.
4. **Fuera de nómina:** importe externo identificado con su responsable y estado no inferido.

**Dashboard / Resumen General** conservan una sola jornada del caso y el valor salarial total de $1,200. Desglosan $1,200 en nómina para A/B o $900 en nómina + $300 fuera para C. No suman la compensación al salario; las dos contrapartidas suman cero.

En C, una fila «Importe fuera de nómina: $300» no descuenta otros $300 del saldo entre líderes: la compensación definida por el usuario sigue siendo $900. Tampoco representa un pago confirmado hasta que se acuerde su seguimiento.

## Días, horas y recargos

El Excel actual multiplica los valores de días por factores de feriado/descanso. Esos valores no son siempre jornadas físicas. La propuesta separa:

- **Jornadas base:** horas base / jornada configurada. Un feriado de 8 h con jornada 8 sigue siendo 1.
- **Equivalentes de pago:** valor ponderado con los factores vigentes; ese feriado puede ser 2.
- **Horas extra:** columna propia; su importe se obtiene del cálculo salarial existente, no solo de las columnas de días.

No cambiar factores, calendarios ni precedencia de feriado/descanso. La regla propuesta para distribuir recargos entre partes del pago sigue pendiente de confirmación.

### Ejemplos adicionales, bajo la proporción recomendada

| Trabajo | Total de Juan | A: Luis / Marcos por nómina | B: Luis por nómina | C: Luis por nómina / fuera | Jornadas reales |
| --- | ---: | --- | ---: | --- | ---: |
| 4 h solo en posición prestada | $600 | $450 / $150 | $600 | $450 / $150 | 0.5 |
| 4 h en primera + 4 h en segunda | $1,050 | $900 / $150 | $1,050 | $900 / $150 | 1 |
| 8 h prestadas con factor 2 de ejemplo | $2,400 | $1,800 / $600 | $2,400 | $1,800 / $600 | 1 |

En el día mixto, el salario es **$450 de la primera + $600 de la segunda = $1,050**, no $1,200. La compensación en A/C es solo la parte adelantada por el pagador del tramo cedido ($450); no incluye los $450 del trabajo habitual. En B es $600.

Si el pagador elegido fuera un tercer líder, la parte de referencia de la cesión se atribuye a ese líder. Las horas habituales de la primera posición siguen con su responsable actual; la lista desplegable no cambia silenciosamente el pagador de todos los puestos del empleado.

Archivos: [datos ficticios](employee-lending-313/ejemplos.json), [Excel comparativo](employee-lending-313/ejemplos-cesion.xlsx) y [fuente de maqueta](employee-lending-313/maqueta.html.example). Descargar/renombrar la fuente como `.html` permite abrirla sin conexión. Solo simula datos ficticios en memoria.

## Filtros y conciliación

- **Nómina por líder:** mostrar su parte de pago; «Todos» debe sumar las partes por empleado una sola vez. No usar únicamente el líder del puesto para decidir quién paga.
- **Asistencia:** conservar el empleado y añadir filtro/indicador Prestado; poder distinguir el puesto receptor. El registro no aparece duplicado.
- **Reporte de Personal:** distinguir filtros de pagador y receptor. Para una selección de trabajo se generan las dos contrapartidas de cada compensación, aunque se muestre una sola hoja de líder. La conciliación del libro incluye el par completo sin inventar trabajo fuera del filtro.
- **Puestos/empleados seleccionados:** conservar las opciones actuales; el resumen identifica el conjunto filtrado. Una selección parcial no puede presentar como completo un salario o pago que corresponde a otro conjunto.

## Modelo técnico propuesto, no contrato aprobado

La asignación secundaria del empleado amplía sus metadatos con `isPersonnelLoan`, `payerLeaderId`, `paymentMode`, versión y referencia salarial aceptada. El receptor procede de `position.leaderId`. Esos campos se guardan por empleado/asignación y no cambian el catálogo global.

Al registrar trabajo se conserva una referencia/copia suficiente de posición, versión, pagador, receptor, modalidad y tarifas. El mismo `positionId` no basta para identificar dos versiones o responsables distintos de un trabajo histórico. Las horas siguen teniendo una única fuente: los tramos del registro de asistencia.

El resultado por empleado distingue `grossTotal`, `grossInPayroll`, `outsidePayrollAmount` y asignaciones por pagador. Los nombres son ilustrativos. La suma de las partes de nómina y de la parte externa debe ser igual al bruto total, sin añadir compensaciones. Los descuentos y pagos/cierres todavía requieren el acuerdo descrito arriba.

Las compensaciones son datos derivados del reporte; no se almacenan como asistencia negativa, préstamo monetario, cobro ni movimiento de Caja Chica. No se generan movimientos financieros por exportar repetidamente.

Los cierres deben congelar identidades, reparto, tarifas, factores, modalidad e importes. Los datos legacy sin marca de préstamo conservan el comportamiento actual. No activar una migración que asigne pagadores históricos o altere cierres a partir del perfil actual.

## Cambios que exigiría el código actual

Base verificada: `92272bec`.

- `EmployeePositionEditor.js` / `EmployeeEditorDraft.js`: añadir los campos en la tarjeta secundaria y en lectura, comparación y resolución de borradores. No perderlos al reordenar puestos ni reiniciar valores editados sin una decisión.
- `Attendance.js` / `AttendanceService.js`: ampliar reparto, serialización y snapshots por asignación. `addPositionHours` agrupa por puesto; revisar versiones diferentes y cambios de configuración sin duplicar horas.
- `PayrollService.js`: reutilizar tarifa efectiva, salario por hora/día y factores vigentes para obtener el bruto. Añadir después la distribución, sin calcular otro salario distinto en Excel.
- `PayrollPreview.js: filterPayrollRowsByLeader`: hoy usa puestos del líder. Debe distinguir parte pagada, parte externa y trabajo recibido; sumar un empleado global sin duplicarlo.
- `PayrollLoans`, ajustes y `PayrollClosure*`: los descuentos y referencias de pago deben seguir siendo únicos. Auditar cierres filtrados por líder y pagos parciales antes de habilitarlos. No cerrar una parte como si todo el empleado estuviera pagado.
- `EmployeeReportData.js` / `AnalyticsUI.js: exportEmployeeReportExcel, generateLeaderSheets`: separar trabajo recibido, nómina y compensaciones; no asumir que el valor ponderado de días representa todo el importe salarial.
- Fingerprints, respaldos, sync y Mini/SplitX: incluir metadatos nuevos sin perder scopes ni permitir que un cliente antiguo borre una distribución desconocida. No asumir compatibilidad por añadir propiedades al objeto.

## Secuencia propuesta

1. Usuario y agente SA: confirmar A, seguimiento del pago externo y proporción; resolver descuentos/neto y cierre parcial.
2. Agente SA: acordar modelo, versiones, lectura legacy, respaldo/sync y tratamiento de clientes antiguos.
3. Agente SA: ampliar la tarjeta secundaria y la vista propia de reparto, con SVG/colores del puesto y `design.md`.
4. Agente SA: integrar asistencia, cálculo único y partes de pago; proteger cierres y filtros.
5. Agente SA: generar Excel con compensaciones emparejadas y conciliación, sin liquidación automática.
6. Agente SA y usuario: probar A/B/C, medio día/mixto/recargos, tercer pagador, mismo pagador/receptor, cambios de tarifas, préstamos/descuentos, backup y períodos cerrados; revisar en móvil antes de integrar.

El paso actual es el **diseño**, no la implementación. Registrar pagos externos reales o liquidaciones entre líderes amplía el alcance y requiere la decisión correspondiente.

## Invariantes de aceptación

- Sin marca de préstamo, los resultados actuales se conservan.
- La marca es del empleado/asignación, no de todos los empleados del puesto.
- El receptor tiene líder; el pagador se elige explícitamente y queda identificado históricamente.
- Cada hora se registra una vez. Las partes salariales suman el bruto del trabajo, no varios salarios completos.
- El importe externo no se paga también por nómina ni se marca pagado por seleccionar una modalidad.
- Una compensación tiene sus dos contrapartidas y suma cero globalmente; no es descuento personal ni otra asistencia.
- Los descuentos/préstamos/cierres no se aplican dos veces cuando hay dos pagadores.
- Perfil y catálogo nuevos no reescriben las condiciones históricas aceptadas o los cierres.
- Exportar es repetible y no crea pagos, cobros ni transferencias.

## Verificación de esta propuesta

- Libro Excel: fórmulas y valores iniciales comprobados para las 12 alternativas (A/B/C × completo, media jornada, mixto y feriado ilustrativo); partes salariales = salario total y compensaciones globales = cero. Las hojas no suman alternativas entre sí. El selector del Dashboard permite comparar A/B/C.
- Maqueta en Chromium a 320, 390 y 1280 px: tarjeta secundaria, selección de pagador, las tres modalidades, proporción de los ejemplos, tercer pagador y coincidencia pagador/receptor. Un solo shell modal, pie visible, sin desbordamiento horizontal ni peticiones a servicios externos; WCAG A/AA en las vistas revisadas.
- La verificación usa únicamente datos ficticios; no valida reglas todavía pendientes como si ya estuvieran aprobadas. No se han cambiado ni ejecutado operaciones de producción, cálculos de SA o migraciones.
