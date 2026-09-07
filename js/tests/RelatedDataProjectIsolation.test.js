/**
 * F1.8 S0 — Related-data project inheritance (contract/test unit, NO runtime change).
 *
 * Frozen Direction decision (audit): project-related loans, advances and their
 * notes are EMBEDDED economic data and inherit canonical project ownership from
 * the employee; attendance day notes inherit from the attendance record;
 * employee/profile notes inherit the employee; payroll facts remain owned by
 * PayrollClosure. `employee.id` is identity; the employee number is display
 * only. PayrollClosure remains canonical; `employee.paymentHistory` is
 * non-authoritative; `projectPayrollConfigs` unchanged.
 *
 * What this file proves (see docs/fase-1/F1.8-related-data-inheritance.md):
 *  (1) loan + advance embedded under employee A inherit project A; same visible
 *      number in project B does not collide;
 *  (2) employee/profile note inherits the employee effective project;
 *  (3) attendance note follows the attendance record projectId/effective scope;
 *  (4) legacy child with no own project field is NOT orphan (owner stamped or
 *      default-effective);
 *  (5) Projects OFF keeps child shapes byte-stable (no own project key);
 *  (6) no child own project tag is introduced or required;
 *  (7) payroll closure project authority stays independent/canonical and a loan
 *      payment closure reference does not authorize child retagging;
 *  (8) the employee number is never used as ownership identity.
 *
 * Method: every ownership question DELEGATES to the real production helpers
 * (`effectiveProjectId`, `entityInScope`, `RecordKey`, `PayrollProjectContext`,
 * `AttendanceRecordWriter`, `NotesService`, `PayrollClosure`, `Employee`,
 * `Attendance`). The two one-line `relatedProjectOf*` aliases below are the
 * F1.8 inheritance statement itself — they read ONLY the owner, never the
 * child — not a re-implementation of scope semantics.
 *
 * S0 boundary: if any test here (or a neighboring battery) reveals actual UI
 * cross-project leakage, STOP and report — do NOT edit runtime in this unit.
 */

import { Employee } from '../modules/features/employees/Employee.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';
import {
    effectiveProjectId,
    entityInScope
} from '../modules/features/projects/EntityProjectScope.js';
import {
    getEntityScope,
    peekEntityScope,
    ACTIVE_PROJECT_LS_KEY
} from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY } from '../modules/features/projects/DefaultProject.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { upsertNote, listNotes } from '../modules/features/notes/NotesService.js';
import {
    stampAttendanceWrite,
    tombstoneAttendanceWrite
} from '../modules/features/attendance/AttendanceRecordWriter.js';
import { dedupKeyForRecord } from '../modules/services/RecordKey.js';
import { createPayrollProjectContext } from '../modules/features/payroll/PayrollProjectContext.js';
import {
    buildPayrollClosure,
    buildPayrollClosureId,
    validatePayrollClosureForScopedWrite,
    promoteLegacyPayrollClosure,
    voidPayrollClosure
} from '../modules/features/payroll/PayrollClosure.js';
import { buildPayrollPreviewFingerprint } from '../modules/features/payroll/PayrollLoanSettlement.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

// ─── F1.8 inheritance statement (aliases over the real owner resolver) ───────
// A related child has NO project key of its own: its project IS the effective
// project of its owner (employee, or attendance record for day notes).
const relatedProjectOfEmployeeChild = (ownerEmployee, scope) =>
    effectiveProjectId(ownerEmployee, scope);
const relatedProjectOfDayNote = (attendanceRecord, scope) =>
    effectiveProjectId(attendanceRecord, scope);

const PRJ_DEFAULT = 'PRJ-DEFAULT-0000';
const PRJ_A = 'PRJ-A-000000';
const PRJ_B = 'PRJ-B-000000';

const SCOPE_A = { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT };
const SCOPE_B = { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT };
const SCOPE_DEFAULT = { enabled: true, projectId: PRJ_DEFAULT, defaultProjectId: PRJ_DEFAULT };
const SCOPE_NO_DEFAULT = { enabled: true, projectId: PRJ_A, defaultProjectId: null };
const SCOPE_OFF = { enabled: false, projectId: null, defaultProjectId: null };

const PROJECTS = {
    [PRJ_DEFAULT]: { id: PRJ_DEFAULT, name: 'Mi obra', status: 'active', createdAt: 500, updatedAt: 500 },
    [PRJ_A]: { id: PRJ_A, name: 'Obra A', status: 'active', createdAt: 1000, updatedAt: 1000 },
    [PRJ_B]: { id: PRJ_B, name: 'Obra B', status: 'active', createdAt: 2000, updatedAt: 2000 }
};

function installProjectsMock() {
    indexedDBService.get.mockImplementation(async (_store, id) => PROJECTS[id] ?? null);
    indexedDBService.getAll.mockImplementation(async () => Object.values(PROJECTS));
    indexedDBService.update.mockResolvedValue(1);
}

async function primeScope(activeId) {
    if (activeId) localStorage.setItem(ACTIVE_PROJECT_LS_KEY, activeId);
    else localStorage.removeItem(ACTIVE_PROJECT_LS_KEY);
    return getEntityScope();
}

function employeeA() {
    return new Employee({
        id: 'E-A', key: 'E-A', number: '12', name: 'Juan A',
        positions: ['POS-A'], projectId: PRJ_A, notes: 'nota perfil A',
        loans: [
            {
                id: 'LOAN-A-1', principal: 1000, interestRate: 10,
                startDate: '2026-01-05', status: 'active', note: 'préstamo A',
                payments: [{ id: 'PAY-A-1', amount: 200, date: '2026-02-01', note: 'abono A' }],
                installments: [{ id: 'INST-A-1', amount: 300, dueDate: '2026-04-01' }]
            }
        ],
        advances: [{ id: 'ADV-A-1', amount: 300, interest: 0, date: '2026-03-01', note: 'adelanto A' }]
    }).toJSON();
}

function employeeB() {
    return new Employee({
        id: 'E-B', key: 'E-B', number: '12', name: 'Pedro B',
        positions: ['POS-B'], projectId: PRJ_B, notes: 'nota perfil B',
        loans: [
            {
                id: 'LOAN-B-1', principal: 500, interestRate: 0,
                startDate: '2026-01-10', status: 'active', note: 'préstamo B',
                payments: [], installments: []
            }
        ],
        advances: []
    }).toJSON();
}

function legacyEmployee() {
    return new Employee({
        id: 'E-LEGACY', key: 'E-LEGACY', number: '12', name: 'Legacy',
        positions: [], notes: 'nota legacy',
        loans: [{ id: 'LOAN-L-1', principal: 700, interestRate: 5, startDate: '2026-01-02', status: 'active', payments: [], installments: [] }],
        advances: [{ id: 'ADV-L-1', amount: 100, interest: 0, date: '2026-02-02', note: 'adelanto legacy' }]
    }).toJSON();
}

function closureRow(overrides = {}) {
    return {
        id: 7,
        _employeeId: 'E-A',
        _employeeName: 'Juan A',
        _employeePosition: 'Oficial',
        _number: '12',
        _brutoOriginal: 1200,
        _bonuses: 100,
        _deductions: 50,
        _loans: 200,
        monto: 1050,
        _bonusDetails: [],
        _deductionDetails: [],
        _loanDetails: [{ loanId: 'LOAN-A-1', amount: 200 }],
        ...overrides
    };
}

function scopedClosure(projectId, rows, extra = {}) {
    const options = { projectId, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows };
    return buildPayrollClosure({
        ...options,
        fingerprint: buildPayrollPreviewFingerprint(options),
        closedAt: 1000,
        ...extra
    });
}

beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(DEFAULT_PROJECT_LS_KEY, PRJ_DEFAULT);
    setProjectsEnabled(false);
    await getEntityScope(); // resync module-cache snapshot (survives across tests)
    installProjectsMock();
});

afterEach(() => {
    localStorage.clear();
    setProjectsEnabled(false);
    document.body.innerHTML = '';
});

describe('F1.8 (1) — embedded loans/advances inherit the owner employee project; same number in B does not collide', () => {
    test('loan + advance under employee A resolve to project A via the owner only', () => {
        const emp = employeeA();
        for (const loan of emp.loans) {
            expect(relatedProjectOfEmployeeChild(emp, SCOPE_A)).toBe(PRJ_A);
            expect(Object.prototype.hasOwnProperty.call(loan, 'projectId')).toBe(false);
        }
        for (const advance of emp.advances) {
            expect(relatedProjectOfEmployeeChild(emp, SCOPE_A)).toBe(PRJ_A);
            expect(Object.prototype.hasOwnProperty.call(advance, 'projectId')).toBe(false);
        }
        // Nested payment/installment notes ride two levels deep with no key either.
        expect(Object.prototype.hasOwnProperty.call(emp.loans[0].payments[0], 'projectId')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(emp.loans[0].installments[0], 'projectId')).toBe(false);
    });

    test('same visible number #12 in A and B yields distinct dedup keys and distinct owners', () => {
        const empA = employeeA();
        const empB = employeeB();
        expect(empA.number).toBe('12');
        expect(empB.number).toBe('12');
        expect(empA.id).not.toBe(empB.id);
        expect(relatedProjectOfEmployeeChild(empA, SCOPE_A)).toBe(PRJ_A);
        expect(relatedProjectOfEmployeeChild(empB, SCOPE_B)).toBe(PRJ_B);
        expect(dedupKeyForRecord(empA, SCOPE_A)).toBe(`project:${PRJ_A}:num:12`);
        expect(dedupKeyForRecord(empB, SCOPE_B)).toBe(`project:${PRJ_B}:num:12`);
        expect(dedupKeyForRecord(empA, SCOPE_A)).not.toBe(dedupKeyForRecord(empB, SCOPE_B));
    });

    test('payroll boundary separates the #12 fichas by employeeId, loans travel with their owner', () => {
        setProjectsEnabled(true);
        const state = {
            employees: [employeeA(), employeeB()],
            positions: [], leaders: [], attendance: {}, settings: {}
        };
        const ctxA = createPayrollProjectContext({ state, scope: SCOPE_A });
        const ctxB = createPayrollProjectContext({ state, scope: SCOPE_B });
        expect(ctxA.employees.map(e => e.id)).toEqual(['E-A']);
        expect(ctxB.employees.map(e => e.id)).toEqual(['E-B']);
        expect(ctxA.employees[0].loans.map(l => l.id)).toEqual(['LOAN-A-1']);
        expect(ctxB.employees[0].loans.map(l => l.id)).toEqual(['LOAN-B-1']);
        expect(ctxA.employees.find(e => e.id === 'E-B')).toBeUndefined();
        expect(() => ctxA.assertEmployeeInProject('E-A')).not.toThrow();
        expect(() => ctxA.assertEmployeeInProject('E-B')).toThrow();
    });
});

describe('F1.8 (2) — employee/profile note inherits the employee effective project', () => {
    test('scalar employee.notes resolves via its owner in A, B and legacy-default', () => {
        const empA = employeeA();
        const empB = employeeB();
        const legacy = legacyEmployee();
        expect(typeof empA.notes).toBe('string');
        expect(relatedProjectOfEmployeeChild(empA, SCOPE_A)).toBe(PRJ_A);
        expect(relatedProjectOfEmployeeChild(empB, SCOPE_B)).toBe(PRJ_B);
        // Legacy owner without a key resolves to the default project (F0.4 §2).
        expect(Object.prototype.hasOwnProperty.call(legacy, 'projectId')).toBe(false);
        expect(relatedProjectOfEmployeeChild(legacy, SCOPE_A)).toBe(PRJ_DEFAULT);
        expect(entityInScope(legacy, SCOPE_DEFAULT)).toBe(true);
        expect(entityInScope(legacy, SCOPE_A)).toBe(false);
    });
});

describe('F1.8 (3) — attendance day note follows the attendance record project', () => {
    test('born-with-minimal-record note stamps the active project when ON, absent when OFF', async () => {
        const offState = { employees: [{ id: 'E-A', positions: ['POS-A'] }], attendance: {} };
        const offRec = upsertNote(offState, 'E-A', '2026-06-15', 'off-note');
        expect(Object.prototype.hasOwnProperty.call(offRec, 'projectId')).toBe(false);

        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        const onState = { employees: [{ id: 'E-A', positions: ['POS-A'] }], attendance: {} };
        const born = upsertNote(onState, 'E-A', '2026-06-15', 'born-note');
        expect(born.projectId).toBe(PRJ_A);
        expect(relatedProjectOfDayNote(born, peekEntityScope())).toBe(PRJ_A);
        expect(listNotes(onState, 'E-A')).toHaveLength(1);
    });

    test('editing a note never re-tags a pre-existing record; legacy records resolve default-effective', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);

        const foreign = {
            'E-A-2026-06-15': { employeeId: 'E-A', date: '2026-06-15', notes: '', projectId: PRJ_B }
        };
        const edited = upsertNote(
            { employees: [{ id: 'E-A', positions: [] }], attendance: foreign },
            'E-A', '2026-06-15', 'edited'
        );
        expect(edited.notes).toBe('edited');
        expect(edited.projectId).toBe(PRJ_B);
        expect(relatedProjectOfDayNote(edited, peekEntityScope())).toBe(PRJ_B);

        const legacy = {
            'E-A-2026-06-16': { employeeId: 'E-A', date: '2026-06-16', notes: '' }
        };
        const legacyEdited = upsertNote(
            { employees: [{ id: 'E-A', positions: [] }], attendance: legacy },
            'E-A', '2026-06-16', 'legacy-note'
        );
        expect(Object.prototype.hasOwnProperty.call(legacyEdited, 'projectId')).toBe(false);
        expect(relatedProjectOfDayNote(legacyEdited, peekEntityScope())).toBe(PRJ_DEFAULT);
    });
});

describe('F1.8 (4) — legacy child without its own project field is not orphan', () => {
    test('legacy owner resolves default-effective and dedups inside the default namespace', () => {
        const legacy = legacyEmployee();
        expect(relatedProjectOfEmployeeChild(legacy, SCOPE_A)).toBe(PRJ_DEFAULT);
        expect(entityInScope(legacy, SCOPE_DEFAULT)).toBe(true);
        expect(dedupKeyForRecord(legacy, SCOPE_A)).toBe(`project:${PRJ_DEFAULT}:num:12`);
        // Its embedded children inherit that same owner — nothing is unowned.
        for (const loan of legacy.loans) {
            expect(relatedProjectOfEmployeeChild(legacy, SCOPE_A)).toBe(PRJ_DEFAULT);
            expect(Object.prototype.hasOwnProperty.call(loan, 'projectId')).toBe(false);
        }
    });

    test('unresolvable default stays an internal dedup namespace only; nothing is persisted onto the child', () => {
        const legacy = legacyEmployee();
        expect(dedupKeyForRecord(legacy, SCOPE_NO_DEFAULT)).toBe('legacy-unresolved:num:12');
        expect(Object.prototype.hasOwnProperty.call(legacy, 'projectId')).toBe(false);
        for (const advance of legacy.advances) {
            expect(Object.prototype.hasOwnProperty.call(advance, 'projectId')).toBe(false);
        }
    });

    test('legacy tombstone inherits the DEFAULT effective project, never the active one', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A); // active A, default PRJ_DEFAULT
        const tomb = tombstoneAttendanceWrite({ employeeId: 'E-A', date: '2026-06-15' }, 777);
        expect(tomb.projectId).toBe(PRJ_DEFAULT);
        expect(tomb.deletedAt).toBe(777);
        expect(relatedProjectOfDayNote(tomb, peekEntityScope())).toBe(PRJ_DEFAULT);
    });
});

describe('F1.8 (5) — Projects OFF keeps child shapes byte-stable with no own project key', () => {
    test('Employee/Attendance omit projectId when absent and round-trip identically', () => {
        const empJson = new Employee({ id: 'E-1', number: '12', name: 'Ana' }).toJSON();
        expect(Object.prototype.hasOwnProperty.call(empJson, 'projectId')).toBe(false);
        expect(JSON.parse(JSON.stringify(empJson))).toEqual(empJson);

        const attJson = new Attendance({ employeeId: 'E-1', date: '2026-06-15' }).toJSON();
        expect(Object.prototype.hasOwnProperty.call(attJson, 'projectId')).toBe(false);
        expect(JSON.parse(JSON.stringify(attJson))).toEqual(attJson);

        const stamped = stampAttendanceWrite({ employeeId: 'E-1', date: 'D', present: true }, 12345);
        expect(Object.prototype.hasOwnProperty.call(stamped, 'projectId')).toBe(false);
        const tombstoned = tombstoneAttendanceWrite({ employeeId: 'E-1', date: 'D' }, 12345);
        expect(Object.prototype.hasOwnProperty.call(tombstoned, 'projectId')).toBe(false);
    });

    test('RecordKey stays unprefixed and payroll context passes original references through', () => {
        expect(dedupKeyForRecord({ number: '12', id: 'E-A' }, SCOPE_OFF)).toBe('num:12');
        const state = {
            employees: [employeeA(), employeeB()],
            positions: [{ id: 'P-A' }], leaders: [{ id: 'L-A' }],
            attendance: {
                'E-A-2026-08-23': { employeeId: 'E-A', date: '2026-08-23', present: true, projectId: PRJ_A }
            },
            settings: {}
        };
        const ctx = createPayrollProjectContext({ state, scope: SCOPE_A });
        expect(ctx.isScoped).toBe(false);
        expect(ctx.employees).toBe(state.employees);
        expect(ctx.positions).toBe(state.positions);
        expect(ctx.getAttendance('E-A', '2026-08-23')).toBeDefined();
        expect(ctx.getAttendance('E-B', '2026-08-23')).toBeUndefined();
    });
});

describe('F1.8 (6) — no child own project tag is introduced or required', () => {
    test('loans, advances, nested payments/installments and notes carry no project-like key', () => {
        const emp = employeeA();
        const children = [
            ...emp.loans,
            ...emp.advances,
            ...emp.loans.flatMap(l => [...(l.payments || []), ...(l.installments || [])])
        ];
        expect(children.length).toBeGreaterThan(0);
        for (const child of children) {
            for (const key of ['projectId', 'project', 'ownerProject', 'projectTag', 'owner', 'scope']) {
                expect(Object.prototype.hasOwnProperty.call(child, key)).toBe(false);
            }
        }
        // Only the OWNER carries exactly one projectId occurrence in its JSON.
        const occurrences = (JSON.stringify(emp).match(/"projectId"/g) || []).length;
        expect(occurrences).toBe(1);
    });

    test('projectPayrollConfigs schema is unchanged: no economic child fields', () => {
        const config = createDefaultConfig(PRJ_A, {});
        expect(Object.keys(config).sort()).toEqual([
            'defaultDeductionPercentage', 'holidayFactor', 'holidays',
            'payPeriod', 'payrollDefaults', 'projectId', 'regularHoursPerDay',
            'overtimeFactor', 'schemaVersion', 'updatedAt'
        ].sort());
        for (const forbidden of ['loans', 'advances', 'notes', 'paymentHistory', 'paymentRefs', 'loanSettlementBatchId']) {
            expect(config).not.toHaveProperty(forbidden);
        }
    });
});

describe('F1.8 (7) — payroll closure authority stays independent; payment refs do not retag children', () => {
    test('same period in A and B yields distinct fingerprints and ids', () => {
        const rows = [closureRow()];
        const fpA = buildPayrollPreviewFingerprint({ projectId: PRJ_A, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows });
        const fpB = buildPayrollPreviewFingerprint({ projectId: PRJ_B, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows });
        expect(JSON.parse(fpA).projectId).toBe(PRJ_A);
        expect(JSON.parse(fpB).projectId).toBe(PRJ_B);
        expect(fpB).not.toBe(fpA);
        expect(buildPayrollClosureId(fpB, null, PRJ_B)).not.toBe(buildPayrollClosureId(fpA, null, PRJ_A));
    });

    test('scoped validation accepts the owner project and rejects cross-project writes, voids and repromotions', () => {
        const closureA = scopedClosure(PRJ_A, [closureRow()]);
        expect(closureA.schemaVersion).toBe(3);
        expect(closureA.projectId).toBe(PRJ_A);
        expect(validatePayrollClosureForScopedWrite(closureA, PRJ_A)).toBe(closureA);
        expect(() => validatePayrollClosureForScopedWrite({ ...closureA, projectId: PRJ_B }, PRJ_A)).toThrow(/proyecto/i);

        const voided = voidPayrollClosure(closureA, { voidedAt: 2000 });
        expect(voided.projectId).toBe(PRJ_A);

        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01', periodEnd: '2026-08-15',
            rows: [closureRow()], fingerprint: 'legacy-fingerprint', closedAt: 500
        });
        const promoted = promoteLegacyPayrollClosure(legacy, PRJ_DEFAULT);
        expect(promoted.projectId).toBe(PRJ_DEFAULT);
        expect(() => promoteLegacyPayrollClosure(promoted, PRJ_B)).toThrow();
    });

    test('a loan payment closure reference leaves the embedded child untouched and owned by its employee', () => {
        const emp = employeeA();
        const closureA = scopedClosure(PRJ_A, [closureRow()], {
            loanSettlementBatchId: 'PAYROLL-BATCH-DEMO-A',
            paymentRefs: [{ loanId: 'LOAN-A-1', amount: 200 }]
        });
        expect(closureA.loanSettlementBatchId).toBe('PAYROLL-BATCH-DEMO-A');
        expect(closureA.paymentRefs).toEqual([{ loanId: 'LOAN-A-1', amount: 200 }]);
        // The reference authorizes nothing on the child: no key added, owner unchanged.
        const loan = emp.loans.find(l => l.id === 'LOAN-A-1');
        expect(Object.prototype.hasOwnProperty.call(loan, 'projectId')).toBe(false);
        expect(relatedProjectOfEmployeeChild(emp, SCOPE_A)).toBe(PRJ_A);
        expect(validatePayrollClosureForScopedWrite(closureA, PRJ_A)).toBe(closureA);
    });
});

describe('F1.8 (8) — the employee number is never ownership identity', () => {
    test('same number, distinct ids and projects: ownership follows id, not number', () => {
        const empA = employeeA();
        const empB = employeeB();
        expect(relatedProjectOfEmployeeChild(empA, SCOPE_A)).not.toBe(
            relatedProjectOfEmployeeChild(empB, SCOPE_A)
        );
        // Renumbering never moves ownership: only the owner id + its projectId matter.
        const renumbered = { ...empA, number: '99' };
        expect(relatedProjectOfEmployeeChild(renumbered, SCOPE_A)).toBe(PRJ_A);
        expect(dedupKeyForRecord(renumbered, SCOPE_A)).toBe(`project:${PRJ_A}:num:99`);
    });

    test('routing is id-keyed: notes land by employeeId and closure rows carry employeeId beside the display number', () => {
        setProjectsEnabled(true);
        const state = {
            employees: [
                { id: 'E-A', number: '12', name: 'Juan A', positions: [] },
                { id: 'E-B', number: '12', name: 'Pedro B', positions: [] }
            ],
            attendance: {}
        };
        const rec = upsertNote(state, 'E-B', '2026-06-15', 'nota de Pedro');
        expect(rec.employeeId).toBe('E-B');
        expect(state.attendance['E-B-2026-06-15']).toBe(rec);
        expect(state.attendance['E-A-2026-06-15']).toBeUndefined();

        const closureA = scopedClosure(PRJ_A, [closureRow()]);
        expect(closureA.rows[0].employeeId).toBe('E-A');
        expect(closureA.rows[0].employeeNumber).toBe('12');
    });
});
