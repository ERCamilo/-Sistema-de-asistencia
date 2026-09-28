/**
 * Cierres de nómina sin el índice compuesto desplegado.
 *
 * 1. Cada consulta paginada que arma el repositorio tiene su índice declarado en
 *    firestore.indexes.json (mismo orden de campos y dirección).
 * 2. FAILED_PRECONDITION por índice ausente llega tipado (PAYROLL_CLOSURE_INDEX_MISSING)
 *    tanto en getDocs como en onSnapshot; otros errores no se reclasifican.
 * 3. La escucha en vivo avisa una sola vez y no escala a error de consola.
 */
import fs from 'fs';
import path from 'path';
import * as firebase from '../modules/data/firebase.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    PayrollClosureRepository,
    isMissingFirestoreIndexError
} from '../modules/features/payroll/PayrollClosureRepository.js';
import { PayrollClosureLiveSync } from '../modules/features/payroll/PayrollClosureLiveSync.js';

const INDEXES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8')).indexes;
const PROJECT = 'PRJ-IDX';

// Error real del SDK web cuando falta el índice (texto abreviado, sin URL del proyecto).
function missingIndex() {
    const error = new Error('The query requires an index. You can create it here: https://console.firebase.google.com/...');
    error.code = 'failed-precondition';
    return error;
}

function indexShape(constraints) {
    const fields = [];
    for (const item of constraints) {
        if (item.type === 'where' && item.op === '==') fields.push([item.field, 'ASCENDING']);
    }
    for (const item of constraints) {
        if (item.type === 'orderBy') fields.push([item.field, item.direction === 'desc' ? 'DESCENDING' : 'ASCENDING']);
    }
    return fields;
}

function declared(shape) {
    return INDEXES.some(index => index.collectionGroup === 'payrollClosures'
        && JSON.stringify(index.fields.map(field => [field.fieldPath, field.order])) === JSON.stringify(shape));
}

describe('payrollClosures: consultas vs firestore.indexes.json', () => {
    let captured;

    beforeEach(() => {
        captured = [];
        firebase.auth.currentUser = { uid: 'user-1' };
        localStorage.setItem('asistencia_default_project_id', PROJECT);
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT, defaultProjectId: PROJECT });
        firebase.where.mockImplementation((field, op, value) => ({ type: 'where', field, op, value }));
        firebase.orderBy.mockImplementation((field, direction = 'asc') => ({ type: 'orderBy', field, direction }));
        firebase.documentId.mockImplementation(() => '__name__');
        firebase.query.mockImplementation((_ref, ...constraints) => ({ constraints }));
        firebase.getDocs.mockImplementation(async ref => { captured.push(ref.constraints); return { docs: [] }; });
    });

    afterEach(() => {
        PayrollClosureLiveSync.stop();
        setProjectsEnabled(false);
        resetEntityScope();
        localStorage.clear();
        delete firebase.auth.currentUser;
        firebase.getDocs.mockReset().mockResolvedValue({ forEach: () => {}, docs: [] });
        firebase.onSnapshot.mockReset().mockImplementation(() => jest.fn());
        jest.restoreAllMocks();
    });

    test.each([
        ['obra por defecto, sin filtro', {}],
        ['obra por defecto, con estado', { status: 'closed' }]
    ])('toda consulta paginada (%s) tiene índice declarado', async (_label, options) => {
        await PayrollClosureRepository.loadPage({ limit: 10, ...options });
        expect(captured.length).toBe(2); // nativa por obra + legacy schema 2
        for (const constraints of captured) {
            const shape = indexShape(constraints);
            expect(shape.at(-1)).toEqual(['__name__', 'DESCENDING']);
            expect(declared(shape)).toBe(true);
        }
    });

    test('la consulta en vivo coincide con el índice projectId ASC + closedAt DESC + __name__ DESC', () => {
        let liveRef;
        firebase.onSnapshot.mockImplementation((ref) => { liveRef = ref; return jest.fn(); });
        PayrollClosureRepository.subscribeRecent(() => {}, { limit: 10 });
        expect(indexShape(liveRef.constraints)).toEqual([
            ['projectId', 'ASCENDING'], ['closedAt', 'DESCENDING'], ['__name__', 'DESCENDING']
        ]);
        expect(declared(indexShape(liveRef.constraints))).toBe(true);
    });

    test('sin índice, getDocs devuelve un error tipado y en español', async () => {
        firebase.getDocs.mockRejectedValue(missingIndex());
        await expect(PayrollClosureRepository.loadPage({ limit: 10 })).rejects.toMatchObject({
            code: 'PAYROLL_CLOSURE_INDEX_MISSING',
            expectedRemoteUnavailable: true
        });
        const other = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        firebase.getDocs.mockRejectedValue(other);
        await expect(PayrollClosureRepository.loadPage({ limit: 10 })).rejects.toBe(other);
        expect(isMissingFirestoreIndexError(Object.assign(new Error('Document changed'), { code: 'failed-precondition' }))).toBe(false);
    });

    test('la escucha en vivo sin índice avisa una sola vez y no llama al onError de la app', () => {
        const listeners = [];
        firebase.onSnapshot.mockImplementation((_ref, _next, fail) => { listeners.push(fail); return jest.fn(); });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const onError = jest.fn();
        PayrollClosureLiveSync.start({ onError });
        listeners.at(-1)(missingIndex());
        PayrollClosureLiveSync.start({ onError });
        listeners.at(-1)(missingIndex());

        expect(onError).not.toHaveBeenCalled();
        expect(PayrollClosureLiveSync.unavailableReason()).toBe('PAYROLL_CLOSURE_INDEX_MISSING');
        expect(warn.mock.calls.filter(([message]) => /índice de Firestore/.test(String(message)))).toHaveLength(1);

        const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
        listeners.at(-1)(denied);
        expect(onError).toHaveBeenCalledWith(denied);
    });
});

describe('historial de nómina sin índice remoto', () => {
    test('muestra los cierres locales con el aviso en lugar de una lista vacía', async () => {
        const PayrollUI = await import('../modules/features/payroll/PayrollUI.js');
        const store = (await import('../modules/features/payroll/PayrollClosureStore.js')).default;
        const sync = (await import('../modules/features/payroll/PayrollClosureSync.js')).default;
        const typed = Object.assign(new Error('El historial remoto de nómina no está disponible todavía (falta un índice de Firestore). Se muestran los cierres guardados en este dispositivo.'), {
            code: 'PAYROLL_CLOSURE_INDEX_MISSING'
        });
        jest.spyOn(sync, 'pullPage').mockRejectedValue(typed);
        const listPage = jest.spyOn(store, 'listPage').mockResolvedValue({
            items: [{ id: 'closure-local-1', periodStart: '2026-09-01', periodEnd: '2026-09-15', status: 'closed',
                closedAt: 10, totals: {}, employeeCount: 3 }],
            nextCursor: null
        });
        jest.spyOn(store, 'getSyncStates').mockResolvedValue({});
        globalThis.currentUser = { uid: 'user-1' };
        const state = {
            employees: [], positions: [], leaders: [], attendance: {},
            settings: { companyName: 'Idx', payPeriod: { periodStart: '2026-09-01', periodLength: 15 }, schemaVersion: 20 },
            exportConfig: { periodStart: '2026-09-01', periodEnd: '2026-09-15', deductions: [], bonuses: [] },
            payrollViewMode: 'history'
        };
        PayrollUI.init({ state, services: { payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 0, neto: 0, breakdown: [] }) } },
            render: jest.fn(), saveToLocalStorage: jest.fn() });

        await PayrollUI.loadPayrollHistory({ force: true });
        const html = PayrollUI.PayrollTab();

        expect(listPage).toHaveBeenCalledTimes(1);
        expect(html).toContain('falta un índice de Firestore');
        expect(html).toContain('closure-local-1');
        delete globalThis.currentUser;
    });
});
