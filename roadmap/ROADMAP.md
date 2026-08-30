# Roadmap base — SA + Proyectos + Mini + Integración + NFC

**Versión:** 0.1 (documento base de dirección)  
**Objetivo:** coordinar el desarrollo de SA, Mini y la capa de Integración con uno o varios agentes de IA, manteniendo dependencias claras, puntos de parada usables y control de avance.

---

## 1. Alcance de esta versión

La V1 del ecosistema queda limitada a:

- **SA** como aplicación principal de administración de proyecto.
- **Mini** como aplicación de campo para líder/capataz.
- **Integración** como capa común de contrato, Firebase, autenticación, permisos, sincronización y transporte de datos.
- **NFC** como fuente adicional de eventos de asistencia, integrada después de estabilizar SA↔Mini.
- **Proyectos** como contenedores independientes dentro de SA: empleados, grupos/líderes, asistencia, nómina, caja chica, préstamos/adelantos asociados, solicitudes, Mini, NFC y reportes.
- Un proyecto puede estar **activo, cerrado o archivado**. Cerrar un proyecto no elimina datos.
- Se podrá crear un nuevo proyecto vacío o usar otro proyecto como base para copiar datos seleccionados sin copiar movimientos históricos.
- Se mantendrán mecanismos manuales de intercambio y respaldo aun cuando Firebase esté disponible.

### Fuera de alcance de esta V1

- ERP empresarial completo.
- Dashboard corporativo multiproyecto para dirección.
- Reescritura completa de SA o Mini en otro framework.
- Rediseño visual total de SA.
- Inventario formal, compras empresariales o flujos de aprobación complejos.
- Exposición de nómina, préstamos o datos administrativos a Mini.
- Dependencia obligatoria de Firebase para usar SA o Mini.

---

## 2. Principios obligatorios

1. **SA y Mini deben seguir funcionando por separado.** La integración agrega capacidades; no se convierte en requisito para usar las funciones básicas.
2. **SA es la fuente oficial** para los datos administrativos y la asistencia aprobada.
3. **Mini se adapta principalmente al modelo de SA.** SA solo cambia donde sea necesario para proyectos, integración y recepción estructurada.
4. **Firebase no define el formato de los datos.** El contrato común define los datos; Firebase es un transporte y una plataforma de identidad/sincronización.
5. **Los datos históricos no se borran al iniciar un nuevo proyecto.**
6. **Cada dato operativo debe pertenecer a un `projectId`.**
7. **`authUid`, `employeeId` y `employeeNumber` son conceptos distintos.**
8. **Grupo/Líder** representa el conjunto de empleados asignados a un líder dentro de un proyecto.
9. **WhatsApp y archivos manuales siguen disponibles como fallback.**
10. **Los agentes no deben inventar contratos incompatibles.** Si falta una dependencia, deben detenerse y emitir una solicitud de dependencia.
11. **Un commit debe representar una capacidad completa, comprobable y reversible.**
12. **No se continúa a la siguiente fase si no se cumplen los criterios de aceptación de la fase actual.**

---

## 3. Equipos y responsabilidades

### Equipo SA

Responsable de todo lo que ocurre dentro de la aplicación SA y de mantenerla como fuente oficial.

**Responsabilidades principales:**

- Contexto y ciclo de vida de proyectos.
- Migración de datos existentes a proyecto predeterminado.
- Aislamiento entre proyectos.
- Empleados, grupos/líderes y estados oficiales.
- Asistencia oficial.
- Nómina, caja chica y módulos administrativos por proyecto.
- Exportación estructurada hacia Mini.
- Bandeja de recepción de datos de campo.
- Revisión/aprobación de asistencia enviada desde Mini.
- Generación del reporte final del proyecto.
- Gestión de invitaciones a Mini desde la UI de SA, cuando la capa de integración esté lista.
- Vista y comparación de eventos NFC.

**No debe:**

- Implementar lógica privada dentro de Mini.
- Exponer datos sensibles a la zona de campo.
- Duplicar reglas de sincronización que pertenezcan al Equipo Integración.

### Equipo Mini

Responsable de la experiencia de campo y de conservar funcionamiento local/offline.

**Responsabilidades principales:**

- Importación de roster estructurado proveniente de SA.
- Setup de consolidación de empleados locales ↔ empleados SA.
- Preservación de historial al adoptar `employeeId` oficiales.
- Mostrar número, nombre, puesto y grupo/líder.
- Asistencia local/offline.
- Cola de sincronización y estados visibles.
- Google Login cuando Integración entregue la base de Auth.
- Vinculación por QR/código cuando Integración entregue invitaciones.
- Recepción de roster, solicitudes y estados desde Firebase.
- Envío de asistencia, respuestas, solicitudes y novedades.
- Fallback por archivo y WhatsApp.
- Modo standalone completamente funcional.

**No debe:**

- Crear o modificar datos administrativos oficiales de SA.
- Acceder a nómina, préstamos, caja u otros datos privados.
- Convertir un empleado local en empleado oficial sin conciliación.
- Acoplar la UI directamente a Firestore sin capa de datos/sincronización.

### Equipo Integración

Responsable del contrato común y de la plataforma que conecta SA, Mini y posteriormente NFC.

**Responsabilidades principales:**

- Contrato del ecosistema.
- Versionado de mensajes y esquemas.
- `organizationId`, `projectId`, `groupId`, `employeeId` y metadata común.
- Firebase Auth.
- Organizaciones, membresías, roles y alcance por proyecto/grupo.
- Invitaciones temporales por QR/token.
- Firestore y zona sanitizada para campo.
- Reglas de seguridad.
- Idempotencia, IDs de operación y control de duplicados.
- Cola/protocolo de sincronización y estados.
- Auditoría de quién/cuándo/origen.
- Compatibilidad entre versiones.
- Integración de eventos NFC/n8n cuando llegue su fase.

**No debe:**

- Convertirse en dueño de la lógica de negocio de SA.
- Permitir a Mini escribir directamente asistencia oficial.
- Usar credenciales del ingeniero dentro de Mini.
- Ampliar permisos porque la UI o el flujo resulten más fáciles.

### Dirección / Coordinación

No es un cuarto equipo de desarrollo. Su función es controlar el roadmap, aprobar contratos, resolver conflictos entre equipos y decidir cuándo una dependencia está lista.

**Responsabilidades:**

- Mantener este documento actualizado.
- Autorizar cambios de contrato.
- Asignar trabajo a agentes.
- Registrar dependencias.
- Validar criterios de aceptación.
- Decidir si una fase se puede cerrar.
- Evitar que un agente avance sobre supuestos no acordados.

---

## 4. Sistema de dependencias entre equipos

Si un equipo necesita una capacidad que todavía no existe, **no debe improvisarla ni crear una versión privada incompatible**. Debe emitir una Solicitud de Dependencia.

### Formato de Solicitud de Dependencia

| Campo | Contenido |
|---|---|
| ID | `DEP-<equipo solicitante>-<número>` |
| Solicitante | SA / Mini / Integración |
| Proveedor esperado | SA / Mini / Integración |
| Fase / paso bloqueado | Ej. F5.3 |
| Qué necesita | Entregable concreto |
| Por qué lo necesita | Motivo técnico/funcional |
| Contrato esperado | Campos, eventos, función o interfaz requerida |
| Criterio para considerar resuelta | Prueba concreta |
| Prioridad | Bloqueante / Alta / Media / Baja |
| Estado | Pendiente / En progreso / Entregada / Validada / Rechazada |

### Ejemplo

| Campo | Ejemplo |
|---|---|
| ID | DEP-MINI-003 |
| Solicitante | Mini |
| Proveedor esperado | Integración |
| Fase / paso bloqueado | F5.3 QR de vinculación |
| Qué necesita | Formato final de invitación y endpoint/flujo de canje |
| Por qué lo necesita | Mini no debe inventar estructura de token ni permisos |
| Contrato esperado | token de alta entropía + expiración + projectId + groupId |
| Criterio | Token válido vincula; usado/expirado falla; no expone secretos |
| Prioridad | Bloqueante |
| Estado | Pendiente |

### Regla de control

Una dependencia solo se marca **Validada** cuando el equipo solicitante comprueba que puede consumirla correctamente. Que el proveedor diga "terminado" no basta.

---

## 5. Estados de trabajo

Cada paso del roadmap debe usar uno de estos estados:

- **No iniciado**
- **Listo para empezar**
- **Bloqueado por dependencia**
- **En desarrollo**
- **En revisión**
- **En pruebas**
- **Completado**
- **Requiere corrección**
- **Pospuesto**

Cada fase debe tener un responsable principal y puede tener equipos colaboradores.

---

## 6. Cómo medir el avance

Se medirán dos valores diferentes:

1. **Hitos completados:** por ejemplo, `3/5`.
2. **Peso real completado:** por ejemplo, `60%`.

El porcentaje no se calcula simplemente dividiendo hitos. Cada paso tiene un peso relativo según dificultad, riesgo e importancia.

Ejemplo:

> Asistencia Mini→SA: 3/5 hitos completados, pero 45% del trabajo real completado porque todavía faltan idempotencia y aprobación oficial.

---

# 7. Roadmap por fases

---

## Fase 0 — Auditoría y preparación de SA

**Propósito:** entender dónde viven los datos actuales antes de introducir proyectos y crear una base de pruebas para detectar regresiones.

**Equipo responsable:** SA  
**Equipo colaborador:** Integración (solo revisión del futuro `projectId`)  
**Dependencias externas:** ninguna.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F0.1 | SA | Inventariar módulos y almacenamiento | 20% | Mapa de empleados, asistencia, nómina, caja, préstamos, backups, caché, sync | Todos los datos operativos tienen ubicación identificada | — | `audit-project-data` |
| F0.2 | SA | Clasificar datos globales vs. datos de proyecto | 20% | Matriz de propiedad de datos | Cada entidad tiene propietario definido | F0.1 | `define-project-boundaries` |
| F0.3 | SA + Integración | Definir modelo mínimo `Project` | 15% | Esquema Project v1 | ID, nombre, fechas, estado y metadata definidos | F0.2 | `project-model-contract` |
| F0.4 | SA | Definir migración al proyecto predeterminado | 20% | Plan de migración | Ningún dato actual queda huérfano | F0.2 | `project-migration-plan` |
| F0.5 | SA | Crear baseline de pruebas/snapshots | 15% | Pruebas del comportamiento actual | Regresiones detectables | F0.1 | `project-baseline-tests` |
| F0.6 | SA | Añadir feature flag de proyectos | 10% | Flag de activación | Puede desactivarse sin romper SA | F0.3 | `project-feature-flag` |

**Al terminar la fase:** SA todavía se comporta igual, pero el cambio de arquitectura está documentado y controlado.

**Punto de parada usable:** 100% seguro; no cambia la operación diaria.

**Estado esperado de características:** Proyectos ~15%; Integración 5%; Robustez 10%.

---

## Fase 1 — Contexto de proyecto en SA

**Propósito:** hacer que internamente SA trabaje siempre dentro de un proyecto, aunque al principio solo exista uno.

**Equipo responsable:** SA  
**Equipo colaborador:** Integración para validar IDs y futuro contrato.  
**Dependencias:** Fase 0 completa.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F1.1 | SA | Crear repositorio/servicio de proyectos | 8% | API interna de proyectos | Crear/leer/editar proyecto | F0 | `project-repository` |
| F1.2 | SA | Crear proyecto predeterminado | 7% | Proyecto inicial automático | Usuario existente entra sin configuración manual | F1.1 | `default-project` |
| F1.3 | SA | Introducir `activeProjectId` | 10% | Project Context | Toda operación puede obtener proyecto activo | F1.1 | `project-context` |
| F1.4 | SA | Asociar empleados/grupos | 12% | Datos project-aware | Empleados actuales pertenecen al proyecto inicial | F1.3 | `scope-employees` |
| F1.5 | SA | Asociar asistencia | 14% | Historial project-aware | Asistencia conserva datos y relaciones | F1.3 | `scope-attendance` |
| F1.6 | SA | Asociar nómina | 12% | Nómina project-aware | Cálculos actuales siguen iguales | F1.5 + orden A0 → A0.5 → A1 → A2 → A3 → A4 → A5 → A6 | `scope-payroll` |
| F1.7 | SA | Asociar caja chica | 12% | Caja project-aware | Movimientos aislados por proyecto | F1.3 | `scope-petty-cash` |
| F1.8 | SA | Asociar préstamos/adelantos/notas relacionados | 8% | Datos secundarios project-aware | Sin registros huérfanos | F1.3 | `scope-related-data` |
| F1.9 | SA | Adaptar backup/exportación | 7% | Backup project-aware | Restore conserva asociación a proyecto | F1.4–F1.8 | `project-aware-backup` |
| F1.10 | SA | Pruebas de aislamiento A/B | 10% | Suite de aislamiento | Datos de A jamás aparecen en B | F1.4–F1.9 | `project-isolation-tests` |

**Al terminar la fase:** SA es internamente project-aware. Se puede crear un proyecto de prueba vacío y comprobar aislamiento aunque todavía no exista UI completa.

**Actualización F1.6 (2026-08-29):** **A0–A5 ✅ están aprobados. A6 🟡 principal `b286d70` no fue aprobado:** Dirección encontró después de la entrega que `PayrollClosureStore.getById` y `getSyncStates` permitían lecturas locales directas sin gate. **MC1 `f735dd6` resolvió ambos bypasses** antes de `db.get`/`db.getAll`, agregó 4 tests y completó la auditoría de los 8 métodos públicos. Evidencia final: **24/24 TandaBGates + 9/9 matriz, agrupada 62/62, full 368/368 suites · 3575/3575 tests, fresh review MC1 ALLOW 0 findings**. SHA funcional actual `f735dd6`, rango `792793a..f735dd6`. **A6 permanece pendiente de aprobación formal; B1–B5 🔒 y F1.7 🔒.**

**Orden ejecutado de A4 (✅ cerrado y aprobado 2026-08-28):**

1. Con flag ON, UI de configuración y preview usan el `projectId` capturado y `projectPayrollConfigs` vía `ProjectPayrollUIRuntime`.
2. Los callers productivos de período del preview usan `config.payPeriod` scoped.
3. A→B invalida selección temporal, preview, período y caché de sesión; B→A reconstruye A.
4. Una preview async iniciada en A permanece en A mientras una preview nueva usa B.
5. Con flag OFF, la UI legacy permanece byte-idéntica.
6. No se habilitan cierres, préstamos, ajustes persistidos, historial ni exportación final.
7. No se trabaja H-05 completo ni se amplía la persistencia de `exportConfig`.
8. Tests + fresh review completados sobre `6c1cb2c` (49/49, 365/365 · 3525, ALLOW · 0 findings); **A4 ✅ cerrado y aprobado — A5 🟢 autorizado exclusivamente (H-05)**.

**Orden ejecutado de A5 (✅ cerrado y aprobado formalmente 2026-08-29 — `ae66121`):**

1. Tratar `exportConfig` como estado transitorio de UI/sesión y sanitizar simétricamente en ALL egress/ingress frontiers: mirror/data/current, cloud replace, snapshots, DataOps local→cloud y restores/legacy ingresses.
2. Verificar que un `exportConfig` viejo no resucite tras sync/restore/snapshot load.
3. No eliminar configuración durable legítima (`settings.payrollDefaults`, `projectPayrollConfigs`).
4. Preservar garantías A→B→A de A4 (invalidación sincrónica + rebuild sin stale).
5. No tocar `PayrollClosure`, cierres, préstamos, ajustes económicos, PDF, SplitX, economic cloud ni petty cash.
6. Tests + fresh review completados (**17/17 nuevos, 56/56 agrupada, 366/366 suites · 3542/3542 tests · 0 fallos, ALLOW · 0 findings**); registro histórico que habilitó ejecutar A6.

**Orden ejecutado de A6 + MC1 (🟡 pendiente de aprobación formal sobre `b286d70` + `f735dd6`):**

1. Gates que bloqueen **efectivamente** con proyectos ON: cierres de nómina, ajustes económicos persistidos/programados, operaciones de préstamo, historial económico, pago definitivo, exportaciones finales — no solo botones ocultos en `ScopedPayrollTab`, también llamadas directas programáticas deben fallar explícita y seguramente sin mutaciones parciales (helper `TandaBGate.js` 27 líneas, `ProjectScopedGateError`/`assertTandaBBlockedWhenScoped` en 10 archivos antes de mutación; 2 CRITICAL UI bypasses `addDesktopAdjustment`/`removeScheduledAdjustment`/`setScheduledAdjustmentPaused` corregidos pre-commit); OFF preserva legacy.
2. Matriz consolidada A/B de toda la Tanda A: mismo `#12` `employeeId` distinto, configs/períodos/feriados/horas distintos, asistencia aislada, A→B→A, async A mientras se cambia a B, H-05 sin resurrección de `exportConfig`, `buildAttendanceIndex` RAW detrás de fronteras scoped (9 tests).
3. Dirección encontró tras la entrega que `getById` y `getSyncStates` eran entrypoints públicos ungated; MC1 `f735dd6` los gateó como primera línea ejecutable. Estado: **A6 🟡 pendiente formal — 24/24 + 9/9, 62/62, 368/368 · 3575, MC1 ALLOW 0 findings. MC1 resuelto no autoriza B1.**

**Punto de parada usable:** SA sigue siendo utilizable como antes con un único proyecto visible.

**Estado esperado:** Proyectos ~60%; Proyecto global ~20%.

---

## Fase 2 — Ciclo de vida del proyecto + reporte final

**Propósito:** permitir terminar una obra sin borrar datos y comenzar otra limpia; permitir más de un proyecto activo cuando sea necesario.

**Equipo responsable:** SA  
**Colaborador:** Integración solo para mantener IDs compatibles.  
**Dependencias:** Fase 1 completa.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F2.1 | SA | Listado de proyectos | 10% | Vista activos/cerrados/archivados | Estados visibles | F1 | `projects-ui` |
| F2.2 | SA | Crear proyecto vacío | 12% | Wizard mínimo | Asistencia/nómina/caja empiezan vacías | F2.1 | `create-empty-project` |
| F2.3 | SA | Cambiar proyecto activo | 15% | Selector de proyecto | Toda la UI cambia de contexto | F2.1 | `project-switcher` |
| F2.4 | SA | Cerrar proyecto | 10% | Acción de cierre | Bloquea nuevas operaciones normales | F2.3 | `close-project` |
| F2.5 | SA | Reabrir proyecto | 5% | Acción explícita | Proyecto vuelve a permitir edición | F2.4 | `reopen-project` |
| F2.6 | SA | Archivar proyecto | 5% | Archivo visual | No borra información | F2.4 | `archive-project` |
| F2.7 | SA | Nuevo proyecto desde otro como base | 10% | Copia selectiva | Copia empleados/config, no movimientos | F2.2 | `clone-project-setup` |
| F2.8 | SA | Resumen mensual | 13% | Datos agregados mensuales | Totales coherentes con módulos | F1 | `project-monthly-summary` |
| F2.9 | SA | PDF final multipágina | 15% | Informe de cierre | Portada + resumen + meses + totales | F2.8 | `project-final-report` |
| F2.10 | SA | Varios proyectos activos | 5% | Soporte simultáneo | Se alterna entre A/B sin mezcla | F2.3 | `multi-active-projects` |

**Al terminar la fase:** puede cerrarse Proyecto A, generar informe final, archivarlo y empezar Proyecto B desde cero o mantener ambos activos.

**Punto de parada usable:** sistema de proyectos completo aun sin Mini/Firebase.

**Estado esperado:** Proyectos 100%; Reporte final V1 ~80%; Proyecto global ~30%.

---

## Fase 3 — Contrato común + integración manual SA↔Mini

**Propósito:** crear el idioma oficial del ecosistema y demostrar que SA/Mini pueden intercambiar datos sin Firebase.

**Equipo principal:** Integración  
**Equipos consumidores:** SA y Mini  
**Dependencias:** Fase 2 terminada al menos hasta project context estable.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F3.1 | Integración | Envelope/versionado | 8% | `messageId`, `schemaVersion`, origen, projectId, timestamps | SA/Mini validan misma estructura | F2 | `ecosystem-envelope` |
| F3.2 | Integración + SA | Contrato Employee | 10% | ID, número, nombre, puesto, estado, grupo/líder | Mini puede consumirlo sin interpretación extra | F3.1 | `employee-contract` |
| F3.3 | Integración + SA | Contrato Group/Leader | 7% | Modelo de grupo | Asociación inequívoca | F3.1 | `group-contract` |
| F3.4 | Integración + SA + Mini | Contrato AttendanceSubmission | 10% | Modelo de asistencia de campo | Igual para archivo y Firebase | F3.1 | `attendance-contract` |
| F3.5 | SA | Exportar a Mini avanzado | 10% | Archivo canónico roster | Incluye projectId + employeeId + metadata | F3.2–F3.3 | `advanced-mini-export` |
| F3.6 | Mini | Importar roster SA | 10% | Importador canónico | Lee archivo y previsualiza cambios | F3.5 | `sa-roster-import` |
| F3.7 | Mini | Setup de consolidación | 15% | Relación local↔SA | Usuario puede confirmar coincidencias | F3.6 | `employee-consolidation` |
| F3.8 | Mini | Preservar historial | 10% | Mapping persistente | Historial antiguo sigue ligado al trabajador correcto | F3.7 | `preserve-mini-history` |
| F3.9 | Mini | Exportar asistencia canónica | 8% | Archivo para SA | Mismo contrato futuro de Firebase | F3.4 | `attendance-export` |
| F3.10 | SA | Pipeline canónico de entrada | 7% | Adaptador estructurado | Vista previa + validación | F3.4/F3.9 | `canonical-field-import` |
| F3.11 | SA + Mini | Mantener WhatsApp como fallback | 5% | Adaptador legado | Flujo viejo continúa funcionando | F3.10 | `legacy-whatsapp-adapter` |

**Dependencias críticas que deben comunicarse:**

- Mini no empieza F3.6 hasta recibir de Integración/SA el contrato Employee final y un archivo de ejemplo válido.
- SA no cierra F3.10 hasta recibir de Mini al menos tres paquetes de prueba: normal, parcial y con error.
- Integración no cambia campos obligatorios después de que SA/Mini los implementen sin crear nueva versión de esquema.

**Al terminar la fase:** SA→archivo→Mini y Mini→archivo/WhatsApp→SA funcionan con el mismo contrato futuro de Firebase.

**Punto de parada usable:** integración bidireccional manual completa.

**Estado esperado:** Contrato 100%; Personal SA→Mini ~55%; Asistencia Mini→SA ~50%; Proyecto global ~42%.

---

## Fase 4 — Plataforma Firebase, identidad y seguridad

**Propósito:** construir la infraestructura remota sin hacer que SA o Mini dependan de ella para funcionar.

**Equipo responsable:** Integración  
**Colaboradores:** SA para UI administrativa mínima; Mini solo como consumidor posterior.  
**Dependencias:** Contrato F3 congelado.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F4.1 | Integración | Modelo Organization | 10% | Organización ligada a proyectos | projectId pertenece a organizationId | F3 | `organization-model` |
| F4.2 | Integración | Google Auth | 8% | Identidad individual | Sesiones válidas y revocables | F4.1 | `shared-auth` |
| F4.3 | Integración | Membership + roles | 12% | Miembros admin/leader | Rol y estado verificables | F4.2 | `members-roles` |
| F4.4 | Integración | Acceso por proyecto | 12% | Scope por projectId | Usuario sin acceso obtiene deny | F4.3 | `project-access` |
| F4.5 | Integración | Acceso por grupo | 8% | Scope por groupId | Líder ve solo grupo asignado | F4.4 | `group-access` |
| F4.6 | Integración | Zona sanitizada para campo | 10% | Collections de intercambio | No contiene nómina/préstamos/caja privada | F4.4 | `field-data-zone` |
| F4.7 | Integración | Firestore Rules + tests | 18% | Reglas de seguridad | Intentos directos no autorizados fallan | F4.5–F4.6 | `firestore-project-rules` |
| F4.8 | Integración + SA | Invitaciones temporales | 12% | QR/token de alta entropía | Expira, un solo uso, revocable | F4.7 | `project-invitations` |
| F4.9 | Integración | Auditoría básica | 5% | actor/source/timestamps | Eventos rastreables | F4.6 | `integration-audit` |
| F4.10 | Integración | Protocol version guard | 5% | Validación de versión | Versión incompatible falla de forma controlada | F3 | `protocol-versioning` |

**Dependencias críticas:**

- Mini no implementa login/vinculación final hasta que Integración entregue Auth + flujo de invitación documentado.
- SA no publica datos de campo hasta que las reglas de seguridad hayan pasado pruebas negativas.

**Al terminar:** existe plataforma segura, pero SA/Mini todavía pueden operar manualmente.

**Estado esperado:** Firebase/plataforma ~75%; Seguridad ~55%; Proyecto global ~54%.

---

## Fase 5 — Vinculación Mini ↔ Proyecto + consolidación central

**Propósito:** conectar una instalación Mini a una organización/proyecto/grupo sin perder su modo independiente.

**Equipo responsable:** Mini  
**Proveedor principal de dependencias:** Integración  
**Colaborador:** SA para UI de invitación y conciliación.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F5.1 | Mini | Google Login | 12% | Sesión de usuario | Login/logout/reapertura correctos | F4.2 | `mini-google-auth` |
| F5.2 | SA + Integración | Invitación a proyecto/grupo | 12% | Acción desde SA | Token contiene alcance correcto | F4.8 | `invite-mini-to-project` |
| F5.3 | Mini | Escáner QR | 10% | Cámara + canje | Vinculación válida desde móvil | F5.2 | `project-qr-link` |
| F5.4 | Mini | Código manual | 5% | Fallback | Funciona sin cámara | F5.2 | `manual-invite-code` |
| F5.5 | Mini | Confirmar proyecto/grupo | 8% | Pantalla confirmación | Evita conexión accidental | F5.3/5.4 | `link-confirmation` |
| F5.6 | Mini | Modo standalone | 10% | Continuar sin SA | Todas funciones locales siguen disponibles | — | `standalone-mode` |
| F5.7 | SA + Integración | Bandeja de consolidación central | 18% | Casos ambiguos | SA puede resolver mapping oficial | F4/F3 | `central-reconciliation` |
| F5.8 | Mini | Aplicar mapping | 15% | employeeId canónico | Historial intacto | F5.7 | `canonical-id-migration` |
| F5.9 | Integración + SA | Revocar acceso | 10% | Membership revocada | Pierde acceso cloud; datos locales no se borran | F4.3 | `project-access-revocation` |

**Al terminar:** Mini puede trabajar standalone o conectado a Proyecto X / Grupo Y.

**Estado esperado:** Vinculación 100%; Consolidación ~90%; Proyecto global ~64%.

---

## Fase 6 — Personal SA → Firebase → Mini

**Propósito:** automatizar el roster manteniendo el archivo manual como fallback.

**Responsable de origen:** SA  
**Responsable de transporte/seguridad:** Integración  
**Responsable de consumo:** Mini

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F6.1 | SA | Proyección sanitizada de roster | 12% | Datos de campo | Sin información privada | F3/F4 | `field-roster-projection` |
| F6.2 | Integración + SA | Publicar por proyecto | 12% | Roster en Firebase | projectId correcto | F6.1/F4 | `publish-project-roster` |
| F6.3 | Integración | Restringir por grupo | 10% | Reglas/query permitida | Líder solo recibe asignados | F4.5 | `group-roster-filter` |
| F6.4 | Mini | Descargar cambios | 12% | Sync roster | Actualiza lista sin duplicar | F6.2–F6.3 | `mini-roster-sync` |
| F6.5 | Mini | Cache offline | 15% | Roster local | Funciona sin red | F6.4 | `offline-roster-cache` |
| F6.6 | SA + Mini | Activo/inactivo | 10% | Estado oficial sincronizado | Histórico preservado | F6.4 | `employee-status-sync` |
| F6.7 | SA + Mini | Cambio de grupo/líder | 10% | Reasignación | Se refleja correctamente | F6.4 | `group-assignment-sync` |
| F6.8 | Mini | Ocultar localmente | 5% | Preferencia visual | No modifica estado SA | — | `local-hide` |
| F6.9 | Mini | Mantener importación por archivo | 7% | Fallback | Puede recuperar roster sin Firebase | F3.6 | `roster-file-fallback` |
| F6.10 | SA + Mini | Detección de inconsistencias | 7% | Alertas/mapping | No crea duplicados silenciosos | F5 | `roster-reconciliation-checks` |

**Al terminar:** editar personal en SA actualiza Mini automáticamente sin perder operación offline.

**Estado esperado:** Personal SA→Mini 100%; Offline Mini ~75%; Proyecto global ~74%.

---

## Fase 7 — Asistencia Mini → Firebase → SA

**Propósito:** automatizar el flujo principal de campo manteniendo a SA como autoridad.

**Responsable de origen:** Mini  
**Responsable de transporte:** Integración  
**Responsable de aprobación:** SA

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F7.1 | Mini | Crear submission local | 8% | Objeto canónico | Funciona sin Internet | F3.4 | `local-attendance-submission` |
| F7.2 | Mini | Cola offline | 12% | Pending queue | Sobrevive cierre/reinicio | F7.1 | `attendance-sync-queue` |
| F7.3 | Integración + Mini | Enviar con projectId | 10% | Documento cloud | Nunca cae en proyecto incorrecto | F4/F7.2 | `upload-attendance` |
| F7.4 | SA | Bandeja de campo | 12% | Inbox | Nuevos envíos visibles | F7.3 | `field-inbox` |
| F7.5 | SA | Vista previa/comparación | 12% | Review UI | Diferencias comprensibles | F7.4 | `attendance-review` |
| F7.6 | SA | Aprobar/importar | 12% | Asistencia oficial | Solo aprobación modifica registro oficial | F7.5 | `approve-submission` |
| F7.7 | Integración + SA | Idempotencia | 10% | Protección duplicados | Reenvío no duplica | F7.3 | `submission-idempotency` |
| F7.8 | SA + Mini | Revisiones/correcciones | 8% | Versiones | No se sobreescribe silenciosamente | F7.6 | `submission-revisions` |
| F7.9 | Integración + Mini | Estado de vuelta | 8% | pending/received/approved/error | Mini conoce estado real | F7.4–F7.6 | `submission-status` |
| F7.10 | SA + Mini | Archivo + WhatsApp fallback | 8% | Transporte alternativo | Firebase no es requisito | F3 | `attendance-fallbacks` |

**Al terminar:** Mini → Firebase → SA → revisión → asistencia oficial → nómina.

**Estado esperado:** Asistencia Mini→SA 100%; Proyecto global ~86%.

---

## Fase 8 — NFC por proyecto

**Propósito:** incorporar NFC como una fuente independiente de eventos para comparar con asistencia reportada.

**Responsable principal:** Integración  
**Consumidor:** SA  
**Mini:** no bloqueante.

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F8.1 | Integración + SA | Registro de dispositivo | 15% | deviceId | Dispositivo identificable | F4 | `nfc-device-registry` |
| F8.2 | Integración + SA | Asociar a proyecto | 15% | project binding | Evento siempre conoce proyecto | F8.1 | `nfc-project-link` |
| F8.3 | SA | Tarjeta↔empleado | 20% | Mapping | employeeId estable | F6 | `nfc-card-mapping` |
| F8.4 | Integración | Recibir evento estructurado | 20% | nfcEvent | device/employee/time/type válidos | F8.2–F8.3 | `nfc-events` |
| F8.5 | SA | Vista de eventos | 15% | UI diagnóstica | Ingeniero puede inspeccionar marcas | F8.4 | `nfc-event-view` |
| F8.6 | SA | Comparar NFC↔Mini | 15% | Cross-check | Diferencias visibles sin aprobar automáticamente | F7/F8.5 | `attendance-crosscheck` |

**Al terminar:** SA dispone de una segunda fuente de evidencia de asistencia por proyecto.

**Estado esperado:** NFC V1 ~80%; Proyecto global ~91%.

---

## Fase 9 — Solicitudes SA↔Mini

**Propósito:** habilitar comunicación estructurada bidireccional de oficina/campo.

**Contrato/transporte:** Integración  
**Creación administrativa:** SA  
**Experiencia de campo:** Mini

| Paso | Responsable | Trabajo | Peso | Entregable | Criterio de aceptación | Dependencia | Commit/Hito |
|---|---|---|---:|---|---|---|---|
| F9.1 | SA | Crear solicitud | 12% | Request | Formulario válido | F3 contrato | `sa-field-request-create` |
| F9.2 | Integración + SA | Publicar por proyecto/grupo | 10% | Delivery | Solo destinatarios correctos | F4 | `publish-field-request` |
| F9.3 | Mini | Recibir offline | 12% | Cache | Puede abrir sin conexión | F9.2 | `receive-field-request` |
| F9.4 | Mini | Responder | 12% | Response | Datos estructurados | F9.3 | `field-request-response` |
| F9.5 | Integración + SA | Sincronizar resultados | 12% | Resultados en SA | Progreso visible | F9.4 | `sync-field-responses` |
| F9.6 | Mini | Crear solicitud desde campo | 12% | Field-originated request | Mantiene origen/autor | F3 | `mini-originated-request` |
| F9.7 | SA | Recibir solicitud de campo | 10% | Inbox | Administrable desde SA | F9.6 | `incoming-field-requests` |
| F9.8 | SA + Mini | Estados/cierre | 10% | Lifecycle | Estado consistente | F9.5/F9.7 | `field-request-lifecycle` |
| F9.9 | SA + Mini | Plantillas | 5% | Templates | Instancias no cambian al editar plantilla | F9.1 | `shared-request-templates` |
| F9.10 | Mini | WhatsApp fallback | 5% | Resumen humano | No reemplaza sync oficial | — | `request-whatsapp-fallback` |

**Al terminar:** canal estructurado completo SA↔Mini por proyecto/grupo.

**Estado esperado:** Solicitudes V1 100%; Proyecto global ~96%.

---

## Fase 10 — Endurecimiento, migración final y piloto

**Propósito:** demostrar que el sistema resiste condiciones reales y que ningún proyecto, usuario o grupo accede a datos incorrectos.

**Responsabilidad compartida:** SA + Mini + Integración  
**Coordinación:** decide cierre final.

| Paso | Responsable | Trabajo | Peso | Criterio de aceptación | Commit/Hito |
|---|---|---|---:|---|---|
| F10.1 | Todos | Aislamiento Proyecto A/B | 15% | Cero fugas | `project-isolation-e2e` |
| F10.2 | Integración | Security rules negativas | 15% | Accesos indebidos bloqueados | `firebase-security-tests` |
| F10.3 | Mini | Offline prolongado | 10% | Sin pérdida de datos | `offline-recovery-tests` |
| F10.4 | Todos | Duplicados/reintentos | 10% | Idempotencia comprobada | `sync-conflict-tests` |
| F10.5 | Todos | Proyecto cerrado | 10% | No recibe nuevas operaciones no autorizadas | `closed-project-guards` |
| F10.6 | Integración | Compatibilidad de versiones | 10% | Fallo controlado o migración | `protocol-compatibility` |
| F10.7 | SA | Backup/restore por proyecto | 10% | Restauración verificada | `project-backup-restore` |
| F10.8 | SA | Informe final real | 5% | PDF coherente con datos | `final-report-validation` |
| F10.9 | Todos | Piloto: A→cierre→B | 10% | Ciclo real completo | `field-pilot` |
| F10.10 | Todos | Documentación final | 5% | Otro agente puede continuar | `integration-stable` |

**Al terminar:** V1 estable de SA + Proyectos + Mini + Firebase + NFC.

---

## 8. Tabla maestra de avance por características

| Fase completada | Proyectos | Contrato | Personal SA→Mini | Asistencia Mini→SA | Firebase/Identidad | NFC | Solicitudes | Robustez |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| F0 | 15% | 5% | 0% | 0% | 0% | 0% | 5% | 10% |
| F1 | 60% | 10% | 5% | 5% | 0% | 0% | 5% | 20% |
| F2 | 100% | 15% | 5% | 5% | 0% | 0% | 5% | 30% |
| F3 | 100% | 100% | 55% | 50% | 10% | 10% | 25% | 40% |
| F4 | 100% | 100% | 55% | 50% | 75% | 15% | 30% | 55% |
| F5 | 100% | 100% | 70% | 55% | 90% | 15% | 35% | 65% |
| F6 | 100% | 100% | 100% | 60% | 95% | 20% | 40% | 75% |
| F7 | 100% | 100% | 100% | 100% | 100% | 30% | 50% | 85% |
| F8 | 100% | 100% | 100% | 100% | 100% | 80% V1 | 50% | 88% |
| F9 | 100% | 100% | 100% | 100% | 100% | 80% V1 | 100% V1 | 92% |
| F10 | 100% | 100% | 100% | 100% | 100% | 100% V1 | 100% V1 | 100% |

---

## 9. Control de entregables entre equipos

Cada entrega entre equipos debe quedar registrada.

| Entrega | Productor | Consumidor | Debe contener | Validación del consumidor |
|---|---|---|---|---|
| Project Contract v1 | SA + Integración | Mini/Integración | projectId, estado, metadata | Contrato aceptado |
| Employee Contract v1 | Integración + SA | Mini | IDs, número, nombre, puesto, grupo, estado | Mini importa fixtures |
| Attendance Contract v1 | Integración | SA + Mini | submissionId, projectId, empleados, horas, metadata | Round-trip sin pérdida |
| Roster Export v1 | SA | Mini | Archivo canónico | Importación + preview |
| Attendance Export v1 | Mini | SA | Archivo canónico | Importación + review |
| Auth Contract | Integración | Mini + SA | identidad, membership, revocación | Login/revocación probados |
| Invitation Contract | Integración | SA + Mini | token, expiry, scope, redeem | QR/código probados |
| Field Firestore Rules | Integración | SA + Mini | matriz allow/deny | Pruebas negativas pasan |
| Roster Sync v1 | SA + Integración | Mini | eventos/estado/versiones | Mini actualiza sin duplicar |
| Attendance Sync v1 | Mini + Integración | SA | estados + idempotencia | SA recibe una sola vez |
| NFC Event v1 | Integración | SA | deviceId, projectId, employeeId, timestamp, type | SA visualiza/correlaciona |

---

## 10. Reglas para trabajar con varios agentes de IA

1. Cada agente recibe **solo la fase/pasos que le corresponden** y este documento como referencia.
2. Ningún agente debe cambiar el contrato común sin registrar una propuesta de cambio.
3. Si descubre que necesita una parte de otro equipo, genera una **Solicitud de Dependencia** y se detiene en ese punto.
4. No se permite crear un "parche temporal privado" que otro equipo no conozca.
5. Antes de empezar una fase, el agente debe inspeccionar el estado actual del repositorio correspondiente porque el código puede haber cambiado.
6. Evitar refactors no relacionados con la tarea asignada.
7. Cada commit debe incluir prueba o criterio de aceptación verificable.
8. Mantener fallbacks existentes hasta que el reemplazo haya sido validado en piloto.
9. Si una tarea implica migración, crear backup/snapshot antes de modificar datos.
10. Si hay conflicto entre este roadmap y el código real, el agente debe **reportarlo antes de modificar la arquitectura**.

---

## 11. Plantilla de reporte de avance de un equipo

Cada agente/equipo debe responder al terminar una sesión con:

| Campo | Contenido esperado |
|---|---|
| Equipo | SA / Mini / Integración |
| Fase | Fx |
| Pasos trabajados | Fx.y |
| Completados | n/m |
| Peso completado de la fase | % |
| Cambios realizados | Resumen breve |
| Pruebas ejecutadas | Lista y resultado |
| Commits | SHA + título |
| Dependencias nuevas | IDs DEP-* |
| Bloqueos | Qué impide continuar |
| Riesgos encontrados | Técnicos/datos/UX |
| Próximo paso recomendado | Acción concreta |
| Estado del punto de parada | Usable / No usable / Requiere rollback |

---

## 12. Registro de dependencias

Mantener esta tabla viva durante el desarrollo.

| ID | Solicitante | Proveedor | Fase bloqueada | Necesidad | Prioridad | Estado |
|---|---|---|---|---|---|---|
| DEP-SA-001 | SA | SA (aprueba Dirección) | F2.8 / F2.9 (resumen mensual e informe final) + multiproyecto completo | Vínculo oficial Project ↔ PettyCashProject con relación **1:N**: campo `officialProjectId` en `pettyCashProjects`, backfill al predeterminado; UN Project oficial puede tener VARIOS proyectos de caja vinculados y los reportes suman TODOS (veredicto P7). Implementación NO bloquea F1.1–F1.6 | Alta | Decidida — implementación pendiente |
| DEP-SA-002 | SA | SA + Integración (valida Dirección) | F1.6 configuración cloud | Dependencia específica de configuración cloud: `payrollConfigsV1/{projectId}` requiere identidad/registro de proyecto estable; su resolución operativa queda detrás de DEP-SA-004 | Bloqueante para config cloud | Pendiente — no resolver dentro de F1.6-A |
| DEP-SA-003 | SA | SA (implementa ADR-016) | F1.6-B4 cierres/pagos | Implementar la política canónica fijada para `ProfileController.markAsPaid`: delegar al cierre de nómina o deshabilitar con proyectos ON; `employee.paymentHistory` se conserva como histórico y no como ledger nuevo | Bloqueante para B4 | Pendiente — ADR-016 fijado; implementación pendiente |
| DEP-SA-004 | SA | SA (valida Dirección) | Gate histórico de identidad canónica para F1.6 | Identidad canónica de `Project` entre dispositivos: misma cuenta/obra comparte un único `projectId`; `activeProjectId` sigue local. Implementación mínima SA-only sin organizaciones, roles, membresías, Mini ni Integración | Cerrada; no es bloqueo actual | **✅ Cerrado y aprobado 2026-08-27.** A6 + MC1 `b286d70`/`f735dd6` permanecen 🟡 pendientes de aprobación formal (24/24, 9/9, 368/368 · 3575, ALLOW 0 findings); B1–B5 y F1.7 siguen bloqueados por la secuencia formal, no por DEP-SA-004. |

---

## 13. Registro de decisiones arquitectónicas

Cada decisión que afecte a más de un equipo debe registrarse para evitar que futuros agentes la reinterpretan.

| ID | Decisión | Motivo | Equipos afectados | Fecha/versión |
|---|---|---|---|---|
| ADR-001 | SA sigue siendo fuente oficial | Evitar escrituras directas desde campo | SA, Mini, Integración | v0.1 |
| ADR-002 | Mini debe funcionar standalone | Resiliencia y uso independiente | Mini, Integración | v0.1 |
| ADR-003 | Firebase es transporte/plataforma, no contrato | Reducir acoplamiento | Todos | v0.1 |
| ADR-004 | Nuevo proyecto no borra anterior | Historial y reportes | SA | v0.1 |
| ADR-005 | `employeeId` != `authUid` != `employeeNumber` | Separar identidad laboral y cuenta | Todos | v0.1 |
| ADR-006 | Grupo/Líder sustituye "cuadrilla" como término principal | Reflejar organización real del proyecto | SA, Mini | v0.1 |
| ADR-007 | NFC complementa Mini inicialmente | Evitar automatizar decisiones prematuramente | SA, Integración | v0.1 |
| ADR-008 | Asistencia multiproyecto: la ruta diaria `attendance/{dateKey}` SE CONSERVA; el `projectId` vive en cada registro dentro de `records`; toda escritura es read-merge-write filtrando por proyecto — jamás reemplazo total del documento del día | El documento cloud de un día es COMPARTIDO entre proyectos activos esa fecha | SA, Integración | v0.2 (2026-08-24) |
| ADR-009 | El espejo `data/current` permanece a nivel CUENTA incluyendo todos los proyectos; el filtrado por proyecto lo hacen repositorios/UI vía `activeProjectId`; PROHIBIDO sobrescribir entidades de otro proyecto con una copia local obsoleta (guard anti-stale obligatoria en saveFullState/merge) | Evitar que cambiar de proyecto activo o sincronizar con datos viejos reemplace en cloud datos del proyecto anterior | SA, Integración | v0.2 (ajustada por veredicto P4, 2026-08-25) |
| ADR-010 | En Gen1 `employeeId` identifica la FICHA dentro del proyecto, no a la persona globalmente; copiar un empleado a otra obra genera NUEVO `employeeId` + metadata `copiedFromEmployeeId` (solo auditoría, sin sincronización entre copias) | Firestore no admite dos documentos con el mismo id en una colección; las obras deben ser independientes | SA, Mini, Integración | v0.2 |
| ADR-011 | Project v1 añade `startDate` y `endDate` (fechas laborales/contractuales reales) separadas de `createdAt`/`closedAt` (administrativas) | El informe final necesita inicio y fin REALES de la obra, no la fecha de alta en SA | SA | v0.2 |
| ADR-012 | **Implementada en A1 y conectada parcialmente en A3 cerrado:** nómina usa `PayrollProjectContext` capturado con empleados, posiciones, líderes, asistencia y settings; `buildAttendanceIndex` permanece RAW y Service/Period usan `ctx.getAttendance()` en las rutas A3. Snapshot deep-cloned con congelamiento de primer nivel antes del primer `await`; no es congelamiento recursivo ni wiring UI/runtime completo. | El estado global mutable y los índices compartidos no son una frontera de aislamiento económico | SA | v0.3, A3 cerrado 2026-08-28 |
| ADR-013 | **Implementada en A2 y consumida donde A3 cerrado está conectado:** configuración canónica IDB `projectPayrollConfigs`, clave `projectId`, semilla atómica y flag OFF sin dual-write. A3 consume horas/factores/feriados y período a nivel helper; `payrollDefaults` y `defaultDeductionPercentage` aún no se consumen. Cloud sigue diferida por DEP-SA-002; DEP-SA-004 está cerrado. | Una fuente durable por proyecto evita divergencia sin anticipar cloud ni UI | SA, Integración | v0.3, A3 cerrado 2026-08-28 |
| ADR-014 | **✅ Implementada y cerrada en A5 2026-08-29:** `exportConfig` es transitorio y se elimina de espejo, replace cloud, snapshots, DataOps local→cloud e ingresos legacy cloud/snapshot (`ae66121`; 17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix WARNING `Object.assign`); `settings.payrollDefaults` continúa durable hasta su migración canónica | Resolver H-05 y evitar recuperar ajustes/selecciones incompletos como estado oficial | SA | v0.4 (2026-08-29) |
| ADR-015 | **F1.6-B seleccionada, pendiente de implementación:** cierres nuevos usan schema 3 con `projectId` inmutable; promoción schema 2→3/default explícita y solo de metadata; IDs, fingerprints, lotes, repositorios, índices, cachés y consultas serán project-aware | Todo cierre, ajuste, préstamo, exportación y recuperación debe tener propietario económico inequívoco | SA, Integración | v0.3 (2026-08-26) |
| ADR-016 | **F1.6-B bloqueante, pendiente de implementación:** `PayrollClosure` es la autoridad canónica del estado económico de una nómina pagada; las nuevas operaciones `markAsPaid()` deben delegar al cierre canónico o quedar deshabilitadas con proyectos ON. `employee.paymentHistory` se conserva como dato histórico y no como ledger autoritativo nuevo | Evitar una segunda contabilidad divergente y mantener una única autoridad de pago | SA | v0.4 (2026-08-26) |

---

## 14. Política de cambio del contrato

Una vez implementado un contrato por dos equipos:

- No se cambia silenciosamente.
- Un cambio compatible puede incrementar una versión menor.
- Un cambio incompatible requiere nueva `schemaVersion`.
- El equipo que propone el cambio debe indicar impacto en SA, Mini, Integración, migraciones y fallbacks.
- Dirección/Coordinación aprueba antes de que otro equipo implemente el cambio.

---

## 15. Próxima acción recomendada

**No comenzar Firebase ni Mini todavía.**

La orden histórica de inicialización entregada al **Equipo SA** fue:

> Inspeccionar el estado actual del repositorio SA y ejecutar únicamente la Fase 0. No modificar todavía el comportamiento productivo. Entregar mapa de datos, propuesta de Project v1, plan de migración, riesgos y dependencias encontradas. No comenzar Fase 1 hasta que Dirección/Coordinación apruebe el informe.

Para el estado vigente de F1.6, esa orden histórica ya fue completada. La orden actual, actualizada el 2026-08-29, es:

> **Estado exacto: A0–A5 ✅; A6 🟡 principal `b286d70` + MC1 `f735dd6`, pendiente de aprobación formal; 24/24, 9/9, 62/62, 368/368 · 3575, MC1 ALLOW 0 findings; B1–B5 🔒 · F1.7 🔒.** Solicitar veredicto formal sobre `792793a..f735dd6` y detenerse antes de B1. MC1 resuelto no autoriza B1.

El primer objetivo técnico estable será:

> **SA puede contener dos proyectos completamente aislados y cambiar entre ellos sin mezclar empleados, asistencia, nómina, caja chica ni otros datos, manteniendo intacto el comportamiento actual dentro de cada proyecto.**

---

## 16. Estado inicial del roadmap

| Fase | Estado | Responsable principal | Dependencia principal |
|---|---|---|---|
| F0 Auditoría SA | ✅ Completada 6/6 — APROBADA por Dirección (2026-08-24) | SA | Ninguna |
| F1.0 Precondiciones del refactor | ✅ Completada y APROBADA (2026-08-25) | SA | F0 aprobada |
| F1 Contexto de proyecto | En ejecución — F1.5 cerrada; F1.6: **A0–A5 ✅ · A6 🟡 `b286d70` + MC1 `f735dd6`, pendiente formal · B1–B5 🔒 · F1.7 🔒** | SA | **A6 pendiente de aprobación formal; no autorizar B1** |
| F2 Ciclo de vida/reporte | Bloqueado | SA | F1 aprobada |
| F3 Contrato + manual | Bloqueado | Integración | F2/project context estable |
| F4 Firebase | Bloqueado | Integración | F3 congelado |
| F5 Vinculación Mini | Bloqueado | Mini | F4 Auth/invitaciones |
| F6 Personal sync | Bloqueado | SA+Integración+Mini | F5 + F4 rules |
| F7 Asistencia sync | Bloqueado | Mini+Integración+SA | F6 + contrato asistencia |
| F8 NFC | Bloqueado | Integración+SA | F7 estable |
| F9 Solicitudes | Bloqueado | SA+Mini+Integración | F4/F5 + contrato requests |
| F10 Piloto | Bloqueado | Todos | F0–F9 |
