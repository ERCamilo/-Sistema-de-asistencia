# Plan de implementación del menú NFC (NO implementado)

**Estado:** propuesta para revisión. Parte de las maquetas de esta carpeta y de [`HALLAZGOS.md`](HALLAZGOS.md). Nada de esto está construido; no se tocó producción.

## Reglas de trabajo para cada PR

Siguen las convenciones del repo (`docs/plans/*`, `scripts/check-*.cjs`, `npm run test:release`) y las preferencias del responsable:

1. **Prueba antes de tocar.** Antes de modificar, mover o refactorizar una función: localizar su prueba, ejecutarla y comprobar que cubre el caso; si no, escribir la prueba primero. Terminar con las mismas pruebas en verde. Cada paso lista abajo «antes» y «nuevas».
2. **Misma línea de diseño:** reutilizar `css/voice-settings.css` y los tokens de `design.md`. Nada de librerías nuevas en runtime.
3. **PR pequeño** (objetivo ≤ ~400 líneas de producción + pruebas). Un PR = una capacidad que se puede publicar sola.
4. **Cambios visibles al usuario** → versión, novedades y caché según `docs/plans/release-notes-updates.md` (`AppVersion.js`, `sw-precache-manifest.js`, `npm run test:release`). El #328 lo pide explícitamente.
5. **Contrato v1 solo aditivo.** Cualquier acción nueva (`ping`, `liberar`, `reemplazar`, `suggestion`) se acuerda y publica **primero** en el backend; el cliente nuevo no se libera hasta que el destino la acepte.
6. **Lo nuevo con sesión** (lecturas, lectores, reglas) detrás del guard de contexto que ya usa Voz (`sameContext`, `sa:voice-wipe`), con carga diferida.
7. Cada PR actualiza `docs/integrations/nfc-webhook.md` solo si cambia el contrato o el flujo.

## Comando base de verificación (existente)

```sh
npx jest --runInBand js/tests/NfcCore.test.js js/tests/NfcIntegration.test.js js/tests/NfcReadTest.test.js js/tests/SettingsVoiceCard.test.js js/tests/VoiceSettingsUI.test.js
CHROMIUM_PATH=<chromium> npm run test:nfc-read
```
Línea base medida antes de este trabajo: **5 suites / 94 pruebas** y `test:nfc-read` en verde (no cambiaron al añadir las maquetas).

## Dos vías en paralelo

- **Vía A — solo cliente, sin backend nuevo:** PR 1–3 (se pueden publicar ya).
- **Vía B — depende del backend de consolidación** (fases 1–3 del diseño ESP32: base de datos, cálculo, registro sobre BD): PR 4–10. No empezar un PR de la vía B sin su endpoint desplegado en pruebas.

```
A:  PR1 ── PR2 ── PR3
B:        PR4 ── PR5 ── PR6 ── PR7 ── PR8 ── PR9 ── PR10 ── PR11
          (tarjetas)  (lecturas)  (resolver) (fotos) (reglas) (entrega)
```

## Pasos

### PR 1 — Banner de estado del flujo actual (#328)
**Qué:** bloque con tono + SVG + título + texto en el modal de asociación existente (verde sólo tras confirmación válida; ámbar informativo «mismo empleado»; ámbar de advertencia «otro empleado»; «disponible» en tono informativo; error en rojo). Sin cambios de contrato ni de lógica de reintento.
**Archivos:** `NfcViews.js` (nuevo `nfcStatusBlock`), `NfcIntegration.js` (solo `render`), `css/nfc-test.css`.
**Pruebas existentes (correr antes y después):** `NfcIntegration.test.js` (cubre consultar/asociar/reintento/conflicto), `NfcReadTest.test.js`, `scripts/check-nfc-read.cjs` (modal real a 320/390/768/1440).
**Pruebas nuevas:** en `NfcIntegration.test.js`, un caso por estado (`disponible` ≠ verde; `registrada` verde con nombre; `mismo_empleado`; `otro_empleado` sin guardar y sin datos personales; timeout ≠ éxito; región `role=status` anunciada). En `check-nfc-read.cjs`: captura/aserción de los tres estados a 320 y 390 px sin desbordamiento.
**Riesgo bajo.** Es el único cambio que toca el flujo en producción; por eso va primero y solo.

### PR 2 — Entrada «NFC» en Ajustes y modal con «Conexión y prueba»
**Qué:** `SettingsNfcCard.js` junto a `SettingsVoiceCard` (General), handler `open-nfc-settings` en `SettingsUI.js`, `window.openNfcSettings` en `app.js` (como `openVoiceSettings`), `NfcSettingsUI.js` (shell: pila, atrás, foco de retorno, cierre ante cambio de contexto, `cancel`/Escape), vista **Conexión** con el interruptor y el destino (reutiliza `readNfcPreferences`/`saveNfcPreferences`, sin tocar su formato de `localStorage`), enlace a la lectura de prueba existente. `css/nfc-settings.css` (candidato `ns-nfc-settings.css` de esta carpeta) enlazado en `index.html` y `sw-precache-manifest.js`. **La tarjeta de Ajustes → Pruebas se mantiene** (doble acceso temporal) para no romper `check-nfc-read.cjs` ni el flujo ya validado.
**Pruebas existentes:** `SettingsVoiceCard.test.js` (el patrón a clonar), `VoiceSettingsUI.test.js` (shell), `NfcCore/NfcIntegration/NfcReadTest`.
**Pruebas nuevas:** `SettingsNfcCard.test.js` (entrada presente con asociación apagada y sin sesión; no añade pestañas); `NfcSettingsUI.test.js` (abrir/atrás/cerrar/foco; preferencias round-trip idénticas a las de Pruebas; URL inválida; apagar cancela el lector); `scripts/check-nfc-settings.cjs` + `npm run test:nfc-settings` (Playwright 320/390/768/1440; clon de `check-voice-settings.cjs`).
**Decisión previa:** ¿el modal NFC aparece solo para administradores? (HALLAZGOS §7 #9).

### PR 3 — «Comprobar conexión» y manejo honesto de Test/CORS
**Qué:** `buildNfcPing` + `sendNfcPing` en `NfcCore.js` (sin empleado, con `requestId`), clasificación `offline | unreachable | access | invalid` usando `navigator.onLine` y `TypeError`; en Test, aviso previo «cada llamada gasta la escucha» y texto «lo más probable…»; chip de destino visible en el flujo de asociación; ocultar el modo Test/Personalizado fuera de modo desarrollador (si se decide).
**Dependencia:** acción `ping` aceptada por el webhook (repo ESP32/n8n) y devolviendo cabeceras CORS también en errores del flujo de **producción**. Hasta entonces, la comprobación en Producción puede ser una `consultar` con un UID de prueba reservado **(alternativa descartable)**.
**Pruebas existentes:** `NfcCore.test.js` (cubre `sendNfcRequest`: 404, 401/403, 409, timeout, TypeError → NETWORK).
**Pruebas nuevas:** `NfcCore.test.js` → ping válido/ inválido/ requestId distinto/ timeout/ sin red/ `TypeError` en Test → «unreachable» (no `NOT_FOUND`); `NfcSettingsUI.test.js` → botón deshabilitado mientras corre, mensaje por causa, el aviso de Test aparece, no hay comprobación automática al abrir; `check-nfc-settings.cjs` con `fetch` simulado.

### PR 4 — Sección «Tarjetas»: lista, ficha e historial (solo lectura)
**Dependencia (vía B):** `listar_tarjetas` e `historial_tarjetas` sobre la base de datos (fase 3 del diseño). Los nombres se resuelven en SA por `employeeId`.
**Qué:** `NfcCardsClient.js` (inyectado, como `send` en `NfcIntegration`), `NfcSettingsCardsView.js`, buscador y filtros (clon de la vista de Pronunciaciones de Voz), tarjetas libres, línea de tiempo.
**Pruebas existentes:** `NfcCore.test.js` (UID `4/7/10` bytes se reutiliza), `VoiceSettingsUI.test.js` (patrón de lista con búsqueda).
**Pruebas nuevas:** `NfcCardsClient.test.js` (validación estricta de la respuesta: `status` desconocido → error; UID normalizado; estados «sin tarjeta/vigente/libre»); vista: empleado eliminado mientras está abierto; nunca aparece «bloqueada»; accesibilidad de la fila (nombre, número, estado en texto).

### PR 5 — Cambiar tarjeta y marcar como perdida (extensión del contrato)
**Dependencia (vía B):** `liberar` y `reemplazar` atómicos con idempotencia por `requestId`.
**Qué:** `NfcCore` aditivo (`buildNfcRequest` acepta `liberar|reemplazar`; `readNfcResponse` acepta `liberada` y `suggestion` opcional); `NfcIntegration` modo `replace`; confirmación de liberar (patrón `vs-confirm`); sugerencia de historial **solo texto**.
**Pruebas existentes (correr primero):** todo `NfcCore.test.js` y `NfcIntegration.test.js` (son la red de seguridad del contrato v1: **no deben cambiar**).
**Pruebas nuevas:** respuesta perdida en `liberar` y en `reemplazar` reutiliza `requestId`+body; 409 `EMPLEADO_CON_TARJETA` en cliente antiguo; sugerencia nunca cambia el `employeeId` enviado; motivo obligatorio; tras liberar se puede asociar otra; backend que devuelve campo extra no rompe.

### PR 6 — «Lecturas» (lista del día) y «Lectores» (solo lectura) + chip en Ajustes
**Dependencia (vía B):** `listar_dias_periodo`, `resumen_nfc`, `listar_lectores`; **cliente autenticado** con el token de la sesión de SA (`NfcBackendClient.js`, `guard(context)` como Voz); copia local del último resumen para modo sin red.
**Qué:** tiles, filtros, filas con iconos de alerta, estado de lectores; ocultar/ bloquear sin sesión; versión antigua. Paginación/búsqueda (HALLAZGOS §6.7).
**Pruebas nuevas:** `NfcBackendClient.test.js` (token ausente/expirado, 401 → «inicia sesión», reintento no duplica); `NfcDayView.test.js` **con los mismos JSON de ejemplo del repo ESP32** (`docs/examples`, salida de `calcularDia`): contrato de forma; render sin red desde la copia; la lista nunca muestra secretos de lector; `check-nfc-settings.cjs` para los casos límite de §3.14.

### PR 7 — Resolver un día (editar, comida, nota, jornada estándar, consultar Mini, pendiente, revertir)
**Dependencia (vía B):** tipos de corrección nuevos (`editar_horas`, `jornada_estandar`, `consultar_mini`, `dejar_pendiente`) en `backend/correcciones` + SQL.
**Qué:** vista de día y panel «Resolver un dato»; espejo en vivo con función pura `nfcDayMath.js` **que reutiliza los casos de oro** del repo ESP32 (misma tabla de pruebas en ambos repos para que no diverjan); nota obligatoria; revertir.
**Pruebas existentes:** ninguna en SA para el cálculo (es nuevo); en el repo ESP32: `backend/calculo-diario` y `backend/correcciones` (deben seguir en verde).
**Pruebas nuevas:** `nfcDayMath.test.js` (0/1/2+ lecturas, doble toque en el umbral exacto, comida con y sin descuento, salida antes de entrada, redondeo = valor decidido); vista: Guardar deshabilitado sin nota, sin red solo lectura, doble clic no duplica.
**Bloqueado por la decisión #1 (redondeo).** Sin ella, el PR muestra horas sin redondeo y lo dice.

### PR 8 — Fotos y lecturas sin dueño
**Dependencia:** `fotos_dia` (URL firmadas), `marcar_foto`, `listar_lecturas_sin_dueno`, `simular_asignacion`.
**Qué:** visor, veredicto, retención visible; asignación manual con simulación y aviso de «ya tiene tarjeta propia».
**Pruebas nuevas:** el service worker **no** cachea URLs de fotos; foto no llegó / borrada / `no_guardar`; asignación nunca cambia la tarjeta; ignorar es reversible hasta cerrar.
**Riesgo alto de privacidad:** revisión de seguridad (`/security-review`) obligatoria antes de publicar.

### PR 9 — Reglas de cálculo
**Dependencia:** `leer_ajustes`/`guardar_ajustes` con quién/cuándo y **instantánea por día verificado** (decisión previa) + decisión #3 (¿por obra?).
**Qué:** steppers, presets, simulador, retención de fotos con confirmación al reducir.
**Pruebas nuevas:** borrador local vs guardado (descartar), rangos válidos (mínimos/máximos), la confirmación de borrar fotos, el simulador usa el mismo `nfcDayMath` que PR 7.

### PR 10 — Entrega a la bandeja
**Dependencia:** `entregar_a_bandeja` o sobre armado en cliente; mapeo lector→obra y `ownerUid` (#327).
**Qué:** botón «Preparar borrador», vista previa, estado «Enviado», fuente «NFC ESP32» visible en «Conectados».
**Pruebas existentes (red de seguridad):** `AttendanceSubmissionInboxTests`, `AttendanceSubmissionInboxStoreLifecycle`, `AttendanceSubmissionFixtureContract`, `AttendanceSubmissionVersionStore/Versioning`, `Meta2SmartInboxAdversarial`.
**Pruebas nuevas:** el sobre pasa `validateAttendanceSubmission` (claves permitidas, `present` con horas > 0); reenviar el mismo día es idempotente y con contenido distinto lanza `AttendanceSubmissionReplayConflictError`; **nunca** se llama a una escritura de asistencia oficial (test de espía sobre el aplicador); Playwright de la bandeja con el borrador NFC «Nuevo».

### PR 11 — Limpieza y documentación
Retirar la tarjeta de Pruebas (queda solo el acceso a «Conexión y prueba»; actualizar `check-nfc-read.cjs`), actualizar `docs/integrations/nfc-webhook.md` y `docs/validation/nfc-web-reader.md`, nota de versión, `test:release`.

## Trabajo en el repo ESP32 (fuera de este repo, pero bloqueante)

| Para | Qué |
|---|---|
| PR 3 | Acción `ping`; cabeceras CORS también en errores del flujo de producción |
| PR 4–5 | Registro de tarjetas sobre BD (fase 3): `liberar`, `reemplazar`, historial, `suggestion` |
| PR 6 | `listar_dias_periodo`, `resumen_nfc`, `listar_lectores` (+ columnas `firmware`, `cola`) |
| PR 7 | Tipos de corrección nuevos y estados «consulta Mini»/«pendiente» con recordatorio |
| PR 8 | Bucket de fotos, URL firmadas, `veredicto`, purga |
| PR 9 | `redondeo`, `extra_minimo_min`, historial de ajustes, instantánea por día verificado |
| PR 10 | Sobre `attendance-submission/v1` y mapeo lector→obra |

## Cobertura: qué existe y qué se añade

| Área | Cubierto hoy por | Se añade |
|---|---|---|
| UID, destino, petición/respuesta, errores HTTP | `NfcCore.test.js` | ping, acciones nuevas, estados nuevos |
| Flujo leer → consultar → guardar → reintento | `NfcIntegration.test.js` | modos reemplazo/liberar, banner (#328) |
| Diagnóstico de lectura | `NfcReadTest.test.js` | incrustado en modal |
| Modal real a 320/390/768/1440 | `check-nfc-read.cjs` | `check-nfc-settings.cjs` |
| Entrada compacta en Ajustes | `SettingsVoiceCard.test.js` (patrón) | `SettingsNfcCard.test.js` |
| Shell de modal con subvistas | `VoiceSettingsUI.test.js` (patrón) | `NfcSettingsUI.test.js` |
| Bandeja `attendance-submission/v1` | 6 suites `AttendanceSubmission*`, `Meta2SmartInboxAdversarial` | adaptador NFC |
| Cálculo de horas, lecturas, lectores, fotos, reglas | — | todo nuevo, con casos de oro compartidos con el repo ESP32 |

## Definición de «terminado» por PR

- Pruebas del área en verde **antes y después**; las nuevas fallan sin el cambio.
- `npm run test:nfc-read` y, si aplica, `npm run test:nfc-settings` en 320/390/768/1440 px.
- Sin desbordamiento horizontal, controles ≥ 44 px (≥ 36 px en presets), `role=status/alert` para cambios, significado nunca solo por color.
- Version/novedades/caché si hay cambio visible; `npm run test:release`.
- Nota de qué se verificó **de verdad** (simulado vs dispositivo real), como hace `nfc-web-reader.md`.
