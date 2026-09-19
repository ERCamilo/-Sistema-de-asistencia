import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope, DEFAULT_PROJECT_LS_KEY } from '../modules/features/projects/EntityProjectScope.js';
import { buildPayrollClosureDraft } from '../modules/features/payroll/PayrollClosureWorkflow.js';
import { buildPayrollLoanSettlementBatch } from '../modules/features/payroll/PayrollLoanSettlement.js';
import { createPayrollAdjustmentInstallmentPlans } from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { attachPayrollAdjustmentPlans } from '../modules/features/payroll/PayrollAdjustmentPlanRepository.js';

const DEFAULT = 'PRJ-DEFAULT-LEGACY';
const OTHER = 'PRJ-OTHER-LEGACY';

function setScope(projectId) {
    localStorage.setItem(DEFAULT_PROJECT_LS_KEY, DEFAULT);
    replaceEntityScope({ enabled: true, projectId, defaultProjectId: DEFAULT });
}

function legacyEmployee() {
    return {
        id: 'LEGACY-EMP-12', number: '12', name: 'Legacy', active: true,
        bonuses: [], deductions: [], loans: [{ id: 'L-1', concept: 'Legacy loan', principal: 100, total: 100, amount: 100, status: 'active', payments: [], startDate: '2026-09-01' }]
    };
}

function row(employee, loans = 0) {
    return {
        id: employee.id, nombre: employee.name, monto: 1000 - loans,
        _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: loans,
        _employeeId: employee.id, _employeeName: employee.name, _number: employee.number,
        _positionBreakdown: [],
        _loanDetails: loans ? [{ loanId: 'L-1', concept: 'Legacy loan', installmentMode: 'single', balance: 100, selectedAmount: 100, selectedCharges: [{ kind: 'lump', amount: 100, dueDate: '2026-09-01', isInstallment: false, isDue: true }] }] : []
    };
}
describe('Tanda B legacy ownership — legacy entities belong only to the default project', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('closure and payroll-loan settlement reject a legacy employee from a non-default project', () => {
        const employee = legacyEmployee();
        setScope(OTHER);
        expect(() => buildPayrollClosureDraft({ employees: [employee], rows: [row(employee)], periodStart: '2026-09-01', periodEnd: '2026-09-15', projectId: OTHER })).toThrow();
        expect(() => buildPayrollLoanSettlementBatch({ employees: [employee], rows: [row(employee, 100)], periodStart: '2026-09-01', periodEnd: '2026-09-15', projectId: OTHER })).toThrow();
    });

    test('legacy employee remains valid in the default project', () => {
        const employee = legacyEmployee();
        setScope(DEFAULT);
        expect(() => buildPayrollClosureDraft({ employees: [employee], rows: [row(employee)], periodStart: '2026-09-01', periodEnd: '2026-09-15', projectId: DEFAULT })).not.toThrow();
        expect(() => buildPayrollLoanSettlementBatch({ employees: [employee], rows: [row(employee, 100)], periodStart: '2026-09-01', periodEnd: '2026-09-15', projectId: DEFAULT })).not.toThrow();
    });

    test('adjustment attachment rejects legacy employee outside default project and accepts it in default', () => {
        const employee = legacyEmployee();
        const [plan] = createPayrollAdjustmentInstallmentPlans({ kind: 'deductions', employeeIds: [employee.id], name: 'Legacy deduction', totalAmount: 50, installmentCount: 1, singlePayment: true, firstPeriodStart: '2026-09-01', createdAt: 1, projectId: OTHER }, { createId: prefix => `${prefix}-legacy` });
        setScope(OTHER);
        expect(() => attachPayrollAdjustmentPlans([employee], [plan], { projectId: OTHER })).toThrow();
        const [defaultPlan] = createPayrollAdjustmentInstallmentPlans({ kind: 'deductions', employeeIds: [employee.id], name: 'Default deduction', totalAmount: 50, installmentCount: 1, singlePayment: true, firstPeriodStart: '2026-09-01', createdAt: 1, projectId: DEFAULT }, { createId: prefix => `${prefix}-default` });
        setScope(DEFAULT);
        expect(() => attachPayrollAdjustmentPlans([employee], [defaultPlan], { projectId: DEFAULT })).not.toThrow();
    });
});