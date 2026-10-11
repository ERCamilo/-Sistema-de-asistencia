/**
 * Dibujar Préstamos solo LEE los datos.
 *
 * La pantalla pasa los empleados crudos (sin el proxy reactivo) a sus cálculos
 * para no pagar el `get` del proxy en cada lectura. Eso solo es seguro si
 * ningún cálculo del render escribe en los empleados/préstamos: este test
 * toma una foto exacta de los datos crudos, dibuja cada variante de la
 * pantalla y verifica que los datos quedaron idénticos. (Congelarlos no sirve:
 * el proxy de AppState no puede devolver proxies hijos de objetos congelados.)
 */
jest.mock('../modules/core/RenderManager.js', () => ({
    render: jest.fn()
}));

import { state, stateManager } from '../modules/core/AppState.js';
import { createLoan, recordPayment, refinanceLoan } from '../modules/features/loans/LoansService.js';
import { LoansLedger, readOnlyLoansState } from '../modules/features/loans/LoansLedger.js';
import { laUseClassicView } from '../modules/features/loans/LoanAccountController.js';

const snapshot = () => JSON.stringify(stateManager.getState().employees);

function seed() {
    const a = { id: 'e1', number: '001', name: 'Ana Ruiz', active: true, loans: [], updatedAt: 0 };
    const b = { id: 'e2', number: '002', name: 'Beto Gil', active: false, loans: [], updatedAt: 0 };
    const la = createLoan(a, { principal: 5000, interestRate: 10, startDate: '2026-08-01' });
    recordPayment(a, la.id, { amount: 500, date: '2026-08-15' });
    refinanceLoan(a, la.id, { interestRate: 10, basis: 'balance', date: '2026-09-01', nextDueDate: '2026-09-20' });
    createLoan(b, { principal: 2000, interestRate: 0, startDate: '2026-09-20' });
    // Datos "viejos" sin número ni fecha de cobro: obliga a la copia virtual
    // (prepareLoanEmployees) y al plan de completado de datos.
    for (const emp of [a, b]) for (const loan of emp.loans) { delete loan.number; delete loan.dueDate; }
    state.employees = [a, b];
    state.settings = { ...(state.settings || {}), payPeriod: { periodStart: '2026-08-01', periodLength: 14, payDay: '2026-08-15' } };
    state.loansLedger = null;
}

describe('Préstamos — el render no escribe en los datos', () => {
    afterEach(() => {
        laUseClassicView(0);
        state.loansLedger = null;
        state.employees = [];
    });

    const variants = [
        ['cartera (vista nueva)', () => {}, 'Ana Ruiz'],
        ['vista anterior', () => laUseClassicView(1), 'Ana Ruiz'],
        ['por préstamo, todos', () => { state.loansLedger = { displayMode: 'individual', filterView: 'all' }; }, 'Ana Ruiz'],
        ['con búsqueda y orden', () => { state.loansLedger = { search: 'ana', sortBy: 'number', sortOrder: 'asc' }; }, 'Ana Ruiz'],
        // Ana tiene deuda activa: en «saldados» no aparece; Beto (inactivo) sí cuenta.
        ['saldados e inactivos', () => { state.loansLedger = { filterView: 'settled' }; }, 'loans-overview']
    ];

    test.each(variants)('%s: dibuja sin modificar los datos', (_label, setup, expected) => {
        seed();
        setup();
        const before = snapshot();
        const html = LoansLedger();
        expect(html).toContain(expected);
        expect(snapshot()).toBe(before);
        // Segundo render (con cachés ya llenos) tampoco escribe.
        LoansLedger();
        expect(snapshot()).toBe(before);
    });
});

describe('readOnlyLoansState — los cálculos reciben objetos crudos', () => {
    afterEach(() => { state.employees = []; });

    test('los empleados no son proxies y son los mismos objetos del estado', () => {
        seed();
        const ro = readOnlyLoansState();
        expect(ro.employees).toHaveLength(2);
        expect(ro.employees.every(emp => !emp._isProxy)).toBe(true);
        expect(ro.employees[0]).toBe(stateManager.getState().employees[0]);
        expect(ro.employees[0].loans[0]._isProxy).toBeUndefined();
    });
});
