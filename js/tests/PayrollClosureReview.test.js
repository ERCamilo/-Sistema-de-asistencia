import {
    buildClosureReview,
    DUPLICATE_CLOSURE_VOID_REASON,
    findDuplicateClosureGroups,
    findPeriodsWithoutClosure,
    reviewClosure,
    voidDuplicatePayrollClosure
} from '../modules/features/payroll/PayrollClosureReview.js';
import { undoPayrollClosureEffects } from '../modules/features/payroll/PayrollClosureWorkflow.js';

// Cuadrícula real de la obra: periodos de 21 días, pago 2 días después del fin.
const PAY_PERIOD = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };
const TODAY = '2026-10-07';

function row(employeeId, loans = 0) {
    return { employeeId, employeeNumber: employeeId, gross: 100, bonuses: 0, deductions: 0, loans, net: 100 - loans };
}

function closure(overrides = {}) {
    return {
        schemaVersion: 3,
        projectId: 'PRJ-a',
        id: 'PAYROLL-CLOSURE-x',
        fingerprint: 'fp-x',
        status: 'closed',
        periodStart: '2026-07-31',
        periodEnd: '2026-08-20',
        closedAt: new Date(2026, 7, 22, 11, 55).getTime(),
        totals: { gross: 200, bonuses: 0, deductions: 0, loans: 0, net: 200 },
        employeeCount: 2,
        rows: [row('e1'), row('e2')],
        loanSettlementBatchId: null,
        paymentRefs: [],
        supersedesId: null,
        ...overrides
    };
}

// Copia legacy (schema 2, sin obra) y copia recuperada (schema 3, con obra y
// recovery.sourceId) del mismo cierre 31/07–20/08: comparten el lote de abonos.
const legacy = closure({
    schemaVersion: 2,
    projectId: undefined,
    id: 'PAYROLL-CLOSURE-legacy',
    fingerprint: 'fp-legacy',
    totals: { gross: 200, bonuses: 0, deductions: 0, loans: 70, net: 130 },
    rows: [row('e1', 50), row('e2', 20)],
    loanSettlementBatchId: 'PAYROLL-BATCH-legacy'
});
delete legacy.projectId;
const recovered = closure({
    id: 'PAYROLL-CLOSURE-copy',
    fingerprint: 'fp-copy',
    totals: legacy.totals,
    rows: legacy.rows,
    loanSettlementBatchId: 'PAYROLL-BATCH-legacy',
    recovery: { sourceId: 'PAYROLL-CLOSURE-legacy' }
});
// Cierre de prueba del 11/09–01/10 guardado el 11/09 sin préstamos.
const early = closure({
    id: 'PAYROLL-CLOSURE-early',
    fingerprint: 'fp-early',
    periodStart: '2026-09-11',
    periodEnd: '2026-10-01',
    closedAt: new Date(2026, 8, 11, 7, 1).getTime(),
    totals: { gross: 50, bonuses: 200, deductions: 0, loans: 0, net: 250 },
    rows: [row('e1')],
    employeeCount: 1
});
// Corrido un día respecto a la cuadrícula (10/07–30/07).
const offGrid = closure({
    id: 'PAYROLL-CLOSURE-offgrid',
    fingerprint: 'fp-offgrid',
    periodStart: '2026-07-09',
    periodEnd: '2026-07-29',
    closedAt: new Date(2026, 7, 22, 23, 12).getTime()
});
const voided = closure({
    id: 'PAYROLL-CLOSURE-voided',
    fingerprint: 'fp-voided',
    status: 'voided',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-23'
});

function payment(id, amount, overrides = {}) {
    return { id, amount, date: '2026-10-03', origin: 'payroll', voided: false, ...overrides };
}

function employees() {
    return [{
        id: 'e1',
        loans: [{
            id: 'l1',
            payments: [
                payment('p-linked-1', 50, {
                    payrollPeriodStart: '2026-07-31', payrollPeriodEnd: '2026-08-20',
                    payrollClosureId: 'PAYROLL-CLOSURE-copy', payrollBatchId: 'PAYROLL-BATCH-legacy'
                }),
                payment('p-sep-1', 30, { payrollPeriodStart: '2026-09-11', payrollPeriodEnd: '2026-10-01' }),
                payment('p-sep-conv', 15, { origin: 'conversion', payrollPeriodStart: '2026-09-11', payrollPeriodEnd: '2026-10-01' }),
                payment('p-sep-void', 99, { voided: true, payrollPeriodStart: '2026-09-11', payrollPeriodEnd: '2026-10-01' }),
                payment('p-aug-1', 40, { payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10' }),
                payment('p-direct', 7, { origin: 'direct' })
            ]
        }]
    }, {
        id: 'e2',
        loans: [{
            id: 'l2',
            payments: [
                payment('p-linked-2', 20, {
                    payrollPeriodStart: '2026-07-31', payrollPeriodEnd: '2026-08-20',
                    payrollClosureId: 'PAYROLL-CLOSURE-copy', payrollBatchId: 'PAYROLL-BATCH-legacy'
                }),
                payment('p-sep-2', 25, { payrollPeriodStart: '2026-09-11', payrollPeriodEnd: '2026-10-01' }),
                // En efectivo o por transferencia: no pertenecen a un cierre de nómina.
                payment('p-sep-cash', 500, { channel: 'cash', payrollPeriodStart: '2026-09-11', payrollPeriodEnd: '2026-10-01' }),
                payment('p-aug-transfer', 300, { channel: 'transfer', payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10' }),
                payment('p-aug-2', 10, { payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10' })
            ]
        }]
    }];
}

const allClosures = () => [legacy, voided, early, recovered, offGrid];

describe('PayrollClosureReview', () => {
    test('groups copies that share a loan batch and keeps the one the payments reference', () => {
        const groups = findDuplicateClosureGroups(allClosures(), employees());

        expect(groups).toHaveLength(1);
        expect(groups[0].keep.id).toBe('PAYROLL-CLOSURE-copy');
        expect(groups[0].duplicates.map(item => item.id)).toEqual(['PAYROLL-CLOSURE-legacy']);
        expect(groups[0].paymentsCount).toBe(2);
        expect(groups[0].loansTotal).toBe(70);
    });

    test('without payment references keeps the project closure, then the newest', () => {
        const [byProject] = findDuplicateClosureGroups([legacy, recovered], []);
        expect(byProject.keep.id).toBe('PAYROLL-CLOSURE-copy');

        const older = closure({ id: 'A', loanSettlementBatchId: 'B-1', closedAt: 1 });
        const newer = closure({ id: 'B', loanSettlementBatchId: 'B-1', closedAt: 2 });
        expect(findDuplicateClosureGroups([older, newer], [])[0].keep.id).toBe('B');
    });

    test('same period and content is a copy even without a loan batch; corrections are not', () => {
        const first = closure({ id: 'A' });
        const second = closure({ id: 'B', closedAt: first.closedAt + 1 });
        expect(findDuplicateClosureGroups([first, second], [])[0].duplicates.map(item => item.id)).toEqual(['A']);

        const correction = closure({ id: 'C', supersedesId: 'A' });
        expect(findDuplicateClosureGroups([first, correction], [])).toEqual([]);
    });

    test('flags a closure saved before its period ended and without the hand-entered payments', () => {
        const flags = reviewClosure(early, { employees: employees(), payPeriod: PAY_PERIOD });

        expect(flags.closedBeforePeriodEnd).toEqual({ closedOn: '2026-09-11' });
        expect(flags.missingPeriodLoans).toEqual({ count: 3, total: 70, employeeCount: 2 });
        expect(flags.offGrid).toBeNull();
        expect(flags.needsReview).toBe(true);
    });

    test('flags off-grid dates with the nearest grid period, as information only', () => {
        const flags = reviewClosure(offGrid, { employees: employees(), payPeriod: PAY_PERIOD });

        expect(flags.offGrid).toEqual({ periodStart: '2026-07-10', periodEnd: '2026-07-30', label: '10/07 – 30/07' });
        expect(flags.needsReview).toBe(false);
    });

    test('cash and transfer payments never count as missing payroll loans', () => {
        const people = employees();
        for (const item of people.flatMap(employee => employee.loans[0].payments)) {
            if (item.payrollPeriodStart === '2026-09-11') item.channel = 'cash';
        }
        expect(reviewClosure(early, { employees: people, payPeriod: PAY_PERIOD }).missingPeriodLoans).toBeNull();
    });

    test('voided closures are not reviewed', () => {
        const flags = reviewClosure(voided, { employees: employees(), payPeriod: PAY_PERIOD });
        expect(flags).toEqual(expect.objectContaining({
            closedBeforePeriodEnd: null, missingPeriodLoans: null, offGrid: null, needsReview: false
        }));
    });

    test('lists finished grid periods without a valid closure, newest first', () => {
        const periods = findPeriodsWithoutClosure({
            employees: employees(),
            closures: allClosures(),
            payPeriod: PAY_PERIOD,
            today: TODAY
        });

        expect(periods.map(period => [period.periodStart, period.periodEnd, period.payDate])).toEqual([
            ['2026-09-11', '2026-10-01', '2026-10-03'],
            ['2026-08-21', '2026-09-10', '2026-09-12']
        ]);
        expect(periods[0]).toEqual(expect.objectContaining({
            paymentsCount: 3, paymentsTotal: 70, employeeCount: 2
        }));
        expect(periods[0].replaceableClosure.id).toBe('PAYROLL-CLOSURE-early');
        expect(periods[1]).toEqual(expect.objectContaining({
            paymentsCount: 2, paymentsTotal: 50, replaceableClosure: null
        }));
    });

    test('starts at the first period with payroll payments and skips the current period', () => {
        const people = [{
            id: 'e1',
            loans: [{ id: 'l1', payments: [payment('old', 5, { payrollPeriodStart: '2026-07-10', payrollPeriodEnd: '2026-07-30' })] }]
        }];
        const periods = findPeriodsWithoutClosure({ employees: people, closures: [], payPeriod: PAY_PERIOD, today: TODAY });
        expect(periods.map(period => period.periodStart)).toEqual([
            '2026-09-11', '2026-08-21', '2026-07-31', '2026-07-10'
        ]);
        expect(findPeriodsWithoutClosure({ employees: people, closures: [], payPeriod: null, today: TODAY })).toEqual([]);
    });

    test('builds the review: duplicate first, then the closure to replace, plus card flags', () => {
        const review = buildClosureReview({
            closures: allClosures(),
            employees: employees(),
            payPeriod: PAY_PERIOD,
            today: TODAY
        });

        expect(review.issues.map(issue => [issue.kind, issue.closureId])).toEqual([
            ['duplicate', 'PAYROLL-CLOSURE-legacy'],
            ['replace', 'PAYROLL-CLOSURE-early']
        ]);
        expect(review.issues[1]).toEqual(expect.objectContaining({ payDate: '2026-10-03', paymentsCount: 3 }));
        expect(review.cardFlags.get('PAYROLL-CLOSURE-legacy').duplicateOf).toBe('PAYROLL-CLOSURE-copy');
        expect(review.cardFlags.get('PAYROLL-CLOSURE-copy').needsReview).toBe(false);
        expect(review.cardFlags.get('PAYROLL-CLOSURE-offgrid').offGrid.label).toBe('10/07 – 30/07');
        expect(review.periodsWithoutClosure).toHaveLength(2);
    });

    test('a superseded closure is marked as replaced and no longer reviewed', () => {
        const replacement = closure({
            id: 'PAYROLL-CLOSURE-new',
            periodStart: '2026-09-11',
            periodEnd: '2026-10-01',
            closedAt: new Date(2026, 9, 7, 10).getTime(),
            supersedesId: 'PAYROLL-CLOSURE-early',
            totals: { gross: 200, bonuses: 0, deductions: 0, loans: 70, net: 130 }
        });
        const review = buildClosureReview({
            closures: [early, replacement],
            employees: employees(),
            payPeriod: PAY_PERIOD,
            today: TODAY
        });
        expect(review.cardFlags.get('PAYROLL-CLOSURE-early')).toEqual(expect.objectContaining({ superseded: true, needsReview: false }));
        expect(review.issues.filter(issue => issue.kind === 'replace')).toEqual([]);
    });

    test('voiding a duplicate only voids that record with reason «Copia repetida»', () => {
        const people = employees();
        const before = JSON.stringify(people);
        const result = voidDuplicatePayrollClosure(legacy, {
            closures: allClosures(),
            employees: people,
            now: 1234,
            voidedBy: 'operator'
        });

        expect(result).toEqual(expect.objectContaining({
            id: 'PAYROLL-CLOSURE-legacy',
            status: 'voided',
            voidReason: DUPLICATE_CLOSURE_VOID_REASON,
            voidedAt: 1234,
            voidedBy: 'operator',
            loanSettlementBatchId: 'PAYROLL-BATCH-legacy'
        }));
        expect(JSON.stringify(people)).toBe(before);
    });

    test('refuses to void the kept copy or a closure that is no longer repeated', () => {
        expect(() => voidDuplicatePayrollClosure(recovered, { closures: allClosures(), employees: employees() }))
            .toThrow('ya no está repetido');
        expect(() => voidDuplicatePayrollClosure(legacy, {
            closures: [legacy, { ...recovered, status: 'voided' }],
            employees: employees()
        })).toThrow('ya no está repetido');
    });

    test('undo refuses while another closed closure shares the same loan batch', () => {
        expect(() => undoPayrollClosureEffects(employees(), recovered, {
            activeClosures: [legacy, recovered]
        })).toThrow('Este cierre comparte sus abonos con otro cierre del mismo periodo. Quita primero la copia repetida.');
    });
});
