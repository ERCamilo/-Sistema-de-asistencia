import {
    isSamePayrollClosureContent,
    PAYROLL_CLOSURE_STATUS
} from './PayrollClosure.js';

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

export class PayrollClosureConflictError extends Error {
    constructor(existing, incoming) {
        super(`Payroll closure content conflict: ${incoming?.id || existing?.id || 'unknown'}`);
        this.name = 'PayrollClosureConflictError';
        this.existing = clone(existing);
        this.incoming = clone(incoming);
    }
}

/**
 * Shared monotonic merge contract for IndexedDB and Firestore.
 * A closure can advance from closed to voided, but never be revived or have
 * its original audit actor replaced by a retry from another device.
 */
export function resolvePayrollClosureMutation(existing, incoming) {
    if (!existing) return { write: true, value: clone(incoming) };
    if (!isSamePayrollClosureContent(existing, incoming)) {
        throw new PayrollClosureConflictError(existing, incoming);
    }
    if (existing.status === PAYROLL_CLOSURE_STATUS.VOIDED ||
        incoming.status === existing.status) {
        return { write: false, value: clone(existing) };
    }
    return { write: true, value: clone(incoming) };
}

export default resolvePayrollClosureMutation;
