# Resolución de la revisión independiente Multiobra — 2026-10-25

## Alcance y trazabilidad

PR #310: rama `fix/multiobra-360-r1-r7-20261024`.
La revisión independiente inicial, basada en `93ca8b3f`, registró **7/26 PASS, 19/26 FAIL**;
se mantiene en `MULTIOBRA_INDEPENDENT_REVIEW_20261024.md` como evidencia histórica.
Sus pruebas se incorporaron sin eliminar, omitir ni cambiar sus aserciones.

Esta corrección complementaria aborda los hallazgos B1–B5 y dos límites adicionales:

- **B1 — sesión/restauración:** controles de vigencia después de las lecturas,
  dentro de la mutación del catálogo, antes de publicar y al procesar
  configuraciones; la escucha en vivo usa su propia generación/UID.
- **B2 — semilla y edición:** creación de configuración únicamente cuando
  sigue ausente dentro de la transacción de IndexedDB.
- **B3 — lectura obsoleta:** revisión monótona de caché; una lectura antigua
  de la misma obra no reemplaza una edición reciente.
- **B4 — guardado rechazado:** no se publica como confirmado un valor de horas
  cuyo guardado durable haya fallado.
- **B5 — eliminación:** conserva la prevalencia de una lápida confirmada
  frente a una copia activa, incluso con marca horaria mayor.
- **Límites:** desactivar multiobra durante la validación no cambia la selección;
  cerrar sesión bloquea también solicitudes que proporcionen un UID explícito.

## Resultados ejecutados en a2

| Validación | Total | Aprobadas | Fallidas | Infraestructura |
| --- | ---: | ---: | ---: | ---: |
| Ampliación independiente: local | 11 | 11 | 0 | 0 |
| Ampliación independiente: SDK/Firestore | 3 | 3 | 0 | 0 |
| Ampliación independiente: navegador móvil/escritorio | 12 | 12 | 0 | 0 |
| **Ampliación** | **26** | **26** | **0** | **0** |
| Batería Multiobra 360 anterior | 103 | 103 | 0 | 0 |
| Suite general Jest | 6,648 | 6,648 | 0 | 0 |

Suite general: 669/669 suites. La ampliación registra `eligible: true`
en `qa/multiobra360/results/independent-review/acceptance.json`; la matriz
anterior registra su propia elegibilidad en `qa/multiobra360/results/latest/`.
Los resultados JSON, logs y capturas siguen siendo evidencias locales en a2;
no se publican datos de pruebas en el repositorio.

## Límites de aceptación

Las pruebas de navegador utilizan interfaces por componentes y cuentas
simuladas. Firestore se comprueba con SDK real y emulador local; no se ha
certificado OAuth real, reglas desplegadas en producción, service worker,
reinicio físico, recuperación de respaldos reales ni ciclo completo de
fusión/traslado/pausa/archivo de obras.

**Dictamen del candidato local:** los 26 escenarios adicionales y los 103
anteriores satisfacen las aserciones automatizadas. Mantener el PR sin fusionar
y los issues #296–#302 abiertos hasta la revisión independiente final y las
verificaciones de integración correspondientes.
