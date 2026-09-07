import {
    buildPayrollClosure,
    buildPayrollClosureId,
    isSamePayrollClosureContent,
    PAYROLL_CLOSURE_IDENTITY_KIND,
    promoteLegacyPayrollClosure,
    validatePayrollClosureSummaryForScopedRead,
    validatePayrollClosureForScopedWrite,
    voidPayrollClosure
} from '../modules/features/payroll/PayrollClosure.js';
import { resolvePayrollClosureMutation } from '../modules/features/payroll/PayrollClosureMerge.js';
import { buildPayrollPreviewFingerprint } from '../modules/features/payroll/PayrollLoanSettlement.js';

function payrollRow(overrides = {}) {
    return {
        id: 7,
        _employeeId: 'emp-7',
        _employeeName: 'Ana Pérez',
        _employeePosition: 'Operadora',
        _number: '7',
        _brutoOriginal: 1200,
        _bonuses: 100,
        _deductions: 50,
        _loans: 0,
        monto: 1250,
        _bonusDetails: [{ name: 'Productividad', amount: 100 }],
        _deductionDetails: [{ name: 'Herramientas', amount: 50 }],
        _loanDetails: [],
        ...overrides
    };
}

describe('PayrollClosure', () => {
    test('builds an immutable historical snapshot without requiring loans', () => {
        const rows = [payrollRow()];
        const closure = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            periodSource: 'configured',
            rows,
            fingerprint: 'preview-fingerprint',
            closedAt: 1234,
            closedBy: 'operator-1'
        });

        expect(closure).toMatchObject({
            schemaVersion: 2,
            id: buildPayrollClosureId('preview-fingerprint'),
            fingerprint: 'preview-fingerprint',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            periodSource: 'configured',
            status: 'closed',
            closedAt: 1234,
            closedBy: 'operator-1',
            employeeCount: 1,
            loanSettlementBatchId: null,
            paymentRefs: [],
            supersedesId: null
        });
        expect(closure.totals).toEqual({
            gross: 1200,
            bonuses: 100,
            deductions: 50,
            loans: 0,
            net: 1250
        });
        expect(closure.rows[0]).toMatchObject({
            employeeId: 'emp-7',
            employeeNumber: '7',
            employeeName: 'Ana Pérez',
            employeePosition: 'Operadora',
            gross: 1200,
            bonuses: 100,
            deductions: 50,
            loans: 0,
            net: 1250
        });

        rows[0]._employeeName = 'Nombre modificado';
        rows[0]._bonusDetails[0].name = 'Concepto modificado';
        expect(closure.rows[0].employeeName).toBe('Ana Pérez');
        expect(closure.rows[0].bonusDetails[0].name).toBe('Productividad');
    });

    test('freezes historical leaders and orders employees by historical number', () => {
        const closure = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [
                payrollRow({ _employeeId: 'emp-10', _number: '10' }),
                payrollRow({
                    _employeeId: 'emp-2',
                    _number: '2',
                    _leaderRefs: [{ id: 'leader-7', number: '7', name: 'Marta' }]
                })
            ],
            fingerprint: 'number-order'
        });

        expect(closure.rows.map(row => row.employeeNumber)).toEqual(['2', '10']);
        expect(closure.rows[0].leaderRefs).toEqual([
            { id: 'leader-7', name: 'Marta', number: '7' }
        ]);
    });

    test('uses a deterministic identity and canonical row ordering', () => {
        const first = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow({ _employeeId: 'b' }), payrollRow({ _employeeId: 'a' })],
            fingerprint: 'same-preview',
            closedAt: 100
        });
        const retry = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow({ _employeeId: 'a' }), payrollRow({ _employeeId: 'b' })],
            fingerprint: 'same-preview',
            closedAt: 200
        });

        expect(first.id).toBe(retry.id);
        expect(first.rows.map(row => row.employeeId)).toEqual(['a', 'b']);
        expect(isSamePayrollClosureContent(first, retry)).toBe(true);
    });

    test('treats nested closure details with different object key order as the same content', () => {
        const first = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()],
            fingerprint: 'canonical-details',
            adjustments: {
                bonuses: [{ employeeId: 'employee-1', detail: { concept: 'Attendance', amount: 50 } }],
                deductions: []
            }
        });
        const firestoreShapedRetry = JSON.parse(JSON.stringify(first));
        firestoreShapedRetry.adjustments = {
            deductions: [],
            bonuses: [{ detail: { amount: 50, concept: 'Attendance' }, employeeId: 'employee-1' }]
        };

        expect(isSamePayrollClosureContent(first, firestoreShapedRetry)).toBe(true);
    });

    test('voids by audit metadata without mutating the financial snapshot', () => {
        const closure = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()],
            fingerprint: 'to-void',
            closedAt: 100,
            closedBy: 'operator-1'
        });
        const snapshotBefore = JSON.stringify({ rows: closure.rows, totals: closure.totals });
        const voided = voidPayrollClosure(closure, {
            voidedAt: 200,
            voidedBy: 'operator-2',
            voidReason: 'Corrección de nómina'
        });

        expect(voided).not.toBe(closure);
        expect(voided).toMatchObject({
            status: 'voided',
            voidedAt: 200,
            voidedBy: 'operator-2',
            voidReason: 'Corrección de nómina',
            updatedAt: 200
        });
        expect(JSON.stringify({ rows: voided.rows, totals: voided.totals })).toBe(snapshotBefore);
        expect(closure.status).toBe('closed');

        const repeated = voidPayrollClosure(voided, {
            voidedAt: 300,
            voidedBy: 'different-operator',
            voidReason: 'Otro motivo'
        });
        expect(repeated).toEqual(voided);
    });

    test.each([
        [{ periodStart: '', periodEnd: '2026-08-15', rows: [payrollRow()], fingerprint: 'x' }, /período/i],
        [{ periodStart: '2026-08-01', periodEnd: '', rows: [payrollRow()], fingerprint: 'x' }, /período/i],
        [{ periodStart: '2026-08-16', periodEnd: '2026-08-15', rows: [payrollRow()], fingerprint: 'x' }, /orden/i],
        [{ periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [], fingerprint: 'x' }, /fila pagable/i],
        [{ periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [payrollRow(), payrollRow()], fingerprint: 'x' }, /duplicado/i],
        [{ periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [payrollRow({ monto: -0.01 })], fingerprint: 'x' }, /neto/i],
        [{ periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [payrollRow()], fingerprint: '' }, /identidad/i]
    ])('rejects invalid closure input %#', (input, expected) => {
        expect(() => buildPayrollClosure(input)).toThrow(expected);
    });

    test('accepts an exact zero net as a reviewable closure row', () => {
        expect(() => buildPayrollClosure({
            periodStart: '2026-08-01', periodEnd: '2026-08-15',
            rows: [payrollRow({ monto: 0 })], fingerprint: 'zero-net'
        })).not.toThrow();
    });

    test('marks corrections without overwriting the previous closure identity', () => {
        const original = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()],
            fingerprint: 'original'
        });
        const correction = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow({ monto: 1300, _bonuses: 150 })],
            fingerprint: 'correction',
            supersedesId: original.id
        });

        expect(correction.id).not.toBe(original.id);
        expect(correction.supersedesId).toBe(original.id);
    });

    test('builds schema 3 closures with normalized project-aware identity', () => {
        const rows = [payrollRow()];
        const fingerprint = buildPayrollPreviewFingerprint({
            projectId: ' project-a ',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows
        });
        const closure = buildPayrollClosure({
            projectId: ' project-a ',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows,
            fingerprint
        });

        expect(JSON.parse(fingerprint).projectId).toBe('project-a');
        expect(closure).toMatchObject({
            schemaVersion: 3,
            projectId: 'project-a',
            id: buildPayrollClosureId(fingerprint, null, 'project-a')
        });
    });

    test('validates native scoped identity and rejects coercible numeric fields', () => {
        const input = {
            projectId: 'project-a',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()]
        };
        const fingerprint = buildPayrollPreviewFingerprint(input);
        const native = buildPayrollClosure({ ...input, fingerprint, closedAt: 100 });

        expect(validatePayrollClosureForScopedWrite(native, ' project-a ')).toBe(native);
        for (const [field, value] of [
            ['schemaVersion', '3'],
            ['closedAt', '100'],
            ['updatedAt', null],
            ['undoUntil', '101'],
            ['employeeCount', '1']
        ]) {
            expect(() => validatePayrollClosureForScopedWrite({ ...native, [field]: value }, 'project-a'))
                .toThrow();
        }
        expect(() => validatePayrollClosureForScopedWrite({ ...native, projectId: 'project-b' }, 'project-a'))
            .toThrow(/proyecto/i);
        expect(() => validatePayrollClosureForScopedWrite({ ...native, identityKind: 'promoted-legacy' }, 'project-a'))
            .toThrow();
    });

    test('validates remote summary ownership without requiring closure detail', () => {
        const nativeSummary = {
            schemaVersion: 3,
            id: buildPayrollClosureId('summary-fingerprint', null, 'project-a'),
            fingerprint: 'summary-fingerprint',
            projectId: 'project-a',
            identityKind: null,
            ownershipToken: null,
            supersedesId: null
        };
        expect(validatePayrollClosureSummaryForScopedRead(nativeSummary, ' project-a '))
            .toBe(nativeSummary);

        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()],
            fingerprint: 'summary-promoted'
        });
        const promoted = promoteLegacyPayrollClosure(legacy, 'project-a');
        const { rows, totals, ...promotedSummary } = promoted;
        expect(rows).toBeDefined();
        expect(totals).toBeDefined();
        expect(validatePayrollClosureSummaryForScopedRead(promotedSummary, 'project-a'))
            .toBe(promotedSummary);

        expect(() => validatePayrollClosureSummaryForScopedRead(
            { ...nativeSummary, schemaVersion: 2 }, 'project-a'
        )).toThrow(/schemaVersion 3/i);
        expect(() => validatePayrollClosureSummaryForScopedRead(
            { ...nativeSummary, projectId: 'project-b' }, 'project-a'
        )).toThrow(/proyecto/i);
        expect(() => validatePayrollClosureSummaryForScopedRead(
            { ...nativeSummary, id: 'forged-id' }, 'project-a'
        )).toThrow();
        expect(() => validatePayrollClosureSummaryForScopedRead(
            { ...nativeSummary, ownershipToken: 'forged-token' }, 'project-a'
        )).toThrow();
        expect(() => validatePayrollClosureSummaryForScopedRead(
            { ...promotedSummary, ownershipToken: 'forged-token' }, 'project-a'
        )).toThrow();
    });

    test('makes reordered content stable within a project and distinct across projects', () => {
        const firstRow = payrollRow({ _employeeId: 'a', _number: '1' });
        const secondRow = payrollRow({ _employeeId: 'b', _number: '2' });
        const fingerprint = (projectId, rows) => buildPayrollPreviewFingerprint({
            projectId,
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows
        });
        const aFirst = fingerprint('project-a', [firstRow, secondRow]);
        const aRetry = fingerprint('project-a', [secondRow, firstRow]);
        const b = fingerprint('project-b', [firstRow, secondRow]);

        expect(aRetry).toBe(aFirst);
        expect(buildPayrollClosureId(aRetry, null, 'project-a'))
            .toBe(buildPayrollClosureId(aFirst, null, 'project-a'));
        expect(b).not.toBe(aFirst);
        expect(buildPayrollClosureId(b, null, 'project-b'))
            .not.toBe(buildPayrollClosureId(aFirst, null, 'project-a'));
    });

    test.each([undefined, '', '   ', 'legacy-unresolved:payroll-1']) (
        'rejects a non-canonical projectId for schema 3: %p',
        projectId => {
            expect(() => buildPayrollClosure({
                schemaVersion: 3,
                projectId,
                periodStart: '2026-08-01',
                periodEnd: '2026-08-15',
                rows: [payrollRow()],
                fingerprint: 'project-aware'
            })).toThrow(/projectId/i);
        }
    );

    test('preserves project ownership through deterministic corrections and voids', () => {
        const build = (rows, supersedesId = null) => {
            const options = {
                projectId: 'project-a',
                periodStart: '2026-08-01',
                periodEnd: '2026-08-15',
                rows
            };
            return buildPayrollClosure({
                ...options,
                fingerprint: buildPayrollPreviewFingerprint(options),
                supersedesId
            });
        };
        const original = build([payrollRow()]);
        const correctedRows = [payrollRow({ _bonuses: 25, monto: 1275 })];
        const correction = build(correctedRows, original.id);
        const retry = build(correctedRows, original.id);
        const voided = voidPayrollClosure(correction, { voidedAt: 200 });

        expect(correction.id).toBe(retry.id);
        expect(correction.projectId).toBe(original.projectId);
        expect(voided.projectId).toBe(original.projectId);
    });

    test('treats retagging as conflicting content and rejects it during void', () => {
        const input = {
            projectId: ' project-a ',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()]
        };
        const closure = buildPayrollClosure({
            ...input,
            fingerprint: buildPayrollPreviewFingerprint(input)
        });
        input.projectId = 'project-b';
        const retagged = {
            ...closure,
            projectId: 'project-b',
            id: buildPayrollClosureId(closure.fingerprint, closure.supersedesId, 'project-b')
        };

        expect(closure.projectId).toBe('project-a');
        expect(isSamePayrollClosureContent(closure, retagged)).toBe(false);
        expect(() => resolvePayrollClosureMutation(closure, retagged)).toThrow(/conflict/i);
        expect(() => voidPayrollClosure(retagged)).toThrow(/pertenencia/i);
    });

    test('preserves exact legacy schema, payload identity, and ID bytes', () => {
        const fingerprint = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()]
        });
        const closure = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()],
            fingerprint: 'preview-fingerprint'
        });

        expect(fingerprint.startsWith('{"periodStart"')).toBe(true);
        expect(JSON.parse(fingerprint)).not.toHaveProperty('projectId');
        expect(closure.schemaVersion).toBe(2);
        expect(closure).not.toHaveProperty('projectId');
        expect(closure).not.toHaveProperty('identityKind');
        expect(closure).not.toHaveProperty('ownershipToken');
        expect(closure.id).toBe('PAYROLL-CLOSURE-1gpn0v27ta2h5');
    });

    test('promotes legacy ownership without rewriting identity or economic history', () => {
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            periodSource: 'configured',
            rows: [payrollRow()],
            fingerprint: 'historical-fingerprint',
            closedAt: 1234,
            closedBy: 'operator-1',
            loanSettlementBatchId: 'loan-batch-1',
            paymentRefs: [{ employeeId: 'emp-7', paymentId: 'payment-1' }],
            adjustments: { bonuses: [{ id: 'bonus-1' }], deductions: [] },
            supersedesId: 'previous-closure'
        });
        const historical = JSON.parse(JSON.stringify(legacy));
        const promoted = promoteLegacyPayrollClosure(legacy, ' project-a ');

        expect(promoted).toMatchObject({
            schemaVersion: 3,
            projectId: 'project-a',
            identityKind: PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY,
            ownershipToken: expect.any(String)
        });
        expect(promoted.id).toBe(legacy.id);
        expect(promoted.fingerprint).toBe(legacy.fingerprint);
        const { schemaVersion, projectId, identityKind, ownershipToken, ...unchanged } = promoted;
        const { schemaVersion: legacySchemaVersion, ...historicalContent } = historical;
        expect(unchanged).toEqual(historicalContent);
        expect(legacy).toEqual(historical);
    });

    test('validates promoted legacy metadata and exact source payload before scoped writes', () => {
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [payrollRow()],
            fingerprint: 'historical-scoped-write',
            supersedesId: 'previous-closure'
        });
        const promoted = promoteLegacyPayrollClosure(legacy, 'project-a');

        expect(validatePayrollClosureForScopedWrite(promoted, 'project-a')).toBe(promoted);
        expect(validatePayrollClosureForScopedWrite(promoted, 'project-a', { legacySource: legacy }))
            .toBe(promoted);
        for (const candidate of [
            { ...promoted, id: 'forged-id' },
            { ...promoted, fingerprint: 'forged-fingerprint' },
            { ...promoted, supersedesId: 'forged-predecessor' },
            { ...promoted, ownershipToken: 'forged-token' },
            { ...promoted, employeeCount: '1' },
            { ...promoted, totals: { ...promoted.totals, net: 999 } },
            { ...promoted, rows: [] }
        ]) {
            expect(() => validatePayrollClosureForScopedWrite(candidate, 'project-a', { legacySource: legacy }))
                .toThrow();
        }
        expect(() => validatePayrollClosureForScopedWrite({ ...promoted, projectId: 'project-b' }, 'project-a'))
            .toThrow(/proyecto/i);
    });

    test('makes same-owner promotion idempotent and rejects retagging as conflict', () => {
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01', periodEnd: '2026-08-15',
            rows: [payrollRow()], fingerprint: 'legacy-owner'
        });
        const promoted = promoteLegacyPayrollClosure(legacy, 'project-a');
        const retry = promoteLegacyPayrollClosure(promoted, ' project-a ');
        const retagged = { ...promoted, projectId: 'project-b' };

        expect(retry).toEqual(promoted);
        expect(retry).not.toBe(promoted);
        expect(() => promoteLegacyPayrollClosure(promoted, 'project-b')).toThrow(/cambiar/i);
        expect(isSamePayrollClosureContent(promoted, retagged)).toBe(false);
        expect(() => resolvePayrollClosureMutation(promoted, retagged)).toThrow(/conflict/i);
        expect(() => voidPayrollClosure(retagged)).toThrow(/promovida/i);
    });

    test('voids promoted legacy records without changing owner or legacy identity', () => {
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01', periodEnd: '2026-08-15',
            rows: [payrollRow()], fingerprint: 'legacy-to-void'
        });
        const promoted = promoteLegacyPayrollClosure(legacy, 'project-a');
        const voided = voidPayrollClosure(promoted, { voidedAt: 200 });

        expect(voided).toMatchObject({
            status: 'voided',
            projectId: 'project-a',
            identityKind: 'promoted-legacy',
            id: legacy.id,
            fingerprint: legacy.fingerprint
        });
        expect(voided.rows).toEqual(legacy.rows);
        expect(voided.totals).toEqual(legacy.totals);
    });

    test('rejects malformed legacy records and native schema 3 misuse', () => {
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01', periodEnd: '2026-08-15',
            rows: [payrollRow()], fingerprint: 'eligible-legacy'
        });
        const nativeInput = {
            projectId: 'project-a', periodStart: '2026-08-01', periodEnd: '2026-08-15',
            rows: [payrollRow()]
        };
        const native = buildPayrollClosure({
            ...nativeInput,
            fingerprint: buildPayrollPreviewFingerprint(nativeInput)
        });

        expect(() => promoteLegacyPayrollClosure({ ...legacy, id: 'wrong' }, 'project-a'))
            .toThrow(/schema 2 válido/i);
        expect(() => promoteLegacyPayrollClosure({ ...legacy, schemaVersion: '2' }, 'project-a'))
            .toThrow(/schema 2 válido/i);
        expect(() => promoteLegacyPayrollClosure(native, 'project-a'))
            .toThrow(/schema 2 válido/i);
        expect(native).not.toHaveProperty('identityKind');
        expect(() => voidPayrollClosure(native)).not.toThrow();
    });
});
