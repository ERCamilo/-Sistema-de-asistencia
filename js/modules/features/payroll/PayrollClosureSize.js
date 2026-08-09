// Firestore documents are capped at 1 MiB. Keep headroom for field names,
// serialization differences and future schema metadata.
export const MAX_PAYROLL_CLOSURE_BYTES = 850 * 1024;

export class PayrollClosureSizeError extends Error {
    constructor(actualBytes, maxBytes = MAX_PAYROLL_CLOSURE_BYTES) {
        super('La nómina contiene demasiado detalle para guardarse de forma segura. Reduce el período o los ajustes incluidos.');
        this.name = 'PayrollClosureSizeError';
        this.actualBytes = actualBytes;
        this.maxBytes = maxBytes;
    }
}

export function estimatePayrollClosureBytes(closure) {
    let bytes = 0;
    for (const character of JSON.stringify(closure ?? null)) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x7f) bytes += 1;
        else if (codePoint <= 0x7ff) bytes += 2;
        else if (codePoint <= 0xffff) bytes += 3;
        else bytes += 4;
    }
    return bytes;
}

export function assertPayrollClosureSize(closure, maxBytes = MAX_PAYROLL_CLOSURE_BYTES) {
    const actualBytes = estimatePayrollClosureBytes(closure);
    if (actualBytes > maxBytes) throw new PayrollClosureSizeError(actualBytes, maxBytes);
    return actualBytes;
}

export default assertPayrollClosureSize;
