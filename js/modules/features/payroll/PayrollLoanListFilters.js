import { escapeHTML } from '../../utils/Sanitize.js';
import { getEmployeePositionAssignment } from '../employees/EmployeePositionAssignments.js';

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const safe = value => escapeHTML(String(value ?? ''));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
const blank = () => ({ query: '', leader: '', position: '', selection: '' });
let currentKey = null;
let currentFilters = blank();

export function resetPayrollLoanListFilters() { currentKey = null; currentFilters = blank(); }

export function comparePayrollLoanEmployees(left, right) {
    const a = String(left.employeeNumber ?? '').trim(), b = String(right.employeeNumber ?? '').trim();
    return Number(!a) - Number(!b) || collator.compare(a, b)
        || collator.compare(left.employeeName || '', right.employeeName || '')
        || collator.compare(String(left.employeeId), String(right.employeeId));
}

export const hasPayrollLoanListFilters = filters => Object.values(filters).some(Boolean);

export function matchesPayrollLoanList(row, filters) {
    const words = normalize(filters.query).split(/\s+/).filter(Boolean);
    return words.every(word => row.search.includes(word))
        && (!filters.selection || (filters.selection === 'selected' ? row.selected : !row.selected))
        // Both filters must match the same worked position, not unrelated assignments.
        && row.terms.some(term => (!filters.leader || term.leader === filters.leader)
            && (!filters.position || term.position === filters.position));
}

export function buildPayrollLoanList(groups, { employees = [], payrollRows = [], positions = [], leaders = [], filterKey = '' } = {}) {
    if (currentKey !== filterKey) { currentKey = filterKey; currentFilters = blank(); }
    const people = new Map(employees.map(employee => [String(employee.id), employee]));
    const payroll = new Map(payrollRows.map(row => [String(row._employeeId), row]));
    const jobs = new Map(positions.map(position => [String(position.id), position]));
    const bosses = new Map(leaders.map(leader => [String(leader.id), leader]));
    const leaderOptions = new Map(), positionOptions = new Map();
    const rows = groups.map(group => {
        const employee = people.get(String(group.employeeId));
        const payrollRow = payroll.get(String(group.employeeId));
        const worked = payrollRow?._positionBreakdown || [];
        const assignedParts = () => (employee?.positions || []).map(positionId => {
            const position = jobs.get(String(positionId)) || { id: positionId };
            const assignment = getEmployeePositionAssignment(employee, position);
            return { positionId, payerLeaderId: assignment.isLoanPosition ? assignment.payerLeaderId : assignment.workLeaderId,
                assignmentSchemaVersion: 1 };
        });
        const parts = worked.length ? worked : payrollRow?._personalAdjustmentPayerId !== undefined
            ? [{ positionId: employee?.positions?.[0], payerLeaderId: payrollRow._personalAdjustmentPayerId, assignmentSchemaVersion: 1 }]
            : assignedParts();
        const terms = (parts.length ? parts : [{}]).map(part => {
            const position = jobs.get(String(part.positionId));
            const leaderId = part.assignmentSchemaVersion === 1 ? part.payerLeaderId : position?.leaderId;
            const leader = leaderId == null || leaderId === '' ? '__none__' : String(leaderId);
            const job = part.positionId == null || part.positionId === '' ? '__none__' : String(part.positionId);
            leaderOptions.set(leader, bosses.get(leader)?.name || part.payerLeaderName || (leader === '__none__' ? 'Sin líder' : 'Líder fuera del catálogo'));
            positionOptions.set(job, position?.name || part.positionName || (job === '__none__' ? 'Sin posición' : 'Posición fuera del catálogo'));
            return { leader, position: job };
        });
        return { id: String(group.employeeId), search: normalize(`${group.employeeName} #${group.employeeNumber ?? ''}`),
            selected: group.selectedCount > 0, terms };
    });
    if (!leaderOptions.has(currentFilters.leader)) currentFilters.leader = '';
    if (!positionOptions.has(currentFilters.position)) currentFilters.position = '';
    const options = map => [...map].sort((a, b) => collator.compare(a[1], b[1]));
    return { rows, filters: { ...currentFilters }, leaderOptions: options(leaderOptions), positionOptions: options(positionOptions) };
}

export function payrollLoanListCount(rows, filters) {
    const visible = rows.filter(row => matchesPayrollLoanList(row, filters));
    const hiddenSelected = rows.filter(row => row.selected && !matchesPayrollLoanList(row, filters)).length;
    return `${visible.length} de ${rows.length} empleados${hiddenSelected ? ` · ${hiddenSelected} con cobros seleccionados fuera del filtro` : ''}`;
}

export function renderPayrollLoanListFilters(list) {
    const { filters } = list;
    const select = (field, label, options) => `<label><span>${label}</span><select data-payroll-loan-filter="${field}">
        <option value="">Todos</option>${options.map(([value, name]) => `<option value="${safe(value)}" ${filters[field] === value ? 'selected' : ''}>${safe(name)}</option>`).join('')}</select></label>`;
    return `<div class="payroll-loan-list-filters" role="group" aria-label="Filtrar empleados con préstamos">
        <label class="payroll-loan-list-filters__search"><span>Buscar empleado</span><input type="search" autocomplete="off" data-payroll-loan-filter="query" placeholder="Nombre o número" value="${safe(filters.query)}"></label>
        ${select('leader', 'Líder que paga', list.leaderOptions)}
        ${select('position', 'Posición', list.positionOptions)}
        ${select('selection', 'Cobros', [['selected', 'Seleccionados'], ['unselected', 'Sin seleccionar']])}
        <div class="payroll-loan-list-filters__footer"><p data-payroll-loan-list-count role="status" aria-live="polite">${safe(payrollLoanListCount(list.rows, filters))}</p>
        <button type="button" data-payroll-loan-filter-clear ${hasPayrollLoanListFilters(filters) ? '' : 'hidden'}>Quitar filtros</button></div>
        <p class="payroll-loan-list-filters__hint">Solo filtra este listado; conserva los cobros y los totales.</p>
    </div>`;
}

/** Filters only the existing DOM: no payroll render, financial write or lost input draft. */
export function handlePayrollLoanListFilter(event) {
    const control = event.target.closest?.('[data-payroll-loan-filter], [data-payroll-loan-filter-clear]');
    if (!control || (event.type === 'click' && !control.hasAttribute('data-payroll-loan-filter-clear'))) return false;
    const root = control.closest('[data-payroll-loan-list-key]');
    if (!root) return false;
    if (root.dataset.payrollLoanListKey !== currentKey) { currentKey = root.dataset.payrollLoanListKey; currentFilters = blank(); }
    const clear = control.hasAttribute('data-payroll-loan-filter-clear');
    if (clear) {
        currentFilters = blank();
        root.querySelectorAll('[data-payroll-loan-filter]').forEach(input => { input.value = ''; });
    } else {
        const field = control.dataset.payrollLoanFilter;
        if (!Object.hasOwn(currentFilters, field)) return false;
        currentFilters[field] = control.value;
    }
    const rows = [...root.querySelectorAll('[data-payroll-loan-list-row]')].map(element => {
        const row = JSON.parse(element.dataset.payrollLoanListRow);
        element.hidden = !matchesPayrollLoanList(row, currentFilters);
        return row;
    });
    const active = hasPayrollLoanListFilters(currentFilters);
    root.querySelector('[data-payroll-loan-list-count]').textContent = payrollLoanListCount(rows, currentFilters);
    root.querySelector('[data-payroll-loan-filter-clear]').hidden = !active;
    root.querySelector('[data-payroll-loan-list-empty]').hidden = rows.some(row => matchesPayrollLoanList(row, currentFilters)) || !rows.length;
    root.querySelectorAll('[data-payroll-loan-list-bulk]').forEach(button => {
        button.disabled = active || button.dataset.payrollLoanListBulk === 'disabled';
    });
    root.querySelector('[data-payroll-loan-list-bulk-hint]').hidden = !active;
    if (clear) root.querySelector('[data-payroll-loan-filter="query"]').focus({ preventScroll: true });
    return true;
}
