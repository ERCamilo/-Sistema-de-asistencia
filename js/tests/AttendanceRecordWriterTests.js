/**
 * 🧪 AttendanceRecordWriterTests (Fase 1 — Portero por-registro, U1b)
 *
 * El choke point de estampado local. Contrato: estampa updatedAt fresco,
 * preserva todo lo demás, es puro (no muta el original), y NO se debe usar
 * para escrituras entrantes (documentado, no forzable por código).
 */

import { stampAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';

testRunner.addSuite("AttendanceRecordWriter — stampAttendanceWrite (Fase 1, U1b)", {

    "estampa updatedAt con el now inyectado"() {
        const out = stampAttendanceWrite({ employeeId: 'e1', present: true }, 12345);
        testRunner.assertEquals(out.updatedAt, 12345, 'debe estampar el now provisto');
    },

    "usa Date.now() cuando no se inyecta now"() {
        const before = Date.now();
        const out = stampAttendanceWrite({ employeeId: 'e1' });
        const after = Date.now();
        testRunner.assert(out.updatedAt >= before && out.updatedAt <= after,
            'sin now explícito debe usar Date.now()');
    },

    "preserva todos los demás campos del registro"() {
        const rec = { employeeId: 'e1', date: '2026-07-01', present: true, hoursWorked: 8, notes: 'x', positionHours: [{ positionId: 'p1', hours: 8 }] };
        const out = stampAttendanceWrite(rec, 1);
        testRunner.assertEquals(out.employeeId, 'e1');
        testRunner.assertEquals(out.hoursWorked, 8);
        testRunner.assertEquals(out.notes, 'x');
        testRunner.assertEquals(out.positionHours[0].positionId, 'p1');
    },

    "sobrescribe un updatedAt viejo con el nuevo (una escritura local ES más nueva)"() {
        const out = stampAttendanceWrite({ employeeId: 'e1', updatedAt: 100 }, 999);
        testRunner.assertEquals(out.updatedAt, 999, 'la escritura local pisa el updatedAt anterior');
    },

    "es pura: no muta el registro original"() {
        const rec = { employeeId: 'e1', updatedAt: 100 };
        stampAttendanceWrite(rec, 999);
        testRunner.assertEquals(rec.updatedAt, 100, 'el original no debe mutarse');
    },

    "preserva deletedAt si el caller lo trae (passthrough — tombstones son U2)"() {
        const out = stampAttendanceWrite({ employeeId: 'e1', deletedAt: 555 }, 999);
        testRunner.assertEquals(out.deletedAt, 555, 'no toca deletedAt — sólo estampa updatedAt');
    }

});

// ─── Contrato de ruteo: todas las escrituras locales pasan por el choke point ──

const fs = require('fs');
const path = require('path');
const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("AttendanceRecordWriter — contrato de ruteo en app.js (Fase 1, U1b)", {

    "toda escritura local state.attendance[key] = X pasa por stampAttendanceWrite (o es delete)"() {
        // La guardia que le da valor al choke point: si un sitio nuevo escribe
        // un registro sin rutearlo, este test lo caza antes de que reintroduzca
        // el bug del portero (registro sin updatedAt → pierde en el merge U3).
        const lines = APP_SRC.split('\n');
        const offenders = [];
        lines.forEach((line, i) => {
            // Asignación por-CLAVE (no el merge entrante `state.attendance = {...}`).
            if (!/state\.attendance\[[^\]]+\]\s*=/.test(line)) return;
            if (/state\.attendance\[[^\]]+\]\s*=\s*=/.test(line)) return; // comparación, no asignación
            if (/delete\s+state\.attendance\[/.test(line)) return;       // borrado (U2)
            if (/stampAttendanceWrite\s*\(/.test(line)) return;          // ruteado ✅
            offenders.push(`app.js:${i + 1}: ${line.trim()}`);
        });
        testRunner.assertEquals(offenders.length, 0,
            'escrituras locales de asistencia sin rutear por el choke point:\n  ' + offenders.join('\n  '));
    },

    "el merge ENTRANTE (state.attendance = {...}) NO se estampa — conserva el updatedAt de la nube"() {
        // Los 3 sitios de merge zonal/mirror reciben registros de otro
        // dispositivo con su propio updatedAt; re-estamparlos con `now`
        // destruiría la frescura que el merge LWW (U3) necesita comparar.
        const mergeLines = APP_SRC.split('\n').filter(l => /state\.attendance\s*=\s*\{\s*\.\.\.state\.attendance/.test(l));
        testRunner.assert(mergeLines.length >= 3, 'deben existir los sitios de merge entrante (spread)');
        mergeLines.forEach(l => {
            testRunner.assert(!/stampAttendanceWrite/.test(l),
                'el merge entrante NO debe estampar — el timestamp de la nube manda para el LWW');
        });
    }

});

console.log('🧪 AttendanceRecordWriter tests cargados.');
