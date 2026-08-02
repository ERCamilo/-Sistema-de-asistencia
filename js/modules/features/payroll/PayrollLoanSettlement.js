import {
    getBalance,
    getPayrollDeductionOptions,
    LOAN_STATUS,
    recordPayment,
    restorePayment,
    round2,
    voidPayment
} from '../loans/LoansService.js';

export const PAYROLL_LOAN_UNDO_WINDOW_MS = 30_000;

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

function money(value) {
    return round2(Number(value) || 0);
}

function canonicalCharge(charge = {}) {
    return {
        kind: text(charge.kind),
        amount: money(charge.amount),
        installmentSeq: Number.isFinite(Number(charge.installmentSeq))
            ? Number(charge.installmentSeq)
            : null,
        dueDate: text(charge.dueDate)
    };
}

function canonicalLoan(loan = {}) {
    return {
        loanId: text(loan.loanId),
        selectedAmount: money(loan.selectedAmount),
        charges: (loan.selectedCharges || [])
            .map(canonicalCharge)
            .sort((a, b) => {
                const seqA = a.installmentSeq ?? Number.MAX_SAFE_INTEGER;
                const seqB = b.installmentSeq ?? Number.MAX_SAFE_INTEGER;
                return seqA - seqB || a.dueDate.localeCompare(b.dueDate) || a.amount - b.amount;
            })
    };
}

function canonicalRow(row = {}) {
    return {
        employeeId: text(row._employeeId),
        number: text(row._number ?? row.id),
        gross: money(row._brutoOriginal),
        bonuses: money(row._bonuses),
        deductions: money(row._deductions),
        loans: money(row._loans),
        net: money(row.monto),
        loanDetails: (row._loanDetails || [])
            .map(canonicalLoan)
            .sort((a, b) => a.loanId.localeCompare(b.loanId))
    };
}

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

function stableToken(value) {
    const input = String(value);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < input.length; index++) {
        const code = input.charCodeAt(index);
        first ^= code;
        first = Math.imul(first, 0x01000193);
        second ^= code + index;
        second = Math.imul(second, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function compactPreviewRow(row = {}) {
    return {
        id: row.id,
        nombre: text(row.nombre),
        monto: money(row.monto),
        _brutoOriginal: money(row._brutoOriginal),
        _bruto: money(row._bruto ?? row._brutoOriginal),
        _bonuses: money(row._bonuses),
        _deductions: money(row._deductions),
        _loans: money(row._loans),
        _employeeId: text(row._employeeId),
        _employeeName: text(row._employeeName),
        _employeePosition: text(row._employeePosition),
        _number: text(row._number ?? row.id),
        _invalidLoanNet: Boolean(row._invalidLoanNet),
        _loanDetails: clone(row._loanDetails || [])
    };
}

function chargeIdentity(periodStart, periodEnd, employeeId, loanId, charge, index) {
    const kind = text(charge?.kind || (charge?.installmentSeq ? 'installment' : 'lump'));
    const sequence = Number.isFinite(Number(charge?.installmentSeq))
        ? Number(charge.installmentSeq)
        : `${kind}-${index + 1}`;
    return [periodStart, periodEnd, employeeId, loanId, kind, sequence].map(text).join(':');
}

function paymentEntries(employees) {
    const entries = [];
    for (const employee of (employees || [])) {
        for (const loan of (employee.loans || [])) {
            for (const payment of (loan.payments || [])) {
                entries.push({ employee, loan, payment });
            }
        }
    }
    return entries;
}

function sameCharge(expected, actual) {
    return text(expected?.kind) === text(actual?.kind) &&
        money(expected?.amount) === money(actual?.amount) &&
        (Number.isFinite(Number(expected?.installmentSeq))
            ? Number(expected.installmentSeq)
            : null) === (Number.isFinite(Number(actual?.installmentSeq))
            ? Number(actual.installmentSeq)
            : null) &&
        text(expected?.dueDate) === text(actual?.dueDate);
}

/**
 * Canonical, collision-free identity for the exact payroll preview confirmed by
 * the operator. It intentionally stores the canonical JSON instead of a short
 * hash: equality is the only operation and accounting state must not rely on a
 * probabilistic collision boundary.
 */
export function buildPayrollPreviewFingerprint({ periodStart, periodEnd, rows } = {}) {
    const canonicalRows = (rows || [])
        .map(canonicalRow)
        .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.number.localeCompare(b.number));
    return JSON.stringify({
        periodStart: text(periodStart),
        periodEnd: text(periodEnd),
        rows: canonicalRows
    });
}

export function confirmPayrollPaid(fingerprint, confirmedAt = Date.now()) {
    if (!fingerprint || typeof fingerprint !== 'string') {
        throw new Error('No se puede confirmar una nómina sin vista previa');
    }
    return {
        fingerprint,
        confirmedAt: Number(confirmedAt) || Date.now()
    };
}

export function getPayrollLoanSettlementGate({
    rows = [],
    fingerprint = '',
    paidConfirmation = null,
    settledBatch = null
} = {}) {
    const hasLoans = rows.some(row => money(row?._loans) > 0);
    const invalidCount = rows.filter(row => money(row?.monto) <= 0).length;
    const payrollPaid = Boolean(
        fingerprint && paidConfirmation?.fingerprint === fingerprint
    );
    const alreadySettled = Boolean(
        settledBatch &&
        settledBatch.voided !== true &&
        settledBatch.previewFingerprint === fingerprint
    );

    let reason = null;
    if (!hasLoans) reason = 'no-loans';
    else if (invalidCount > 0) reason = 'invalid-net';
    else if (!payrollPaid) reason = 'payroll-not-confirmed';
    else if (alreadySettled) reason = 'already-settled';

    return {
        enabled: reason === null,
        hasLoans,
        invalidCount,
        payrollPaid,
        alreadySettled,
        reason
    };
}

export function buildPayrollLoanSettlementBatch({
    employees = [],
    rows = [],
    periodStart,
    periodEnd,
    createdAt = Date.now(),
    recordedBy = null,
    undoWindowMs = PAYROLL_LOAN_UNDO_WINDOW_MS
} = {}) {
    if (!periodStart || !periodEnd) throw new Error('El período de Nómina es obligatorio');
    const employeeById = new Map(employees.map(employee => [text(employee.id), employee]));
    const previewFingerprint = buildPayrollPreviewFingerprint({ periodStart, periodEnd, rows });
    const batchId = `PAYROLL-BATCH-${stableToken(previewFingerprint)}`;
    const summaries = [];
    const items = [];

    for (const row of rows) {
        if (money(row?._loans) <= 0) continue;
        if (money(row?.monto) <= 0) {
            throw new Error(`El pago neto de ${text(row?._employeeName) || 'un empleado'} no es válido`);
        }
        const employeeId = text(row._employeeId);
        const employee = employeeById.get(employeeId);
        if (!employee) throw new Error(`Empleado no encontrado: ${employeeId}`);
        const loanSummaries = [];

        for (const detail of (row._loanDetails || [])) {
            const loanId = text(detail.loanId);
            const loan = (employee.loans || []).find(entry => text(entry.id) === loanId);
            if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
            const selectedCharges = clone(detail.selectedCharges || []);
            const selectedAmount = money(
                detail.selectedAmount ?? selectedCharges.reduce((sum, charge) => sum + money(charge.amount), 0)
            );
            if (selectedAmount <= 0 || selectedCharges.length === 0) continue;
            const balanceBefore = money(detail.balance ?? getBalance(loan));
            const remainingBalance = money(Math.max(0, balanceBefore - selectedAmount));
            const chargeKeys = selectedCharges.map((charge, index) => chargeIdentity(
                text(periodStart), text(periodEnd), employeeId, loanId, charge, index
            ));
            const idempotencyKey = chargeKeys.join('|');
            const paymentId = `PAYROLL-${stableToken(idempotencyKey)}`;
            const item = {
                employeeId,
                employeeName: text(employee.name || row._employeeName),
                employeeNumber: text(employee.number || row._number),
                loanId,
                concept: text(detail.concept || loan.concept || 'Préstamo'),
                installmentMode: text(detail.installmentMode || loan.installmentMode),
                selectedCharges,
                chargeCount: selectedCharges.length,
                amount: selectedAmount,
                balanceBefore,
                remainingBalance,
                hasFuturePayment: remainingBalance > 0.01,
                chargeKeys,
                idempotencyKey,
                paymentId
            };
            items.push(item);
            loanSummaries.push({ ...item });
        }

        if (loanSummaries.length > 0) {
            const paymentAmount = money(loanSummaries.reduce((sum, loan) => sum + loan.amount, 0));
            const remainingBalance = money(loanSummaries.reduce((sum, loan) => sum + loan.remainingBalance, 0));
            summaries.push({
                employeeId,
                employeeName: text(employee.name || row._employeeName),
                employeeNumber: text(employee.number || row._number),
                loans: loanSummaries,
                paymentAmount,
                remainingBalance,
                hasFuturePayment: remainingBalance > 0.01
            });
        }
    }

    if (items.length === 0) throw new Error('No hay préstamos aplicados para registrar');
    const normalizedCreatedAt = Number(createdAt) || Date.now();
    return {
        id: batchId,
        source: 'payroll',
        periodStart: text(periodStart),
        periodEnd: text(periodEnd),
        paymentDate: new Date(normalizedCreatedAt).toISOString().slice(0, 10),
        previewFingerprint,
        createdAt: normalizedCreatedAt,
        recordedBy,
        undoUntil: normalizedCreatedAt + Math.max(0, Number(undoWindowMs) || 0),
        voided: false,
        total: money(items.reduce((sum, item) => sum + item.amount, 0)),
        employeeCount: summaries.length,
        employees: summaries,
        items,
        paymentRefs: items.map(item => ({
            employeeId: item.employeeId,
            loanId: item.loanId,
            paymentId: item.paymentId
        })),
        previewRows: rows.map(compactPreviewRow)
    };
}

function preflightPayrollBatch(employees, batch) {
    if (!batch?.id || !Array.isArray(batch.items) || batch.items.length === 0) {
        throw new Error('El lote de préstamos no es válido');
    }
    const employeeById = new Map((employees || []).map(employee => [text(employee.id), employee]));
    const operations = [];

    for (const item of batch.items) {
        const employee = employeeById.get(text(item.employeeId));
        if (!employee) throw new Error(`El empleado ${item.employeeName || item.employeeId} ya no existe`);
        const loan = (employee.loans || []).find(entry => text(entry.id) === text(item.loanId));
        if (!loan) throw new Error(`El préstamo ${item.concept || item.loanId} ya no existe`);
        const existing = (loan.payments || []).find(payment => text(payment.id) === text(item.paymentId));

        if (existing) {
            if (text(existing.payrollIdempotencyKey) !== text(item.idempotencyKey) ||
                money(existing.amount) !== money(item.amount)) {
                throw new Error(`Conflicto de identidad en el pago de ${item.concept}`);
            }
            if (!existing.voided) {
                operations.push({ kind: 'existing', employee, loan, item, payment: existing });
                continue;
            }
        }

        if (loan.status !== LOAN_STATUS.ACTIVE) {
            throw new Error(`El préstamo ${item.concept} ya no está activo`);
        }
        if (money(getBalance(loan)) !== money(item.balanceBefore)) {
            throw new Error(`El saldo de ${item.concept} cambió desde la vista previa`);
        }
        const overlapping = (loan.payments || []).find(payment =>
            !payment.voided &&
            payment.source === 'payroll' &&
            (payment.payrollChargeKeys || []).some(key => item.chargeKeys.includes(text(key)))
        );
        if (overlapping) {
            throw new Error(`Uno de los cargos de ${item.concept} ya fue pagado`);
        }
        const currentCharges = getPayrollDeductionOptions(loan, batch.periodEnd)
            .slice(0, item.selectedCharges.length);
        if (currentCharges.length !== item.selectedCharges.length ||
            currentCharges.some((charge, index) => !sameCharge(item.selectedCharges[index], charge))) {
            throw new Error(`El plan de cuotas de ${item.concept} cambió desde la vista previa`);
        }
        operations.push({
            kind: existing?.voided ? 'restore' : 'create',
            employee,
            loan,
            item,
            payment: existing || null
        });
    }
    return operations;
}

export function applyPayrollLoanSettlementBatch(employees, batch, { now = Date.now(), recordedBy } = {}) {
    const operations = preflightPayrollBatch(employees, batch);
    const firstPaymentId = batch.paymentRefs?.[0]?.paymentId;
    let createdCount = 0;
    let restoredCount = 0;
    const payments = [];

    for (const operation of operations) {
        if (operation.kind === 'existing') {
            payments.push(operation.payment);
            continue;
        }
        if (operation.kind === 'restore') {
            const payment = restorePayment(
                operation.employee,
                operation.loan.id,
                operation.payment.id,
                recordedBy ?? batch.recordedBy ?? null,
                now
            );
            payment.payrollBatchId = batch.id;
            payment.payrollPreviewFingerprint = batch.previewFingerprint;
            payment.payrollIdempotencyKey = operation.item.idempotencyKey;
            payment.payrollChargeKeys = [...operation.item.chargeKeys];
            payment.payrollPeriodStart = batch.periodStart;
            payment.payrollPeriodEnd = batch.periodEnd;
            payment.payrollBatchCreatedAt = batch.createdAt;
            payment.payrollBatchUndoUntil = batch.undoUntil;
            payment.payrollBatchTotal = batch.total;
            payment.payrollBatchEmployeeCount = batch.employeeCount;
            payment.payrollExpectedPaymentCount = batch.paymentRefs.length;
            if (operation.item.paymentId === firstPaymentId) {
                payment.payrollBatchSnapshot = clone(batch);
            }
            payment.updatedAt = Number(now) || Date.now();
            operation.loan.updatedAt = payment.updatedAt;
            operation.employee.updatedAt = payment.updatedAt;
            restoredCount++;
            payments.push(payment);
            continue;
        }
        const payment = recordPayment(operation.employee, operation.loan.id, {
            id: operation.item.paymentId,
            date: batch.paymentDate,
            amount: operation.item.amount,
            note: `Nómina ${batch.periodStart} – ${batch.periodEnd}`,
            recordedBy: recordedBy ?? batch.recordedBy ?? null,
            recordedAt: now,
            source: 'payroll',
            payrollBatchId: batch.id,
            payrollPreviewFingerprint: batch.previewFingerprint,
            payrollIdempotencyKey: operation.item.idempotencyKey,
            payrollChargeKeys: operation.item.chargeKeys,
            payrollPeriodStart: batch.periodStart,
            payrollPeriodEnd: batch.periodEnd,
            payrollBatchCreatedAt: batch.createdAt,
            payrollBatchUndoUntil: batch.undoUntil,
            payrollBatchTotal: batch.total,
            payrollBatchEmployeeCount: batch.employeeCount,
            payrollExpectedPaymentCount: batch.paymentRefs.length,
            payrollBatchSnapshot: operation.item.paymentId === firstPaymentId ? clone(batch) : null
        });
        createdCount++;
        payments.push(payment);
    }

    return { batch, payments, createdCount, restoredCount };
}

export function findPayrollLoanSettlementBatch(employees, {
    periodStart = null,
    periodEnd = null,
    previewFingerprint = null,
    batchId = null
} = {}) {
    const entries = paymentEntries(employees);
    const grouped = new Map();
    for (const entry of entries) {
        if (entry.payment.source !== 'payroll' || !entry.payment.payrollBatchId) continue;
        const key = text(entry.payment.payrollBatchId);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(entry);
    }

    const candidates = [...grouped.entries()].map(([id, linked]) => {
        const snapshotEntry = linked.find(({ payment }) => payment.payrollBatchSnapshot);
        const header = snapshotEntry?.payment.payrollBatchSnapshot;
        const metadata = linked[0].payment;
        const snapshot = header ? clone(header) : {
            id,
            source: 'payroll',
            periodStart: text(metadata.payrollPeriodStart),
            periodEnd: text(metadata.payrollPeriodEnd),
            previewFingerprint: text(metadata.payrollPreviewFingerprint),
            createdAt: Number(metadata.payrollBatchCreatedAt || metadata.recordedAt || 0),
            undoUntil: Number(metadata.payrollBatchUndoUntil || 0),
            total: money(metadata.payrollBatchTotal),
            employeeCount: Number(metadata.payrollBatchEmployeeCount || 0),
            employees: [],
            items: [],
            paymentRefs: [],
            previewRows: null
        };
        const linkedById = new Map(linked.map(entry => [text(entry.payment.id), entry]));
        const expectedIds = new Set((snapshot.paymentRefs || []).map(ref => text(ref.paymentId)));
        const expectedCount = Math.max(
            expectedIds.size,
            ...linked.map(({ payment }) => Number(payment.payrollExpectedPaymentCount || 0))
        );
        const foundExpected = expectedIds.size > 0
            ? [...expectedIds].map(idKey => linkedById.get(idKey)).filter(Boolean)
            : [...linkedById.values()];
        const missingPaymentCount = Math.max(0, expectedCount - foundExpected.length);
        const incomplete = expectedCount === 0 || missingPaymentCount > 0;
        const voided = !incomplete && foundExpected.length > 0 &&
            foundExpected.every(({ payment }) => payment.voided === true);
        return {
            ...snapshot,
            id,
            incomplete,
            missingPaymentCount,
            voided
        };
    })
        .filter(batch => !batchId || text(batch.id) === text(batchId))
        .filter(batch => !periodStart || text(batch.periodStart) === text(periodStart))
        .filter(batch => !periodEnd || text(batch.periodEnd) === text(periodEnd))
        .filter(batch => !previewFingerprint || batch.previewFingerprint === previewFingerprint)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return candidates[0] || null;
}

export function getClosedPayrollPreviewRows(employees, periodStart, periodEnd) {
    const batch = findPayrollLoanSettlementBatch(employees, { periodStart, periodEnd });
    if (!batch || batch.voided || !Array.isArray(batch.previewRows)) return null;
    return clone(batch.previewRows);
}

export function undoPayrollLoanSettlementBatch(employees, batchId, {
    now = Date.now(),
    voidedBy = null
} = {}) {
    const batch = findPayrollLoanSettlementBatch(employees, { batchId });
    if (!batch) throw new Error('No se encontró el lote de pagos');
    if (batch.incomplete) {
        throw new Error('El lote está incompleto y todavía se está sincronizando');
    }
    if (Number(now) > Number(batch.undoUntil || 0)) {
        throw new Error('El período para deshacer este lote expiró');
    }
    const entries = paymentEntries(employees);
    const targets = (batch.paymentRefs || []).map(ref => {
        const target = entries.find(({ employee, loan, payment }) =>
            text(employee.id) === text(ref.employeeId) &&
            text(loan.id) === text(ref.loanId) &&
            text(payment.id) === text(ref.paymentId)
        );
        if (!target) throw new Error('El lote está incompleto y no se puede deshacer de forma segura');
        return target;
    });
    let voidedCount = 0;
    for (const { employee, loan, payment } of targets) {
        if (payment.voided) continue;
        voidPayment(employee, loan.id, payment.id, voidedBy);
        voidedCount++;
    }
    return { batch: { ...batch, voided: true }, voidedCount };
}

export default {
    buildPayrollPreviewFingerprint,
    confirmPayrollPaid,
    getPayrollLoanSettlementGate,
    buildPayrollLoanSettlementBatch,
    applyPayrollLoanSettlementBatch,
    findPayrollLoanSettlementBatch,
    getClosedPayrollPreviewRows,
    undoPayrollLoanSettlementBatch
};
