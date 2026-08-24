import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import {
    ADJUSTMENT_INSTALLMENT_STATUS,
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    getPayrollAdjustmentInstallmentRemainingAmount,
    isPayrollAdjustmentInstallmentPlan
} from './PayrollAdjustmentInstallmentPlan.js';
import {
    buildPayrollAdjustmentPeriodSelectionOptions
} from './PayrollAdjustmentPeriodSelection.js';
import { hasPayrollAdjustmentPlanMovement } from './PayrollAdjustmentCancellation.js';

const KIND_META = Object.freeze({
    [ADJUSTMENT_PLAN_KIND.BONUS]: {
        label: 'Bonificación',
        emptyLabel: 'No hay bonificaciones programadas.'
    },
    [ADJUSTMENT_PLAN_KIND.DEDUCTION]: {
        label: 'Descuento',
        emptyLabel: 'No hay descuentos programados.'
    }
});

const scheduledActionReferences = new Map();
const scheduledProjectionRevisions = new Map();
let scheduledActionSequence = 0;

function beginScheduledProjection(kind) {
    const revision = (scheduledProjectionRevisions.get(kind) || 0) + 1;
    scheduledProjectionRevisions.set(kind, revision);
    for (const [token, reference] of scheduledActionReferences) {
        if (reference.kind === kind) scheduledActionReferences.delete(token);
    }
    return revision;
}

function registerScheduledActionReference(kind, item, projectionRevision) {
    const token = `scheduled-action-${++scheduledActionSequence}`;
    scheduledActionReferences.set(token, Object.freeze({
        referenceType: 'plan',
        kind,
        planId: text(item.planId),
        employeeId: text(item.employeeId),
        groupId: text(item.groupId),
        updatedAt: Number(item.updatedAt),
        currentPayrollTotal: money(item.periodSelection?.total),
        periodStart: text(item.periodSelection?.periodStart),
        periodEnd: text(item.periodSelection?.periodEnd),
        projectionRevision
    }));
    return token;
}

function registerScheduledGroupReference(group, projectionRevision) {
    const token = `scheduled-action-${++scheduledActionSequence}`;
    const members = group.employees
        .filter(item => item.periodSelection)
        .map(item => Object.freeze({
            planId: text(item.planId),
            employeeId: text(item.employeeId)
        }));
    const cancellationMembers = group.employees
        .filter(item => item.canRemove)
        .map(item => Object.freeze({
            planId: text(item.planId),
            employeeId: text(item.employeeId),
            groupId: text(item.groupId),
            updatedAt: Number(item.updatedAt),
            currentPayrollTotal: money(item.periodSelection?.total)
        }));
    scheduledActionReferences.set(token, Object.freeze({
        referenceType: 'group',
        kind: group.kind,
        groupId: text(group.groupId),
        periodStart: text(group.periodStart),
        periodEnd: text(group.periodEnd),
        members: Object.freeze(members),
        cancellationMembers: Object.freeze(cancellationMembers),
        projectionRevision
    }));
    return token;
}

export function resolveScheduledActionReference(token) {
    const reference = scheduledActionReferences.get(text(token));
    if (!reference || scheduledProjectionRevisions.get(reference.kind) !== reference.projectionRevision) {
        return null;
    }
    return {
        ...reference,
        members: reference.members?.map(member => ({ ...member })),
        cancellationMembers: reference.cancellationMembers?.map(member => ({ ...member }))
    };
}

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function safe(value) {
    return escapeHTML(text(value));
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function formatDate(value) {
    if (value === null || value === undefined || value === '') return 'Fecha no disponible';
    if (typeof value === 'string') {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    }
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
    return [
        String(date.getUTCDate()).padStart(2, '0'),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        date.getUTCFullYear()
    ].join('/');
}

function payrollLabel(entry) {
    if (entry.source === 'manual') return 'Registro manual';
    const start = text(entry.payrollPeriodStart);
    const end = text(entry.payrollPeriodEnd);
    if (start && end) return `Nómina del ${formatDate(start)} al ${formatDate(end)}`;
    if (start) return `Nómina desde ${formatDate(start)}`;
    return entry.payrollClosureId ? 'Nómina registrada' : 'Sin nómina asociada';
}

function projectHistory(plan) {
    const installmentById = new Map((plan.installments || []).map(item => [text(item?.id), item]));
    return (plan.history || [])
        .filter(entry => entry && (
            text(entry.installmentId) ||
            (entry.source === 'manual' && Array.isArray(entry.allocations))
        ))
        .map(entry => {
            const allocationSequences = (entry.allocations || [])
                .map(item => Number(item?.sequence) || 0)
                .filter(Boolean);
            const sequence = Number(entry.sequence) || allocationSequences[0] || Number(
                installmentById.get(text(entry.installmentId))?.sequence
            ) || 0;
            return {
            sequence,
            sequenceLabel: allocationSequences.length > 1
                ? allocationSequences.join(', ')
                : String(sequence || '—'),
            amount: money(entry.amount),
            dateLabel: formatDate(entry.date ?? entry.recordedAt ?? entry.updatedAt),
            payrollLabel: payrollLabel(entry),
            statusLabel: entry.voided === true
                ? 'Revertida'
                : entry.source === 'manual'
                    ? 'Registrado'
                    : entry.action === 'applied' ? 'Aplicada' : 'Registrada',
            source: entry.source === 'manual' ? 'manual' : 'payroll',
            recordedBy: text(entry.recordedBy) || null,
            note: text(entry.note) || null,
            recordedAt: Number(entry.recordedAt ?? entry.updatedAt) || 0
            };
        })
        .sort((left, right) => right.recordedAt - left.recordedAt || right.sequence - left.sequence);
}

function nextInstallment(plan) {
    const installment = [...(plan.installments || [])]
        .filter(item =>
            item?.status === ADJUSTMENT_INSTALLMENT_STATUS.PENDING &&
            getPayrollAdjustmentInstallmentRemainingAmount(item) > 0
        )
        .sort((left, right) =>
            (Number(left.sequence) || 0) - (Number(right.sequence) || 0)
        )[0];
    return installment ? {
        sequence: Number(installment.sequence) || 0,
        amount: getPayrollAdjustmentInstallmentRemainingAmount(installment)
    } : null;
}

function projectEmployee(plan, employeeById, selectionContext = {}) {
    const employee = employeeById.get(text(plan.employeeId));
    const { periodStart, periodEnd, selections = [] } = selectionContext;
    const periodEligible = Boolean(
        employee &&
        employee.active !== false &&
        plan.status === ADJUSTMENT_PLAN_STATUS.ACTIVE &&
        text(periodStart) &&
        text(periodEnd) &&
        text(periodStart) <= text(periodEnd) &&
        text(periodStart) >= text(plan.firstPeriodStart)
    );
    const periodSelection = periodEligible
        ? buildPayrollAdjustmentPeriodSelectionOptions(plan, {
            kind: plan.kind,
            employeeId: plan.employeeId,
            periodStart,
            periodEnd,
            selections
        })
        : null;
    return {
        planId: text(plan.id),
        groupId: text(plan.groupId),
        updatedAt: Number(plan.updatedAt),
        kind: plan.kind,
        planName: text(plan.name),
        firstPeriodStart: text(plan.firstPeriodStart),
        employeeId: text(plan.employeeId),
        name: employee?.name || 'Empleado no disponible',
        number: employee?.number ? text(employee.number) : null,
        isMissing: !employee,
        totalAmount: money(plan.totalAmount),
        appliedAmount: money(plan.appliedAmount),
        balance: money(plan.balance),
        installmentCount: Number(plan.installmentCount) || (plan.installments || []).length,
        appliedInstallments: Number(plan.appliedInstallments) || 0,
        nextInstallment: nextInstallment(plan),
        status: plan.status,
        statusLabel: plan.status === ADJUSTMENT_PLAN_STATUS.COMPLETED
            ? 'Completado'
            : plan.status === ADJUSTMENT_PLAN_STATUS.PAUSED
                ? 'Pausado'
                : plan.status === ADJUSTMENT_PLAN_STATUS.CANCELLED
                    ? 'Cancelado'
                    : 'En curso',
        canPause: plan.status === ADJUSTMENT_PLAN_STATUS.ACTIVE &&
            Number(plan.installmentCount) === 1 &&
            Number(plan.appliedInstallments) === 0,
        canResume: plan.status === ADJUSTMENT_PLAN_STATUS.PAUSED &&
            Number(plan.installmentCount) === 1 &&
            Number(plan.appliedInstallments) === 0,
        hasMovement: hasPayrollAdjustmentPlanMovement(plan),
        canRemove: Boolean(text(periodStart) && text(periodEnd)) &&
            [ADJUSTMENT_PLAN_STATUS.ACTIVE, ADJUSTMENT_PLAN_STATUS.PAUSED].includes(plan.status),
        periodSelection: periodSelection ? {
            ...periodSelection,
            periodStart: text(periodStart),
            periodEnd: text(periodEnd)
        } : null,
        cancellation: plan.cancellation ? { ...plan.cancellation } : null,
        history: projectHistory(plan)
    };
}

function sameValue(items, selector) {
    if (items.length === 0) return true;
    const first = selector(items[0]);
    return items.every(item => selector(item) === first);
}

export function buildScheduledAdjustmentGroups(kind, employees = [], {
    periodStart = '',
    periodEnd = '',
    selections = []
} = {}) {
    const meta = KIND_META[kind];
    if (!meta) return [];
    const employeeById = new Map((employees || []).map(employee => [text(employee?.id), employee]));
    const groups = new Map();
    const seenPlans = new Set();

    for (const holder of (employees || [])) {
        for (const plan of (Array.isArray(holder?.[kind]) ? holder[kind] : [])) {
            if (!isPayrollAdjustmentInstallmentPlan(plan) ||
                plan.kind !== kind ||
                ![
                    ADJUSTMENT_PLAN_STATUS.ACTIVE,
                    ADJUSTMENT_PLAN_STATUS.PAUSED,
                    ADJUSTMENT_PLAN_STATUS.COMPLETED,
                    ADJUSTMENT_PLAN_STATUS.CANCELLED
                ].includes(plan.status) ||
                !text(plan.groupId) ||
                !text(plan.employeeId) ||
                seenPlans.has(text(plan.id))) {
                continue;
            }
            seenPlans.add(text(plan.id));
            const key = text(plan.groupId);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(plan);
        }
    }

    return [...groups.entries()].map(([groupId, plans]) => {
        const projectedEmployees = plans.map(plan => projectEmployee(plan, employeeById, {
            periodStart,
            periodEnd,
            selections
        }))
            .sort((left, right) =>
                Number(left.isMissing) - Number(right.isMissing) ||
                text(left.number).localeCompare(text(right.number), 'es', { numeric: true }) ||
                left.name.localeCompare(right.name, 'es', { numeric: true })
            );
        const totalInstallments = projectedEmployees.reduce(
            (sum, item) => sum + item.installmentCount, 0
        );
        const appliedInstallments = projectedEmployees.reduce(
            (sum, item) => sum + item.appliedInstallments, 0
        );
        const hasDifferentTotals = !sameValue(projectedEmployees, item => item.totalAmount);
        const hasDifferentInstallmentCounts = !sameValue(
            projectedEmployees, item => item.installmentCount
        );
        const hasDifferentStartDates = !sameValue(plans, plan => text(plan.firstPeriodStart));
        const allCompleted = plans.every(plan => plan.status === ADJUSTMENT_PLAN_STATUS.COMPLETED);
        const allPaused = plans.every(plan => plan.status === ADJUSTMENT_PLAN_STATUS.PAUSED);
        const allCancelled = plans.every(plan => plan.status === ADJUSTMENT_PLAN_STATUS.CANCELLED);
        const hasCompleted = plans.some(plan => plan.status === ADJUSTMENT_PLAN_STATUS.COMPLETED);
        const removable = projectedEmployees.filter(item => item.canRemove);
        return {
            groupId,
            name: sameValue(plans, plan => text(plan.name))
                ? text(plans[0].name) || meta.label
                : 'Varios conceptos',
            kind,
            kindLabel: meta.label,
            employeeCount: projectedEmployees.length,
            totalPerEmployee: hasDifferentTotals ? null : projectedEmployees[0]?.totalAmount ?? 0,
            hasDifferentTotals,
            installmentCount: hasDifferentInstallmentCounts
                ? null
                : projectedEmployees[0]?.installmentCount ?? 0,
            hasDifferentInstallmentCounts,
            firstPeriodStart: hasDifferentStartDates ? null : text(plans[0].firstPeriodStart),
            hasDifferentStartDates,
            appliedInstallments,
            totalInstallments,
            progressPercent: totalInstallments > 0
                ? money((appliedInstallments / totalInstallments) * 100)
                : 0,
            progressLabel: totalInstallments === 1
                ? `${appliedInstallments} de 1 pago aplicado`
                : `${appliedInstallments} de ${totalInstallments} cuotas aplicadas`,
            statusLabel: allCompleted ? 'Completado' : allCancelled ? 'Cancelado' : allPaused ? 'Pausado' : 'En curso',
            periodStart: text(periodStart),
            periodEnd: text(periodEnd),
            currentPayrollTotal: money(projectedEmployees.reduce(
                (sum, item) => sum + (item.periodSelection?.total || 0), 0
            )),
            periodEligibleCount: projectedEmployees.filter(item => item.periodSelection).length,
            canRemove: !hasCompleted && removable.length > 0,
            removeActionLabel: removable.some(item => item.hasMovement)
                ? 'Cancelar programación'
                : 'Eliminar programación',
            employees: projectedEmployees
        };
    }).sort((left, right) =>
        left.name.localeCompare(right.name, 'es', { numeric: true }) ||
        left.groupId.localeCompare(right.groupId, 'es', { numeric: true })
    );
}


export function buildEmployeeScheduledAdjustmentPlans(employee) {
    if (!employee?.id) return [];
    const employeeById = new Map([[text(employee.id), employee]]);
    const result = [];
    for (const kind of [ADJUSTMENT_PLAN_KIND.BONUS, ADJUSTMENT_PLAN_KIND.DEDUCTION]) {
        for (const plan of (Array.isArray(employee[kind]) ? employee[kind] : [])) {
            if (!isPayrollAdjustmentInstallmentPlan(plan) ||
                plan.kind !== kind ||
                text(plan.employeeId) !== text(employee.id) ||
                ![
                    ADJUSTMENT_PLAN_STATUS.ACTIVE,
                    ADJUSTMENT_PLAN_STATUS.PAUSED,
                    ADJUSTMENT_PLAN_STATUS.COMPLETED,
                    ADJUSTMENT_PLAN_STATUS.CANCELLED
                ].includes(plan.status)) {
                continue;
            }
            const projected = projectEmployee(plan, employeeById);
            result.push({
                ...projected,
                kindLabel: KIND_META[kind].label,
                progressLabel: `${projected.appliedInstallments} de ${projected.installmentCount} cuotas aplicadas`
            });
        }
    }
    return result.sort((left, right) =>
        left.kind.localeCompare(right.kind, 'es') ||
        left.planName.localeCompare(right.planName, 'es', { numeric: true }) ||
        left.planId.localeCompare(right.planId, 'es', { numeric: true })
    );
}

function renderHistory(history) {
    if (history.length === 0) {
        return '<p class="payroll-scheduled__empty-history">Sin movimientos todavía.</p>';
    }
    return `
        <ul class="payroll-scheduled__history">
            ${history.map(item => `
                <li>
                    <span>${item.sequenceLabel.includes(',') ? 'Cuotas' : 'Cuota'} ${safe(item.sequenceLabel)}</span>
                    <strong>${formatCurrency(item.amount)}</strong>
                    <span>${safe(item.dateLabel)}</span>
                    <span>${safe(item.payrollLabel)}</span>
                    <span class="is-${item.statusLabel === 'Revertida' ? 'voided' : 'applied'}">
                        ${safe(item.statusLabel)}
                    </span>
                    ${(item.recordedBy || item.note) ? `
                        <small class="payroll-scheduled__history-note">
                            ${item.recordedBy ? `Registrado por ${safe(item.recordedBy)}` : ''}
                            ${item.recordedBy && item.note ? ' · ' : ''}
                            ${item.note ? `Nota: ${safe(item.note)}` : ''}
                        </small>
                    ` : ''}
                </li>
            `).join('')}
        </ul>
    `;
}

function renderEmployee(item, index, group, projectionRevision) {
    const identity = item.number
        ? `${safe(item.number)} · ${safe(item.name)}`
        : safe(item.name);
    const next = item.nextInstallment
        ? item.installmentCount === 1
            ? `Pago único: ${formatCurrency(item.nextInstallment.amount)}`
            : `Cuota ${item.nextInstallment.sequence}: ${formatCurrency(item.nextInstallment.amount)}`
        : 'Sin pagos pendientes';
    const actionReference = item.canPause || item.canResume || item.periodSelection || item.canRemove
        ? registerScheduledActionReference(group.kind, item, projectionRevision)
        : '';
    const periodActionLabel = group.kind === ADJUSTMENT_PLAN_KIND.BONUS
        ? 'Entregar en esta nómina'
        : 'Aplicar en esta nómina';
    return `
        <details class="payroll-scheduled__employee" data-scheduled-employee="${index}">
            <summary>
                <span><strong>${identity}</strong>${item.isMissing ? '<small>Registro del empleado no disponible</small>' : ''}</span>
                <span>Total <strong>${formatCurrency(item.totalAmount)}</strong></span>
                <span>Aplicado <strong>${formatCurrency(item.appliedAmount)}</strong></span>
                <span>Saldo <strong>${formatCurrency(item.balance)}</strong></span>
                <span>${safe(item.statusLabel)}</span>
                <span class="payroll-scheduled__toggle"><span>Ver historial</span><span>Ocultar historial</span></span>
            </summary>
            <div class="payroll-scheduled__employee-body">
                <p><strong>Próximo pago:</strong> ${safe(next)}</p>
                ${item.periodSelection ? `
                    <div class="payroll-scheduled__period-selection">
                        <label>
                            <span>${safe(periodActionLabel)}</span>
                            <select data-payroll-adjustment-period-selection
                                    data-scheduled-reference="${safe(actionReference)}"
                                    aria-label="${safe(periodActionLabel)} para ${safe(item.name)}">
                                ${item.periodSelection.options.map(option => `
                                    <option value="${safe(option.value)}"
                                            ${option.value === item.periodSelection.selectedValue ? 'selected' : ''}>
                                        ${safe(option.label)} · ${formatCurrency(option.total)}
                                    </option>
                                `).join('')}
                            </select>
                        </label>
                        <p>Total en esta nómina: <strong>${formatCurrency(item.periodSelection.total)}</strong></p>
                    </div>
                ` : item.status === ADJUSTMENT_PLAN_STATUS.PAUSED ? `
                    <p class="payroll-scheduled__period-note">Este pago está pausado hasta que lo reanudes.</p>
                ` : item.status === ADJUSTMENT_PLAN_STATUS.CANCELLED ? `
                    <p class="payroll-scheduled__period-note">Programación cancelada${item.cancellation?.cancelledAt ? ` el ${safe(formatDate(item.cancellation.cancelledAt))}` : ''}. El saldo y los pagos anteriores se conservan.</p>
                ` : ''}
                ${item.canPause || item.canResume ? `
                    <button type="button"
                            class="payroll-adjustment-button ${item.canPause ? 'payroll-adjustment-button--danger' : 'payroll-adjustment-button--primary'}"
                            data-payroll-action="${item.canPause ? 'pause-scheduled-adjustment' : 'resume-scheduled-adjustment'}"
                            data-scheduled-reference="${safe(actionReference)}"
                            aria-label="${item.canPause ? 'Pausar' : 'Reanudar'} ${safe(item.planName)} para ${safe(item.name)}">
                        ${item.canPause ? 'Pausar' : 'Reanudar'}
                    </button>
                ` : ''}
                ${item.canRemove ? `
                    <button type="button"
                            class="payroll-adjustment-button payroll-adjustment-button--danger"
                            data-payroll-action="remove-scheduled-adjustment-plan"
                            data-scheduled-reference="${safe(actionReference)}"
                            aria-label="Quitar ${safe(item.planName)} de la programación de ${safe(item.name)}">
                        Quitar de esta programación
                    </button>
                ` : ''}
                <h6>Historial de cuotas</h6>
                ${renderHistory(item.history)}
            </div>
        </details>
    `;
}

function renderGroup(group, index, projectionRevision) {
    const groupReference = group.periodEligibleCount > 0 || group.canRemove
        ? registerScheduledGroupReference(group, projectionRevision)
        : '';
    const totalLabel = group.hasDifferentTotals
        ? 'Importes distintos por empleado'
        : `${formatCurrency(group.totalPerEmployee)} por empleado`;
    const countLabel = group.hasDifferentInstallmentCounts
        ? 'Distinta cantidad de pagos'
        : group.installmentCount === 1
            ? '1 pago'
            : `${group.installmentCount} cuotas`;
    const startLabel = group.hasDifferentStartDates
        ? 'Fechas de inicio distintas'
        : `Inicio: ${formatDate(group.firstPeriodStart)}`;
    return `
        <details class="payroll-scheduled__group" data-scheduled-group="${index}">
            <summary>
                <span class="payroll-scheduled__identity">
                    <strong>${safe(group.name)}</strong>
                    <small>${safe(group.kindLabel)}</small>
                </span>
                <span>${group.employeeCount} ${group.employeeCount === 1 ? 'empleado' : 'empleados'}</span>
                <span>${safe(totalLabel)}</span>
                <span>${safe(countLabel)}</span>
                <span>${safe(startLabel)}</span>
                <span><strong>${safe(group.statusLabel)}</strong><small>${safe(group.progressLabel)}</small></span>
                <span class="payroll-scheduled__toggle"><span>Ver detalle</span><span>Ocultar detalle</span></span>
            </summary>
            <div class="payroll-scheduled__group-body">
                ${group.periodEligibleCount > 0 ? `
                    <div class="payroll-scheduled__period-actions">
                        <p>Total actual del grupo: <strong>${formatCurrency(group.currentPayrollTotal)}</strong></p>
                        <div role="group" aria-label="Acciones para todos los empleados de ${safe(group.name)}">
                            <button type="button"
                                    data-payroll-action="set-scheduled-adjustment-group-period-selection"
                                    data-selection-value="count:1"
                                    data-scheduled-reference="${safe(groupReference)}">
                                Todos: 1 cuota
                            </button>
                            <button type="button"
                                    data-payroll-action="set-scheduled-adjustment-group-period-selection"
                                    data-selection-value="pause"
                                    data-scheduled-reference="${safe(groupReference)}">
                                Pausar todos en esta nómina
                            </button>
                        </div>
                    </div>
                ` : ''}
                ${group.canRemove ? `
                    <div class="payroll-scheduled__remove-group">
                        <button type="button" class="payroll-adjustment-button payroll-adjustment-button--danger"
                                data-payroll-action="cancel-scheduled-adjustment-group"
                                data-scheduled-reference="${safe(groupReference)}"
                                aria-label="${safe(group.removeActionLabel)} ${safe(group.name)}">
                            ${safe(group.removeActionLabel)}
                        </button>
                    </div>
                ` : ''}
                <div class="payroll-scheduled__progress" role="progressbar"
                     aria-label="${safe(group.progressLabel)}" aria-valuemin="0" aria-valuemax="100"
                     aria-valuenow="${group.progressPercent}">
                    <span style="width: ${group.progressPercent}%"></span>
                </div>
                ${group.employees.map((item, employeeIndex) =>
                    renderEmployee(item, employeeIndex, group, projectionRevision)
                ).join('')}
            </div>
        </details>
    `;
}


function renderManualMovementForm(plan, draft, planIndex) {
    const actionLabel = plan.kind === ADJUSTMENT_PLAN_KIND.BONUS
        ? 'Registrar entrega'
        : 'Registrar abono';
    return `
        <form class="payroll-employee-scheduled__form" data-manual-adjustment-form>
            <h6>${actionLabel}</h6>
            <div class="payroll-employee-scheduled__form-grid">
                <label>
                    <span>Monto</span>
                    <input type="number" name="manualAmount" min="0.01"
                           max="${plan.balance}" step="0.01" required>
                </label>
                <label>
                    <span>Fecha</span>
                    <input type="date" name="manualDate" value="${safe(draft.date)}" required>
                </label>
                <label>
                    <span>Registrado por</span>
                    <input type="text" name="manualRecordedBy"
                           value="${safe(draft.recordedBy)}" required>
                </label>
                <label class="payroll-employee-scheduled__note">
                    <span>Nota opcional</span>
                    <input type="text" name="manualNote" value="${safe(draft.note || '')}">
                </label>
            </div>
            <div class="payroll-employee-scheduled__form-actions">
                <button type="button" data-app-fn="cancelManualAdjustmentMovement">Cancelar</button>
                <button type="button" class="is-primary"
                        data-app-fn="submitManualAdjustmentMovementAt"
                        data-arg="${planIndex}">
                    ${actionLabel}
                </button>
            </div>
        </form>
    `;
}

function renderEmployeePlan(plan, draft, planIndex) {
    const isDraft = draft && draft.kind === plan.kind && draft.planId === plan.planId;
    const actionLabel = plan.kind === ADJUSTMENT_PLAN_KIND.BONUS
        ? 'Registrar entrega'
        : 'Registrar abono';
    const next = plan.nextInstallment
        ? `Cuota ${plan.nextInstallment.sequence}: ${formatCurrency(plan.nextInstallment.amount)}`
        : 'Sin cuotas pendientes';
    return `
        <details class="payroll-employee-scheduled__plan">
            <summary>
                <span><strong>${safe(plan.planName)}</strong><small>${safe(plan.kindLabel)}</small></span>
                <span>Total <strong>${formatCurrency(plan.totalAmount)}</strong></span>
                <span>Aplicado <strong>${formatCurrency(plan.appliedAmount)}</strong></span>
                <span>Saldo <strong>${formatCurrency(plan.balance)}</strong></span>
                <span><strong>${safe(plan.statusLabel)}</strong><small>${safe(plan.progressLabel)}</small></span>
                <span class="payroll-scheduled__toggle"><span>Ver detalle</span><span>Ocultar detalle</span></span>
            </summary>
            <div class="payroll-employee-scheduled__body">
                <div class="payroll-employee-scheduled__next">
                    <span>Inicio: ${formatDate(plan.firstPeriodStart)}</span>
                    <strong>Próxima cuota: ${safe(next)}</strong>
                </div>
                <h6>Historial de cuotas</h6>
                ${renderHistory(plan.history)}
                ${plan.statusLabel === 'En curso' ? `
                    <button type="button" class="payroll-employee-scheduled__action"
                            data-app-fn="openManualAdjustmentMovementAt"
                            data-arg="${planIndex}">
                        ${actionLabel}
                    </button>
                ` : plan.statusLabel === 'Cancelado'
                    ? '<p class="payroll-employee-scheduled__complete">Esta programación está cancelada. El saldo y el historial se conservan.</p>'
                    : plan.statusLabel === 'Pausado'
                        ? '<p class="payroll-employee-scheduled__complete">Esta programación está pausada.</p>'
                        : '<p class="payroll-employee-scheduled__complete">Este plan está completado.</p>'}
                ${isDraft ? renderManualMovementForm(plan, draft, planIndex) : ''}
            </div>
        </details>
    `;
}

export function renderEmployeeScheduledAdjustments(employee, { draft = null } = {}) {
    const plans = buildEmployeeScheduledAdjustmentPlans(employee);
    return `
        <section class="payroll-employee-scheduled" data-employee-scheduled-adjustments>
            <header>
                <span>Planes del empleado</span>
                <h4>Bonificaciones y descuentos programados</h4>
                <p>Consulta el saldo, las próximas cuotas y los movimientos registrados.</p>
            </header>
            ${plans.length > 0
                ? `<div>${plans.map((plan, index) =>
                    renderEmployeePlan(plan, draft, index)
                ).join('')}</div>`
                : '<p class="payroll-scheduled__empty">No hay bonificaciones ni descuentos programados.</p>'}
        </section>
    `;
}

export function renderScheduledAdjustmentGroups(kind, groups = []) {
    const meta = KIND_META[kind] || KIND_META[ADJUSTMENT_PLAN_KIND.DEDUCTION];
    const projectionRevision = beginScheduledProjection(kind);
    return `
        <section class="payroll-adjustment-scheduled" data-scheduled-adjustments>
            <header>
                <div>
                    <span>Pagos guardados</span>
                    <h4>Programados</h4>
                    <p>Consulta lo aplicado, lo pendiente y el historial de cada empleado.</p>
                </div>
                <strong>${groups.length} ${groups.length === 1 ? 'plan' : 'planes'}</strong>
            </header>
            ${groups.length > 0
                ? `<div class="payroll-scheduled__groups">${groups.map((group, index) => renderGroup(group, index, projectionRevision)).join('')}</div>`
                : `<p class="payroll-scheduled__empty">${meta.emptyLabel}</p>`}
        </section>
    `;
}

export default {
    buildEmployeeScheduledAdjustmentPlans,
    buildScheduledAdjustmentGroups,
    renderEmployeeScheduledAdjustments,
    renderScheduledAdjustmentGroups,
    resolveScheduledActionReference
};
