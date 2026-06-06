/**
 * 🧪 BrowserWorkflowTests — Pruebas del flujo diario (ejecución en navegador).
 *
 * Estas pruebas se ejecutan directamente en el navegador con datos de prueba
 * AISLADOS — no tocan state.employees ni ningún dato real del usuario.
 *
 * Cubren los mismos escenarios que los Jest tests (ModalSaveTests,
 * AttendanceWorkflowTests, LoanWorkflowTests) pero usando sólo APIs
 * estándar del navegador (sin jest.fn(), sin mocks de Jest).
 *
 * Se ejecutan desde el panel "Tests" en Configuración.
 */

import { AttendanceService } from '../modules/features/attendance/AttendanceService.js';
import {
    createLoan,
    recordPayment,
    writeOffLoan,
    reopenLoan,
    refinanceLoan,
    getBalance,
    getTotalDue,
    LOAN_STATUS,
} from '../modules/features/loans/LoansService.js';

// ─── Helpers de estado aislado ────────────────────────────────────────────────

function makeFreshAttState() {
    return {
        settings: { regularHoursPerDay: 8, holidays: [] },
        employees: [
            { id: 'br-emp1', name: 'Ana Prueba',   positions: ['br-pos1', 'br-pos2'], active: true },
            { id: 'br-emp2', name: 'Luis Prueba',  positions: ['br-pos1'], active: true },
        ],
        positions: [
            { id: 'br-pos1', name: 'Oficial Test',  hourlyRate: 100, active: true },
            { id: 'br-pos2', name: 'Ayudante Test', hourlyRate: 80,  active: true },
        ],
        leaders: [],
        attendance: {},
        dayHoursConfig: {},
    };
}

function makeLoanEmp(id = 'br-loan-emp1') {
    return { id, name: 'Carlos Prueba', loans: [] };
}

const DATE = '2026-06-15';

// ═════════════════════════════════════════════════════════════════════════════
// SUITE: Asistencia — marcar y desmarcar
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('Browser — Asistencia: marcar y desmarcar', {

    'marcar crea registro present=true'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);

        const record = svc.createRecord('br-emp1', DATE);

        testRunner.assert(record !== null, 'registro creado');
        testRunner.assertEquals(record.present, true, 'present = true');
        testRunner.assertEquals(record.employeeId, 'br-emp1', 'employeeId correcto');
        testRunner.assert(`br-emp1-${DATE}` in s.attendance, 'registro en attendance');
    },

    'marcar usa horas del settings'() {
        const s = makeFreshAttState();
        s.settings.regularHoursPerDay = 10;
        const svc = new AttendanceService(s);

        const record = svc.createRecord('br-emp1', DATE);
        testRunner.assertEquals(record.hoursWorked, 10, 'horas = 10 del settings');
    },

    'marcar asigna primer puesto como selectedPosition'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);

        const record = svc.createRecord('br-emp1', DATE);
        testRunner.assertEquals(record.selectedPosition, 'br-pos1', 'primer puesto asignado');
    },

    'desmarcar elimina el registro'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);

        svc.createRecord('br-emp1', DATE);
        const result = svc.deleteRecord('br-emp1', DATE);

        testRunner.assert(result === true, 'deleteRecord retorna true');
        testRunner.assert(!(`br-emp1-${DATE}` in s.attendance), 'registro eliminado');
    },

    'desmarcar inexistente retorna false'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);

        const result = svc.deleteRecord('br-emp1', '2026-06-01');
        testRunner.assertEquals(result, false, 'false al desmarcar inexistente');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE: Asistencia — modificar campos
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('Browser — Asistencia: modificar', {

    'modificar hoursWorked'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);
        svc.createRecord('br-emp1', DATE);

        svc.updateRecord('br-emp1', DATE, { hoursWorked: 6 });

        testRunner.assertEquals(s.attendance[`br-emp1-${DATE}`].hoursWorked, 6, 'horas modificadas');
    },

    'modificar notes'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);
        svc.createRecord('br-emp1', DATE);

        svc.updateRecord('br-emp1', DATE, { notes: 'Llegó tarde — prueba' });

        testRunner.assertEquals(s.attendance[`br-emp1-${DATE}`].notes, 'Llegó tarde — prueba', 'notas guardadas');
    },

    'modificar selectedPosition'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);
        svc.createRecord('br-emp1', DATE);

        svc.updateRecord('br-emp1', DATE, { selectedPosition: 'br-pos2' });

        testRunner.assertEquals(s.attendance[`br-emp1-${DATE}`].selectedPosition, 'br-pos2', 'puesto cambiado');
    },

    'modificar overtimeHours'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);
        svc.createRecord('br-emp1', DATE);

        svc.updateRecord('br-emp1', DATE, { overtimeHours: 2 });

        testRunner.assertEquals(s.attendance[`br-emp1-${DATE}`].overtimeHours, 2, 'horas extra guardadas');
    },

    'modo multi-puesto guarda positionHours'() {
        const s = makeFreshAttState();
        const svc = new AttendanceService(s);
        svc.createRecord('br-emp1', DATE);

        svc.updateRecord('br-emp1', DATE, {
            multiPosition: true,
            positionHours: [
                { positionId: 'br-pos1', hours: 5, overtimeHours: 0 },
                { positionId: 'br-pos2', hours: 3, overtimeHours: 0 },
            ],
        });

        const rec = s.attendance[`br-emp1-${DATE}`];
        testRunner.assertEquals(rec.multiPosition, true, 'multiPosition activo');
        testRunner.assertEquals(rec.positionHours.length, 2, '2 puestos en positionHours');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE: Préstamos — ciclo completo
// ═════════════════════════════════════════════════════════════════════════════

testRunner.addSuite('Browser — Préstamos: crear y saldar', {

    'crear préstamo → estado ACTIVE'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });

        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'estado ACTIVE al crear');
        testRunner.assertEquals(getBalance(loan), 1000, 'saldo = principal');
    },

    'préstamo con interés: saldo = principal + interés'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 10, startDate: '2026-01-01' });

        testRunner.assertEquals(getTotalDue(loan), 1100, 'total = 1100');
        testRunner.assertEquals(getBalance(loan), 1100, 'saldo inicial = total');
    },

    '3 pagos parciales + pago final → PAID'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 3000, interestRate: 0, startDate: '2026-01-01' });

        recordPayment(emp, loan.id, { amount: 1000, date: '2026-02-01' });
        recordPayment(emp, loan.id, { amount: 1000, date: '2026-03-01' });
        recordPayment(emp, loan.id, { amount: 1000, date: '2026-04-01' });

        testRunner.assertEquals(getBalance(loan), 0, 'saldo cero');
        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, 'estado PAID');
    },

    'pago mayor que saldo lanza excepción'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });
        let threw = false;
        try { recordPayment(emp, loan.id, { amount: 600, date: '2026-02-01' }); }
        catch (e) { threw = true; }

        testRunner.assert(threw, 'debe lanzar excepción si el pago supera el saldo');
    },
});

testRunner.addSuite('Browser — Préstamos: cancelar y refinanciar', {

    'write-off cambia estado a WRITTEN_OFF'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 200, date: '2026-02-01' });

        writeOffLoan(emp, loan.id);

        testRunner.assertEquals(loan.status, LOAN_STATUS.WRITTEN_OFF, 'WRITTEN_OFF');
    },

    'reabrir WRITTEN_OFF (con saldo) → ACTIVE'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 200, date: '2026-02-01' });
        writeOffLoan(emp, loan.id);

        reopenLoan(emp, loan.id);

        testRunner.assertEquals(loan.status, LOAN_STATUS.ACTIVE, 'vuelve a ACTIVE');
    },

    'refinanciar aumenta el saldo'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 400, date: '2026-02-01' }); // saldo = 600

        refinanceLoan(emp, loan.id, { basis: 'balance', interestRate: 10 }); // +60

        testRunner.assertEquals(getBalance(loan), 660, 'saldo = 660 tras refinanciar');
    },

    'refinanciar → saldar → PAID'() {
        const emp = makeLoanEmp();
        const loan = createLoan(emp, { principal: 1000, interestRate: 0, startDate: '2026-01-01' });
        recordPayment(emp, loan.id, { amount: 400, date: '2026-02-01' });
        refinanceLoan(emp, loan.id, { basis: 'balance', interestRate: 10 }); // saldo = 660

        recordPayment(emp, loan.id, { amount: 660, date: '2026-03-01' });

        testRunner.assertEquals(loan.status, LOAN_STATUS.PAID, 'PAID tras saldar con interés');
    },
});

// ═════════════════════════════════════════════════════════════════════════════
// Función pública — se llama desde el botón en Configuración > Tests
// ═════════════════════════════════════════════════════════════════════════════

window.runBrowserTests = async function () {
    const container = document.getElementById('browser-test-results');
    if (!container) return;

    container.innerHTML = `
        <div style="padding: 16px; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
            <span style="animation: spin 1s linear infinite; display: inline-block;">⟳</span>
            Ejecutando pruebas con datos aislados…
        </div>
    `;

    let report;
    try {
        report = await window.testRunner.runAll();
    } catch (err) {
        container.innerHTML = `<div style="color: #f87171; padding: 12px;">Error al ejecutar pruebas: ${err.message}</div>`;
        return;
    }

    const { total, passed, results } = report;
    const failed = total - passed;

    // ── Summary bar ───────────────────────────────────────────────────────────
    let html = `
        <div style="display:flex; gap:16px; padding:12px 16px; background:#0f172a; border-radius:8px; margin-bottom:16px; align-items:center; flex-wrap:wrap;">
            <span style="color:#4ade80; font-weight:700;">${passed} ✓ pasadas</span>
            ${failed > 0 ? `<span style="color:#f87171; font-weight:700;">${failed} ✗ falladas</span>` : ''}
            <span style="color:#64748b; font-size:0.8rem;">de ${total} total</span>
            ${failed === 0 ? '<span style="color:#4ade80; margin-left:auto;">Todo en orden ✓</span>' : ''}
        </div>
    `;

    // ── Group by suite ────────────────────────────────────────────────────────
    const suiteMap = new Map();
    for (const r of results) {
        if (!suiteMap.has(r.suite)) suiteMap.set(r.suite, []);
        suiteMap.get(r.suite).push(r);
    }

    for (const [suiteName, tests] of suiteMap) {
        const suiteOk = tests.every(t => t.status === 'PASS');
        html += `
            <div style="margin-bottom:12px; border:1px solid ${suiteOk ? '#1e3a2e' : '#3a1e1e'}; border-radius:8px; overflow:hidden;">
                <div style="padding:8px 12px; background:${suiteOk ? '#0d2318' : '#2a0d0d'}; font-size:0.8rem; font-weight:600; color:${suiteOk ? '#4ade80' : '#f87171'}; display:flex; justify-content:space-between;">
                    <span>${suiteOk ? '✓' : '✗'} ${suiteName}</span>
                    <span style="opacity:0.6;">${tests.filter(t => t.status === 'PASS').length}/${tests.length}</span>
                </div>
                <div style="padding:4px 0;">
                    ${tests.map(t => `
                        <div style="display:flex; gap:8px; padding:4px 12px; ${t.status === 'FAIL' ? 'background:#1a0505;' : ''}">
                            <span style="color:${t.status === 'PASS' ? '#4ade80' : '#f87171'}; font-size:0.75rem; flex-shrink:0;">${t.status === 'PASS' ? '✓' : '✗'}</span>
                            <span style="color:#e2e8f0; font-size:0.75rem; flex:1;">${t.test}</span>
                            ${t.error ? `<span style="color:#fca5a5; font-size:0.7rem; word-break:break-word;">${t.error}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
};
