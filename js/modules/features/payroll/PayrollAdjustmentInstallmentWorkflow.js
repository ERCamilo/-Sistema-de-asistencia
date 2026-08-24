import { formatDateShort } from '../../utils/DateUtils.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans,
    isPayrollAdjustmentInstallmentPlan
} from './PayrollAdjustmentInstallmentPlan.js';
import { attachPayrollAdjustmentPlans } from './PayrollAdjustmentPlanRepository.js';

const VALID_KINDS = new Set(Object.values(ADJUSTMENT_PLAN_KIND));

function validateDraft(kind, draft) {
    if (!VALID_KINDS.has(kind)) {
        throw new Error('El ajuste debe ser una bonificación o una deducción');
    }
    if (!draft?.remembered) {
        throw new Error('Activa Guardar para crear el pago programado');
    }
    if (draft.type !== 'fixed') {
        throw new Error('Dividir en cuotas solo está disponible para monto fijo');
    }
    if (draft.scope !== 'employee') {
        throw new Error('Dividir en cuotas solo está disponible para ajustes individuales');
    }
}

export function filterLegacyEmployeeAdjustments(adjustments) {
    return (Array.isArray(adjustments) ? adjustments : [])
        .filter(adjustment => !isPayrollAdjustmentInstallmentPlan(adjustment));
}

export function buildPayrollAdjustmentInstallmentSave(input = {}, dependencies = {}) {
    const { employees, kind, draft, createdAt } = input;
    validateDraft(kind, draft);

    const plans = createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds: draft.targetIds,
        name: draft.name,
        totalAmount: draft.value,
        installmentCount: draft.installmentsEnabled ? draft.installmentCount : 1,
        singlePayment: !draft.installmentsEnabled,
        firstPeriodStart: draft.firstPeriodStart,
        type: draft.type,
        scope: draft.scope,
        createdAt
    }, dependencies);
    const nextEmployees = attachPayrollAdjustmentPlans(employees, plans);
    const noun = draft.installmentsEnabled
        ? kind === ADJUSTMENT_PLAN_KIND.BONUS
            ? (plans.length === 1 ? 'bonificación a cuotas' : 'bonificaciones a cuotas')
            : (plans.length === 1 ? 'deducción a cuotas' : 'deducciones a cuotas')
        : (plans.length === 1 ? 'pago programado' : 'pagos programados');

    return {
        employees: nextEmployees,
        plans,
        notice: `Se guardaron ${plans.length} ${noun}. Comenzarán en la nómina del ${formatDateShort(plans[0].firstPeriodStart)}.`
    };
}
