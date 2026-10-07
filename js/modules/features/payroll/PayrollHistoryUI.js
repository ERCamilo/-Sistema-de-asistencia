import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML } from '../../utils/Sanitize.js';

function text(value) {
    return escapeHTML(value === null || value === undefined ? '' : String(value));
}

function hasAmount(rows, key) {
    return (rows || []).some(row => Math.abs(Number(row?.[key]) || 0) >= 0.005);
}

function money(value) {
    return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeDetailFilters(filters = {}) {
    return {
        leaderId: String(filters.leaderId || ''),
        includeBonuses: filters.includeBonuses !== false,
        includeDeductions: filters.includeDeductions !== false,
        includeLoans: filters.includeLoans !== false
    };
}

export function calculatePayrollHistoryNet(row = {}, filters = {}) {
    const normalized = normalizeDetailFilters(filters);
    return money(
        (Number(row.gross) || 0) +
        (normalized.includeBonuses ? Number(row.bonuses) || 0 : 0) -
        (normalized.includeDeductions ? Number(row.deductions) || 0 : 0) -
        (normalized.includeLoans ? Number(row.loans) || 0 : 0)
    );
}

function sortHistoryRows(rows = []) {
    return [...rows].sort((left, right) =>
        String(left.employeeNumber || '').localeCompare(
            String(right.employeeNumber || ''),
            'es',
            { numeric: true }
        ) || String(left.employeeId || '').localeCompare(String(right.employeeId || ''))
    );
}

function historyLeaders(rows = []) {
    const leaders = new Map();
    for (const row of rows) {
        for (const leader of row.leaderRefs || []) {
            if (leader?.id && !leaders.has(String(leader.id))) leaders.set(String(leader.id), leader);
        }
    }
    return [...leaders.values()].sort((left, right) =>
        String(left.number || '').localeCompare(String(right.number || ''), 'es', { numeric: true }) ||
        String(left.name || '').localeCompare(String(right.name || ''), 'es')
    );
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

function shortDay(key) {
    const value = String(key || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : value;
}

function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

function reviewFlagsFor(review, id) {
    const flags = review?.cardFlags;
    if (!flags) return null;
    return (flags instanceof Map ? flags.get(String(id)) : flags[String(id)]) || null;
}

/** Explicación de una línea, solo con hechos, de lo que se revisa en el cierre. */
function closureFlagCopy(flags) {
    if (!flags) return null;
    if (flags.superseded) return { text: 'Reemplazada por otro cierre del mismo periodo', info: true };
    if (flags.duplicateOf) return { text: 'Copia repetida de otro cierre del mismo periodo', info: false };
    const parts = [];
    if (flags.closedBeforePeriodEnd) parts.push(`Se cerró el ${shortDay(flags.closedBeforePeriodEnd.closedOn)}, antes de terminar el periodo`);
    if (flags.missingPeriodLoans) {
        parts.push(`No incluye ${plural(flags.missingPeriodLoans.count, 'abono anotado', 'abonos anotados')} para estas fechas (${formatCurrency(flags.missingPeriodLoans.total)})`);
    }
    if (parts.length > 0) return { text: parts.join(' · '), info: false };
    if (flags.offGrid) return { text: `Fechas corridas respecto al periodo de pago (${text(flags.offGrid.label)})`, info: true };
    return null;
}

function closureStatusPill(closure, flags) {
    if (closure.status === 'closed' && flags?.superseded) {
        return '<span class="payroll-history-card__status is-voided">Reemplazada</span>';
    }
    if (closure.status === 'closed' && flags?.duplicateOf) {
        return '<span class="payroll-history-card__status is-review">Repetida</span>';
    }
    if (closure.status === 'closed' && flags?.needsReview) {
        return '<span class="payroll-history-card__status is-review">Revisar</span>';
    }
    return `<span class="payroll-history-card__status is-${text(closure.status)}">${statusLabel(closure.status)}</span>`;
}

function renderHistoryCard(closure, review = null) {
    const loanTotal = Number(closure.totals?.loans) || 0;
    const flags = closure.status === 'closed' ? reviewFlagsFor(review, closure.id) : null;
    const flag = closureFlagCopy(flags);
    return `
        <button type="button"
                class="payroll-history-card"
                data-payroll-action="open-payroll-history-detail"
                data-id="${text(closure.id)}"
                aria-label="Abrir nómina del ${text(closure.periodStart)} al ${text(closure.periodEnd)}">
            ${closureStatusPill(closure, flags)}
            <span class="payroll-history-card__period">
                <strong>${text(closure.periodStart)} – ${text(closure.periodEnd)}</strong>
                <small>${formatDateTime(closure.closedAt)} · ${text(closure.closedBy || 'Sin usuario')}</small>
                ${flag ? `<span class="payroll-history-card__flag ${flag.info ? 'is-info' : ''}">${flag.text}</span>` : ''}
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

function registrationButton(period, { supersedesId = null, className = '' } = {}) {
    return `
        <button type="button" class="payroll-history-review__action ${className}"
                data-payroll-action="start-payroll-registration"
                data-value="${text(period.periodStart)}|${text(period.periodEnd)}"
                ${supersedesId ? `data-supersedes-id="${text(supersedesId)}"` : ''}>
            Registrar cierre
        </button>
    `;
}

function renderMissingPeriodCard(period, { readOnly = false } = {}) {
    const count = Number(period.paymentsCount) || 0;
    return `
        <div class="payroll-history-card is-missing" role="group"
             aria-label="Periodo del ${text(period.periodStart)} al ${text(period.periodEnd)} sin cierre">
            <span class="payroll-history-card__status is-missing">Sin cierre</span>
            <span class="payroll-history-card__period">
                <strong>${text(period.periodStart)} – ${text(period.periodEnd)}</strong>
                <small>Pago del ${shortDay(period.payDate)} · ${count > 0 ? `${plural(count, 'abono anotado', 'abonos anotados')} a mano` : 'sin abonos anotados'}</small>
            </span>
            <span class="payroll-history-card__facts">
                <span><small>Abonos anotados</small><strong>${count}</strong></span>
                <span><small>Pago</small><strong>${shortDay(period.payDate)}</strong></span>
                <span class="is-loan"><small>Préstamos</small><strong>${formatCurrency(period.paymentsTotal)}</strong></span>
            </span>
            ${readOnly ? '' : `<span class="payroll-history-card__cta">${registrationButton(period)}</span>`}
        </div>
    `;
}

function renderReviewIssue(issue, { readOnly = false } = {}) {
    const period = `${shortDay(issue.periodStart)} al ${shortDay(issue.periodEnd)}`;
    if (issue.kind === 'duplicate') {
        const shared = Number(issue.paymentsCount) > 0
            ? `Las dos copias comparten ${Number(issue.paymentsCount) === 1 ? 'el mismo abono' : `los mismos ${issue.paymentsCount} abonos`} (${formatCurrency(issue.loansTotal)}).`
            : 'Las dos copias tienen el mismo contenido.';
        return `
            <div class="payroll-history-review__issue">
                <span class="payroll-history-card__status is-review">Repetida</span>
                <div>
                    <strong>El cierre del ${period} está guardado dos veces</strong>
                    <p>${shared} Se anula la copia sin tocar los abonos ni lo que deben.</p>
                </div>
                ${readOnly ? '<span></span>' : `
                    <button type="button" class="payroll-history-review__action is-warn"
                            data-payroll-action="remove-duplicate-payroll-closure"
                            data-id="${text(issue.closureId)}">
                        Quitar copia
                    </button>
                `}
            </div>
        `;
    }
    const facts = [];
    if (issue.flags?.closedBeforePeriodEnd) {
        facts.push(`Se cerró el ${shortDay(issue.flags.closedBeforePeriodEnd.closedOn)}, antes de terminar el periodo.`);
    }
    if (Number(issue.paymentsCount) > 0) {
        facts.push(`${Number(issue.paymentsCount) === 1 ? 'El abono' : `Los ${issue.paymentsCount} abonos`} del periodo (${formatCurrency(issue.paymentsTotal)}) se ${Number(issue.paymentsCount) === 1 ? 'anotó' : 'anotaron'} a mano y no están en el cierre.`);
    }
    facts.push('Registra el cierre correcto, que reemplaza a este.');
    return `
        <div class="payroll-history-review__issue">
            <span class="payroll-history-card__status is-review">Revisar</span>
            <div>
                <strong>La nómina del ${shortDay(issue.payDate)} (${period}) tiene un cierre que no cuadra</strong>
                <p>${facts.join(' ')}</p>
            </div>
            ${readOnly ? '<span></span>' : registrationButton(issue, { supersedesId: issue.closureId, className: 'is-primary' })}
        </div>
    `;
}

function renderClosureReview(review, { readOnly = false } = {}) {
    const issues = review?.issues || [];
    const missing = (review?.periodsWithoutClosure || []).filter(period => !period.replaceableClosure);
    if (issues.length === 0 && missing.length === 0) return '';
    const summary = [
        issues.length > 0 ? `${issues.length} por resolver` : 'Cierres en orden',
        missing.length > 0 ? plural(missing.length, 'periodo sin cierre', 'periodos sin cierre') : ''
    ].filter(Boolean).join(' · ');
    return `
        <section class="payroll-history-review" aria-label="Revisión de cierres">
            <header>
                <h3>Revisión de cierres</h3>
                <span>${summary}</span>
            </header>
            ${issues.map(issue => renderReviewIssue(issue, { readOnly })).join('')}
        </section>
    `;
}

function filterMissingPeriods(periods = [], filters = {}) {
    if (filters.status && filters.status !== 'missing') return [];
    return (periods || []).filter(period => {
        if (period.replaceableClosure) return false;
        if (filters.periodStart && String(period.periodEnd || '') < String(filters.periodStart)) return false;
        if (filters.periodEnd && String(period.periodStart || '') > String(filters.periodEnd)) return false;
        return true;
    });
}

export function renderPayrollHistoryView({
    items = [],
    filters = {},
    loading = false,
    error = null,
    nextCursor = null,
    page = 1,
    hasPrevious = false,
    selectedClosure = null,
    currentEmployees = [],
    detailFilters = {},
    readOnly = false,
    review = null,
    now = Date.now()
} = {}) {
    if (selectedClosure) return renderPayrollHistoryDetail(selectedClosure, {
        now,
        currentEmployees,
        detailFilters,
        readOnly
    });
    const visible = filters.status === 'missing' ? [] : filterPayrollClosureHistory(items, filters).slice(0, 10);
    // Los periodos sin cierre no son registros guardados: se muestran en la primera página.
    const missing = Math.max(1, Number(page) || 1) === 1 ? filterMissingPeriods(review?.periodsWithoutClosure, filters) : [];
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
                        <option value="missing" ${filters.status === 'missing' ? 'selected' : ''}>Sin cierre</option>
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
            ${renderClosureReview(review, { readOnly })}
            ${error ? `<div class="payroll-history__message is-error" role="alert">${text(error)}</div>` : ''}
            <div class="payroll-history__list" aria-live="polite" aria-busy="${loading}">
                ${visible.map(closure => renderHistoryCard(closure, review)).join('')}
                ${missing.map(period => renderMissingPeriodCard(period, { readOnly })).join('')}
                ${!loading && visible.length === 0 && missing.length === 0 && !error
                    ? '<div class="payroll-history__message">No hay cierres para estos filtros.</div>'
                    : ''}
                ${loading ? '<div class="payroll-history__message">Cargando historial…</div>' : ''}
            </div>
            <nav class="payroll-history__pagination" aria-label="Páginas del historial">
                <button type="button" class="payroll-history__more"
                        data-payroll-action="previous-payroll-history-page"
                        ${hasPrevious && !loading ? '' : 'disabled'}>
                    Anterior
                </button>
                <span aria-live="polite">Página ${Math.max(1, Number(page) || 1)}</span>
                <button type="button" class="payroll-history__more"
                        data-payroll-action="next-payroll-history-page"
                        ${nextCursor && !loading ? '' : 'disabled'}>
                    Siguiente
                </button>
            </nav>
        </section>
    `;
}

export function renderPayrollHistoryDetail(closure, {
    now = Date.now(),
    currentEmployees = [],
    detailFilters = {},
    readOnly = false
} = {}) {
    if (!closure) return '<div class="payroll-history__message">No se encontró el cierre.</div>';
    const filters = normalizeDetailFilters(detailFilters);
    const allRows = sortHistoryRows(closure.rows || []);
    const leaders = historyLeaders(allRows);
    const rows = filters.leaderId
        ? allRows.filter(row => (row.leaderRefs || []).some(leader => String(leader.id) === filters.leaderId))
        : allRows;
    const showBonuses = hasAmount(rows, 'bonuses');
    const showDeductions = hasAmount(rows, 'deductions');
    const showLoans = hasAmount(rows, 'loans');
    const isSimulation = !filters.includeBonuses || !filters.includeDeductions || !filters.includeLoans;
    const visibleTotals = rows.reduce((totals, row) => ({
        gross: money(totals.gross + (Number(row.gross) || 0)),
        bonuses: money(totals.bonuses + (Number(row.bonuses) || 0)),
        deductions: money(totals.deductions + (Number(row.deductions) || 0)),
        loans: money(totals.loans + (Number(row.loans) || 0)),
        net: money(totals.net + (Number(row.net) || 0)),
        simulatedNet: money(totals.simulatedNet + calculatePayrollHistoryNet(row, filters))
    }), { gross: 0, bonuses: 0, deductions: 0, loans: 0, net: 0, simulatedNet: 0 });
    const currentById = new Map((currentEmployees || []).map(employee => [String(employee.id), employee]));
    const canUndo = !readOnly && closure.status === 'closed';
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
                    ${closure.registrationKind === 'already-paid' ? `<small>Periodo ya pagado: ${plural((closure.linkedPaymentRefs || []).length, 'abono anotado enlazado', 'abonos anotados enlazados')}; no se cobraron préstamos otra vez.</small>` : ''}
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
                ${readOnly ? 'Consulta de solo lectura para la obra activa. ' : ''}Este es un registro histórico inmutable. Los datos actuales del empleado no lo modifican.
            </div>
            <div class="payroll-history-detail__controls" aria-label="Filtros y simulación del detalle">
                <label>
                    <span>Líder histórico</span>
                    <select class="form-input" data-payroll-history-detail-filter="leaderId">
                        <option value="" ${filters.leaderId ? '' : 'selected'}>Todos</option>
                        ${leaders.map(leader => `
                            <option value="${text(leader.id)}" ${filters.leaderId === String(leader.id) ? 'selected' : ''}>
                                ${leader.number ? `#${text(leader.number)} · ` : ''}${text(leader.name || 'Sin nombre')}
                            </option>
                        `).join('')}
                    </select>
                </label>
                <fieldset>
                    <legend>Calcular neto incluyendo</legend>
                    <label><input type="checkbox" data-payroll-history-detail-filter="includeBonuses" ${filters.includeBonuses ? 'checked' : ''}> Bonificaciones</label>
                    <label><input type="checkbox" data-payroll-history-detail-filter="includeDeductions" ${filters.includeDeductions ? 'checked' : ''}> Deducciones</label>
                    <label><input type="checkbox" data-payroll-history-detail-filter="includeLoans" ${filters.includeLoans ? 'checked' : ''}> Préstamos</label>
                </fieldset>
            </div>
            <div class="payroll-history-detail__totals">
                <span><small>Bruto</small><strong>${formatCurrency(visibleTotals.gross)}</strong></span>
                ${showBonuses ? `<span><small>Bonificaciones</small><strong>${formatCurrency(visibleTotals.bonuses)}</strong></span>` : ''}
                ${showDeductions ? `<span><small>Deducciones</small><strong>${formatCurrency(visibleTotals.deductions)}</strong></span>` : ''}
                ${showLoans ? `<span class="is-loan"><small>Préstamos</small><strong>${formatCurrency(visibleTotals.loans)}</strong></span>` : ''}
                <span class="is-net"><small>Neto pagado</small><strong>${formatCurrency(visibleTotals.net)}</strong></span>
                ${isSimulation ? `<span class="is-simulated"><small>Neto simulado</small><strong>${formatCurrency(visibleTotals.simulatedNet)}</strong></span>` : ''}
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
                        <th scope="col">${isSimulation ? 'Neto simulado' : 'Neto pagado'}</th>
                    </tr></thead>
                    <tbody>${rows.map(row => {
        const current = currentById.get(String(row.employeeId));
        const currentNumber = current?.number == null ? '' : String(current.number);
        const changedNumber = currentNumber && currentNumber !== String(row.employeeNumber || '');
        const leaderCopy = (row.leaderRefs || []).map(leader =>
            `${leader.number ? `#${text(leader.number)} · ` : ''}${text(leader.name || 'Sin nombre')}`
        ).join(', ');
        return `
                        <tr>
                            <th scope="row">
                                <small>#${text(row.employeeNumber)}${changedNumber ? ` · Actual #${text(currentNumber)}` : ''}</small>
                                ${text(row.employeeName)}
                            </th>
                            <td>
                                ${text(row.employeePosition || 'Sin posición')}
                                ${leaderCopy ? `<small>${leaderCopy}</small>` : ''}
                            </td>
                            <td>${formatCurrency(row.gross)}</td>
                            ${showBonuses ? `<td>${formatCurrency(row.bonuses)}</td>` : ''}
                            ${showDeductions ? `<td>${formatCurrency(row.deductions)}</td>` : ''}
                            ${showLoans ? `<td class="is-loan">${formatCurrency(row.loans)}</td>` : ''}
                            <td class="is-net">${formatCurrency(isSimulation ? calculatePayrollHistoryNet(row, filters) : row.net)}</td>
                        </tr>
                    `;
    }).join('')}${rows.length === 0 ? '<tr><td colspan="7">No hay empleados para este líder.</td></tr>' : ''}</tbody>
                </table>
            </div>
        </section>
    `;
}

export default {
    calculatePayrollHistoryNet,
    filterPayrollClosureHistory,
    renderPayrollHistoryDetail,
    renderPayrollHistoryView
};
