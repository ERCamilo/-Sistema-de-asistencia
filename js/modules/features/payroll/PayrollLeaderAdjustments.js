import { filterPayrollRowsByLeader } from './PayrollPreview.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';

const expandedGroups = new Set();
export function rememberPayrollLeaderAdjustmentExpansion(details) {
    const key = details?.dataset?.payrollLeaderAdjustmentKey;
    if (!key || !details.isConnected) return;
    if (details.open) expandedGroups.add(key); else expandedGroups.delete(key);
}

const money = value => Math.round((Number(value) || 0) * 100) / 100;
const workExpression = entry => [
    entry.regularHours ? `${entry.regularHours} h × ${cash(entry.hourlyRate)} = ${cash(entry.regularAmount)}` : '',
    entry.overtimeHours ? `${entry.overtimeHours} h extra = ${cash(entry.overtimeAmount)}` : '',
    entry.holidayHours ? `Feriado ${entry.holidayHours} h = ${cash(entry.holidayAmount)}` : '',
    entry.restDayHours ? `Descanso ${entry.restDayHours} h = ${cash(entry.restDayAmount)}` : ''
].filter(Boolean).join(' + ');
const cash = value => `$${money(value).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;

export function payrollLeaderAdjustmentKey({ ownerId = 'local', projectId = 'legacy', periodStart, periodEnd, leaderId }) {
    return JSON.stringify([ownerId, projectId || 'legacy', periodStart, periodEnd, String(leaderId)]);
}

/** Separate from payable rows: no employee actions or loan collection can reach it. */
export function buildPayrollLeaderAdjustments(rows = [], options = {}) {
    const groups = new Map();
    for (const row of rows) {
        for (const part of row._positionBreakdown || []) {
            if (part.assignmentSchemaVersion !== 1 || !part.isLoanPosition || !part.workLeaderId
                || !part.payerLeaderId || String(part.workLeaderId) === String(part.payerLeaderId) || !(Number(part.subtotal) > 0)) continue;
            const leaderId = String(part.workLeaderId);
            if (!groups.has(leaderId)) {
                const key = payrollLeaderAdjustmentKey({ ...options, leaderId });
                const subtotal = filterPayrollRowsByLeader(rows, { ...options, leaderId })
                    .reduce((sum, item) => sum + Number(item.monto || 0), 0);
                groups.set(leaderId, { key, leaderId, leaderName: part.workLeaderName || '',
                    enabled: options.selections?.[key] !== false, amount: 0,
                    subtotal: money(subtotal), balance: 0, entries: [] });
            }
            const group = groups.get(leaderId);
            const amount = money(part.subtotal);
            group.amount = money(group.amount + amount);
            group.entries.push({ employeeId: String(row._employeeId), employeeNumber: String(row._number || row.id || ''),
                employeeName: row._employeeName || row.nombre || '', positionId: String(part.positionId),
                positionName: part.positionName || '', payerLeaderId: String(part.payerLeaderId), payerLeaderName: part.payerLeaderName || '',
                days: Number(part.days) || 0, hourlyRate: part.hourlyRate, regularHours: part.regularHours,
                overtimeHours: part.overtimeHours, holidayHours: part.holidayHours, restDayHours: part.restDayHours,
                regularAmount: part.regularAmount, overtimeAmount: part.overtimeAmount,
                holidayAmount: part.holidayAmount, restDayAmount: part.restDayAmount, amount });
        }
    }
    return [...groups.values()].map(group => ({ ...group, balance: money(group.subtotal - (group.enabled ? group.amount : 0)) }))
        .sort((a, b) => a.leaderId.localeCompare(b.leaderId));
}

export function renderPayrollLeaderAdjustments(groups = [], { partial = false, readOnly = false, hoursFiltered = false } = {}) {
    return groups.map((group, index) => `<section class="payroll-leader-adjustment" aria-label="Ajuste del líder ${escapeHTML(group.leaderName)}">
        <div class="payroll-leader-adjustment__heading"><label><input type="checkbox" ${readOnly ? '' : `data-payroll-leader-adjustment="${index}" data-payroll-action="toggle-leader-adjustment"`} ${group.enabled ? 'checked' : ''} ${partial || readOnly ? 'disabled' : ''}>Aplicar descuento</label><strong>${escapeHTML(group.leaderName)}</strong></div>
        <details data-payroll-leader-adjustment-key="${escapeAttr(group.key)}" ${expandedGroups.has(group.key) ? 'open' : ''}><summary data-payroll-leader-details><span>Personal pagado por otros líderes <small>${group.entries.length} tramo(s) · ${group.enabled ? 'Aplicado' : 'Desactivado'}</small></span><strong>−${cash(group.enabled ? group.amount : 0)}</strong><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
        ${group.entries.map(entry => `<article><strong>${escapeHTML(entry.employeeName)} · #${escapeHTML(entry.employeeNumber)}</strong><span>${escapeHTML(entry.positionName)} · paga ${escapeHTML(entry.payerLeaderName)}</span><span>${workExpression(entry)} · Total ${cash(entry.amount)}</span></article>`).join('')}
        <p>Solo lectura. Sin descuentos personales, bonificaciones ni cobros de préstamos.</p></details>
        <div class="payroll-leader-adjustment__balance"><span>${partial || hoursFiltered ? 'Subtotal completo' : 'Subtotal de empleados'} ${cash(group.subtotal)}</span><strong>${partial || hoursFiltered ? 'Saldo completo' : 'Saldo del líder'} ${group.balance < 0 ? '−' : ''}${cash(Math.abs(group.balance))}</strong></div>
        ${partial ? '<p>Resumen completo del líder. Quita el filtro de empleados para cambiar el ajuste.</p>' : ''}
        ${hoursFiltered && !partial ? '<p>Resumen completo del líder. El filtro de puestos solo limita la tabla de empleados.</p>' : ''}
    </section>`).join('');
}

/** Strict, canonical closure metadata; signed balance never enters employee totals. */
export function canonicalLeaderAdjustments(groups = []) {
    const keys = new Set();
    return groups.map(group => {
        if (!group?.key || keys.has(group.key)) throw new Error('Ajuste de líder duplicado o sin identidad.');
        keys.add(group.key);
        const entries = (group.entries || []).map(entry => {
            if (!entry.employeeId || !Number.isFinite(entry.amount) || entry.amount < 0) throw new Error('Detalle de ajuste de líder inválido.');
            return { ...entry };
        }).sort((a, b) => JSON.stringify(Object.keys(a).sort().map(key => [key, a[key]]))
            .localeCompare(JSON.stringify(Object.keys(b).sort().map(key => [key, b[key]]))));
        const amount = money(entries.reduce((sum, entry) => sum + entry.amount, 0));
        if (money(group.amount) !== amount || !Number.isFinite(group.subtotal)) throw new Error('El ajuste no coincide con su detalle.');
        return { ...group, enabled: group.enabled !== false, entries, amount,
            balance: money(group.subtotal - (group.enabled !== false ? amount : 0)) };
    }).sort((a, b) => a.key.localeCompare(b.key));
}
