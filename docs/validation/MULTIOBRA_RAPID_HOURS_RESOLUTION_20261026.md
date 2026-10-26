# Resolución de C1–C3: concurrencia de horas y semilla — 2026-10-26

## Base y alcance

El PR #310 ya estaba fusionado en main; la nueva rama
`fix/multiobra-rapid-hours-races-20261026` parte de `5a017272`
(v1.7.109). Se incorporó sin cambiar sus aserciones la revisión aislada
`0135741c` con cinco pruebas locales y seis recorridos de navegador a
390/1280 px. El informe previo
`MULTIOBRA_0F080300_INDEPENDENT_REVIEW_20261026.md` conserva el
resultado original 2/11 PASS y 9/11 FAIL.

## Arreglos

- **C1 (alta)**: las ediciones de una misma obra se guardan en orden;
  el repositorio relee la última configuración durable y aplica las
  modificaciones por fecha, en vez de sobrescribir todo `dayHours`.
  El stepper comunica el incremento explícito, permitiendo que dos clics
  de +0.5h acumulen 8 → 8.5 → 9. No se publica en caché un cambio antes
  de su confirmación durable. También se conserva cualquier cambio
  reciente de otros ajustes, como feriados.
- **C2 (media)**: un resultado tardío no emite `payroll-config:changed`
  si ya existe una configuración visible más reciente; la aceptación
  del guardado usa la revisión de caché y la versión durable.
- **C3 (media)**: la inserción provisional verifica vigencia de sesión,
  flag y restauración dentro del mutador de IndexedDB, no solo antes
  de ponerlo en cola.

Se añadió `js/tests/ProjectPayrollConcurrentWrite.test.js` como
regresión para proteger los feriados de cambios de horas posteriores.

## Resultados de la rama local (sin producción)

| Batería | Resultado |
| --- | --- |
| C1–C3, locales + móvil/escritorio | 11/11 PASS |
| Ampliación independiente previa | 26/26 PASS |
| Multiobra 360 anterior | 103/103 PASS |
| Suite general Jest | 670 suites / 6649 tests PASS |

Los 140 escenarios de aceptación se ejecutaron con identidades sintéticas,
SDK Firebase con emulador loopback e IndexedDB local. No hubo fallos de
infraestructura en las matrices de aceptación. Detalle en:
`qa/multiobra360/results/commit0f-review/`,
`qa/multiobra360/results/independent-review/` y
`qa/multiobra360/results/latest/` (archivos locales excluidos de Git).

## Limitaciones y siguiente validación

La serialización de escrituras concurrentes se realiza por obra dentro
de la instancia de la aplicación; no demuestra ausencia de conflictos
en dos pestañas o dispositivos a la vez. Pendientes: OAuth real, reglas
en nube, dos dispositivos físicos, offline/reconexión, recuperación
integral y el ciclo completo de fusión, pausa y reactivación de obras.
Conservar PR e issues bajo revisión hasta validar el SHA final.
