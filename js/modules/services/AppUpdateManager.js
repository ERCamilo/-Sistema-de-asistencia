// Release lifecycle with injected IO.
function createReleaseManager(options) {
    const policy = options.policy;
    const key = (name) => `${options.prefix}:${name}`;
    const read = (name) => { try {
        return options.read(key(name));
    }
    catch (_) {
        return null;
    } };
    const write = (name, value) => { try {
        options.write(key(name), value);
        return true;
    }
    catch (_) {
        return false;
    } };
    let booted = false, dialogOpen = false, applying = false, applyGeneration = 0;
    let incoming = null;
    let flight = null;
    let manualCheck = false;
    let deferred = read('deferredVersion');
    let pendingNews = [];
    let lastCheckedAt = Number(read('lastUpdateCheck')) || 0;
    function closeNews() {
        dialogOpen = false;
        const lastSeen = read('lastSeenVersion');
        if (!lastSeen || policy.compareVersions(policy.APP_VERSION, lastSeen) > 0)
            write('lastSeenVersion', policy.APP_VERSION);
        pendingNews = [];
    }
    function closeUpdate(offeredVersion) {
        dialogOpen = false;
        applyGeneration++;
        deferred = offeredVersion;
        write('deferredVersion', deferred);
    }
    async function apply() {
        if (applying || !incoming)
            return;
        applying = true;
        const generation = ++applyGeneration;
        let saved = false;
        try {
            options.status('Guardando datos…');
            await options.beforeReload();
            if (generation !== applyGeneration) return;
            saved = true;
            options.status('Descargando actualización…');
            await options.prepareUpdate?.();
            if (generation === applyGeneration) { options.status('Reiniciando aplicación…'); options.reload(); }
        }
        catch (_) {
            options.status(saved ? 'No se pudo actualizar. Revisa tu conexión y vuelve a intentarlo; tus datos se conservan.'
                : 'No se pudo actualizar. Guarda o cierra tus cambios y vuelve a intentarlo.');
        }
        finally {
            applying = false;
        }
    }
    function showNews(manual = false) {
        if (dialogOpen)
            return;
        const entries = manual ? policy.CHANGELOG : pendingNews;
        if (!entries.length || (!manual && !options.canShow()))
            return;
        dialogOpen = options.show('news', entries, policy.APP_VERSION, closeNews, apply);
    }
    function showUpdate(manual = false) {
        if (dialogOpen || !incoming || (!manual && !options.canShow()))
            return;
        if (!manual && !policy.shouldPromptForUpdate({ hasController: true, currentVersion: policy.APP_VERSION, availableVersion: incoming.version, lastPromptedVersion: deferred }))
            return;
        const offered = incoming;
        dialogOpen = options.show('update', policy.getUnseenReleases(policy.APP_VERSION, offered.changelog), offered.version, () => closeUpdate(offered.version), apply);
    }
    function flush() { if (pendingNews.length)
        showNews();
    else
        showUpdate(); }
    function boot() {
        if (booted)
            return;
        booted = true;
        const seen = read('lastSeenVersion');
        if (!seen || !/^\d+\.\d+\.\d+$/.test(seen))
            write('lastSeenVersion', policy.APP_VERSION);
        else
            pendingNews = policy.getUnseenReleases(seen, policy.CHANGELOG);
        flush();
    }
    async function performCheck() {
        try {
            const value = await options.fetchRelease();
            if (!policy.isReleaseManifest(value))
                throw new Error('Invalid release');
            if (policy.compareVersions(value.version, policy.APP_VERSION) <= 0) {
                if (manualCheck)
                    options.status(`Ya tienes la versión actual (v${policy.APP_VERSION}).`);
                return;
            }
            if (incoming && policy.compareVersions(value.version, incoming.version) < 0) {
                showUpdate(manualCheck);
                return;
            }
            incoming = value;
            showUpdate(manualCheck);
        }
        catch (_) {
            if (manualCheck)
                options.status('No se pudo consultar la actualización. Revisa tu conexión e inténtalo de nuevo.');
        }
    }
    function check(manual = false, force = false) {
        if (flight) {
            if (manual) {
                manualCheck = true;
                options.status('Buscando actualizaciones…');
            }
            return flight;
        }
        if (!options.online()) {
            if (manual)
                options.status('Sin conexión: no se pudo buscar actualizaciones.');
            return Promise.resolve();
        }
        if (!manual && !force && !policy.shouldCheckForUpdate({ now: options.now(), lastCheckedAt, online: true }))
            return Promise.resolve();
        lastCheckedAt = options.now();
        write('lastUpdateCheck', String(lastCheckedAt));
        if (manual)
            options.status('Buscando actualizaciones…');
        manualCheck = manual;
        flight = performCheck().finally(() => { flight = null; manualCheck = false; });
        return flight;
    }
    function controllerChanged(hadController) { return hadController ? check(false, true) : Promise.resolve(); }
    return { boot, check, flush, showNews, controllerChanged, apply };
}

export { createReleaseManager };
