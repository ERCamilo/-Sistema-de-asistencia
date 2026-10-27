# Revisión independiente del commit 0f080300 — 2026-10-26

## Dictamen

Las correcciones del worker resuelven los 19 fallos de la revisión anterior:
la ampliación de 26 casos y la batería original de 103 pasan sobre
`0f080300d9d9ee23a41d7d3c65aa143291ab33b9`.
No se repitió una revisión sobre 93ca8b3f ni se atribuyen a este candidato
los fallos históricos ya corregidos.

Sin embargo, nuevas pruebas reproducen tres límites adicionales, incluida
una regresión en ediciones simultáneas. El commit no basta para declarar
multiobra completamente validado. Se recomienda una corrección posterior.

PR #310: https://github.com/ERCamilo/-Sistema-de-asistencia/pull/310
Estado observado: MERGED; sus checks policy, Jest y Cloudflare Pages pasaron.
El main remoto observado al revisar era 5a017272614112025f874e30e3e6f7f763e28030.
Este informe evalúa el SHA solicitado, no certifica ese main posterior.

## Método y resultados

Worktree aislado:
`/home/ubuntu/worktrees/sa-multiobra-0f080300-review-20261026`.

Se verificó que las pruebas independientes, el adaptador de navegador y el
ejecutor de 26 casos coinciden byte a byte con el paquete anterior.
No se cambiaron aserciones para obtener verde. Las dependencias corresponden
al mismo package-lock. Los módulos de producto permanecieron idénticos al SHA.

| Verificación | Total | Pasa | Falla | Infraestructura |
| --- | ---: | ---: | ---: | ---: |
| Ampliación anterior: local | 11 | 11 | 0 | 0 |
| Ampliación anterior: SDK/emulador | 3 | 3 | 0 | 0 |
| Ampliación anterior: Chromium 390/1280 | 12 | 12 | 0 | 0 |
| Ampliación anterior, total | 26 | 26 | 0 | 0 |
| Batería original: local/SDK/Chromium | 103 | 103 | 0 | 0 |
| Suite general Jest | 6648 | 6648 | 0 | 0 |
| Nuevos límites: integración local | 5 | 2 | 3 | 0 |
| Nuevos límites: Chromium 390/1280 | 6 | 0 | 6 | 0 |
| Nuevos límites, total | 11 | 2 | 9 | 0 |

Suite general: 669/669 suites. Release `npm run test:release`: PASS.
Las dos baterías anteriores registraron eligible:true con el SHA solicitado.
Los nueve fallos nuevos corresponden a tres causas, no a nueve causas distintas.
Las seis comprobaciones de integridad de los nuevos recorridos pasaron:
no se detectaron cambios en empleados/préstamos, puestos, asistencia o cierres
protegidos por esas comprobaciones.

## C1 — Alta: ediciones simultáneas pierden cambios confirmados

Archivos:
- js/modules/features/payroll/ActivePayrollSettings.js, updateActiveDayHours (línea 73).
- js/modules/ui/AttendanceHandlers.js, changeBaseHours (línea 30).
- js/modules/features/payroll/ProjectPayrollConfigStore.js, putConfig.

Al retirar la actualización optimista para corregir el guardado fallido,
dos operaciones pendientes leen la misma caché. Cada una guarda una copia
completa de la configuración anterior junto con su cambio.

Reproducción local con IDB real:
1. Dos fechas empiezan con 8 horas.
2. Se inicia el cambio de la primera a 10 y se retiene su escritura.
3. Se inicia el cambio de la segunda a 6 antes de finalizar la primera.
4. Se confirma la primera y luego la segunda.
5. Resultado: primera=8, segunda=6. La primera edición confirmada se pierde.

Reproducción con dos clics reales en Chromium:
- Partir de 8 horas, retener la primera escritura y pulsar +0.5 dos veces.
- Se completan las dos escrituras: se guardan y muestran 8.5, en lugar de 9.
- Confirmado tanto a 390 como a 1280 píxeles.

Regresión comprobada con el mismo test C1:
- Padre inmediato b04d29b2: PASS.
- Commit solicitado 0f080300: FAIL.
Solo se ejecutó ese control comparativo en el padre; no otra revisión histórica.

Aceptación: conservar ambos cambios de fechas diferentes y acumular los
incrementos del control. Serializar/combinar los cambios sin reintroducir
valores no guardados como confirmados. Mantener el control de fallo B4 aprobado.

## C2 — Media: el evento de un guardado obsoleto elude la revisión de caché

Archivo: js/modules/features/payroll/ActivePayrollSettings.js,
updateActiveDayHours (líneas 73–85), setActivePayrollConfig y listener
payroll-config:changed.

La comparación de cacheRevision evita la asignación directa de una respuesta
vieja, pero el mismo guardado emite después payroll-config:changed sin esa
condición. El listener vuelve a aplicar config:saved.

Reproducción:
1. Una edición guarda 8.5 en IDB; se retiene su retorno antes de actualizar UI.
2. Llega y se guarda una configuración posterior con 10; la pantalla muestra 10.
3. Termina el guardado anterior y emite su evento.
4. IDB conserva 10, pero la pantalla vuelve a 8.5.
El test local usa 9 como edición anterior y reproduce el mismo resultado.

Confirmado con repositorio real y con clic real/IndexedDB nativo en ambos anchos.
Esto no prueba que se haya calculado o pagado una nómina incorrecta en producción.

Aceptación: un resultado obsoleto no puede reemplazar la vista mediante su
evento después de haber sido descartado por la revisión. Mantener los avisos
y publicación legítimos de una configuración vigente.

## C3 — Media: la inserción inicial pendiente sobrevive al cambio de cuenta

Archivo: js/modules/features/projects/ProjectCatalogSync.js,
seedPayrollConfig (líneas 250–260) y su llamada en applyRemoteCatalog (línea 377).

El commit verifica vigencia antes de entrar en seedPayrollConfig, pero el
helper no recibe esa vigencia. Su mutador IDB solo comprueba si existe el
registro. Una inserción que queda en espera no vuelve a comprobar la cuenta.

Reproducción:
1. A recibe una obra nueva; su inserción inicial de configuración queda pendiente.
2. Se detiene la sincronización, cambia la cuenta a B y se sustituye la parte
   del catálogo de proyectos utilizada por el caso sintético.
3. Se libera la inserción anterior.
4. Aparece projectPayrollConfigs de la obra de A dentro del nuevo conjunto
   local, sin su obra correspondiente: queda una configuración huérfana.

Confirmado con la transacción IDB real y Chromium en 390/1280.
No se demuestra escritura no autorizada a Firebase, evasión de reglas ni
migración de empleados entre cuentas. El defecto comprobado es local y afecta
a la configuración inicial de nómina.

Aceptación: invalidar la inserción dentro de su frontera atómica si la sesión,
la autorización o el conjunto local que la originó ya cambiaron.
Mantener la protección B2: una semilla tampoco debe sobrescribir una edición.

## Límites que siguen pendientes

- Autenticación OAuth real con cuentas de prueba y reglas efectivamente desplegadas.
- Dos dispositivos físicos, cierres/reinicio y recuperación con conexión intermitente.
- Ciclo completo de fusión de obras fragmentadas: vista previa, conflictos,
  posiciones, empleados, asistencia, préstamos/pagos y cierres.
- Pausa, consulta en solo lectura, reactivación, cierre/archivo y traslados.
- Restauración y recuperación integral después de esas operaciones.

Las pruebas actuales usan componentes reales, clics reales, IndexedDB nativo
y SDK de Firestore contra un emulador local, con identidad externa simulada.
No son una certificación del arranque de index.html, OAuth, PWA ni producción.

## Repetir los nuevos casos

```bash
cd /home/ubuntu/worktrees/sa-multiobra-0f080300-review-20261026
python3 qa/multiobra360/commit0f-review.py
```

Resultado sobre el SHA revisado: exit 1; 2 PASS, 9 FAIL, 0 infraestructura.
El runner exige los cinco casos locales y las seis parejas escenario/anchura.
No convertir los fallos en skips, invertir aserciones ni contarlos como errores
de infraestructura para aceptar el cambio.

Archivos:
- qa/multiobra360/tests/Commit0f080300Review.test.js.
- qa/multiobra360/commit0f-cases.browser.mjs.
- qa/multiobra360/commit0f-browser.cjs.
- qa/multiobra360/commit0f-review.py.

El navegador usa un adaptador separado que incorpora los casos en memoria;
los archivos originales de las baterías de 26 y 103 no se modifican.
Los nuevos tests están fuera de js/tests y no modifican workflows ni bloquean
commits normales de otras mejoras.

Evidencias locales:
- qa/multiobra360/results/commit0f-review/acceptance.json.
- qa/multiobra360/results/commit0f-review/unit.json y browser.json.
- Logs, capturas y c1-parent.json en ese mismo directorio.
- qa/multiobra360/results/independent-review/ (26 casos).
- qa/multiobra360/results/latest/ (103 casos).
- /tmp/sa-0f080300-general-20261026.json y .log (suite general).

No se modificaron módulos de producto, main, datos reales, issues ni despliegues.
