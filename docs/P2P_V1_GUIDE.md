# Guía de Transporte y Hardening P2P v1 (F3.P2P-4)

Esta guía documenta la arquitectura de transporte punto a punto (P2P) v1 entre el **Sistema de Asistencia (SA)** y **Mini**, cubriendo la matriz de transporte, flujos de usuario, superficies deshabilitadas, garantías de staging sin autoescritura, matriz de restauración, límites de entorno y estado de verificación física.

---

## 1. Matriz de Transporte v1

| Carga / Superficie | Canal WebRTC | Protocolo | Schema | Dirección | Framing y Chunks | Integridad | Límite Duro |
|---|---|---|---|---|---|---|---|
| **Personal (Roster)** | DataChannel | `contrutek-p2p-transfer/v1` | `sa-roster/v1` | SA → Mini | Chunks 12 KiB (uint32 BE + payload) | SHA-256 exacto byte-a-byte | 5 MiB |
| **Asistencia** | DataChannel | `contrutek-p2p-control/v1` | `attendance-submission/v1` | Mini → SA | Solicitud/Respuesta autenticada | Procedencia metadatos + SHA-256 | Bounded por rango |
| **Respaldo Same-App** | DataChannel | `contrutek-p2p-transfer/v1` | `sa-backup/v1` | SA ↔ SA | Chunks 12 KiB (uint32 BE + payload) | SHA-256 exacto byte-a-byte | 25 MiB |
| **Respaldo Cross-App** | DataChannel | `contrutek-p2p-transfer/v1` | `mini-backup/v1` | Mini → SA | Chunks 12 KiB (uint32 BE + payload) | SHA-256 exacto byte-a-byte | 25 MiB |
| **Archivos / Documentos** | *Ninguno* | *Ninguno* | *Ninguno* | *Deshabilitado* | Fuera de alcance (fail-closed) | N/A | 0 Bytes |

---

## 2. Flujos de Usuario (User Flows)

### Flujo 1: Emparejamiento (Pairing) SA ↔ Mini
1. **Inicio**: El usuario abre el modal P2P y pulsa `Vincular Mini`. Requiere compuerta de proyecto activo (`projectState.ready`).
2. **Intercambio**: Se genera descriptor temporal con token efímero, expuesto mediante código numérico de 6 dígitos y código QR.
3. **Confirmación SAS**: Ambos dispositivos establecen conexión por señalización efímera y verifican una clave SAS alfanumérica de 4 caracteres.
4. **Almacenamiento**: Se guarda el vínculo con `linkToken` derivado criptográficamente en el almacén de identidades local.

### Flujo 2: Envío de Roster (SA → Mini)
1. **Compuerta de proyecto**: SA verifica que exista un proyecto oficial activo antes de habilitar el botón `Enviar roster`.
2. **Opciones**: Se ofrece opción para incluir o excluir sueldos (`includeSalary`).
3. **Transferencia**: Se envían tramas `start` → chunks de 12 KiB → `end`.
4. **Validación**: Mini verifica el hash SHA-256, almacena en borrador efímero y responde con ACK `roster-staged`.

### Flujo 3: Transferencia de Asistencia (Mini → SA)
1. **Entrada**: El operador de SA abre el importador de asistencia y selecciona el modo `Conectados`.
2. **Consulta**: Se solicita asistencia a Minis vinculados activos para el rango de fechas de trabajo especificado.
3. **Bandeja de entrada (Inbox)**: Los envíos recibidos se colocan en `AttendanceSubmissionInboxStore` con procedencia (`sourcePeerId`, `sourcePeerName`).
4. **Revisión y Conciliación**: El usuario revisa conflictos, confirma asignaciones y pulsa explícitamente `Aplicar asistencia` para persistir en registros oficiales.

### Flujo 4: Respaldo Same-App (SA ↔ SA)
1. **Vínculo dedicado**: Se vinculan dos instancias de SA mediante `Vincular SA para respaldo` con opt-in explícito `allowSameApp: true` y propósito `backup`.
2. **Transferencia**: Se envía el respaldo nativo codificado en UTF-8 con hash SHA-256 verificado.
3. **Staging**: Queda en memoria temporal en `P2PBackupBridge` (máximo 3 pendientes en total).
4. **Revisión y Restauración**: El usuario pulsa `Revisar y restaurar`. Se delega canónicamente a `window.loadBackupFromFile`, ejecutando el preflight nativo de SA y el modal de comparación `RestoreUI.showComparisonModal`. Solo tras confirmación explícita se aplica `applyBackupData`.

### Flujo 5: Respaldo Cross-App (Mini → SA)
1. **Recepción**: Un Mini vinculado transfiere su respaldo nativo a SA (`mini-backup/v1`).
2. **Staging**: Se conserva en memoria como descarga pendiente.
3. **Descarga**: La única acción disponible es `Descargar archivo`, generando localmente el archivo seguro `backup-mini-YYYY-MM-DD-<hash>.json`. Nunca se restaura en SA.

---

## 3. Superficies Deshabilitadas y Hardening Fail-Closed

* **Archivos / Documentos genéricos**: Fuera de alcance (OUT OF SCOPE).
  * En la interfaz de usuario, la tarjeta `Archivos` es estrictamente visual, renderizada con estado atenuado (`is-disabled`), atributo `aria-disabled="true"`, sin etiqueta de botón ni enlace, sin selector de archivos (`input[type="file"]`) y sin escuchador de eventos interactivo.
  * En la capa de transporte, `validateTransferStart` y `sendPayload` rechazan de forma fail-closed cualquier tipo de transferencia que no sea `roster` o `backup` (`files`, `documents`, `photo`, `pdf`, `bin`, `binary`, `generic`, etc.). Ante un intento de inicio no autorizado, el receptor revoca inmediatamente el canal WebRTC y limpia cualquier estado en vuelo sin almacenar datos.
* **Cero compartición de archivos genéricos**: No se admite transferencia de imágenes, fotografías, binarios ni documentos de oficina.
* **Sin auto-escritura ni auto-importación**: La recepción de paquetes de red jamás muta por sí sola el estado autoritativo ni la base de datos IndexedDB.
* **Sin persistencia en señalización**: El servidor de señalización actúa exclusivamente como broker efímero de intercambio SDP/ICE; no almacena cuerpos de datos ni metadatos de usuario.

---

## 4. Staging Efímero y Cero Escrituras Durables

* **Principio rector**: *Recepción ≠ Importación*.
* **Almacenamiento en memoria**: Los respaldos recibidos por P2P residen exclusivamente en una estructura volátil en memoria RAM dentro de `P2PBackupBridge`. No se crean almacenes de objetos (stores) nuevos ni se modifica la versión de esquema de IndexedDB.
* **Tope de capacidad duro**: Máximo **3 respaldos pendientes en total** en el receptor.
* **Deduplicación previa**: Todo respaldo entrante se comprueba por `transferId` y por huella SHA-256 *antes* de evaluar la capacidad. Si el respaldo ya existe en staging, se reconoce sin consumir una ranura adicional.
* **Tolerancia a fallos**: Si la transferencia se interrumpe, se corrompe un chunk o no coincide el hash SHA-256, el agregador en vuelo se descarta de inmediato, revocando el canal y dejando cero mutaciones durables en el cliente.
* **Ciclo de vida**: El registro en staging se descarta explícitamente mediante el botón `Descartar`, al recargar la aplicación o una vez confirmada con éxito la restauración canónica.

---

## 5. Matriz de Restauración

| Origen → Destino | Esquema | Acción Permitida en UI | Ruta de Ejecución | Confirmación Requerida |
|---|---|---|---|---|
| **SA → SA** | `sa-backup/v1` | Revisar y restaurar | `window.loadBackupFromFile` → `RestoreUI.showComparisonModal` → `applyBackupData` | **Sí (doble confirmación explícita)** |
| **Mini → SA** | `mini-backup/v1` | Descargar archivo | `p2pBackupBridge.downloadCrossAppBackup` (descarga local intacta) | No (descarga de archivo no destructiva) |
| **SA → Mini** | `sa-backup/v1` | Guardar / Descargar | Descarga local en Mini; prohibido importar | N/A |
| **Mini → Mini** | `mini-backup/v1` | Revisar y restaurar | Flujo nativo de Mini (`modal-restore-backup` / `doRestoreBackup`) | **Sí (confirmación nativa en Mini)** |

---

## 6. Límites Conocidos de Navegador y PWA

1. **Suspensión de pestañas en segundo plano (Background Throttling)**:
   * En navegadores móviles (iOS Safari, Android Chrome), cuando la pestaña pasa a segundo plano o la pantalla se bloquea, el sistema operativo suspende la ejecución de JavaScript y congela los canales WebRTC DataChannel.
   * *Mitigación / Regla*: Las transferencias P2P activas deben completarse con la aplicación visible en primer plano.
2. **Límites de memoria del canal de datos (DataChannel Buffer)**:
   * Los búferes de transporte WebRTC operan en memoria del navegador. Para evitar el colapso del proceso de renderizado (OOM crash) en dispositivos móviles con recursos limitados, se impone un tope máximo estricto de **25 MiB** para respaldos y **5 MiB** para nómina de personal.
3. **Aislamiento de almacenamiento y permisos de archivo**:
   * Las aplicaciones web progresivas (PWA) no poseen acceso directo de bajo nivel al sistema de archivos local. La acción de descarga cross-app delega en la API estándar de descargas del navegador (`URL.createObjectURL` sobre `Blob`), garantizando nombres de archivo sanitizados sin caracteres de control.
4. **Topología de red y NAT/Firewall**:
   * WebRTC requiere descubrimiento de candidatos ICE. En redes corporativas con cortafuegos simétricos o aislamiento de clientes Wi-Fi (client isolation), el establecimiento del DataChannel puede requerir infraestructura de retransmisión TURN si no hay ruta directa P2P disponible.

---

## 7. E2E Físico Diferido — No Pasado (Physical Testing Deferred)

* **Alcance de la suite automatizada**:
  * La totalidad de las pruebas unitarias y de integración de software (`P2PCoreTests`, `P2PPairing`, `P2PRosterUI`, `P2PBackupTransportTests`, `P2PHardeningV1Tests`, `P2PAttendanceBridgeTests`, `P2PPresenceTests`) ejecutan con éxito mediante emulación WebRTC y paso de mensajes en memoria.
* **Estado de la certificación física**:
  * Las pruebas físicas de campo extremo a extremo (E2E) entre hardware físico heterogéneo (teléfonos móviles y computadoras portátiles reales en redes celulares 4G/5G y Wi-Fi de faena) están **diferidas** para la fase de pruebas de campo en obra.
  * **No se certifican como "PASSED" en esta etapa de código**; se catalogan explícitamente como pendientes de validación en hardware real con usuarios finales.

---

## 8. Fallbacks Manuales Intactos

El subsistema P2P es estrictamente suplementario (0% non-weighted). Los mecanismos manuales y de contingencia permanecen 100% funcionales y accesibles:
* **Exportación manual de personal**: Exportación de roster a portapapeles para WhatsApp / Mini (`shareExportMiniV1`) desde el menú contextual.
* **Pegado manual de asistencia**: Pestaña `Pegar texto` en el importador de asistencia para pegar directamente el reporte generado por Mini.
* **Exportación e importación nativa de respaldos**: Funcionalidad de descarga de archivo JSON y carga de respaldo desde Ajustes > Datos (`window.exportData` y `window.loadBackupFromFile`).
