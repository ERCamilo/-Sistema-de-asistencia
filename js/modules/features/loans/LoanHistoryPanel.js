/**
 * 🕰️ LoanHistoryPanel — sección desplegable «Historial del saldo».
 *
 * Cerrada: saldo total y cuánto es capital y cuánto interés.
 * Abierta: gráfico del saldo con un punto por fecha con movimientos,
 * navegador de fechas y la tarjeta Antes → Cambios → Después del día elegido.
 *
 * Se usa en Préstamos (toda la obra) y en la ficha de préstamos de cada
 * empleado. El estado de cada panel (abierto, rango, fecha) vive solo en
 * pantalla, por panel.
 */
import { saveLoanUiMemory } from './LoanUiMemory.js';
import { buildTimeline } from './LoanTimeline.js';
import { state } from '../../core/AppState.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import {
    buildFlowBuckets, computeLoanFlows, closedPeriodEndsOf, renderFlowChart, renderFlowLegend, renderFlowPanel, renderFlowBridge
} from './LoanFlowChart.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const HISTORY_TOTAL_KEY = 'history-total';
export const HISTORY_RANGES = Object.freeze([['3M', 3], ['6M', 6], ['1A', 12], ['Todo', 0]]);

const KINDS = {
    payment: { label: 'Abono', plural: 'abonos', css: 'is-payment', sign: '−' },
    loan: { label: 'Nuevo préstamo', plural: 'préstamos nuevos', css: 'is-loan', sign: '+' },
    refinancing: { label: 'Refinanciamiento', plural: 'refinanciamientos', css: 'is-refinancing', sign: '+' },
    writeoff: { label: 'Préstamo anulado', plural: 'préstamos anulados', css: 'is-off', sign: '−' },
    settled: { label: 'Cerrado como saldado', plural: 'cierres', css: 'is-off', sign: '−' },
    adjustment: { label: 'Ajuste de una nómina cerrada', plural: 'ajustes', css: 'is-off', sign: '+' }
};
const PRIORITY = ['refinancing', 'loan', 'writeoff', 'settled', 'adjustment', 'payment'];

const panels = new Map();

function panelState(scope, defaults = null) {
    if (!panels.has(scope)) panels.set(scope, { open: false, range: 'Todo', date: null, view: 'saldo', bucket: null, ...(defaults || {}) });
    return panels.get(scope);
}

/** Solo para pruebas. */
export function resetLoanHistoryPanels() { panels.clear(); }

/** ¿Está abierto el historial de ese panel? (la cuenta de préstamos lo abre desde su tarjeta). */
export function isLoanHistoryOpen(scope) { return panelState(scope).open; }

function parts(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d, wd: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}
const shortDate = iso => { const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`; };
const longDate = iso => { const p = parts(iso); return `${p.wd} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`; };
const compact = n => (Math.abs(n) >= 1000 ? `$${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${Math.round(n)}`);
const dominantKind = day => PRIORITY.find(kind => day.items.some(item => item.kind === kind)) || 'payment';

function rangeStart(range) {
    const months = HISTORY_RANGES.find(([key]) => key === range)?.[1] || 0;
    if (!months) return null;
    const cut = new Date(`${getDateKey(new Date())}T00:00:00Z`);
    cut.setUTCDate(1);
    cut.setUTCMonth(cut.getUTCMonth() - months + 1);
    return cut.toISOString().slice(0, 10);
}

function daysInRange(days, range) {
    const from = rangeStart(range);
    return from ? days.filter(day => day.date >= from) : days;
}

function chartWidth() {
    const viewport = typeof window !== 'undefined' ? Number(window.innerWidth) || 960 : 960;
    return Math.round(Math.min(960, Math.max(300, viewport - 90)));
}

function renderChart(days, selected, scope) {
    const W = chartWidth();
    const narrow = W < 560;
    const H = narrow ? 220 : 250;
    const P = { l: narrow ? 44 : 58, r: 12, t: 62, b: 26 };
    const t0 = Date.parse(days[0].date);
    const t1 = Date.parse(days.at(-1).date);
    const max = Math.max(...days.map(day => day.result), 1);
    const unit = max > 100000 ? 50000 : max > 20000 ? 10000 : max > 5000 ? 2000 : 1000;
    const top = Math.ceil(max / unit) * unit;
    const x = iso => P.l + (W - P.l - P.r) * (t1 === t0 ? 0.5 : (Date.parse(iso) - t0) / (t1 - t0));
    const y = value => P.t + (H - P.t - P.b) * (1 - value / top);
    const path = key => days.map((day, i) => (i
        ? `H${x(day.date).toFixed(1)} V${y(key(day)).toFixed(1)}`
        : `M${x(day.date).toFixed(1)} ${y(key(day)).toFixed(1)}`)).join(' ');
    const total = path(day => day.result);
    const capital = path(day => day.capital);
    const base = `L${x(days.at(-1).date).toFixed(1)} ${y(0)} L${x(days[0].date).toFixed(1)} ${y(0)} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => `
        <line x1="${P.l}" x2="${W - P.r}" y1="${y(top * f)}" y2="${y(top * f)}" class="loan-history-chart__grid${f ? ' is-dashed' : ''}"/>
        <text x="${P.l - 8}" y="${y(top * f) + 4}" text-anchor="end" class="loan-history-chart__label">${compact(top * f)}</text>`).join('');
    const seenMonths = new Set();
    const ticks = days
        .filter(day => { const key = day.date.slice(0, 7); if (seenMonths.has(key)) return false; seenMonths.add(key); return true; })
        .filter((_, i) => !narrow || i % 2 === 0)
        .map(day => { const p = parts(day.date); return `<text x="${x(day.date)}" y="${H - 6}" text-anchor="middle" class="loan-history-chart__label">${MONTHS[p.m - 1]}${narrow ? '' : ` ${p.y}`}</text>`; })
        .join('');
    const marks = days.map(day => {
        const kind = dominantKind(day);
        const isSelected = day === selected;
        return `
            <g class="loan-history-chart__mark ${KINDS[kind].css}" data-app-fn="selectLoanHistoryDate" data-arg="${escapeAttr(scope)}" data-arg2="${day.date}" role="button" tabindex="-1" aria-label="${shortDate(day.date)}">
                <circle cx="${x(day.date)}" cy="${y(day.result)}" r="11" class="loan-history-chart__hit"/>
                ${isSelected ? `<circle cx="${x(day.date)}" cy="${y(day.result)}" r="10" class="loan-history-chart__halo"/>` : ''}
                <circle cx="${x(day.date)}" cy="${y(day.result)}" r="${isSelected ? 6 : 3.6}" class="loan-history-chart__dot"/>
            </g>`;
    }).join('');
    const kind = dominantKind(selected);
    const px = x(selected.date) / W * 100;
    const py = y(selected.result) / H * 100;
    const edge = narrow ? (px >= 50 ? 'end' : 'start') : px > 75 ? 'end' : px < 25 ? 'start' : null;
    const anchor = edge === 'end' ? 'right:8px' : edge === 'start' ? 'left:8px' : `left:${px}%`;
    const extra = new Set(selected.items.map(item => item.kind)).size - 1;
    return `
        <div class="loan-history-chart">
            <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Evolución del saldo: total y capital">
                <defs><linearGradient id="loan-history-fill-${escapeAttr(scope)}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#06b6d4" stop-opacity=".40"/><stop offset="1" stop-color="#06b6d4" stop-opacity=".02"/></linearGradient></defs>
                ${grid}
                <path d="${total} ${base}" fill="url(#loan-history-fill-${escapeAttr(scope)})"/>
                <path d="${total}" class="loan-history-chart__total"/>
                <path d="${capital}" class="loan-history-chart__capital"/>
                <line x1="${x(selected.date)}" x2="${x(selected.date)}" y1="${y(selected.result)}" y2="${y(0)}" class="loan-history-chart__cursor"/>
                ${marks}
                ${ticks}
            </svg>
            <div class="loan-history-callout ${KINDS[kind].css}${edge ? ' is-edge' : ''}${py < 34 ? ' is-below' : ''}" style="${anchor};top:${py}%">
                <b>${KINDS[kind].label}${extra > 0 ? ` +${extra}` : ''}</b>${shortDate(selected.date)}<br><span>${formatCurrency(selected.result)}</span>
            </div>
        </div>`;
}

function adjustmentCreditDetail(items) {
    const total = key => items.reduce((sum, item) => sum + Number(item[key] || 0), 0);
    return [['creditCreated', 'Crédito a favor por ajuste'], ['creditReturned', 'Crédito devuelto'], ['creditUsed', 'Crédito aplicado al ajuste']]
        .filter(([key]) => total(key) > .004)
        .map(([key, label]) => `${label}: ${formatCurrency(total(key))}`).join(' · ');
}

function describeChanges(day, mode, nameById) {
    const groups = new Map();
    for (const item of day.items) {
        if (!groups.has(item.kind)) groups.set(item.kind, []);
        groups.get(item.kind).push(item);
    }
    return PRIORITY.concat().reverse().filter(kind => groups.has(kind)).map(kind => {
        const items = groups.get(kind);
        const sum = key => items.reduce((total, item) => total + item.delta[key], 0);
        const amount = sum('capital') + sum('interest');
        const excess = items.reduce((total, item) => total + (item.excess || 0), 0);
        if (mode === 'employee') {
            return items.map(item => {
                const value = item.delta.capital + item.delta.interest;
                const label = item.kind === 'payment' ? (item.source === 'payroll' ? 'Descuento de nómina' : 'Abono') : KINDS[kind].label;
                const detail = item.kind === 'payment'
                    ? `interés ${formatCurrency(-item.delta.interest)} + capital ${formatCurrency(-item.delta.capital)}`
                    : item.kind === 'loan'
                        ? `capital ${formatCurrency(item.delta.capital)} + interés ${formatCurrency(item.delta.interest)}`
                        : item.kind === 'refinancing'
                            ? (item.basis === 'pending' ? 'nuevo plan de cuotas, sin interés nuevo'
                                : `interés sobre ${item.basis === 'capital' ? 'el capital restante' : item.basis === 'principal' ? 'el capital original' : 'el saldo'}`)
                            : item.kind === 'adjustment' ? adjustmentCreditDetail([item]) : '';
                return { kind, amount: value, label, detail, excess: item.excess || 0 };
            });
        }
        const people = [...new Set(items.map(item => item.employeeId))];
        const names = people.map(id => nameById.get(String(id)) || 'Empleado');
        const payroll = items.filter(item => item.source === 'payroll').length;
        const label = [
            `${items.length} ${items.length === 1 ? KINDS[kind].label.toLowerCase() : KINDS[kind].plural}`,
            kind === 'payment' && payroll ? `${payroll} por nómina` : '',
            names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`
        ].filter(Boolean).join(' · ');
        const detail = kind === 'payment'
            ? `interés ${formatCurrency(-sum('interest'))} + capital ${formatCurrency(-sum('capital'))}`
            : kind === 'loan' ? `capital ${formatCurrency(sum('capital'))} + interés ${formatCurrency(sum('interest'))}`
                : kind === 'adjustment' ? adjustmentCreditDetail(items) : '';
        return [{ kind, amount, label, detail, excess }];
    }).flat();
}

/**
 * @param {object} args
 * @param {string} args.scope     'general' o el id del empleado
 * @param {'general'|'employee'} args.mode
 * @param {Array} args.employees  empleados (ya filtrados por obra) cuyos préstamos entran
 * @param {object|null} args.timeline línea financiera calculada para esos mismos empleados
 */
export function renderLoanHistoryPanel({ scope, mode = 'general', employees = [], embedded = false, defaults = null, variant = null, timeline: preparedTimeline = null } = {}) {
    const timeline = preparedTimeline || buildTimeline(employees.flatMap(emp => (emp.loans || []).map(loan => ({ employeeId: emp.id, loan }))), { financialOnly: true });
    const all = timeline.days;
    const warning = timeline.undatedClosures.length ? `<p class="lf-note" role="note">Historial incompleto: ${timeline.undatedClosures.length} cierre(s) con saldo sin fecha. Estos préstamos se excluyen de la evolución; revisa sus cierres.</p>` : '';
    if (all.length === 0) return warning;
    // defaults: cómo se abre la primera vez (la pantalla principal lo abre en «Por periodo»).
    const panel = panelState(scope, defaults);
    const { totals } = timeline;
    const capitalShare = totals.balance > 0 ? totals.capital / totals.balance * 100 : 0;
    const scopeArg = escapeAttr(scope);
    // variant 'portfolio': pantalla principal de Préstamos (maqueta): «Historial del saldo»,
    // barra capital/interés y vistas por mes/periodo sin botones de rango.
    const portfolio = variant === 'portfolio';
    const summary = portfolio ? `
        <button type="button" class="loan-history__summary lp-hist-s" data-app-fn="toggleLoanHistory" data-arg="${scopeArg}" aria-expanded="${panel.open}">
            <span class="lp-hist-s__t"><small>Historial del saldo</small><strong>${formatCurrency(totals.balance)}</strong></span>
            <span class="lp-hist-s__go">${panel.open ? 'Ocultar' : 'Ver historial'}</span>
            <span class="lp-hist-s__legend">
                <span class="lp-hist-s__bar"><i class="is-capital" style="width:${capitalShare}%"></i><i class="is-interest" style="width:${100 - capitalShare}%"></i></span>
                <span class="lp-hist-s__lg"><span><i class="is-capital"></i>Capital <b>${formatCurrency(totals.capital)}</b></span><span><i class="is-interest"></i>Interés <b>${formatCurrency(totals.interest)}</b></span></span>
            </span>
        </button>` : `
        <button type="button" class="loan-history__summary" data-app-fn="toggleLoanHistory" data-arg="${scopeArg}" aria-expanded="${panel.open}">
            <span class="loan-history__heading">
                <small><span aria-hidden="true">💵</span> ${mode === 'general' ? 'Saldo total de la obra' : 'Saldo del empleado'}</small>
                <strong>${formatCurrency(totals.balance)}</strong>
            </span>
            <span class="loan-history__toggle"><span class="loan-history__chevron" aria-hidden="true">▶</span> ${panel.open ? 'Ocultar historial' : `Ver historial (${all.length})`}</span>
            <span class="loan-history__split">
                <span class="loan-history__bar"><span class="is-capital" style="width:${capitalShare}%"></span><span class="is-interest" style="width:${100 - capitalShare}%"></span></span>
                <span class="loan-history__legend">
                    <span><i class="is-capital"></i>Capital <b>${formatCurrency(totals.capital)}</b> <em>${capitalShare.toFixed(0)}%</em></span>
                    <span><i class="is-interest"></i>Interés <b>${formatCurrency(totals.interest)}</b> <em>${(100 - capitalShare).toFixed(0)}%</em></span>
                </span>
            </span>
        </button>`;
    // embedded: dentro de la tarjeta principal de la cuenta (que ya muestra el saldo); solo el cuerpo abierto.
    if (!panel.open) return embedded ? '' : `<section class="loan-history${portfolio ? ' is-portfolio-hist' : ''}" data-loan-history="${scopeArg}">${summary}</section>`;

    const viewTabs = `
                <div class="loan-history__views">
                    <div class="lf-tabs" role="tablist" aria-label="Vista del historial">
                        ${[['saldo', 'Saldo'], ['month', 'Por mes'], ['period', 'Por periodo']].map(([key, label]) => `<button type="button" role="tab" aria-selected="${panel.view === key}" data-app-fn="setLoanHistoryView" data-arg="${scopeArg}" data-arg2="${key}">${label}</button>`).join('')}
                    </div>
                </div>`;
    if (panel.view !== 'saldo') {
        return `
        <section class="loan-history is-open${embedded ? ' is-embedded' : ''}${portfolio ? ' is-portfolio-hist' : ''}" data-loan-history="${scopeArg}">
            ${embedded ? '' : summary}
            <div class="loan-history__body">
                ${warning}${viewTabs}
                ${`<div class="loan-history__ranges" role="group" aria-label="Periodo">
                    ${HISTORY_RANGES.map(([key]) => `<button type="button" data-app-fn="setLoanHistoryRange" data-arg="${scopeArg}" data-arg2="${key}" aria-pressed="${panel.range === key}">${key}</button>`).join('')}
                </div>`}
                ${renderFlowSection(panel, scope, employees, all, portfolio)}
            </div>
        </section>`;
    }

    const days = daysInRange(all, panel.range);
    if (!days.length) return `<section class="loan-history is-open" data-loan-history="${scopeArg}">${embedded ? '' : summary}<div class="loan-history__body">${warning}${viewTabs}<p class="lf-note">Sin movimientos en este rango. <button type="button" data-app-fn="setLoanHistoryRange" data-arg="${scopeArg}" data-arg2="Todo">Ver todo el historial</button></p></div></section>`;
    let selected = days.find(day => day.date === panel.date) || days.at(-1);
    if (panel.step) {
        const index = Math.min(days.length - 1, Math.max(0, days.indexOf(selected) + panel.step));
        selected = days[index];
        panel.step = 0;
    }
    panel.date = selected.date;
    const position = days.indexOf(selected);
    const previousDay = all[all.indexOf(selected) - 1] || null;
    const nameById = new Map(employees.map(emp => [String(emp.id), emp.name || '']));
    const changes = describeChanges(selected, mode, nameById);
    const excess = changes.reduce((total, change) => total + (change.excess || 0), 0);
    const reach = chartWidth() > 560 ? 2 : 1;
    const neighbors = days.slice(Math.max(0, position - reach), position + reach + 1);
    const capitalAfter = selected.result > 0 ? selected.capital / selected.result * 100 : 0;

    return `
        <section class="loan-history is-open${embedded ? ' is-embedded' : ''}${portfolio ? ' is-portfolio-hist' : ''}" data-loan-history="${scopeArg}">
            ${embedded ? '' : summary}
            <div class="loan-history__body">
                ${warning}${viewTabs}
                <div class="loan-history__ranges" role="group" aria-label="Periodo">
                    ${HISTORY_RANGES.map(([key]) => `<button type="button" data-app-fn="setLoanHistoryRange" data-arg="${scopeArg}" data-arg2="${key}" aria-pressed="${panel.range === key}">${key}</button>`).join('')}
                </div>
                <div class="loan-history__chart-card">
                    <div class="loan-history__chart-head">
                        <div><h4><span aria-hidden="true">📈</span> Evolución del saldo</h4><small>Línea: saldo total · punteada: capital · la diferencia es interés</small></div>
                        <div class="loan-history__kinds">
                            <span><i class="is-payment"></i>Abono</span><span><i class="is-refinancing"></i>Refinanciamiento</span>
                            <span><i class="is-loan"></i>Nuevo préstamo</span><span><i class="is-off"></i>Anulado</span>
                        </div>
                    </div>
                    ${renderChart(days, selected, scope)}
                </div>
                <div class="loan-history__nav">
                    <button type="button" data-app-fn="stepLoanHistory" data-arg="${scopeArg}" data-arg2="-1" ${position <= 0 ? 'disabled' : ''} aria-label="Fecha anterior"><span aria-hidden="true">◀</span><span class="loan-history__nav-label">Fecha anterior</span></button>
                    <label class="loan-history__picker"><span aria-hidden="true">📅</span>
                        <select aria-label="Elegir fecha" onchange="selectLoanHistoryDate('${scopeArg}', this.value)">
                            ${[...days].reverse().map(day => `<option value="${day.date}" ${day === selected ? 'selected' : ''}>${shortDate(day.date)}</option>`).join('')}
                        </select>
                    </label>
                    <button type="button" data-app-fn="stepLoanHistory" data-arg="${scopeArg}" data-arg2="1" ${position >= days.length - 1 ? 'disabled' : ''} aria-label="Próxima fecha"><span class="loan-history__nav-label">Próxima fecha</span><span aria-hidden="true">▶</span></button>
                </div>
                <div class="loan-history__scrub">
                    ${neighbors.map(day => {
                        const offset = days.indexOf(day) - position;
                        return `<button type="button" class="${offset === 0 ? 'is-current' : ''}" style="left:${50 + offset * (reach === 2 ? 22 : 36)}%" data-app-fn="selectLoanHistoryDate" data-arg="${scopeArg}" data-arg2="${day.date}"><i></i><span>${shortDate(day.date)}</span></button>`;
                    }).join('')}
                </div>
                <section class="loan-history__snapshot" tabindex="0" onkeydown="loanHistoryKey(event, '${scopeArg}')" aria-label="Movimientos del ${longDate(selected.date)}">
                    <div class="loan-history__snapshot-head"><h4><span aria-hidden="true">🗓️</span> Movimientos del día</h4><small>${longDate(selected.date)} · ${position + 1} de ${days.length}</small></div>
                    <div class="loan-history__flow">
                        <div class="loan-history__col"><h5>Antes</h5><small>${previousDay ? shortDate(previousDay.date) : 'Sin saldo previo'}</small><div class="loan-history__amount">${formatCurrency(selected.previous)}</div></div>
                        <div class="loan-history__arrow" aria-hidden="true">›</div>
                        <div class="loan-history__changes"><h5>Cambios del ${shortDate(selected.date)}</h5>
                            ${changes.map(change => `
                                <div class="loan-history__change ${KINDS[change.kind].css}">
                                    <span class="loan-history__icon" aria-hidden="true">${change.amount < 0 ? '−' : '+'}</span>
                                    <div><strong>${change.amount < 0 ? '−' : '+'}${formatCurrency(Math.abs(change.amount))}</strong><span>${escapeHTML(change.label)}</span>${change.detail ? `<small>${change.detail}</small>` : ''}</div>
                                </div>`).join('')}
                            ${excess > 0.01 ? `<div class="loan-history__excess">Crédito generado: ${formatCurrency(excess)} no se aplicó al saldo ese día; puede cubrir cargos posteriores.</div>` : ''}
                        </div>
                        <div class="loan-history__arrow" aria-hidden="true">›</div>
                        <div class="loan-history__col is-after"><h5>Después</h5><small>${shortDate(selected.date)}</small><div class="loan-history__amount">${formatCurrency(selected.result)}</div>
                            <div class="loan-history__after-split">
                                <span class="loan-history__bar"><span class="is-capital" style="width:${capitalAfter}%"></span><span class="is-interest" style="width:${100 - capitalAfter}%"></span></span>
                                <span><em><i class="is-capital"></i>Capital</em><b>${formatCurrency(selected.capital)}</b></span>
                                <span><em><i class="is-interest"></i>Interés</em><b>${formatCurrency(selected.interest)}</b></span>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </section>`;
}

/** «Por mes» / «Por periodo»: barras de lo que se debía frente a lo cobrado y lo que faltó. */
function renderFlowSection(panel, scope, employees, allDays, portfolio = false) {
    const kind = panel.view === 'period' ? 'period' : 'month';
    const today = getDateKey(new Date());
    const payPeriod = getActivePayrollSettings(state).payPeriod;
    if (kind === 'period' && !(Number(payPeriod?.periodLength) > 0)) {
        return '<p class="lf-note">Configura el periodo de Nómina para ver la vista por periodo.</p>';
    }
    const from = rangeStart(panel.range) || allDays[0].date;
    const periodBuckets = buildFlowBuckets(kind, { from, to: today, payPeriod });
    const totalBucket = { key: HISTORY_TOTAL_KEY, start: allDays[0].date, end: allDays.at(-1).date,
        label: 'Todo', long: 'Acumulado total · historial completo', total: true };
    const totalSelected = kind === 'period' && panel.bucket === HISTORY_TOTAL_KEY;
    const buckets = totalSelected ? [totalBucket] : periodBuckets;
    if (!buckets.length) return '';
    const flows = computeLoanFlows(employees.flatMap(emp => emp.loans || []), buckets);
    // Sin elección: el último mes o nómina con movimientos (el en curso puede estar vacío).
    const active = o => o.nNew || o.nRefi || o.payOld + o.paySame + o.excess + o.gift + o.adjustUp + o.adjustDown > 0.004;
    const selected = buckets.some(b => b.key === panel.bucket) ? panel.bucket
        : ([...buckets].reverse().find(b => active(flows.get(b.key))) || buckets.at(-1)).key;
    panel.bucket = selected;
    const bucket = buckets.find(b => b.key === selected);
    const index = buckets.indexOf(bucket);
    const options = kind === 'period' ? [...periodBuckets, totalBucket] : periodBuckets;
    const navigation = `<div class="loan-history__nav${totalSelected ? ' is-total' : ''}">
        ${totalSelected ? '' : `<button type="button" data-app-fn="selectLoanHistoryBucket" data-arg="${escapeAttr(scope)}" data-arg2="${escapeAttr(buckets[index-1]?.key || '')}" ${index===0?'disabled':''}>Anterior</button>`}
        <select aria-label="Elegir mes, periodo o acumulado" onchange="selectLoanHistoryBucket('${escapeAttr(scope)}',this.value)">${options.map(b=>`<option value="${escapeAttr(b.key)}" ${b.key===selected?'selected':''}>${escapeHTML(b.long)}</option>`).join('')}</select>
        ${totalSelected ? '' : `<button type="button" data-app-fn="selectLoanHistoryBucket" data-arg="${escapeAttr(scope)}" data-arg2="${escapeAttr(buckets[index+1]?.key || '')}" ${index===buckets.length-1?'disabled':''}>Siguiente</button>`}
    </div>`;
    const what = kind === 'period' ? 'periodo' : 'mes';
    const chart = `${renderFlowLegend()}
        <div class="lf-plot">${renderFlowChart({ scope, buckets, flows, selected, today, closedEnds: closedPeriodEndsOf(employees) })}</div>`;
    // Al tocar una barra: el puente de ese periodo y, plegada, la tabla con todo el desglose.
    const detail = `${renderFlowBridge({ bucket, flow: flows.get(selected), today })}
        <details class="lf-more"><summary>Ver el desglose en tabla</summary>${renderFlowPanel({ kind, bucket, flow: flows.get(selected), buckets, today })}</details>`;
    const note = `Rango ${panel.range === 'Todo' ? 'histórico completo' : panel.range + ' hasta hoy'}. Valores del gráfico aproximados; detalle con centavos. La barra izquierda es todo lo que se debía durante el ${what} (lo que venía más lo nuevo), no el saldo; la línea punteada es lo que quedaban debiendo al cerrar cada ${what}. ${kind === 'period' ? 'Periodos de pago según el calendario de Nómina, calculados también hacia atrás.' : 'El interés es el de los préstamos nuevos del mes más el de los refinanciamientos de ese mes.'} Toca una barra para ver su puente.`;
    const caption = `${totalSelected ? 'Cargos y pagos de todo el historial.' : `Rango ${panel.range === 'Todo' ? 'histórico completo' : panel.range + ' hasta hoy'}.`} Importes del gráfico redondeados.`;
    const help = `<details class="lf-more"><summary>Cómo leer el gráfico</summary><p class="lf-foot">${totalSelected ? 'Incluye todos los movimientos fechados, desde el primero hasta el último. El saldo final resulta de los cargos menos los pagos y los ajustes.' : note}</p></details>`;
    if (portfolio) return `<p class="lf-foot">${caption}</p>${navigation}${detail}${totalSelected ? '' : `<details class="lf-more"><summary>Comparar ${kind === 'month' ? 'todos los meses' : 'todos los periodos'}</summary>${chart}</details>`}${help}`;
    return `
        <div class="loan-history__chart-card lf-card">
            <div class="loan-history__chart-head"><div><h4><span aria-hidden="true">📊</span> ${totalSelected ? 'Acumulado total' : kind === 'period' ? 'Por periodo de nómina' : 'Por mes'}</h4><small>${caption}</small></div></div>
            ${navigation}${chart}
        </div>
        ${detail}${help}`;
}

export function setLoanHistoryView(scope, view) {
    const panel = panelState(String(scope));
    panel.view = ['saldo', 'month', 'period'].includes(view) ? view : 'saldo';
    panel.bucket = null;
    if (String(scope) === 'general') saveLoanUiMemory({ historyView: panel.view });
    rerender();
}

export function selectLoanHistoryBucket(scope, key) {
    const panel = panelState(String(scope));
    panel.bucket = String(key);
    if (panel.bucket === HISTORY_TOTAL_KEY) panel.range = 'Todo';
    rerender();
}

function rerender() {
    try { (typeof window !== 'undefined' && window.render)?.(); } catch (_) {}
}

export function toggleLoanHistory(scope) {
    const panel = panelState(String(scope));
    panel.open = !panel.open;
    // Pantalla principal: se recuerda si el usuario lo dejó abierto (solo este dispositivo).
    if (String(scope) === 'general') saveLoanUiMemory({ historyOpen: panel.open });
    rerender();
}

export function setLoanHistoryRange(scope, range) {
    if (!HISTORY_RANGES.some(([key]) => key === range)) return;
    const panel = panelState(String(scope));
    panel.range = range;
    if (panel.bucket === HISTORY_TOTAL_KEY && range !== 'Todo') panel.bucket = null;
    rerender();
}

export function selectLoanHistoryDate(scope, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return;
    panelState(String(scope)).date = String(date);
    rerender();
}

/** Paso ±1 dentro de las fechas visibles (el panel resuelve la fecha al pintar). */
export function stepLoanHistory(scope, delta) {
    const panel = panelState(String(scope));
    panel.step = (panel.step || 0) + (Number(delta) > 0 ? 1 : -1);
    rerender();
}

export function loanHistoryKey(event, scope) {
    if (event?.key !== 'ArrowLeft' && event?.key !== 'ArrowRight') return;
    event.preventDefault?.();
    stepLoanHistory(scope, event.key === 'ArrowRight' ? 1 : -1);
    if (typeof document !== 'undefined') {
        setTimeout(() => document.querySelector(`[data-loan-history="${String(scope).replace(/"/g, '')}"] .loan-history__snapshot`)?.focus?.(), 60);
    }
}

export function registerLoanHistoryGlobals() {
    if (typeof window === 'undefined') return;
    window.toggleLoanHistory = toggleLoanHistory;
    window.setLoanHistoryView = setLoanHistoryView;
    window.selectLoanHistoryBucket = selectLoanHistoryBucket;
    window.setLoanHistoryRange = setLoanHistoryRange;
    window.selectLoanHistoryDate = selectLoanHistoryDate;
    window.stepLoanHistory = stepLoanHistory;
    window.loanHistoryKey = loanHistoryKey;
}
