# Pruebas adicionales de multiobra

Aplicación de referencia: commit 93ca8b3f (PR #310). No hay cambios de producto en este paquete.

## Ejecutar en a2

```bash
cd /home/ubuntu/worktrees/sa-multiobra-independent-review-20261024
python3 qa/multiobra360/independent-review.py
```

El ejecutor usa Jest y Chromium de las dependencias del proyecto, Java 21 y un
emulador de Firestore local. Las rutas de a2 tienen valores predeterminados.
En otra máquina se pueden definir MULTIOBRA_JAVA, FIRESTORE_EMULATOR_JAR,
SA_EMULATOR_NODE_MODULES y CHROMIUM_PATH. MULTIOBRA_REVIEW_RESULTS permite
usar un directorio de evidencias distinto.

## Matriz

| Caso | Local | SDK/emulador | Navegador |
| --- | ---: | ---: | ---: |
| Cuenta/restauración/flag cambian después de leer nube | 3 | 0 | 4 |
| Semilla inicial compite con edición explícita | 1 | 0 | 2 |
| Refresco atrasado de la misma obra | 1 | 0 | 2 |
| Guardado rechazado conserva horas visibles no guardadas | 1 | 0 | 2 |
| Eliminación confirmada contra fecha activa mayor | 0 | 1 | 0 |
| Desactivar multiobra durante selección | 1 | 0 | 0 |
| UID explícito después de cerrar sesión | 1 | 0 | 0 |
| Controles: guardado/refresco/semilla normales | 3 | 0 | 2 |
| Controles: reintento real de transacción, nombre/configuración | 0 | 2 | 0 |
| Total | 11 | 3 | 12 |

Cada caso de navegador se ejecuta a 390 y 1280 píxeles, en un contexto aislado
con IndexedDB nativo. Los controles de asistencia reciben clics reales.
La cuenta externa está simulada y Firestore usa SDK real contra loopback;
esto no es una prueba del login OAuth ni del arranque completo de index.html.

## Resultado de referencia

26 comprobaciones: **7 PASS / 19 FAIL / 0 errores de infraestructura**.
Los fallos reproducen los problemas pendientes; no son 19 causas distintas.
Los siete controles positivos deben conservarse al corregir los defectos.

El código de salida es 0 si todos los casos pasan; 1 si hay fallos de aceptación;
2 si falta una capa, un escenario, una anchura, integridad o infraestructura.
No aprobar a partir de resultados parciales ni convertir los casos en skips.

## Reevaluación tras las correcciones

El resultado de referencia de **7 PASS / 19 FAIL** corresponde al commit
auditado `93ca8b3f`, no al candidato corregido que sigue en el PR #310.
En la nueva ejecución local: **26/26 PASS**, sin errores de infraestructura;
la batería anterior también obtuvo **103/103 PASS** y Jest general
**6,648/6,648 PASS**. Véase el registro de resolución en
`docs/validation/MULTIOBRA_INDEPENDENT_RESOLUTION_20261025.md`.

## Evidencias y aislamiento

Directorio: qa/multiobra360/results/independent-review/

- acceptance.json: elegibilidad, totales, capas y errores de infraestructura.
- environment.json: SHA del checkout y hashes de los módulos de producto.
- unit.json, emulator.json, browser.json: aserciones y resultados.
- run.json, *.log y capturas PNG: ejecución y diagnóstico.
- runner-negative-check.json: comprueba que el ejecutor elimina JSON verdes
  anteriores y devuelve exit 2 si el emulador no puede iniciarse.

El runner elimina los resultados de capa de la ejecución anterior antes de empezar,
exige exactamente los 26 casos y comprueba todas las parejas escenario/anchura.
La prueba negativa del ejecutor pasó, usando otro directorio y un Java inexistente.

Las pruebas están en qa/, fuera del patrón habitual js/tests. Se ejecutan
expresamente con el comando anterior. La batería original de 103 mantiene sus
casos separados: el runner del navegador solo incluye REVIEW cuando se lo solicita.
No se añaden checks obligatorios para commits ajenos ni se cambian workflows.

Informe de hallazgos:
../../docs/validation/MULTIOBRA_INDEPENDENT_REVIEW_20261024.md
