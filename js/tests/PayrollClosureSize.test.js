import fs from 'fs';
import path from 'path';
import {
    MAX_PAYROLL_CLOSURE_BYTES,
    PayrollClosureSizeError,
    assertPayrollClosureSize,
    estimatePayrollClosureBytes
} from '../modules/features/payroll/PayrollClosureSize.js';

const WORKFLOW_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureWorkflow.js'),
    'utf8'
);
const STORE_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureStore.js'),
    'utf8'
);
const REPOSITORY_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureRepository.js'),
    'utf8'
);

describe('Payroll closure document size', () => {
    test('measures UTF-8 bytes rather than JavaScript character count', () => {
        expect(estimatePayrollClosureBytes({ value: 'á' }))
            .toBeGreaterThan(JSON.stringify({ value: 'á' }).length);
    });

    test('rejects an oversized snapshot with a typed error', () => {
        const closure = { rows: [{ employeeName: 'x'.repeat(MAX_PAYROLL_CLOSURE_BYTES) }] };
        expect(() => assertPayrollClosureSize(closure)).toThrow(PayrollClosureSizeError);
    });

    test('checks size before workflow mutation, local persistence and remote write', () => {
        expect(WORKFLOW_SOURCE).toContain('assertPayrollClosureSize(closure)');
        expect(STORE_SOURCE).toContain('assertPayrollClosureSize(closure)');
        expect(REPOSITORY_SOURCE).toContain('assertPayrollClosureSize(closure)');
    });
});
