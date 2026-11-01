// Release lifecycle. Preparation never saves, activates or reloads the page.
function createReleaseManager(options) {
    const policy = options.policy;
    const key = name => `${options.prefix}:${name}`;
    const read = name => { try { return options.read(key(name)); } catch (_) { return null; } };
    const write = (name, value) => { try { options.write(key(name), value); return true; } catch (_) { return false; } };
    let booted = false, dialogOpen = false, applying = false, applyGeneration = 0;
    let incoming = null, queuedIncoming = null, flight = null, preparationFlight = null;
    let manualCheck = false, deferred = read('deferredVersion'), pendingNews = [];
    let lastCheckedAt = Number(read('lastUpdateCheck')) || 0;
    let operationController = null, operation = null;
    let preparation = { phase: 'idle', version: null, handle: null, message: '' };
    const getState = () => ({ ...preparation, busy: applying, operation });
    const notify = () => options.updateState?.(getState());
    const report = (error, context) => { try { options.reportError?.(error, context); } catch (_) {} };
    function progress(message) { options.status(message); notify(); }
    function cancelOperation() { applyGeneration++; operationController?.abort(); }
    function closeNews() {
        dialogOpen = false;
        const seen = read('lastSeenVersion');
        if (!seen || policy.compareVersions(policy.APP_VERSION, seen) > 0) write('lastSeenVersion', policy.APP_VERSION);
        pendingNews = [];
    }
    function closeUpdate(offeredVersion) {
        dialogOpen = false; cancelOperation();
        deferred = offeredVersion; write('deferredVersion', deferred);
        if (queuedIncoming) { incoming = queuedIncoming; queuedIncoming = null; void prepareIncoming(); }
    }
    function prepareIncoming(force = false) {
        if (!incoming || !options.prepareRelease) return Promise.resolve(null);
        const offered = incoming;
        if (!force && preparation.version === offered.version && preparation.phase === 'ready') return Promise.resolve(preparation.handle);
        if (!force && preparationFlight?.version === offered.version) return preparationFlight.promise;
        preparation = { phase: 'preparing', version: offered.version, handle: null, message: 'Preparando actualización en segundo plano…' };
        progress(preparation.message);
        const promise = Promise.resolve().then(() => options.prepareRelease(offered.version, {
            force, onProgress: event => {
                if (incoming !== offered || preparation.phase !== 'preparing') return;
                preparation.message = event.message || 'Descargando archivos de la aplicación…';
                if (!applying) progress(preparation.message);
            }
        })).then(handle => {
            if (incoming !== offered) return null;
            if (!handle || handle.version !== offered.version) throw new Error('Unexpected prepared version');
            preparation = { phase: 'ready', version: offered.version, handle, message: 'Actualización lista. Puedes continuar trabajando o actualizar ahora.' };
            if (!applying) progress(preparation.message);
            flush(); return handle;
        }).catch(error => {
            if (incoming === offered) {
                report(error, 'preparar actualización');
                preparation = { phase: 'error', version: offered.version, handle: null,
                    message: error?.code === 'timeout' ? 'La preparación tardó demasiado. Puedes reintentar o recargar.'
                        : 'No se pudo preparar la actualización. Revisa tu conexión y reintenta.' };
                if (!applying) progress(preparation.message);
            }
            return null;
        }).finally(() => { if (preparationFlight?.promise === promise) preparationFlight = null; });
        preparationFlight = { version: offered.version, promise }; return promise;
    }
    function mayReload() {
        if (options.canReload && !options.canReload()) {
            const error = new Error('Guarda o cierra los cambios pendientes antes de recargar.');
            error.code = 'changes-pending'; throw error;
        }
    }
    async function runOperation(kind, action) {
        if (applying) return;
        applying = true; operation = kind; operationController = new AbortController();
        const controller = operationController, generation = ++applyGeneration;
        const current = () => generation === applyGeneration && !controller.signal.aborted;
        let saved = false;
        try {
            progress('Guardando datos…');
            await options.beforeReload();
            if (!current()) return;
            saved = true; mayReload();
            await action({ signal: controller.signal, current });
            if (!current()) return;
            mayReload(); progress('Reiniciando aplicación…'); options.reload();
        } catch (error) {
            if (!current()) return;
            report(error, kind === 'repair' ? 'reparar interfaz' : 'actualizar aplicación');
            const message = error?.code === 'changes-pending' ? error.message
                : saved ? 'No se pudo actualizar. Revisa tu conexión y reintenta, o recarga; tus datos guardados se conservan.'
                : 'No se pudo actualizar. Guarda o cierra los cambios y vuelve a intentarlo.';
            if (kind === 'update' && options.prepareRelease) preparation = { ...preparation, phase: 'error', handle: null, message };
            progress(message);
        } finally {
            if (operationController === controller) operationController = null;
            applying = false; operation = null; notify();
        }
    }
    async function apply() {
        if (!incoming || applying) return;
        if (options.prepareRelease && preparation.phase !== 'ready') return prepareIncoming(true);
        const handle = preparation.handle;
        return runOperation('update', async ({ signal, current }) => {
            if (options.activateRelease) {
                progress('Activando actualización…'); await options.activateRelease(handle, { signal });
            } else {
                progress('Descargando actualización…'); await options.prepareUpdate?.();
            }
            if (!current()) return;
        });
    }
    async function repair() {
        return runOperation('repair', async ({ signal, current }) => {
            progress('Preparando la reparación…');
            const release = await options.fetchRelease();
            if (!current()) return;
            if (!policy.isReleaseManifest(release)) throw new Error('Invalid release');
            const handle = await options.prepareRelease(release.version, {
                force: true, signal, onProgress: event => { if (current()) progress(event.message || 'Renovando archivos de la interfaz…'); }
            });
            if (!current()) return;
            mayReload(); progress('Activando la interfaz renovada…');
            await options.activateRelease(handle, { signal });
        });
    }
    const reloadSafely = () => runOperation('reload', async () => {});
    function showNews(manual = false) {
        if (dialogOpen) return;
        const entries = manual ? policy.CHANGELOG : pendingNews;
        if (!entries.length || (!manual && !options.canShow())) return;
        dialogOpen = options.show('news', entries, policy.APP_VERSION, closeNews, apply);
    }
    function showUpdate(manual = false) {
        if (dialogOpen || !incoming || (!manual && (!options.canShow() || (options.prepareRelease && preparation.phase !== 'ready')))) return;
        if (!manual && !policy.shouldPromptForUpdate({ hasController: true, currentVersion: policy.APP_VERSION,
            availableVersion: incoming.version, lastPromptedVersion: deferred })) return;
        const offered = incoming;
        dialogOpen = options.show('update', policy.getUnseenReleases(policy.APP_VERSION, offered.changelog),
            offered.version, () => closeUpdate(offered.version), apply);
        notify();
    }
    function flush() { if (pendingNews.length) showNews(); else showUpdate(); }
    function boot() {
        if (booted) return; booted = true;
        const seen = read('lastSeenVersion');
        if (!seen || !/^\d+\.\d+\.\d+$/.test(seen)) write('lastSeenVersion', policy.APP_VERSION);
        else pendingNews = policy.getUnseenReleases(seen, policy.CHANGELOG);
        flush();
    }
    async function performCheck() {
        try {
            const value = await options.fetchRelease();
            if (!policy.isReleaseManifest(value)) throw new Error('Invalid release');
            if (policy.compareVersions(value.version, policy.APP_VERSION) <= 0) {
                if (manualCheck) options.status(`Ya tienes la versión actual (v${policy.APP_VERSION}).`);
                return;
            }
            if (incoming && policy.compareVersions(value.version, incoming.version) < 0) { showUpdate(manualCheck); return; }
            if (incoming && (dialogOpen || applying) && value.version !== incoming.version) { queuedIncoming = value; return; }
            const changed = incoming?.version !== value.version;
            if (changed) incoming = value;
            if (options.prepareRelease && (changed || preparation.phase === 'error' || preparation.phase === 'idle')) void prepareIncoming();
            showUpdate(manualCheck); notify();
        } catch (_) {
            if (manualCheck) options.status('No se pudo consultar la actualización. Revisa tu conexión e inténtalo de nuevo.');
        }
    }
    function check(manual = false, force = false) {
        if (flight) { if (manual) { manualCheck = true; options.status('Buscando actualizaciones…'); } return flight; }
        if (!options.online()) {
            if (manual) options.status('Sin conexión: no se pudo buscar actualizaciones.');
            return Promise.resolve();
        }
        if (!manual && !force && !policy.shouldCheckForUpdate({ now: options.now(), lastCheckedAt, online: true })) return Promise.resolve();
        lastCheckedAt = options.now(); write('lastUpdateCheck', String(lastCheckedAt));
        if (manual) options.status('Buscando actualizaciones…');
        manualCheck = manual;
        flight = performCheck().finally(() => { flight = null; manualCheck = false; }); return flight;
    }
    const controllerChanged = hadController => hadController ? check(false, true) : Promise.resolve();
    return { boot, check, flush, showNews, controllerChanged, apply, repair, reloadSafely, cancelOperation, getState, retry: () => prepareIncoming(true) };
}
export { createReleaseManager };
