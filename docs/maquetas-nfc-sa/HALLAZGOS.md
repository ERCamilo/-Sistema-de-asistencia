# Menú NFC en SA — hallazgos de las maquetas

**Estado:** fase de diseño. No se cambió ningún archivo de producción ni el contrato NFC v1. Todo lo que está en esta carpeta es estático, sin red y con datos ficticios. Lo marcado **(propuesta)** no está decidido; lo marcado **(decidido)** viene del diseño aprobado en [`ERCamilo/EPS32-Asistencia` → `docs/diseno-consolidacion-nfc.md`](https://github.com/ERCamilo/EPS32-Asistencia/blob/main/docs/diseno-consolidacion-nfc.md) o de las decisiones del responsable en el encargo.

Cómo verlas: abrir `docs/maquetas-nfc-sa/index.html` en el navegador (o `npx http-server docs/maquetas-nfc-sa`). El botón **Escenario** (arriba a la derecha) simula casos límite y los refleja en la URL (`?net=off&app=old&listening=no&session=out&next=other`). Hay 15 capturas de referencia en [`capturas/`](capturas/) (320/390/1280 px; se regeneran a mano, no son prueba automática). El plan de implementación está en [`PLAN-IMPLEMENTACION.md`](PLAN-IMPLEMENTACION.md).

## 1. Qué se construyó y con qué se reutiliza

| Maqueta | Qué muestra |
|---|---|
| `ajustes.html` | Entrada compacta «NFC» junto a «Voz», con un chip de estado (Apagada / N por revisar / Sin conexión / Actualizar). |
| `modal.html` | El modal completo. Móvil: inicio con 6 tarjetas de sección y subvistas con «Volver» (patrón de Voz). ≥ 900 px: barra lateral + contenido. |
| `empleado.html` | El bloque `.employee-nfc-entry` del editor abriendo **el mismo** modal de asociación (sin tarjeta / con tarjeta). |
| `bandeja.html` | La bandeja existente (Pegar texto · Conectados) con un borrador NFC «Nuevo». |
| `index.html` | Índice con enlaces directos a cada pantalla y a cada caso límite. |

**Reutilización real, no copia:** las maquetas enlazan `css/voice-settings.css`, `css/settings.css` y `css/nfc-test.css` por ruta relativa. El diálogo conserva la clase `voice-settings-dialog`, así que cabecera, `vs-nav-card`, `vs-control-group`, `vs-setting-row` + `vs-toggle`, `vs-choice`, `vs-segmented`, `vs-record-filters`, `vs-notice`, `vs-btn`, footer y media queries (640 px / 360 px) son los de Voz sin tocar. Lo nuevo está en `ns-nfc-settings.css` (prefijo `ns-`) y es el **candidato** a `css/nfc-settings.css`; `mock-chrome.css` es solo marco de la maqueta.

Componentes nuevos (todos con tokens de `design.md`): banner de estado con icono + título + texto (`ns-status`), chip sólido (`ns-chip`, §5.4), tarjeta de métrica (`ns-tile`), fila de día (`ns-row`), espejo en vivo (`ns-mirror`, §5.7), stepper + presets (`ns-stepper`, §5.6), tarjeta de selección (`ns-radio`, §5.5), línea de tiempo (`ns-timeline`), rejilla de fotos (`ns-photos`).

**Desviación consciente de `design.md` §5.4:** los chips usan relleno sólido con tinta oscura (convención del diálogo de Voz, p. ej. `.vs-shared`, `.vs-delete-symbol`), no «texto blanco sobre color». Si se prefiere blanco, es un cambio de 4 variables `--tone-*-ink`. Contraste no medido (ver §9).

## 2. Qué va dentro de SA y qué en la app de revisión

Criterio: **SA = lo que se hace con el teléfono en la mano o en el editor de empleados; app de revisión = lo que necesita tabla grande, volumen o usuarios que no son administradores de SA.** Coincide con la recomendación del diseño (§3: «app de revisión aparte; SA la ve como una fuente más»).

| Capacidad | Dónde | Por qué |
|---|---|---|
| Activar asociación, destino, comprobar conexión, prueba de lectura | **SA** | Es local al teléfono (Web NFC solo existe aquí). |
| Asociar / cambiar / liberar tarjeta, historial por empleado | **SA** | Necesita el lector NFC del teléfono y el editor de empleados. La app de revisión puede mostrar el historial en solo lectura. |
| Resumen y lista del día, alertas, resolver **un** día (hora, comida, jornada de 8 h, consultar Mini, pendiente, revertir) | **SA (compacto)** | El administrador está en obra y resuelve con el teléfono. Una fila por empleado-día, sin columnas. |
| Foto: ver, veredicto | **SA (visor simple)** | Una foto a la vez; la rejilla/zoom comparativo queda para la app. |
| Lecturas sin dueño / sin hora fiable (lista corta) | **SA**, con enlace a la app | La asignación es por lectura; con muchas, la app. |
| Comparación con Mini **por día** | **SA** (dos columnas dentro del día) | Ya tiene la conciliación de Mini en la bandeja. |
| Tabla del período tipo Excel, totales, filtros múltiples, verificación en lote, exportar a Sheets | **App de revisión** | Peso y densidad; fuera de SA. |
| Matriz de comparación Mini × NFC de todo el período, agrupación por causa | **App de revisión** | Idem. |
| Claves de lectores: ver estado y **revocar** | **SA** (solo estado + revocar) | Acción de emergencia desde el teléfono. Crear/rotar claves se hace al flashear el lector: **nunca** se muestran secretos en SA. |
| Reglas (doble toque, comida, jornada, redondeo, retención de fotos) | **SA** edita; la app lee la misma fila (propuesta) | El responsable las pidió «personalizables por el usuario». Una sola fila `settings` y un solo escritor de cada ajuste evitan divergencias; **pregunta abierta**: ¿por obra? |
| Entrega a la bandeja | **SA** (botón que genera el borrador) | Es SA quien recibe; nada oficial se escribe. |

## 3. Pantallas: datos, endpoints, faltantes, riesgos y preguntas

Convención: «**Hoy**» = existe en SA/n8n v1. «**Backend nuevo**» = RPC/Edge Function sobre Supabase del repo ESP32 (nombres de [`docs/maquetas/HALLAZGOS.md`](https://github.com/ERCamilo/EPS32-Asistencia/blob/main/docs/maquetas/HALLAZGOS.md) del repo ESP32 cuando existen; el resto son propuestas).

### 3.1 Entrada en Ajustes
- **Datos:** `prefs.enabled` (local), `pendientes` (días por revisar) y estado de red/versión.
- **Endpoints:** ninguno propio. El chip «N por revisar» sale de `listar_dias_periodo` ya cacheado; si no hay sesión o red, el chip dice «Sin conexión» o se oculta.
- **Faltan:** nada en el contrato. Falta una **caché local** del último resumen para que el chip no exija red.
- **Riesgo:** un chip que consulta red en cada render de Ajustes. Mantenerlo sin red (lee solo la copia).

### 3.2 Inicio del modal / navegación
- **Datos:** conteos por sección (por revisar, tarjetas libres, lectores con problema, sin dueño).
- **Endpoint:** `resumen_nfc` **(propuesta)**, una sola llamada con los 4 contadores para no hacer 4 consultas al abrir.
- **Riesgo:** en móvil, 6 tarjetas obligan a entrar y volver. Se evaluó y se mantiene el patrón de Voz; a ≥ 900 px la barra lateral evita el vaivén. **Pregunta:** ¿se fusiona «Entrega» dentro de «Lecturas» (5 secciones)? La maqueta las separa para poder discutirlo.

### 3.3 Conexión y prueba
- **Datos:** `{enabled, mode, customUrl}` ya en `NfcPreferences` (localStorage, por dispositivo). Resultado de la comprobación (`ok | offline | unreachable`). Estado de sesión de SA para las secciones que usan cuenta.
- **Endpoints:** **Hoy:** `consultar`/`asociar` (webhook n8n). **Nuevo:** `action: "ping"` sin empleado ni tarjeta **(propuesta, extiende el contrato v1)**.
- **Faltan:** el `ping` no existe; hoy una acción desconocida podría responder 400/422 y eso sería un falso negativo. Debe responder `{schemaVersion:1, ok:true, requestId, status:"listo", contractVersion}` sin escribir nada.
- **Riesgos:** ver §4 (CORS/destino Test). Además: la configuración vive **solo en el navegador** (otro teléfono = otra configuración; cambiar de dominio la pierde, como ya dice `nfc-webhook.md`). La maqueta lo declara en el pie («solo este teléfono») y no promete sincronización.
- **Preguntas:** ¿el destino debe poder bloquearse en Producción para usuarios normales y dejar Test/Personalizado solo en modo desarrollador? Hoy cualquiera puede dejar un teléfono en Test.

### 3.4 Lectura de prueba
- **Datos:** `isSecureContext`, `NDEFReader`, UID, serial, tipos NDEF (todo local). **No envía nada.**
- **Existe:** `NfcReadTest` completo (modal `nfc-test-dialog`, límite de 30 s, liberación al ocultar la página). La maqueta solo cambia **dónde** se abre (subvista del modal grande) y conserva el texto «No envía datos».
- **Riesgo:** dos modales apilados (modal NFC → diálogo de lectura). Decisión de plan: reutilizar `NfcReadTest` tal cual, abierto encima, o incrustar su contenido; la maqueta asume incrustado. **Pregunta abierta para el plan** (paso 3).

### 3.5 Tarjetas (lista, empleado, libres)
- **Datos:** por empleado `{employeeId, uid vigente, desde}`; tarjetas libres `{uid, último titular, motivo, última lectura}`; historial `{uid, desde, hasta, motivo_cierre, creado_por}`.
- **Endpoints:** **Backend nuevo** (ya nombrados en el repo ESP32): `listar_tarjetas`, `historial_tarjetas`. **Hoy:** el registro n8n/Sheets solo conoce `(registro, uid) → employeeId`; no tiene historial ni «libre».
- **Faltan:** `nota` al abrir/cerrar una asignación (hoy solo `creado_por`/`cerrado_por`); `ultima_lectura` por tarjeta libre (derivable); **nombres**: el backend solo guarda instantáneas `employee_name/number`; SA debe resolver nombres desde **su** roster (por `employeeId`), nunca confiar en el nombre guardado.
- **Riesgos:** «una tarjeta por empleado» hoy lo hace cumplir el registro con `EMPLEADO_CON_TARJETA`. Mientras convivan Sheets y Supabase, el cliente debe tratar cualquier estado inesperado como error (ya lo hace `readNfcResponse`).
- **Pregunta:** una tarjeta libre que nunca se asoció y aparece en lecturas (`04B0B0B0`) ¿debe poder asociarse **desde su lectura** (sin tocarla con el teléfono)? La maqueta no lo ofrece; es una mejora natural.

### 3.6 Asociar / cambiar / liberar (leer → consultar → confirmar)
- **Datos de la petición:** exactamente el contrato v1 (`consultar` y `asociar`: `schemaVersion, action, requestId, cardUid, employee{id,number,name}, context{companyName,projectId}, source, requestedAt`). Sin cambios.
- **Respuestas ya soportadas** (`readNfcResponse`): `disponible | mismo_empleado | otro_empleado` y `registrada | mismo_empleado`. Se mapean a los tres estados de [#328]: verde (registrada), ámbar con icono informativo (mismo), ámbar con icono de advertencia (otro). **Disponible no es verde:** usa tono informativo y la frase «Todavía no está guardada», para que no parezca confirmación.
- **Acciones nuevas (extensión del contrato v1, propuesta):**
  - `liberar` `{cardUid | employeeId, motivo ∈ perdida|reemplazo|baja|error_registro|otro, nota?}` → `{status:"liberada"}`.
  - `reemplazar` `{employee, cardUidNueva, motivo, nota?}`: cierre + apertura **atómicos**; hoy un empleado con tarjeta recibe `EMPLEADO_CON_TARJETA` (409).
  - `consultar` ampliada con `suggestion` opcional: `{currentHolder: employeeId|null, previousHolders:[{employeeId, until, reason}]}`. **Solo sugerencia, nunca reasignación** (decidido).
- **Idempotencia y reintento:** igual que hoy: `retry` reutiliza `requestId`+body. La maqueta muestra el id corto en el error («Solicitud 7e9b3ff3») para que el soporte pueda correlacionar. Verificado en maqueta: tras «respuesta perdida», **Reintentar** conserva la solicitud y confirma.
- **Faltan:** `status:"liberada"`/códigos de error nuevos; y qué pasa si `liberar` pierde la respuesta (idempotencia por `requestId` también).
- **Riesgos / privacidad:** #328 pide no revelar datos del otro empleado. `otro_empleado` ya devuelve `employeeId`; SA **podría** resolver el nombre localmente. La maqueta **no lo muestra**. **Pregunta:** ¿un administrador debe poder ver quién la tiene, para liberarla? Propuesta: sí, solo en la ficha de tarjetas (donde ya ve a todos), no en el flujo de asociación.
- **Riesgo operativo:** una tarjeta liberada y encontrada por otra persona genera lecturas en el día de otro empleado (caso Ramona). Por eso la lectura nunca se reasigna sola y la pantalla «Sin dueño» muestra la foto y avisa si el elegido ya tiene tarjeta propia.
- **Reemplazo:** el modal muestra «Quedará libre ••1234 → Nueva ••5A6B» y exige un motivo antes de leer (predeterminado «Perdida»).

### 3.7 Lecturas del día (resumen y lista)
- **Datos por fila** (forma de `calcularDia` + estado de revisión): `employeeId, fecha, entrada, salida, rango_min, descuento_almuerzo_min, horas_propuestas, lecturas, alertas[], fotos[], estado, mini{normal,extra}?`. La maqueta usa exactamente esos nombres en `nfc-mock-data.js`.
- **Endpoints (backend nuevo):** `listar_dias_periodo(desde,hasta,obra?)` con correcciones ya aplicadas; `resumen_nfc` para los contadores.
- **Faltan** (heredados de los hallazgos del repo ESP32): `normal/extra`, `comida efectiva` y `redondeo aplicado` no existen en `day_proposals`; no hay estados «consulta a Mini en curso» ni «dejado pendiente»; tampoco **fila para quien no marcó** (no se distingue ausencia de fallo del lector).
- **Riesgos:** (1) El 3 nov de la maqueta tiene 7 días; con 80 empleados la lista móvil necesita paginación y búsqueda. (2) Alertas que dependen de fotos o de Mini no salen de `calcularDia`: ¿quién las calcula? (3) Un empleado que marca en dos lectores (dos obras) mezcla primera/última lectura.
- **Preguntas:** ¿el selector de fecha debe permitir rangos? La maqueta muestra solo «2 nov · 3 nov · Hoy» (el rango queda para la app). ¿Formato de hora 24 h o 12 h? El `<input type="time">` del navegador muestra AM/PM en es-DO, mientras las filas muestran 24 h: **inconsistencia detectada**; decidir una y formatear ambos.

### 3.8 Día, edición y resolución
- **Datos:** lecturas del día (hora, lector, foto), propuesta, historial de correcciones con `estado_correccion`, dueños de Mini disponibles.
- **Endpoints:** `historial_dia`, `registrar_correccion`, `revertir_correccion`, `listar_duenos_mini` (los tres primeros ya nombrados en el repo ESP32).
- **Tipos de corrección que la UI usa y no existen** en `correcciones.cjs`/SQL: `editar_horas` (normal/extra), `jornada_estandar`, `consultar_mini`, `dejar_pendiente`, y quizá `reclasificar_lectura` («la lectura recibida es la salida»; hoy se guardaría como dos ediciones). Existen: `editar_entrada/salida`, `agregar/quitar_almuerzo`, `asignar_empleado`, `verificar`, `rechazar`, `revertir`.
- **Reglas reflejadas en la maqueta:** nota obligatoria al editar (no al verificar); «Guardar edición» deshabilitado con la pista «Escribe una nota para guardar» (§1.2 de `design.md`); la lectura original se conserva; revertir deja el día `pendiente`.
- **Una sola lectura:** alerta ⚠ «Falta salida»; el botón principal pasa a «Resolver este día» (no se calcula nada solo). Opciones: hora faltante, jornada estándar 8 h, pedir al dueño de Mini (verbal / con datos), dejar pendiente (con recordatorio).
- **Riesgos:** «jornada estándar» deja horas **sin entrada/salida** (pérdida de auditoría) y «consultar Mini»/«pendiente» no cambian el estado calculado → sin recordatorio se olvidan. **Pregunta abierta:** ¿se exige siempre una hora de entrada aunque se use la jornada estándar? ¿qué caduca un recordatorio?
- **Redondeo:** el valor mostrado es una **propuesta inventada** (media hora más cercana, extra solo si sobran ≥ 30 min). Está rotulado «Propuesta» y «Decisión abierta» en la UI para que nadie lo tome por hecho.
- **Verificar con fotos «hasta confirmar»:** la maqueta avisa que **se borran** y que revertir no las recupera (riesgo ya anotado por el repo ESP32).

### 3.9 Fotos
- **Datos:** foto de referencia del empleado, fotos por lectura (`ok | missing`), hora, lector, retención, veredicto.
- **Endpoints:** `fotos_dia` (URL firmadas) y `marcar_foto`. **Faltan:** `veredicto`, `revisada_por/en`, `borrada_en`, foto de referencia, bucket y purga.
- **Retención (decidido):** `no_guardar | hasta_confirmar | 30_dias`. La maqueta cubre los tres: con `no_guardar` el visor explica que no hay fotos y enlaza a Reglas; con `hasta_confirmar` avisa que se borran al verificar; con `30_dias` muestra el vencimiento.
- **Riesgos:** privacidad/consentimiento por escrito (pendiente del modelo); cambiar de 30 días a «No guardar» **borra** fotos existentes: se pide confirmación explícita (aviso en Reglas). **Pregunta:** qué cuenta como «confirmada» (§10.2 del diseño). La alerta `sin_foto` debe suprimirse cuando la retención es `no_guardar`.

### 3.10 Sin dueño y sin hora fiable
- **Datos:** `{event_id, uid, leído_en, lector, foto, última titular + motivo}` y lecturas `pendiente_fecha` (`REL:+4812s` en la maqueta).
- **Endpoints:** `listar_lecturas_sin_dueno`, `simular_asignacion`, `registrar_correccion(asignar_empleado)`.
- **Faltan:** «ignorar» por lectura (la corrección está ligada a empleado+día) y una **bandeja propia con contador**: la lectura sin dueño no pertenece a ninguna fila de la lista de días. En la maqueta es una sección con contador en Lecturas.
- **Decidido y respetado:** nunca se reasigna sola; la «sugerencia» (la tuvo X hasta el 29/10) es texto, no acción.
- **Fecha pendiente:** solo se muestra («no se inventa la fecha»); **corregirla a mano es una propuesta** sin diseño de backend.

### 3.11 Entrega a la bandeja
- **Datos:** días `verificado|editado` → un sobre `attendance-submission/v1` **por día** (`workDate`), con `saProjectId`, `scope{ownerUid, siteId, sourceId}`, `deviceId`, `rosterVersion`, `capturedAt` y filas `{miniLocalId, number, name, normalHours, overtimeHours, status}` + `saEmployeeId`. Verificado contra `AttendanceSubmissionInboxStore.js` (claves no listadas se rechazan; `present` exige horas > 0).
- **Endpoint:** `entregar_a_bandeja(desde,hasta)` **(propuesta)**, o el cliente arma el sobre desde `listar_dias_periodo` filtrado. Recomendación: **el backend** arma el sobre (una sola fuente de verdad del cálculo) y SA solo lo valida con `validateAttendanceSubmission` y lo guarda como borrador.
- **Faltan:** mapeo **lector → `saProjectId`** (`devices.sa_project_id` existe pero «obligatorio solo al entregar»); `ownerUid` (relacionado con #327); `sourceId` propio («nfc-esp32»); `miniLocalId` no existe para NFC (¿se usa `employeeId`?).
- **Se respeta:** la bandeja ya distingue Nuevo / No incorporado / Incorporado y exige «Completar importación»; NFC **no escribe asistencia oficial**. La maqueta `bandeja.html` lo muestra como otro borrador más.
- **Riesgo:** entregar dos veces el mismo día. `submissionId` debe ser determinista (`nfc:{obra}:{fecha}:{versión de reglas}`) y el almacén ya detecta repetición con contenido distinto (`AttendanceSubmissionReplayConflictError`). **Pregunta:** si se corrige un día ya entregado, ¿nuevo envío (v2) o bloqueo por cierre de período?

### 3.12 Lectores
- **Datos:** `{id, nombre, sa_project_id, ultima_vez, firmware, tiene eventId, activo(clave), cola, reloj, lecturas hoy}`.
- **Endpoints:** `listar_lectores`, `revocar_lector` **(propuestas)**. **Faltan** en `devices`: `firmware`, `cola_pendiente`, `reloj_estado` (el firmware actual **no envía** versión ni cola). Sin cambios de firmware, solo se puede mostrar `ultima_vez` y `activo`.
- **Seguridad:** la pantalla muestra «Clave activa desde…» y **nunca** hash, huella ni clave. Confirmación antes de revocar. Crear/rotar claves queda fuera de SA (se hace al flashear).
- **Riesgos:** revocar por error deja una obra sin lecturas hasta reflashear. La maqueta exige confirmación y explica la consecuencia. **Pregunta:** ¿se puede reactivar desde SA? (no se ofrece).

### 3.13 Reglas de cálculo
- **Datos:** `umbral_doble_toque_min`(5), `almuerzo_min`(60), `almuerzo_desde_horas`(4), `jornada_horas`(8), `retencion_fotos`, **nuevos:** `redondeo`, `extra_minimo_min` (**abiertos**). Umbrales de jornada corta/larga (4/12 h) son **provisionales** y no aparecen como editables (decisión: no inventar controles).
- **Endpoints:** `leer_ajustes`, `guardar_ajustes` (admin), `simular_dia` opcional. La maqueta calcula el simulador en cliente con la misma función pura que el repo ESP32 (`calc` es una **réplica**, no `calcularDia`: no prueba que coincidan).
- **Faltan:** quién y cuándo cambió cada ajuste (sin historial no se explica un recálculo); la fila `settings` es global: **¿por obra?**
- **Riesgo clave:** cambiar reglas recalcula días **no verificados** en vivo; lo verificado debe guardar una **instantánea** (horas finales + `version_regla`). La maqueta lo declara al pie. El plan debe decidir esto antes de dejar editar reglas.

### 3.14 Casos límite (todos tienen enlace en `index.html`)
| Caso | Cómo se ve | Comprobado |
|---|---|---|
| Sin red | Aviso ámbar; solo lectura; Entregar/Guardar/Asociar deshabilitados; sin cola oculta | ✔ |
| Sin red al asociar | Error «Sin conexión»; la tarjeta leída se conserva | ✔ (flujo) |
| Test no escucha | «Lo más probable: el flujo de prueba no está escuchando…» con la acción de abrir n8n | ✔ |
| SA antigua | Banner «Tu versión de SA es anterior»; solo Conexión y Prueba funcionan | ✔ |
| Sin sesión | Tarjetas y Prueba sí; Lecturas/Lectores/Reglas muestran «Inicia sesión» | ✔ |
| Tarjeta ocupada | Ámbar + advertencia; sin botón de guardar; no nombra al otro | ✔ |
| Mismo empleado | Ámbar + información; «no es necesario volver a guardarla» | ✔ |
| Respuesta perdida | «Puede haberse guardado»; Reintentar con la misma solicitud | ✔ |
| Tarjeta perdida | Se libera (sin estado «bloqueada»); se puede asociar otra; lecturas futuras → «desconocida» | ✔ |
| Reemplazo | «Quedará libre ••1234»; atómico | ✔ |
| Asociación apagada | Entrada visible con chip «Apagada»; en el empleado el bloque se oculta | ✔ |

## 4. Peligro conocido: destino Test por dispositivo y CORS

**Hecho (código real):** `sendNfcRequest` mapea 404 a «El webhook no está disponible. En Test, activa Listen for test event», **pero** cuando n8n no escucha responde 404 **sin cabeceras CORS**. El navegador entonces no entrega la respuesta: `fetch` lanza `TypeError` y el cliente solo puede decir `NETWORK` («No se pudo conectar. Revisa la conexión y los permisos CORS»). **El mensaje `NOT_FOUND` casi nunca se ve en el navegador**, y «sin internet», «CORS mal configurado» y «Test no escucha» son indistinguibles desde SA. Además:
- El destino (`test|production|custom`) vive en `localStorage` de **cada** teléfono y por **dominio**. Un teléfono olvidado en Test hace que las asociaciones fallen «en silencio» (parecen error de red).
- En Test, n8n escucha **una sola ejecución** por «Listen for test event». Consultar y asociar son dos llamadas: puede hacer falta reactivar entre ambas.
- Un `ping` de comprobación **consume** esa escucha única.

**Propuesta para la interfaz (implementada en maqueta):**
1. **Destino siempre visible:** chip `Test`/`Producción` en cada pantalla del flujo y en el subtítulo del modal. En Test el chip es ámbar.
2. **Acción «Comprobar conexión»** en Conexión y prueba. En Producción/Personalizado envía un `ping` sin datos. **En Test cambia el texto** a «Ya activé la escucha · Comprobar» y antes muestra un aviso: «cada llamada gasta la escucha». Así no se gasta sin avisar.
3. **Mensaje honesto:** si `navigator.onLine` es falso → «Sin conexión a internet». Si hay red y falla en Test → «No se pudo conectar con Test. **Lo más probable:** el flujo no está escuchando» + `<details>` «¿Por qué no se sabe la causa exacta?» (explica el 404 sin CORS). Si falla en Producción → «el flujo no responde o no permite este origen».
4. **Mismo mensaje dentro del flujo** de asociación (maqueta: error con acción «Volver a consultar»), no solo en Ajustes.
5. **No lanzar una consulta automática al abrir el modal** (gasta la escucha de Test).

**Del lado del backend (propuesta):** que el workflow de n8n devuelva siempre las cabeceras CORS también en errores 404/5xx del **webhook de producción**, y que Test documente que no puede hacerlo. Aun así SA no debe depender de ello: la UI ya asume «lo más probable».

## 5. Qué existe en SA y qué es nuevo

| Pieza | Existe hoy | Nuevo |
|---|---|---|
| Contrato v1 consultar/asociar, UID, idempotencia, errores | `NfcCore.js` (+ `NfcCore.test.js`) | `ping`, `liberar`, `reemplazar`, `suggestion`, errores nuevos |
| Preferencias locales (`enabled`, `mode`, `customUrl`) | `NfcPreferences.js` | Reglas/ajustes **de cuenta** (otra fuente, no localStorage) |
| Controlador del flujo leer → consultar → guardar | `NfcIntegration.js` (+ test) | Modo «cambiar tarjeta», mostrar sugerencia/historial, banner de estado (#328) |
| Entrada en el editor de empleado | `NfcViews.js → NfcEmployeeEntry` | Estado «con tarjeta ••1234 · ver o cambiar» |
| Diagnóstico de lectura | `NfcReadTest.js`, `css/nfc-test.css` (+ test) | Incrustarlo en el modal |
| Tarjeta de configuración NFC | En Ajustes → Pruebas (`SettingsTestsTab.js`) | Se **muda** al modal; queda un acceso |
| Entrada compacta + modal con subvistas | `SettingsVoiceCard.js`, `VoiceSettingsUI.js`, `css/voice-settings.css` | `SettingsNfcCard.js`, `NfcSettingsUI.js`, vistas, `css/nfc-settings.css` |
| Handler de apertura en Ajustes | `SettingsUI.js` (`open-voice-settings`) | `open-nfc-settings` |
| Bandeja `attendance-submission/v1` | `AttendanceSubmissionInboxStore.js`, `MiniAttendanceImportModal.js`, `AttendanceConsolidation.js` | Fuente «nfc-esp32» + entrega |
| Lecturas, días, fotos, lectores, reglas, correcciones | **Nada** en SA | Cliente autenticado del backend + todas las vistas |

## 6. Riesgos transversales

1. **Dos backends durante la transición:** tarjetas por **n8n/Sheets sin autenticación** (MVP) y lecturas/lectores/reglas por **Supabase con sesión de Firebase**. La UI separa los dos («Destino de tarjetas» vs «Servidor de lecturas») y bloquea solo lo que necesita sesión. Riesgo de que el administrador crea que «Destino: Producción» también afecta a lecturas: la maqueta lo aclara en un banner.
2. **Autenticación:** el MVP promete «sin Firebase». Las secciones nuevas contradicen esa promesa a propósito; hay que decidirlo explícitamente (#326 sigue abierto).
3. **Datos personales y fotos:** fotos de empleados en un teléfono. Solo con URL firmadas y expiración; nada en caché del service worker; consentimiento pendiente.
4. **Rendimiento de la PWA offline-first:** NFC no debe cargar al arrancar. `NfcSettingsUI` se importa de forma diferida al abrir el modal (como Voz); CSS en `index.html` + `sw-precache-manifest.js`.
5. **Contrato:** cualquier cambio en `NfcCore` debe ser aditivo (`schemaVersion` 1). Hoy `readNfcResponse` **ignora campos extra** pero valida `status` contra una lista cerrada: un estado nuevo (p. ej. `liberada`) se rechaza como `INVALID_RESPONSE`. Un cliente antiguo frente a un backend nuevo fallará en las acciones nuevas, no en las v1; por eso la maqueta bloquea con «Tu versión de SA es anterior».
6. **Hora y zona:** `America/Santo_Domingo` por defecto («por confirmar»). La maqueta formatea en local sin zona.
7. **Escalado de la lista móvil:** paginación y búsqueda no están diseñadas (la maqueta tiene 7 filas).
8. **Accesibilidad:** diseñada (iconos + texto, `role=status/alert`, 44 px, `aria-pressed`), **no auditada** (ver §9).

## 7. Preguntas abiertas (consolidadas)

| # | Pregunta | Quién |
|---|---|---|
| 1 | **Redondeo** de rangos a horas de SA y desde cuándo hay extras | Responsable + dueños de Mini |
| 2 | Qué cuenta como asistencia «confirmada» para borrar fotos | Responsable |
| 3 | ¿Reglas por obra o globales? | Responsable |
| 4 | ¿Un administrador ve quién tiene una tarjeta «ocupada» (#328 lo evita en el flujo)? | Responsable |
| 5 | Hora de entrada obligatoria al usar «jornada estándar»; caducidad de recordatorios | Responsable |
| 6 | Mapeo lector → obra (`saProjectId`), `ownerUid` (#327), `miniLocalId` para NFC | Responsable + backend |
| 7 | ¿Corregir un día ya entregado a la bandeja? ¿Cierre de período? | Responsable |
| 8 | Tarjeta nueva `desde`: ¿se puede asignar con fecha anterior? (lecturas pasadas quedarían sin dueño) | Responsable |
| 9 | ¿Fusionar «Entrega» en «Lecturas»? ¿Mostrar el modal NFC siempre o solo para administradores? | Responsable |
| 10 | Formato de hora 12 h / 24 h en toda la UI | Responsable |
| 11 | ¿Se permite reactivar un lector revocado desde SA? | Responsable |
| 12 | Migración: escritura doble Sheets+Supabase y fecha de apagado | Backend |

## 8. Hallazgos de la propia maqueta (errores corregidos durante el trabajo)

- La etiqueta del ejemplo de redondeo estaba mal (07:00→15:50 son **8 h 50**, no 7 h 50; con 1 h de comida da 7,83 h). Se corrigió y la prueba automática lo comprueba (`7,83`).
- Un `soft render` solo parcheaba regiones: los presets y las opciones de resolución no cambiaban de estado visual hasta que la prueba lo detectó. Se separó «render parcial» (solo al teclear) de «render completo con scroll conservado» (clics). Es la misma regla que `design.md` §4.1 llama `_noAnim`: **clics = re-render completo sin animación; teclear = parche local**.
- La navegación con enlace directo en escritorio dejaba la pila vacía al guardar un día; se corrigió con una única función `toLecturas()`.

## 9. Qué se verificó realmente y qué no

**Verificado** con `node docs/maquetas-nfc-sa/verify-nfc-mock.cjs` (Playwright, Chromium sin interfaz), **105/105 correctas**:
- 320, 390 y 1280 px: las 5 páginas y 20 enlaces directos del modal cargan **sin errores de JS, sin peticiones de red** (solo `file:`), **sin desbordamiento horizontal** y con controles ≥ 36 px; además 8 casos límite a 320 px.
- Interacciones a 390 y 1280 px: apertura desde Ajustes y cierre con Escape; asociación libre → disponible (tono informativo, no verde) → guardar → verde; «mismo empleado» y «otro empleado» (ámbar, sin botón de guardar, sin nombrar al otro); sugerencia con historial; respuesta perdida + reintento con la misma solicitud; Test sin escucha (en el flujo y en «Comprobar conexión»); sin red; versión antigua; sin sesión; liberar y volver a asociar; reemplazo; edición de un día (nota obligatoria, selector de comida, guardar como Editado); verificar con borrado de fotos; resolver un solo dato (Mini y jornada estándar); lecturas sin dueño; revocar clave sin mostrar secretos; reglas (simulador y guardar); entrega; fotos y veredicto; barra lateral en escritorio y 6 tarjetas en móvil.
- Revisión visual de capturas a 320, 390 y 1280 px (se corrigieron fuentes y tamaños de iconos encontrados así).

**No verificado / límites:**
- No se probó en un teléfono real, ni Web NFC, ni n8n, ni Supabase: todo es simulado. El comportamiento CORS descrito en §4 viene del código y de la documentación del repo, **no se reprodujo**.
- Sin auditoría de accesibilidad automática (axe) ni lector de pantalla; contrastes de los chips no medidos.
- La página «Ajustes» y el marco del editor son aproximaciones; solo la entrada NFC y `.employee-nfc-entry` usan CSS real.
- La función `calc` de la maqueta es una réplica del cálculo, no `calcularDia`.
- `nfc-mock-data.js` no se contrastó contra la base de datos real del repo ESP32 más allá de nombres de campos.

**Sin cambios de comportamiento en producción:** el código del producto no se tocó. Única excepción, automática: el hook `pre-commit` del repo (`.githooks/pre-commit`) trata los `.html/.js/.css` nuevos bajo `docs/` como «assets web» y **sella** `CACHE_VERSION` en `sw.js` y `BUILD` en `js/modules/config/BuildInfo.js` (una línea cada uno, solo una marca de fecha). No se usó `--no-verify`. Si se prefiere un PR solo de documentación, esas dos líneas se pueden descartar al fusionar. Antes y después de crear las maquetas se ejecutaron las pruebas existentes: `npx jest --runInBand js/tests/NfcCore.test.js js/tests/NfcIntegration.test.js js/tests/NfcReadTest.test.js js/tests/SettingsVoiceCard.test.js js/tests/VoiceSettingsUI.test.js` → **5 suites, 94 pruebas, todas correctas** (antes y después) y `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:nfc-read` → correcta (antes y después). `git status` solo muestra la carpeta nueva.

[#328]: https://github.com/ERCamilo/-Sistema-de-asistencia/issues/328
