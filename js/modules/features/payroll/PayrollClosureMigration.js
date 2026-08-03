import { buildPayrollClosure, voidPayrollClosure } from './PayrollClosure.js';
import payrollClosureStore from './PayrollClosureStore.js';
import { listPayrollLoanSettlementBatches } from './PayrollLoanSettlement.js';
import { assertPayrollClosureSize, PayrollClosureSizeError } from './PayrollClosureSize.js';

export const LEGACY_PAYROLL_CLOSURE_SOURCE = 'legacy-payroll-loan-batch';

export function buildLegacyPayrollClosures(employees = []) {
    const closures = [];
    const skipped = [];
    const batches = listPayrollLoanSettlementBatches(employees);
    for (const batch of batches) {
        if (batch.closureId) {
            skipped.push({ batchId: batch.id, reason: 'already-linked' });
            continue;
        }
        if (batch.incomplete) {
            skipped.push({ batchId: batch.id, reason: 'incomplete' });
            continue;
        }
        if (!batch.previewFingerprint || !batch.periodStart || !batch.periodEnd ||
            !Array.isArray(batch.previewRows) || batch.previewRows.length === 0) {
            skipped.push({ batchId: batch.id, reason: 'missing-snapshot' });
            continue;
        }
        try {
            const undoWindowMs = Math.max(0, Number(batch.undoUntil || 0) - Number(batch.createdAt || 0));
            let closure = buildPayrollClosure({
                periodStart: batch.periodStart,
                periodEnd: batch.periodEnd,
                periodSource: 'legacy',
                rows: batch.previewRows,
                fingerprint: batch.previewFingerprint,
                closedAt: batch.createdAt,
                closedBy: batch.recordedBy ?? null,
                undoWindowMs,
                loanSettlementBatchId: batch.id,
                paymentRefs: batch.paymentRefs || []
            });
            closure = { ...closure, migrationSource: LEGACY_PAYROLL_CLOSURE_SOURCE };
            if (batch.voided) {
                closure = voidPayrollClosure(closure, {
                    voidedAt: batch.voidedAt || batch.createdAt,
                    voidedBy: batch.voidedBy ?? null,
                    voidReason: 'Lote histórico anulado'
                });
            }
            assertPayrollClosureSize(closure);
            closures.push(closure);
        } catch (error) {
            skipped.push({
                batchId: batch.id,
                reason: error instanceof PayrollClosureSizeError ? 'oversized' : 'invalid-snapshot'
            });
        }
    }
    return { closures, skipped };
}

export async function migrateLegacyPayrollClosures(employees = [], {
    store = payrollClosureStore,
    schemaVersion = null
} = {}) {
    const { closures, skipped } = buildLegacyPayrollClosures(employees);
    let migrated = 0;
    let existing = 0;
    for (const closure of closures) {
        if (await store.getById(closure.id)) {
            existing++;
            continue;
        }
        await store.saveWithEmployees(closure, [], { enqueueCloud: true, schemaVersion });
        migrated++;
    }
    return { migrated, existing, skipped };
}

export default migrateLegacyPayrollClosures;
