# Lectura financiera de préstamos

La consulta del panel y la exportación no modifican préstamos, pagos, tasas ni cierres. Las operaciones existentes siguen siendo las que crean y corrigen registros.

## Importes y alcances

| Cifra | Lectura |
|---|---|
| Saldo actual | Capital e interés pendientes de préstamos activos de la obra |
| Capital entregado | Capital original histórico, excluyendo préstamos anulados |
| Dinero recibido | Importes de abonos vigentes y sus ajustes, sin volver a contar el crédito utilizado |
| Capital/interés aplicado al corte actual | Aplicación reconstruida con los movimientos vigentes |
| Asignación al registrar | `allocation` original conservada para auditoría y correcciones de cierres |
| Crédito pendiente | Dinero recibido que aún no se aplicó al mismo préstamo |
| Crédito generado en un rango | Excedente en la fecha del abono; puede haberse consumido después |
| Saldo cerrado | Saldo retirado de la cartera por un cierre; no constituye un pago |

El porcentaje de capital histórico devuelto y el porcentaje pagado en préstamos abiertos tienen conjuntos y denominadores diferentes. Las etiquetas indican ese alcance.

## Cronología y trazabilidad

`LoanChronology` recupera en lectura la hora efectiva de un refinanciamiento convertido cuando el original conserva esa hora. No guarda una migración ni cambia `createdAt`, que sigue siendo la fecha de auditoría de la conversión. Las conversiones nuevas conservan también `effectiveAt`.

La cronología se resuelve con todos los préstamos del empleado **antes** de excluir préstamos anulados del resultado financiero: los originales pueden ser necesarios para ordenar las copias. `buildTimeline(entries, { financialOnly: true })` aplica ese orden. La vista de auditoría puede conservar anulados explícitamente.

Los pagos se aplican primero a interés y después a capital. El crédito consumido se incorpora a la aplicación del pago original, sin simular otro ingreso. Al retirar interés cobrado, su aplicación pasa a capital o crédito; no se presenta interés pendiente negativo para ocultar una diferencia.

La asignación original de un pago puede diferir de la aplicación reconstruida tras cambios posteriores o retroactivos. Ambas se conservan en el detalle/exportación; no se sobrescribe el registro original. Las correcciones de cierres siguen utilizando sus operaciones auditadas existentes.

Los reemplazos de cuotas utilizan el total e interés pactados en `replacementTerms`; no vuelven a multiplicar una tasa calculada sobre otra base.

## Cierres y datos incompletos

Un préstamo marcado saldado no representa deuda activa. Si conserva saldo sin un motivo, se señala para revisión: no se inventa un pago ni se presume condonación. Si falta la fecha de cierre, la evolución excluye ese préstamo y advierte que el historial está incompleto; la cartera actual conserva su estado cerrado.

La referencia reconstruida de una consolidación no prueba deuda faltante después de que sus préstamos separados reciban abonos, cargos o anulaciones. La revisión muestra «Movimientos posteriores» y «No comparable»; no ofrece una reparación automática por esa diferencia.

Las copias de cierres de nómina se revisan con `PayrollClosureReview`. Anular una copia utiliza la función existente que solo anula su registro de cierre; no elimina pagos ni lotes. La corrección comercial de saldos cerrados requiere evidencia del administrador.

## Movimientos y confirmaciones

Una operación agrupada se confirma por su importe completo y todos los préstamos afectados, aunque se abra desde una sola parte. Cada fila individual utiliza el número, importe y estado de esa parte. Las partes anuladas no ofrecen una nueva anulación.

Si los datos cambian con la confirmación abierta, la operación se detiene para revisar otra vez el alcance. Se conservan los bloqueos por nómina cerrada y las opciones existentes de ajuste o corrección del cierre.

## Gráficas y archivos

- Diaria, mes, periodo y exportación financiera excluyen los mismos préstamos anulados.
- El canal de nómina/directo considera los metadatos existentes; «conversión» describe procedencia, no necesariamente canal.
- La exportación conserva cobro original y vigente. El riesgo mantiene la antigüedad original.
- Los rangos de meses se anclan al mes actual; «Todo» conserva el historial disponible. La cartera actual no se filtra por ese rango.
- El detalle numérico del puente precede a la comparación avanzada. En móvil se muestran los pasos en vertical; mes/periodo disponen de selector nativo y anterior/siguiente.
- Las cifras resumidas de los gráficos son aproximadas; tablas, cuenta y archivos permiten conciliar centavos.

## Validación

Las regresiones usan personas ficticias y cubren reemplazos, crédito total/parcial, ajustes de interés cobrado, cierres sin fecha, recuperación de horas, anulaciones agrupadas, estado de partes y confirmaciones obsoletas. La comprobación de un respaldo privado debe verificar invariantes, igualdad de saldos entre lectores y ausencia de escrituras. No incorporar respaldos ni exportaciones con datos personales al repositorio.
