# #381 / #361 — Conservación sin republicación: auditoría independiente

Fecha: 2026-11-28. Base main: `0aa0b5a36f01c789d288864e42807a7aa8906c11` (1.7.157). Rama original: `d09b6726062e41598107ef6a1f22c0cfe026c958`. Candidata provisional 1.7.158; NO fusionar.

## Evidencia

- Integración de main: cuatro conflictos de lanzamiento resueltos; no había conflictos de lógica de merges.
- Suite focal: 103/103 PASS (ausencias, empleados, catálogo, MainSyncStore y EntityUploadTracker). Build y release staged PASS.
- Auditoría estricta de #359 copiada temporalmente de `08e4aad5df8a7786bc965262cc295c0ff90e8fc3`, sin modificar sus tests: 23/45 PASS, 22 FAIL, 0 errores de infraestructura, 0 pendientes. Sigue roja. Reporte local a2 `/tmp/sa381-policy-20261128/report.json` (incluye hashes del árbol de trabajo auditado; HEAD todavía era la rama anterior durante el ensayo de merge).
- Tres casos nuevos reproducen que la conservación local puede convertirse en una republicación de personal, puestos y líderes. La prueba ejecuta merges reales, MainSyncStore.enqueueEntities/flush, FirebaseService.saveEntities real y repositorios reales con transporte Firebase e IndexedDB simulados. No se usaron datos reales ni se hicieron llamadas de producción.

## Reproducción roja explícita

    node node_modules/jest/bin/jest.js --runInBand --testMatch '**/audit-tests/deletion-absence/*.audit.test.js'

Los tres casos deben fallar en este candidato. Primero descargan un ID que este dispositivo nunca subió, luego lo omiten del snapshot, conservan el ID localmente y agregan un alta nueva. El alta sí debe subir, pero la copia retenida no. Actualmente se escriben ambas. No se añade un skip ni se invierte la expectativa para simular éxito. El nuevo archivo está fuera del testMatch ordinario: el resultado verde del workflow normal NO certifica este requisito. La auditoría estricta #359 sigue siendo independiente y bloqueante por diseño.

## Siguiente implementación necesaria antes de merge

| Fase | Contrato de seguridad | Evidencia requerida |
| --- | --- | --- |
| 1. Identidad y procedencia | Retención durable por UID, obra/alcance y familia+ID; distinguir alta local de dato remoto antes visto y ausente; no usar timestamps solos como prueba de baja. | Descarga vacía/parcial/caché, cambio de sesión, reinicio y dos pestañas; primer snapshot tras actualización con baseline desconocida. |
| 2. Entrada y persistencia | Registrar retención junto a la copia local antes de liberar publicación; si falla el registro, bloquear la salida afectada sin borrar. No hacer una baja por ausencia. | Interrupción antes/durante transacción, error IndexedDB, replay y reinicio. |
| 3. Salida | Revalidar retenciones al encolar y al drenar: mirror (incluidas cuentas legacy), entities, reanudación, reintentos, escrituras directas de repositorios y bundles de nómina. No convertir un filtrado en un borrado del mirror. Altas explícitas y cambios no afectados siguen sincronizando. | Tres nuevas pruebas rojas → verdes; outbox previo, force/resume, cambio cuenta y subida concurrente. |
| 4. Bajas explícitas | Acordar #362/#363/#364: operación de baja versionada durable, revisión y restauración explícita, política de clientes antiguos. No activar la conservación si esto impide bajas legítimas sin alternativa. | SDK/emulador, dos dispositivos, replay, recuperación y reglas desplegadas. |
| 5. Integridad | Caja chica, referencias/horas y protección financiera pendientes; no sustituir la auditoría completa por los tres casos nuevos. | Auditoría #359 sin fallos, suite completa y revisión de alcance. |

Evitar un parche de solo memoria, bloquear todo el tráfico o quitar IDs de un espejo de reemplazo completo: cualquiera puede generar otro modo de pérdida. No cerrar #361, #360 ni #359 hasta verificar sus criterios.
