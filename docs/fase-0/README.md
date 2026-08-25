# Fase 0 — Auditoría y preparación de SA · Índice de entregables

| Campo | Valor |
|---|---|
| Fase | Fase 0 (roadmap v0.1) |
| Estado | ✅ COMPLETADA (6/6 pasos) — pendiente aprobación de Dirección y commits |
| Fecha de cierre | 2026-08-24 |
| Punto de parada | **USABLE** — la app no cambió ni una línea de comportamiento |

## Pasos

| Paso | Entregable | Estado | Criterio de aceptación |
|---|---|---|---|
| F0.1 Inventariar módulos/almacenamiento | [`F0.1-mapa-de-datos.md`](F0.1-mapa-de-datos.md) | ✅ | Todos los datos operativos ubicados ✔ |
| F0.2 Clasificar global vs proyecto | [`F0.2-matriz-propiedad-datos.md`](F0.2-matriz-propiedad-datos.md) | ✅ | Propietario definido por entidad ✔ (+ decisiones D1/D2 resueltas) |
| F0.3 Modelo mínimo Project | [`F0.3-modelo-project-v1.md`](F0.3-modelo-project-v1.md) | ✅ | ID/nombre/fechas/estado/metadata ✔ |
| F0.4 Plan de migración | [`F0.4-plan-migracion.md`](F0.4-plan-migracion.md) | ✅ | Ningún dato huérfano ✔ (verificación definida) |
| F0.5 Baseline de pruebas | [`F0.5-baseline-pruebas.md`](F0.5-baseline-pruebas.md) + 4 archivos en `js/tests/` | ✅ | Regresiones detectables ✔ (suite 331→335 verde) |
| F0.6 Feature flag proyectos | [`F0.6-feature-flag.md`](F0.6-feature-flag.md) + `FeatureFlags.js` | ✅ | Desactivable sin romper ✔ (suite 336/336, 3258 tests) |

## Registro transversal

- [`F0-HALLAZGOS.md`](F0-HALLAZGOS.md) — 13 hallazgos con severidad/evidencia/acción (registro vivo). Críticos: H-01 posible bug de tombstones de empleados, H-02 claves fuera de wipe, H-03 IDB intesteable en runtime.

## Decisiones de Dirección tomadas durante la fase

| ID | Decisión |
|---|---|
| D1 | Empleados POR PROYECTO; al crear se ofrece vacío o copia selectiva desde otra obra (sin movimientos) |
| D2 | Config operativa (período pago/feriados/factores) POR PROYECTO, sembrada al crear |

## Cómo retomar (para cualquier agente futuro)

1. Leer `ROADMAP_BASE_SA_MINI_INTEGRACION.md` (raíz) + este índice + `F0-HALLAZGOS.md`.
2. Reglas de sesión vigentes (codificadas en `openspec/config.yaml`): modo interactivo, consultas antes de commits/PRs, presupuesto 400 líneas, Fase 0 audit-only.
3. Próxima fase: **F1 — Contexto de proyecto en SA**, BLOQUEADA hasta aprobación explícita de Dirección sobre este informe.
4. Pre-requisitos recomendados antes de F1 (hallazgos): H-03 (`fake-indexeddb` dev-dep), evaluar H-01.
