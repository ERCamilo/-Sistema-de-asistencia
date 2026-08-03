import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';

function text(value) {
    return escapeHTML(value === null || value === undefined ? '' : String(value));
}

function hasAmount(rows, key) {
    return (rows || []).some(row => Math.abs(Number(row?.[key]) || 0) >= 0.005);
}

function formatDateTime(value) {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return 'Sin fecha';
    return new Intl.DateTimeFormat('es', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function statusLabel(status) {
    return status === 'voided' ? 'Anulada' : 'Cerrada';
}

function syncLabel(status) {
    if (status === 'dead') return '<span class="payroll-history-sync is-error">Error de sincronización</span>';
    if (status === 'pending') return '<span class="payroll-history-sync is-pending">Pendiente de sincronizar</span>';
    return '';
}

export function filterPayrollClosureHistory(items = [], filters = {}) {
    return (items || []).filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.periodStart && String(item.periodEnd || '') < String(filters.periodStart)) return false;
        if (filters.periodEnd && String(item.periodStart || '') > String(filters.periodEnd)) return false;
        return true;
    });
}

function renderHistoryCard(closure) {
    const loanTotal = Number(closure.totals?.loans) || 0;
    return `
        <button type="button"
                class="payroll-history-card"
                data-payroll-action="open-payroll-history-detail"
                data-id="${text(closure.id)}"
                aria-label="Abrir nómina del ${text(closure.periodStart)} al ${text(closure.periodEnd)}">
            <span class="payroll-history-card__status is-${text(closure.status)}">${statusLabel(closure.status)}</span>
            <span class="payroll-history-card__period">
                <strong>${text(closure.periodStart)} – ${text(closure.periodEnd)}</strong>
                <small>${formatDateTime(closure.closedAt)} · ${text(closure.closedBy || 'Sin usuario')}</small>
            </span>
            <span class="payroll-history-card__facts">
                <span><small>Empleados</small><strong>${Number(closure.employeeCount) || 0}</strong></span>
                <span><small>Neto</small><strong>${formatCurrency(closure.totals?.net)}</strong></span>
                <span class="is-loan"><small>Préstamos</small><strong>${formatCurrency(loanTotal)}</strong></span>
            </span>
            ${syncLabel(closure.syncStatus)}
            <span class="payroll-history-card__arrow" aria-hidden="true">›</span>
        </button>
    `;
}

export function renderPayrollHistoryView({
    items = [],
    filters = {},
    loading = false,
    error = null,
    nextCursor = null,
    selectedClosure = null,
    now = Date.now()
} = {}) {
    if (selectedClosure) return renderPayrollHistoryDetail(selectedClosure, { now });
    const visible = filterPayrollClosureHistory(items, filters);
    return `
        <section class="payroll-history" aria-labelledby="payroll-history-title">
            <header class="payroll-history__header">
                <div>
                    <span class="payroll-history__eyebrow">Auditoría</span>
                    <h2 id="payroll-history-title">Historial de nóminas</h2>
                    <p>Consultá cierres guardados sin alterar el generador actual.</p>
                </div>
            </header>
            <div class="payroll-history__filters" aria-label="Filtros del historial">
                <label>
                    <span>Estado</span>
                    <select class="form-input" data-payroll-history-filter="status">
                        <option value="" ${filters.status ? '' : 'selected'}>Todos</option>
                        <option value="closed" ${filters.status === 'closed' ? 'selected' : ''}>Cerradas</option>
                        <option value="voided" ${filters.status === 'voided' ? 'selected' : ''}>Anuladas</option>
                    </select>
                </label>
                <label>
                    <span>Desde</span>
                    <input class="form-input" type="date" data-payroll-history-filter="periodStart"
                           value="${text(filters.periodStart || '')}">
                </label>
                <label>
                    <span>Hasta</span>
                    <input class="form-input" type="date" data-payroll-history-filter="periodEnd"
                           value="${text(filters.periodEnd || '')}">
                </label>
            </div>
            ${error ? `<div class="payroll-history__message is-error" role="alert">${text(error)}</div>` : ''}
            <div class="payroll-history__list" aria-live="polite" aria-busy="${loading}">
                ${visible.map(renderHistoryCard).join('')}
                ${!loading && visible.length === 0 && !error
                    ? '<div class="payroll-history__message">No hay cierres para estos filtros.</div>'
                    : ''}
                ${loading ? '<div class="payroll-history__message">Cargando historial…</div>' : ''}
            </div>
            ${nextCursor && !loading ? `
                <button type="button" class="payroll-history__more"
                        data-payroll-action="load-more-payroll-history">
                    Cargar más
                </button>
            ` : ''}
        </section>
    `;
}

export function renderPayrollHistoryDetail(closure, { now = Date.now() } = {}) {
    if (!closure) return '<div class="payroll-history__message">No se encontró el cierre.</div>';
    const rows = closure.rows || [];
    const showBonuses = hasAmount(rows, 'bonuses');
    const showDeductions = hasAmount(rows, 'deductions');
    const showLoans = hasAmount(rows, 'loans');
    const canUndo = closure.status === 'closed' && Number(now) <= Number(closure.undoUntil || 0);
    return `
        <section class="payroll-history payroll-history-detail" aria-labelledby="payroll-history-detail-title">
            <button type="button" class="payroll-history-detail__back"
                    data-payroll-action="close-payroll-history-detail">
                ← Volver al historial
            </button>
            <header class="payroll-history-detail__header">
                <div>
                    <span class="payroll-history-card__status is-${text(closure.status)}">${statusLabel(closure.status)}</span>
                    <h2 id="payroll-history-detail-title">${text(closure.periodStart)} – ${text(closure.periodEnd)}</h2>
                    <p>Cerrada ${formatDateTime(closure.closedAt)} · ${text(closure.closedBy || 'Sin usuario')}</p>
                    ${closure.supersedesId ? `<small>Corrección de ${text(closure.supersedesId)}</small>` : ''}
                    ${closure.status === 'voided' ? `<small>Anulada ${formatDateTime(closure.voidedAt)} · ${text(closure.voidedBy || 'Sin usuario')}</small>` : ''}
                </div>
                <div class="payroll-history-detail__actions">
                    ${syncLabel(closure.syncStatus)}
                    ${canUndo ? `
                        <button type="button" class="payroll-loan-settlement__undo"
                                data-payroll-action="undo-payroll-closure"
                                data-id="${text(closure.id)}">Deshacer cierre</button>
                    ` : ''}
                </div>
            </header>
            <div class="payroll-history-detail__notice" role="note">
                Este es un registro histórico inmutable. Los datos actuales del empleado no lo modifican.
            </div>
            <div class="payroll-history-detail__totals">
                <span><small>Bruto</small><strong>${formatCurrency(closure.totals?.gross)}</strong></span>
                ${showBonuses ? `<span><small>Bonificaciones</small><strong>${formatCurrency(closure.totals?.bonuses)}</strong></span>` : ''}
                ${showDeductions ? `<span><small>Deducciones</small><strong>${formatCurrency(closure.totals?.deductions)}</strong></span>` : ''}
                ${showLoans ? `<span class="is-loan"><small>Préstamos</small><strong>${formatCurrency(closure.totals?.loans)}</strong></span>` : ''}
                <span class="is-net"><small>Neto</small><strong>${formatCurrency(closure.totals?.net)}</strong></span>
            </div>
            <div class="payroll-history-detail__table-wrap" tabindex="0" aria-label="Detalle de empleados; desplazamiento horizontal disponible">
                <table class="payroll-history-detail__table">
                    <thead><tr>
                        <th scope="col">Empleado</th>
                        <th scope="col">Posición</th>
                        <th scope="col">Bruto</th>
                        ${showBonuses ? '<th scope="col">Bonificaciones</th>' : ''}
                        ${showDeductions ? '<th scope="col">Deducciones</th>' : ''}
                        ${showLoans ? '<th scope="col" class="is-loan">Préstamos</th>' : ''}
                        <th scope="col">Neto</th>
                    </tr></thead>
                    <tbody>${rows.map(row => `
                        <tr>
                            <th scope="row"><small>#${text(row.employeeNumber)}</small>${text(row.employeeName)}</th>
                            <td>${text(row.employeePosition || 'Sin posición')}</td>
                            <td>${formatCurrency(row.gross)}</td>
                            ${showBonuses ? `<td>${formatCurrency(row.bonuses)}</td>` : ''}
                            ${showDeductions ? `<td>${formatCurrency(row.deductions)}</td>` : ''}
                            ${showLoans ? `<td class="is-loan">${formatCurrency(row.loans)}</td>` : ''}
                            <td class="is-net">${formatCurrency(row.net)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            </div>
        </section>
    `;
}

export default { filterPayrollClosureHistory, renderPayrollHistoryDetail, renderPayrollHistoryView };
