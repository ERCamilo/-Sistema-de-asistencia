# Conservación de datos y revisión de eliminaciones

Evaluación del 10/11/2026. Código examinado: PR #359, runtime `12230decd6db7bf00ee57dee6f50cb168a278fb7`. Las pruebas usan datos ficticios y no acceden a Firebase/Supabase reales. Este documento propone el protocolo completo; la auditoría añadida lo exige, pero no lo implementa.

## Dictamen

La regla solicitada es adecuada: **la ausencia en una descarga jamás acredita una eliminación**. Tampoco la acredita una lista confirmada por el servidor: puede ser una consulta filtrada, otra página, otro período o una colección incompleta por un fallo de migración.

Antes de retirar un registro deben existir dos cosas distintas:

1. Evidencia explícita, durable y versionada de la operación de eliminación en el origen.
2. Una decisión de revisión en el dispositivo receptor, vinculada a esa operación y a las versiones que se mostraron al usuario.

El modal es la capa de decisión. La conservación depende también del merge, de las escrituras, del almacenamiento local, de las reglas del servidor y de la política de retención. Una confirmación visual aislada no proporciona esas garantías.

**No integrar el PR como si ya cumpliera esta política completa.** La corrección anterior conserva lecturas parciales y referencias conocidas; aún quedan rutas que infieren borrados por ausencia, borrados físicos y falta de revisión en los canales granulares. La auditoría nueva debe permanecer roja hasta cerrar esas brechas.

## Qué hace SA actualmente

| Datos | Protección existente | Brecha respecto de la regla solicitada |
| --- | --- | --- |
| Personal | Fusión por registro, préstamos anidados por ID, soft-delete `deletedAt`, transacción que rechaza un borrado antiguo | La línea de base permite retirar un empleado por ausencia en un snapshot posterior. Existe una API de borrado físico. El LiveSync aplica marcas sin revisión receptora. Una copia vieja puede reaparecer tras retirar la marca de la vista en memoria. |
| Puestos | LWW, preservación de caché/lecturas parciales y referencias conocidas en #359 | Un puesto sin referencias puede retirarse por ausencia. `deleteOne` borra el documento físico. La subida de una copia antigua puede sobrescribir campos nuevos conservando el timestamp remoto. |
| Líderes | Protección equivalente y referencias de equipo/pagador en #359 | Comparte los problemas de puestos: ausencia, borrado físico y sobrescritura de campos en una subida antigua. |
| Préstamos | Unión por ID de préstamos, pagos y cuotas; `deletedItemIds` para borrados explícitos | Las marcas se aplican sin revisión del receptor. El límite de 300 marcas por campo olvida evidencias antiguas y permite reapariciones. La eliminación del empleado propietario exige preservar también el contexto financiero. |
| Caja chica | Outbox durable, protección de borradores y escrituras pendientes, versiones de escrituras; el espejo Supabase utiliza `deleted_at` | Un snapshot vacío o acotado puede retirar cargos confirmados de IndexedDB. Firebase usa borrado físico. El espejo de Supabase y Firebase necesitan el mismo protocolo; la presencia de `deleted_at` en uno no protege al otro. |
| Asistencias | La ausencia de una clave no borra; marcas explícitas y LWW por registro; outbox diario | Se aplica una desmarcación remota sin `deletedAt`. Las eliminaciones explícitas llegan sin revisión receptora. La compactación local a 60 días no prueba que todos los dispositivos hayan recibido la marca. |

La reparación de integridad es otra entrada relevante: las guardias actuales evitan limpiezas masivas, pero todavía pueden retirar una referencia aislada o un tramo de horas cuando falta su puesto. Un dato inconsistente debe quedar pendiente de reconciliación, con su valor original conservado; no debe eliminarse para que la validación quede limpia.

### Pantalla existente

`IncomingChangeModal` ya ofrece aplicar, conservar y pausar, o volver a subir. Su alcance es insuficiente:

- El hook principal omite la carga inicial y deja fuera las colecciones granulares en el detector del documento general.
- El detector legacy llama «eliminado» a un registro que simplemente falta en una lista.
- Los callbacks reales de personal, préstamos y asistencia aplican eliminaciones antes de una decisión receptora.
- «Conservar y pausar» pausa la subida, pero otro snapshot todavía puede aplicar una eliminación entrante.
- «Volver a subir» invoca un guardado global forzado; no es una recuperación limitada a IDs faltantes con revisión de versión.
- La revisión pendiente no tiene una cola durable común para sobrevivir a una recarga.

Las reglas Firestore del repositorio permiten `write` al dueño de esas colecciones, lo que también permite borrados físicos. Revisar y desplegar las reglas correctas es parte del trabajo. Esta auditoría no comprobó las reglas efectivamente desplegadas.

## Pruebas añadidas y alcance

Ejecutar:

```sh
npm run test:deletion-safety
```

Se usa un Jest independiente (`jest.deletion-safety.config.cjs`). La suite ordinaria sigue separada: aprobarla no equivale a aprobar la nueva política. El comando estricto devuelve código 1 al detectar brechas, y código 2 ante errores de infraestructura. No usa `test.failing`, omisiones ni inversión de resultados.

La evidencia reproducible incluye:

- Listas vacías, parciales, confirmadas y de caché después de establecer una línea de base.
- Cambios de IDs con la misma cantidad total: las cuentas de registros no bastan para detectar pérdida.
- Secuencias con semilla fija `0x5a202611`, hasta 256 rondas por familia, con subconjuntos y repeticiones. Cada caso se detiene y muestra el primer contraejemplo si falla.
- Conservación de préstamos, sus pagos y sus cuotas; sumas de deudas y horas, no solo cantidades.
- Caja chica con el servicio IndexedDB real sobre fake-indexeddb, incluyendo la retirada durable de cargos, outbox pendiente y consultas por período.
- Llamadas a repositorios reales con Firebase simulado: borrado físico, soft-delete y subida de versiones antiguas.
- Extracción AST de los callbacks reales de `app.js`, ejecutados con dependencias controladas, para probar que la revisión ocurra antes de perder personal, deuda o asistencia y después de pulsar pausar.
- Reparación de referencias/horas aisladas sin una marca de eliminación.
- Evidencias que se olvidan por el límite de 300 marcas y replay de una copia anterior al borrado.
- Procedencia de caché y suscripción a cambios de metadata del SDK.

Resultado local de la línea de base: **45 casos, 11 aprobados y 34 fallidos**, sin errores de infraestructura. Son escenarios que comparten causas, no 34 defectos independientes. [Resultados completos](../validation/deletion-safety-2026-11-10.md).

El informe se genera en `/tmp/sa-deletion-safety-audit/`: `report.md`, `report.json`, resultados Jest y log completo. Guarda SHA del código, hashes de los módulos y de las pruebas. El workflow `Deletion safety policy` conserva la misma evidencia como artefacto.

El chequeo de GitHub no usa `continue-on-error`. Para que impida efectivamente cualquier integración, el administrador debe configurarlo como requerido en las reglas de `main`, sin bypass habitual. No se modificaron unilateralmente esas reglas.

Estas pruebas no certifican aún concurrencia real de Firestore, reglas desplegadas, Supabase, cierres entre dos dispositivos reales ni pérdidas de alimentación. Son la primera barrera ejecutable y muestran incumplimientos concretos del cliente actual.

## Protocolo recomendado

### 1. Registro explícito y eliminación lógica

Un borrado conserva el registro o un índice durable de su identidad. La operación lleva, como mínimo:

```json
{
  "operationId": "UUID estable durante reintentos",
  "action": "delete",
  "entityType": "position",
  "entityId": "position-id",
  "projectId": "project-id",
  "baseRevision": 17,
  "revision": 18,
  "actorUid": "cuenta autenticada",
  "deviceId": "dispositivo origen",
  "deletedAt": "timestamp del servidor",
  "reason": "motivo de la operación"
}
```

Es un contrato propuesto. No basta con añadir estas propiedades desde cualquier lugar: se debe validar y guardar la operación junto con el cambio mediante una transacción/lote atómico. La revisión distingue una cuenta autenticada de un alias humano no verificado. El orden de versiones lo resuelve el servidor; el reloj de un teléfono no debe decidir por sí solo qué borrado gana.

La ausencia produce «registro no encontrado en esta descarga», nunca una eliminación ni una marca fabricada. El recolector de integridad preserva datos y abre incidencias de reconciliación. Los borrados antiguos sin evidencia se presentan como incidencias legacy; no se inventan autor ni fecha.

### 2. Bandeja común de revisión, antes de aplicar

Debe cubrir carga inicial, espejo, LiveSync por colección, asistencia zonal, caja chica, historial bajo demanda y restauraciones. El lote pendiente se guarda localmente por cuenta/obra y sobrevive a reinicios. Se deduplica por `operationId` y revisión; una repetición de red no vuelve a preguntar una decisión ya aplicada.

La pantalla presenta un resumen por tipo y un detalle desplegable: nombre/número, fecha, puesto, importe cuando corresponda, origen y motivo verificados. También muestra dependencias: préstamos de un empleado, horas del puesto o documentos de un período. Los importes se toman de las funciones vigentes; no se cambian las fórmulas salariales o de intereses.

Acciones recomendadas:

| Acción | Efecto |
| --- | --- |
| Aceptar eliminaciones | Aplica únicamente operaciones con evidencia válida y las versiones revisadas. Si cambió la información mientras el modal estaba abierto, exige revisar de nuevo. |
| Conservar y pausar | Conserva datos; bloquea la aplicación y las subidas conflictivas de esos registros. No deshace por sí sola la eliminación de la nube. |
| Revisar recuperación | Permite seleccionar los datos locales que se quieren recuperar; comprueba de nuevo el servidor y las evidencias antes de subir. |

Cerrar o cancelar conserva el lote pendiente y muestra un aviso accesible para retomarlo. No acepta, no vuelve a subir y no olvida silenciosamente la decisión. Conviene agrupar por lote/obra, manteniendo la confirmación de todas las eliminaciones pedida para esta primera versión; un modal por registro crearía fatiga y favorecería aceptaciones automáticas.

La nueva pantalla debe seguir `design.md`, usar los componentes de SA, escapar los datos remotos y preservar el modal, el foco, el scroll y los cambios no guardados. Reutilizar la intención del modal existente no significa conservar su render antiguo ni sus acciones globales.

### 3. Recuperación limitada, sin subida global forzada

«Falta en la nube» y «fue eliminado» requieren acciones diferentes:

- Si falta sin evidencia, ofrecer crear únicamente los IDs seleccionados, previa comprobación transaccional de que siguen faltando.
- Si hay una eliminación registrada, recuperar exige una operación explícita de restauración con nueva revisión. No se trata como una subida ordinaria.
- Si el registro remoto es más nuevo o hay conflicto de versión, conservar ambas evidencias y pedir resolución; no sobreescribirlo conservando su timestamp.
- Guardar una copia recuperable del estado anterior a la decisión. Un backup anterior ayuda, pero no sustituye la outbox ni las operaciones recientes.

### 4. Datos financieros y relaciones

Para préstamos con pagos, movimientos confirmados de caja chica y nóminas cerradas, preferir anulación/reversión trazable a borrado. El historial explica el saldo y debe conservar la operación original. La eliminación/archivo de personal no debe borrar sus deudas, pagos o contexto histórico por cascada.

Firebase y el espejo Supabase deben transportar el mismo `operationId` y versiones. Un fallo del espejo queda pendiente en su outbox; no se declara completada toda la sincronización. La revisión estática encontró `deleted_at` en `supabase/functions/petty-cash-movement/index.ts`, pero no certifica la protección de versiones de su despliegue.

### 5. Retención y clientes antiguos

No eliminar evidencias únicamente porque hayan pasado 60 días o se hayan acumulado 300 IDs. Un dispositivo que lleva más tiempo desconectado puede traer la copia anterior. Las alternativas son mantener un índice compacto de borrados o usar checkpoints confirmados y obligar a los clientes demasiado antiguos a reconstruir su réplica antes de subir.

La migración debe incluir versión mínima de protocolo y reglas del servidor que bloqueen `deleteDoc` de las entidades protegidas. Las versiones anteriores pueden quedarse con escrituras pendientes al desplegar reglas nuevas; se necesita aviso de actualización y una vía segura de drenaje. El SDK administrador y los procesos de servidor también deben seguir el protocolo: las reglas de clientes no los controlan.

## Costo y riesgos

| Medida | Esfuerzo relativo | Costo de operación / riesgo |
| --- | --- | --- |
| Conservar ante ausencia, validar entrada y poner inconsistencias en cuarentena | Bajo–medio | Más datos locales retenidos; hay que distinguirlos de bajas legítimas. |
| Marca de borrado + evento/versionado y outbox atómica | Medio–alto | Como referencia, un documento independiente pasa de un delete a una actualización + un evento; la comprobación de versión añade lecturas transaccionales. Los lotes por empleado/día pueden amortizar escrituras. |
| Revisión agrupada durable y recuperación por IDs | Medio–alto | Más estados de UI; las nóminas afectadas deben mostrar revisión pendiente y no cerrarse con un lote destructivo sin resolver. |
| Reglas, corte de clientes antiguos y pruebas con emuladores | Alto | Mayor trabajo de migración; riesgo de bloquear sincronización de clientes viejos si se despliega en el orden incorrecto. |
| Índice de evidencias y payload recuperable | Medio | Crece el almacenamiento. 1.000 eventos de 0,5–2 KB representan aproximadamente 0,5–2 MB de metadatos brutos, antes de índices y copias. Los documentos originales retenidos cuestan aparte. |

El precio monetario depende de región, índices, dispositivos/listeners y plan de Firebase/GitHub. No hace falta releer toda la colección en cada cambio: usar eventos incrementales y checkpoints evita multiplicar lecturas. Las transacciones reintentadas pueden generar lecturas adicionales. Un `operationId` estable evita duplicación lógica, aunque no garantiza costo cero de los reintentos.

Los riesgos principales son mezclar versiones de clientes, restablecer registros legítimamente eliminados, omitir un canal de entrada, aceptar un lote que cambió durante la revisión y confundir pausa local con restauración global. Otro riesgo es un falso certificado: una suite con mocks no prueba por sí sola las reglas ni la concurrencia del servidor.

## Cómo se relaciona con servicios consolidados

| Fuente primaria consultada | Patrón útil para SA |
| --- | --- |
| [Apache CouchDB: eliminación de documentos](https://docs.couchdb.org/en/stable/api/document/common.html#delete--db-docid) y [replicación](https://docs.couchdb.org/en/stable/replication/protocol.html) | La eliminación se representa con `_deleted` y una revisión. Deja una marca para replicar el borrado; no se deduce de una lista incompleta. Usa feeds de cambios y checkpoints. |
| [Firestore: persistencia sin conexión](https://firebase.google.com/docs/firestore/manage-data/enable-offline) | La caché puede estar incompleta. `fromCache` y `includeMetadataChanges` sirven para observar su confirmación; el SDK usa last-write-wins para cambios de documento. La intención de eliminar y la revisión de negocio son responsabilidad de SA. |
| [Microsoft Graph: consultas delta](https://learn.microsoft.com/en-us/graph/delta-query-overview) | Sincroniza cambios con tokens, páginas y retiradas explícitas `@removed`, cuyo motivo/alcance se interpreta. Una página vacía con `nextLink` no acredita que desaparecieran todos los datos. |
| [Stripe: tipos de movimientos de saldo](https://docs.stripe.com/reports/balance-transaction-types) | Devoluciones y reversiones se representan como movimientos; es una referencia para anular/compensar importes manteniendo su explicación histórica. |

Estas fuentes describen protocolos y modelos de datos, no un modal obligatorio en cada dispositivo. La confirmación receptora propuesta es una capa adicional de SA. Para conservar su utilidad debe agrupar cambios y ofrecer decisiones específicas, sin convertir «aceptar todo» en una rutina.

## Orden de ejecución recomendado y responsables

1. **Agente SA:** cerrar las pérdidas por ausencia y los borrados físicos; corregir la subida obsoleta, la limpieza destructiva de referencias y la procedencia de snapshots. Conservar los casos actuales de auditoría como regresión, sin cambiar sus expectativas para aceptar pérdidas.
2. **Agente SA:** implementar el registro de eliminación y la outbox; después la cola/pantalla común, el bloqueo de operaciones afectadas y la recuperación limitada. Añadir idempotencia, recarga con revisión pendiente, doble pestaña y cambios mientras el modal está abierto.
3. **Agente de backend/Firebase:** reglas y transacciones; probar con dos clientes reales de emulador, roles/cuenta/obra, cliente viejo, concurrencia editar/eliminar, falla entre escrituras y replay antiguo. Verificar también el espejo Supabase.
4. **Usuario:** revisar la maqueta de confirmación agrupada y validar con datos ficticios aceptar, pausar/cancelar y recuperar. No usar registros reales para ensayar borrados.
5. **Administrador del repositorio:** hacer obligatorio el chequeo de política en `main`. Integrar y desplegar el cambio completo solo cuando pase, incluyendo pruebas de servidor y recuperación, con respaldo verificado.


## Caso aclarado: horas anteriores a un cambio de líder

El usuario confirmó que las horas ausentes bajo el líder 2 se registraron antes de cambiar el líder del puesto. `resolveEmployeePositionTerms` conserva las condiciones anteriores mediante snapshots/historia. Ese caso concreto corresponde a la protección temporal, aunque la auditoría sí encontró otros fallos reales de filtros y sincronización.

Para trasladar trabajo anterior se recomienda una acción distinta: **Reasignar trabajo del período abierto**. La configuración futura y la corrección del trabajo existente deben distinguirse en la UI. Al guardar un líder, proponer Desde ahora y, cuando haya trabajo afectado, Revisar período abierto.

La revisión lista empleado, fechas, horas, equipo y pagador antes/después, junto con el efecto en ambas nóminas usando las funciones actuales. La operación conserva los registros originales y una evidencia `reassign-work`, con versiones e idempotencia. No borra y recrea asistencias para simular un traslado, no duplica salarios y no modifica automáticamente pagos ni cierres confirmados. Un período cerrado requiere el flujo de corrección auditado.

Pruebas adicionales de esa futura acción: solo trabajo del período seleccionado; repetir la misma reasignación no duplica horas/importe; una edición concurrente obliga a revisar; cambiar la configuración futura no reescribe el cierre; restaurar un backup antiguo no deshace silenciosamente la decisión. Esta función todavía no está implementada en el PR.
