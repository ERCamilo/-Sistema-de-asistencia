# Handoff: remodelación de la pantalla de Caja chica

Documento para el agente de Claude que tome la remodelación de **Caja chica**.
Léelo completo antes de tocar código. Las referencias `UI:123` apuntan a
`js/modules/features/pettycash/PettyCashUI.js` (versión v1.7.85, oct. 2026);
si el archivo cambió, búscalas por nombre de función.

---

## 1. Cómo trabajar con el usuario (obligatorio)

- **Idioma:** piensa, planea y escribe código en inglés; **responde al usuario
  en español**. Explica en español lo delicado (guardado, sincronización).
- **Pruebas antes de tocar algo:** antes de crear, mover, refactorizar o
  mejorar una función, busca su prueba. Si no existe o no cubre el caso,
  escríbela y córrela primero; luego haz el cambio y vuelve a correrla.
- **Misma línea de diseño:** respeta el estilo visual actual de la app (oscuro,
  pizarra, acento celeste) salvo que el usuario pida otra cosa.
- **No agregues cambios que no pidió.** Ya pasó: se agregaron cosas no
  solicitadas al flujo de n8n y hubo que revertirlas. Propón; no impongas.
- **Cierra cada respuesta con "Próximos pasos recomendados"** (lista corta).
- **Subagentes:** el usuario pidió que orquestes. Delega tareas acotadas
  (mapear código, escribir/actualizar pruebas, revisar) a subagentes Sonnet o
  Haiku con contexto preciso; tú diseñas, revisas e integras. Nunca des por
  buenos sus resultados sin revisar el diff y correr las pruebas.
- **Primero una maqueta.** Para cambios de interfaz grandes el usuario prefiere
  ver opciones antes de decidir (así se eligió la barra inferior: maqueta
  interactiva con 4 variantes en un artifact de tipo Design). Haz lo mismo:
  2–3 propuestas de la pantalla en teléfono (390×844), interactivas, con los
  colores reales; espera su elección antes de implementar.

## 2. Flujo de git y PR

- Rama de trabajo: la que indique la sesión (hasta ahora
  `claude/epic-curie-ps0wn3`). Un PR por entrega; el usuario fusiona.
- Tras cada fusión: `git fetch origin main && git checkout -B <rama> origin/main`
  y `git push --force-with-lease` (la rama solo tiene historia ya fusionada).
- Conflictos en `sw.js` y `js/modules/config/BuildInfo.js` (sellos de versión):
  `git checkout --theirs` en ambos; el hook de pre-commit los vuelve a sellar.
- Cloudflare Pages publica cada rama: `https://<rama-con-guiones>.sistema-de-asistencia.pages.dev`.
  Dale ese enlace al usuario para que pruebe en su teléfono.

## 3. Herramientas y verificación

| Comando | Para qué |
|---|---|
| `npx jest` | Toda la suite (~5960 pruebas, `js/tests/*.test.js`). Debe quedar en verde. |
| `npm run lint:state` | Prohíbe escrituras nuevas directas a `state` fuera de `stateManager.batchSetState(() => { … })` (en varias líneas). |
| `npm run build` | Compila `dist/`. |
| `npm run sw:precache` | **Obligatorio al agregar archivos** (si no, falla la prueba del manifiesto). |
| `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:settings-layout` | Revisión de Configuración (necesita `axe-core`; si falta: `npm install --no-save axe-core`). |

**Prueba en navegador real (recomendado para cambios de interfaz):** servir la
raíz del repo (`python3 -m http.server 8765 --bind 127.0.0.1`) y abrir con
Playwright (`/opt/node22/lib/node_modules/playwright/index.mjs`, Chromium en
`/opt/pw-browsers`), viewport 390×780, `isMobile`, `hasTouch`,
`serviceWorkers: 'block'`. Bloquea las peticiones externas y sirve stubs para
`firebasejs/10.8.0/firebase-*.js` (auth sin usuario). Espera el evento
`app:ready`; `loadDemoDataIntoDB()` carga datos demo; `changeTab('pettycash')`
abre la pantalla. Guarda capturas fuera del repo.

## 4. Estado actual de la pantalla

### Entrada y orden de secciones
- `PettyCashTab()` (UI:963) devuelve un string HTML; `js/app.js` lo pinta para
  la pestaña `'pettycash'`. Cada acción termina en `window.render?.()` y la
  pantalla se vuelve a pintar entera (no usa DOMDiff ni `data-preserve-scroll`).
- Orden dentro de `.pc-wrap` (máx. 980 px):
  1. Título "Caja Chica".
  2. `_receiptQueueBanner` (UI:1002): facturas por procesar.
  3. `_projectBar` (UI:1090): selector de proyecto (obra), filtro de obra,
     botones ✏️ renombrar, 🧾 datos fiscales, 🗑️ eliminar, "+ Proyecto".
  4. `_officialLinkDiagnostic` (UI:1133).
  5. `_projectBody` (UI:1163): saldo del proyecto, chips de periodo, y
     `_periodPanel` (UI:1193) con:
     - encabezado y resumen (KPIs) del periodo;
     - botones reposición / gasto, cámara (`pcOpenCamera`, solo con
       `settings.newReceiptCamera === true`) y fotos en lote;
     - formularios **en línea, encima de la lista**: `_periodEditForm`,
       `_movementForm` (UI:1326), `_movementEditForm` (UI:1382);
     - `_conciliacionBlock` si el periodo está cerrado;
     - `_reviewPendingMovementsTable` (UI:1499, clases `.pc-review-*`);
     - búsqueda, orden, resumen de duplicados y `_movementsList` (UI:1572)
       con "cargar más";
     - exportar Excel y cerrar periodo.
  6. Modales: `_cameraBatchModal` (UI:1026), `_receiptSourcePickerModal` (UI:1058).

### Datos
- `pc()` (UI:129) = `state.pettyCash`: `projects[]`, `periods[]`,
  `movements[]`, `selectedProjectId`, `selectedPeriodId`, orden, búsqueda,
  paginación, y estado de formularios (`form`, `periodForm`, `editMov`).
  Hay campos ad hoc sin declarar: `lastObraId`, `showAllObras`,
  `receiptQueueSummary`, `_editPhoto`, `_rescanStatus`.
- El **proyecto de caja chica** es un objeto propio (no el `Project` de
  multiproyecto): `{ id, name, status, companyRnc, consumerNoteMin,
  officialProjectId, nextRecordNumber, updatedAt, … }`.
- Persistencia en IndexedDB vía `PettyCashStore` con outbox y espejo hacia
  Firestore (`PettyCashRepository`, `PettyCashLiveSync*`). En el remoto gana el
  `updatedAt` más nuevo.
- Acciones: globales `window.pcXxx` registradas en `registerPettyCashGlobals`
  (UI:1742–2647) y llamadas con `data-app-fn` / `data-arg`.

### Formulario de edición de un gasto (`_movementEditForm`)
- ids `pce-*`: monto, fecha, comercio, RNC emisor, cliente, RNC cliente, NCF,
  categoría, descripción, foto de la factura, subtotal, ITBIS, total, fechas de
  emisión y vencimiento, notas e ítems (solo lectura).
- **Hueco conocido:** `descuento`, `propina`, `exento` e `itbisIncluido` llegan
  del lector pero no se pueden ver ni editar.
- Guardado: `pcSaveMovementEdit` (UI:2535) → `saveMovement` (UI:166).

### Facturas y cámara
- Cola del lector: `enqueueReceiptFile` (UI:262), `processPendingReceiptJobs`
  (UI:369), borradores locales `recoverLocalReceiptDrafts` (UI:390).
- Cámara nueva a pantalla completa: `PettyCashCamera.js` (+
  `css/pettycash-camera.css`, clases `.pcam*`), detrás del ajuste de prueba
  `newReceiptCamera` (Configuración → Tests). Sin él, cámara del sistema.
- Revisiones de la factura: `PettyCashReceiptChecks.js` (`checkReceipt`,
  `receiptNotes`, `receiptReviewState`, `fixesFor`). La cámara las recibe por
  `cameraItemsState` (UI:566), que pasa el RNC del proyecto
  (`PettyCashProjectFiscal.js`).
- Avisos: total que no cuadra (prueba descuento, ITBIS incluido y propina
  antes de avisar), tasa de ITBIS, RNC/NCF, NCF repetido, fecha fuera del
  periodo, factura de crédito fiscal no a nombre de la empresa
  (`client-rnc`). Notas sin marcar: cómo cuadró el total y factura de consumo.

### Estilo
- Casi todo con `style="…"` en línea (≈200 en UI). Pocas clases: `.pc-wrap`,
  `.pc-review-*` (`css/styles.css` ~5807).
- Paleta: texto `#e2e8f0`, apagado `#94a3b8`/`#64748b`, tarjetas
  `#172033`/`#1e293b`, inputs `#0f172a`, bordes `#334155`, acento `#0ea5e9`
  (barra inferior y cámara usan `#06b6d4`/`#22d3ee`), verde `#22c55e`
  (reposición), rojo `#ef4444` (gasto), ámbar `#f59e0b`.

### Puntos débiles
- Un solo archivo de 2650 líneas que mezcla dominio (cola, sync, subida) y vista.
- Marcado de tarjetas, botones e inputs repetido a mano; `_movementForm` y
  `_movementEditForm` duplican estructura.
- Formularios en línea encima de la lista; el repintado completo pierde el
  foco y el scroll.
- Manejadores en línea (`onchange="window.pcPhotoEdit(this)"`).

## 5. Restricciones (no romper)

- Seguir guardando con `saveMovement` / `saveProject` / `savePeriod` y
  seleccionar por id. No guardar datos en `localStorage` (solo la selección,
  `_pettycash_sel_v1`).
- No reescribir campos guardados (p. ej. `officialProjectId`,
  `nextRecordNumber`); el proyecto debe quedar idéntico byte a byte cuando
  Proyectos está apagado.
- Conservar los borradores locales de facturas y la cola offline.
- Si cambias ids `pce-*`/`pc-*`, actualiza manejadores y pruebas.
- **Barra inferior nueva:** en el teléfono hay una mini barra de sección que
  ocupa espacio abajo (`body:has(.bnav-sub)` añade `padding-bottom`). Nada
  fijo abajo debe quedar tapado. Al cambiar de pantalla, el scroll vuelve
  arriba (`ScreenScroll.js`); un repintado lo conserva.
- Escrituras a `state` dentro de `stateManager.batchSetState` (lint:state).
- Las pruebas de PettyCash* (persistencia, sync, outbox, cámara, OCR) deben
  seguir en verde; ver la lista en `js/tests/PettyCash*`.

## 6. Objetivos: CONFIRMAR CON EL USUARIO

El usuario pidió "remodelar la pantalla de caja chica" sin detallar todavía.
**Pregunta primero** qué le molesta hoy y qué quiere ver al abrirla. Ideas
para la maqueta (no son decisiones):

1. **Pensada para el teléfono:** tarjeta de saldo y resumen del periodo arriba;
   movimientos como tarjetas compactas (comercio, monto, fecha, estado de la
   factura); acción principal grande "Tomar foto de factura".
2. **Formularios en hoja inferior** (bottom sheet) en vez de en línea sobre la
   lista, para no perder la posición.
3. **Estado de cada factura visible en la lista:** leída, por revisar, sin
   crédito fiscal (consumo), no a nombre de la empresa, sin respaldo.
4. **Completar el formulario:** mostrar y editar descuento, propina, exento e
   ITBIS incluido; mostrar las notas de la revisión.
5. **Cámara nueva como opción por defecto** (hoy es prueba).
6. **Separar el código:** vistas en módulos pequeños y estilos en un CSS propio
   (`css/pettycash.css`) con clases, sin cambiar comportamiento.

## 7. Plan sugerido (por PRs pequeños)

1. **Maqueta** (artifact Design, 2–3 variantes interactivas) → el usuario elige.
2. **Refactor sin cambios visibles:** extraer CSS a clases y partir
   `PettyCashUI.js` en vistas (`PettyCashViews/*.js`). Pruebas primero; mismas
   capturas antes y después.
3. **Pantalla nueva detrás de un ajuste de prueba** (como `newBottomNav` y
   `newReceiptCamera`): agregar `newPettyCashScreen` en Configuración → Tests
   (`SettingsTestsTab.js`, `AUTO_SAVE_SWITCH_IDS` en `SettingsUI.js`).
4. Formularios en hoja inferior y campos fiscales nuevos.
5. Cuando el usuario la apruebe en su teléfono: pasarla a por defecto y quitar
   la vieja en un PR aparte.

## 8. Pendientes relacionados (no mezclar sin permiso)

- Importar en n8n el flujo actualizado `infra/n8n/caja-chica-ocr.json`.
- Recuadros del OCR: probar con 10–20 fotos reales (`docs/plans/ocr-facturas-pendientes.md`).
- Facturas largas: el usuario debe repetir la prueba y enviar el diagnóstico.
- Foto más rápida/liviana, captura automática.
- Lotes de 5 facturas en otro flujo de n8n (idea del usuario).
