# Cierres de nómina en backups y restauración

Fecha: 2026-09-27 UTC / 26 de septiembre en República Dominicana.
Rama: fix/r07-petty-cash-projects-20260924. PR: #170.

## Problema verificado

La descarga habitual y la descarga rápida incluían abonos dentro del empleado,
pero omitían los detalles de payrollClosures. El volcado interno exportDB sí
tenía esa colección: no era la ruta usada por esas pantallas. La importación
FULL y la restauración desde archivo tampoco incorporaban los cierres.

## Corrección

- Ambas descargas leen todos los cierres disponibles en IndexedDB, incluidos
  históricos sin obra y de obras huérfanas. Conservan IDs, filas, totales,
  referencias, estados y metadatos originales. Un error de lectura impide
  generar un respaldo nuevo silenciosamente incompleto.
- La migración de archivos antiguos preserva el campo payrollClosures cuando
  existe. La confirmación de importación muestra el número de cierres, o
  informa que un backup antiguo no los incluye.
- Los cierres se validan antes de restaurar y se incorporan en la misma
  transacción IndexedDB que empleados, asistencia y configuración.
- Se utiliza el contrato existente de merge monotónico: conservar cierres
  locales ausentes del archivo, no reactivar cierres anulados y rechazar
  identidades con contenido incompatible. La ausencia del campo y una lista
  vacía nunca borran cierres históricos.
- La restauración desde archivo suspende guardados concurrentes; ante un fallo
  conserva el estado durable y repone el estado en memoria. Los callbacks de
  éxito y la recarga sólo se ejecutan si la operación realmente terminó.
- La prueba con el archivo real exportado reveló una llamada a
  PettyCashStore.prepareForFullImport, método inexistente. La importación FULL
  ahora usa preparePettyCashBackupForRestore y entrega su propiedad pettyCash
  a la misma transacción.
- Se agregaron las nuevas dependencias estáticas al precache de la PWA.

## Validación reproducible

Suite completa: 487 suites / 4718 pruebas PASS. Ambos recorridos de navegador PASS.

- PayrollClosureBackupAtomic.test.js: restauración exacta y recarga, backup
  antiguo/vacío, conservación de anulaciones, conflicto, fallo de escritura
  y payload inválido.
- PayrollClosureBackupFlows.test.js: lectura para exportar, cierre legacy y
  scoped huérfano, error de lectura, FULL import, rollback, IDs duplicados,
  importación conjunta de Caja Chica y cierres.
- node scripts/check-payroll-closure-backup.cjs: Chromium, contextos aislados,
  escritorio (archivo) y móvil (FULL). Ejecuta las dos descargas reales,
  conserva cierres schema 2 y 3 y pagos después de recargar, verifica el número
  mostrado y provoca un conflicto real en archivo para comprobar rollback
  y ausencia de callback de éxito.
- RECOVERY_TEST_ORIGIN=https://<preview>.sistema-de-asistencia.pages.dev
  node scripts/check-payroll-closure-backup.cjs permite probar la publicación.

## Límites de la comprobación

No se consultó ni modificó la cuenta real del usuario: el navegador de pruebas
utiliza datos sintéticos y bloquea las llamadas a Firebase. La exportación
respalda los cierres disponibles en el dispositivo; no descarga automáticamente
todos los cierres de la nube. No se afirma haber encontrado el cierre
PAYROLL-CLOSURE-127z9jc1yh3evo en Firestore.

La sincronización ordinaria de cierres y su colección separada en Firestore
ya existen. Esta corrección no modifica ese protocolo ni convierte la
restauración local en una subida masiva de cierres. Los snapshots de nube son
una ruta distinta y no se presentan como verificados por estas pruebas.

Los backups que antes omitieron cierres no pueden recuperar ese contenido por
sí solos. Se requiere otra copia que sí lo conserve o su descarga autenticada
desde la nube. No se tocó producción ni main.
