# SA → SplitX: exportación enriquecida de nómina

Contrato de datos `sa-splitx-payroll/v1`. Ver [ejemplo JSON completo con datos ficticios](splitx-payroll.example.json). Esta entrega amplía la exportación de SA; SplitX debe incorporar la lectura y presentación de los campos nuevos.

## Compatibilidad y lectura

**Copiar JSON** y **Descargar .json** siguen produciendo un arreglo de empleados. Se conservan los campos originales y sus importes: `id`, `nombre`, `monto`, `bruto`, `bonificaciones`, `descuentos`, `prestamos`, `prestamoCapital`, `prestamoInteres`, `saldoPendiente`, `loanDetails`. Las cantidades monetarias mantienen la precisión del cálculo de SA; no recalcular ni redondear el neto al importar.

El puente mantiene `SPLITX_IMPORT_PAYROLL`, su `version: "1.0"`, `transferId` y los aliases actuales (`employees`, `data`, `payroll`, `items`, `rows`). **Leer solo uno de esos aliases**, porque todos representan las mismas filas. `version` describe el protocolo de transporte; `schema` describe los datos nuevos.

Cada empleado incorpora `exportContext`, compartido por las filas del mismo listado. Se repite en el JSON manual para conservar su arreglo superior y no perder contexto. El mensaje del puente publica además sus campos directamente en el nivel superior:

```json
{
  "schema": "sa-splitx-payroll/v1",
  "period": { "start": "2026-10-01", "end": "2026-10-15" },
  "companyName": "Constructora Ejemplo",
  "payrollName": "Nómina período 01/10/2026 - 15/10/2026",
  "currency": "DOP",
  "hoursPerDay": 8,
  "projectId": "obra-centro",
  "projectName": "Obra Centro",
  "totals": {
    "employeeCount": 1,
    "gross": 10000,
    "bonuses": 500,
    "deductions": 800,
    "loans": 0,
    "net": 9700
  }
}
```

- `period.start/end`: fechas civiles `YYYY-MM-DD`, ambas incluidas. No son timestamps ni deben convertirse de zona horaria. Mostrar, por ejemplo, **01/10/2026 – 15/10/2026**.
- `companyName`: nombre de empresa configurado en **Ajustes → General**, sin espacios exteriores. Se conserva separado del nombre de obra; si no está configurado, se exporta vacío.
- `payrollName`: etiqueta lista para mostrar: **Nómina período 01/10/2026 - 15/10/2026**. Se deriva de las mismas fechas civiles validadas, conservando día/mes/año incluso al cambiar de año o zona horaria. En SplitX puede mostrarse debajo de `companyName`. Ambos campos se incluyen en cada `exportContext` del JSON manual y también en el nivel superior del mensaje del puente.
- Se exporta el período revisado; no se añade un ID de nómina. **El período no identifica de forma única un envío**: una obra puede tener listados parciales, revisiones o correcciones del mismo período. No usarlo por sí solo para sobrescribir o deduplicar pagos.
- `projectId`: solo en modo por obra. `projectName`: nombre de la vista cuando está disponible; puede estar vacío. No confundir nombre vacío con ausencia de ID de obra.
- `totals`: exclusivamente las filas efectivamente exportadas, después del filtro de líder y las categorías seleccionadas. Un listado parcial no es el total de toda la obra. Las categorías desmarcadas tienen importe cero y arreglos de conceptos vacíos.
- `hoursPerDay`: denominador de la jornada de la obra; en modo clásico usa la configuración clásica (8 si no está definida). Un período inválido o una jornada no positiva impiden exportar.

## Identidad del empleado

| Campo nuevo | Significado |
| --- | --- |
| `sourceEmployeeId` | ID interno estable del empleado en SA; conservarlo para futuras conciliaciones. |
| `employeeNumber` | Ficha como texto: conserva ceros iniciales, por ejemplo `"001"`. |
| `employeeName` | Nombre sin añadir la ficha. |

El `id` numérico anterior y `nombre` con referencia se mantienen por compatibilidad. No usar el nombre como identidad. El ID procede de SA, no del teléfono Mini. No se exportan teléfonos, correos, fotos ni objetos internos del empleado.

## Trabajo expresado en días

```json
{
  "unit": "equivalent-day",
  "regular": 0.5,
  "overtime": 0.25,
  "holiday": 0,
  "restDay": 0,
  "total": 0.75
}
```

Este es el campo `workDays` de cada empleado. Cada categoría equivale al trabajo incluido dividido entre `hoursPerDay`; se redondea a seis decimales. **4 horas / jornada de 8 = 0.5 días**. No es un contador de fechas con asistencia. `total` incluye también las jornadas equivalentes de extras. Los factores de pago de extras, feriados o descanso no multiplican estos días. La suma de categorías redondeadas puede diferir del total en unas millonésimas.

`positions` desglosa ese trabajo por puesto: `{ id, name, leaderId, workDays }`. Dos puestos con media jornada cada uno suman una jornada, aunque se trabajaran el mismo día. Se priorizan los puestos del cálculo, no únicamente la asignación actual; si no hubo trabajo, se presentan los puestos asignados con días cero. `leaders` contiene `{ id, name, number }` sin duplicados, según la vinculación de esos puestos en el catálogo de SA al exportar. Un puesto retirado sin líder resoluble lleva `leaderId: null`. No constituye una instantánea histórica independiente del catálogo.

El filtro de trabajo por líder conserva solo los puestos incluidos y sus días. Estos campos no introducen horas trabajadas en el JSON; `hoursPerDay` solo explica la unidad de conversión.

## Conceptos de bonificaciones y descuentos

`bonusDetails` y `deductionDetails` contienen los conceptos **ya calculados en la vista previa**, incluidos ajustes programados/cuotas. Por ejemplo:

```json
[
  {
    "id": "ley",
    "concept": "Descuento de ley",
    "type": "percentage",
    "value": 3,
    "baseAmount": 10000,
    "amount": 300,
    "signedAmount": -300
  },
  {
    "id": "equipo",
    "concept": "Reparación de equipo",
    "type": "fixed",
    "value": 500,
    "amount": 500,
    "signedAmount": -500
  }
]
```

- `concept`: nombre legible para mostrar cada cargo por separado.
- `type`: `percentage` o `fixed`. `value: 3` significa **3 %**, no 0.03.
- `baseAmount`: base del cálculo porcentual cuando existe en el cálculo de SA; no asumir que siempre es el bruto completo. Puede corresponder a un puesto/líder filtrado.
- `amount`: importe calculado sin cambiar el convenio del ajuste. `signedAmount`: efecto sobre el neto (descuento negativo, bonificación positiva). Mostrar `−3 % · −300 DOP` y `Reparación de equipo · −500 DOP`, por ejemplo.
- **No restar los conceptos otra vez de `monto`**: el neto ya los incluye. Los arreglos explican `bonificaciones` y `descuentos`.
- En cuotas se incluyen, cuando existen, `planId`, `installmentId`, `installmentSequence` e `installmentCount`. Conservarlos para explicar la cuota; importarla no aplica ni liquida esa cuota en SA.

Los préstamos conservan su desglose anterior; no se agregan a `deductionDetails`, porque ya se descuentan como `prestamos`. `saldoPendiente`/`loanDetails.remainingBalance` conserva su semántica previa y no debe presentarse como saldo final pagado después de esta importación.

## Integración sugerida en SplitX

1. Aceptar los campos adicionales sin rechazar el formato anterior. En el arreglo manual, leer contexto de `employees[0].exportContext` cuando haya filas; en el puente, leerlo del nivel superior o de la primera fila.
2. Validar que las filas comparten contexto/período/moneda/obra. Comparar cantidad y totales con las filas importadas; informar omisiones y rechazos.
3. Mostrar empresa (`companyName`), título de nómina (`payrollName`), obra cuando exista, ficha/nombre y total a distribuir. Incorporar días y puestos como información de consulta.
4. Mostrar cada bonificación/descuento con concepto e importe y, si es porcentual, su porcentaje/base. Conservar `monto` como neto calculado por SA.
5. Distinguir importación, preparación de distribución y pago efectivo. El período y `sourceEmployeeId` ayudan a conciliar, pero no sustituyen una política de reenvíos/correcciones.

Las correcciones del transporte (destino permitido, doble clic, `count: 0`, recuperación de fallos y negociación/timeout) son una entrega posterior. No se ha probado aquí el receptor real SplitX: las pruebas de SA usan ventanas simuladas sin transmitir nóminas externas.
