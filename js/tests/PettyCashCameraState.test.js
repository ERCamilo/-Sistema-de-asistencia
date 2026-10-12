/**
 * Caja chica → cámara nueva: estado de cada foto a partir de la cola de
 * lectura y del gasto, y el botón "Cámara" según el interruptor de Tests.
 */
import { cameraItemsState, applyReceiptFix, rereadReceipt, copyCameraDiagnostics, PettyCashTab } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';

const seed = (movements) => {
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte' }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31' }],
        movements, selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
};

describe('cameraItemsState', () => {
    afterEach(() => { state.pettyCash = null; });

    test('leyendo, leída (con datos) y por revisar (con motivo)', async () => {
        seed([
            { id: 'm1', periodId: 'p1', type: 'gasto', amount: 0 },
            { id: 'm2', periodId: 'p1', type: 'gasto', amount: 590, subtotal: 500, itbis: 90, total: 590, paidTo: 'Ferretería Sol', ncf: 'B0100000123', date: '2026-10-05', category: 'Materiales' },
            { id: 'm3', periodId: 'p1', type: 'gasto', amount: 700, subtotal: 500, itbis: 90, total: 700, date: '2026-10-05' }
        ]);
        const jobs = [
            { txId: 'm1', ocrStatus: 'processing', queueStatus: 'processing' },
            { txId: 'm2', ocrStatus: 'extracted', queueStatus: 'awaiting-review' },
            { txId: 'm3', ocrStatus: 'extracted', queueStatus: 'awaiting-review' }
        ];
        const map = await cameraItemsState(['m1', 'm2', 'm3'], { listJobs: async () => jobs });
        expect(map.get('m1').state).toBe('reading');
        expect(map.get('m2')).toMatchObject({ state: 'ok', data: { paidTo: 'Ferretería Sol', ncf: 'B0100000123', category: 'Materiales' } });
        expect(map.get('m2').data.total).toContain('590');
        expect(map.get('m3').state).toBe('review');
        expect(map.get('m3').issues[0].code).toBe('total-mismatch');
    });

    test('sin registro en la cola: con monto se trata como leída; sin gasto, leyendo', async () => {
        seed([{ id: 'm1', periodId: 'p1', type: 'gasto', amount: 250, date: '2026-10-02' }]);
        const map = await cameraItemsState(['m1', 'perdido'], { listJobs: async () => [] });
        expect(map.get('m1').state).toBe('ok');
        expect(map.get('perdido').state).toBe('reading');
    });
});

describe('applyReceiptFix (corregir desde la vista previa)', () => {
    afterEach(() => { state.pettyCash = null; });

    test('aplica el cambio al gasto, lo marca como cambiado y lo guarda (borrador: solo local)', async () => {
        seed([{ id: 'm1', periodId: 'p1', type: 'gasto', amount: 1080, subtotal: 900, itbis: 180, total: 1080, localDraft: true }]);
        const save = jest.fn().mockResolvedValue();
        const ok = await applyReceiptFix('m1', { patch: { itbis: 162 } }, { save });
        expect(ok).toBe(true);
        const mov = state.pettyCash.movements[0];
        expect(mov.itbis).toBe(162);
        expect(mov.updatedAt).toBeGreaterThan(0);
        expect(save).toHaveBeenCalledWith(mov, { local: true });
    });

    test('dar por bueno lo leído guarda el aviso aceptado (sin repetir) y pasa a leída', async () => {
        seed([{ id: 'm1', periodId: 'p1', type: 'gasto', amount: 1120, subtotal: 1000, itbis: 120, total: 1120, date: '2026-10-05', reviewAccepted: ['ncf-duplicate'] }]);
        const save = jest.fn().mockResolvedValue();
        await applyReceiptFix('m1', { accept: 'itbis-rate' }, { save });
        await applyReceiptFix('m1', { accept: 'itbis-rate' }, { save });
        expect(state.pettyCash.movements[0].reviewAccepted).toEqual(['ncf-duplicate', 'itbis-rate']);
        expect(save).toHaveBeenLastCalledWith(state.pettyCash.movements[0], { local: false });
        const map = await cameraItemsState(['m1'], { listJobs: async () => [{ txId: 'm1', ocrStatus: 'extracted' }] });
        expect(map.get('m1').state).toBe('ok');
    });

    test('gasto que ya no existe: no hace nada', async () => {
        seed([]);
        const save = jest.fn();
        expect(await applyReceiptFix('nope', { patch: { itbis: 1 } }, { save })).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });
});

describe('botón Cámara en Caja chica', () => {
    afterEach(() => { state.pettyCash = null; state.settings = {}; });

    test('por defecto usa la cámara del sistema; con la prueba activa abre la cámara nueva', () => {
        seed([]);
        state.settings = {};
        document.body.innerHTML = PettyCashTab();
        expect(document.querySelector('input[capture="environment"][onchange*="pcCameraBatchPhoto"]')).not.toBeNull();
        expect(document.querySelector('[data-app-fn="pcOpenCamera"]')).toBeNull();

        state.settings = { newReceiptCamera: true };
        document.body.innerHTML = PettyCashTab();
        expect(document.querySelector('[data-app-fn="pcOpenCamera"]')).not.toBeNull();
    });
});

describe('Configuración → Tests: cámara de facturas nueva', () => {
    test('interruptor apagado por defecto y refleja lo guardado', () => {
        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        expect(document.getElementById('newReceiptCamera').checked).toBe(false);
        document.body.innerHTML = SettingsTestsTab({ state: { settings: { newReceiptCamera: true } } });
        expect(document.getElementById('newReceiptCamera').checked).toBe(true);
    });
});

describe('Configuración → Tests: diagnóstico de la cámara', () => {
    const KEY = 'sa.pcam.diag.v1';
    afterEach(() => { localStorage.removeItem(KEY); });

    test('con la cámara activa muestra el resumen y los botones Copiar / Borrar', () => {
        localStorage.setItem(KEY, JSON.stringify([
            { t: 1, type: 'shot', origin: 'sensor', grabMs: 150, saveMs: 800, kb: 400, mime: 'image/webp' },
            { t: 2, type: 'shot', origin: 'video', grabMs: 30, saveMs: 300, kb: 200, mime: 'image/webp' },
            { t: 3, type: 'part', status: 'ok', checks: 4, checkMs: 45, bestNcc: 0.9, msToOk: 2000, counts: { ok: 2, below: 2 } }
        ]));
        document.body.innerHTML = SettingsTestsTab({ state: { settings: { newReceiptCamera: true } } });
        const card = document.querySelector('[data-pcam-diag]');
        expect(card).not.toBeNull();
        expect(card.textContent).toContain('2 fotos');
        expect(card.textContent).toContain('1 del sensor');
        expect(card.textContent).toContain('300 KB');
        expect(card.textContent).toContain('1 de 1 partes con ✓');
        expect(card.querySelector('[data-app-fn="pcCameraDiagCopy"]')).not.toBeNull();
        expect(card.querySelector('[data-app-fn="pcCameraDiagClear"]')).not.toBeNull();
    });

    test('sin datos lo dice; con la cámara apagada no aparece', () => {
        document.body.innerHTML = SettingsTestsTab({ state: { settings: { newReceiptCamera: true } } });
        expect(document.querySelector('[data-pcam-diag]').textContent).toContain('Aún no hay datos');
        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        expect(document.querySelector('[data-pcam-diag]')).toBeNull();
    });

    test('Copiar pone el diagnóstico en el portapapeles (solo números)', async () => {
        localStorage.setItem(KEY, JSON.stringify([{ t: 1, type: 'fix', code: 'itbis-rate', kind: 'apply' }]));
        const writeText = jest.fn().mockResolvedValue();
        const ok = await copyCameraDiagnostics({ clipboard: { writeText } });
        expect(ok).toBe(true);
        const text = writeText.mock.calls[0][0];
        expect(JSON.parse(text)).toMatchObject({ diag: 'camara-facturas', summary: { fixes: { count: 1 } } });
    });
});

describe('rereadReceipt (volver a leer desde la vista previa)', () => {
    afterEach(() => { state.pettyCash = null; });

    test('vuelve a poner la foto en la cola y limpia lo que dependía de la lectura anterior', async () => {
        seed([{ id: 'm1', periodId: 'p1', type: 'gasto', amount: 1484.64, ocrBoxes: { total: [1, 2, 3, 4] }, reviewAccepted: ['itbis-rate'], localDraft: true }]);
        const updateJob = jest.fn().mockResolvedValue();
        const save = jest.fn().mockResolvedValue();
        const process = jest.fn().mockResolvedValue({});
        const ok = await rereadReceipt('m1', { getJob: async () => ({ txId: 'm1', originalBlob: new Blob(['x']) }), updateJob, save, process });
        expect(ok).toBe(true);
        const mov = state.pettyCash.movements[0];
        expect(mov.ocrBoxes).toBeUndefined();
        expect(mov.reviewAccepted).toBeUndefined();
        expect(save).toHaveBeenCalledWith(mov);
        expect(updateJob).toHaveBeenCalledWith('m1', expect.objectContaining({ queueStatus: 'queued', ocrStatus: 'pending', attempts: 0, nextRetryAt: null, lastError: null }));
        expect(process).toHaveBeenCalledWith({ txIds: ['m1'] });
        // En la cola, la foto se ve como "leyendo" otra vez.
        const map = await cameraItemsState(['m1'], { listJobs: async () => [{ txId: 'm1', queueStatus: 'queued', ocrStatus: 'pending' }] });
        expect(map.get('m1').state).toBe('reading');
    });

    test('sin la foto original guardada (o sin gasto) no hace nada', async () => {
        seed([{ id: 'm1', periodId: 'p1', type: 'gasto', amount: 10 }]);
        const updateJob = jest.fn();
        const process = jest.fn();
        expect(await rereadReceipt('m1', { getJob: async () => ({ txId: 'm1' }), updateJob, save: jest.fn(), process })).toBe(false);
        expect(await rereadReceipt('nada', { getJob: async () => ({ originalBlob: new Blob(['x']) }), updateJob, save: jest.fn(), process })).toBe(false);
        expect(updateJob).not.toHaveBeenCalled();
        expect(process).not.toHaveBeenCalled();
    });
});
