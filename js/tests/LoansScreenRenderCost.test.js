/**
 * Préstamos: la cartera no se recalcula si los datos no cambiaron, y el
 * buscador no redibuja la app en cada tecla.
 *
 * Medido en Chromium (CPU 4×, 300 empleados · 900 préstamos · 5,400 abonos):
 * cada tecla del buscador bloqueaba ~1.7 s porque LedgerOverview rehacía el
 * modelo de cartera, totales, línea de tiempo y flujos de todos los préstamos.
 */
jest.mock('../modules/core/RenderManager.js', () => ({
    render: jest.fn()
}));

import { state } from '../modules/core/AppState.js';
import { render } from '../modules/core/RenderManager.js';
import { createLoan, recordPayment } from '../modules/features/loans/LoansService.js';
import { loanDataKey } from '../modules/features/loans/LoanDataKey.js';
import { buildPortfolioModel } from '../modules/features/loans/LoanPortfolioView.js';
import { setLoansSearch, LOANS_SEARCH_RENDER_DELAY_MS } from '../modules/features/loans/LoansController.js';

function seedPortfolio() {
    const a = { id: 'e1', number: '001', name: 'Ana', active: true, loans: [], updatedAt: 0 };
    const b = { id: 'e2', number: '002', name: 'Beto', active: true, loans: [], updatedAt: 0 };
    const la = createLoan(a, { principal: 5000, interestRate: 10, startDate: '2026-09-01' });
    recordPayment(a, la.id, { amount: 500, date: '2026-09-15' });
    createLoan(b, { principal: 2000, interestRate: 0, startDate: '2026-09-20' });
    state.employees = [a, b];
    state.loansLedger = null;
    return { live: state.employees, loanId: la.id };
}

describe('LoanDataKey — clave de los datos de préstamos', () => {
    test('es estable si nada cambia y lee igual proxies que objetos planos', () => {
        const { live } = seedPortfolio();
        const k1 = loanDataKey(live);
        expect(loanDataKey(live)).toBe(k1);
        expect(loanDataKey(JSON.parse(JSON.stringify(live)))).toBe(k1);
    });

    test('cambia con un abono nuevo, con un monto editado sin updatedAt y con el nombre', () => {
        const { live, loanId } = seedPortfolio();
        const k0 = loanDataKey(live);

        recordPayment(live[0], loanId, { amount: 100, date: '2026-09-22' });
        const k1 = loanDataKey(state.employees);
        expect(k1).not.toBe(k0);

        const payments = state.employees[0].loans[0].payments;
        payments[0].amount = 501; // edición directa, sin tocar updatedAt
        const k2 = loanDataKey(state.employees);
        expect(k2).not.toBe(k1);

        state.employees[1].name = 'Beto R.';
        expect(loanDataKey(state.employees)).not.toBe(k2);
    });

    test('cambia si cambia el conjunto de empleados (otro alcance de obra)', () => {
        const { live } = seedPortfolio();
        expect(loanDataKey([live[0]])).not.toBe(loanDataKey(live));
    });
});

describe('buildPortfolioModel — memo por datos', () => {
    test('con los mismos datos devuelve el mismo modelo (no recalcula)', () => {
        const { live } = seedPortfolio();
        const m1 = buildPortfolioModel([...live]);
        const m2 = buildPortfolioModel([...state.employees]);
        expect(m2).toBe(m1);
    });

    test('un abono nuevo produce un modelo nuevo con el saldo al día', () => {
        const { live, loanId } = seedPortfolio();
        const before = buildPortfolioModel([...live]);
        recordPayment(state.employees[0], loanId, { amount: 1000, date: '2026-09-25' });
        const after = buildPortfolioModel([...state.employees]);
        expect(after).not.toBe(before);
        expect(after.summary).not.toEqual(before.summary);
    });
});

describe('setLoansSearch — un solo render por ráfaga de teclas', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        render.mockClear();
        state.loansLedger = null;
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test('guarda el texto al instante pero no redibuja en cada tecla', () => {
        setLoansSearch('T');
        setLoansSearch('Tr');
        setLoansSearch('Tra');
        expect(state.loansLedger.search).toBe('Tra');
        expect(render).not.toHaveBeenCalled();

        jest.advanceTimersByTime(LOANS_SEARCH_RENDER_DELAY_MS);
        expect(render).toHaveBeenCalledTimes(1);
    });

    test('limpiar la búsqueda redibuja de inmediato y cancela el render pendiente', () => {
        setLoansSearch('Tr');
        setLoansSearch('');
        expect(state.loansLedger.search).toBe('');
        expect(render).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(LOANS_SEARCH_RENDER_DELAY_MS * 2);
        expect(render).toHaveBeenCalledTimes(1);
    });

    test('la espera es corta (la lista responde mientras se escribe)', () => {
        expect(LOANS_SEARCH_RENDER_DELAY_MS).toBeGreaterThanOrEqual(100);
        expect(LOANS_SEARCH_RENDER_DELAY_MS).toBeLessThanOrEqual(250);
    });
});

describe('Revisión de consolidaciones — su caché sí reutiliza el cálculo', () => {
    test('con los mismos préstamos no se recalcula; con un cambio sí', () => {
        jest.isolateModules(() => {
            const actual = jest.requireActual('../modules/features/loans/LoanConsolidationReview.js');
            const spy = jest.fn(actual.reviewConsolidations);
            jest.doMock('../modules/features/loans/LoanConsolidationReview.js', () => ({ ...actual, reviewConsolidations: spy }));
            const { ConsolidationReviewButton } = require('../modules/features/loans/LoanConsolidationReviewPanel.js');
            const { state: s } = require('../modules/core/AppState.js');
            const { createLoan: lend, recordPayment: pay } = require('../modules/features/loans/LoansService.js');

            const emp = { id: 'e9', number: '009', name: 'Caro', active: true, loans: [], updatedAt: 0 };
            const loanId = lend(emp, { principal: 3000, interestRate: 0, startDate: '2026-09-01' }).id;
            s.employees = [emp];
            expect(s.employees).toHaveLength(1);
            ConsolidationReviewButton({ scoped: [...s.employees] });
            ConsolidationReviewButton({ scoped: [...s.employees] });
            expect(spy).toHaveBeenCalledTimes(1);

            pay(s.employees[0], loanId, { amount: 50, date: '2026-09-28' });
            ConsolidationReviewButton({ scoped: [...s.employees] });
            expect(spy).toHaveBeenCalledTimes(2);
        });
    });
});
