# PR #312 — Reparación de F1 y revisión de escrituras de nómina (27-10-2026)

## Referencias

- PR: https://github.com/ERCamilo/-Sistema-de-asistencia/pull/312
- SHA auditado: `92b49ae2`.
- Pruebas independientes incorporadas desde la rama `audit/pr312-92b49ae2-20261027`, commit `e3d3b1fe` (cherry-pick `ecdca05f`).
- Worktree aislado: `/home/ubuntu/worktrees/sa-pr312-kimi-review-fix-20261027`.
- Los archivos de la revisión original y sus aserciones no se modificaron.
- Antes de la corrección: cinco comprobaciones locales con **2 PASS y 3 FAIL**; con navegador, **2 PASS y 7 FAIL** de nueve totales.

## F1 — Feriados revierten otros ajustes confirmados (alta)

**Causa:** `ProjectPayrollConfigStore.putConfig` trataba `__holidaysPatch` como marcador de campo específico, pero construía `next` con `{ ...latest, ...payload }`. El payload provenía de una lectura anterior, por lo que reemplazaba simultáneamente `regularHoursPerDay`, `payPeriod`, `overtimeFactor` y otros campos.

**Corrección:** identificar escrituras delimitadas a campos por el marcador explícito y combinar sobre la configuración durable más reciente (`{ ...payload, ...latest }`), para luego aplicar únicamente `holidays`, `dayHours` u otros campos solicitados. Mantener sin cambios la semántica de guardado completo cuando no existe marcador explícito. La cola existente sigue ordenando escrituras por obra dentro de la instancia.

**Validación:** `python3 qa/multiobra360/pr312-review.py`; los cinco casos locales más cuatro recorridos de Chromium móvil/escritorio deben obtener **9/9 PASS**. La prueba comprueba los valores durables, no solo la pantalla.

## F2 adicional — Predeterminados de nómina revierten feriados/horas (alta, reproducido)

**Causa:** `PayrollUI.persistAdjustmentDefault` entregaba una copia completa de la configuración a `ProjectPayrollUIRuntime.saveConfig`. Al preparar el cambio de `payrollDefaults` con una configuración antigua, el guardado completo podía restaurar horas y feriados que se confirmaron entretanto.

**Reproducción:** `qa/multiobra360/tests/Pr312PayrollDefaultsIsolation.test.js`. Resultado antes de reparar: **0/1 PASS**, feriado confirmado `2026-10-27` vuelve a lista vacía. Se usa IndexedDB real sobre fake-indexeddb.

**Corrección:** incluir el marcador efímero `__payrollDefaultsPatch` en la acción explícita, transportarlo a través de la normalización de `ProjectPayrollUIRuntime` y aplicar exclusivamente ese campo sobre el estado durable reciente en el repositorio. El marcador se elimina antes de guardar en IndexedDB.

**Validación:** el mismo caso obtiene **1/1 PASS**, manteniendo el predeterminado editado, las horas y el feriado.

## Matrices históricas y de regresión

| Matriz | Resultado tras corrección |
| --- | --- |
| Nuevos casos F1 (incluye Chromium móvil/escritorio) | 9/9 PASS |
| Nueva prueba F2 (predeterminados de nómina) | 1/1 PASS |
| Casos previos C1–C3 | 11/11 PASS |
| Revisión independiente B1–B5 | 26/26 PASS |
| Multiobra 360 R1–R7 | 103/103 PASS, 0 infraestructura |
| Jest general | 674/674 suites, 6,682/6,682 PASS |

Las ejecuciones guardan las evidencias locales en `qa/multiobra360/results/pr312-review/`, `qa/multiobra360/results/commit0f-review/`, `qa/multiobra360/results/independent-review/` y `qa/multiobra360/results/latest/`. No se publican capturas o datos sintéticos de los resultados.

## Búsqueda adicional de riesgos y limitaciones

Se revisaron las llamadas de producto a `putConfig` desde `ActivePayrollSettings`, `AttendanceHandlers` y `ProjectPayrollUIRuntime`. Dos fallos reproducibles quedaron cubiertos por F1 y F2. Persisten riesgos NO certificados:

1. **Guardados completos genéricos:** `ProjectPayrollUIRuntime.saveConfig/updateConfig` puede recibir otras copias de configuración antiguas sin marcador de campo. Hace falta una revisión específica de formularios completos y conflictos por el mismo campo antes de garantizar esa ruta.
2. **Múltiples feriados simultáneos:** `__holidaysPatch` representa la lista completa; dos ediciones simultáneas de fechas diferentes desde snapshots distintos podrían sobrescribirse. Requiere pruebas de operaciones por fecha, idealmente aplicar add/remove sobre una lista durable.
3. **Concurrencia distribuida:** la cola de `putConfig` protege una instancia, pero no dos pestañas o dispositivos.
4. **Fuera de alcance:** OAuth, reglas Firebase desplegadas, conexión intermitente, respaldos reales y flujos de fusión, pausa, reactivación, archivo y recuperación integral de obras.

No atribuir estos riesgos a fallos reproducidos sin pruebas específicas. Mantener el PR abierto hasta inspección independiente del SHA publicado.

## Herramienta OpenCode

Se verificó la instalación de `opencode` 1.18.34 y la presencia del modelo `opencode-go/kimi-k3.1-pro`. Se intentó ejecutar con instrucciones de corrección y auditoría en el worktree aislado; tras más de un minuto no hubo respuesta, cambios ni reporte. Se detuvo esa sesión. La reparación y validación consignadas aquí se realizaron directamente, sin atribuirlas a OpenCode.
