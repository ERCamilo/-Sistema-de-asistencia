/**
 * 🧪 SaveAnnounceWiringTests
 *
 * Extiende el toast HONESTO de guardado (SaveOutcomeNotifier) a las acciones
 * que el usuario pidió: marcar presente, agregar empleado/líder/puesto,
 * préstamos y caja chica.
 *
 * Dos rutas de persistencia:
 *  - saveApplicationData({announce}) → asistencia, préstamos, modales de
 *    empleado/líder/puesto (vía contrato de fuente: los toasts inmediatos
 *    "✅ ..." se reemplazan por announce).
 *  - PettyCashStore.save/remove(col, item, {announce}) → caja chica, que
 *    persiste por outbox: local OK al instante + resultado de nube cuando el
 *    flush drena (behavioral, store real + mocks globales).
 */

import fs from 'fs';
import path from 'path';
import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import { saveOutcomeNotifier } from '../modules/services/SaveOutcomeNotifier.js';
import indexedDBService from '../modules/services/IndexedDBService.js'; // → mock global
import { auth, setDoc, deleteDoc } from '../modules/data/firebase.js';  // → mock global

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const APP_SRC = read('../app.js');
const LOANS_SRC = read('../modules/features/loans/LoansController.js');
const EMP_MODAL_SRC = read('../modules/ui/modals/EmployeeModal.js');
const LEADER_MODAL_SRC = read('../modules/ui/modals/LeaderModal.js');
const POS_MODAL_SRC = read('../modules/ui/modals/PositionModal.js');
const PC_UI_SRC = read('../modules/features/pettycash/PettyCashUI.js');
const PC_STORE_SRC = read('../modules/features/pettycash/PettyCashStore.js');

function resetMocks() {
    auth.currentUser = { uid: 'test-uid' };
    indexedDBService.getAll.mockReset().mockResolvedValue([]);
    indexedDBService.update.mockReset().mockResolvedValue(1);
    indexedDBService.delete.mockReset().mockResolvedValue(undefined);
    setDoc.mockReset().mockResolvedValue(undefined);
    deleteDoc.mockReset().mockResolvedValue(undefined);
}

// ─── Caja chica (behavioral) ─────────────────────────────────────────────────

testRunner.addSuite("Caja chica — announce honesto vía PettyCashStore", {

    async "save(col, item, {announce}) reporta el resultado local al notifier"() {
        resetMocks();
        const spy = jest.spyOn(saveOutcomeNotifier, 'recordLocalResult').mockImplementation(() => {});
        try {
            await PettyCashStore.save('movements', { id: 'm1', amount: 50 }, { announce: 'Gasto guardado' });
            testRunner.assert(spy.mock.calls.length >= 1, 'debe reportar el guardado local');
            const arg = spy.mock.calls[0][0];
            testRunner.assertEquals(arg.localOk, true, 'local OK');
            testRunner.assertEquals(arg.cloudExpected, true, 'con sesión activa la nube se espera');
            testRunner.assertEquals(arg.label, 'Gasto guardado', 'conserva la etiqueta');
        } finally { spy.mockRestore(); }
    },

    async "save() SIN announce no toca el notifier (cero ruido en re-saves internos)"() {
        resetMocks();
        const spy = jest.spyOn(saveOutcomeNotifier, 'recordLocalResult').mockImplementation(() => {});
        try {
            await PettyCashStore.save('movements', { id: 'm2', amount: 10 });
            testRunner.assertEquals(spy.mock.calls.length, 0, 'sin announce no hay reporte');
        } finally { spy.mockRestore(); }
    },

    async "sin sesión, announce reporta cloudExpected=false (verde local honesto)"() {
        resetMocks();
        auth.currentUser = null;
        const spy = jest.spyOn(saveOutcomeNotifier, 'recordLocalResult').mockImplementation(() => {});
        try {
            await PettyCashStore.save('movements', { id: 'm3' }, { announce: 'Gasto guardado' });
            testRunner.assert(spy.mock.calls.length >= 1, 'debe reportar');
            testRunner.assertEquals(spy.mock.calls[0][0].cloudExpected, false,
                'sin sesión no se promete nube');
        } finally { spy.mockRestore(); }
    },

    async "flush exitoso reporta recordCloudResult(true)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            { key: 1, op: 'save', col: 'movements', id: 'm1', data: { id: 'm1' }, ts: 1, status: 'pending' }
        ]);
        const spy = jest.spyOn(saveOutcomeNotifier, 'recordCloudResult').mockImplementation(() => {});
        try {
            await PettyCashStore.flush();
            testRunner.assert(spy.mock.calls.some(c => c[0] === true),
                'el drenado exitoso debe reportar nube OK');
        } finally { spy.mockRestore(); }
    },

    async "flush con fallo reporta recordCloudResult(false) (amarillo honesto)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            { key: 1, op: 'save', col: 'movements', id: 'm1', data: { id: 'm1' }, ts: 1, status: 'pending' }
        ]);
        setDoc.mockRejectedValue(new Error('offline'));
        const spy = jest.spyOn(saveOutcomeNotifier, 'recordCloudResult').mockImplementation(() => {});
        try {
            await PettyCashStore.flush();
            testRunner.assert(spy.mock.calls.some(c => c[0] === false),
                'el fallo de drenado debe reportar nube FALLÓ');
        } finally { spy.mockRestore(); }
    },

    "remove() acepta announce (borrados también anuncian)"() {
        testRunner.assert(/async remove\(col, id, opts = \{\}\)/.test(PC_STORE_SRC),
            'remove debe aceptar opts.announce');
    },

    "PettyCashUI anuncia las acciones principales del usuario"() {
        testRunner.assert(/saveProject\(p,\s*'Proyecto creado'\)/.test(PC_UI_SRC), 'crear proyecto');
        testRunner.assert(/savePeriod\(per,\s*'Periodo creado'\)/.test(PC_UI_SRC), 'crear periodo');
        testRunner.assert(/saveMovement\(mov,\s*(mov\.type === 'gasto' \? )?'(Gasto|Movimiento) guardado'/.test(PC_UI_SRC), 'guardar movimiento');
        testRunner.assert(/saveMovement\(mov,\s*'Movimiento actualizado'\)/.test(PC_UI_SRC), 'editar movimiento');
        testRunner.assert(/removeMovementDoc\(movId,\s*'Movimiento eliminado'\)/.test(PC_UI_SRC), 'eliminar movimiento');
        testRunner.assert(/savePeriod\(period,\s*'Periodo cerrado'\)/.test(PC_UI_SRC), 'cerrar periodo');
    }

});

// ─── Préstamos (contrato de fuente) ──────────────────────────────────────────

testRunner.addSuite("Préstamos — announce honesto en LoansController", {

    "registrar préstamo anuncia vía announce (no toast inmediato)"() {
        testRunner.assert(/announce:\s*`Préstamo registrado/.test(LOANS_SRC),
            'submitNewLoan debe pasar announce');
        testRunner.assert(!/notify\(`✅ Préstamo registrado/.test(LOANS_SRC),
            'el toast inmediato (mentiroso) debe eliminarse');
    },

    "abono, saldar y refinanciar anuncian vía announce"() {
        testRunner.assert(/announce:\s*`Abono registrado/.test(LOANS_SRC), 'abono');
        testRunner.assert(/announce:\s*'Préstamo saldado'/.test(LOANS_SRC), 'saldado');
        testRunner.assert(/announce:\s*`Préstamo refinanciado/.test(LOANS_SRC), 'refinanciado');
        testRunner.assert(!/notify\(`✅ Abono registrado/.test(LOANS_SRC), 'sin toast inmediato de abono');
        testRunner.assert(!/notify\('✅ Préstamo saldado'/.test(LOANS_SRC), 'sin toast inmediato de saldado');
    },

    "anular/reactivar también anuncian el resultado real"() {
        testRunner.assert(/announce:\s*'Préstamo anulado'/.test(LOANS_SRC), 'anulado');
        testRunner.assert(/announce:\s*'Préstamo reactivado'/.test(LOANS_SRC), 'reactivado');
        testRunner.assert(/announce:\s*'Abono anulado'/.test(LOANS_SRC), 'abono anulado');
    }

});

// ─── Asistencia + entidades (contrato de fuente) ─────────────────────────────

testRunner.addSuite("Asistencia y entidades — announce honesto", {

    "marcar presente anuncia con el nombre del empleado"() {
        testRunner.assert(/announce:\s*_attendanceAnnounce/.test(APP_SRC),
            'toggleAttendance debe pasar el label al guardado');
        testRunner.assert(!/showNotification\(`✅ \$\{emp\.name\} - \$\{dayHours\}h como/.test(APP_SRC),
            'el toast inmediato de presente debe eliminarse');
    },

    "cambiar posición (día y semana) anuncia vía announce"() {
        testRunner.assert(/announce:\s*`Cambiado a \$\{posName\}`/.test(APP_SRC), 'togglePosition');
        testRunner.assert(/announce:\s*'Posición actualizada'/.test(APP_SRC), 'toggleWeekPosition');
        testRunner.assert(!/showNotification\('✅ Posición actualizada'/.test(APP_SRC),
            'sin toast inmediato en semana');
    },

    "modales de empleado/líder/puesto anuncian al guardar"() {
        testRunner.assert(/saveToLocalStorage\(\s*\{?\s*(announce|label)/.test(EMP_MODAL_SRC) ||
            /saveToLocalStorage\(label \? \{ announce: label \} : undefined\)/.test(EMP_MODAL_SRC),
            'EmployeeModal.finish debe pasar announce');
        testRunner.assert(/\{ announce \}|announce:/.test(LEADER_MODAL_SRC), 'LeaderModal debe pasar announce');
        testRunner.assert(/\{ announce \}|announce:/.test(POS_MODAL_SRC), 'PositionModal debe pasar announce');
        testRunner.assert(!/showAlert\(`\$\{icons\.get\('check-circle'\)\} Líder creado/.test(LEADER_MODAL_SRC),
            'LeaderModal sin toast inmediato de éxito');
        testRunner.assert(!/showAlert\(`\$\{icons\.get\('check-circle'\)\} Posición "\$\{name\}" creada/.test(POS_MODAL_SRC),
            'PositionModal sin toast inmediato de éxito');
    }

});
