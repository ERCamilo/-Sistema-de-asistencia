import { escapeAttr, escapeHTML } from '../../utils/Sanitize.js';
import { fromStoredHourly, toStoredHourly } from '../payroll/SalaryConversion.js';
import {
    renderPositionIconSvg,
    renderPositionUiSvg,
    resolvePositionIcon,
    safePositionColor
} from './PositionVisuals.js';
import {
    buildEmployeePositionPeriodSnapshot,
    calculatePositionAccrued,
    getPositionPeriodMetrics,
    getPositionTotalHours,
    resolvePositionBaseHourlyRate
} from './EmployeePositionMetrics.js';
import { EmployeePositionPickerModal } from '../../ui/modals/EmployeePositionPickerModal.js';

function formatMoney(amount) {
    return `$${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function formatHours(hours) {
    return `${(Number(hours) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

export function renderAssignedPositionCard({
    position,
    employee,
    regularHours,
    snapshot,
    totalAssigned,
    settings = {}
}) {
    const positionId = String(position.id);
    const storedCustom = Number(employee?.positionSalaries?.[positionId]);
    const hasCustomRate = Number.isFinite(storedCustom) && storedCustom > 0;
    const baseHourlyRate = resolvePositionBaseHourlyRate(position, regularHours);
    const hourlyRate = hasCustomRate ? storedCustom : baseHourlyRate;
    const mode = employee?.positionSalaryModes?.[positionId] === 'daily' ? 'daily' : 'hourly';
    const displayRate = fromStoredHourly(hourlyRate, mode, regularHours);
    const metrics = getPositionPeriodMetrics(snapshot, positionId);
    const accrued = calculatePositionAccrued(metrics, hourlyRate, settings);
    const color = safePositionColor(position.color);

    return `
        <article class="employee-position-assignment"
                 data-position-assignment="${escapeAttr(positionId)}"
                 data-base-hourly="${baseHourlyRate}"
                 data-salary-source="${hasCustomRate ? 'custom' : 'default'}"
                 data-regular-hours="${Number(metrics.regularHours) || 0}"
                 data-overtime-hours="${Number(metrics.overtimeHours) || 0}"
                 data-holiday-hours="${Number(metrics.holidayHours) || 0}"
                 data-rest-day-hours="${Number(metrics.restDayHours) || 0}"
                 data-rest-day-factor="${Number(metrics.restDayFactor) || 1.5}"
                 style="--position-accent: ${color};">
            <input type="checkbox" name="empPosition" value="${escapeAttr(positionId)}" checked hidden>
            <header class="employee-position-assignment__header">
                <span class="employee-position-assignment__icon">
                    ${renderPositionIconSvg(resolvePositionIcon(position), { size: 21 })}
                </span>
                <div>
                    <strong>${escapeHTML(position.name)}</strong>
                    <span data-rate-source-label>${hasCustomRate ? 'Tarifa personalizada' : 'Tarifa predeterminada'}</span>
                </div>
                <button class="employee-position-assignment__remove${totalAssigned > 1 ? '' : ' is-hidden'}"
                        type="button" data-remove-position
                        aria-label="Quitar ${escapeAttr(position.name)}" title="Quitar puesto">
                    ${renderPositionUiSvg('close', { size: 16 })}
                </button>
            </header>

            <div class="employee-position-assignment__metrics">
                <span><small>Días trabajados</small><strong>${Number(metrics.days) || 0}</strong></span>
                <span><small>Horas del período</small><strong>${formatHours(getPositionTotalHours(metrics))}</strong></span>
                <span><small>Acumulado</small><strong data-position-accrued>${formatMoney(accrued)}</strong></span>
            </div>

            <div class="employee-position-assignment__salary">
                <label>
                    <span>Tarifa</span>
                    <span class="employee-position-assignment__money">
                        <small>$</small>
                        <input type="number" inputmode="decimal"
                               class="form-input custom-salary-input"
                               data-pos-id="${escapeAttr(positionId)}"
                               value="${Number(displayRate) || 0}"
                               min="0" step="any">
                    </span>
                </label>
                <select class="custom-salary-mode" data-pos-id="${escapeAttr(positionId)}" hidden>
                    <option value="hourly" ${mode === 'hourly' ? 'selected' : ''}>por hora</option>
                    <option value="daily" ${mode === 'daily' ? 'selected' : ''}>por día</option>
                </select>
                <div class="employee-position-assignment__mode" role="group" aria-label="Unidad de tarifa">
                    <button type="button" data-salary-mode="daily" class="${mode === 'daily' ? 'active' : ''}">Por día</button>
                    <button type="button" data-salary-mode="hourly" class="${mode === 'hourly' ? 'active' : ''}">Por hora</button>
                </div>
                <button class="employee-position-assignment__reset${hasCustomRate ? '' : ' is-hidden'}"
                        type="button" data-reset-position-rate>
                    Usar predeterminada
                </button>
            </div>
        </article>
    `;
}

export function renderEmployeePositionEditor(state, employee, regularHours) {
    const snapshot = buildEmployeePositionPeriodSnapshot(state, employee);
    const assignedPositions = (employee?.positions || [])
        .map(positionId => state.positions.find(position => String(position.id) === String(positionId)))
        .filter(Boolean);
    const employeeView = employee
        ? employee
        : { positions: [], positionSalaries: {}, positionSalaryModes: {} };

    return `
        <section class="employee-position-editor" data-employee-position-editor
                 data-period-start="${snapshot.period.periodStart}"
                 data-period-end="${snapshot.period.periodEnd}">
            <header class="employee-position-editor__heading">
                <div>
                    <strong>Puestos asignados</strong>
                    <span>${snapshot.period.periodStart} — ${snapshot.period.periodEnd}</span>
                </div>
                <span>Período actual</span>
            </header>
            <div class="employee-position-editor__list" data-assigned-position-list>
                ${assignedPositions.map(position => renderAssignedPositionCard({
                    position,
                    employee: employeeView,
                    regularHours,
                    snapshot,
                    totalAssigned: assignedPositions.length,
                    settings: state.settings
                })).join('')}
            </div>
            <div class="employee-position-editor__empty${assignedPositions.length ? ' is-hidden' : ''}"
                 data-position-editor-empty>
                Aún no hay puestos asignados.
            </div>
            <button class="employee-position-editor__add" type="button" data-open-position-picker>
                ${renderPositionUiSvg('add', { size: 20 })}
                <span>Agregar puesto</span>
            </button>
        </section>
    `;
}

export function attachEmployeePositionEditor({ root, state, employee, regularHours }) {
    const editor = root.querySelector('[data-employee-position-editor]');
    if (!editor) return;

    const snapshot = buildEmployeePositionPeriodSnapshot(state, employee);
    const list = editor.querySelector('[data-assigned-position-list]');
    const empty = editor.querySelector('[data-position-editor-empty]');

    const updateAssignmentControls = () => {
        const cards = [...list.querySelectorAll('[data-position-assignment]')];
        cards.forEach(card => {
            card.querySelector('[data-remove-position]')?.classList.toggle('is-hidden', cards.length <= 1);
        });
        empty?.classList.toggle('is-hidden', cards.length > 0);
    };

    const recalculateCard = card => {
        const input = card.querySelector('.custom-salary-input');
        const mode = card.querySelector('.custom-salary-mode')?.value || 'hourly';
        const hourlyRate = toStoredHourly(Number(input?.value) || 0, mode, regularHours);
        const metrics = {
            regularHours: Number(card.dataset.regularHours) || 0,
            overtimeHours: Number(card.dataset.overtimeHours) || 0,
            holidayHours: Number(card.dataset.holidayHours) || 0,
            restDayHours: Number(card.dataset.restDayHours) || 0,
            restDayFactor: Number(card.dataset.restDayFactor) || (state.settings?.restDayFactor || 1.5)
        };
        const accrued = calculatePositionAccrued(metrics, hourlyRate, state.settings);
        const output = card.querySelector('[data-position-accrued]');
        if (output) output.textContent = formatMoney(accrued);
    };

    const attachCard = card => {
        const input = card.querySelector('.custom-salary-input');
        const modeSelect = card.querySelector('.custom-salary-mode');
        const reset = card.querySelector('[data-reset-position-rate]');
        const sourceLabel = card.querySelector('[data-rate-source-label]');

        card.querySelector('[data-remove-position]')?.addEventListener('click', () => {
            card.remove();
            updateAssignmentControls();
        });

        input?.addEventListener('input', () => {
            card.dataset.salarySource = 'custom';
            if (sourceLabel) sourceLabel.textContent = 'Tarifa personalizada';
            reset?.classList.remove('is-hidden');
            recalculateCard(card);
        });

        card.querySelectorAll('[data-salary-mode]').forEach(button => {
            button.addEventListener('click', () => {
                const nextMode = button.dataset.salaryMode;
                const previousMode = modeSelect.value;
                if (nextMode === previousMode) return;
                const current = Number(input.value) || 0;
                const hourly = toStoredHourly(current, previousMode, regularHours);
                input.value = Math.round(fromStoredHourly(hourly, nextMode, regularHours) * 100) / 100;
                modeSelect.value = nextMode;
                card.querySelectorAll('[data-salary-mode]').forEach(item => {
                    item.classList.toggle('active', item.dataset.salaryMode === nextMode);
                });
                recalculateCard(card);
            });
        });

        reset?.addEventListener('click', () => {
            const baseHourly = Number(card.dataset.baseHourly) || 0;
            input.value = Math.round(fromStoredHourly(baseHourly, modeSelect.value, regularHours) * 100) / 100;
            card.dataset.salarySource = 'default';
            if (sourceLabel) sourceLabel.textContent = 'Tarifa predeterminada';
            reset.classList.add('is-hidden');
            recalculateCard(card);
        });
    };

    list.querySelectorAll('[data-position-assignment]').forEach(attachCard);
    editor.querySelector('[data-open-position-picker]')?.addEventListener('click', () => {
        const assignedIds = [...list.querySelectorAll('[data-position-assignment]')]
            .map(card => card.dataset.positionAssignment);
        EmployeePositionPickerModal.open({
            positions: state.positions,
            assignedIds,
            regularHours,
            onAdd(position) {
                const employeeView = employee
                    ? { ...employee, positions: [], positionSalaries: {}, positionSalaryModes: {} }
                    : { positions: [], positionSalaries: {}, positionSalaryModes: {} };
                list.insertAdjacentHTML('beforeend', renderAssignedPositionCard({
                    position,
                    employee: employeeView,
                    regularHours,
                    snapshot,
                    totalAssigned: assignedIds.length + 1,
                    settings: state.settings
                }));
                attachCard(list.lastElementChild);
                updateAssignmentControls();
            }
        });
    });
    updateAssignmentControls();
}
