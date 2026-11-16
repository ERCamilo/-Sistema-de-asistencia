import { resolveEmployeePositionTerms } from '../employees/EmployeePositionAssignments.js';

export const normalizeLoanPositionLayout = value => value === 'inline' ? 'inline' : 'separate';
const id = value => value == null ? '' : String(value);
const sum = values => Object.values(values).reduce((total, value) => total + Number(value || 0), 0);
const number = value => Number(value || 0).toLocaleString('es-DO', { maximumFractionDigits: 6 });
const transferKey = (employeeId, positionId, payerId) => JSON.stringify([id(employeeId), id(positionId), id(payerId)]);

/** Display projection only. Day values and monetary adjustments come from the existing report/payroll. */
export function buildLeaderExcelLoanPresentation({ employees, report, state, settings, leaderId, payrollRows = [], leaderAdjustment, mode }) {
    const leader = id(leaderId);
    const sourceEmployees = new Map((state.employees || []).map(employee => [id(employee.id), employee]));
    const positions = new Map((state.positions || []).map(position => [id(position.id), position]));
    const leaderName = (leaderId, fallback) => (state.leaders || []).find(item => id(item.id) === id(leaderId))?.name || fallback || 'Sin líder';
    const groups = new Map((report.assignmentPayroll?.groups || []).map(group => [id(group.leaderId), group]));
    const details = new Map();
    const debitEntries = new Set((leaderAdjustment?.entries || []).map(entry => transferKey(entry.employeeId, entry.positionId, entry.payerLeaderId)));
    const debitMap = new Map();

    for (const group of report.positions || []) {
        const position = group.position;
        for (const employee of group.employees) {
            const source = sourceEmployees.get(id(employee.id));
            if (!source) continue;
            const days = {};
            for (const [date, value] of Object.entries(employee.dayValues || {})) {
                const record = state.attendance?.[`${employee.id}-${date}`];
                if (!record?.present) continue;
                const parts = record.positionHours?.length ? record.positionHours : [{
                    positionId: record.selectedPosition || source.positions?.[0], hours: record.hoursWorked, overtimeHours: record.overtimeHours
                }];
                const worked = parts.filter(part => id(part.positionId || record.selectedPosition || source.positions?.[0]) === id(position.id));
                if (!worked.length) continue;
                const hours = worked.reduce((total, part) => total + Number(part.hours || 0), 0);
                const overtime = worked.reduce((total, part) => total + Number(part.overtimeHours || 0), 0);
                const terms = resolveEmployeePositionTerms(source, position, { ...record, date: record.date || date }, { settings, leaders: state.leaders || [] });
                const borrowed = terms.isLoanPosition === true;
                const transfer = borrowed && terms.workLeaderId && terms.payerLeaderId && id(terms.workLeaderId) !== id(terms.payerLeaderId);
                const adjustment = transfer ? groups.get(id(terms.workLeaderId)) : null;
                const charged = adjustment?.entries.some(entry => transferKey(entry.employeeId, entry.positionId, entry.payerLeaderId)
                    === transferKey(employee.id, position.id, terms.payerLeaderId));
                const detail = { positionId: id(position.id), positionName: position.name, value: Number(value || 0), hours, overtime,
                    payerId: id(terms.payerLeaderId), workLeaderId: id(terms.workLeaderId), borrowed,
                    chargeName: charged ? leaderName(terms.workLeaderId, terms.workLeaderName) : '',
                    chargeEnabled: charged && adjustment.enabled !== false };
                days[date] = detail;

                if (debitEntries.has(transferKey(employee.id, position.id, terms.payerLeaderId)) && transfer && id(terms.workLeaderId) === leader) {
                    const key = id(employee.id);
                    if (!debitMap.has(key)) debitMap.set(key, { id: key, number: employee.number, name: employee.name,
                        positionName: 'Descuento por préstamo de personal', dayValues: {}, notes: {}, highlightedDates: new Set() });
                    const debit = debitMap.get(key);
                    debit.dayValues[date] = (debit.dayValues[date] || 0) - (leaderAdjustment.enabled !== false ? detail.value : 0);
                    (debit.notes[date] ||= []).push(detail);
                    debit.highlightedDates.add(date);
                }
            }
            details.set(JSON.stringify([id(employee.id), id(position.id)]), days);
        }
    }

    function describe(parts, { debit = false, enabled = true } = {}) {
        const lines = parts.map(part => `${part.positionName}: ${number(part.hours)} h${part.overtime ? ` + ${number(part.overtime)} h extra` : ''}`);
        if (debit) {
            lines.push(enabled ? `Se le descuenta a ${leaderName(leader, leaderAdjustment?.leaderName)}` : 'Descuento desactivado');
        } else {
            const charges = new Map();
            for (const part of parts) if (part.chargeName) charges.set(part.chargeName, part.chargeEnabled);
            for (const [name, active] of charges) lines.push(active ? `Se le descuenta a ${name}` : `Descuento a ${name} desactivado`);
        }
        return lines.join('\n');
    }

    const output = employees.map(employee => {
        const source = sourceEmployees.get(id(employee.id));
        const payroll = payrollRows.find(row => id(row._employeeId) === id(employee.id));
        const parts = payroll?._positionBreakdown || [];
        const items = employee.items.map(item => {
            const dayDetails = details.get(JSON.stringify([id(employee.id), id(item.positionId)])) || {};
            const owned = Object.fromEntries(Object.entries(dayDetails).filter(([, detail]) => detail.payerId === leader));
            const breakdown = parts.filter(part => id(part.positionId) === id(item.positionId));
            return { ...item, dayValues: { ...item.dayValues },
                gross: breakdown.reduce((total, part) => total + Number(part.subtotal || 0), 0),
                loanGross: breakdown.filter(part => part.isLoanPosition === true).reduce((total, part) => total + Number(part.subtotal || 0), 0),
                details: owned, notes: {}, highlightedDates: new Set() };
        });
        if (normalizeLoanPositionLayout(mode) === 'inline') {
            const primaryId = id(source?.positions?.[0] || source?.position);
            let anchor = items.find(item => id(item.positionId) === primaryId);
            const loans = [];
            for (const item of items) {
                const borrowed = Object.entries(item.details).filter(([, detail]) => detail.borrowed);
                if (!borrowed.length || item === anchor) continue;
                for (const [date, detail] of borrowed) {
                    loans.push([date, detail]);
                    delete item.dayValues[date];
                }
                item.gross -= item.loanGross;
                item.total = sum(item.dayValues);
                item.movedLoan = true;
            }
            if (loans.length) {
                if (!anchor) {
                    anchor = { positionId: primaryId, positionName: positions.get(primaryId)?.name || 'Posición principal',
                        dayValues: {}, total: 0, gross: 0, details: {}, notes: {}, highlightedDates: new Set() };
                    items.unshift(anchor);
                }
                for (const [date, detail] of loans) {
                    anchor.dayValues[date] = (anchor.dayValues[date] || 0) + detail.value;
                    (anchor.notes[date] ||= []).push(detail);
                    anchor.highlightedDates.add(date);
                }
                anchor.gross += items.filter(item => item.movedLoan).reduce((total, item) => total + item.loanGross, 0);
                anchor.total = sum(anchor.dayValues);
            }
            for (const item of items) {
                for (const [date, detail] of Object.entries(item.details || {})) {
                    if (item.movedLoan && detail.borrowed) continue;
                    if (detail.borrowed || item.highlightedDates.has(date)) {
                        (item.notes[date] ||= []).push(detail);
                        item.highlightedDates.add(date);
                    }
                }
            }
            // Anchor precedes remaining non-loan jobs; only borrowed contributions were folded into it.
            if (anchor) items.sort((a, b) => a === anchor ? -1 : b === anchor ? 1 : 0);
        } else {
            for (const item of items) for (const [date, detail] of Object.entries(item.details)) {
                if (detail.borrowed) {
                    item.notes[date] = [detail];
                    item.highlightedDates.add(date);
                }
            }
        }
        return { ...employee, items: items.filter(item => !item.movedLoan || Object.values(item.details).some(detail => !detail.borrowed))
            .map(item => ({ ...item, notes: Object.fromEntries(Object.entries(item.notes).map(([date, parts]) => [date, describe(parts)])) })) };
    });
    const debitRows = [...debitMap.values()].sort((a, b) => id(a.number).localeCompare(id(b.number), 'es', { numeric: true }))
        .map(row => ({ ...row, total: sum(row.dayValues), notes: Object.fromEntries(Object.entries(row.notes)
            .map(([date, parts]) => [date, describe(parts, { debit: true, enabled: leaderAdjustment.enabled !== false })])) }));
    return { employees: output, debitRows };
}
