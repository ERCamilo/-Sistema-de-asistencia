# F1.0 — Precondiciones del refactor · Índice de entregables

| Campo | Valor |
|---|---|
| Fase | Fase 1.0 (precondiciones para F1, según decisión de Dirección 2026-08-24/25) |
| Estado | 🔄 **Bloque F1.1–F1.3 EJECUTADO y REVISADO (segunda vuelta independiente)** — detenido esperando Dirección · Control general: F0 100% · F1.0 100% · F1 3/10 · Ejecución independiente: **345/345 suites · 3307 tests · 0 fallos** · Pre-F1.4 obligatorio: revisar AppState.js + resolver W1/W2 antes de wiring/flag ON (ver §Segunda vuelta) |
| Punto de parada | **USABLE** — suite completa verde (342 suites / 3280 tests, 0 fallos) |
| Rama de trabajo | `fase-0-auditoria` (apilada sobre main; incluye también trabajo paralelo del dueño del repo) |

## Pasos

| Paso | Entregable | Estado | ¿Bloquea? |
|---|---|---|---|
| F1.0.1 IDB real en tests | [`F1.0.1-idb-real.md`](F1.0.1-idb-real.md) | ✅ Completado | Sí (todo F1) |
| F1.0.2 Verificar/corregir H-01 | [`F1.0.2-h01-tombstone.md`](F1.0.2-h01-tombstone.md) | ✅ CONFIRMADO y CORREGIDO | Sí (F1.4 empleados) |
| F1.0.3 Asistencia multiproyecto | [§P3 en orden F1.0](F1.0-precondiciones.md#p3--asistencia-multiproyecto-f103) | Propuesta lista | Sí (F1.5) |
| F1.0.4 Espejo `data/current` | [§P4](F1.0-precondiciones.md#p4--espejo-datacurrent-f104) | Propuesta lista | Sí (sync) |
| F1.0.5 Fechas reales Project | [§P5](F1.0-precondiciones.md#p5--fechas-reales-del-proyecto-f105) | Propuesta lista | Antes de congelar Project v1 |
| F1.0.6 Clonación de empleado | [§P6](F1.0-precondiciones.md#p6--significado-exacto-de-copiar-empleado-f106) | Propuesta lista | Antes de F2.7 |
| F1.0.7 Mapping caja↔proyecto | [§P7](F1.0-precondiciones.md#p7--mapping-project-oficial--pettycashproject-f107-dep-sa-001) | Propuesta lista (DEP-SA-001) | Implementación antes de F2.8 |
| **F1.1 ProjectRepository** | [`F1.1-project-repository.md`](F1.1-project-repository.md) | ✅ Ejecutado + revisado | — |
| **F1.2 Proyecto predeterminado** | [`F1.2-default-project.md`](F1.2-default-project.md) | ✅ Ejecutado + revisado (wiring deferido) | Wiring+flag antes de criterio completo |
| **F1.3 ProjectContext** | [`F1.3-project-context.md`](F1.3-project-context.md) | ✅ Ejecutado + revisado | — |

Orden de trabajo completa: [`F1.0-precondiciones.md`](F1.0-precondiciones.md)

## Registros cruzados

- Hallazgo **H-01 RESUELTO** → [`../fase-0/F0-HALLAZGOS.md`](../fase-0/F0-HALLAZGOS.md) (tabla de resueltos)
- **DEP-SA-001** registrada en roadmap §12
- ADRs nuevos **008–011** en roadmap §13 (v0.2)

## Commits de esta etapa

| SHA | Contenido |
|---|---|
| `a9be8ac` | Infraestructura de tests IDB real + 2 suites runtime |
| `6979829` | Fix H-01 (Employee.js) + test de protección |
| `e69febe` | Orden F1.0 + roadmap v0.2 (ADRs/DEP/estados) |
| `1e4c706` | Registro de resolución H-01 en hallazgos |

### Commits del bloque F1.1–F1.3

| SHA | Contenido |
|---|---|
| `fffdf9c` | Modelo Project + store local + IDB v17 (F1.1) |
| `aae38be` | Default project bootstrap + ProjectContext (F1.2/F1.3) |
| `d99df63` | Cierre documental F1.0 según veredictos de Dirección |

## 🔍 Segunda vuelta independiente (2026-08-25)

Revisión fresh-context (lente confiabilidad) sobre `fffdf9c`+`aae38be`, más ejecución independiente de la suite por el orquestador.

| Verificación | Resultado |
|---|---|
| Modelo vs spec F0.3 §1-§2 (+P5 fechas) | ✅ PASS — transiciones 1:1, 8 casos inválidos fijados |
| Serialización byte-estable (hasOwnProperty) | ✅ PASS |
| Bump v16→v17 puramente aditivo (sin ruta de pérdida) | ✅ PASS |
| Cero acoplamiento a dominios operativos; flag OFF intacto | ✅ PASS (bloque imports de app.js inspeccionado completo) |
| Sitio TODO boot-wiring (~app.js:7047) | ✅ VERIFICADO exacto |
| Calidad de tests (reinicio/recuperación/idempotencia) | ✅ reales, no tautológicos |
| Ejecución independiente | ✅ **345/345 suites · 3307 tests · 0 fallos** (107s) |

**Hallazgos — ninguno alcanza hoy (flag OFF + wiring deferido):**

| ID | Sev. | Hallazgo | Disposición recomendada |
|---|---|---|---|
| W1 | 🟡 | Pointer-HIT de `ensureDefaultProject()` no valida status → un default cerrado/archivado entregaría id no-activo desde el contexto | Corregir ANTES de wiring/flag ON |
| W2 | 🟡 | Carrera cross-tab crearía "Mi obra" duplicada si dos pestañas ven puntero ausente (CrossTabLock existe, no se usa aquí) | Ídem + test de concurrencia |
| S3 | 🔵 | Constructor acepta closed/archived sin exigir closedAt/archivedAt (riesgo vía payloads futuros de sync) | Hardening próximo slice |
| S4 | 🔵 | JSDoc "nunca rechaza" vs comportamiento real de getActiveProjectId | Ajustar contrato |
| S5 | 🔵 | metadata retenida por referencia (mutación del caller filtra a payloads) | Clonar en frontera de entidad |

**Backlog de tests sugeridos:** concurrencia de ensure(); pointer→default cerrado/archivado; apertura v16 real→upgrade v17 con registros preexistentes; toggle flag ON→OFF→ON en sesión; desempate listAll con createdAt igual.

**Veredicto del revisor:** base SEGURA para F1.4+ una vez revisado `AppState.js` y resueltos W1/W2 antes de habilitar wiring/flag.

## ⚠️ Contexto para cualquier agente futuro

Durante esta etapa apareció **trabajo paralelo del dueño del repo** en el mismo árbol (`index.html`, `js/modules/core/AppState.js`, `js/modules/ui/onboarding/`, suites `OnboardingCore*`; commit `5aecc21`). NO fue tocado por el Equipo SA. El cambio pendiente en **`AppState.js` merece revisión antes de F1.4**: ese archivo contiene el proxy que aplana entidades (hallazgo H-07), base de varios supuestos auditados.

## Cómo retomar

1. Leer roadmap v0.2 (§13 ADRs nuevos) + este índice + [`F1.0-precondiciones.md`](F1.0-precondiciones.md).
2. Pendiente de Dirección: veredicto P3–P7 → recién ahí se emite autorización F1.1.1 (ProjectRepository).
3. Pre-F1.4 recomendado: revisar diff de `AppState.js` paralelo.
