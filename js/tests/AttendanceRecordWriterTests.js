/**
 * 🧪 AttendanceRecordWriterTests (Fase 1 — Portero por-registro, U1b)
 *
 * El choke point de estampado local. Contrato: estampa updatedAt fresco,
 * preserva todo lo demás, es puro (no muta el original), y NO se debe usar
 * para escrituras entrantes (documentado, no forzable por código).
 */

import { stampAttendanceWrite, tombstoneAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';

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
            // Asignación por-CLAVE (no el merge entrante `state.attendance = {...}`)
            // O un delete por-clave — desde U2b un delete suelto es justamente lo
            // que este test debe cazar (antes de U2b este filtro de entrada exigía
            // un '=' literal y por eso nunca veía un `delete` puro: el test
            // "protegía" contra deletes sin rutear pero nunca podía dar rojo).
            const isAssignment = /state\.attendance\[[^\]]+\]\s*=/.test(line);
            const isDelete = /delete\s+state\.attendance\[/.test(line);
            if (!isAssignment && !isDelete) return;
            if (/state\.attendance\[[^\]]+\]\s*=\s*=/.test(line)) return; // comparación, no asignación
            if (/delete\s+state\.attendance\[shortKey\]/.test(line)) return; // limpieza de claves malformadas (bare employeeId), no un unmark de usuario
            if (/(?:stamp|tombstone)AttendanceWrite\s*\(/.test(line)) return; // ruteado ✅
            offenders.push(`app.js:${i + 1}: ${line.trim()}`);
        });
        testRunner.assertEquals(offenders.length, 0,
            'escrituras locales de asistencia sin rutear por el choke point:\n  ' + offenders.join('\n  '));
    },

    "el merge ENTRANTE pasa por mergeAttendanceRecords (Fase 1 U3) — ya no hay spread ciego"() {
        // Los 3 sitios de merge zonal/mirror recibían registros de otro
        // dispositivo con un spread ciego (`{...local, ...incoming}`) que no
        // comparaba frescura. U3 los ruteó por mergeAttendanceRecords (LWW
        // puro, en AttendanceMerge.js) — acá solo verificamos que NINGUNO
        // quedó como spread ciego crudo, y que ninguno re-estampa con
        // stamp/tombstoneAttendanceWrite (destruiría el updatedAt de la nube
        // que el merge necesita comparar).
        const blindSpreadLines = APP_SRC.split('\n').filter(l => /state\.attendance\s*=\s*\{\s*\.\.\.state\.attendance/.test(l));
        testRunner.assertEquals(blindSpreadLines.length, 0,
            'no debe quedar ningún spread ciego de merge entrante sin rutear:\n  ' + blindSpreadLines.join('\n  '));

        const mergeLines = APP_SRC.split('\n').filter(l => /state\.attendance\s*=\s*mergeAttendanceRecords\s*\(/.test(l));
        testRunner.assert(mergeLines.length >= 3, 'deben existir los 3 sitios de merge entrante rutedos por mergeAttendanceRecords');
        mergeLines.forEach(l => {
            testRunner.assert(!/(?:stamp|tombstone)AttendanceWrite/.test(l),
                'el merge entrante NO debe re-estampar — mergeAttendanceRecords ya decide por updatedAt');
        });
    }

});

// ─── U2a: tombstone (borrado marcado) + revivir al marcar presente ────────────

testRunner.addSuite("AttendanceRecordWriter — tombstone + revivir (Fase 1, U2a)", {

    "tombstoneAttendanceWrite marca deletedAt=now, present=false y updatedAt=now"() {
        const out = tombstoneAttendanceWrite({ employeeId: 'e1', date: '2026-07-01', present: true, hoursWorked: 8 }, 12345);
        testRunner.assertEquals(out.deletedAt, 12345, 'el tombstone marca deletedAt con el now');
        testRunner.assertEquals(out.present, false, 'un registro tombstoneado no está presente (lo tratan como ausente los ~30 filtros .present)');
        testRunner.assertEquals(out.updatedAt, 12345, 'un borrado local ES una escritura local → updatedAt fresco para ganar el LWW (U3)');
    },

    "tombstoneAttendanceWrite preserva los demás campos (el registro viaja como dato, no se borra la clave)"() {
        const out = tombstoneAttendanceWrite({ employeeId: 'e1', date: '2026-07-01', hoursWorked: 8, notes: 'x', positionHours: [{ positionId: 'p1', hours: 8 }] }, 1);
        testRunner.assertEquals(out.employeeId, 'e1');
        testRunner.assertEquals(out.date, '2026-07-01');
        testRunner.assertEquals(out.hoursWorked, 8);
        testRunner.assertEquals(out.notes, 'x');
        testRunner.assertEquals(out.positionHours[0].positionId, 'p1');
    },

    "tombstoneAttendanceWrite usa Date.now() cuando no se inyecta now"() {
        const before = Date.now();
        const out = tombstoneAttendanceWrite({ employeeId: 'e1' });
        const after = Date.now();
        testRunner.assert(out.deletedAt >= before && out.deletedAt <= after, 'sin now explícito usa Date.now()');
        testRunner.assertEquals(out.updatedAt, out.deletedAt, 'updatedAt y deletedAt comparten el mismo now');
    },

    "tombstoneAttendanceWrite es puro: no muta el original"() {
        const rec = { employeeId: 'e1', present: true, deletedAt: null };
        tombstoneAttendanceWrite(rec, 999);
        testRunner.assertEquals(rec.present, true, 'el original no debe mutarse');
        testRunner.assertEquals(rec.deletedAt, null, 'el original no debe mutarse');
    },

    "stampAttendanceWrite LIMPIA deletedAt cuando present===true (revivir un día tombstoneado)"() {
        const out = stampAttendanceWrite({ employeeId: 'e1', present: true, deletedAt: 555 }, 999);
        testRunner.assertEquals(out.deletedAt, null, 're-marcar presente limpia el tombstone (revive)');
        testRunner.assertEquals(out.present, true);
    },

    "stampAttendanceWrite PRESERVA deletedAt cuando present!==true (una nota en un día borrado no lo revive)"() {
        const out = stampAttendanceWrite({ employeeId: 'e1', present: false, deletedAt: 555, notes: 'tarde' }, 999);
        testRunner.assertEquals(out.deletedAt, 555, 'escribir sin marcar present NO revive el tombstone');
    }

});

console.log('🧪 AttendanceRecordWriter tests cargados.');
