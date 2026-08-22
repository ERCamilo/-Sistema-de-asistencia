jest.mock('../modules/core/RenderManager.js', () => ({
    render: jest.fn()
}));

jest.mock('../modules/services/PersistenceService.js', () => ({
    saveApplicationData: jest.fn()
}));

import { state } from '../modules/core/AppState.js';
import { render } from '../modules/core/RenderManager.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import {
    openManualAdjustmentMovement,
    openManualAdjustmentMovementAt,
    recordManualAdjustmentMovement
} from '../modules/features/profile/ProfileController.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';

function seed(kind = ADJUSTMENT_PLAN_KIND.DEDUCTION) {
    let serial = 0;
    const plan = createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds: ['EMP-1'],
        name: kind === ADJUSTMENT_PLAN_KIND.BONUS ? 'Premio' : 'Uniforme',
        totalAmount: 90,
        installmentCount: 3,
        firstPeriodStart: '2026-08-01',
        createdAt: 100
    }, { createId: prefix => `${prefix}-${kind}-${++serial}` })[0];
    const employee = {
        id: 'EMP-1', name: 'Ada', bonuses: [], deductions: [], updatedAt: 50
    };
    employee[kind] = [plan];
    state.employees = [employee];
    state.employeeProfile = {
        employeeId: 'EMP-1',
        activeTab: 'nomina',
        bonuses: JSON.parse(JSON.stringify(employee.bonuses)),
        deductions: JSON.parse(JSON.stringify(employee.deductions))
    };
    state.showEmployeeProfile = true;
    return plan;
}

function movement(plan, overrides = {}) {
    return {
        id: 'MANUAL-UI-1',
        amount: 10,
        date: '2026-08-10',
        recordedBy: 'María',
        note: 'Pago recibido',
        ...overrides
    };
}

describe('Employee profile manual adjustment persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.showNotification = jest.fn();
        window.currentUser = null;
        saveApplicationData.mockResolvedValue({ localOk: true, cloudRequested: true });
    });

    test('prefills a trustworthy signed-in identity and invents none without a user', () => {
        const plan = seed();
        window.currentUser = { displayName: 'Operadora Uno', email: 'operadora@example.com' };

        openManualAdjustmentMovement(plan.kind, plan.id);
        expect(state.employeeProfile.manualAdjustmentDraft).toMatchObject({
            kind: plan.kind,
            planId: plan.id,
            recordedBy: 'Operadora Uno'
        });

        window.currentUser = null;
        openManualAdjustmentMovement(plan.kind, plan.id);
        expect(state.employeeProfile.manualAdjustmentDraft.recordedBy).toBe('');
    });

    test('resolves the ephemeral profile index to the correct saved plan', () => {
        const deduction = seed();
        let serial = 0;
        const [bonus] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            employeeIds: ['EMP-1'],
            name: 'Premio',
            totalAmount: 60,
            installmentCount: 2,
            firstPeriodStart: '2026-08-01',
            createdAt: 100
        }, { createId: prefix => `${prefix}-bonus-index-${++serial}` });
        state.employees[0].bonuses = [bonus];
        state.employeeProfile.bonuses = JSON.parse(JSON.stringify([bonus]));

        expect(openManualAdjustmentMovementAt('0')).toBe(true);
        expect(state.employeeProfile.manualAdjustmentDraft).toMatchObject({
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            planId: bonus.id
        });

        expect(openManualAdjustmentMovementAt('1')).toBe(true);
        expect(state.employeeProfile.manualAdjustmentDraft).toMatchObject({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            planId: deduction.id
        });
    });

    test('rolls back master and profile memory when durable local persistence fails', async () => {
        const plan = seed();
        const originalEmployees = JSON.parse(JSON.stringify(state.employees));
        const originalProfile = JSON.parse(JSON.stringify(state.employeeProfile.deductions));
        saveApplicationData.mockResolvedValueOnce({ localOk: false, cloudRequested: false });

        const result = await recordManualAdjustmentMovement(
            plan.kind, plan.id, movement(plan)
        );

        expect(result).toBe(false);
        expect(state.employees).toEqual(originalEmployees);
        expect(state.employeeProfile.deductions).toEqual(originalProfile);
        expect(saveApplicationData).toHaveBeenCalledWith({
            immediate: true,
            announce: false,
            requireLocalSuccess: true
        });
        expect(window.showNotification).toHaveBeenCalledWith(
            'No se pudo guardar el movimiento en este dispositivo. No se realizó ningún cambio.',
            'error'
        );
    });

    test('keeps the durable movement when rendering fails after local commit', async () => {
        const plan = seed(ADJUSTMENT_PLAN_KIND.BONUS);
        render.mockImplementationOnce(() => {
            throw new Error('render failed after commit');
        });

        await expect(recordManualAdjustmentMovement(
            plan.kind, plan.id, movement(plan)
        )).rejects.toThrow('render failed after commit');

        expect(state.employees[0].bonuses[0]).toMatchObject({
            appliedAmount: 10, balance: 80
        });
        expect(state.employees[0].bonuses[0].history).toHaveLength(1);
        expect(saveApplicationData).toHaveBeenCalledTimes(1);
        expect(window.showNotification).toHaveBeenCalledWith(
            'Entrega registrada y guardada.', 'success'
        );
    });
});
