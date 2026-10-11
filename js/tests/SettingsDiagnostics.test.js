import fs from 'fs';
import path from 'path';
import { StorageCard, StorageRecords, SyncCard, attachSettingsDiagnostics, getSettingsSyncStatus } from '../modules/ui/settings/SettingsDiagnostics.js';
import { SyncStatus } from '../modules/services/SyncStatus.js';
import { eventBus } from '../modules/core/Events.js';

const user = { uid: 'a', email: 'ana@example.invalid' };
const emptyQueue = { available: true, pending: 0, failed: 0 };
const measurement = { usage: 800, quota: 1000, localBytes: 123, photos: { available: true, bytes: 700, count: 2 }, audio: { available: true, bytes: 50, count: 1 } };
let cleanup;
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); SyncStatus.reset(); });
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; SyncStatus.reset(); jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([
    [{ user: null, online: true }, 'Sin sesión', 'Red: disponible'],
    [{ user, online: false, lastSyncedAt: 1 }, 'Sin conexión', 'Sesión: iniciada'],
    [{ user, online: true }, 'Aún no sincronizado', 'Red: disponible'],
    [{ user, syncing: true }, 'Sincronizando…', 'Sesión: iniciada'],
    [{ user, uploadPaused: true, lastSyncedAt: 1 }, 'Sincronización pausada', 'Subida pausada'],
    [{ user, downloadPaused: true }, 'Sincronización pausada', 'Descarga pausada'],
    [{ user, autoSyncEnabled: false }, 'Aún no sincronizado', 'Sesión: iniciada'],
    [{ user, hasError: true, lastSyncedAt: 1 }, 'Error de sincronización', 'Última escritura confirmada'],
    [{ user, queues: { available: true, pending: 2, failed: 0 }, lastSyncedAt: 1 }, 'Sincronización pendiente', '2 pendientes'],
    [{ user, queues: { available: true, pending: 0, failed: 1 }, lastSyncedAt: 1 }, 'Error de sincronización', '1 con error'],
    [{ user, lastSyncedAt: 1 }, 'Última sync confirmada', 'Última escritura confirmada']
])('presenta estados separados: %j', (status, title, detail) => {
    document.body.innerHTML = SyncCard({ queues: emptyQueue, ...status });
    expect(document.querySelector('.stg-value').textContent).toBe(title);
    expect(document.body.textContent).toContain(detail);
    expect(document.body.textContent).not.toContain('Conectado');
});

test('correo de la sesión se escapa', () => {
    document.body.innerHTML = SyncCard({ user: { email: '<img src=x onerror=alert(1)>' } });
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img');
});

test('porcentaje usa cuota del navegador, archivos y LocalStorage se muestran separados', () => {
    document.body.innerHTML = StorageCard(measurement);
    expect(document.body.textContent).toContain('80 %');
    expect(document.body.textContent).toContain('200 B disponibles');
    expect(document.body.textContent).toContain('Fotos de empleados (archivos): 700 B (2)');
    expect(document.body.textContent).toContain('Audios (archivos): 50 B (1)');
    expect(document.body.textContent).toContain('LocalStorage: 123 B');
    expect(document.body.textContent).not.toContain('5MB');
});

test('Datos conserva los conteos de IndexedDB y explica el backend de los archivos', () => {
    document.body.innerHTML = StorageRecords(true, { records: { available: true, employees: 3, positions: 2, leaders: 1, attendance: 20 } });
    expect(document.body.textContent).toContain('3 empleados');
    expect(document.body.textContent).toContain('20 registros de asistencia');
    document.body.innerHTML = StorageRecords(false);
    expect(document.body.textContent).toContain('Datos principales en LocalStorage');
    expect(document.body.textContent).toContain('fotos y los audios se conservan en IndexedDB');
});

test('cuota no disponible o uso superior a cuota no crea porcentajes negativos ni NaN', () => {
    document.body.innerHTML = StorageCard({ ...measurement, usage: null, quota: null });
    expect(document.querySelector('.stg-progress')).toBeNull();
    expect(document.body.textContent).toContain('Total no disponible');
    document.body.innerHTML = StorageCard({ ...measurement, usage: 1200 });
    expect(document.querySelector('.stg-progress-bar').style.width).toBe('100%');
    expect(document.body.textContent).toContain('0 B disponibles');
});

test('refresh de red conserva error, sincronización en curso y timestamp; no crea éxitos', () => {
    const subscriber = jest.fn(); const stop = SyncStatus.subscribe(subscriber);
    SyncStatus.refresh(); expect(SyncStatus.getLastSyncedAt()).toBeNull();
    SyncStatus.markSynced(123); SyncStatus.markError(Error('Fail')); SyncStatus.refresh();
    expect(SyncStatus.hasError()).toBe(true); expect(SyncStatus.getLastSyncedAt()).toBe(123);
    SyncStatus.markSyncing(); SyncStatus.refresh(); expect(SyncStatus.isSyncing()).toBe(true);
    expect(subscriber).toHaveBeenCalled(); stop();
});

test('ejecuta listeners reales de app.js: online/offline no anuncian guardado ni borran errores', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    const block = app.match(/window\.addEventListener\('online', \(\) => SyncStatus\.refresh\(\)\);\s*window\.addEventListener\('offline', \(\) => SyncStatus\.refresh\(\)\);/);
    expect(block).not.toBeNull();
    const handlers = {};
    new Function('window', 'SyncStatus', block[0])({ addEventListener: (event, fn) => { handlers[event] = fn; } }, SyncStatus);
    handlers.online(); expect(SyncStatus.getLastSyncedAt()).toBeNull();
    SyncStatus.markSynced(321); SyncStatus.markError(Error('Fail'));
    handlers.offline(); handlers.online(); expect(SyncStatus.hasError()).toBe(true); expect(SyncStatus.getLastSyncedAt()).toBe(321);
});

function mount() {
    document.body.innerHTML = `<div id="settings-screen"><input id="companyName" value="Guardado">${StorageCard()}${SyncCard()}</div>`;
}
test('render:complete refresca celdas, conserva texto/foco y deduplica lecturas de almacenamiento', async () => {
    jest.useFakeTimers(); mount(); const input = document.getElementById('companyName'); input.value = 'Borrador'; input.focus();
    const measureStorage = jest.fn().mockResolvedValue(measurement); const measureQueues = jest.fn().mockResolvedValue(emptyQueue);
    const context = { currentUser: user };
    cleanup = attachSettingsDiagnostics(context, { measureStorage, measureQueues }); await settle();
    for (let i = 0; i < 20; i++) eventBus.emit('render:complete', {});
    await settle();
    expect(measureStorage).toHaveBeenCalledTimes(1); expect(measureQueues).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Borrador'); expect(document.activeElement).toBe(input);
    measureQueues.mockResolvedValue({ available: true, pending: 1, failed: 0 });
    SyncStatus.markSynced(123); await settle();
    expect(document.querySelector('[data-settings-sync-card]').textContent).toContain('Sincronización pendiente');
    expect(measureStorage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(measureStorage).toHaveBeenCalledTimes(1);
    document.getElementById('settings-screen').remove(); eventBus.emit('render:complete', {});
    const calls = measureQueues.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000); expect(measureQueues).toHaveBeenCalledTimes(calls);
});

test('una medición tardía no modifica una instancia nueva', async () => {
    jest.useFakeTimers(); mount(); let complete;
    cleanup = attachSettingsDiagnostics({ currentUser: user }, { measureStorage: () => new Promise(resolve => { complete = resolve; }), measureQueues: async () => emptyQueue });
    await settle(); cleanup();
    cleanup = attachSettingsDiagnostics({ currentUser: null }, { measureStorage: async () => ({ ...measurement, usage: 456 }), measureQueues: async () => emptyQueue });
    await settle(); complete(measurement); await settle();
    expect(document.querySelector('[data-settings-storage-card] .stg-value').textContent).toBe('456 B');
    expect(document.querySelector('[data-settings-sync-card] .stg-value').textContent).toBe('Sin sesión');
});

test('cambio de cuenta, pausas y red se leen del estado actual', () => {
    const context = { currentUser: user, autoSyncEnabled: true };
    localStorage.setItem('asistencia_cloud_upload_paused', 'true');
    expect(getSettingsSyncStatus(context).uploadPaused).toBe(true);
    context.currentUser = null; expect(getSettingsSyncStatus(context).user).toBeNull();
});
