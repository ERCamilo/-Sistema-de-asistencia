# Multiobra: auditoría de aceptación ampliada (2026-09-30)

**Dictamen: bloqueado para dar por terminado.** Hay siete problemas reproducidos,
con cuatro prioridades altas y tres medias. Las prioridades describen el efecto
observado y su riesgo; no afirman que haya ocurrido un incidente en producción.

Base revisada: **v1.7.21**, commit
`75a8cd98b6fac417a95821b9261c34fed673a510`.
Rama: `audit/multiobra-blockers-20260930`.
Esta rama contiene únicamente pruebas e informe, sin correcciones de producción.
Los tests nuevos expresan el comportamiento requerido y fallan en la base.
No se deben invertir con `test.failing`, omitir ni eliminar para conseguir verde.

## Resultados y alcance de la evidencia

| Ejecución | Resultado |
| --- | --- |
| Suite existente sobre la base exacta, antes de añadir los tests | 536 suites / 5043 tests pasan |
| Auditoría local, incluyendo orden aleatorio (seed 9302026) | 17 tests: 11 fallan y 6 controles pasan |
| Firestore real en emulador local, SDK y reglas del repositorio | 4 tests: 2 fallan y 2 controles pasan |
| Regresión focal de catálogo, contexto, horas, restauración y cierres | 14 suites / 123 tests pasan |

En total: **21 tests nuevos, 13 reproducciones fallidas y 8 controles correctos**.
Las 13 reproducciones corresponden a siete causas agrupadas, no a trece fallos
independientes. No se ha ejecutado la suite completa incluyendo los nuevos tests;
su resultado esperado permanece rojo mientras existan los bloqueos.

Los tests locales usan módulos reales, eventos DOM de jsdom y, donde corresponde,
IndexedDBService real sobre fake-indexeddb. Auth y transporte de esos tests están
inyectados. La auditoría de Firestore usa dos clientes independientes del SDK
real, autenticación sintética del emulador y las reglas de este commit; solo
simula la presentación de notificaciones. Las pausas se fuerzan con promesas,
sin esperas de red ni sleeps en los tests.

No se modificaron datos de usuarios, Firebase/Supabase de producción, reglas
desplegadas ni módulos productivos. El emulador se inició solo en loopback y se
detuvo al terminar.

## Hallazgos

| ID | Prioridad | Efecto observado | Reproducciones |
| --- | --- | --- | --- |
| R1 | Alta | Respuesta de A aplicada tras cambiar a B; B reutiliza la petición de A | 2 |
| R2 | Alta | Remoto antiguo sobrescribe una edición local más reciente de nómina o nombre | 2 |
| R3 | Media | Catálogo intenta publicar un respaldo desconectado antes de la decisión | 1 |
| R4 | Media | Evento/guardado de otra obra desplaza la configuración de la obra activa | 3 |
| R5 | Alta | Horas editadas por el usuario siguen siendo semilla y se pierden al sincronizar | 1 |
| R6 | Media | Respuestas atrasadas revierten selección o desalinean preferencia y filtros | 2 |
| R7 | Alta | Publicación atrasada sobrescribe una edición más reciente de otro dispositivo en Firestore | 2 |

### R1: aislamiento de cuenta y cancelación incompletos

Fuente: `js/modules/features/projects/ProjectCatalogSync.js`,
`syncProjectCatalog`, `applyRemoteCatalog`, `stopProjectCatalogLiveSync`.

1. Iniciar la lectura para AUDIT-A y mantenerla pendiente.
2. Detener la escucha, cambiar auth a AUDIT-B y guardar B-ONLY.
3. Liberar una respuesta de A con A-ONLY.

**Observado:** A-ONLY entra en IndexedDB después del cambio de cuenta.
En una segunda reproducción, la llamada de B no ejecuta su lector: reutiliza
`_inFlight` de A. El dato B esperado nunca se descarga.

Cancelar una suscripción no invalida las operaciones ya iniciadas. La promesa
global no distingue cuentas. Se necesita una generación de sesión y comprobarla
antes de efectos asíncronos; la deduplicación también debe respetar uid.
La app sí llama stopProjectCatalogLiveSync al cambiar de cuenta, pero esta prueba
no simula todo el proceso de login, limpieza y recuperación de la UI.

### R2: comparación y escritura local separadas

Fuente: `ProjectCatalogSync.js`, `applyRemoteCatalog`.

- Nómina local inicial: 8h, updatedAt=1. Remoto: 9h, updatedAt=50.
- Pausar tras leer el estado local.
- Confirmar edición local: 10h, updatedAt=100.
- Reanudar aplicación de la respuesta remota.

**Observado:** termina con 9h y updatedAt=50; se pierde la edición confirmada.
La segunda prueba reproduce el mismo defecto para el nombre de la obra:
Local newest / 100 acaba como Remote old / 50.

La decisión LWW debe tomarse con el valor vigente en una operación atómica, o
mediante un mecanismo equivalente que impida confirmar una decisión obsoleta.
Las pruebas permiten que una implementación corregida termine sin usar el punto
de lectura no atómico; también verifican la conservación de la edición posterior.

### R3: catálogo ignora la restauración desconectada

Fuente: `ProjectCatalogSync.js` y
`js/modules/services/DetachedRestoreGuard.js`.

Marcar una restauración pendiente e invocar syncProjectCatalog con la sesión
disponible. `isDetachedRestoreSyncBlocked()` devuelve true.

**Observado:** writeDoc recibe RESTORED e intenta publicarlo.
El control positivo usa `runDetachedRestoreLoginGate` y una elección upload:
la subida autorizada funciona y limpia la marca.

Proteger inicio y efectos de la sincronización automática, conservando el paso
expresamente autorizado. Este caso comprueba la omisión del servicio; falta
reproducir el flujo completo en navegador para precisar su exposición en UI.

### R4: caché activa desplazada por otra obra

Fuente: `js/modules/features/payroll/ActivePayrollSettings.js`,
`setActivePayrollConfig` y el listener `payroll-config:changed`.

Con A activa y configurada a 9h / período de 21 días, recibir el evento de B.
**Observado:** la vista de A pasa a los ajustes generales de 8h / 15 días.
No aplica correctamente la configuración de B: pierde la caché de A y cae al
fallback general.

Se reproduce tanto con el evento DOM como con ProjectCatalogSync real recibiendo
configuraciones A y B, persistiendo ambas correctamente y anunciándolas.
La tercera prueba inicia un guardado en A, cambia a B, y termina el guardado A:
también desplaza la caché de B.

Los controles de evento activo y guardado en la misma obra pasan.
Se necesita conservar la configuración de la obra vigente frente a eventos y
finalizaciones de otra obra. No se afirma aquí que ya se haya persistido una
nómina con importes erróneos; se confirma que los consumidores de ajustes reciben
horas/período generales en lugar de los de la obra activa.

### R5: edición de horas sigue marcada como semilla

Fuente: `ActivePayrollSettings.js`, `updateActiveDayHours`;
`js/modules/features/payroll/ProjectPayrollConfigStore.js`, `putConfig`;
`ProjectCatalogSync.js`, `planConfigMerge`.

1. Partir de una configuración seeded=true.
2. Usar updateActiveDayHours y el repositorio real para guardar 10h en una fecha.
3. Confirmar en IndexedDB: fecha=10h y updatedAt=100.
4. Sincronizar una configuración no provisional anterior: fecha=8h / updatedAt=50.

**Observado:** la edición vuelve a 8h / 50.
El guardado conserva seeded=true y la regla «real gana a semilla» descarta
la edición explícita del usuario sin considerar su fecha más reciente.

Una modificación explícita debe dejar de ser provisional. El control demuestra
que una semilla genuina sin editar sí debe ceder a una configuración real.
El hallazgo afecta al camino de horas por día; no afirma que todos los formularios
de configuración conserven la marca.

### R6: selección y resolución de alcance obsoletas

Fuente: `js/modules/features/projects/ProjectContext.js`,
`setActiveProjectId` y `getEntityScope`.

Primera prueba: validación A pendiente; seleccionar B; liberar A.
**Observado:** la última selección B acaba revertida a A.

Segunda: getEntityScope captura A y espera la obra por defecto; seleccionar B;
liberar la resolución antigua.
**Observado:** localStorage conserva B pero el snapshot síncrono vuelve a A,
que es el usado por filtros y handlers de guardado.

Se necesita una generación o revalidación coherente de la preferencia después
de awaits. El control secuencial pasa. Son pruebas del servicio; falta una
reproducción de los gestos concurrentes en UI para medir su exposición real.
La aserción de empleados incluidos exige además que el filtro siga mostrando B.

### R7: escritura obsoleta admitida en Firestore entre dispositivos

Fuente: `ProjectCatalogSync.js`, publicaciones con setDoc merge;
`firestore.rules`, `users/{uid}/projectsV1/{id}`.

Usar dos clientes SDK del mismo dueño:
1. A lee la configuración remota y prepara publicar su versión 10.
2. Pausar antes de su escritura.
3. B confirma una versión 20 y leerla para verificarla.
4. Liberar la escritura de A.

**Observado:** Firestore termina en versión 10 / 9h, perdiendo la versión
20 / 10h que B ya había confirmado. Otra prueba demuestra la regresión del
nombre de la obra: Device B newest / 20 pasa a Device A old / 10.

Se reprodujo con SDK y reglas reales en el emulador, no con un modelo de nube
en JavaScript. Las reglas actuales comprueban al dueño pero no impiden estas
regresiones. La comparación debe ocurrir de forma atómica en el servidor
(transacción u otra estrategia equivalente); revisar compatibilidad de clientes
antes de endurecer reglas. Los controles de publicación normal y rechazo de
una cuenta ajena pasan. No se ha probado contra reglas desplegadas en producción.

## Ejecutar y corregir

Desde la raíz de esta rama, con las dependencias de desarrollo instaladas:

```bash
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath \
  js/tests/MultiobraCatalogAudit.test.js \
  js/tests/MultiobraPayrollCacheAudit.test.js \
  js/tests/MultiobraContextAudit.test.js
```

Comprobación de independencia del orden:

```bash
node node_modules/jest/bin/jest.js --runInBand --randomize --seed=9302026 \
  --runTestsByPath js/tests/MultiobraCatalogAudit.test.js \
  js/tests/MultiobraPayrollCacheAudit.test.js js/tests/MultiobraContextAudit.test.js
```

Resultado esperado en la base: 11 fallos / 6 controles correctos, exit 1.
Después de las correcciones deben pasar los 17.

Para R7, iniciar un emulador Firestore **local** con Java 21 y Firebase Emulator
Suite. La configuración del repositorio `jest.emulator.config.cjs` requiere
además el SDK web de Firebase. Por ejemplo, si se usa directamente el JAR:

```bash
"$JAVA21_HOME/bin/java" -jar "$FIRESTORE_EMULATOR_JAR" \
  --host 127.0.0.1 --port 8859 --project_id demo-sa-multiobra-audit
```

En otra terminal, apuntar SA_EMULATOR_NODE_MODULES al directorio node_modules
que contiene firebase (omite la variable si está instalado en el proyecto):

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8859 \
SA_EMULATOR_NODE_MODULES="$FIREBASE_SDK_NODE_MODULES" \
node node_modules/jest/bin/jest.js -c jest.emulator.config.cjs --runInBand \
  --runTestsByPath js/tests/emulator/MultiobraCatalogConcurrencyAudit.emulator.test.js
```

Resultado esperado en la base: 2 fallos / 2 controles correctos, exit 1.
Después de corregir R7 deben pasar los 4. Sin host las pruebas del emulador
se omiten; un resultado omitido no cuenta como validación.
El archivo limita el host a loopback y usa exclusivamente
`demo-sa-multiobra-audit`; no requiere credenciales de Firebase reales.

Los logs de esta ejecución en a2 están en:
- /tmp/sa-multiobra-audit-20260930-jest.log (baseline completa).
- /tmp/sa-multiobra-deep-audit-randomized-20260930.log (17 tests).
- /tmp/sa-multiobra-deep-audit-emulator-20260930.log (4 tests).
- /tmp/sa-multiobra-deep-related-20260930.log (123 regresiones).
Son temporales; las reproducciones y el resultado resumido quedan en git.

## Criterio de cierre y límites

Corregir R1–R7, conseguir 21/21 nuevos tests y ejecutar nuevamente la suite
existente. Mantener los controles positivos y la protección de cierres/backups.

Antes de cerrar multiobra también queda validar en navegador dos obras y dos
dispositivos: cambios de cuenta con lecturas pendientes, restauración autorizada,
horas/períodos, filtros y guardados después de cambiar de obra, y concurrencia
de catálogo. Incluir empleados, asistencia, préstamos, cierres, exportaciones
y respaldos. Las 123 regresiones actuales pasan, pero no sustituyen esa matriz.

Esta ampliación se centra en catálogo, configuración, contexto y restauración,
con regresión de cierres. No es una certificación integral de Supabase, fotos,
facturas, todas las pantallas ni toda la nube. No encontrar más fallos en una
ejecución no demuestra ausencia de errores medianos o altos.
