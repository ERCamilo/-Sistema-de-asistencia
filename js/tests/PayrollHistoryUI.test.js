import fs from 'fs';
import path from 'path';
import {
    calculatePayrollHistoryNet,
    filterPayrollClosureHistory,
    renderPayrollHistoryDetail,
    renderPayrollHistoryView
} from '../modules/features/payroll/PayrollHistoryUI.js';

const PAYROLL_UI_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollUI.js'),
    'utf8'
);
const PAYROLL_CSS_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../css/payroll-redesign.css'),
    'utf8'
);

function closure(overrides = {}) {
    return {
        id: 'closure-1',
        status: 'closed',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        closedAt: Date.now(),
        closedBy: 'operator@example.com',
        undoUntil: Date.now() + 30_000,
        employeeCount: 1,
        totals: { gross: 1200, bonuses: 0, deductions: 100, loans: 100, net: 1000 },
        rows: [{
            employeeId: 'employee-1',
            employeeNumber: '1',
            employeeName: 'Ada',
            employeePosition: 'Operadora',
            gross: 1200,
            bonuses: 0,
            deductions: 100,
            loans: 100,
            net: 1000
        }],
        paymentRefs: [{ employeeId: 'employee-1', loanId: 'loan-1', amount: 100 }],
        ...overrides
    };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('Payroll history UI', () => {
    test('filters immutable closures by status and overlapping payroll period', () => {
        const items = [
            closure(),
            closure({ id: 'voided', status: 'voided', periodStart: '2026-07-01', periodEnd: '2026-07-15' })
        ];
        expect(filterPayrollClosureHistory(items, {
            status: 'closed',
            periodStart: '2026-08-10',
            periodEnd: '2026-08-31'
        }).map(item => item.id)).toEqual(['closure-1']);
    });

    test('renders at most ten summaries with cursor page navigation', () => {
        const items = Array.from({ length: 12 }, (_, index) => closure({ id: `closure-${index}` }));
        document.body.innerHTML = renderPayrollHistoryView({
            items,
            nextCursor: { closedAt: 1, id: 'next' },
            page: 2,
            hasPrevious: true,
            filters: { status: 'closed', periodStart: '', periodEnd: '' }
        });
        expect(document.querySelector('[data-payroll-history-filter="status"]').value).toBe('closed');
        expect(document.querySelectorAll('.payroll-history-card')).toHaveLength(10);
        expect(document.querySelector('[data-payroll-action="open-payroll-history-detail"]')?.tagName)
            .toBe('BUTTON');
        expect(document.querySelector('[data-payroll-action="previous-payroll-history-page"]'))
            .not.toBeNull();
        expect(document.querySelector('[data-payroll-action="next-payroll-history-page"]'))
            .not.toBeNull();
        expect(document.body.textContent).toContain('Página 2');
    });

    test('renders an immutable responsive detail and hides empty financial columns', () => {
        document.body.innerHTML = renderPayrollHistoryDetail(closure(), { now: Date.now() });
        const table = document.querySelector('.payroll-history-detail__table');
        expect(table.textContent).toContain('Préstamos');
        expect(table.textContent).toContain('Deducciones');
        expect(table.textContent).not.toContain('Bonificaciones');
        expect(table.querySelector('.is-loan')).not.toBeNull();
        expect(document.body.textContent).toContain('registro histórico inmutable');
        expect(document.querySelector('[data-payroll-action="undo-payroll-closure"]')).not.toBeNull();
    });

    test('escapes frozen employee and operator labels', () => {
        document.body.innerHTML = renderPayrollHistoryDetail(closure({
            closedBy: '<img src=x onerror=alert(1)>',
            rows: [{
                employeeId: 'x', employeeNumber: '9', employeeName: '<svg onload=alert(1)>',
                employeePosition: '<b>Admin</b>', gross: 1, bonuses: 0, deductions: 0, loans: 0, net: 1
            }]
        }));
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('svg')).toBeNull();
        expect(document.body.textContent).toContain('<svg onload=alert(1)>');
    });

    test('uses frozen organization data, number order and current-number references', () => {
        const first = closure().rows[0];
        document.body.innerHTML = renderPayrollHistoryDetail(closure({
            employeeCount: 2,
            rows: [
                { ...first, employeeId: 'employee-10', employeeNumber: '10', employeeName: 'Zoe' },
                {
                    ...first,
                    employeeId: 'employee-1',
                    employeeNumber: '2',
                    employeeName: 'Ada',
                    employeePosition: 'Ayudante histórica',
                    leaderRefs: [{ id: 'leader-1', number: '7', name: 'Marta histórica' }]
                }
            ]
        }), {
            currentEmployees: [{ id: 'employee-1', number: '99', name: 'Ada actual' }]
        });

        const employeeCells = [...document.querySelectorAll('tbody th')];
        expect(employeeCells[0].textContent).toContain('#2');
        expect(employeeCells[0].textContent).toContain('Actual #99');
        expect(document.body.textContent).toContain('Ayudante histórica');
        expect(document.body.textContent).toContain('Marta histórica');
    });

    test('filters historical employees by frozen leader and simulates net components', () => {
        const base = closure().rows[0];
        const detail = closure({
            employeeCount: 2,
            rows: [
                { ...base, employeeId: 'one', employeeNumber: '1', leaderRefs: [{ id: 'leader-1', name: 'Marta' }] },
                { ...base, employeeId: 'two', employeeNumber: '2', employeeName: 'Grace', leaderRefs: [{ id: 'leader-2', name: 'Linus' }] }
            ]
        });
        document.body.innerHTML = renderPayrollHistoryDetail(detail, {
            detailFilters: {
                leaderId: 'leader-1',
                includeBonuses: false,
                includeDeductions: false,
                includeLoans: false
            }
        });

        expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(document.body.textContent).not.toContain('Grace');
        expect(document.body.textContent).toContain('Neto simulado');
        expect(calculatePayrollHistoryNet(base, {
            includeBonuses: false,
            includeDeductions: false,
            includeLoans: false
        })).toBe(1200);
        expect(document.querySelector('[data-payroll-history-detail-filter="leaderId"]').value)
            .toBe('leader-1');
    });

    test('wires a third top-level mode, delegated controls and mobile layout', () => {
        expect(PAYROLL_UI_SOURCE).toContain("data-value=\"history\"");
        expect(PAYROLL_UI_SOURCE).toContain("mode === 'history'");
        expect(PAYROLL_UI_SOURCE).toContain("'open-payroll-history-detail'");
        expect(PAYROLL_UI_SOURCE).toContain('loadPayrollHistory');
        expect(PAYROLL_UI_SOURCE).toMatch(/payrollClosureSync\.pullPage\(\{[\s\S]*periodStart:[\s\S]*periodEnd:/);
        expect(PAYROLL_UI_SOURCE).toContain('loadPayrollHistory({ force: true })');
        expect(PAYROLL_UI_SOURCE).toContain('queueMicrotask(() => loadPayrollHistory())');
        expect(PAYROLL_UI_SOURCE).toContain('payrollClosureSync.pullPage({');
        expect(PAYROLL_UI_SOURCE).toContain('limit: 10');
        expect(PAYROLL_UI_SOURCE).toContain('payrollClosureSync.pullDetail(id)');
        expect(PAYROLL_UI_SOURCE).toContain('payrollClosureSync.pullPeriod(');
        expect(PAYROLL_UI_SOURCE).toContain('focusPayrollHistoryControl');
        expect(PAYROLL_UI_SOURCE).toContain('setPayrollHistoryDetailFilter');
        expect(PAYROLL_CSS_SOURCE).toMatch(/@media[^}]*max-width:\s*700px[\s\S]*\.payroll-history/m);
    });
});
