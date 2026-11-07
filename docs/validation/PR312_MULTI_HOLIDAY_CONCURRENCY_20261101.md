# PR #312 — Conservación de feriados simultáneos (2026-11-01)

## Problema confirmado

La revisión independiente de `edb06bb0` probó dos llamadas simultáneas
a `ProjectPayrollConfigStore.putConfig`, ambas con el mismo estado inicial
(feriados vacíos): una agrega el 1 de noviembre y otra el 2. Antes del
cambio, la segunda sustituía toda la lista y borraba el 1 de noviembre.

Reproducción original **sin cambiar sus aserciones**:
`qa/multiobra360/tests/Pr312AdditionalReview20261101.test.js`.
Inicialmente **0/1 PASS** (esperado: dos fechas; resultado: solo la última).

## Corrección

- `ProjectPayrollConfigStore.js` acepta `__holidayChanges` como operaciones
  transitorias `{date, isHoliday}`, aplicadas contra la lista durable más
  reciente, dentro de la cola de guardados por obra.
- `AttendanceHandlers.toggleHoliday` transmite únicamente la operación
  de la fecha pulsada, evitando sobrescribir el resto de los feriados.
- Se preserva la compatibilidad con los payloads `__holidaysPatch` anteriores;
  si provienen de una versión antigua, las adiciones se unen a las más recientes
  sin borrar fechas nuevas. Las eliminaciones explícitas usan el nuevo contrato.
- Los marcadores transitorios no se persisten en IndexedDB.
- El guardado sigue preservando jornada base, período de pago, factor extra,
  horas confirmadas y predeterminados de nómina.

## Pruebas nuevas

- `Pr312AdditionalReview20261101.test.js`: dos altas desde la misma copia,
  **1/1 PASS** tras la corrección.
- `Pr312HolidayOperations20261101.test.js`: dos altas concurrentes, luego
  quitar una fecha usando una copia obsoleta, conservando la otra y sin
  persistir campos transitorios; **1/1 PASS**.
- `Pr312HolidayFieldIsolation.test.js`: cinco controles previos de campos
  de nómina, **5/5 PASS**.

## Verificaciones integradas

| Batería | Resultado |
| --- | --- |
| Revisión F1 (incluye móvil y escritorio) | 9/9 PASS |
| Concurrencia C1–C3 | 11/11 PASS |
| Revisión independiente B1–B5 | 26/26 PASS |
| Multiobra 360 R1–R7 | 103/103 PASS, 0 errores de infraestructura |
| Jest general | 683/683 suites y 6,846/6,846 tests PASS |
| Build y release | Versión final candidata 1.7.122; compilación y control de release PASS |

## Integración con main

Partimos del SHA de PR #312 `edb06bb0` y fusionamos `origin/main`
`8e4a0d26`, que publica `v1.7.120`. Los cuatro conflictos de
`app-release.json`, `AppVersion.js`, `BuildInfo.js` y `sw.js`
se resolvieron respetando las novedades 1.7.112/113 de la rama, las
1.7.114–120 de main y preparando 1.7.121 con nueva huella de caché.

## Riesgos y alcance no certificados

La cola de guardado protege una instancia de aplicación; **no** garantiza
concurrencia entre pestañas/dispositivos independientes. El fallback de
`__holidaysPatch` sin una operación de fecha explícita solo preserva
adiciones; para las eliminaciones es obligatorio utilizar la operación nueva.

No se ejecutaron autenticación real, reglas Firestore desplegadas ni flujos
integrales de fusión, pausa, reactivación o recuperación de obras.
No fusionar el PR automáticamente ni cerrar issues sin revisión independiente
del nuevo SHA y CI satisfactorio.
