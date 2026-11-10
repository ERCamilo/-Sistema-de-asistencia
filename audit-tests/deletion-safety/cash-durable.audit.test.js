import 'fake-indexeddb/auto';
jest.mock('../../js/modules/services/IndexedDBService.js', () =>
    jest.requireActual('actual/services/IndexedDBService.js'));
import { indexedDBService } from 'actual/services/IndexedDBService.js';
import { PettyCashStore } from '../../js/modules/features/pettycash/PettyCashStore.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
let generation = 0;
beforeEach(() => {
    localStorage.clear();
    indexedDBService.dbName = `audit-cash-retention-${++generation}`;
    indexedDBService.db = null;indexedDBService.isInitialized = false;
});
afterEach(() => { indexedDBService.db?.close(); });

const movement = (id, periodId = 'open') => ({ id, periodId, projectId: 'project-A', amount: 900,
    concept: 'Cargo ficticio', updatedAt: 100 });

test('[CAJA-IDB] un snapshot vacío no borra cargos confirmados del almacenamiento durable', async () => {
    const record = movement('m');
    await indexedDBService.batchUpdate('pettyCashMovements', [record]);
    await PettyCashStore.applyRemote('movements', []);
    expect(await indexedDBService.getAll('pettyCashMovements')).toEqual([record]);
});

test('[CAJA-IDB] una consulta por período no implica eliminar lo que no devolvió', async () => {
    const local = [movement('open-charge'), movement('closed-charge', 'closed')];
    await indexedDBService.batchUpdate('pettyCashMovements', local);
    await PettyCashStore.applyRemote('movements', [movement('new-charge')], { periodIds: ['open'] });
    expect((await indexedDBService.getAll('pettyCashMovements')).map(record => record.id).sort())
        .toEqual(['closed-charge', 'new-charge', 'open-charge']);
});

test('[CAJA-IDB] una escritura pendiente conserva el cargo durante una descarga parcial', async () => {
    const record = movement('pending');
    await indexedDBService.batchUpdate('pettyCashMovements', [record]);
    await indexedDBService.update('pettyCashOutbox', { key: 1, id: record.id, col: 'movements', op: 'save',
        data: record, status: 'pending', ts: 100 });
    await PettyCashStore.applyRemote('movements', []);
    expect(await indexedDBService.getAll('pettyCashMovements')).toEqual([record]);
});

test('[CAJA-IDB] descargar otro período no borra el historial fuera de su alcance', async () => {
    const record = movement('history', 'closed');
    await indexedDBService.batchUpdate('pettyCashMovements', [record]);
    await PettyCashStore.applyRemote('movements', [], { periodIds: ['open'] });
    expect(await indexedDBService.getAll('pettyCashMovements')).toEqual([record]);
});
