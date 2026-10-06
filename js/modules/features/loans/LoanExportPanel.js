/**
 * 📤 LoanExportPanel — botón y panel «Exportar» de la pantalla principal de
 * Préstamos (maqueta): formato (Excel o PDF), rango (mes, periodo de nómina o
 * personalizado), qué incluir y vista previa de cómo cambió el saldo.
 *
 * Excel: una hoja por parte, los montos como números (se pueden sumar).
 * PDF: encabezado con la obra, el rango y la fecha de emisión; resumen,
 * gráfica de saldo por periodo y las tablas.
 * Los datos salen de LoanExport.js; aquí solo se dibuja y se descarga.
 */

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { ensureExcelJSLoaded } from '../../utils/LazyExcelJS.js';
import { ensureJsPDFLoaded } from '../../utils/LazyCDN.js';
import { getActiveProjectId, entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { prepareLoanEmployees } from './LoanPortfolio.js';
import { buildAiReport } from './LoanAiReport.js';
import { buildPayPeriods } from './LoanPayPeriods.js';
import { buildPortfolioModel } from './LoanPortfolioView.js';
import { computeAttendanceDetailEarnings } from '../attendance/AttendanceDetailEarnings.js';
import { getEmployeePeriodSalary, LOAN_STATUS } from './LoansService.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { EXPORT_PARTS, exportMonths, exportPeriods, resolveExportRange, exportPreview, buildLoanExport } from './LoanExport.js';

const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const PART_LABEL = {
    resumen: 'Resumen de cartera y cómo cambió el saldo',
    empleados: 'Lista por empleado',
    prestamos: 'Lista por préstamo',
    movimientos: 'Movimientos del rango (préstamos, abonos, refinanciamientos)',
    historial: { excel: 'Saldo día por día', pdf: 'Gráfica y tabla del saldo por periodo' }
};
const SHEET_TITLE = { resumen: 'Resumen', empleados: 'Empleados', prestamos: 'Préstamos', movimientos: 'Movimientos', historial: 'Historial' };
const DEFAULTS = () => ({ open: false, fmt: 'excel', range: 'month', month: null, period: null, from: '', to: '', parts: Object.fromEntries(EXPORT_PARTS.map(k => [k, true])), voided: false, busy: false });

export function exportUi() {
    return { ...DEFAULTS(), ...(state.loansLedger?.portfolio?.export || {}) };
}

function setExport(fn) {
    stateManager.batchSetState(() => {
        if (!state.loansLedger) state.loansLedger = {};
        if (!state.loansLedger.portfolio) state.loansLedger.portfolio = {};
        const x = { ...DEFAULTS(), ...(state.loansLedger.portfolio.export || {}) };
        fn(x);
        state.loansLedger.portfolio.export = x;
    });
    render();
}

function projectName() {
    const id = getActiveProjectId?.();
    const project = (state.projects || []).find(p => p.id === id);
    return project?.name || state.settings?.companyName || '';
}

function choiceOf(x) {
    return { range: x.range, month: x.month, period: x.period, from: x.from, to: x.to };
}

/** Botón «Exportar» (va en la línea del mes). */
export function ExportButton() {
    const x = exportUi();
    return `<button type="button" class="lp-xbtn" data-app-fn="lxToggle" aria-expanded="${x.open}">Exportar</button>`;
}

/** Panel desplegable con formato, rango, partes y vista previa. */
export function ExportPanel(model) {
    const x = exportUi();
    if (!x.open) return '';
    const today = model.today;
    const payPeriod = getActivePayrollSettings(state).payPeriod;
    const range = resolveExportRange(choiceOf(x), { payPeriod, today });
    const p = exportPreview(model.employees, range);
    const months = exportMonths(model.employees, today);
    const periods = Number(payPeriod?.periodLength) > 0 ? exportPeriods(model.employees, payPeriod, today) : [];
    const radio = (key, label, extra) => `<label><input type="radio" name="lx-range" ${x.range === key ? 'checked' : ''} onchange="lxSet('range','${key}')"> ${label}</label>${x.range === key ? `<div class="lp-xp__sub">${extra}</div>` : ''}`;
    const monthSel = `<select aria-label="Mes" onchange="lxSet('month', this.value)">${months.map(m => `<option value="${m}" ${m === range.from.slice(0, 7) ? 'selected' : ''}>${MONTHS_LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</option>`).join('')}</select>`;
    const periodSel = periods.length
        ? `<select aria-label="Periodo de nómina" onchange="lxSet('period', this.value)">${periods.map(b => `<option value="${escapeAttr(b.key)}" ${b.start === range.from ? 'selected' : ''}>${escapeHTML(b.long.replace('Periodo ', ''))}</option>`).join('')}</select>`
        : '<small>Configura el periodo en Nómina.</small>';
    const customSel = `<input type="date" aria-label="Desde" value="${escapeAttr(range.from)}" onchange="lxSet('from', this.value)"><input type="date" aria-label="Hasta" value="${escapeAttr(range.to)}" onchange="lxSet('to', this.value)">`;
    const M = v => formatCurrency(v);
    const anyPart = EXPORT_PARTS.some(k => x.parts[k]);
    return `<section class="lp-xp" role="dialog" aria-label="Exportar préstamos">
        <div><h5>Formato</h5>
            <div class="lp-xp__fmt"><button type="button" data-app-fn="lxSet" data-arg="fmt" data-arg2="excel" aria-pressed="${x.fmt === 'excel'}">Excel</button><button type="button" data-app-fn="lxSet" data-arg="fmt" data-arg2="pdf" aria-pressed="${x.fmt === 'pdf'}">PDF</button><button type="button" data-app-fn="lxSet" data-arg="fmt" data-arg2="ai" aria-pressed="${x.fmt === 'ai'}" title="Markdown sin datos personales para pedirle un análisis a una IA">Para IA</button></div>
            <h5>Rango</h5>
            ${radio('month', 'Mes', monthSel)}
            ${radio('period', 'Periodo de nómina', periodSel)}
            ${radio('custom', 'Personalizado', customSel)}
        </div>
        ${x.fmt === 'ai' ? `<div><h5>Qué lleva el archivo para IA</h5>
            <ul class="lp-xp__list">
                <li>Cómo funcionan los préstamos y los cobros (nómina, interés, refinanciamientos, cierres).</li>
                <li>La cartera hoy, el historial por periodo y por mes, los descuentos de nómina por periodo y la antigüedad de la deuda.</li>
                <li>Los empleados en riesgo y, por empleado, sus préstamos, abonos y lo que ganó en los últimos periodos frente a lo que ganaría normalmente (faltas u horas extra).</li>
                <li>Preguntas sugeridas para la IA.</li>
            </ul>
            <p class="lp-xp__hint"><b>Sin datos personales:</b> los empleados van solo por su número de empleado; no lleva nombres, notas ni conceptos. Tú sabes quién es cada número; la IA no.</p>
        </div>` : `<div><h5>Qué incluir</h5>
            ${EXPORT_PARTS.map(k => `<label><input type="checkbox" ${x.parts[k] ? 'checked' : ''} onchange="lxPart('${k}')"> ${escapeHTML(typeof PART_LABEL[k] === 'string' ? PART_LABEL[k] : PART_LABEL[k][x.fmt])}</label>`).join('')}
            <label class="lp-xp__gap"><input type="checkbox" ${x.voided ? 'checked' : ''} onchange="lxPart('voided')"> Incluir préstamos anulados en la lista por préstamo</label>
            <p class="lp-xp__hint">${x.fmt === 'excel' ? 'Un archivo con una hoja por cada parte marcada; los montos van como números para poder sumarlos.' : 'Un documento con el resumen arriba, la gráfica y las tablas; el encabezado lleva la obra, el rango y la fecha de emisión.'}</p>
        </div>`}
        <div><h5>Vista previa · ${escapeHTML(range.label)}</h5><div class="lp-xp__prev">
            <div><span>Saldo al empezar</span><b>${M(p.start)}</b></div>
            <div><span>+ Préstamos nuevos (${p.nLoans}) con su interés</span><b class="is-cap">${M(p.newLoans)}</b></div>
            <div><span>+ Refinanciamientos (${p.nRefi})</span><b class="is-refi">${M(p.refi)}</b></div>
            <div><span>− Abonos aplicados a la deuda (${p.nPays})</span><b class="is-pay">${M(p.paid)}</b></div>
            ${p.closed > 0.004 ? `<div><span>− Cerrados o ajustes</span><b>${M(p.closed)}</b></div>` : ''}
            <div class="is-tot"><span>Saldo al terminar</span><b>${M(p.end)}</b></div>
            ${p.excess > 0.004 ? `<div><span>Pagado de más en el rango</span><b class="is-bad">${M(p.excess)}</b></div>` : ''}
            ${p.any ? '' : '<div><span>Sin movimientos en este rango.</span></div>'}
        </div></div>
        <div class="lp-xp__go"><span>Se exporta la obra activa${model.prepared?.virtual ? ', leída como en esta pantalla (consolidaciones deshechas y datos completados)' : ''}.</span>
            <button type="button" class="lp-add" data-app-fn="lxDownload" ${(anyPart || x.fmt === 'ai') && !x.busy ? '' : 'disabled'}>${x.busy ? 'Generando…' : `Descargar ${x.fmt === 'excel' ? 'Excel' : x.fmt === 'pdf' ? 'PDF' : 'para IA (.md)'}`}</button></div>
    </section>`;
}

// ─── Descargas ───────────────────────────────────────────────────────────────

function deliver(blob, filename, title, text) {
    if (typeof window.showExportMenu === 'function') {
        window.showExportMenu({ filename, blob, title, text });
        return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const MONEY_FMT = '"$"#,##0.00';

/**
 * Lo que ganó cada empleado con préstamos en los últimos periodos (asistencia,
 * el mismo cálculo que Nómina) frente a lo que ganaría normalmente.
 */
function collectEarnings(employees, payPeriod, today, count = 6) {
    const length = Number(payPeriod?.periodLength) || 0;
    const out = new Map();
    if (!length) return out;
    const periods = buildPayPeriods(payPeriod, today, { before: count, after: 0 }).filter(p => p.start <= today);
    for (const emp of employees) {
        const loans = (emp.loans || []).filter(l => l.status !== LOAN_STATUS.WRITTEN_OFF);
        if (!loans.length) continue;
        const normal = getEmployeePeriodSalary(emp, length / 7, state) || 0;
        out.set(emp.id, periods.map(p => {
            const partial = p.end >= today;
            const end = partial ? today : p.end;
            const r = computeAttendanceDetailEarnings(state, emp.id, p.start, end);
            const sum = k => (r.breakdown || []).reduce((t, b) => t + Number(b[k] || 0), 0);
            const elapsed = Math.round((Date.parse(end) - Date.parse(p.start)) / 86_400_000) + 1;
            const deducted = loans.reduce((t, l) => t + (l.payments || []).filter(x => !x.voided && !x.adjustment
                && (x.origin === 'payroll' || x.source === 'payroll' || x.payrollClosureId)
                && (x.payrollPeriodEnd ? x.payrollPeriodEnd === p.end : x.date >= p.end && x.date <= p.payDate))
                .reduce((a, x) => a + Number(x.amount || 0), 0), 0);
            return {
                label: p.short.replace(/\s/g, ''), start: p.start, end: p.end, partial, gross: r.gross || 0,
                expected: partial ? normal * elapsed / length : normal,
                days: r.available ? sum('days') : null, regularHours: sum('regularHours'), overtimeHours: sum('overtimeHours'), deducted
            };
        }));
    }
    return out;
}

async function toExcel(data, parts) {
    await ensureExcelJSLoaded();
    const ExcelJS = window.ExcelJS;
    if (!ExcelJS) throw new Error('ExcelJS no disponible');
    const wb = new ExcelJS.Workbook();
    const head = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E252B' } }, alignment: { vertical: 'middle' } };
    for (const key of EXPORT_PARTS) {
        if (!parts[key]) continue;
        const rows = data.sheets[key];
        const ws = wb.addWorksheet(SHEET_TITLE[key]);
        ws.addRows(rows);
        const width = Math.max(...rows.map(r => r.length));
        for (let c = 1; c <= width; c++) {
            const col = ws.getColumn(c);
            col.width = Math.min(48, Math.max(10, ...rows.map(r => String(r[c - 1] ?? '').length + 2)));
            col.eachCell(cell => { if (typeof cell.value === 'number' && !/Tasa|Nº|Préstamos abiertos|Refinanciamientos$/.test(String(rows[0][c - 1] || ''))) cell.numFmt = MONEY_FMT; });
        }
        if (key === 'resumen') {
            ws.getRow(1).font = { bold: true, size: 14 };
            rows.forEach((r, i) => { if (r[1] === 'Monto') ws.getRow(i + 1).eachCell(cell => { cell.style = head; }); });
        } else {
            ws.getRow(1).eachCell(cell => { cell.style = head; });
            ws.views = [{ state: 'frozen', ySplit: 1 }];
        }
    }
    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Las fuentes estándar del PDF no traen «−» (U+2212): se usa el guion común.
const pdfText = v => String(v ?? '').replace(/\u2212/g, '-');
function moneyText(v) {
    return typeof v === 'number' ? formatCurrency(v) : pdfText(v);
}

async function toPdf(data, parts, { projectName: obra, today }) {
    await ensureJsPDFLoaded();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const margin = 36;
    const room = need => { if (y + need > H - margin) { doc.addPage(); y = margin; } };
    doc.setFontSize(16); doc.setFont(undefined, 'bold');
    doc.text(`Préstamos${obra ? ` · ${obra}` : ''}`, margin, 44);
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(90);
    doc.text(`Rango: ${data.range.label} · emitido el ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`, margin, 60);
    doc.setTextColor(0);
    let y = 76;
    const table = (title, rows, opts = {}) => {
        if (rows.length < 2) return;
        room(80);
        doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text(title, margin, y + 14); doc.setFont(undefined, 'normal');
        doc.autoTable({
            startY: y + 20, head: [rows[0].map(pdfText)], body: rows.slice(1).map(r => r.map((v, i) => (opts.plain?.includes(i) ? pdfText(v) : moneyText(v)))),
            margin: { left: margin, right: margin }, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [30, 37, 43] }, ...opts.table
        });
        y = doc.lastAutoTable.finalY + 10;
    };
    if (parts.resumen) {
        const rs = data.sheets.resumen;
        const flow = rs.slice(4, 16).filter(r => r.length);
        const cart = rs.slice(17).filter(r => r.length);
        table('Cómo cambió el saldo', flow, { table: { tableWidth: (W - margin * 2) / 2 - 8 } });
        y = 76;
        doc.autoTable({ startY: y + 20, head: [cart[0]], body: cart.slice(1).map(r => [r[0], moneyText(r[1])]), margin: { left: W / 2 + 8, right: margin }, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [30, 37, 43] } });
        y = Math.max(doc.lastAutoTable.finalY, y) + 22;
    }
    if (parts.historial && data.periods.length) {
        room(230);
        doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text('Saldo al cerrar cada periodo (periodos completos que tocan el rango)', margin, y + 14); doc.setFont(undefined, 'normal');
        const ch = 150; const top = y + 24; const max = Math.max(1, ...data.periods.map(p => Math.max(p.end, p.lent + p.refi, p.paid)));
        const cw = (W - margin * 2) / data.periods.length; const bw = Math.min(26, cw * 0.28);
        doc.setDrawColor(200); doc.line(margin, top + ch, W - margin, top + ch);
        data.periods.forEach((p, i) => {
            const x = margin + cw * i + cw / 2;
            const bar = (v, dx, rgb) => {
                const h = ch * v / max; doc.setFillColor(...rgb); doc.rect(x + dx, top + ch - h, bw, h, 'F');
                if (v > 0.004) { doc.setFontSize(6.5); doc.setTextColor(60); doc.text(`${Math.round(v / 100) / 10}k`, x + dx + bw / 2, top + ch - h - 3, { align: 'center' }); doc.setTextColor(0); }
            };
            bar(p.end, -bw * 1.5 - 2, [31, 95, 138]);
            bar(p.lent + p.refi, -bw / 2, [31, 182, 255]);
            bar(p.paid, bw / 2 + 2, [16, 217, 138]);
            doc.setFontSize(7); doc.setTextColor(60); doc.text(p.label, x, top + ch + 10, { align: 'center' }); doc.setTextColor(0);
        });
        doc.setFontSize(8);
        [['Saldo al cerrar', [31, 95, 138]], ['Prestado con interés y refinanciado', [31, 182, 255]], ['Cobrado', [16, 217, 138]]].forEach(([t, rgb], i) => {
            doc.setFillColor(...rgb); doc.rect(margin + i * 190, top + ch + 18, 8, 8, 'F'); doc.text(t, margin + i * 190 + 12, top + ch + 25);
        });
        y = top + ch + 32;
        table('Por periodo', [['Periodo', 'Venía de antes', 'Prestado (con interés)', 'Refinanciado', 'Cobrado', 'Saldo al cerrar'], ...data.periods.map(p => [p.label, p.open, p.lent, p.refi, p.paid, p.end])], { plain: [0] });
    }
    if (parts.empleados) table('Por empleado', data.sheets.empleados, { plain: [0, 1, 2, 3, 9] });
    if (parts.prestamos) table('Por préstamo', data.sheets.prestamos, { plain: [0, 1, 2, 3, 5, 7, 11, 12] });
    if (parts.movimientos) table('Movimientos del rango', data.sheets.movimientos, { plain: [0, 1, 2, 3, 4, 8] });
    return doc.output('blob');
}

// ─── Acciones (window.lx*) ───────────────────────────────────────────────────

export function lxToggle() { setExport(x => { x.open = !x.open; }); }
export function lxSet(field, value) {
    if (!['fmt', 'range', 'month', 'period', 'from', 'to'].includes(field)) return;
    setExport(x => { x[field] = value; });
}
export function lxPart(key) {
    setExport(x => {
        if (key === 'voided') x.voided = !x.voided;
        else if (EXPORT_PARTS.includes(key)) x.parts = { ...x.parts, [key]: !x.parts[key] };
    });
}

/** Arma el archivo con la obra activa, leída igual que la pantalla principal. */
export async function lxDownload() {
    const x = exportUi();
    const today = getDateKey(new Date());
    const payPeriod = getActivePayrollSettings(state).payPeriod;
    const scope = peekEntityScope();
    const employees = prepareLoanEmployees((state.employees || []).filter(emp => entityInScope(emp, scope)), payPeriod).employees;
    const range = resolveExportRange(choiceOf(x), { payPeriod, today });
    const obra = projectName();
    setExport(s => { s.busy = true; });
    try {
        if (x.fmt === 'ai') {
            const scoped = (state.employees || []).filter(emp => entityInScope(emp, scope));
            const model = buildPortfolioModel(scoped);
            const md = buildAiReport({
                today, payPeriod, employees: model.employees, summary: model.summary, risk: model.risk,
                earnings: collectEarnings(model.employees, payPeriod, today),
                notes: { duplicates: model.duplicates, review: model.review.length, virtual: model.prepared.virtual },
                focus: { label: range.label, preview: exportPreview(model.employees, range) }
            });
            deliver(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `Prestamos_para_IA_${today}.md`, 'Préstamos para IA', 'Sin datos personales');
            return;
        }
        const data = buildLoanExport(employees, { range, includeVoided: x.voided, today, projectName: obra, payPeriod });
        const blob = x.fmt === 'pdf' ? await toPdf(data, x.parts, { projectName: obra, today }) : await toExcel(data, x.parts);
        const safe = s => String(s || '').replace(/[^\wáéíóúñÁÉÍÓÚÑ\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50);
        const filename = `Prestamos_${safe(obra) ? safe(obra) + '_' : ''}${safe(range.file)}.${x.fmt === 'pdf' ? 'pdf' : 'xlsx'}`;
        deliver(blob, filename, 'Préstamos', range.label);
    } catch (error) {
        console.warn('lxDownload:', error);
        window.showAlert?.(`No se pudo generar el archivo. ${error?.message || ''}`);
    } finally {
        setExport(s => { s.busy = false; });
    }
}

export function registerLoanExportGlobals() {
    if (typeof window === 'undefined') return;
    Object.assign(window, { lxToggle, lxSet, lxPart, lxDownload });
}
