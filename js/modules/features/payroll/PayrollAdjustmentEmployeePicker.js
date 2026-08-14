import { Modal } from '../../components/Modal.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';

function normalizeSearch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('es')
        .trim();
}

export function filterPayrollAdjustmentEmployees(employees = [], { query = '', status = 'all' } = {}) {
    const normalizedQuery = normalizeSearch(query);
    return employees.filter(employee => {
        if (status === 'active' && employee.active === false) return false;
        if (status === 'inactive' && employee.active !== false) return false;
        if (!normalizedQuery) return true;
        const searchable = normalizeSearch([
            employee.number,
            employee.name,
            ...(employee.positions || [])
        ].join(' '));
        return searchable.includes(normalizedQuery);
    });
}

function renderEmployeeRows(employees, selectedIds) {
    const selected = new Set((selectedIds || []).map(String));
    if (employees.length === 0) {
        return '<p class="payroll-adjustment-picker__empty">No hay empleados que coincidan con el filtro.</p>';
    }

    return employees.map(employee => {
        const id = String(employee.id);
        const isSelected = selected.has(id);
        const positions = (employee.positions || []).slice(0, 3);
        return `
            <button type="button"
                    class="payroll-adjustment-picker__employee ${isSelected ? 'is-selected' : ''}"
                    data-adjustment-picker-employee="${escapeHTML(id)}"
                    aria-pressed="${isSelected}">
                <span class="payroll-adjustment-picker__number">${escapeHTML(employee.number || 'S/N')}</span>
                <span class="payroll-adjustment-picker__identity">
                    <strong>${escapeHTML(employee.name || 'Sin nombre')}</strong>
                    <span class="payroll-adjustment-picker__positions">
                        ${positions.length
                            ? positions.map(position => `<small>${escapeHTML(position)}</small>`).join('')
                            : '<small>Sin puesto</small>'}
                    </span>
                </span>
                <span class="payroll-adjustment-picker__gross">
                    <small>Bruto del período</small>
                    <strong>${formatCurrency(Number(employee.gross) || 0)}</strong>
                </span>
                <span class="payroll-adjustment-picker__status is-${employee.active === false ? 'inactive' : 'active'}">
                    ${employee.active === false ? 'Inactivo' : 'Activo'}
                </span>
                <span class="payroll-adjustment-picker__check" aria-hidden="true">✓</span>
            </button>
        `;
    }).join('');
}

export function renderPayrollAdjustmentEmployeePicker({
    employees = [],
    selectedIds = [],
    query = '',
    status = 'all'
} = {}) {
    const filtered = filterPayrollAdjustmentEmployees(employees, { query, status });
    const filters = [
        ['active', 'Activos'],
        ['inactive', 'Inactivos'],
        ['all', 'Todos']
    ];
    return `
        <div class="payroll-adjustment-picker">
            <div class="payroll-adjustment-picker__toolbar">
                <label>
                    <span>Buscar empleado</span>
                    <input type="search"
                           value="${escapeHTML(query)}"
                           placeholder="Nombre, número o puesto"
                           data-adjustment-picker-search>
                </label>
                <div class="payroll-adjustment-picker__filters" role="group" aria-label="Filtrar por estado">
                    ${filters.map(([value, label]) => `
                        <button type="button"
                                data-adjustment-picker-status="${value}"
                                aria-pressed="${status === value}">${label}</button>
                    `).join('')}
                </div>
            </div>
            <div class="payroll-adjustment-picker__list" data-adjustment-picker-list>
                ${renderEmployeeRows(filtered, selectedIds)}
            </div>
        </div>
    `;
}

export function openPayrollAdjustmentEmployeePicker({ employees = [], selectedIds = [] } = {}) {
    return new Promise(resolve => {
        const selection = new Set(selectedIds.map(String));
        let query = '';
        let status = 'all';
        let resolved = false;
        const finish = value => {
            if (resolved) return;
            resolved = true;
            resolve(value);
        };
        const modal = new Modal({
            title: 'Seleccionar empleados',
            subtitle: 'Agrega varios empleados a la misma regla.',
            content: renderPayrollAdjustmentEmployeePicker({ employees, selectedIds: [...selection], query, status }),
            size: 'large',
            onOpen() {
                const renderList = () => {
                    const filtered = filterPayrollAdjustmentEmployees(employees, { query, status });
                    const list = this.element.querySelector('[data-adjustment-picker-list]');
                    if (list) list.innerHTML = renderEmployeeRows(filtered, [...selection]);
                    this.element.querySelectorAll('[data-adjustment-picker-status]').forEach(button => {
                        button.setAttribute('aria-pressed', String(button.dataset.adjustmentPickerStatus === status));
                    });
                };
                this.element.querySelector('[data-adjustment-picker-search]')?.addEventListener('input', event => {
                    query = event.target.value;
                    renderList();
                });
                this.element.querySelector('.payroll-adjustment-picker__filters')?.addEventListener('click', event => {
                    const button = event.target.closest('[data-adjustment-picker-status]');
                    if (!button) return;
                    status = button.dataset.adjustmentPickerStatus;
                    renderList();
                });
                this.element.querySelector('[data-adjustment-picker-list]')?.addEventListener('click', event => {
                    const row = event.target.closest('[data-adjustment-picker-employee]');
                    if (!row) return;
                    const id = row.dataset.adjustmentPickerEmployee;
                    if (selection.has(id)) selection.delete(id);
                    else selection.add(id);
                    renderList();
                });
                this.element.querySelector('[data-adjustment-picker-search]')?.focus();
            },
            onClose() {
                finish(null);
            },
            buttons: [{
                text: 'Cancelar',
                class: 'btn-secondary',
                onClick() {
                    finish(null);
                    this.close();
                }
            }, {
                text: 'Aplicar selección',
                class: 'btn-primary',
                onClick() {
                    finish([...selection]);
                    this.close();
                }
            }]
        });
        modal.open();
    });
}

export default {
    filterPayrollAdjustmentEmployees,
    renderPayrollAdjustmentEmployeePicker,
    openPayrollAdjustmentEmployeePicker
};
