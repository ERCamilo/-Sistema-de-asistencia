/**
 * 🧪 AttendanceSyncErrorTests (Auditoría 2026-06-09, hallazgo H6)
 *
 * saveDailyAttendance() atrapaba sus propios errores y solo hacía
 * console.error — el `.catch(e => _notifySyncError(e))` del caller en
 * PersistenceService era código muerto. La asistencia (el dominio core)
 * podía fallar en sincronizar durante días con el badge en "Sincronizado".
 *
 * Contrato: saveDailyAttendance debe RE-LANZAR el error tras loggearlo,
 * y los callers deben mantener su .catch.
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

    "el caller en PersistenceService mantiene .catch con _notifySyncError"() {
        testRunner.assert(
            /saveDailyAttendance\([\s\S]{0,200}?\.catch\([\s\S]{0,200}?_notifySyncError/.test(PERSISTENCE_SRC),
            'PersistenceService debe capturar el error de saveDailyAttendance y notificar al usuario'
        );
    }

});
