/**
 * 📊 LoanFlowChart — «Por mes» y «Por periodo» del historial de préstamos.
 *
 * Para cada mes o nómina compara lo que se debía con lo que pasó:
 *   izquierda  = venía de antes (de eso, capital refinanciado) + capital nuevo
 *                + interés al prestar + interés por refinanciar (+ ajustes)
 *   derecha    = cobrado (interés / capital) + pagado de más (rayado: posible
 *                error) + lo que faltó por cobrar de lo que venía
 *
 * Reglas (verificadas con la maqueta de la pantalla de Préstamos):
 *   - Todo sale de reproducir cada préstamo (LoanTimeline: interés primero).
 *   - Los préstamos anulados son errores de registro: no entran.
 *   - El capital refinanciado se cuenta una vez por préstamo y periodo; si el
 *     préstamo es del mismo periodo ya está en «capital nuevo».
 *   - Faltó = venía de antes + interés refinanciado de préstamos viejos
 *             − perdonado de préstamos viejos − cobrado a préstamos viejos.
 *   - Cada periodo cuadra: venía + nuevo + interés + refinanciado ± ajustes
 *     − cobrado − perdonado = quedó.
 * Funciones puras salvo renderFlowChart/renderFlowPanel, que solo arman HTML.
 */

import { LOAN_STATUS, round2 } from './LoansService.js';
import { replayLoan } from './LoanTimeline.js';
import { buildPayPeriods } from './LoanPayPeriods.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAY = 86_400_000;
const toTime = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const dmShort = key => `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`;

/** Meses o nóminas desde `from` hasta `to` (incluidos). */
export function buildFlowBuckets(kind, { from, to, payPeriod = null } = {}) {
    if (!from || !to || from > to) return [];
    if (kind === 'period') {
        const length = Number(payPeriod?.periodLength);
        if (!Number.isInteger(length) || length < 1) return [];
        const before = Math.ceil((toTime(to) - toTime(from)) / (length * DAY)) + 2;
        return buildPayPeriods(payPeriod, to, { before, after: 0 })
            .filter(p => p.end >= from)
            .map(p => ({ key: `${p.start}|${p.end}`, start: p.start, end: p.end, payDate: p.payDate, label: `${dmShort(p.start)}–${dmShort(p.end)}`, long: `Periodo ${dmShort(p.start)} – ${dmShort(p.end)}` }));
    }
    const out = [];
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    const endY = Number(to.slice(0, 4));
    const endM = Number(to.slice(5, 7));
    while (y < endY || (y === endY && m <= endM)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        out.push({ key, start: `${key}-01`, end: lastDayOfMonth(y, m), label: MONTHS[m - 1], long: `${MONTHS_LONG[m - 1]} ${y}` });
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return out;
}

const empty = () => ({
    open: 0, newCap: 0, newInt: 0, nNew: 0, refiInt: 0, refiIntOld: 0, refiCap: 0, refiCapOld: 0, nRefi: 0, nRefiOld: 0,
    refiFrom: {}, payOld: 0, paySame: 0, payInt: 0, payCap: 0, payFrom: {}, excess: 0, gift: 0, giftOld: 0,
    adjustUp: 0, adjustDown: 0, missing: 0, end: 0
});

/**
 * Calcula cada mes o nómina para un conjunto de préstamos.
 * @param {Array<object>} loans
 * @param {Array<{key,start,end}>} buckets
 * @returns {Map<string, object>} por clave de bucket
 */
export function computeLoanFlows(loans = [], buckets = []) {
    const out = new Map(buckets.map(b => [b.key, empty()]));
    if (!buckets.length) return out;
    const bucketOf = date => buckets.find(b => b.start <= date && date <= b.end) || null;
    const steps = [];
    for (const loan of loans) {
        if (!loan || loan.status === LOAN_STATUS.WRITTEN_OFF) continue;
        const replay = replayLoan(loan);
        const born = replay.steps.find(s => s.kind === 'loan')?.date || loan.startDate || '';
        for (const step of replay.steps) steps.push({ ...step, born, bornKey: bucketOf(born)?.key || null });
    }
    for (const bucket of buckets) {
        const o = out.get(bucket.key);
        const old = step => step.born < bucket.start;
        let open = 0;
        let end = 0;
        const refinanced = new Set();
        for (const step of steps) {
            const value = step.delta.capital + step.delta.interest;
            if (step.date < bucket.start) open += value;
            if (step.date <= bucket.end) end += value;
            if (step.date < bucket.start || step.date > bucket.end) continue;
            if (step.kind === 'loan') {
                o.newCap += step.delta.capital; o.newInt += step.delta.interest; o.nNew++;
            } else if (step.kind === 'refinancing') {
                o.refiInt += step.delta.interest;
                if (old(step)) o.refiIntOld += step.delta.interest;
                if (!refinanced.has(step.loanId)) {
                    refinanced.add(step.loanId);
                    o.refiCap += step.capitalAfter; o.nRefi++;
                    if (old(step)) {
                        o.refiCapOld += step.capitalAfter; o.nRefiOld++;
                        const from = step.bornKey || 'antes';
                        o.refiFrom[from] = (o.refiFrom[from] || 0) + step.capitalAfter;
                    }
                }
            } else if (step.kind === 'payment') {
                const paid = -value;
                o.payInt += -step.delta.interest; o.payCap += -step.delta.capital;
                if (old(step)) o.payOld += paid; else o.paySame += paid;
                const from = step.bornKey || 'antes';
                o.payFrom[from] = (o.payFrom[from] || 0) + paid;
                o.excess += step.excess || 0;
            } else if (step.kind === 'adjustment') {
                if (value >= 0) o.adjustUp += value; else o.adjustDown += -value;
            } else if (step.kind === 'settled' || step.kind === 'writeoff') {
                o.gift += -value;
                if (old(step)) o.giftOld += -value;
            }
        }
        o.open = open;
        o.end = end;
        o.missing = Math.max(0, open + o.refiIntOld - o.giftOld - o.payOld);
        for (const key of Object.keys(o)) {
            if (typeof o[key] === 'number') o[key] = round2(o[key]);
            else if (o[key] && typeof o[key] === 'object') for (const k of Object.keys(o[key])) o[key][k] = round2(o[key][k]);
        }
    }
    return out;
}

/** Nóminas (fin de periodo) con abonos ligados a un cierre vigente. */
export function closedPeriodEndsOf(employees = []) {
    const ends = new Set();
    for (const emp of employees) for (const loan of emp.loans || []) for (const p of loan.payments || []) {
        if (!p.voided && p.payrollClosureId && p.payrollPeriodEnd) ends.add(p.payrollPeriodEnd);
    }
    return ends;
}

// ─── Dibujo ──────────────────────────────────────────────────────────────────

const M0 = v => '$' + Math.round(Number(v || 0)).toLocaleString('en-US');
// Lo que venía de antes va en azul oscuro (su parte refinanciada, más oscura); lo que
// faltó por cobrar, en el mismo azul tenue porque es lo que pasa al periodo siguiente.
const COLOR = Object.freeze({
    carry: '#1f5f8a', carryRefi: '#0f3550', missing: 'rgba(31,95,138,.4)',
    cap: '#1fb6ff', int: '#ffc61a', refi: '#a855f7', pay: '#10d98a', payInt: '#0a8f5b', balance: '#ebeef0'
});
const left = o => o.open + o.newCap + o.newInt + o.refiInt + o.adjustUp;
const right = o => o.payInt + o.payCap + o.excess + o.adjustDown;
const niceStep = max => { const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 2.5, 5, 10].map(f => f * p).find(s => s >= raw) || p * 10; };

/**
 * Barras dobles por mes o nómina: izquierda lo que se debía (lo que venía más
 * lo nuevo, con el interés separado), derecha lo cobrado; una línea punteada
 * marca el saldo al cerrar cada uno.
 */
export function renderFlowChart({ scope, buckets, flows, selected, today, closedEnds = new Set() }) {
    const W = 680, H = 250, Lp = 42, Rp = 8, T = 14, B = 30;
    const max0 = Math.max(1, ...buckets.map(b => Math.max(left(flows.get(b.key)), right(flows.get(b.key)))));
    const step = niceStep(max0);
    const max = Math.ceil(max0 / step) * step;
    const y = v => T + (H - T - B) * (1 - v / max);
    const cw = (W - Lp - Rp) / Math.max(1, buckets.length);
    const bw = Math.max(3, Math.min(22, cw * 0.3));
    const scopeArg = escapeAttr(scope);
    let g = '<defs><pattern id="lf-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(16,217,138,.16)"></rect><rect width="2.6" height="6" fill="#10d98a"></rect></pattern>'
        + '<pattern id="lf-stripe-adj" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(251,146,60,.16)"></rect><rect width="2.6" height="6" fill="#fb923c"></rect></pattern></defs>';
    for (let v = 0; v <= max; v += step) {
        g += `<line x1="${Lp}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"></line><text x="${Lp - 6}" y="${y(v) + 4}" fill="#7c858d" font-size="10" text-anchor="end">${v >= 1000 ? `${round2(v / 1000)}k` : v}</text>`;
    }
    const labelEvery = Math.ceil(buckets.length / 12);
    const points = [];
    buckets.forEach((b, i) => {
        const o = flows.get(b.key);
        const cx = Lp + cw * i + cw / 2;
        const isSel = b.key === selected;
        const current = b.start <= today && today <= b.end;
        const closed = b.payDate && closedEnds.has(b.end);
        if (isSel) g += `<rect class="lf-sel" x="${Lp + cw * i + 2}" y="${T - 8}" width="${cw - 4}" height="${H - T - B + 8}" rx="6"></rect>`;
        const stack = (x, list) => {
            let acc = 0;
            for (const [v, fill, title] of list) {
                if (!(v > 0.004)) continue;
                g += `<rect x="${x.toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y(acc) - y(acc + v)).toFixed(1)}" fill="${fill}"><title>${escapeHTML(b.label)} · ${escapeHTML(title)} ${M0(v)}</title></rect>`;
                acc += v;
            }
        };
        // Una sola vista (la «1» de la maqueta): el interés siempre separado.
        stack(cx - bw - 2, [[o.open, COLOR.carry, 'venía de antes'], [o.newCap, COLOR.cap, 'capital prestado'], [o.newInt, COLOR.int, 'interés al prestar'], [o.refiInt + o.adjustUp, COLOR.refi, 'interés por refinanciar']]);
        stack(cx + 2, [[o.payInt, COLOR.payInt, 'cobrado: interés'], [o.payCap, COLOR.pay, 'cobrado: capital'], [o.excess, 'url(#lf-stripe)', 'pagado de más (posible error)'], [o.adjustDown, 'url(#lf-stripe-adj)', 'ajuste de nómina cerrada']]);
        points.push([cx, y(Math.max(0, o.end)), o.end, b]);
        if (i % labelEvery === 0 || isSel) {
            g += `<text x="${cx}" y="${H - 15}" fill="${isSel ? '#ebeef0' : '#a2abb3'}" font-size="${buckets.length > 8 ? 9 : 10.5}" font-weight="${isSel ? 700 : 400}" text-anchor="middle">${escapeHTML(b.label)}</text>`;
        }
        if (closed || current) g += `<text x="${cx}" y="${H - 4}" fill="#7c858d" font-size="8.5" text-anchor="middle">${current ? 'en curso' : 'cerrado'}</text>`;
        g += `<rect class="lf-hit" x="${Lp + cw * i}" y="0" width="${cw}" height="${H}" fill="transparent" data-app-fn="selectLoanHistoryBucket" data-arg="${scopeArg}" data-arg2="${escapeAttr(b.key)}" role="button" aria-label="${escapeAttr(b.long)}"><title>${escapeHTML(b.long)}: toca para ver el detalle</title></rect>`;
    });
    // Saldo al cerrar cada periodo (lo que deben): la altura de las barras es todo lo que
    // se debía durante el periodo, no el saldo.
    if (points.length) {
        g += `<polyline points="${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${COLOR.balance}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".85" pointer-events="none"></polyline>`;
        for (const [px, py, v, b] of points) g += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${COLOR.balance}" pointer-events="none"><title>${escapeHTML(b.label)} · saldo al cerrar ${M0(v)}</title></circle>`;
    }
    return `<svg class="lf-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lo que se debía, lo cobrado y el saldo al cerrar cada periodo">${g}</svg>`;
}

export function renderFlowLegend() {
    const item = (bg, text) => `<span><i style="background:${bg}"></i>${escapeHTML(text)}</span>`;
    const striped = 'repeating-linear-gradient(45deg,#10d98a 0 2px,rgba(16,217,138,.2) 2px 5px)';
    const line = `<span class="lf-legend__line"><i style="background:none;border-top:2px dashed ${COLOR.balance};height:0;border-radius:0"></i>Saldo al cerrar (lo que deben)</span>`;
    return `<div class="lf-legend">${[item(COLOR.carry, 'Venía de antes'), item(COLOR.cap, 'Capital prestado'), item(COLOR.int, 'Interés al prestar'), item(COLOR.refi, 'Interés por refinanciar'), item(COLOR.payInt, 'Cobrado: interés'), item(COLOR.pay, 'Cobrado: capital'), item(striped, 'Pagado de más (posible error)'), line].join('')}</div>`;
}

/**
 * Puente de un mes o nómina: de lo que venía al saldo final, paso por paso
 * (+ capital, + interés, + refinanciamientos, − cobrado a interés y a capital).
 */
export function renderFlowBridge({ bucket, flow: o, today }) {
    if (!bucket || !o) return '';
    const current = bucket.start <= today && today <= bucket.end;
    const steps = [
        ['Venía de antes', o.open, COLOR.carry, true],
        ['+ Capital prestado', o.newCap, COLOR.cap],
        ['+ Interés al prestar', o.newInt, COLOR.int],
        ['+ Por refinanciar', o.refiInt + o.adjustUp, COLOR.refi],
        ['− Cobrado: interés', -o.payInt, COLOR.payInt],
        ['− Cobrado: capital', -o.payCap, COLOR.pay]
    ];
    if (o.gift + o.adjustDown > 0.004) steps.push(['− Perdonado o ajustes', -(o.gift + o.adjustDown), '#6f7a84']);
    let acc = 0;
    let peak = 0;
    const bars = steps.map(([label, v, color, base]) => {
        const from = base ? 0 : acc;
        acc = round2(base ? v : acc + v);
        peak = Math.max(peak, from, acc);
        return { label, v, color, from, to: acc };
    });
    bars.push({ label: current ? 'Saldo hoy' : 'Quedó al cerrar', v: o.end, color: COLOR.balance, from: 0, to: o.end, end: true });
    const W = 680, H = 230, Lp = 42, Rp = 8, T = 18, B = 40;
    const step = niceStep(peak || 1);
    const max = Math.ceil((peak || 1) / step) * step;
    const y = v => T + (H - T - B) * (1 - v / max);
    const cw = (W - Lp - Rp) / bars.length;
    const bw = Math.min(54, cw * 0.62);
    let g = '';
    for (let v = 0; v <= max; v += step) g += `<line x1="${Lp}" x2="${W - Rp}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"></line><text x="${Lp - 6}" y="${y(v) + 4}" fill="#7c858d" font-size="10" text-anchor="end">${v >= 1000 ? `${round2(v / 1000)}k` : v}</text>`;
    bars.forEach((b, i) => {
        const cx = Lp + cw * i + cw / 2;
        const lo = Math.min(b.from, b.to);
        const hi = Math.max(b.from, b.to);
        g += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y(lo) - y(hi)).toFixed(1)}" fill="${b.end ? 'none' : b.color}" stroke="${b.end ? COLOR.balance : 'none'}" stroke-width="1.5" rx="2"><title>${escapeHTML(b.label)} ${M0(Math.abs(b.v))}</title></rect>`;
        if (i < bars.length - 1) g += `<line x1="${(cx + bw / 2).toFixed(1)}" x2="${(cx + cw - bw / 2).toFixed(1)}" y1="${y(b.to).toFixed(1)}" y2="${y(b.to).toFixed(1)}" stroke="#7c858d" stroke-dasharray="2 2"></line>`;
        g += `<text x="${cx}" y="${(y(hi) - 5).toFixed(1)}" fill="#ebeef0" font-size="10" font-weight="600" text-anchor="middle">${b.v < 0 ? '−' : ''}${M0(Math.abs(b.v))}</text>`;
        const words = b.label.split(' ');
        const mid = Math.ceil(words.length / 2);
        g += `<text x="${cx}" y="${H - 24}" fill="#a2abb3" font-size="9.5" text-anchor="middle">${escapeHTML(words.slice(0, mid).join(' '))}</text><text x="${cx}" y="${H - 12}" fill="#a2abb3" font-size="9.5" text-anchor="middle">${escapeHTML(words.slice(mid).join(' '))}</text>`;
    });
    const paid = round2(o.payInt + o.payCap);
    return `<div class="lf-bridge">
        <div class="lf-bridge__t"><b>${escapeHTML(bucket.long)}${current ? ' · en curso' : ''}</b><small>datos al ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}</small></div>
        <div class="lf-plot"><svg class="lf-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cómo se llegó al saldo en ${escapeAttr(bucket.long)}">${g}</svg></div>
        <p class="lf-bridge__s">Empezó en <b>${M0(o.open)}</b>, entraron <b>${M0(o.newCap + o.newInt + o.refiInt + o.adjustUp)}</b>, se cobraron <b>${M0(paid)}</b>${o.excess > 0.004 ? ` (más ${M0(o.excess)} pagados de más)` : ''} y ${current ? 'hoy deben' : 'quedaron'} <b>${M0(o.end)}</b>.</p>
    </div>`;
}

/** Detalle del mes o nómina elegido: lo que se debía y lo que pasó. */
export function renderFlowPanel({ kind, bucket, flow: o, buckets, today }) {
    if (!bucket || !o) return '';
    const current = bucket.start <= today && today <= bucket.end;
    const here = kind === 'month' ? 'de este mes' : 'de este periodo';
    const nameOf = key => key === bucket.key ? here : key === 'antes' ? 'de antes' : `de ${buckets.find(b => b.key === key)?.label || key}`;
    const from = (obj, onlyOld) => Object.entries(obj).filter(([key, v]) => v > 0.004 && (!onlyOld || key !== bucket.key))
        .sort(([a], [b]) => b.localeCompare(a)).map(([key, v]) => `<div class="lf-r is-sub"><span>${escapeHTML(nameOf(key))}</span><b>${formatCurrency(v)}</b></div>`).join('');
    const r = (color, text, value, extra = '') => `<div class="lf-r${extra}"><i style="background:${color}"></i><span>${escapeHTML(text)}</span><b>${value}</b></div>`;
    const sameRefi = round2(o.refiCap - o.refiCapOld);
    return `<div class="lf-panel">
        <div class="lf-panel__t"><b>${escapeHTML(bucket.long)}${current ? ' · en curso' : ''}</b><small>datos al ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}</small></div>
        <div><h5>Lo que se debía</h5>
            ${r(COLOR.carry, 'Venía de antes', formatCurrency(o.open))}
            ${o.refiCapOld > 0.004 ? r(COLOR.carryRefi, `de eso, refinanciado (${o.nRefiOld})`, formatCurrency(o.refiCapOld), ' is-sub2') + from(o.refiFrom, true) : ''}
            ${r('#1fb6ff', `Capital nuevo (${o.nNew} préstamo${o.nNew === 1 ? '' : 's'})`, formatCurrency(o.newCap))}
            ${r('#ffc61a', 'Interés al prestar', formatCurrency(o.newInt))}
            ${r('#a855f7', `Interés por refinanciar (${o.nRefi})`, formatCurrency(o.refiInt))}
            ${o.adjustUp > 0.004 ? r('#fb923c', 'Ajustes de nóminas cerradas', formatCurrency(o.adjustUp)) : ''}
            ${sameRefi > 0.004 ? `<p class="lf-note">Además se refinanciaron ${formatCurrency(sameRefi)} de préstamos ${here}; ese capital ya está en «Capital nuevo».</p>` : ''}
            ${r('transparent', 'Total que se debía', formatCurrency(o.open + o.newCap + o.newInt + o.refiInt + o.adjustUp), ' is-tot')}
        </div>
        <div><h5>Lo que pasó</h5>
            ${r('#10d98a', 'Cobrado', (o.payOld + o.paySame > 0.004 ? '−' : '') + formatCurrency(o.payOld + o.paySame))}
            ${r('#0a8f5b', 'a interés', formatCurrency(o.payInt), ' is-sub2')}${r('#10d98a', 'a capital', formatCurrency(o.payCap), ' is-sub2')}
            ${o.payOld + o.paySame > 0.004 ? `<div class="lf-r is-sub"><span>por préstamos…</span><b></b></div>${from(o.payFrom, false)}` : ''}
            ${o.excess > 0.004 ? r('repeating-linear-gradient(45deg,#10d98a 0 2px,rgba(16,217,138,.2) 2px 5px)', 'Pagado de más: posible error (abono repetido); no baja la deuda', formatCurrency(o.excess)) : ''}
            ${o.adjustDown > 0.004 ? r('#fb923c', 'Ajustes que bajan la deuda', '−' + formatCurrency(o.adjustDown)) : ''}
            ${o.gift > 0.004 ? r('#78838d', 'Perdonado o cerrado con saldo', '−' + formatCurrency(o.gift)) : ''}
            ${r(COLOR.missing, `${current ? 'Falta' : 'Faltó'} por cobrar de lo que venía`, formatCurrency(o.missing))}
            ${r('transparent', current ? 'Saldo hoy' : 'Quedó al cerrar', formatCurrency(o.end), ' is-tot')}
        </div>
    </div>`;
}
