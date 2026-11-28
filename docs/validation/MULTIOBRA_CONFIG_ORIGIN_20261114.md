# Multiobra — Comprobación segura de origen de una configuración de nómina

**Fecha:** 2026-11-14. **Base:** main 1.7.138 (f6f63aee).
**Rama:** audit/multiobra-config-origin-20261114.
**Incidencias asociadas:** #342 (referencias huérfanas), #352 (diagnóstico).

## Reporte recibido y hallazgo reproducible

El usuario aportó sa-multiobra-diagnostico-2026-11-13-18-59-24.log
de SA 1.7.136:
- financialAndSpecialIssues=1
- DIAGNOSTIC_CONFIGS_REFERENCE_UNAVAILABLE (1)
- readFailures=0
- archivedCases=0

La clasificación es generada por diagnoseExtendedProjectData()
en ProjectExtendedDiagnostics.js: una configuración de IndexedDB
projectPayrollConfigs contiene un projectId no incluido en el catálogo
de obras local. El log anonimizado no contiene ese ID; no identifica
por sí solo si la obra fue eliminada o falta sincronización.

## Modificación no destructiva

- En «Revisión especial → Configuraciones de nómina», mostrar el
  identificador local solo en la pantalla autenticada, junto con
  «Verificar obra original en Firebase». No incluir ese ID en el .log.
- Al pulsarlo, comprobar desde el servidor (nunca caché):
  users/{uid}/projectsV1/{source}, projectAliasesV1/{source} y
  projectRegistryV1/default. Un alias válido se sigue hasta su proyecto
  canónico. No se leen ni muestran importes de nómina.
- Distinguir: original presente, lápida, alias con destino válido,
  alias roto, referencia canónica, no encontrado, sin sesión, error de
  permisos/red, identificación inválida y cambio de cuenta.
- «No encontrado» no certifica que se haya borrado físicamente:
  se recomienda revisar respaldo y seleccionar destino explícitamente.
- Si se intenta aplicar una recuperación de configuración huérfana,
  volver a comprobar la referencia en Firebase justo antes de escribir.
  Un resultado distinto de «no encontrado» bloquea esa recuperación,
  manteniendo intacto el origen.
- Después de actualizar el catálogo, invalidar los veredictos remotos
  ya obtenidos. Si la ventana se cierra o cambia la cuenta, descartar
  la respuesta tardía.
- Al compartir .log, incluir únicamente códigos anónimos de los
  estados comprobados; no incorporar nombres, IDs, valores de
  configuración, tokens ni respuestas Firestore.

## Comprobaciones

- Prueba roja inicial: módulo inexistente, luego 13 casos unitarios
  de procedencia y permisos (verde).
- Pruebas de UI: referencia visible solo localmente, comprobación,
  salida durante consulta, bloqueo de guardado si la obra existe.
- Prueba de privacidad: estado incluido en .log sin IDs ni importes.
- Emulador Firestore + SDK web real + firestore.rules del repositorio:
  siete casos; obra presente solo en nube, alias, ausente, lápida,
  canónico, permiso denegado y desconexión sin usar caché.

## Riesgos y límites

- No se consultaron datos de la cuenta real. La exportación
  anonimizada no contiene el identificador y no hay una sesión
  Firebase autenticada del usuario accesible desde a2. La clasificación
  concreta de la obra aún requiere pulsar el botón desde la sesión del
  propietario y compartir el resultado de diagnóstico.
- La comprobación remota es una lectura puntual, no una reserva
  transaccional entre Firebase e IndexedDB. Otra sesión podría
  restablecer una obra en la ventana posterior al chequeo; para una
  garantía absoluta se necesita coordinación del lado servidor (#340).
- Esta entrega no mueve, repara, elimina, recupera ni edita
  la configuración real. No resuelve todos los registros huérfanos de #342.
- No habilita el borrado de obras, no cambia el período 30+30 y
  no altera pagos, préstamos ni cierres históricos.

## Resultados finales locales (2026-11-14)

- Suite general: **728/728 suites, 7,486/7,486 tests PASS**.
- Suite de regresión Multiobra 360: **103/103 PASS**, divididos en
  47 unitarios, 4 de Firestore/emulador y 52 de navegador (390/1280 px).
  **0 fallos de infraestructura** en la ejecución final.
- Suite de procedencia con SDK real y reglas Firestore: **7/7 PASS**
  mediante una cuenta sintética y emulador local.
- La primera ejecución completa encontró un manifiesto de precaché
  incompleto para el módulo nuevo; fue regenerado y la segunda
  ejecución general terminó sin fallos.
- La primera ejecución Multiobra no pudo iniciar sus cuatro pruebas
  Firestore por un shim Node de ventana ausente. La inicialización
  de eventos del test se alineó con el entorno de navegador, sin
  modificar expectativas de los casos; la repetición completa pasó.
- El árbol de producción no registra escrituras nuevas en modo
  verificación y **no se tocaron datos reales**.

**No se considera resuelta la incidencia del usuario:** deberá
ejecutarse la nueva lectura desde su cuenta autorizada para saber si
el identificador pertenece a una obra, un alias, una lápida o
una referencia realmente ausente. No se ejecuta reparación automática.
