/**
 * 🧪 BackupRedactionTests (R-gaps: datos sensibles en claro en sessionStorage)
 *
 * El auto-backup de sessionStorage ('attendance-backup') es una red de
 * emergencia para recuperar el estado si IndexedDB queda vacío al arrancar.
 * Guardaba el estado COMPLETO en claro — salarios, préstamos, adelantos,
 * teléfonos — legible desde la consola por el siguiente usuario en un equipo
 * compartido.
 *
 * redactSensitiveBackup quita los campos financieros/PII del payload del
 * AUTO-backup, conservando lo necesario para recuperar la forma de la UI
 * (ids, nombres, asignaciones, asistencia). Los datos sensibles se rehidratan
 * desde la nube / IndexedDB. (El export a archivo JSON del usuario es OTRO
 * camino, deliberado, y NO se redacta.)
 */

import fs from 'fs';
import path from 'path';
import { redactSensitiveBackup } from '../modules/services/BackupRedaction.js';

const PS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

function sampleData() {
    return {
        employees: [
            {
                id: 'e1', number: 7, name: 'Juan', active: true, positionId: 'p1', leaderId: 'l1',
                customSalary: 150, positionSalaries: { p1: 150 }, phone: '809-555-1234',
                email: 'juan@example.com',
                advances: [{ id: 'a1', amount: 500 }],
                bonuses: [{ id: 'b1', amount: 300, reason: 'productividad' }],
                deductions: [{ id: 'd1', amount: 100, reason: 'uniforme' }],
                loans: [{ id: 'LOAN-1', principal: 5000, payments: [{ id: 'PAY-1', amount: 500 }] }]
            }
        ],
        positions: [
            { id: 'p1', name: 'Albañil', salaryConfig: { amount: 150 }, baseSalary: 150, hourlyRate: 150, salaryInputMode: 'hourly' }
        ],
        leaders: [{ id: 'l1', name: 'Pedro', number: 1 }],
        attendance: { 'e1-2026-06-30': { employeeId: 'e1', date: '2026-06-30', present: true } },
        settings: { theme: 'dark', schemaVersion: 3 }
    };
}

testRunner.addSuite("BackupRedaction — redactSensitiveBackup", {

    "quita campos financieros/PII de los empleados"() {
        const r = redactSensitiveBackup(sampleData());
        const emp = r.employees[0];
        testRunner.assert(!('loans' in emp), 'debe quitar loans (préstamos)');
        testRunner.assert(!('advances' in emp), 'debe quitar advances (adelantos)');
        testRunner.assert(!('customSalary' in emp), 'debe quitar customSalary');
        testRunner.assert(!('positionSalaries' in emp), 'debe quitar positionSalaries');
        testRunner.assert(!('phone' in emp), 'debe quitar phone (PII)');
        testRunner.assert(!('email' in emp), 'debe quitar email (PII) — JD#3');
        testRunner.assert(!('bonuses' in emp), 'debe quitar bonuses (montos financieros) — JD#3');
        testRunner.assert(!('deductions' in emp), 'debe quitar deductions (montos financieros) — JD#3');
    },

    "conserva lo necesario para recuperar la forma de la UI"() {
        const r = redactSensitiveBackup(sampleData());
        const emp = r.employees[0];
        testRunner.assertEquals(emp.id, 'e1', 'conserva id');
        testRunner.assertEquals(emp.name, 'Juan', 'conserva name');
        testRunner.assertEquals(emp.number, 7, 'conserva number');
        testRunner.assertEquals(emp.positionId, 'p1', 'conserva la asignación de puesto');
        testRunner.assertEquals(emp.active, true, 'conserva active');
    },

    "quita la config salarial de los puestos, conserva id/nombre"() {
        const r = redactSensitiveBackup(sampleData());
        const pos = r.positions[0];
        testRunner.assert(!('salaryConfig' in pos), 'debe quitar salaryConfig');
        testRunner.assert(!('baseSalary' in pos), 'debe quitar baseSalary');
        testRunner.assert(!('hourlyRate' in pos), 'debe quitar hourlyRate (la tarifa REAL del puesto) — JD#3');
        testRunner.assert(!('salaryInputMode' in pos), 'debe quitar salaryInputMode — JD#3');
        testRunner.assertEquals(pos.id, 'p1', 'conserva id del puesto');
        testRunner.assertEquals(pos.name, 'Albañil', 'conserva nombre del puesto');
    },

    "no toca asistencia, settings ni líderes"() {
        const data = sampleData();
        const r = redactSensitiveBackup(data);
        testRunner.assertEquals(JSON.stringify(r.attendance), JSON.stringify(data.attendance), 'asistencia intacta');
        testRunner.assertEquals(JSON.stringify(r.settings), JSON.stringify(data.settings), 'settings intactos');
        testRunner.assertEquals(JSON.stringify(r.leaders), JSON.stringify(data.leaders), 'líderes intactos');
    },

    "no muta el input original (devuelve copia)"() {
        const data = sampleData();
        redactSensitiveBackup(data);
        testRunner.assert(Array.isArray(data.employees[0].loans) && data.employees[0].loans.length === 1,
            'el objeto original NO debe perder sus préstamos (redacción sobre copia)');
    },

    "es defensivo ante datos vacíos/ausentes"() {
        let threw = false;
        try {
            redactSensitiveBackup({ employees: undefined, positions: null, settings: {} });
            redactSensitiveBackup({});
            redactSensitiveBackup(null);
        } catch (_) { threw = true; }
        testRunner.assert(!threw, 'no debe petar con datos vacíos o ausentes');
    }

});

testRunner.addSuite("BackupRedaction — createAutoBackup redacta antes de guardar", {

    "createAutoBackup usa redactSensitiveBackup"() {
        const block = PS_SRC.match(/export function createAutoBackup[\s\S]{0,2600}?\n\}/);
        testRunner.assert(!!block, 'createAutoBackup debe existir');
        const matches = (block[0].match(/redactSensitiveBackup\s*\(/g) || []).length;
        testRunner.assert(matches >= 2,
            'createAutoBackup debe redactar en AMBOS paths (completo y reducido por cuota)');
    },

    "el respaldo completo no escribe employees/positions crudos sin redactar"() {
        const block = PS_SRC.match(/export function createAutoBackup[\s\S]{0,2600}?\n\}/);
        testRunner.assert(!!block, 'createAutoBackup debe existir');
        // Ningún setItem de attendance-backup debe construir data inline sin pasar
        // por redactSensitiveBackup: el data: { employees: state.employees ... }
        // crudo fue reemplazado por data: redactSensitiveBackup({...}).
        testRunner.assert(!/data:\s*\{\s*employees:\s*state\.employees/.test(block[0]),
            'el payload del backup no debe llevar employees crudos: debe redactarse');
    }

});
