import { toSplitXRows } from './PayrollLoans.js';
import { getBalance, LOAN_STATUS, round2 } from '../loans/LoansService.js';

const SCHEMA = 'sa-splitx-payroll/v1';
const DAY_FIELDS = { regular: 'regularHours', overtime: 'overtimeHours', holiday: 'holidayHours', restDay: 'restDayHours' };
const text = value => value == null ? '' : String(value);
const fraction = value => Math.round(value * 1e6) / 1e6;

function numeric(value) {
    const result = Number(value ?? 0);
    if (!Number.isFinite(result)) throw new Error('La exportación contiene un importe o una cantidad no válidos.');
    return result;
}

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function equivalentDays(breakdown, hoursPerDay) {
    const days = Object.fromEntries(Object.entries(DAY_FIELDS).map(([category, field]) => [
        category, fraction(breakdown.reduce((sum, item) => sum + numeric(item[field]), 0) / hoursPerDay)
    ]));
    return {
        unit: 'equivalent-day', ...days,
        total: fraction(breakdown.reduce((sum, item) => sum + Object.values(DAY_FIELDS).reduce((hours, field) => hours + numeric(item[field]), 0), 0) / hoursPerDay)
    };
}

function adjustmentDetails(details, direction, label) {
    return (details || []).map((item, index) => {
        const amount = numeric(item.amount);
        const detail = {
            id: text(item.id), concept: text(item.name) || `${label} ${index + 1}`,
            type: item.type === 'percentage' ? 'percentage' : 'fixed',
            value: numeric(item.value ?? item.amount), amount, signedAmount: direction * amount
        };
        if (item.type === 'percentage' && item.appliedTo != null) detail.baseAmount = numeric(item.appliedTo);
        if (item.planId != null) detail.planId = text(item.planId);
        if (item.installmentId != null) detail.installmentId = text(item.installmentId);
        if (item.sequence != null) detail.installmentSequence = numeric(item.sequence);
        if (item.installmentCount != null) detail.installmentCount = numeric(item.installmentCount);
        return detail;
    });
}

function appliedDailyRate(parts, hoursPerDay) {
    if (parts.some(part => part.hourlyRate == null)) return null;
    const rates = [...new Set(parts.map(part => numeric(part.hourlyRate)))];
    return rates.length === 1 ? rates[0] * hoursPerDay : null;
}

function organization(source, options, hoursPerDay) {
    const employee = (options.employees || []).find(item => text(item.id) === text(source._employeeId));
    const worked = source._positionBreakdown || [];
    const assignedIds = employee?.positions?.length ? employee.positions : [employee?.position];
    const entries = worked.length ? worked : assignedIds.filter(id => id != null).map(positionId => ({ positionId }));
    const ids = [...new Set(entries.map(item => text(item.positionId)).filter(Boolean))];
    const leaders = new Map();
    const positions = ids.map(id => {
        const parts = entries.filter(item => text(item.positionId) === id);
        const position = (options.positions || []).find(item => text(item.id) === id);
        const leader = position?.leaderId == null ? null : (options.leaders || []).find(item => text(item.id) === text(position.leaderId));
        if (leader) leaders.set(text(leader.id), { id: text(leader.id), name: text(leader.name), number: text(leader.number) });
        return {
            id, name: text(parts[0]?.positionName || position?.name),
            leaderId: leader ? text(leader.id) : null, workDays: equivalentDays(parts, hoursPerDay),
            dailyRate: appliedDailyRate(parts, hoursPerDay)
        };
    });
    return { positions, leaders: [...leaders.values()] };
}

function loanExports(source, options) {
    const employee = (options.employees || []).find(item => text(item.id) === text(source._employeeId));
    const loans = Array.isArray(employee?.loans) ? employee.loans : null;
    const optionalMoney = value => value == null ? null : round2(numeric(value));
    const loanBreakdown = (source._loanDetails || []).map(detail => {
        const recorded = detail.linked === true;
        const loan = loans?.find(item => text(item.id) === text(detail.loanId));
        const deductionAmount = round2(numeric(detail.selectedAmount));
        const balanceBefore = recorded ? null : optionalMoney(detail.balance);
        if (deductionAmount < 0 || (balanceBefore != null && balanceBefore + 0.005 < deductionAmount)) {
            throw new Error('El abono de un préstamo supera su deuda o tiene un importe no válido.');
        }
        return {
            loanId: text(detail.loanId), concept: text(loan?.concept || detail.concept) || 'Préstamo',
            status: recorded ? 'recorded' : 'proposed',
            ...(recorded ? { paymentId: text(detail.paymentId) } : {}),
            balanceBefore, deductionAmount,
            principalAmount: recorded ? null : optionalMoney(detail.capitalPart),
            interestAmount: recorded ? null : optionalMoney(detail.interestPart),
            projectedBalanceAfter: balanceBefore == null ? null : round2(balanceBefore - deductionAmount),
            currentBalance: loan ? getBalance(loan) : null
        };
    });
    const deductionAmount = round2(numeric(source._loans));
    const sum = field => round2(loanBreakdown.reduce((total, detail) => total + numeric(detail[field]), 0));
    if (loanBreakdown.length && Math.abs(sum('deductionAmount') - deductionAmount) > 0.005) {
        throw new Error('El detalle de préstamos no coincide con el descuento de esta nómina.');
    }
    const complete = sum('deductionAmount') === deductionAmount;
    const projectionAvailable = complete && loanBreakdown.every(detail => detail.status === 'proposed' && detail.balanceBefore != null)
        && new Set(loanBreakdown.map(detail => detail.loanId)).size === loanBreakdown.length;
    const totalOutstandingBalance = loans == null ? null : round2(loans
        .filter(loan => loan.status === LOAN_STATUS.ACTIVE)
        .reduce((total, loan) => total + getBalance(loan), 0));
    const knownSum = field => complete && loanBreakdown.every(detail => detail[field] != null) ? sum(field) : null;
    return {
        loanBreakdown,
        loanSummary: {
            scope: 'selected-loans', projectionAvailable,
            balanceBefore: projectionAvailable ? sum('balanceBefore') : null,
            deductionAmount, principalAmount: knownSum('principalAmount'), interestAmount: knownSum('interestAmount'),
            projectedBalanceAfter: projectionAvailable ? sum('projectedBalanceAfter') : null,
            totalOutstandingBalance,
            projectedTotalOutstandingBalance: projectionAvailable && totalOutstandingBalance != null && totalOutstandingBalance >= deductionAmount
                ? round2(totalOutstandingBalance - deductionAmount) : null
        }
    };
}

/** Additive projection of the effective payroll preview; never records payments. */
export function buildSplitXExport(rows, options) {
    const period = options.period;
    if (!validDate(period?.start) || !validDate(period?.end) || period.start > period.end) {
        throw new Error('Selecciona un período válido de inicio y fin para exportar.');
    }
    const hoursPerDay = numeric(options.regularHoursPerDay ?? 8);
    if (hoursPerDay <= 0) throw new Error('La jornada de trabajo debe ser mayor que cero para exportar días.');
    const legacy = toSplitXRows(rows);
    const employees = legacy.map((base, index) => {
        const source = rows[index];
        const breakdown = source._positionBreakdown?.length ? source._positionBreakdown : [{
            regularHours: source._regularHours, overtimeHours: source._overtimeHours,
            holidayHours: source._holidayHours, restDayHours: source._restDayHours
        }];
        return {
            ...base,
            sourceEmployeeId: text(source._employeeId), employeeNumber: text(source._number),
            employeeName: text(source._employeeName), workDays: equivalentDays(breakdown, hoursPerDay),
            ...organization(source, options, hoursPerDay),
            ...loanExports(source, options),
            bonusDetails: adjustmentDetails(source._bonusDetails, 1, 'Bonificación'),
            deductionDetails: adjustmentDetails(source._deductionDetails, -1, 'Descuento')
        };
    });
    const sum = field => employees.reduce((total, employee) => total + numeric(employee[field]), 0);
    const context = {
        schema: SCHEMA, period: { start: period.start, end: period.end },
        companyName: text(options.companyName).trim(),
        payrollName: `Nómina período ${period.start.split('-').reverse().join('/')} - ${period.end.split('-').reverse().join('/')}`,
        currency: options.currency || 'DOP', hoursPerDay,
        ...(options.projectId ? { projectId: text(options.projectId), projectName: text(options.projectName) } : {}),
        totals: {
            employeeCount: employees.length, gross: sum('bruto'), bonuses: sum('bonificaciones'),
            deductions: sum('descuentos'), loans: sum('prestamos'), net: sum('monto')
        }
    };
    // Repeat context to preserve the legacy top-level array in manual JSON.
    return { context, employees: employees.map(employee => ({ ...employee, exportContext: context })) };
}
