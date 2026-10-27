// Coordinates browser worker operations without changing application data.
export class AppUpdateError extends Error {
    constructor(message, code = 'update-failed') { super(message); this.name = 'AppUpdateError'; this.code = code; }
}
const aborted = () => new AppUpdateError('Operación cancelada.', 'cancelled');
const timeout = () => new AppUpdateError('La actualización tardó demasiado. Puedes reintentar o recargar.', 'timeout');

export function withUpdateDeadline(action, { timeoutMs = 45000, signal } = {}) {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
            error ? reject(error) : resolve(value);
        };
        const cancel = () => { controller.abort(); finish(aborted()); };
        const timer = setTimeout(() => { controller.abort(); finish(timeout()); }, timeoutMs);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        Promise.resolve().then(() => action(controller.signal)).then(value => finish(null, value), finish);
    });
}

function waitForWorker(worker, states, signal) {
    return new Promise((resolve, reject) => {
        const done = error => {
            worker.removeEventListener('statechange', check); signal.removeEventListener('abort', cancel);
            error ? reject(error) : resolve();
        };
        const check = () => {
            if (states.includes(worker.state)) done();
            else if (worker.state === 'redundant') done(new AppUpdateError('La nueva versión no pudo instalarse.'));
        };
        const cancel = () => done(aborted());
        if (signal.aborted) { reject(aborted()); return; }
        worker.addEventListener('statechange', check); signal.addEventListener('abort', cancel, { once: true }); check();
    });
}

export function createAppUpdateWorker({
    serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : null,
    Channel = globalThis.MessageChannel, timeoutMs = 45000, activationTimeoutMs = 10000,
    makeToken = () => globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random()
} = {}) {
    const prepared = new Map(), flights = new Map();
    function request(worker, data, signal, onProgress = () => {}) {
        return new Promise((resolve, reject) => {
            const channel = new Channel(); let settled = false;
            const done = (error, value) => {
                if (settled) return;
                settled = true; signal.removeEventListener('abort', cancel);
                channel.port1.close(); channel.port2.close();
                error ? reject(error) : resolve(value);
            };
            const cancel = () => {
                if (data.token) { try { worker.postMessage({ type: 'CANCEL_APP_PREPARATION', token: data.token }); } catch (_) {} }
                done(aborted());
            };
            if (signal.aborted) { cancel(); return; }
            channel.port1.onmessage = event => {
                if (event.data?.type === 'progress') { onProgress(event.data); return; }
                if (event.data?.ok === false) done(new AppUpdateError(event.data.message || 'No se pudo preparar la actualización.'));
                else done(null, event.data);
            };
            channel.port1.onmessageerror = () => done(new AppUpdateError('La actualización respondió de forma inesperada.'));
            signal.addEventListener('abort', cancel, { once: true });
            try { worker.postMessage(data, [channel.port2]); } catch (error) { done(error); }
        });
    }
    function prepare(version, { force = false, onProgress, signal } = {}) {
        if (!/^\d+\.\d+\.\d+$/.test(version)) return Promise.reject(new AppUpdateError('Versión de actualización inválida.'));
        if (!force && prepared.has(version)) return Promise.resolve(prepared.get(version));
        if (!force && flights.has(version)) return flights.get(version);
        const promise = withUpdateDeadline(async operationSignal => {
            if (!serviceWorker) throw new AppUpdateError('Este navegador no permite preparar la actualización. Puedes recargar.', 'unsupported');
            onProgress?.({ message: 'Buscando archivos nuevos…' });
            const registration = await serviceWorker.getRegistration();
            if (operationSignal.aborted) throw aborted();
            if (!registration) throw new AppUpdateError('La aplicación aún se está preparando. Reintenta en unos segundos.');
            // Included in the SAME deadline: a pending sw.js request must not lock the UI.
            await registration.update();
            if (operationSignal.aborted) throw aborted();
            const worker = registration.installing || registration.waiting || registration.active;
            if (!worker) throw new AppUpdateError('La aplicación aún no tiene una versión disponible.');
            await waitForWorker(worker, ['installed', 'activated'], operationSignal);
            let previousCacheName = null;
            if (registration.active) {
                const previous = await request(registration.active, 'GET_VERSION', operationSignal);
                previousCacheName = previous?.cacheName || (previous?.version ? 'asistencia-v' + previous.version : null);
            }
            const token = makeToken();
            const result = await request(worker, {
                type: 'PREPARE_APP_UPDATE', version, force, token,
                reuseInstalled: worker !== registration.active
            }, operationSignal, onProgress);
            if (operationSignal.aborted) throw aborted();
            if (!result?.ok || result.version !== version || !result.cacheName) throw new AppUpdateError('Los archivos no corresponden a la versión esperada.');
            const handle = { version, cacheName: result.cacheName, worker, previousCacheName };
            prepared.set(version, handle);
            return handle;
        }, { timeoutMs, signal });
        flights.set(version, promise);
        const clear = () => { if (flights.get(version) === promise) flights.delete(version); };
        promise.then(clear, clear); return promise;
    }
    async function activate(handle, { signal } = {}) {
        try {
            return await withUpdateDeadline(async operationSignal => {
                const result = await request(handle.worker, {
                    type: 'ACTIVATE_APP_UPDATE', version: handle.version, cacheName: handle.cacheName,
                    previousCacheName: handle.previousCacheName
                }, operationSignal);
                if (!result?.ok) throw new AppUpdateError('No se pudo activar la actualización.');
                await waitForWorker(handle.worker, ['activated'], operationSignal);
            }, { timeoutMs: activationTimeoutMs, signal });
        } catch (error) { prepared.delete(handle.version); throw error; }
    }
    async function confirmRunningVersion(version) {
        if (!serviceWorker) return;
        try {
            await withUpdateDeadline(async signal => {
                const registration = await serviceWorker.getRegistration();
                if (signal.aborted || !registration?.active) return;
                await request(registration.active, { type: 'CONFIRM_APP_UPDATE', version }, signal);
            }, { timeoutMs: activationTimeoutMs });
        } catch (_) { /* Older workers can ignore this optional confirmation. */ }
    }
    return { prepare, activate, confirmRunningVersion };
}
