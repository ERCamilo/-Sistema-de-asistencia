# Historial de nóminas cerradas sin congelar la nómina interactiva

La generación de Nómina permanecerá siempre interactiva y calculada desde el estado actual. Al cerrar una nómina se creará un registro histórico inmutable, independiente de los pagos de préstamos, que podrá consultarse desde una nueva vista de Historial. El cierre registrará todas las nóminas, tengan o no préstamos.

## Resultado esperado

```text
Nómina interactiva
  -> verificar importes
  -> confirmar que fue pagada
  -> cerrar nómina
       -> guardar instantánea histórica
       -> registrar pagos de préstamos seleccionados, si existen
       -> permitir deshacer durante la ventana configurada

Historial
  -> listar cierres
  -> abrir detalle inmutable
  -> mostrar cierres anulados o corregidos sin borrar auditoría
```

Después del cierre, el generador deja de usar instantáneas históricas. Si el usuario vuelve al mismo período, verá un cálculo actual y un aviso de que ya existe una nómina cerrada, con acceso directo al Historial.

## Problema comprobado

Actualmente `generateExportData()` consulta primero `getClosedPayrollPreviewRows()`. Cuando encuentra un lote de préstamos cerrado, reemplaza el cálculo actual por la instantánea almacenada en los pagos. El paso 4, en cambio, muestra únicamente préstamos activos y elegibles. Esto produce una contradicción visual:

- el paso 4 ya no muestra un préstamo pagado;
- la vista previa continúa mostrando el cargo histórico congelado;
- el usuario no puede distinguir un cargo actual de un registro ya cerrado.

La instantánea histórica es necesaria para auditoría, pero no debe reemplazar la nómina interactiva.

## Decisiones de alcance

| Tema | Decisión |
|---|---|
| Ubicación | Agregar `Historial` como tercera vista superior de Nómina, junto a `Generar Nómina` y `Cuentas por Cobrar`. |
| Fuente de verdad | IndexedDB como persistencia local y Firebase como sincronización remota, siguiendo la arquitectura actual. |
| Supabase | Fuera de la primera versión. La infraestructura existente está dedicada a Caja Chica; se evaluará aparte para PDF o distribución de constancias. |
| Cierre | Permitir cerrar cualquier nómina válida, incluso si no contiene préstamos. |
| Préstamos | El cierre registrará de forma coordinada los pagos de las cuotas seleccionadas. No existirá un cierre histórico separado del pago de esos cargos. |
| Inmutabilidad | Los importes y filas de un cierre no se editan. Sólo se permiten transiciones auditables de estado, como anular o reemplazar mediante una corrección. |
| Generador | Siempre recalcula desde asistencia, ajustes y préstamos activos. Nunca vuelve a cargar una nómina cerrada como borrador. |
| Mismo período | Un cierre posterior requiere un flujo explícito de corrección y referencia al cierre reemplazado. No se sobrescribe el registro anterior. |
| Deshacer | Mantener inicialmente la ventana actual de 30 segundos. Deshacer anula el cierre y sus pagos vinculados; no elimina el historial. |
| PDF | Fuera de alcance. El modelo conservará los datos necesarios para generarlo posteriormente. |

## Contrato de datos

El cierre será una entidad independiente de los empleados y de los lotes de préstamos.

```js
{
    schemaVersion: 1,
    id: 'PAYROLL-CLOSURE-<fingerprint>',
    fingerprint: '<identidad canónica de la vista previa>',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-15',
    periodSource: 'configured',
    status: 'closed', // closed | voided
    closedAt: 1786800000000,
    closedBy: '<uid o email>',
    updatedAt: 1786800000000,
    totals: {
        gross: 0,
        bonuses: 0,
        deductions: 0,
        loans: 0,
        net: 0
    },
    employeeCount: 0,
    rows: [{
        employeeId: '',
        employeeNumber: '',
        employeeName: '',
        employeePosition: '',
        gross: 0,
        bonuses: 0,
        deductions: 0,
        loans: 0,
        net: 0,
        bonusDetails: [],
        deductionDetails: [],
        loanDetails: []
    }],
    loanSettlementBatchId: null,
    paymentRefs: [],
    undoUntil: 1786800030000,
    supersedesId: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null
}
```

### Invariantes

- `id` se deriva del `fingerprint`; reintentar el mismo cierre es idempotente.
- Las filas y los totales no cambian después de crear el cierre.
- Los nombres, números y posiciones se guardan como texto histórico; cambios posteriores en empleados no alteran el cierre.
- `status = voided` conserva el registro y exige fecha, usuario y motivo.
- `loanSettlementBatchId` es opcional porque una nómina puede no tener préstamos.
- Los pagos de préstamos enlazan al cierre mediante `closureId` y mantienen sus claves idempotentes actuales.
- El estado de sincronización no forma parte del estado de negocio. `pending`, `dead` o `synced` viven en la cola local, no en `status`.

## Persistencia y sincronización

### Local

Subir IndexedDB de la versión 14 a la siguiente versión libre y agregar un store `payrollClosures` con:

- `keyPath: id`;
- índice `periodEnd`;
- índice `closedAt`;
- índice `status`;
- lectura paginada descendente para no cargar indefinidamente todo el historial.

El store debe incluirse en exportación, restauración y borrado local. No se guardará la colección completa dentro de `state` ni en el documento espejo, evitando crecimiento del estado global y escrituras repetidas de todo el historial.

### Nube

Usar documentos independientes en:

```text
users/{uid}/payrollClosures/{closureId}
```

Extender la cola durable `MainSyncStore` con un tipo `payrollClosure`, compactado por `closureId`, y agregar operaciones de lectura, escritura y suscripción en Firebase. Las reglas actuales ya aíslan las rutas bajo el usuario autenticado, pero las pruebas deben verificar acceso por propietario y ausencia de datos financieros en rutas públicas.

El guardado remoto será idempotente. Si ya existe el mismo `fingerprint`, se acepta como el mismo cierre; si el contenido canónico no coincide, se registra un conflicto y no se sobrescribe silenciosamente.

### Coordinación con préstamos

El cierre debe ejecutar este orden lógico:

1. Recalcular y validar la vista previa exacta.
2. Construir el cierre y, si corresponde, el lote de préstamos sin mutar datos.
3. Revalidar saldos, cuotas y ausencia de otro cierre idéntico.
4. Preparar copias de los empleados afectados.
5. Guardar localmente el cierre, los empleados modificados y la entrada de sincronización como una unidad recuperable.
6. Actualizar memoria sólo después de completar la persistencia local.
7. Sincronizar en segundo plano mediante la cola durable.

Si una sincronización remota queda parcial, el cierre local permanece visible con una advertencia de sincronización y se reintenta. Nunca se vuelve a aplicar un pago para “reparar” la nube; se reutilizan las mismas identidades de cierre, lote y pagos.

## Flujo de interfaz

### Generar Nómina

En el paso 5 se reemplazará el cierre específico de préstamos por un cierre general:

1. La tabla continúa mostrando el cálculo actual.
2. El usuario resuelve importes netos inválidos.
3. Confirma que la nómina mostrada fue pagada.
4. Presiona `Cerrar nómina`.
5. Un modal resume período, empleados, total neto y cargos; los préstamos aparecen sólo cuando existan.
6. La confirmación crea el historial y registra los pagos de préstamos vinculados.

El botón estará deshabilitado cuando:

- no existan filas pagables;
- haya netos iguales o menores que cero;
- falte confirmar el pago de esa huella exacta;
- el cierre esté en progreso;
- ya exista el mismo cierre;
- el mismo período tenga un cierre vigente y no se haya iniciado explícitamente una corrección.

Después de cerrar:

- se limpian selección de préstamos, confirmación y ajustes temporales que no deban continuar;
- el generador sigue siendo interactivo;
- aparece un aviso de cierre para ese período y un enlace a su detalle;
- volver a cerrar el mismo período exige `Preparar corrección` y crea `supersedesId` en vez de sobrescribir.

### Historial

La primera versión tendrá:

- lista ordenada por fecha de cierre descendente;
- filtro por rango o período;
- filtro por estado `Cerrada` o `Anulada`;
- período, cantidad de empleados, total neto, préstamos aplicados, fecha y usuario;
- detalle con la misma estructura de importes de la vista previa;
- columnas opcionales para bonos, deducciones y préstamos;
- préstamos en amarillo;
- indicador de sincronización pendiente o fallida;
- acción de deshacer sólo durante la ventana permitida;
- enlace desde el generador al cierre del período.

No se permitirán ediciones directas, borrado definitivo ni regeneración automática de pagos desde el historial.

## Migración de cierres existentes

Los lotes actuales contienen `previewFingerprint`, `previewRows` y referencias de pagos dentro de los préstamos. La migración será idempotente:

1. Buscar lotes únicos por `batchId` en los pagos existentes.
2. Crear un cierre con ID derivado de `previewFingerprint`.
3. Copiar filas, período, operador, pagos y estado anulado.
4. Marcar `schemaVersion` y origen de migración.
5. No crear duplicados si el cierre ya existe.

Sólo pueden recuperarse nóminas históricas que hayan generado lotes de préstamos. Las nóminas antiguas sin préstamos nunca fueron persistidas y no pueden reconstruirse con exactitud.

Después de migrar, `generateExportData()` dejará de llamar `getClosedPayrollPreviewRows()`. El helper se conservará temporalmente sólo para la migración y se retirará cuando el formato anterior deje de necesitarse.

## Fases de implementación

Cada fase seguirá el ciclo obligatorio:

```text
análisis -> prueba que falla -> implementación -> prueba enfocada
-> revisión de seguridad/rendimiento/sincronización
-> si aparece una debilidad, repetir el ciclo antes de avanzar
```

### Fase 1 — Dominio del cierre

1. Crear constructores y validadores puros para cierre, huella, totales y transiciones de estado.
2. Separar el cierre general del lote opcional de préstamos.
3. Probar idempotencia, inmutabilidad, correcciones, anulaciones y valores monetarios.
4. Garantizar que cerrar sin préstamos sea válido.

Commit previsto: `feat(payroll): define immutable payroll closures`

### Fase 2 — Persistencia local

1. Agregar el store e índices de IndexedDB.
2. Crear un repositorio con `save`, `getById`, `listPage` y `void`.
3. Integrar exportación, restauración y borrado local.
4. Probar actualización de versión, paginación, reapertura offline y fallos de cuota/transacción.

Commit previsto: `feat(storage): persist payroll closure history locally`

### Fase 3 — Sincronización Firebase

1. Agregar escritura y lectura por documento de cierre.
2. Extender `MainSyncStore` con compactación por cierre y reintentos.
3. Aplicar datos remotos sin reencolarlos ni crear bucles.
4. Detectar conflictos de contenido para el mismo ID.
5. Probar offline, reconexión, doble pestaña, reintentos y aislamiento por usuario.

Commit previsto: `feat(sync): synchronize payroll closures`

### Fase 4 — Cierre unificado

1. Crear una regla de habilitación general independiente de la existencia de préstamos.
2. Reemplazar el botón específico por `Cerrar nómina`.
3. Construir un modal general con sección opcional de préstamos.
4. Persistir el cierre y registrar pagos vinculados usando identidades estables.
5. Mantener deshacer como anulación lógica del cierre y de los pagos.
6. Bloquear duplicados y exigir flujo explícito de corrección para otro cierre del mismo período.

Commit previsto: `feat(payroll): close payrolls with optional loan payments`

### Fase 5 — Generador nuevamente interactivo

1. Eliminar la sustitución de la vista previa por `getClosedPayrollPreviewRows()`.
2. Limpiar el borrador transitorio después del cierre.
3. Mostrar aviso y enlace cuando el período ya tenga un cierre.
4. Verificar que un préstamo pagado desaparezca del paso 4 y del cálculo actual.
5. Verificar que el cargo permanezca únicamente en el detalle histórico.

Commit previsto: `fix(payroll): keep closed payrolls out of the live preview`

### Fase 6 — Vista de Historial

1. Agregar el modo superior `history` sin acoplarlo al libro de préstamos.
2. Implementar lista paginada, filtros y estados.
3. Implementar detalle inmutable y responsive.
4. Exponer deshacer dentro de la ventana y navegación desde el generador.
5. Verificar accesibilidad por teclado, foco, lectores de pantalla y móvil.

Commit previsto: `feat(payroll): add closed payroll history`

### Fase 7 — Migración y endurecimiento

1. Migrar lotes históricos existentes de forma idempotente.
2. Probar cargas parciales recibidas desde otros dispositivos.
3. Medir tamaño de documentos y rechazar cierres que excedan el límite seguro antes de mutar préstamos.
4. Revisar que nombres, salarios y conceptos no se escriban en logs o notificaciones innecesarias.
5. Ejecutar pruebas relacionadas, control de estado, revisión visual y ciclo aplicar/deshacer.
6. Actualizar la documentación de préstamos y cierre de nómina.

Commit previsto: `fix(payroll): migrate legacy closed payroll snapshots`

## Estrategia de pruebas

### Dominio

- cierre con y sin préstamos;
- mismo `fingerprint` no duplica;
- cierre diferente del mismo período requiere corrección;
- los totales coinciden con las filas;
- una anulación no altera la instantánea;
- nombres posteriores del empleado no cambian el historial.

### Persistencia y sincronización

- actualización de IndexedDB sin perder stores existentes;
- cierre disponible después de recargar sin conexión;
- cola compactada por `closureId`;
- fallo remoto conserva el dato local y permite reintento;
- sincronización repetida no duplica pagos;
- dos pestañas no procesan simultáneamente la misma entrada;
- borrado local y reemplazo de datos incluyen el nuevo store;
- otro usuario no puede leer cierres ajenos.

### Interfaz

- nómina sin préstamos puede cerrarse;
- préstamo seleccionado se registra una sola vez;
- préstamo pagado desaparece del generador actual;
- historial conserva el préstamo pagado;
- columnas vacías se ocultan en generador e historial;
- corrección no sobrescribe el cierre anterior;
- deshacer cambia el estado a anulada y restaura saldos;
- escritorio y móvil mantienen tabla, filtros y navegación utilizables.

### Verificación por fase

Cada commit debe registrar:

- comando y resultado de pruebas enfocadas;
- pruebas relacionadas de Nómina, préstamos y persistencia;
- `npm run lint:state`;
- `git diff --check`;
- escenario real en Chrome de escritorio y móvil cuando exista UI;
- frontera de rollback exacta.

## Riesgos y controles

| Riesgo | Control |
|---|---|
| Duplicar una nómina al hacer doble clic | ID determinista, bloqueo en progreso e idempotencia por `fingerprint`. |
| Cerrar la nómina pero no registrar préstamos | Preflight conjunto, persistencia local recuperable y referencias estables de pagos. |
| Reaplicar pagos al reparar sincronización | Reintentar la misma operación con los mismos IDs; nunca generar IDs nuevos. |
| Sobrescribir un cierre desde otro dispositivo | Instantánea inmutable y conflicto explícito si el contenido canónico difiere. |
| Crecimiento del estado y del documento espejo | Store y colección por registro; paginación; no guardar el historial completo en `state`. |
| Documento remoto demasiado grande | Instantánea compacta, medición previa y error antes de cualquier mutación. |
| Confundir cierre histórico con borrador | Generador siempre actual; historial separado; aviso de período cerrado. |
| Perder trazabilidad al deshacer | Anulación lógica con usuario, fecha y motivo; nunca borrado físico desde la UI. |
| Exponer información financiera | Ruta privada por usuario, reglas verificadas y ausencia de datos sensibles en logs. |

## Criterios de aceptación

- [ ] La vista previa nunca se reemplaza por una instantánea cerrada.
- [ ] Toda nómina válida puede cerrarse, con o sin préstamos.
- [ ] Los pagos de préstamos quedan vinculados a un cierre y no se duplican.
- [ ] El Historial muestra la instantánea exacta aunque cambien empleados, préstamos o asistencia.
- [ ] Un cierre no puede editarse ni eliminarse físicamente desde la aplicación.
- [ ] Una corrección conserva el cierre anterior y registra la relación entre ambos.
- [ ] La información funciona offline y se sincroniza posteriormente.
- [ ] Los cierres existentes con préstamos se migran sin duplicados.
- [ ] Las nóminas antiguas sin evidencia persistida no se inventan ni se reconstruyen parcialmente.
- [ ] Las pruebas automáticas, el control de estado y la revisión responsive terminan sin errores.

## Fuera de alcance inicial

- generación, almacenamiento o envío de PDF;
- notificaciones programadas;
- aprobación multinivel de nóminas;
- firma electrónica;
- edición directa de cierres;
- reconstrucción de nóminas antiguas sin datos persistidos;
- migración del historial a Supabase.

## Estrategia de entrega

La implementación superará previsiblemente 400 líneas. Se entregará en los commits funcionales anteriores, cada uno con sus pruebas, en lugar de acumular una única revisión masiva. Si se abre una PR, se dividirá al menos en tres bloques revisables:

1. dominio y persistencia;
2. cierre unificado y sincronización;
3. interfaz, migración y endurecimiento.

El PDF sobre Supabase será un cambio posterior con su propio modelo de permisos, retención y reintentos. Desde 2026 Supabase permite proyectos donde nuevas tablas públicas no quedan expuestas automáticamente al Data API ([changelog oficial](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)); si se retoma esa fase, se deberá comprobar explícitamente la exposición, permisos y RLS en lugar de asumir acceso automático.
