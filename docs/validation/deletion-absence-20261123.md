# Conservación ante ausencias de descargas — #361

Fecha: 2026-11-23. Trabajo aislado a partir de `main` 1.7.152.

## Regla protegida

Una respuesta vacía, parcial o de caché, o una lista con la misma cantidad de registros pero IDs distintos, **no demuestra una baja**. En `EmployeesIncomingMerge` y `CatalogIncomingMerge`, los registros ausentes de la respuesta se conservan. Si el mismo ID está en ambos lados sigue vigente el merge habitual por actualización. Los empleados con una marca explícita `deletedAt` siguen excluyéndose de la vista activa.

Este cambio **no implementa** las operaciones de borrado versionadas, revisión del receptor, outbox duradero, sincronización administrativa Firebase/Supabase ni retención tras reinicios. Es una mitigación acotada, no una certificación completa del bloque #360.

## Ciclo rojo → verde y comprobación

- Línea base: 15/15 tests de `[AUSENCIA]` fallaban al ejecutar la auditoría estricta de #359 sobre `main` 1.7.152.
- Después del cambio: 15/15 tests de `[AUSENCIA]` aprobaron; suite específica de merges 38/38 aprobada.
- Auditoría estricta de 45 casos: **23 PASS / 22 FAIL**, sin errores de infraestructura en la ejecución inicial. Mantener el gate rojo hasta que el protocolo completo se implemente.
- Suite general sobre la rama: **744/744 suites y 7,742/7,742 pruebas PASS**.
- Se conservaron pruebas históricas para la misma lógica, cambiando sus expectativas de 'ausente = baja' a 'ausente = pendiente de evidencia'.

## Riesgos que siguen abiertos

La ausencia tampoco puede servir para propagar borrados físicos legítimos hasta contar con el protocolo explícito del #362. El código sigue filtrando `deletedAt` de empleados de la vista activa sin una conservación durable garantizada de esas marcas; clientes antiguos y replays pueden recuperar registros borrados (#364). La reparación de integridad, caja chica e historial financiero requieren sus propias mitigaciones (#361, #339), no están incluidos en esta entrega.

No usar esta rama para afirmar que toda sincronización es segura, ni cerrar #359/#360/#361 hasta comprobar el resto de criterios.
