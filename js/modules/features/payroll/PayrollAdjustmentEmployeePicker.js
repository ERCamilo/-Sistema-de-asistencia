import { Modal } from '../../components/Modal.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { renderPayrollStatus } from './PayrollStatus.js';

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
                ${employee.inPayroll === false ? `<span class="payroll-adjustment-picker__notice">${renderPayrollStatus('No está en la nómina')}</span>` : ''}
                <span class="payroll-adjustment-picker__check" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" focusable="false"><path d="m5 12 4 4L19 6"/></svg></span>
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
                <label for="payroll-adjustment-picker-search">
                    <span>Buscar empleado</span>
                    <input type="search"
                           id="payroll-adjustment-picker-search"
                           name="adjustmentPickerSearch"
                           autocomplete="off"
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

export function openPayrollAdjustmentEmployeePicker({ employees = [], selectedIds = [], subtitle = 'Selecciona a quién aplicar la regla.' } = {}) {
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
            subtitle,
            content: renderPayrollAdjustmentEmployeePicker({ employees, selectedIds: [...selection], query, status }),
            size: 'large',
            onOpen() {
                const container = this.element.querySelector('[data-modal-container]');
                container?.classList.add('payroll-adjustment-picker-modal');
                const fitViewport = () => container?.style.setProperty('--payroll-picker-height',
                    `${Math.max(0, (window.visualViewport?.height || window.innerHeight) - (window.innerWidth <= 620 ? 16 : 24))}px`);
                fitViewport();
                window.visualViewport?.addEventListener('resize', fitViewport);
                window.addEventListener('resize', fitViewport);
                this.cleanupPickerViewport = () => {
                    window.visualViewport?.removeEventListener('resize', fitViewport);
                    window.removeEventListener('resize', fitViewport);
                };
                const updateCount = () => {
                    const apply = this.element.querySelector('[data-button-index="1"]');
                    if (!apply) return;
                    apply.textContent = `Aplicar (${selection.size})`;
                    apply.setAttribute('aria-label', `Aplicar selección: ${selection.size} empleados`);
                };
                updateCount();
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
                    // Selecting one person must not rebuild every row or move the scroll position.
                    row.classList.toggle('is-selected', selection.has(id));
                    row.setAttribute('aria-pressed', String(selection.has(id)));
                    updateCount();
                });
                const searchEl = this.element.querySelector('[data-adjustment-picker-search]');
                if (searchEl && window.innerWidth > 620 && !window.matchMedia?.('(pointer: coarse)').matches) {
                    try {
                        searchEl.focus({ preventScroll: true });
                    } catch {
                        searchEl.focus();
                    }
                }
            },
            onClose() {
                this.cleanupPickerViewport?.();
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
