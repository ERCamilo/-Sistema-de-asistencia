# B1 — Excepción de publicación por infraestructura de review

## Estado final

> **B1 — 🟡 PUBLICADA BAJO `EXC-REVIEW-B1-001`; APROBACIÓN FORMAL DE DIRECCIÓN PENDIENTE**

| Área | Estado |
| --- | --- |
| Implementación | ✅ Completa |
| Pruebas | ✅ `41/41` enfocadas · `129/129` A6/B1 · `3586/3586` suite completa |
| Revisión técnica | ✅ Estado final aprobado tras corregir `R3-001` |
| Base funcional | `f735dd6f3a4bda67688a76bb6cb11ee47e32833f` |
| Commit funcional | `193273e804b1f21aca46939bfc2ad631282e4c15` |
| Publicación remota | ✅ `origin/feature/factor-dias-no-laborables` resuelve exactamente a `193273e804b1f21aca46939bfc2ad631282e4c15` |
| Excepción | `EXC-REVIEW-B1-001`, autorizada formalmente por Dirección |
| Aprobación formal de B1 | Pendiente de revisión remota de Dirección |

Este registro acredita la publicación remota, pero **no declara B1 cerrada ni autoriza B2**. B1 permanece 🟡 hasta el veredicto formal de Dirección; B2–B5 y F1.7 continúan bloqueadas.

## Alcance de la excepción

Dirección autorizó publicar exclusivamente el commit `193273e` bajo la política Git ordinaria porque la infraestructura de Gentle AI no podía producir un receipt final ligado al target ya comprometido. `EXC-REVIEW-B1-001`:

- aplica solo a `193273e` y a la unidad B1;
- no deshabilita Gentle AI globalmente ni modifica el protocolo de unidades futuras;
- no transfiere ni inventa un receipt;
- no cubre B2–B5, F1.7 ni cambios ajenos;
- no sustituye la aprobación formal pendiente de Dirección.

## Diagnóstico preservado

La incidencia fue de infraestructura de review, no un fallo funcional de B1. La lineage nativa `review-10250a0f8ef7d324` detectó el CRITICAL determinista `R3-001`: una anulación coherentemente reetiquetada podía cambiar de propietario. La corrección acotada de 15 líneas hizo que `void` preserve el propietario y rechace ese retagging; la validación dirigida pasó y el estado final quedó aprobado.

Después, el hook de pre-commit regeneró únicamente timestamps en `js/modules/config/BuildInfo.js` y `sw.js`. Como el receipt estaba ligado al contenido exacto anterior, el target comprometido quedó clasificado `scope_changed`.

Gentle AI `2.4.0` con contrato `gentle-ai.review-integration/v2` exigía una revisión sucesora de recovery y no podía transferir la aprobación predecesora. El protocolo superior del orquestador impedía abrir ese nuevo ciclo. No existía una transición compatible para ligar un receipt final a `193273e`; por eso Dirección autorizó la excepción puntual.

| Campo | Valor |
| --- | --- |
| Versión | `gentle-ai 2.4.0` |
| Contrato | `gentle-ai.review-integration/v2` |
| Lineage original | `review-10250a0f8ef7d324` |
| Hallazgo | `R3-001` CRITICAL — coherent retagging en void |
| Corrección | 15 líneas, acotada y validada |
| Estado técnico final | `approved` |
| Disposition sobre target comprometido | `scope_changed` |
| Causa del cambio de scope | Solo timestamps regenerados en `BuildInfo.js` y `sw.js` |
| Recuperación requerida por v2 | Lineage sucesora y nuevo ciclo; transferencia de aprobación no permitida |
| Resolución de Dirección | `EXC-REVIEW-B1-001` + publicación Git ordinaria de `193273e` |

## Evidencia funcional

- Schema 3 implementado solo para construcción explícita con proyectos ON.
- `projectId` canónico y obligatorio; semánticamente inmutable mediante validación, identidad, contenido y reglas de anulación, sin `Object.freeze` ni propiedades no escribibles.
- Fingerprint e ID de cierre incorporan proyecto; mismo contenido en A/B produce identidades distintas; correcciones deterministas.
- Anulación preserva propietario y rechaza retagging coherente.
- Proyectos OFF conserva exactamente schema 2 sin `projectId` ni dual-write, indefinidamente salvo cambio contractual explícito de Dirección.
- Inventario funcional exacto: `js/modules/config/BuildInfo.js`, `js/modules/features/payroll/PayrollClosure.js`, `js/modules/features/payroll/PayrollClosureWorkflow.js`, `js/modules/features/payroll/PayrollLoanSettlement.js`, `js/tests/PayrollClosure.test.js`, `js/tests/PayrollClosureWorkflow.test.js`, `sw.js`.
- Resultados: `41/41` enfocados, `129/129` agrupados A6/B1 y `3586/3586` suite completa.

## Límites y punto de parada

- No existe trabajo B2 de store, migración, consultas, índices, cachés ni historial.
- No existe trabajo B3 cloud.
- No existe expansión B4 de préstamos o ajustes.
- No existe trabajo B5 de exportación o recuperación.
- No existe trabajo F1.7.
- La persistencia productiva y la migración permanecen bloqueadas para B2; todos los gates A6 siguen vigentes y no hay B2 remoto.
- Rollback: revertir únicamente `193273e`; B1 no creó ninguna migración de schema persistido.
- **Punto de parada: esperar revisión remota y aprobación formal de Dirección. No iniciar B2.**
