# Auditoría de conservación y borrado explícito

Código auditado: `628283671eb96b1347d9a1655bf01059f77790a6`. Semilla: `0x5a202611`.

**45 pruebas: 11 aprobadas, 34 fallidas, 0 pendientes.**

Las fallas son incumplimientos de la política solicitada; no se convierten en éxitos ni se ocultan con continue-on-error.
Se ejecutan código real de merges, repositorios, callbacks extraídos de app.js e IndexedDB sobre fake-indexeddb.
Firebase está simulado. Esta ejecución no certifica reglas del servidor, concurrencia real entre dispositivos ni recuperación de datos de producción.

| Resultado | Caso |
| --- | --- |
| FAILED | [AUSENCIA] personal no pierde registros ante una respuesta vacía, aun después de conocerlos en la nube |
| FAILED | [AUSENCIA] personal no pierde registros ante una respuesta parcial, aun después de conocerlos en la nube |
| PASS | [AUSENCIA] personal no pierde registros ante una respuesta caché, aun después de conocerlos en la nube |
| FAILED | [AUSENCIA] personal secuencia determinista de 256 subconjuntos/repeticiones mantiene todos los IDs sin marcas de borrado |
| FAILED | [AUSENCIA] personal la misma cantidad de registros con IDs diferentes tampoco acredita un borrado |
| FAILED | [AUSENCIA] puestos no pierde registros ante una respuesta vacía, aun después de conocerlos en la nube |
| FAILED | [AUSENCIA] puestos no pierde registros ante una respuesta parcial, aun después de conocerlos en la nube |
| PASS | [AUSENCIA] puestos no pierde registros ante una respuesta caché, aun después de conocerlos en la nube |
| FAILED | [AUSENCIA] puestos secuencia determinista de 256 subconjuntos/repeticiones mantiene todos los IDs sin marcas de borrado |
| FAILED | [AUSENCIA] puestos la misma cantidad de registros con IDs diferentes tampoco acredita un borrado |
| FAILED | [AUSENCIA] líderes no pierde registros ante una respuesta vacía, aun después de conocerlos en la nube |
| FAILED | [AUSENCIA] líderes no pierde registros ante una respuesta parcial, aun después de conocerlos en la nube |
| PASS | [AUSENCIA] líderes no pierde registros ante una respuesta caché, aun después de conocerlos en la nube |
| FAILED | [AUSENCIA] líderes secuencia determinista de 256 subconjuntos/repeticiones mantiene todos los IDs sin marcas de borrado |
| FAILED | [AUSENCIA] líderes la misma cantidad de registros con IDs diferentes tampoco acredita un borrado |
| PASS | [PRÉSTAMOS] 256 respuestas parciales y repetidas conservan préstamos, pagos y cuotas |
| PASS | [ASISTENCIAS] 256 respuestas vacías/parciales y fuera de orden conservan todos los días |
| PASS | [PRÉSTAMOS] comparar cantidades no basta: IDs distintos con la misma cantidad conservan ambas deudas |
| FAILED | [ASISTENCIAS] una desmarcación remota sin deletedAt no elimina una asistencia existente |
| PASS | [MARCA] una marca explícita de asistencia sobrevive a un replay más viejo |
| PASS | [MARCA] un préstamo con registro explícito de eliminación no reaparece con una copia vieja |
| FAILED | [RETENCIÓN] más de 300 borrados no olvidan la evidencia del primer préstamo eliminado |
| FAILED | [REPLAY] personal eliminado no reaparece cuando llega después un snapshot viejo de caché |
| FAILED | [DETECTOR] faltar en una lista no se presenta al usuario como eliminación confirmada |
| FAILED | [REVISIÓN] una eliminación explícita de personal espera confirmación antes de cambiar la lista |
| FAILED | [REVISIÓN] eliminar un préstamo desde otro equipo no cambia la deuda antes de confirmar |
| FAILED | [REVISIÓN] una asistencia eliminada remotamente espera confirmación antes de dejar de contar |
| FAILED | [PAUSA] elegir conservar y pausar impide aplicar la eliminación al llegar otro snapshot |
| FAILED | [INTEGRIDAD] una referencia aislada a un puesto faltante no se elimina sin evidencia de borrado |
| FAILED | [INTEGRIDAD] reparar un catálogo incompleto no retira horas del puesto ausente |
| FAILED | [CAJA-IDB] un snapshot vacío no borra cargos confirmados del almacenamiento durable |
| FAILED | [CAJA-IDB] una consulta por período no implica eliminar lo que no devolvió |
| PASS | [CAJA-IDB] una escritura pendiente conserva el cargo durante una descarga parcial |
| PASS | [CAJA-IDB] descargar otro período no borra el historial fuera de su alcance |
| FAILED | [BORRADO-IO] personal conserva un registro de eliminación, en lugar de retirar el documento físico |
| FAILED | [BORRADO-IO] puestos conserva un registro de eliminación, en lugar de retirar el documento físico |
| FAILED | [BORRADO-IO] líderes conserva un registro de eliminación, en lugar de retirar el documento físico |
| FAILED | [BORRADO-IO] caja chica conserva un registro de eliminación, en lugar de retirar el documento físico |
| PASS | [BORRADO-IO] la ruta soft-delete de personal conserva una marca durable y rechaza una edición posterior |
| FAILED | [RECUPERACIÓN] volver a subir puestos antiguos no sobreescribe datos remotos más nuevos |
| FAILED | [RECUPERACIÓN] volver a subir líderes antiguos no sobreescribe datos remotos más nuevos |
| FAILED | [FIRESTORE] personal solicita eventos de metadata para observar la confirmación del servidor |
| FAILED | [FIRESTORE] puestos solicita eventos de metadata para observar la confirmación del servidor |
| FAILED | [FIRESTORE] líderes solicita eventos de metadata para observar la confirmación del servidor |
| FAILED | [FIRESTORE] caja chica conserva la procedencia de caché para decidir si una descarga está confirmada |

Los hashes de los archivos auditados y los fallos completos están en report.json y execution.log.

Esta es una línea de base roja de evaluación; no es un certificado de conservación. Los fallos agrupan varias rutas de las mismas causas, no representan 34 incidentes independientes de producción.

[Evaluación y plan de resolución](../plans/explicit-deletion-safety.md).
