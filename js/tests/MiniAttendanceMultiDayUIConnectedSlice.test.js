import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';

class MemoryDB {
    constructor() {
        this.stores = new Map();
        this.updates = [];
    }
    store(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        return this.stores.get(name);
    }
    async get(name, key) {
        return this.store(name).get(key);
    }
    async getAll(name) {
        return [...this.store(name).values()];
    }
    async update(name, value) {
        this.updates.push(name);
        const key = value.key ?? value.submissionId ?? value.eventId;
        this.store(name).set(key, JSON.parse(JSON.stringify(value)));
    }
}

const SA_PROJECT = 'PRJ-OBRA-UI';
const SA_SCOPE = Object.freeze({ enabled: true, projectId: SA_PROJECT, defaultProjectId: SA_PROJECT });

function buildSubmission({
    id,
    workDate,
    deviceId = 'phone-1',
    rows = []
}) {
    return {
        schema: 'attendance-submission/v1',
        submissionId: id,
        saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-1' },
        deviceId,
        rosterVersion: 'roster-1',
        capturedAt: '2026-09-07T12:00:00.000Z',
        workDate,
        rows
    };
}

describe('MiniAttendanceImportModal — Multi-Day Two-Stage UI Resolver', () => {
    let host;
    let employees;
    let positions;
    let attendance;
    let mockApplyPlan;
    let appliedPlans;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
        appliedPlans = [];

        positions = [
            { id: 'pos-1', name: 'Albañil' },
            { id: 'pos-2', name: 'Fierrero' }
        ];
        employees = [
            { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'] },
            { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'] },
            { id: 'EMP-003', number: '003', name: 'David López', active: true, positions: ['pos-1', 'pos-2'] }
        ];
        attendance = {};

        mockApplyPlan = jest.fn(async (plan) => {
            appliedPlans.push(plan);
            const writtenKeys = [];
            for (const write of plan.writes) {
                attendance[write.key] = write.record;
                writtenKeys.push(write.key);
            }
            return {
                date: plan.date,
                appliedCount: writtenKeys.length,
                writtenKeys,
                keptCount: plan.keptKeys.length,
                keptKeys: [...plan.keptKeys]
            };
        });
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('UI reviews multiple consecutive days without closing/restarting, showing per-day progress and day-atomic apply', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const SUB_ID_1 = '11111111-1111-4111-8111-111111111111';
        const SUB_ID_2 = '22222222-2222-4222-8222-222222222222';

        // Day 1: 2026-09-06 (Ready)
        const sub1 = buildSubmission({
            id: SUB_ID_1,
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        // Day 2: 2026-09-07 (Blocked: missing identity)
        const sub2 = buildSubmission({
            id: SUB_ID_2,
            workDate: '2026-09-07',
            rows: [
                { miniLocalId: 'm2', number: '002', name: 'Carlos Gomez', normalHours: 8, overtimeHours: 0, status: 'present' } // NO saEmployeeId
            ]
        });

        await inboxStore.importSubmission(sub1, { expectedSaProjectId: SA_PROJECT });
        await inboxStore.importSubmission(sub2, { expectedSaProjectId: SA_PROJECT });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            entityScope: SA_SCOPE,
            inboxStore,
            employees,
            positions,
            attendance,
            applyPlan: mockApplyPlan,
            importMode: 'connected'
        });
        modal.mount(host);
        await modal.setImportMode('connected');

        // Select both drafts
        host.querySelector(`[data-mini-draft-checkbox="${SUB_ID_1}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${SUB_ID_2}"]`).click();

        // Consolidate
        host.querySelector('[data-mini-action="consolidate-drafts"]').click();

        // Check per-day status displayed
        const d1Status = host.querySelector('[data-mini-day-date="2026-09-06"]');
        const d2Status = host.querySelector('[data-mini-day-date="2026-09-07"]');
        expect(d1Status.textContent).toBe('Listo para aplicar');
        expect(d2Status.textContent).toBe('Conflicto entre Minis');

        // Day 1 apply button is enabled; Day 2 is disabled
        const d1ApplyBtn = host.querySelector('[data-mini-action="apply-day"][data-mini-date="2026-09-06"]');
        const d2ApplyBtn = host.querySelector('[data-mini-action="apply-day"][data-mini-date="2026-09-07"]');
        expect(d1ApplyBtn.disabled).toBe(false);
        expect(d2ApplyBtn.disabled).toBe(true);

        // Apply Day 1 without closing modal
        d1ApplyBtn.click();
        await new Promise(resolve => setTimeout(resolve, 20));

        // Day 1 becomes Applied
        const d1StatusAfter = host.querySelector('[data-mini-day-date="2026-09-06"]');
        expect(d1StatusAfter.textContent).toBe('Aplicado');
        expect(attendance['EMP-001-2026-09-06']).toBeDefined();
        // Day 2 remains unwritten
        expect(attendance['EMP-002-2026-09-07']).toBeUndefined();

        // Now resolve Day 2's identity inline in the UI
        const selectEl = host.querySelector(`[data-mini-select-employee="unresolved:${SUB_ID_2}:m2"]`);
        expect(selectEl).not.toBeNull();
        selectEl.value = 'EMP-002';
        selectEl.dispatchEvent(new Event('change'));

        const linkBtn = host.querySelector(`[data-mini-action="resolve-identity"][data-mini-item-id="unresolved:${SUB_ID_2}:m2"]`);
        linkBtn.click();

        // Day 2 is now ready!
        const d2StatusReady = host.querySelector('[data-mini-day-date="2026-09-07"]');
        expect(d2StatusReady.textContent).toBe('Listo para aplicar');
        const d2ApplyBtnReady = host.querySelector('[data-mini-action="apply-day"][data-mini-date="2026-09-07"]');
        expect(d2ApplyBtnReady.disabled).toBe(false);

        // Apply Day 2
        d2ApplyBtnReady.click();
        await new Promise(resolve => setTimeout(resolve, 20));
        const d2StatusApplied = host.querySelector('[data-mini-day-date="2026-09-07"]');
        expect(d2StatusApplied.textContent).toBe('Aplicado');
        expect(attendance['EMP-002-2026-09-07']).toBeDefined();
    });

    test('UI handles hours conflict and SA conflict inline before batch apply', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        // Existing SA has 9h for EMP-001 on 2026-09-06 (conflict)
        attendance['EMP-001-2026-09-06'] = {
            employeeId: 'EMP-001',
            date: '2026-09-06',
            present: true,
            hoursWorked: 9,
            overtimeHours: 0,
            selectedPosition: 'pos-1',
            positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }]
        };

        const SUB_ID_C1 = '33333333-3333-4333-8333-333333333333';
        const SUB_ID_C2 = '44444444-4444-4444-8444-444444444444';

        // Mini 1 has 8h, Mini 2 has 10h (with 2h overtime) on 2026-09-06
        const sub1 = buildSubmission({
            id: SUB_ID_C1,
            deviceId: 'dev-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });
        const sub2 = buildSubmission({
            id: SUB_ID_C2,
            deviceId: 'dev-2',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm2', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 2, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        await inboxStore.importSubmission(sub1, { expectedSaProjectId: SA_PROJECT });
        await inboxStore.importSubmission(sub2, { expectedSaProjectId: SA_PROJECT });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            entityScope: SA_SCOPE,
            inboxStore,
            employees,
            positions,
            attendance,
            applyPlan: mockApplyPlan,
            importMode: 'connected'
        });
        modal.mount(host);
        await modal.setImportMode('connected');

        host.querySelector(`[data-mini-draft-checkbox="${SUB_ID_C1}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${SUB_ID_C2}"]`).click();
        host.querySelector('[data-mini-action="consolidate-drafts"]').click();

        // Day status shows Conflicto entre Minis
        const dayStatus = host.querySelector('[data-mini-day-date="2026-09-06"]');
        expect(dayStatus.textContent).toBe('Conflicto entre Minis');

        // Resolve hours conflict by choosing Mini 1
        const hoursBtnMini1 = host.querySelector('[data-mini-action="resolve-hours"][data-mini-source-index="0"]');
        expect(hoursBtnMini1).not.toBeNull();
        hoursBtnMini1.click();

        // Stage A is resolved! Now Stage B detects conflict with existing SA (8h vs 9h)
        const dayStatusSa = host.querySelector('[data-mini-day-date="2026-09-06"]');
        expect(dayStatusSa.textContent).toBe('Conflicto con SA');

        const saConflictSection = host.querySelector('[data-mini-sa-conflict="EMP-001"]');
        expect(saConflictSection).not.toBeNull();

        // Choose "Usar Mini"
        const useImportedBtn = host.querySelector('[data-mini-action="use-imported"][data-mini-employee-id="EMP-001"]');
        useImportedBtn.click();

        // Day is now ready
        const dayStatusReady = host.querySelector('[data-mini-day-date="2026-09-06"]');
        expect(dayStatusReady.textContent).toBe('Listo para aplicar');

        // Apply via batch button
        const batchBtn = host.querySelector('[data-mini-action="apply-ready-days"]');
        expect(batchBtn.disabled).toBe(false);
        batchBtn.click();
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(attendance['EMP-001-2026-09-06'].hoursWorked).toBe(8);
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Aplicado');
    });
    test('UI keeps a multi-position employee blocked until a position is explicitly selected', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        const SUB_ID = '55555555-5555-4555-8555-555555555555';
        const sub = buildSubmission({
            id: SUB_ID,
            workDate: '2026-09-09',
            rows: [
                { miniLocalId: 'm3', number: '003', name: 'David López', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-003' }
            ]
        });
        await inboxStore.importSubmission(sub, { expectedSaProjectId: SA_PROJECT });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            entityScope: SA_SCOPE,
            inboxStore,
            employees,
            positions,
            attendance,
            applyPlan: mockApplyPlan,
            importMode: 'connected'
        });
        modal.mount(host);
        await modal.setImportMode('connected');
        host.querySelector(`[data-mini-draft-checkbox="${SUB_ID}"]`).click();
        host.querySelector('[data-mini-action="consolidate-drafts"]').click();

        expect(host.querySelector('[data-mini-day-date="2026-09-09"]').textContent).toBe('Conflicto con SA');
        const positionSelect = host.querySelector('[data-mini-select-position="EMP-003"]');
        const assignBtn = host.querySelector('[data-mini-action="resolve-position"][data-mini-employee-id="EMP-003"]');
        expect(positionSelect).not.toBeNull();
        expect(assignBtn).not.toBeNull();
        expect(assignBtn.disabled).toBe(true);

        positionSelect.value = 'pos-2';
        positionSelect.dispatchEvent(new Event('change'));
        expect(assignBtn.disabled).toBe(false);
        assignBtn.click();

        expect(host.querySelector('[data-mini-day-date="2026-09-09"]').textContent).toBe('Listo para aplicar');
        const plan = modal.multiDayResolver.buildDayApplyPlan('2026-09-09');
        expect(plan.writes).toHaveLength(1);
        expect(plan.writes[0].record.selectedPosition).toBe('pos-2');
    });

});
