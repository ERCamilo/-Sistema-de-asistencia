import { escapeHTML } from '../../utils/Sanitize.js';
import { formatCurrency } from '../../utils/Formatters.js';
import {
    calculateScopedAdjustment,
    resolveAdjustmentScope
} from './PayrollAdjustments.js';

const SCOPE_META = [
    { id: 'global', label: 'General', summary: 'Generales' },
    { id: 'leader', label: 'Por líder', summary: 'Por líder / equipo' },
    { id: 'position', label: 'Por puesto', summary: 'Por puesto' },
    { id: 'employee', label: 'Individual', summary: 'Individuales' }
];

function safe(value) {
    return escapeHTML(String(value ?? ''));
}

function optionList(items, selectedId, placeholder, labelForItem) {
    return `
        <option value="">${safe(placeholder)}</option>
        ${(items || []).map(item => `
            <option value="${safe(item.id)}" ${String(item.id) === String(selectedId ?? '') ? 'selected' : ''}>
                ${safe(labelForItem(item))}
            </option>
        `).join('')}
    `;
}

function targetLabel(adjustment, state) {
    const { scope, targetId } = resolveAdjustmentScope(adjustment);
    if (scope === 'global') return 'Toda la nómina';

    const collection = scope === 'leader'
        ? state.leaders
        : scope === 'position'
            ? state.positions
            : state.employees;
    const item = (collection || []).find(entry => String(entry.id) === String(targetId));
    if (!item) return 'Destino no disponible';
    if (scope === 'employee') {
        return `${item.number ? `#${item.number} · ` : ''}${item.name || 'Empleado'}`;
    }
    return item.name || item.code || 'Sin nombre';
}

function detailId(adjustment, index, kind) {
    return adjustment.id || `${kind === 'bonuses' ? 'BON' : 'DED'}-${index + 1}`;
}

export function buildAdjustmentScopeSummary(kind, adjustments = [], rows = [], state = {}) {
    const detailsKey = kind === 'bonuses' ? '_bonusDetails' : '_deductionDetails';
    const categories = SCOPE_META.map(meta => ({
        ...meta,
        rules: [],
        total: 0,
        employeeIds: new Set()
    }));
    const categoryByScope = new Map(categories.map(category => [category.id, category]));

    adjustments.forEach((adjustment, index) => {
        const resolved = resolveAdjustmentScope(adjustment);
        const id = detailId(adjustment, index, kind);
        const matches = [];

        rows.forEach(row => {
            const detail = (row[detailsKey] || []).find(item => String(item.id) === String(id));
            if (detail) matches.push({ row, detail });
        });

        const employeeIds = new Set(matches.map(({ row }) => String(row._employeeId)));
        const amount = matches.reduce((sum, { detail }) => sum + (Number(detail.amount) || 0), 0);
        const appliedTo = matches.reduce((sum, { detail }) => sum + (Number(detail.appliedTo) || 0), 0);
        const category = categoryByScope.get(resolved.scope);

        category.rules.push({
            adjustment,
            index,
            id,
            scope: resolved.scope,
            targetId: resolved.targetId,
            targetLabel: targetLabel(adjustment, state),
            employeeCount: employeeIds.size,
            amount,
            appliedTo
        });
        category.total += amount;
        employeeIds.forEach(employeeId => category.employeeIds.add(employeeId));
    });

    return {
        categories: categories.map(category => ({
            ...category,
            employeeCount: category.employeeIds.size
        })),
        total: categories.reduce((sum, category) => sum + category.total, 0),
        overlapCount: rows.filter(row => (row[detailsKey] || []).length > 1).length
    };
}

export function readAdjustmentForm(form) {
    if (!form) return null;
    const data = new FormData(form);
    const scope = data.get('scope') || 'global';
    const targetFields = {
        global: null,
        leader: data.get('leaderTarget'),
        position: data.get('positionTarget'),
        employee: data.get('employeeTarget')
    };

    return {
        name: String(data.get('name') || '').trim(),
        type: data.get('type') === 'percentage' ? 'percentage' : 'fixed',
        value: Number(data.get('value')) || 0,
        scope,
        targetId: targetFields[scope] || null,
        remembered: data.get('remembered') === 'on'
    };
}

export function calculateAdjustmentPreview(adjustment, rows = [], positions = []) {
    const preview = {
        employeeCount: 0,
        appliedTo: 0,
        amount: 0
    };
    if (!adjustment) return preview;

    rows.forEach((row, index) => {
        const detail = calculateScopedAdjustment(
            adjustment,
            {
                employeeId: row._employeeId,
                totalGross: row._brutoOriginal,
                breakdown: row._positionBreakdown || [],
                positions
            },
            index
        );
        if (!detail) return;
        preview.employeeCount += 1;
        preview.appliedTo += Number(detail.appliedTo) || 0;
        preview.amount += Number(detail.amount) || 0;
    });
    return preview;
}

function renderScopeSelector(kind, selectedScope, formKey) {
    return `
        <fieldset class="payroll-adjustment-form__scope">
            <legend>¿A quién se aplica?</legend>
            <div class="payroll-adjustment-scope-options">
                ${SCOPE_META.map(meta => `
                    <label>
                        <input type="radio"
                               name="scope"
                               value="${meta.id}"
                               ${selectedScope === meta.id ? 'checked' : ''}>
                        <span>${meta.label}</span>
                    </label>
                `).join('')}
            </div>
        </fieldset>
    `;
}

function renderAdjustmentForm(kind, state, rows, adjustment = {}, index = null) {
    const resolved = resolveAdjustmentScope(adjustment);
    const isEditing = Number.isInteger(index);
    const formKey = `${kind}-${isEditing ? index : 'new'}`;
    const preview = calculateAdjustmentPreview(adjustment, rows, state.positions || []);
    const noun = kind === 'bonuses' ? 'bonificación' : 'deducción';
    const actionLabel = isEditing ? 'Guardar cambios' : `Agregar ${noun}`;
    const action = isEditing ? 'update-desktop-adjustment' : 'add-desktop-adjustment';
    const employees = (state.employees || [])
        .filter(employee => employee.active !== false)
        .sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }));
    const leaders = (state.leaders || []).filter(leader => leader.active !== false);
    const positions = (state.positions || []).filter(position => position.active !== false);

    return `
        <form class="payroll-adjustment-form is-${kind === 'bonuses' ? 'bonus' : 'deduction'}"
              data-adjustment-kind="${kind}"
              data-adjustment-index="${isEditing ? index : ''}"
              data-adjustment-scope="${resolved.scope}">
            ${renderScopeSelector(kind, resolved.scope, formKey)}

            <div class="payroll-adjustment-form__target payroll-adjustment-form__target--leader ${resolved.scope === 'leader' ? 'is-visible' : ''}">
                <label for="${formKey}-leader">Líder o equipo</label>
                <select id="${formKey}-leader" name="leaderTarget">
                    ${optionList(leaders, resolved.targetId, 'Seleccionar líder', item => item.name || item.code)}
                </select>
            </div>
            <div class="payroll-adjustment-form__target payroll-adjustment-form__target--position ${resolved.scope === 'position' ? 'is-visible' : ''}">
                <label for="${formKey}-position">Puesto</label>
                <select id="${formKey}-position" name="positionTarget">
                    ${optionList(positions, resolved.targetId, 'Seleccionar puesto', item => item.name)}
                </select>
            </div>
            <div class="payroll-adjustment-form__target payroll-adjustment-form__target--employee ${resolved.scope === 'employee' ? 'is-visible' : ''}">
                <label for="${formKey}-employee">Empleado</label>
                <select id="${formKey}-employee" name="employeeTarget">
                    ${optionList(employees, resolved.targetId, 'Seleccionar empleado', item => `${item.number || 'S/N'} · ${item.name}`)}
                </select>
            </div>

            <div class="payroll-adjustment-form__fields">
                <label>
                    <span>Concepto</span>
                    <input name="name"
                           type="text"
                           value="${safe(adjustment.name || '')}"
                           placeholder="${kind === 'bonuses' ? 'Opcional · por defecto: Bono' : 'Opcional · por defecto: Descuento'}">
                </label>
                <fieldset class="payroll-adjustment-value-type">
                    <legend>Tipo de valor</legend>
                    <div>
                        <label>
                            <input type="radio"
                                   name="type"
                                   value="fixed"
                                   ${adjustment.type !== 'percentage' ? 'checked' : ''}>
                            <span>Monto</span>
                        </label>
                        <label>
                            <input type="radio"
                                   name="type"
                                   value="percentage"
                                   ${adjustment.type === 'percentage' ? 'checked' : ''}>
                            <span>Porcentaje</span>
                        </label>
                    </div>
                </fieldset>
                <label>
                    <span>Valor</span>
                    <input name="value"
                           type="number"
                           inputmode="decimal"
                           min="0"
                           step="0.01"
                           value="${Number(adjustment.value) || ''}"
                           placeholder="0.00">
                </label>
            </div>

            <div class="payroll-adjustment-preview" aria-live="polite">
                <span><small>Empleados</small><strong data-preview-employees>${preview.employeeCount}</strong></span>
                <span><small>Base afectada</small><strong data-preview-base>${formatCurrency(preview.appliedTo)}</strong></span>
                <span><small>Total estimado</small><strong data-preview-total>${formatCurrency(preview.amount)}</strong></span>
            </div>

            <div class="payroll-adjustment-form__footer">
                <label class="payroll-adjustment-remember ${resolved.scope === 'employee' ? 'is-hidden' : ''}">
                    <input type="checkbox" name="remembered" ${adjustment.remembered ? 'checked' : ''}>
                    <span>Recordar para próximas nóminas</span>
                </label>
                <div class="payroll-adjustment-form__actions">
                    ${isEditing ? `
                        <button type="button"
                                class="payroll-adjustment-button payroll-adjustment-button--danger"
                                data-payroll-action="remove-desktop-adjustment"
                                data-value="${kind}"
                                data-index="${index}">
                            Eliminar
                        </button>
                    ` : ''}
                    <button type="button"
                            class="payroll-adjustment-button payroll-adjustment-button--primary"
                            data-payroll-action="${action}"
                            data-value="${kind}"
                            ${isEditing ? `data-index="${index}"` : ''}>
                        ${actionLabel}
                    </button>
                </div>
            </div>
        </form>
    `;
}

function renderRule(kind, rule, state, rows) {
    const adjustment = rule.adjustment;
    const formula = adjustment.type === 'percentage'
        ? `${Number(adjustment.value) || 0}%`
        : formatCurrency(Number(adjustment.value) || 0);

    return `
        <details class="payroll-adjustment-rule">
            <summary>
                <span class="payroll-adjustment-rule__concept">
                    <strong>${safe(adjustment.name || 'Sin nombre')}</strong>
                    <small>${safe(rule.targetLabel)}</small>
                </span>
                <span>${formula}</span>
                <span>${rule.employeeCount}</span>
                <span>${formatCurrency(rule.appliedTo)}</span>
                <strong>${formatCurrency(rule.amount)}</strong>
                <span class="payroll-adjustment-rule__edit" aria-label="Editar">
                    <span class="payroll-adjustment-rule__edit-idle">Editar</span>
                    <span class="payroll-adjustment-rule__edit-active">Editando</span>
                </span>
            </summary>
            <div class="payroll-adjustment-rule__editor">
                ${renderAdjustmentForm(kind, state, rows, adjustment, rule.index)}
            </div>
        </details>
    `;
}

function renderSummary(kind, summary, state, rows) {
    const totalLabel = kind === 'bonuses' ? 'Total bonificado' : 'Total descontado';
    const firstNonEmpty = summary.categories.find(category => category.rules.length > 0)?.id;

    return `
        <section class="payroll-adjustment-summary is-${kind === 'bonuses' ? 'bonus' : 'deduction'}">
            <header>
                <div>
                    <span>Resumen del período</span>
                    <strong>${totalLabel}</strong>
                </div>
                <strong>${formatCurrency(summary.total)}</strong>
            </header>
            <div class="payroll-adjustment-summary__columns" aria-hidden="true">
                <span>Alcance / concepto</span>
                <span>Regla</span>
                <span>Empl.</span>
                <span>Base</span>
                <span>Total</span>
                <span></span>
            </div>
            <div class="payroll-adjustment-summary__groups">
                ${summary.categories.map(category => `
                    <details class="payroll-adjustment-group" ${category.id === firstNonEmpty ? 'open' : ''}>
                        <summary>
                            <span class="payroll-adjustment-group__toggle" aria-hidden="true"></span>
                            <strong>${category.summary}</strong>
                            <span>${category.rules.length} ${category.rules.length === 1 ? 'cargo' : 'cargos'}</span>
                            <span>${category.employeeCount} empl.</span>
                            <strong>${formatCurrency(category.total)}</strong>
                        </summary>
                        <div class="payroll-adjustment-group__body">
                            ${category.rules.length
                                ? category.rules.map(rule => renderRule(kind, rule, state, rows)).join('')
                                : '<p class="payroll-adjustment-group__empty">No hay ajustes en este alcance.</p>'}
                        </div>
                    </details>
                `).join('')}
            </div>
            ${summary.overlapCount > 0 ? `
                <p class="payroll-adjustment-summary__notice">
                    ${summary.overlapCount} empleado(s) reciben más de un ajuste. Cada regla se calcula sobre su base original, sin encadenarse.
                </p>
            ` : ''}
        </section>
    `;
}

export function renderDesktopAdjustmentWorkspace(kind, state, rows) {
    const adjustments = state.exportConfig?.[kind] || [];
    const summary = buildAdjustmentScopeSummary(kind, adjustments, rows, state);
    const isBonus = kind === 'bonuses';

    return `
        <div class="payroll-adjustment-desktop is-${isBonus ? 'bonus' : 'deduction'}">
            <div class="payroll-adjustment-desktop__header">
                <div>
                    <span>${isBonus ? 'Ingresos adicionales' : 'Descuentos del período'}</span>
                    <h3>${isBonus ? 'Agregar bonificación' : 'Agregar deducción'}</h3>
                    <p>Elegí el alcance una sola vez. El cálculo usa el salario bruto correspondiente sin duplicar cargos.</p>
                </div>
                <span class="payroll-adjustment-desktop__badge">${adjustments.length} configuradas</span>
            </div>
            <div class="payroll-adjustment-desktop__layout">
                <section class="payroll-adjustment-composer">
                    ${renderAdjustmentForm(kind, state, rows)}
                </section>
                ${renderSummary(kind, summary, state, rows)}
            </div>
        </div>
    `;
}

export function updateAdjustmentFormPresentation(form, rows, positions) {
    const adjustment = readAdjustmentForm(form);
    if (!adjustment) return;
    form.dataset.adjustmentScope = adjustment.scope;
    form.querySelectorAll('.payroll-adjustment-form__target').forEach(target => {
        target.classList.toggle('is-visible', target.classList.contains(`payroll-adjustment-form__target--${adjustment.scope}`));
    });
    form.querySelector('.payroll-adjustment-remember')
        ?.classList.toggle('is-hidden', adjustment.scope === 'employee');

    const preview = calculateAdjustmentPreview(adjustment, rows, positions);
    const employeeNode = form.querySelector('[data-preview-employees]');
    const baseNode = form.querySelector('[data-preview-base]');
    const totalNode = form.querySelector('[data-preview-total]');
    if (employeeNode) employeeNode.textContent = String(preview.employeeCount);
    if (baseNode) baseNode.textContent = formatCurrency(preview.appliedTo);
    if (totalNode) totalNode.textContent = formatCurrency(preview.amount);
}
