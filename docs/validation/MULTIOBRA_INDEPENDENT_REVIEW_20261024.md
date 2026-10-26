# Revisión independiente Multiobra R1–R7 — 2026-10-24

## Dictamen

DEVOLVER A RESOLUCIÓN antes de aprobar la corrección completa o cerrar los siete issues.
La afirmación de que la batería original pasa es reproducible: 103/103 PASS.
Eso no demuestra el cumplimiento íntegro de multiobra: las pruebas ampliadas reproducen
casos importantes que esa batería no cubría y una regresión en la eliminación.

Aplicación revisada: `93ca8b3fc7b4189f014ca2538384a2ebdfe01a4d`, v1.7.109.
Rama publicada: `fix/multiobra-360-r1-r7-20261024`.
PR: https://github.com/ERCamilo/-Sistema-de-asistencia/pull/310
Main remoto observado: `6be6b906b14f84bea365b642338d5a1a0be5548f`.
La rama original estaba limpia y su HEAD coincidía con GitHub.
Esta revisión no modifica módulos de producto, main, producción, datos reales ni issues.

## Evidencia independiente

Worktree: `/home/ubuntu/worktrees/sa-multiobra-independent-review-20261024`.
Se creó aislado en el SHA publicado; dependencias del mismo package-lock que la batería original.
Las primeras evidencias de la rama original no eran suficientes: había JSON viejos con PASS
junto con logs nuevos MODULE_NOT_FOUND (Jest/esbuild) y navegador sin arrancar.
Por eso se repitió toda la validación en el worktree aislado.

| Verificación | Total | Pasa | Falla | Infraestructura |
| --- | ---: | ---: | ---: | ---: |
| Batería original: integración local | 47 | 47 | 0 | 0 |
| Batería original: SDK/emulador | 4 | 4 | 0 | 0 |
| Batería original: Chromium 390/1280 | 52 | 52 | 0 | 0 |
| Original, total | 103 | 103 | 0 | 0 |
| Suite general Jest | 6648 | 6648 | 0 | 0 |
| Ampliación: límites locales | 11 | 3 | 8 | 0 |
| Ampliación: transacciones reales | 3 | 2 | 1 | 0 |
| Ampliación: Chromium 390/1280 | 12 | 2 | 10 | 0 |
| Ampliación, total | 26 | 7 | 19 | 0 |

Suite general: 669/669 suites, sin tests pendientes.
Release: `npm run test:release` PASS.
GitHub PR310: Jest y Cloudflare Pages PASS.
No sumar 19 fallos como 19 causas: varios son el mismo problema en dos anchos o transiciones.
Las comprobaciones de integridad de los doce nuevos recorridos de navegador pasaron.

## Hallazgos principales

### B1 — Alta: sesión/restauración se validan antes de aplicar, pero no durante el commit local

Ruta: `js/modules/features/projects/ProjectCatalogSync.js`, syncProjectCatalog/applyRemoteCatalog.
Después de resolver getDocs se comprueba generación, cuenta, flag y marca de restauración.
applyRemoteCatalog contiene múltiples awaits y commits sin revalidar esos permisos.

Reproducción: getDocs termina, se retiene la primera lectura local de proyectos, se cambia
de cuenta y se invalida la sesión, o se marca una restauración pendiente, y se libera la lectura.
FOREIGN termina escrito en el catálogo local de todas formas.
Confirmado con IDB real (fake-indexeddb) y con SDK/IndexedDB nativo en Chromium a 390 y 1280.
Desactivar el flag en esa misma ventana también deja aplicar la operación.

Aceptación: una operación obsoleta no puede escribir, publicar ni anunciar resultados después
de que cambie su sesión/autorización; comprobar vigencia en las fronteras de mutación.
La escucha en vivo también llama directamente a applyRemoteCatalog y necesita la misma protección.
No se hizo login OAuth real: la identidad externa está simulada en la frontera del SDK.

### B2 — Alta: la creación inicial de configuración puede sobrescribir una edición ya guardada

Ruta: `js/modules/features/projects/ProjectCatalogSync.js`, seedPayrollConfig.
Su secuencia get-ausente → construir valores iniciales → update no es atómica.

Reproducción: se recibe una obra nueva; la lectura de configuración devuelve ausente y se retiene.
Otra operación guarda una edición explícita con dayHours=10; después se libera la lectura inicial.
La semilla sobrescribe esa edición: desaparece dayHours y reaparece seeded:true.
Confirmado con el repositorio IDB real y putConfig real; no es solo una discrepancia visual.

Aceptación: crear solo si sigue ausente dentro de una misma transacción.
Conservar una configuración existente aunque haya aparecido después de la primera lectura.

### B3 — Media: una lectura atrasada de la misma obra reemplaza la configuración visible reciente

Ruta: `js/modules/features/payroll/ActivePayrollSettings.js`,
refreshActivePayrollSettings y setActivePayrollConfig.
La comprobación del identificador evita eventos de otra obra, pero no una versión vieja de la misma.

Reproducción en navegador: refresco retiene las horas anteriores; un clic real cambia y guarda
8 → 8.5; se libera el refresco anterior. IndexedDB sigue teniendo 8.5, pero el control muestra 8.
También probado con integración local (10 guardado frente a 8 visible).

Aceptación: la caché no debe retroceder por completar una lectura anterior a la edición.
La pantalla y los consumidores de configuración deben coincidir con la edición durable vigente.

### B4 — Media: fallo de escritura deja horas no guardadas como configuración visible

Ruta: `js/modules/features/payroll/ActivePayrollSettings.js`, updateActiveDayHours.
Se publica la vista optimista antes del guardado y no se revierte si putConfig rechaza.

Reproducción: 8 guardado, intento 10, error de IDB; el disco conserva 8 y la caché devuelve 10.
AttendanceHandlers muestra un aviso de error, pero no restablece esa caché.
Confirmado en prueba local con fallo de persistencia inyectado.
No se afirma que se haya perdido dinero o generado una nómina incorrecta en producción.

Aceptación: tras un fallo, recuperar el último valor durable o mostrar explícitamente el estado
pendiente sin tratarlo como configuración confirmada; no deshacer una edición posterior válida.

### B5 — Media, regresión confirmada: una fecha mayor en nube bloquea una eliminación válida

Ruta: `js/modules/features/projects/ProjectCatalogSync.js`, publishCatalogPatch.
planCatalogMerge conserva la regla preexistente: una eliminación confirmada prevalece
sobre una versión activa de un cliente atrasado. La transacción nueva rechaza primero
remote.updatedAt > candidate.updatedAt, incluso si el candidato contiene deletedAt.

Reproducción con SDK real y reglas del repo: obra local vacía eliminada (deletedAt=10,
updatedAt=10), nube activa updatedAt=100. Local sigue eliminada; nube sigue activa.
Puede aparecer con relojes desajustados o restauraciones que conservan fechas.

Comparación del MISMO caso:
- Antes de la corrección, padre `7014b4a8`: PASS.
- Después, `93ca8b3f`: FAIL.

Aceptación: mantener el contrato de eliminación y las protecciones de obras con datos,
sin permitir que clientes atrasados revivan una obra ni que relojes mayores bloqueen
permanentemente la propagación de un borrado confirmado.

## Otros límites reproducidos

- Si se desactiva multiobra mientras setActiveProjectId valida la obra, la operación
  todavía cambia la preferencia y emite el evento. Caso de robustez adicional.
- Con auth.currentUser=null, pasar uid explícito a syncProjectCatalog todavía inicia
  la lectura y puede aplicar registros mediante transporte inyectado. Revisar el contrato
  de ese parámetro. Esto no demuestra un bypass de las reglas de Firestore.
- Los relojes con la misma fecha y contenido diferente, compatibilidad con clientes viejos,
  arranque integral/autenticación real y reanudación offline no están certificados aquí.

## Calidad de las pruebas de R7

Los casos originales detenían writeDoc. La corrección usa runTransaction en el SDK real,
por lo que ese writeDoc ya no se invoca y Promise.race puede terminar por pending:
el caso pasa como escritura secuencial, sin forzar el intercalado que pretendía probar.

Se añadieron dos controles con __hooks.afterTransactionGet del adaptador del emulador:
A lee dentro de la transacción, B confirma un cambio, A continúa y debe reintentar.
Ambos PASS, con al menos dos intentos, tanto para nombre como para configuración.
Esto aporta evidencia favorable de R7, aunque hay que conservar estos controles efectivos.

## Requisitos y alcance

| Área | Resultado de esta revisión |
| --- | --- |
| Escenarios originales de R1–R7 | 103 PASS |
| Invalidación en todas las fases de sesión/restauración | Incompleta: B1 |
| Configuración inicial y edición explícita | Incompleta: B2 |
| Coherencia entre pantalla y persistencia | Incompleta: B3/B4 |
| Comparación y reintento real de versiones en Firestore | Dos nuevos controles PASS |
| Eliminación coherente entre dispositivos | Regresión B5 |
| Fusión completa de obras fragmentadas | No certificada por este PR ni por esta matriz |
| Pausa, reactivación, cierre, archivo y traslados completos | Sin aceptación integral en esta revisión |
| Restauración FULL y cierres reales tras una fusión | Pendiente de una matriz específica |
| OAuth real, arranque de index.html, PWA y servicios desplegados | Fuera del alcance probado |

El PR310 solo implementa los siete arreglos descritos en su diff.
No debe interpretarse como entrega o certificación de todas las funciones nuevas de multiobra.

## Repetir

La batería original conserva sus 52 casos: el runner de navegador excluye los casos REVIEW
del modo all, y los ejecuta únicamente cuando MULTIOBRA_POINT=REVIEW.
Los tests adicionales viven fuera del patrón normal de js/tests.

```bash
cd /home/ubuntu/worktrees/sa-multiobra-independent-review-20261024
python3 qa/multiobra360/independent-review.py
```

Resultado actual esperado: exit 1, fallos de aceptación reproducidos, sin infraestructura.
No convertirlos en skips, test.failing ni invertir expectativas.

Evidencias originales: `qa/multiobra360/results/latest/`.
Evidencias ampliadas, logs y capturas: `qa/multiobra360/results/independent-review/`.
Comparación de borrado: `deletion-before.json`, `deletion-after.json` en ese directorio.
Suite general: `/tmp/sa-multiobra-independent-general-20261024.json` y .log.

Pruebas añadidas:
- `qa/multiobra360/tests/IndependentBoundaryReview.test.js`.
- `qa/multiobra360/tests/emulator/IndependentTransactionReview.emulator.test.js`.
- Escenarios REVIEW en `qa/multiobra360/entry.browser.mjs`.
- Orquestación `qa/multiobra360/independent-review.py`.

## Siguiente entrega exigible

Resolver B1–B5 y los contratos de robustez; repetir batería original, ampliada y suite general.
Mantener los siete issues abiertos hasta validar el SHA integrado vigente con sus criterios.
Después validar app completa con cuentas sintéticas reales y una matriz específica de
fusión/traslado/ciclo de vida, respaldo, historial financiero y recuperación tras interrupción.

## Ampliación del paquete de aceptación

Se añadieron recorridos de navegador para B2 y B4, tres controles locales positivos
y validación estricta de las 26 comprobaciones. El ejecutor elimina evidencias de
capas anteriores antes de arrancar y distingue fallos de aserción (exit 1) de
ejecuciones incompletas (exit 2). La prueba negativa con Java inexistente y
JSON verdes antiguos pasó: no reutilizó resultados ni aprobó la ejecución.
Guía de ejecución y matriz: qa/multiobra360/INDEPENDENT_CASES.md.
