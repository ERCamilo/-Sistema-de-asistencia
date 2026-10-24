import { escapeHTML } from '../../utils/Sanitize.js';

export function getPayrollReviewEmployeeSelection(config, { projectId, period, employees = [] } = {}) {
    const matches = Boolean(config && projectId) && config.projectId === projectId && config?.periodStart === period?.periodStart
        && config?.periodEnd === period?.periodEnd;
    const allowed = new Set(employees.map(employee => String(employee.id)));
    const ids = matches && Array.isArray(config.ids)
        ? [...new Set(config.ids.filter(id => typeof id === 'string' || typeof id === 'number').map(String))].filter(id => allowed.has(id))
        : [];
    return { enabled: matches && config.enabled === true, ids };
}

export function filterPayrollReviewEmployees(rows, selection) {
    if (!selection.enabled) return rows;
    const selected = new Set(selection.ids);
    return rows.filter(row => selected.has(String(row._employeeId)));
}

export function renderPayrollReviewEmployeeFilter(selection) {
    return `<div class="payroll-review-employees">
        <label><input type="checkbox" data-payroll-action="toggle-payroll-review-employee-filter"
                      ${selection.enabled ? 'checked' : ''}>
            <span>Solo empleados seleccionados</span>
        </label>
        ${selection.enabled ? `<button type="button" data-payroll-action="open-payroll-review-employees"
            aria-label="Elegir empleados: ${selection.ids.length} seleccionados">
            Elegir empleados <span class="payroll-review-employees__count">${escapeHTML(String(selection.ids.length))}</span>
        </button>` : ''}
    </div>`;
}
