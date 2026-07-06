/**
 * 🧪 EmployeeDeletionGuardTests
 *
 * Salvaguardas para eliminar un empleado de forma permanente (decidido con
 * el usuario 2026-07-06). Eliminar un empleado PIERDE sus datos, así que hay
 * varias barreras — todas juntas en canDeleteEmployee, función pura:
 *
 *   1. Debe estar DESACTIVADO (pausado) — no se borra a alguien activo.
 *   2. Debe llevar >= minInactiveDays días desactivado (default 30) — evita
 *      perder registro de nómina de un período reciente en que trabajó.
 *   3. Sin préstamos ACTIVOS con saldo pendiente (ni deuda ni pagos por
 *      cobrar) — proteger la plata.
 *
 * La confirmación "ya se le pagó el período actual" NO va acá: no es
 * verificable automáticamente, se pide como confirmación consciente en la UI.
 */

import { canDeleteEmployee, DEFAULT_MIN_INACTIVE_DAYS } from '../modules/services/EmployeeDeletionGuard.js';
import { createLoan, recordPayment } from '../modules/features/loans/LoansService.js';

const DAY = 24 * 60 * 60 * 1000;
// "Ahora" fijo para tests deterministas: 2026-07-06.
const NOW = new Date('2026-07-06T12:00:00Z').getTime();

function inactiveEmp({ daysInactive = 60, active = false, loans = [] } = {}) {
    const changeDate = new Date(NOW - daysInactive * DAY).toISOString().slice(0, 10);
    return { id: 'e1', name: 'Ana', active, lastStatusChange: changeDate, loans, updatedAt: 1 };
}

testRunner.addSuite("EmployeeDeletionGuard — canDeleteEmployee", {

    "un empleado ACTIVO no se puede eliminar"() {
        const emp = inactiveEmp({ active: true, daysInactive: 60 });
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(/desactiv|paus/i.test(r.reason), 'la razón debe mencionar que hay que desactivarlo primero');
    },

    "un empleado pausado hace >= 30 días y sin deudas SÍ se puede eliminar"() {
        const emp = inactiveEmp({ daysInactive: 60 });
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, true);
    },

    "un empleado pausado hace MENOS de 30 días NO se puede (registro de nómina reciente)"() {
        const emp = inactiveEmp({ daysInactive: 10 });
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(/d[ií]as|30/i.test(r.reason), 'la razón debe mencionar el mínimo de días');
    },

    "justo en el umbral (exactamente 30 días) SÍ se puede"() {
        const emp = inactiveEmp({ daysInactive: DEFAULT_MIN_INACTIVE_DAYS });
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, true);
    },

    "un empleado con un préstamo ACTIVO con saldo pendiente NO se puede eliminar"() {
        const emp = inactiveEmp({ daysInactive: 60 });
        createLoan(emp, { principal: 1000, startDate: '2026-01-01', concept: 'Deuda' });
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(/saldo|pr[eé]stamo|deuda/i.test(r.reason), 'la razón debe mencionar el saldo pendiente');
    },

    "un empleado cuyo préstamo YA fue saldado (saldo 0) SÍ se puede eliminar"() {
        const emp = inactiveEmp({ daysInactive: 60 });
        const loan = createLoan(emp, { principal: 1000, startDate: '2026-01-01', concept: 'Pagado' });
        recordPayment(emp, loan.id, { amount: 1000, date: '2026-02-01' }); // salda → status PAID
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, true);
    },

    "el umbral de días es configurable via opts.minInactiveDays"() {
        const emp = inactiveEmp({ daysInactive: 15 });
        testRunner.assertEquals(canDeleteEmployee(emp, { now: NOW, minInactiveDays: 10 }).ok, true);
        testRunner.assertEquals(canDeleteEmployee(emp, { now: NOW, minInactiveDays: 20 }).ok, false);
    },

    "sin lastStatusChange (dato viejo) se trata conservador: NO se puede saber la antigüedad"() {
        const emp = { id: 'e1', name: 'Ana', active: false, loans: [] };
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(/antig|d[ií]as|desactiv/i.test(r.reason));
    },

    "defensivo: emp null → no se puede, sin lanzar"() {
        const r = canDeleteEmployee(null, { now: NOW });
        testRunner.assertEquals(r.ok, false);
    },

    "un préstamo anulado (written-off) no cuenta como saldo pendiente"() {
        const emp = inactiveEmp({ daysInactive: 60,
            loans: [{ id: 'L1', status: 'written-off', principal: 500, payments: [], refinancings: [] }] });
        const r = canDeleteEmployee(emp, { now: NOW });
        testRunner.assertEquals(r.ok, true);
    }

});

console.log('🧪 EmployeeDeletionGuard tests cargados.');
