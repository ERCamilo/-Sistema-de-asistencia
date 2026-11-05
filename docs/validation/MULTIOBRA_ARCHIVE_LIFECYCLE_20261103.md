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

**Validación remota obligatoria (corrección posterior al SHA 345376a4):**
antes de escribir una copia histórica o su entrada de sincronización,
SA exige tres lecturas **desde el servidor** de Firestore, siempre dentro
del UID autenticado: `projectsV1/{sourceProjectId}`,
`projectAliasesV1/{sourceProjectId}` y el documento `projectRegistryV1/default`.
La presencia de un documento de obra —incluso tombstone—, un alias o un
registro canónico coincidente impide la recuperación aunque la obra falte
en el catálogo local. Desconexión, falta de permisos, respuesta no
verificable, cambio de cuenta, reparación/restauración concurrente y
modificación local del cierre original también bloquean sin escribir.
Los registros locales de obra eliminada también impiden reasignación.

Se usa `getDocFromServer` (no `getDoc` con posible caché). La comprobación
contra nube fue reproducida con **SDK real, firestore.rules del repositorio y
emulador aislado** para los casos de obra remota invisible localmente,
alias, ausencia remota y desconexión, sin credenciales de producción.

**Límite:** como Firestore y IndexedDB no comparten una transacción,
todavía existe una ventana teórica si otro dispositivo crea o restaura
la obra original exactamente después de la lectura y antes del guardado
local. Certificar estrictamente ese caso requiere un protocolo
transaccional de reserva/validación del lado servidor. El control actual
resuelve la ausencia de sincronización denunciada sin pretender ser un
bloqueo global entre dispositivos. La copia histórica no debe
confundirse con una migración de pagos.

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
  52 navegador), 0 errores de infraestructura; vuelto a ejecutar después
  de integrar la política 30+30 y el diagnóstico .log.
- Suite general final con las correcciones de UI y precache: **709/709
  suites, 7,254/7,254 tests PASS**. Las dos incompatibilidades iniciales
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


## Ampliación: diagnóstico voluntario y retención 30 + 30

### Informe de problemas (.log)

El asistente muestra «Compartir diagnóstico (.log)» tanto en la revisión
financiera especial como en el flujo de asignación y confirmación.
Genera un archivo de texto local con versión, fecha UTC, recuentos de
incidencias y categorías normalizadas de errores de lectura. **No incluye**
nombres, fichas, identificadores, importes, cuotas, registros financieros,
credenciales, consola ni datos completos de IndexedDB. Los textos de errores
se convierten a códigos controlados; no se copian directamente.

En dispositivos compatibles, el botón abre el menú de compartir del sistema.
En los demás, descarga el archivo. Si el usuario cancela el envío, no inicia
una descarga no solicitada. **No existe telemetría automática ni envío
a servidor** por esta función.

### Dos plazos obligatorios antes de retirar una obra del catálogo

- El estado `closed` representa una obra pausada/no operativa;
  `closedAt` inicia los **primeros 30 días**, que también siguen contando
  mientras la obra está archivada.
- Solo una vez transcurridos esos 30 días aparece
  «Solicitar eliminación», con confirmación explícita. La solicitud se
  guarda en `deletionRequestedAt`, de modo que puede sincronizarse
  mediante el catálogo Firestore y posteriormente cancelarse.
- Comienza un **segundo plazo de 30 días**, durante el cual se mantiene
  «Cancelar solicitud». Una cancelación se transmite como valor `null`
  explícito para evitar que la escritura `merge` deje una solicitud
  remota obsoleta. Reabrir está bloqueado hasta cancelar.
- Tras vencer el segundo plazo se puede iniciar una **revisión final**.
  Si la obra está realmente vacía, no es inicial/activa y supera una
  nueva verificación de dependencias locales, el usuario puede confirmar
  la baja del catálogo. Esta baja **no** equivale a purgar físicamente
  los datos asociados; se conserva la lápida de sincronización.
- Si la obra conserva empleados, nóminas, préstamos, registros compartidos
  o trabajos de sincronización, **no existe finalización automática**.
  La fase destructiva está pendiente en la issue #334.
- Las fechas locales sirven para la interfaz y como barrera adicional;
  **antes de habilitar la eliminación irreversible habrá que validar el
  tiempo en el servidor** y los dispositivos desactualizados, realizar
  un respaldo restaurable y obtener confirmación remota durable.
- No se programa un trabajo remoto ni se ejecutan borrados por estar la app
  cerrada. La revisión final se realiza al entrar de nuevo en la app.

### Validación de la ampliación 30+30 y .log

- Suite general: **709/709 suites, 7,254/7,254 pruebas PASS**
  tras incorporar la verificación remota de origen.
- Multiobra 360: **103/103 pruebas PASS**, 0 infraestructura.
- Pruebas nuevas: `ProjectDeletionPolicy.test.js`,
  `ProjectDeletionLifecycleUI.test.js`,
  `ProjectDiagnosticLog.test.js` y
  `ProjectDiagnosticLogUI.test.js`.
- Protección a nivel de IndexedDB: no puede retirarse una obra vacía
  sin ambos plazos, ni aunque se omita la interfaz.
- Exportación limitada a códigos anónimos y 250 casos; la prueba comprueba
  que no se filtren nombres, números de fichas, importes ni identificadores.

### Pruebas adicionales: identidad de la obra original en Firebase

- `ProjectHistoricalClosureRecovery.test.js`: 15/15 pruebas PASS,
  incluidas validación remota, obra presente solo en nube, alias canónico,
  permisos, desconexión, cambio de UID, registro local modificado, obra
  local eliminada y reintento idempotente.
- `js/tests/emulator/ProjectHistoricalClosureCloudGuard.emulator.test.js`:
  **6/6 PASS** en un servidor Firestore de bucle local, SDK real y
  `firestore.rules` del repositorio. No se usan cuentas de producción.
- Las consultas remotas no se satisfacen desde caché. Un error de red o
  permiso evita crear la copia histórica y evita escribir la outbox.
- Verificación antes de transacción IDB y validación de versión local
  dentro de la misma transacción, sin mantener transacciones IDB abiertas
  durante la petición de red.
- La recuperación que ya reconoce su proyecto original, aun como lápida
  local, también se bloquea. Para que la restauración sea posible cuando
  la nube o catálogo confirmen el estado no resuelto, el usuario debe
  resolver esa identidad en el flujo general de reconciliación.

### Resultado integrado de la corrección remota

- **Suite general**: 709/709 suites, 7,254/7,254 tests PASS.
- **Validación Firestore específica**: 6/6 PASS, SDK y reglas reales con
  emulador loopback, incluyendo lectura denegada, nube sin obra y offline.
- **Multiobra 360 repetida de forma secuencial**: 103/103 PASS (47 locales,
  4 emulador y 52 navegador a 390/1280 px), 0 fallos de infraestructura.
- La primera repetición simultánea falló antes de los casos de navegador
  por un export faltante de \`getDocFromServer\` en la fachada del
  harness QA. Se alineó la fachada y sus mocks con Firebase de
  producción; **no se relajaron ni eliminaron aserciones**.
- No se validó una cuenta real ni la ausencia de carreras de
  creación/restauración entre clientes después de la lectura remota.

## Confirmaciones y estados visuales — 5 de noviembre

Las acciones de pausar, reactivar, archivar, sacar del archivo, solicitar/cancelar eliminación y retirar una obra vacía exigen confirmación contextual con nombre de obra, SVG y una explicación corta. Cancelar, tocar el fondo o pulsar Escape no escribe. La pausa conserva el historial y no permite seleccionar la obra para trabajar. Sacar del archivo vuelve a Pausadas; requiere reactivación posterior.

El listado identifica estados mediante icono, etiqueta y borde semántico. No depende solo del color. La advertencia de borrado con historial aparece únicamente al pulsar Revisar eliminación, junto con los detalles de impacto local. Se mantienen las barreras de 30+30 y no se habilita borrado de datos.

Pruebas: ProjectActionDialog.test.js cubre confirmaciones, cancelación, doble toque, foco, Escape y contexto de eliminación. scripts/check-project-actions.cjs reproduce el flujo con los módulos y CSS reales, servicios ficticios y red restringida a loopback, en 320/390/1280 px, con axe y movimiento reducido. La CI ejecuta este recorrido.
