# Registro vivo de Dirección

> **Política de rama:** `project-docs` es el registro interno de Dirección y nunca se integra a `main`. Las bitácoras deben apuntar a SHAs funcionales verificables en remoto; código y documentación deben estar publicados antes de una revisión. Veredictos, roadmap, ADR, dependencias y estados viven solamente en esta rama. Una bitácora no sustituye la inspección del código funcional.

## Estado actual

| Unidad | Estado |
|---|---|
| A0-A5 | ✅ Cerradas y aprobadas por Dirección |
| A6 | 🟢 Autorizada exclusivamente: cierre de Tanda A |
| B1-B5 | 🔒 Bloqueadas |
| F1.7 | 🔒 Bloqueada |

| Referencia funcional | Valor |
|---|---|
| Rama | `feature/factor-dias-no-laborables` |
| SHA remoto | `792793ac875cb56afed84a1f982d1b19d6fa4f15` (`792793a`) |
| Alcance acreditado | A5 cerrado; A6 autorizado |
| A6 funcional | **No incluido aún** en el SHA remoto ni en esta rama documental |

## Lectura viva

1. [Roadmap de Dirección](roadmap/ROADMAP.md)
2. [Índice de Fase 1](fase-1/README.md)
3. [Contrato vivo F1.6](fase-1/F1.6-nomina-multiproyecto.md)
4. [Bitácora A5](fase-1/F1.6-A5-bitacora.md)
5. [Bitácora A4](fase-1/F1.6-A4-bitacora.md)
6. Bitácoras históricas: [A0](fase-1/F1.6-A0-bitacora.md), [A0.5](fase-1/F1.6-A0.5-bitacora.md), [A1](fase-1/F1.6-A1-bitacora.md), [A2](fase-1/F1.6-A2-bitacora.md) y [A3](fase-1/F1.6-A3-bitacora.md)
7. [Hallazgos de Fase 0](fase-0/F0-HALLAZGOS.md)

## Próximo punto de parada

Ejecutar solamente **A6**, publicar su commit funcional en `feature/factor-dias-no-laborables` y publicar la actualización documental correspondiente antes de solicitar revisión. Detenerse después de A6 para veredicto formal de Dirección: no iniciar B1-B5 ni F1.7.

## Estructura

| Ruta | Contenido |
|---|---|
| [`roadmap/`](roadmap/ROADMAP.md) | Roadmap, dependencias, ADR y estados de Dirección |
| [`fase-0/`](fase-0/README.md) | Auditoría y preparación de SA |
| [`fase-1/`](fase-1/README.md) | Ejecución, contratos y bitácoras de Fase 1 |
