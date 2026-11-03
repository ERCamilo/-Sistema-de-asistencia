# Multiobra — Incidencias archivables, cierres históricos y ciclo de vida
**Fecha:** 2026-11-03  
**Base:** `main` v1.7.125 (`db96007c` al iniciar)  
**Rama:** `feat/multiobra-archive-lifecycle-20261103`

## Problema

Tras eliminar una ficha de empleado, cuenta o proyecto pueden quedar cierres,
abonos y asistencias con referencias sin destino válido. El asistente de
reconciliación no ofrecía archivo individual de conflictos ni salida permanente
en todos los pasos. Además, la lista de obras mostraba estados históricos
sin controles completos y únicamente permitía borrar obras verificadas vacías.

## Fase A — Archivar/recuperar incidencias sin alterar datos de negocio

- Nueva `ProjectConflictArchiveStore`: indicadores durables en IndexedDB
  `settings`, separados por UID autenticado y escritos con `atomicMutate`.
- Casos archivables: empleados, puestos/líderes y otros registros pendientes,
  cajas chicas, asistencias sin empleado y hallazgos financieros de diagnóstico.
- La lista principal no muestra incidencias archivadas, pero su archivo sigue
  disponible desde Ajustes y desde el asistente, con acción «Restaurar».
- Una incidencia que cambia de causa se vuelve a mostrar para revisión.
- En ningún caso el archivo altera cierres, préstamos, pagos, empleados,
  asistencias o asignaciones de obra.
- «Salir por ahora» visible incluso ante validaciones bloqueadas; cerrar
  durante una escritura no cancela su transacción, pero los resultados
  tardíos no se aplican a otro asistente abierto después.

**Límite:** el archivo de incidencias es LOCAL por dispositivo y usuario,
no se sincroniza entre dispositivos. Una restauración de base de datos
completa puede reemplazar esos indicadores locales.

## Fase B — Ciclo de vida reversible de obras

- Acciones desde la lista de administración (no la vista de solo lectura):
  `active -> closed -> archived -> closed -> active`.
- Cambios transaccionales sobre la versión durable más reciente de la obra,
  conservando nombre y metadatos modificados en otra pestaña.
- No se puede cerrar ni archivar la obra en uso ni la obra inicial.
- Importaciones, reparaciones y cambios de ajustes sin guardar bloquean
  estas transiciones.
- La recuperación desarchivando vuelve primero a «cerrada» y debe
  reabrirse explícitamente. No se borran registros de la obra.

## Fase C — Recuperación histórica de cierre con empleado eliminado

- Los cierres de una obra desconocida en el catálogo local y cuyos registros
  contienen empleados ausentes pueden recuperar una COPIA histórica en
  una obra activa seleccionada y mediante confirmación explícita.
- El original permanece intacto; la copia conserva filas, importes,
  referencias y totales sin recalcular. No se crean empleados,
  préstamos, abonos ni nuevos hechos económicos.
- Persistencia local transaccional de la copia y una sola entrada en
  `mainSyncOutbox`; un reintento no duplica el cierre.
- Guardas de autenticación y restauración/reparación en curso.
- Se bloquea la recuperación si la obra original existe en el catálogo
  local, si ya se recuperó en otra obra o si hay una cadena de cierres
  anteriores que necesita revisión especial.
- La revisión especial ofrece selector de obra incluso cuando ese cierre
  es el único pendiente. Los cierres con obra válida y empleado
  eliminado siguen disponibles como historial informativo.

**Límite importante:** la presencia/ausencia de una obra se verifica contra
el catálogo LOCAL. La ausencia puede deberse a falta de sincronización.
Antes de certificar esta recuperación para producción hace falta validar
la identidad del proyecto original contra la nube. La copia histórica no
debe confundirse con una migración de pagos.

## Fase D — Eliminación de obras

- Ya existía el borrado verificado de **obras vacías**, con protección de
  obra activa/inicial, referencias y sincronizaciones pendientes.
- Se añadió «Revisar impacto de eliminación»: informa, sin escribir,
  el número de empleados, puestos, líderes, asistencias, préstamos,
  cierres, caja chica, referencias cruzadas y datos por sincronizar.
- **El borrado completo de una obra ocupada NO está habilitado**.
  No se ejecutó ninguna eliminación real. Permitirlo sin un protocolo
  de backup, dependencias compartidas, borrado coordinado en nube y
  protección antirresurrección podría destruir datos de otras obras.

### Requisitos antes de la eliminación total

1. Recuento completo local + nube con verificación de integridad;
   registros compartidos deben quedar excluidos del borrado.
2. Respaldo completo comprobado y recuperable, con manifest SHA y
   confirmación explícita del usuario.
3. Plan de borrado duradero por lotes con estado idempotente,
   reintentos y progreso observable.
4. Lápidas por entidad/obra y consenso entre dispositivos para que
   clientes desconectados no reintroduzcan datos antiguos.
5. Reconciliación de cierres, nómina, préstamos y pagos; prohibir
   eliminación cuando exista referencia financiera compartida
   sin decisión explícita.
6. Pruebas de fallo parcial, reanudación, cambio de cuenta,
   intermitencia y restauración desde respaldo.

## Comprobaciones

- `js/tests/ProjectConflictArchive.test.js`: archivo/reversión,
  cuenta y asistencia huérfana.
- `js/tests/ProjectLifecycleArchive.test.js`: ciclo de vida,
  prohibiciones y vista previa sin borrado.
- `js/tests/ProjectAtomicStatusTransition.test.js`: cambio
  transaccional que conserva un renombrado reciente.
- `js/tests/ProjectHistoricalClosureRecovery.test.js`: copia financiera
  fiel, original intacto, atomicidad, no duplicación, guardas.
- `js/tests/ProjectHistoricalClosureActionUI.test.js`: selector disponible
  para revisión especial de cierre como único pendiente.
- Compatibilidad: se conservaron intactas las pruebas originales
  `ProjectExtendedDiagnostics.test.js` y
  `ServiceWorkerPrecacheManifest.test.js`.
- Multiobra 360: 103/103 PASS (47 locales, 4 emulador Firestore,
  52 navegador), 0 errores de infraestructura en la primera ejecución.
- Suite general final con las correcciones de UI y precache: **705/705
  suites, 7,228/7,228 tests PASS**. Las dos incompatibilidades iniciales
  (cantidad de detalles del panel y manifiesto SW) se resolvieron
  sin cambiar las expectativas de las pruebas existentes.

## Riesgos pendientes

No se probó contra cuentas reales ni se borró ningún registro real.
Pendientes: revisión independiente del PR, autenticación y permisos
de Firebase en nube, dispositivos múltiples, integridad de
cierres/nóminas históricas, ciclo de vida de clientes obsoletos
y proceso de borrado total/recuperación del sistema.

## Resultado del candidato

La implementación local incluye cinco grupos de pruebas nuevas:
ProjectConflictArchive.test.js (5), ProjectLifecycleArchive.test.js (5),
ProjectAtomicStatusTransition.test.js (1),
ProjectHistoricalClosureRecovery.test.js (4) y
ProjectHistoricalClosureActionUI.test.js (1), más las pruebas
preexistentes de Multiobra. Los cierres y datos reales no se modificaron.

La aprobación de pruebas locales no certifica el borrado integral ni
una sesión de producción. La fase destructiva requiere un PR específico,
un protocolo durable y validaciones multidispositivo.
