import { measureDeviceStorage, measureSyncQueues } from '../../services/DeviceDiagnostics.js';
import { SyncStatus } from '../../services/SyncStatus.js';
import { isSyncPaused, isDownloadPaused, SYNC_PAUSE_ENABLED } from '../../services/SyncPauseService.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { DOMDiff } from '../../utils/DOMDiff.js';
import { eventBus } from '../../core/Events.js';

let storageSnapshot = null;
let queues = { available: false, pending: null, failed: null };
let activeRefresh = () => Promise.resolve();

export function formatStorageBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'No disponible';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function StorageCard(stats = storageSnapshot) {
    const measured = stats?.usage != null;
    const ratio = measured && stats.quota > 0 ? Math.min(100, Math.max(0, stats.usage / stats.quota * 100)) : null;
    const tone = ratio > 80 ? 'danger' : ratio > 60 ? 'warning' : measured ? 'success' : '';
    const fileLine = (label, group) => `${label}: ${group?.available ? `${formatStorageBytes(group.bytes)} (${group.count})` : 'No disponible'}`;
    return `<div class="stg-status-cell" data-settings-storage-card>
        <span class="stg-label">Uso del sitio</span>
        <span class="stg-value ${tone}">${stats ? measured ? formatStorageBytes(stats.usage) : 'Total no disponible' : 'Calculando…'}</span>
        ${ratio !== null ? `<div class="stg-progress"><div class="stg-progress-bar ${tone}" style="width:${ratio}%;background:var(--stg-${tone});"></div></div>
            <div class="stg-diagnostic-detail">${Math.round(ratio)} % de la cuota · ${formatStorageBytes(Math.max(0, stats.quota - stats.usage))} disponibles</div>` : ''}
        <div class="stg-diagnostic-detail">Estimación del navegador: IndexedDB y caché.</div>
        ${stats ? `<div class="stg-diagnostic-detail">LocalStorage: ${formatStorageBytes(stats.localBytes)}</div>
            <div class="stg-diagnostic-detail">${fileLine('Fotos de empleados (archivos)', stats.photos)}</div>
            <div class="stg-diagnostic-detail">${fileLine('Audios (archivos)', stats.audio)}</div>` : ''}
        <button type="button" class="stg-diagnostic-refresh" data-settings-action="refresh-device-diagnostics">Actualizar estado</button>
    </div>`;
}

export function StorageSummary(stats = storageSnapshot) {
    const measured = stats?.usage != null;
    const ratio = measured && stats.quota > 0 ? stats.usage / stats.quota * 100 : null;
    const tone = ratio > 80 ? 'danger' : ratio > 60 ? 'warning' : measured ? 'success' : '';
    return `<div class="stg-status-cell stg-storage-summary" data-settings-storage-card data-settings-storage-summary>
        <span class="stg-label">Almacenamiento</span>
        <span class="stg-value ${tone}">${stats ? measured ? `${formatStorageBytes(stats.usage)} usados` : 'Total no disponible' : 'Calculando…'}</span>
        ${ratio !== null ? `<div class="stg-diagnostic-detail">${formatStorageBytes(Math.max(0, stats.quota - stats.usage))} disponibles · ${Math.min(100, Math.round(ratio))} % usado</div>` : ''}
    </div>`;
}

export function StorageRecords(useIndexedDB, stats = storageSnapshot) {
    const records = stats?.records;
    return `<div id="indexeddb-stats" class="stg-diagnostic-detail">
        Datos principales en ${useIndexedDB ? 'IndexedDB' : 'LocalStorage'}. Las fotos y los audios se conservan en IndexedDB; su espacio aparece en el detalle de almacenamiento.
        ${useIndexedDB ? records?.available ? `<div>En IndexedDB: ${records.employees} empleados · ${records.positions} puestos · ${records.leaders} líderes · ${records.attendance} registros de asistencia</div>` : `<div>${stats ? 'Conteos de IndexedDB no disponibles.' : 'Calculando conteos de IndexedDB…'}</div>` : ''}
    </div>`;
}

function syncPresentation(status) {
    const user = status.user;
    const online = status.online !== false;
    const q = status.queues || queues;
    let text = 'Sin sesión', tone = '';
    if (user) {
        if (!online) { text = 'Sin conexión'; tone = 'warning'; }
        else if (status.uploadPaused || status.downloadPaused) { text = 'Sincronización pausada'; tone = 'warning'; }
        else if (status.hasError || q.failed > 0) { text = 'Error de sincronización'; tone = 'danger'; }
        else if (status.syncing) { text = 'Sincronizando…'; }
        else if (q.pending > 0) { text = 'Sincronización pendiente'; tone = 'warning'; }
        else if (status.lastSyncedAt != null) { text = 'Última sync confirmada'; tone = 'success'; }
        else { text = 'Aún no sincronizado'; tone = 'warning'; }
    }
    return { text, tone, user, online, q };
}

export function SyncSummary(status = {}) {
    const { text, tone } = syncPresentation(status);
    return `<small class="settings-sync-summary ${tone}" data-settings-sync-summary>${text}</small>`;
}

export function SyncCard(status = {}) {
    const { text, tone, user, online, q } = syncPresentation(status);
    const pauses = [status.uploadPaused ? 'Subida pausada' : '', status.downloadPaused ? 'Descarga pausada' : ''].filter(Boolean);
    return `<div class="stg-status-cell" data-settings-sync-card>
        <span class="stg-label">Sincronización</span>
        <span class="stg-value ${tone}">${text}</span>
        <div class="stg-diagnostic-detail">Sesión: ${user ? 'iniciada' : 'sin iniciar'}</div>
        <div class="stg-diagnostic-detail">Red: ${online ? 'disponible' : 'sin conexión'}</div>
        ${user ? `<div class="stg-diagnostic-detail">${escapeHTML(user.email || '')}</div>
            <div class="stg-diagnostic-detail">Cola de datos: ${q.available ? `${q.pending} pendientes · ${q.failed} con error` : 'No disponible'}</div>
            ${status.lastSyncedAt != null ? `<div class="stg-diagnostic-detail">Última escritura confirmada: ${escapeHTML(new Date(status.lastSyncedAt).toLocaleString('es-DO'))}</div>` : ''}
            ${pauses.length ? `<div class="stg-diagnostic-detail">${pauses.join(' · ')}</div>` : ''}
            <div class="stg-diagnostic-detail">La red disponible no confirma acceso a la nube.</div>` : '<div class="stg-diagnostic-detail">Inicia sesión con Google para sincronizar.</div>'}
    </div>`;
}

export function getSettingsSyncStatus(context) {
    return {
        user: context.currentUser,
        online: globalThis.navigator?.onLine !== false,
        uploadPaused: SYNC_PAUSE_ENABLED && isSyncPaused(),
        downloadPaused: isDownloadPaused(),
        hasError: SyncStatus.hasError(), syncing: SyncStatus.isSyncing(), lastSyncedAt: SyncStatus.getLastSyncedAt(), queues
    };
}

export function refreshDeviceSettingsDiagnostics() { return activeRefresh(true); }

// Patch only diagnostic cells. No global render and no read of photos on every frame.
export function attachSettingsDiagnostics(context, {
    measureStorage = measureDeviceStorage, measureQueues = measureSyncQueues,
    doc = document, win = window, now = Date.now, bus = eventBus
} = {}) {
    storageSnapshot = null; queues = { available: false, pending: null, failed: null };
    let disposed = false, timer = null, storageFlight = null, queueFlight = null;
    let storageAt = -Infinity, queueAt = -Infinity, visible = false;
    const mounted = () => !!doc.querySelector('#settings-screen [data-settings-storage-card], #settings-screen [data-settings-sync-card], #settings-screen [data-settings-sync-summary]');
    const paint = () => {
        if (disposed || !mounted()) return;
        const storageCells = doc.querySelectorAll('[data-settings-storage-card]');
        const syncCell = doc.querySelector('[data-settings-sync-card]');
        const syncSummary = doc.querySelector('[data-settings-sync-summary]');
        const recordsCell = doc.getElementById('indexeddb-stats');
        storageCells.forEach(cell => DOMDiff.patchSelf(cell, cell.hasAttribute('data-settings-storage-summary') ? StorageSummary() : StorageCard()));
        if (syncCell) DOMDiff.patchSelf(syncCell, SyncCard(getSettingsSyncStatus(context)));
        if (syncSummary) DOMDiff.patchSelf(syncSummary, SyncSummary(getSettingsSyncStatus(context)));
        if (recordsCell) DOMDiff.patchSelf(recordsCell, StorageRecords(context.state?.useIndexedDB));
    };
    const refresh = async (force = false, forceQueues = force) => {
        if (disposed || !mounted()) return;
        paint();
        const work = [];
        if (!storageFlight && (force || now() - storageAt >= 30000)) {
            storageAt = now();
            storageFlight = Promise.resolve().then(measureStorage).then(result => {
                if (!disposed) storageSnapshot = result;
            }).catch(() => {
                if (!disposed) storageSnapshot = { usage: null, localBytes: null };
            }).finally(() => { storageFlight = null; paint(); });
        }
        if (!queueFlight && (forceQueues || now() - queueAt >= 5000)) {
            queueAt = now();
            queueFlight = Promise.resolve().then(measureQueues).then(result => {
                if (!disposed) queues = result;
            }).catch(() => { if (!disposed) queues = { available: false }; })
                .finally(() => { queueFlight = null; paint(); });
        }
        if (storageFlight) work.push(storageFlight);
        if (queueFlight) work.push(queueFlight);
        await Promise.all(work);
    };
    const onRender = () => {
        const entered = mounted() && !visible;
        visible = mounted();
        if (!visible) { clearInterval(timer); timer = null; return; }
        if (!timer) timer = setInterval(() => refresh(), 5000);
        refresh(entered);
    };
    const onNetwork = () => refresh(false, true);
    const unsubscribe = SyncStatus.subscribe(() => refresh(false, true));
    const unsubscribeRender = bus.on('render:complete', onRender);
    win.addEventListener('online', onNetwork); win.addEventListener('offline', onNetwork);
    activeRefresh = refresh;
    onRender();
    return () => {
        disposed = true; clearInterval(timer); unsubscribe();
        unsubscribeRender();
        win.removeEventListener('online', onNetwork); win.removeEventListener('offline', onNetwork);
        if (activeRefresh === refresh) activeRefresh = () => Promise.resolve();
    };
}
