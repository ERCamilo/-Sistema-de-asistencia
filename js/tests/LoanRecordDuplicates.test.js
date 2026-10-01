/**
 * Abonos, refinanciamientos y préstamos anotados dos veces: detección,
 * efecto en el saldo y el panel de revisión que anula las copias.
 */
import { state } from '../modules/core/AppState.js';
import { getBalance } from '../modules/features/loans/LoansService.js';
import { formatCurrency } from '../modules/utils/Formatters.js';
import {
    findLoanRecordDuplicates, previewLoanAfterVoiding, dismissDuplicateGroup, DUPLICATE_KINDS
} from '../modules/features/loans/LoanRecordDuplicates.js';
import {
    renderLoanDuplicateReview, resetLoanDuplicateReview, toggleLoanDuplicateReview,
    toggleLoanDuplicateRecord, voidSelectedLoanDuplicates, dismissLoanDuplicateGroup
} from '../modules/features/loans/LoanDuplicateReview.js';

const at = text => Date.parse(text);
const pay = (id, date, amount, recordedAt, extra = {}) => ({ id, date, amount, voided: false, recordedAt: at(recordedAt), ...extra });
const refi = (id, date, interestAmount, createdAt) => ({ id, date, basis: 'principal', baseAmount: interestAmount * 10, interestRate: 10, interestAmount, createdAt: at(createdAt) });
const loan = (id, overrides = {}) => ({
    id, principal: 1000, interestRate: 10, interestIncluded: false, startDate: '2026-05-07',
    createdAt: at('2026-05-07T10:00'), status: 'paid', installmentMode: 'lump', payments: [], refinancings: [], ...overrides
});
const emp = (id, loans) => ({ id, name: `Emp ${id}`, number: id, loans });

describe('detección de registros repetidos', () => {
    test('"Saldo completo" anotado dos veces: la copia es la que se anotó después y sobra', () => {
        const l = loan('L1', { payments: [
            pay('P-b', '2026-05-30', 1100, '2026-05-31T03:15', { note: 'Saldo completo' }),
            pay('P-a', '2026-05-30', 1100, '2026-05-30T15:15', { note: 'Saldo completo' })
        ] });
        const { loans, counts } = findLoanRecordDuplicates([emp('e1', [l])]);
        expect(counts).toMatchObject({ payments: 1, refinancings: 0, loans: 0, total: 1 });
        expect(loans[0]).toMatchObject({ balance: 0, overpaid: 1100, suggested: ['P-b'] });
        expect(loans[0].groups[0]).toMatchObject({ kind: DUPLICATE_KINDS.PAYMENT, confidence: 'high' });
        expect(loans[0].groups[0].original.id).toBe('P-a');
        expect(previewLoanAfterVoiding(l, ['P-b'])).toEqual({ balance: 0, overpaid: 0 });
    });

    test('un interés repetido infla la deuda: se marca y al anularlo baja el saldo', () => {
        const l = loan('L2', { principal: 3000, status: 'active', refinancings: [
            refi('R1', '2026-05-30', 300, '2026-05-30T15:15'),
            refi('R2', '2026-05-31', 300, '2026-05-31T03:10')
        ] });
        const { loans } = findLoanRecordDuplicates([emp('e1', [l])]);
        expect(loans[0].groups[0]).toMatchObject({ kind: DUPLICATE_KINDS.REFINANCING, confidence: 'high' });
        expect(getBalance(l)).toBe(3900);
        expect(previewLoanAfterVoiding(l, loans[0].suggested).balance).toBe(3600);
    });

    test('interés y abono repetidos juntos: el abono también queda marcado', () => {
        const l = loan('L3', { principal: 2000, payments: [
            pay('P1', '2026-05-30', 200, '2026-05-30T14:53'),
            pay('P2', '2026-05-30', 200, '2026-05-31T03:14'),
            pay('P3', '2026-07-11', 2200, '2026-07-11T15:56')
        ], refinancings: [
            refi('R1', '2026-05-30', 200, '2026-05-30T14:51'),
            refi('R2', '2026-05-31', 200, '2026-05-31T03:13')
        ] });
        const [item] = findLoanRecordDuplicates([emp('e1', [l])]).loans;
        expect(item.suggested.sort()).toEqual(['P2', 'R2']);
        expect(previewLoanAfterVoiding(l, item.suggested)).toEqual({ balance: 0, overpaid: 0 });
    });

    test('abonos iguales en semanas distintas o de cuotas de nómina distintas no son copia', () => {
        const l = loan('L4', { status: 'active', principal: 2000, payments: [
            pay('P1', '2026-06-01', 200, '2026-06-01T10:00'),
            pay('P2', '2026-06-08', 200, '2026-06-08T10:00'),
            pay('P3', '2026-06-15', 200, '2026-06-15T10:00', { payrollChargeKeys: ['L4:inst-1'] }),
            pay('P4', '2026-06-15', 200, '2026-06-15T10:00', { payrollChargeKeys: ['L4:inst-2'] })
        ] });
        expect(findLoanRecordDuplicates([emp('e1', [l])]).counts.total).toBe(0);
    });

    test('abono igual dos días después sin pagar de más: se muestra pero sin marcar', () => {
        const l = loan('L5', { status: 'active', principal: 2000, payments: [
            pay('P1', '2026-06-01', 200, '2026-06-01T10:00'),
            pay('P2', '2026-06-03', 200, '2026-06-03T10:00')
        ] });
        const [item] = findLoanRecordDuplicates([emp('e1', [l])]).loans;
        expect(item.groups[0].confidence).toBe('review');
        expect(item.suggested).toEqual([]);
    });

    test('los anulados no cuentan', () => {
        const l = loan('L6', { payments: [
            pay('P1', '2026-05-30', 1100, '2026-05-30T15:15'),
            pay('P2', '2026-05-30', 1100, '2026-05-31T03:15', { voided: true })
        ] });
        expect(findLoanRecordDuplicates([emp('e1', [l])]).counts.total).toBe(0);
    });

    test('préstamos del mismo monto con inicio a ≤ 3 días; los de mismo seq los avisa el detector viejo', () => {
        const e = emp('e1', [
            loan('A', { principal: 4000, startDate: '2026-09-25', status: 'active' }),
            loan('B', { principal: 4000, startDate: '2026-09-28', status: 'active' }),
            loan('C', { principal: 4000, startDate: '2026-10-05', status: 'active' }),
            loan('D', { principal: 500, startDate: '2026-09-01', seq: 3 }),
            loan('E', { principal: 500, startDate: '2026-09-02', seq: 3 })
        ]);
        const { loanPairs } = findLoanRecordDuplicates([e]);
        expect(loanPairs.map(pair => pair.loans.map(item => item.id))).toEqual([['A', 'B']]);
    });

    test('"no es copia" queda guardado y no se vuelve a proponer', () => {
        const e = emp('e1', [loan('L1', { payments: [
            pay('P1', '2026-06-01', 200, '2026-06-01T10:00'),
            pay('P2', '2026-06-02', 200, '2026-06-02T10:00')
        ] })]);
        const [item] = findLoanRecordDuplicates([e]).loans;
        dismissDuplicateGroup(e, [item.loanId], item.groups[0].key, 123);
        expect(e.loans[0]).toMatchObject({ duplicateReviewDismissed: [item.groups[0].key], updatedAt: 123 });
        expect(findLoanRecordDuplicates([e]).counts.total).toBe(0);
    });
});

describe('panel de revisión', () => {
    let confirmSpy;

    beforeEach(() => {
        resetLoanDuplicateReview();
        state.employees = [emp('e1', [
            loan('L1', { payments: [
                pay('P1', '2026-05-30', 1100, '2026-05-30T15:15', { note: 'Saldo completo' }),
                pay('P2', '2026-05-30', 1100, '2026-05-31T03:15', { note: 'Saldo completo' })
            ] }),
            loan('L2', { status: 'active', principal: 3000, refinancings: [
                refi('R1', '2026-05-30', 300, '2026-05-30T15:15'),
                refi('R2', '2026-05-31', 300, '2026-05-31T03:10')
            ] })
        ])];
        confirmSpy = jest.fn(options => options.onConfirm());
        window.showConfirm = confirmSpy;
        window.render = jest.fn();
    });

    afterEach(() => {
        delete window.showConfirm;
        delete window.render;
    });

    test('cerrado muestra el conteo; abierto lista original, copias marcadas y efecto en el saldo', () => {
        const closed = renderLoanDuplicateReview({ scope: 'general', employees: state.employees });
        expect(closed).toContain('Posibles registros repetidos');
        expect(closed).toContain('1 abono · 1 refinanciamiento');
        expect(closed).not.toContain('loan-dup__body');

        toggleLoanDuplicateReview('general');
        const open = renderLoanDuplicateReview({ scope: 'general', employees: state.employees });
        expect(open).toContain('se conserva');
        expect((open.match(/type="checkbox"[^>]*checked/g) || [])).toHaveLength(2);
        expect(open).toContain('Anular 2 copias marcadas');
        expect(open).toContain(`Saldo <b>${formatCurrency(3900)}</b> → <b>${formatCurrency(3600)}</b>`);
    });

    test('anular aplica solo lo marcado, pide confirmación y conserva el original', () => {
        toggleLoanDuplicateRecord('L2', 'R2'); // desmarca el interés repetido
        voidSelectedLoanDuplicates();
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        const [l1, l2] = state.employees[0].loans;
        expect(l1.payments.map(item => item.voided)).toEqual([false, true]);
        expect(l2.refinancings.every(item => !item.voided)).toBe(true);
        expect(renderLoanDuplicateReview({ scope: 'general', employees: state.employees })).toContain('1 refinanciamiento');
    });

    test('"no es copia" desde el panel lo saca de la lista', () => {
        const [, item] = findLoanRecordDuplicates(state.employees).loans;
        dismissLoanDuplicateGroup('e1', item.groups[0].key);
        expect(renderLoanDuplicateReview({ scope: 'general', employees: state.employees })).toContain('1 abono');
        expect(renderLoanDuplicateReview({ scope: 'general', employees: state.employees })).not.toContain('refinanciamiento');
    });

    test('sin repetidos no se muestra nada', () => {
        expect(renderLoanDuplicateReview({ scope: 'general', employees: [emp('e2', [loan('X')])] })).toBe('');
    });
});
