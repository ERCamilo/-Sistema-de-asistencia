# Revisión independiente PR #312 — 92b49ae2 — 2026-10-27

## Dictamen

DEVOLVER A RESOLUCIÓN por un hallazgo adicional de prioridad alta.
Los tres problemas C1–C3 de la revisión de 0f080300 están corregidos y pasan
sus pruebas originales. No se repite el dictamen anterior sobre código viejo.

PR: https://github.com/ERCamilo/-Sistema-de-asistencia/pull/312
SHA revisado: 92b49ae2d20f044896e33bd7f6fb89d187597688.
Versión candidata: 1.7.112. Base integrada del PR: main hasta 7987e088.
Estado al inicio y al final: OPEN, MERGEABLE, mismo head 92b49ae2.
GitHub: policy, Jest y Cloudflare Pages SUCCESS para ese head.
El título todavía menciona 1.7.110; la descripción y el candidato son 1.7.112.
Ese desajuste de título es de documentación, no el motivo del rechazo.

## Método

Worktree aislado:
`/home/ubuntu/worktrees/sa-pr312-92b49ae2-review-20261027`.

Se creó desde el SHA exacto publicado, con dependencias del mismo package-lock.
Se revisó el diff de producto frente a la base y se ejecutaron de nuevo las
baterías acumuladas. No se cambiaron los módulos de producto ni las aserciones
anteriores. Las pruebas nuevas viven en qa/, fuera del patrón normal js/tests.

## Resultados independientes

| Batería | Total | Pasa | Falla | Infraestructura |
| --- | ---: | ---: | ---: | ---: |
| C1–C3, integración y Chromium | 11 | 11 | 0 | 0 |
| Ampliación anterior | 26 | 26 | 0 | 0 |
| Multiobra 360 original | 103 | 103 | 0 | 0 |
| Aceptación acumulada | 140 | 140 | 0 | 0 |
| Suite general Jest | 6682 | 6682 | 0 | 0 |
| Nuevos casos: integración local | 5 | 2 | 3 | 0 |
| Nuevos casos: Chromium 390/1280 | 4 | 0 | 4 | 0 |
| Nuevos casos, total | 9 | 2 | 7 | 0 |

Suite general: 674/674 suites, sin casos pendientes.
`npm run test:release`: PASS para 1.7.112.
No se ejecutó una compilación nueva; el PR informa su propia compilación aprobada.

Los siete fallos nuevos son manifestaciones de UNA causa, no siete causas.
Las cuatro comprobaciones de integridad de navegador pasaron: no se detectaron
cambios inesperados en las entidades protegidas por el harness.

Nota de trazabilidad: el ejecutor heredado commit0f-review.py conserva un
applicationSha literal antiguo. Su checkoutHead en esta ejecución es 92b49ae2
y sus hashes de runtime corresponden al candidato. La ejecución nueva específica
de PR312 registra ambos identificadores como 92b49ae2. No se usaron resultados
de otros commits ni ese literal antiguo para atribuir el resultado.

## F1 — Alta: guardar un feriado desde una lectura anterior revierte otros ajustes confirmados

Archivo principal:
`js/modules/features/payroll/ProjectPayrollConfigStore.js`, líneas 66–78.

Llamada de producto:
`js/modules/ui/AttendanceHandlers.js`, toggleHoliday, línea 125.

La corrección protege dayHours frente a un payload anterior, pero el caso
__holidaysPatch todavía construye next con latest seguido de todo payload.
Así, el snapshot anterior del feriado vuelve a imponer regularHoursPerDay,
payPeriod, overtimeFactor y otros campos ajenos a la acción.

El campo __holidaysPatch aplica holidays al final; no impide que los campos
anteriores del payload hayan reemplazado el estado durable más reciente.
La serialización por proyecto ordena las escrituras, pero no elimina esa
sobrescritura semántica. El problema se reproduce dentro de UNA instancia,
sin dos pestañas ni concurrencia distribuida.

### Reproducción con el repositorio real

1. Se parte de una configuración con jornada base 8, período 21 días y
   factor de horas extra 1.
2. Se inicia un cambio de uno de esos campos y se retiene su escritura IDB.
3. El flujo de feriado lee todavía la configuración anterior.
4. Se encola putConfig con holidays y __holidaysPatch, igual que toggleHoliday.
5. Se libera la primera escritura. Ambos guardados finalizan en la cola normal.
6. El feriado queda guardado, pero se pierde la edición anterior confirmada.

| Campo | Cambio confirmado | Valor después de guardar feriado |
| --- | --- | --- |
| regularHoursPerDay | 10 horas | 8 horas |
| payPeriod.periodLength | 7 días | 21 días |
| overtimeFactor | 2 | 1 |

Los tres casos locales usan IndexedDBService real sobre fake-indexeddb y
ProjectPayrollConfigStore real, con promesas que controlan el orden exacto.
Se mantienen controles positivos: un feriado con snapshot actual conserva
la jornada y una edición específica de dayHours conserva los otros ajustes.

### Reproducción en navegador

Se monta el componente real DateControls y su botón real de feriado.
Puppeteer hace clic y el evento pasa por AttendanceHandlers.toggleHoliday,
ProjectPayrollConfigStore y el IndexedDB nativo de Chromium.
La fecha de prueba no tiene asistencias existentes que deban cambiar.

Se retiene una escritura de ajustes y se permite que el botón de feriado
lea la configuración anterior. Después se liberan y completan los guardados.
Resultado, tanto a 390 como a 1280 píxeles:
- Jornada base confirmada 10 -> 8.
- Período confirmado 7 -> 21.

La revisión comprueba el registro durable; no se trata solo de una vista vieja.
No se afirma que haya ocurrido una pérdida monetaria o un pago incorrecto
en producción. El alcance demostrado es la pérdida silenciosa de configuración
de nómina al combinar dos acciones válidas del mismo proyecto.

### Criterio de aceptación

Una acción de feriado debe modificar únicamente los campos propios de esa
acción sobre el estado durable vigente. Debe conservar jornada base, período,
factores y restantes ajustes confirmados mientras su lectura quedaba atrasada.

Conservar además:
- La protección existente de dayHours.
- La acumulación de clics y los cambios de fechas distintas de C1.
- El descarte de eventos obsoletos de C2.
- La invalidación de semillas de otra sesión de C3.
- Las tres baterías acumuladas y los controles positivos nuevos.

Una corrección debe tener prueba roja antes y verde después, sin omitir los
casos ni invertir sus expectativas.

## Alcance aún pendiente de certificación

Esta revisión no certifica:
- OAuth real y reglas efectivamente desplegadas.
- Dos pestañas/dispositivos físicos y sincronización distribuida de estos ajustes.
- Conectividad intermitente, reinicios reales y restauraciones de respaldos reales.
- Fusión completa de obras fragmentadas y su historial financiero.
- Pausa, consulta en solo lectura, reactivación, cierre/archivo y recuperación integral.

La identidad externa es simulada; Firestore usa SDK real con emulador local.
No se usa Firebase de producción ni información real de empleados.
Las limitaciones conocidas no se contaron como fallos nuevos.

## Ejecutar y localizar evidencia

```bash
cd /home/ubuntu/worktrees/sa-pr312-92b49ae2-review-20261027
python3 qa/multiobra360/pr312-review.py
```

Resultado esperado sobre 92b49ae2: 2 PASS, 7 FAIL, exit 1, 0 infraestructura.
El runner comprueba cinco casos locales y cuatro parejas escenario/anchura,
y elimina los JSON previos de sus capas antes de empezar.

Pruebas y ejecutor:
- qa/multiobra360/tests/Pr312HolidayFieldIsolation.test.js.
- qa/multiobra360/pr312-fields-cases.browser.mjs.
- qa/multiobra360/pr312-fields-browser.cjs.
- qa/multiobra360/pr312-review.py.

El adaptador separado inyecta los casos de navegador en memoria y conserva
sin cambios las baterías anteriores. No se modifican los workflows ni se
añaden requisitos a los commits habituales de main.

Evidencias:
- qa/multiobra360/results/pr312-review/acceptance.json.
- unit.json, browser.json, logs y capturas en ese mismo directorio.
- qa/multiobra360/results/commit0f-review/ (11 casos).
- qa/multiobra360/results/independent-review/ (26 casos).
- qa/multiobra360/results/latest/ (103 casos).
- /tmp/sa-pr312-92b49ae2-general-20261027.json y .log (suite general).

No se hizo merge, despliegue ni cambios en la rama del worker o en datos reales.
