/**
 * 🧪 AttendanceSyncErrorTests (Auditoría 2026-06-09, hallazgo H6)
 *
 * saveDailyAttendance() atrapaba sus propios errores y solo hacía
 * console.error — el `.catch(e => _notifySyncError(e))` del caller en
 * PersistenceService era código muerto. La asistencia (el dominio core)
 * podía fallar en sincronizar durante días con el badge en "Sincronizado".
 *
 * Contrato: saveDailyAttendance debe RE-LANZAR el error tras loggearlo.
 *
 * U7: el caller directo (.catch inline en _executeSave) se reemplazó por el
 * outbox — ahora es MainSyncStore.flush quien atrapa el error de CUALQUIER
 * kind (mirror/daily/delete) y lo reenvía a _notifySyncError vía el guard
 * onCloudResult (ver _mainSyncGuards en PersistenceService.js). El contrato
 * "un fallo de sync SIEMPRE llega a _notifySyncError" se mantiene, sólo
 * cambió el mecanismo (try/catch centralizado en vez de un .catch por sitio).
 */

import fs from 'fs';
import path from 'path';

const FIREBASE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);
const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

testRunner.addSuite("FirebaseService — saveDailyAttendance propaga errores (H6)", {

    "saveDailyAttendance re-lanza el error en su catch"() {
        const block = FIREBASE_SRC.match(/async\s+saveDailyAttendance\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'saveDailyAttendance debe existir');
        const catchBlock = block[0].match(/catch\s*\([\s\S]*$/);
        testRunner.assert(!!catchBlock, 'saveDailyAttendance debe tener catch');
        testRunner.assert(
            /throw\s+(error|e)\b/.test(catchBlock[0]),
            'el catch debe re-lanzar (throw) para que el caller notifique al usuario vía _notifySyncError'
        );
    },

    "el guard onCloudResult (usado por MainSyncStore.flush) notifica CUALQUIER fallo vía _notifySyncError (U7)"() {
        // 1400 y no 900: el guard creció con el estampado de EntitiesSyncStamp
        // (Fase 2 U4) y _notifySyncError quedaba fuera de la ventana vieja.
        const block = PERSISTENCE_SRC.match(/onCloudResult\s*:\s*\([\s\S]{0,1400}/);
        testRunner.assert(!!block,
            'debe existir el guard onCloudResult en _mainSyncGuards (U7 — reemplaza el .catch directo de saveDailyAttendance)');
        testRunner.assert(
            /_notifySyncError\s*\(/.test(block[0]),
            'onCloudResult debe notificar el error vía _notifySyncError para CUALQUIER kind (mirror/daily/delete), no sólo el mirror'
        );
    }

});
