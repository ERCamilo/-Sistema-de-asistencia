/**
 * 📋 LoanPortfolioList — barra de filtros y lista de la pantalla principal de
 * Préstamos con el diseño de la maqueta (paleta «Neón»).
 *
 *   - Fila 1: Por empleado / Por préstamo, vistas (Con saldo, Todos,
 *     Inactivos, Saldados) y «+ Agregar nuevo».
 *   - Fila 2: buscador, Ordenar (Fecha del préstamo, Monto, Nº empleado) y
 *     «Filtros avanzados» (monto, fecha, último pago, última actualización).
 *   - Lista en una sola tarjeta: «Creado dd/mm/aaaa» y, si hubo
 *     refinanciamiento, un punto morado con su fecha; a la derecha el saldo y
 *     la última modificación («hace X h» si fue hoy). Al pasar el cursor se ve
 *     el total a devolver.
 *
 * Usa los mismos datos y acciones que la vista anterior (setLoansFilterView,
 * setLoansSortBy, setLoansSearch…); solo cambia el dibujo.
 */

import { formatCurrency } from '../../utils/Formatters.js';
import { formatTimeSince } from '../../utils/RelativeTime.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { LOAN_STATUS } from './LoansService.js';

const dmy = key => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '—');
const toTs = value => {
    if (typeof value === 'number') return value;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? 0 : ts;
};
const pl = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

/** Fecha inicial, último refinanciamiento y última modificación de un grupo de préstamos. */
export function listDates(loans = []) {
    const starts = loans.map(loan => loan.startDate).filter(Boolean).sort();
    const refis = loans.flatMap(loan => (loan.refinancings || []).filter(r => !r.voided && !r.adjustment).map(r => r.date)).filter(Boolean).sort();
    let mod = 0;
    for (const loan of loans) {
        mod = Math.max(mod, toTs(loan.updatedAt), toTs(loan.createdAt));
        for (const p of loan.payments || []) mod = Math.max(mod, toTs(p.updatedAt), toTs(p.recordedAt));
        for (const r of loan.refinancings || []) mod = Math.max(mod, toTs(r.updatedAt));
    }
    return { created: starts[0] || null, refi: refis.at(-1) || null, modified: mod || null };
}

/** «hace X h» si fue hoy; si no, la fecha. */
export function modifiedText(ts, now = Date.now()) {
    if (!ts) return '—';
    const day = d => new Date(d).toLocaleDateString('en-CA');
    if (day(ts) === day(now)) return formatTimeSince(ts, now);
    return dmy(day(ts));
}

function loansOf(item, employeesById, filterView) {
    if (item.loan) return [item.loan];
    const emp = employeesById.get(String(item.employeeId));
    const loans = (emp?.loans || []).filter(loan => loan.status !== LOAN_STATUS.WRITTEN_OFF);
    const open = loans.filter(loan => loan.status === LOAN_STATUS.ACTIVE);
    return filterView === 'settled' || !open.length ? loans : open;
}

const SORTS = [['assigned', 'Fecha del préstamo'], ['balance', 'Monto'], ['number', 'Nº empleado']];
const MORE_SORTS = [['payment', 'Último pago'], ['date', 'Última actualización']];

/**
 * @param {object} ctx  lo que ya calcula LedgerOverview: ledger, filterView, displayMode,
 *                      sortBy, sortOrder, counts {active, all, inactive, settled}, shown, total,
 *                      amountFilter, dateFilter, showFilterMenu, activeFilterCount
 */
export function PortfolioToolbar(ctx) {
    const { ledger, filterView, displayMode, sortBy, sortOrder, counts, amountFilter, dateFilter, showFilterMenu, activeFilterCount } = ctx;
    const tab = (key, label) => `<button type="button" role="tab" class="lp-vt" aria-selected="${filterView === key}" data-app-fn="setLoansFilterView" data-arg="${key}">${label}<em>${counts[key]}</em></button>`;
    const arrow = key => (sortBy === key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '');
    const sortBtn = ([key, label]) => `<button type="button" data-app-fn="setLoansSortBy" data-arg="${key}" aria-pressed="${sortBy === key}">${label}${arrow(key)}</button>`;
    const more = MORE_SORTS.find(([key]) => key === sortBy);
    return `<div class="lp-tb">
        <div class="lp-tb__row">
            <span class="lp-seg" role="group" aria-label="Ver">
                <button type="button" data-app-fn="setLoansDisplayMode" data-arg="grouped" aria-pressed="${displayMode !== 'individual'}">Por empleado</button>
                <button type="button" data-app-fn="setLoansDisplayMode" data-arg="individual" aria-pressed="${displayMode === 'individual'}">Por préstamo</button>
            </span>
            <span class="lp-tabs" role="tablist" aria-label="Vistas de préstamos">${tab('active', 'Con saldo')}${tab('all', 'Todos')}${tab('inactive-emp', 'Inactivos')}${tab('settled', 'Saldados')}</span>
            <button type="button" class="lp-add" data-app-fn="openLoansEmployeePicker">+ Agregar nuevo</button>
        </div>
        <div class="lp-tb__row">
            <span class="lp-search"><input type="search" autocomplete="off" placeholder="Buscar empleado por nombre o número…" aria-label="Buscar empleado" value="${escapeAttr(ledger.search || '')}" oninput="setLoansSearch(this.value)"></span>
            <span class="lp-sort" role="group" aria-label="Ordenar"><span>Ordenar</span>${SORTS.map(sortBtn).join('')}${more ? sortBtn(more) : ''}</span>
            <button type="button" class="lp-fbtn" data-app-fn="toggleLoansFilterMenu" aria-expanded="${showFilterMenu}">Filtros avanzados${activeFilterCount ? `<em>${activeFilterCount}</em>` : ''}</button>
        </div>
        ${showFilterMenu ? `<div class="lp-adv">
            <div><h5>Saldo</h5>
                <select aria-label="Filtrar por saldo" onchange="setLoansAmountFilter(this.value)">
                    ${[['all', 'Todos los montos'], ['under5k', 'Menor a $5,000'], ['5k-15k', '$5,000 a $15,000'], ['over15k', 'Mayor a $15,000']].map(([v, l]) => `<option value="${v}" ${amountFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select></div>
            <div><h5>Fecha del último préstamo</h5>
                <select aria-label="Filtrar por fecha" onchange="setLoansDateFilter(this.value)">
                    ${[['all', 'Cualquier fecha'], ['30d', 'Últimos 30 días'], ['90d', 'Últimos 90 días'], ['year', `Este año (${new Date().getFullYear()})`]].map(([v, l]) => `<option value="${v}" ${dateFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select></div>
            <div><h5>Ordenar por</h5><span class="lp-sort">${MORE_SORTS.map(sortBtn).join('')}</span></div>
            <div class="lp-adv__foot"><span>Mostrando ${ctx.shown} de ${ctx.total} ${displayMode === 'individual' ? 'préstamos' : 'empleados'}.</span>${activeFilterCount ? '<button type="button" data-app-fn="resetLoansFilters">Limpiar filtros</button>' : ''}</div>
        </div>` : ''}
    </div>`;
}

/** Lista en una sola tarjeta (maqueta). */
export function PortfolioList(items, { employees = [], filterView = 'active', search = '', hasFilters = false, now = Date.now() } = {}) {
    if (!items.length) {
        const why = search ? 'Ningún resultado para esa búsqueda.' : hasFilters ? 'Ningún resultado con estos filtros.' : 'No hay datos para mostrar en esta vista.';
        return `<div class="lp-emps"><div class="lp-emp is-empty">${why}</div></div>`;
    }
    const byId = new Map(employees.map(emp => [String(emp.id), emp]));
    return `<div class="lp-emps">${items.map(item => {
        const d = listDates(loansOf(item, byId, filterView));
        const dates = `Creado ${dmy(d.created)}${d.refi ? `<i class="lp-rdot" title="Refinanciado"></i>${dmy(d.refi)}` : ''}`;
        const loan = item.loan;
        const sub = loan
            ? `${dates} · ${escapeHTML(item.concept)}${item.status === LOAN_STATUS.PAID ? ' · saldado' : ''}`
            : `${dates} · ${pl(item.loanCount, 'préstamo')}`;
        const tip = `Total a devolver: ${formatCurrency(item.totalDue)}\nPagado: ${formatCurrency(item.totalPaid)}\nSaldo: ${formatCurrency(item.totalBalance)}\nÚltima modificación: ${modifiedText(d.modified, now)}`;
        return `<div class="lp-emp" role="button" tabindex="0" data-app-fn="selectLoansEmployee" data-arg="${escapeAttr(item.employeeId)}" title="${escapeAttr(tip)}">
            <span class="lp-av">${escapeHTML(item.number || '?')}</span>
            <span class="lp-who2"><b>${escapeHTML(item.name || '')}${item.active === false ? '<span class="lp-tag">inactivo</span>' : ''}</b><small>${sub}</small></span>
            <span class="lp-bal"><b>${formatCurrency(item.totalBalance)}</b><small title="Última modificación">${modifiedText(d.modified, now)}</small></span>
        </div>`;
    }).join('')}</div>`;
}

/** «Cuentas saldadas (n) · Mostrar». */
export function PortfolioSettled(list, { open = false, employees = [], now = Date.now() } = {}) {
    if (!list.total) return '';
    const byId = new Map(employees.map(emp => [String(emp.id), emp]));
    return `<div class="lp-settled">
        <button type="button" data-app-fn="toggleInactiveHistory" aria-expanded="${open}"><span>Cuentas saldadas (${list.total})</span><span>${open ? 'Ocultar' : 'Mostrar'}</span></button>
        ${open ? (list.items.length ? `<div class="lp-emps">${list.items.map(emp => {
            const d = listDates((byId.get(String(emp.employeeId))?.loans || []).filter(loan => loan.status !== LOAN_STATUS.WRITTEN_OFF));
            return `<div class="lp-emp" role="button" tabindex="0" data-app-fn="selectLoansEmployee" data-arg="${escapeAttr(emp.employeeId)}">
                <span class="lp-av">${escapeHTML(emp.number || '?')}</span>
                <span class="lp-who2"><b>${escapeHTML(emp.name || '')}</b><small>Creado ${dmy(d.created)} · ${pl(emp.loanCount, 'préstamo')} · saldado</small></span>
                <span class="lp-bal"><b class="is-paid">${formatCurrency(emp.totalPaid)}</b><small>${modifiedText(d.modified, now)}</small></span>
            </div>`;
        }).join('')}</div>` : '<div class="lp-emps"><div class="lp-emp is-empty">Ninguna cuenta saldada coincide.</div></div>') : ''}
    </div>`;
}
