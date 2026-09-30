import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceConsolidationStore } from '../modules/services/MiniAttendanceConsolidationStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import {
    createMultiDayAttendanceResolver,
    isSafeBulkSaConflict
} from '../modules/features/attendance/MultiDayAttendanceResolver.js';

class MemoryDB {
    constructor() { this.stores = new Map(); }
    store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
    async get(name, key) { return this.store(name).get(key); }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) { this.store(name).set(value.key ?? value.submissionId, JSON.parse(JSON.stringify(value))); }
    async delete(name, key) { this.store(name).delete(key); }
}

const SA_PROJECT = 'PRJ-OBRA-EXC';
const SA_SCOPE = Object.freeze({ enabled: true, projectId: SA_PROJECT, defaultProjectId: SA_PROJECT });
const wait = () => new Promise(resolve => setTimeout(resolve, 15));

function buildSubmission({ id, workDate, deviceId = 'mini-a', sourceId = null, rows = [] }) {
    return {
        schema: 'attendance-submission/v1', submissionId: id, saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: sourceId || deviceId }, deviceId,
        rosterVersion: 'roster-1', capturedAt: '2026-09-10T12:00:00.000Z', workDate, rows
    };
}

function baseEmployees() {
    return [
        { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
        { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
        { id: 'EMP-003', number: '003', name: 'David López', active: true, positions: ['pos-1', 'pos-2'], projectId: SA_PROJECT }
    ];
}

function basePositions() {
    return [{ id: 'pos-1', name: 'Albañil' }, { id: 'pos-2', name: 'Fierrero' }];
}

function makeModal({ db, employees, positions, attendance, applyPlan }) {
    return new MiniAttendanceImportModal({
        saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
        inboxStore: new AttendanceSubmissionInboxStore({ db }),
        consolidationStore: new MiniAttendanceConsolidationStore({ db, now: () => 1000 }),
        employees, positions, attendance, applyPlan, importMode: 'connected'
    });
}


async function openConnected(host, { attendance = {}, submissions }) {
    const db = new MemoryDB();
    const inbox = new AttendanceSubmissionInboxStore({ db });
    for (const [submission, metadata] of submissions) {
        await inbox.importSubmission(submission, { expectedSaProjectId: SA_PROJECT, metadata });
    }
    const modal = makeModal({ db, employees: baseEmployees(), positions: basePositions(), attendance, applyPlan: jest.fn(async () => ({})) });
    modal.mount(host);
    await modal.setImportMode('connected');
    await modal.openConnectedInbox();
    for (const [submission] of submissions) {
        host.querySelector(`[data-mini-draft-checkbox="${submission.submissionId}"]`).click();
    }
    await modal.consolidateSelectedDrafts();
    return modal;
}

const row = (n, hours, extra = {}) => ({ miniLocalId: `m${n}`, number: n, name: `N${n}`, normalHours: hours, overtimeHours: 0, status: 'present', saEmployeeId: `EMP-${n}`, ...extra });

describe('Resolutor Conectados — lenguaje visual de «Duplicados»', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });

    test('resumen en tarjetas (cifra y etiqueta) que conservan el texto «Etiqueta: N»', async () => {
        const date = '2026-09-06';
        await openConnected(host, { submissions: [
            [buildSubmission({ id: '71111111-1111-4111-8111-111111111111', workDate: date, deviceId: 'mini-a', rows: [row('001', 8), row('002', 8)] }), { sourcePeerName: 'Mini Capataz' }],
            [buildSubmission({ id: '72222222-2222-4222-8222-222222222222', workDate: date, deviceId: 'mini-b', rows: [row('001', 8), row('002', 4)] }), { sourcePeerName: 'Mini Cuadrilla B' }]
        ] });
        const tiles = [...host.querySelectorAll('[data-mini-executive-status] .mini-summary-tile')];
        expect(tiles.map(t => t.textContent)).toEqual(expect.arrayContaining(['Total: 2', 'Resueltos: 1']));
        expect(tiles[0].querySelector('.mini-summary-value').textContent).toBe('2');
        expect(tiles[0].querySelector('.mini-summary-label').textContent).toBe('Total');
    });

    test('cada trabajador es una tarjeta con avatar, ficha y fuentes como tarjetas elegibles', async () => {
        const date = '2026-09-06';
        await openConnected(host, { submissions: [
            [buildSubmission({ id: '73333333-3333-4333-8333-333333333333', workDate: date, deviceId: 'mini-a', rows: [row('002', 8)] }), { sourcePeerName: 'Mini Capataz' }],
            [buildSubmission({ id: '74444444-4444-4444-8444-444444444444', workDate: date, deviceId: 'mini-b', rows: [row('002', 4)] }), { sourcePeerName: 'Mini Cuadrilla B' }]
        ] });
        const card = host.querySelector('.mini-consolidation-row');
        expect(card.querySelector('.mini-row-head .mini-row-avatar').textContent).toBe('N');
        expect(card.querySelector('.mini-row-meta .mini-row-number').textContent).toBe('#002');
        expect(card.querySelector('.mini-row-hours').textContent).toBe('Por decidir');
        const choices = [...card.querySelectorAll('[data-mini-action="resolve-hours"].mini-source-choice')];
        expect(choices.map(c => c.getAttribute('aria-label'))).toEqual(['Mini Capataz: 8h', 'Mini Cuadrilla B: 4h']);
        expect(choices[1].querySelector('.mini-source-choice-value').textContent).toBe('4h');
        expect(card.querySelector('.mini-control-label').textContent).toBe('¿Qué Mini tiene la asistencia correcta?');
    });
});
