import { sendVoiceRecording } from './VoiceCore.js';
import { voiceRetentionPolicy } from './VoiceRetention.js';
import { voiceCanProcess, voiceHasPendingWork, voiceRequestSignature, VOICE_PROCESSING_LEASE_MS } from './VoicePending.js';

const announce = record => window.dispatchEvent(new CustomEvent('sa:voice-processing-changed', { detail: { uid: record.uid, projectKey: record.projectKey, requestId: record.requestId } }));
const sameRecord = (ui, record) => ui.record?.uid === record.uid && ui.record?.requestId === record.requestId;
const offline = () => globalThis.navigator?.onLine === false;

export function pauseVoiceProcessing(ui) {
    ui.processingEpoch = (ui.processingEpoch || 0) + 1;
    ui.processingController?.abort();
}

export async function processVoiceRecording(ui, record, { background = false } = {}) {
    const epoch = ui.processingEpoch || 0, owner = crypto.randomUUID();
    const policy = () => voiceRetentionPolicy(ui.adapter.getSettings?.());
    const guard = () => {
        const identity = ui.identity();
        if (ui.destroyed || record.discarded || epoch !== (ui.processingEpoch || 0) || identity.uid !== record.uid || identity.projectKey !== record.projectKey) throw Error('Envío pausado: cambió la sesión o la obra.');
    };
    guard();
    if (record.unsaved) throw Error('Conserva el audio localmente antes de enviarlo.');
    if (record.completedLoanId || record.completedCashId || record.cashDraft?.pendingMovement) throw Error('Esta grabación ya tiene una operación confirmada o pendiente.');
    if (record.retryAt > Date.now()) throw Error('Espera hasta ' + new Date(record.retryAt).toLocaleTimeString() + ' antes de reintentar.');
    record.processingRequested = true;
    ui.processingRecord = record; ui.processingController = new AbortController();
    const controller = ui.processingController;
    if (!background) { ui.busy = true; ui.message = 'Procesando la grabación…'; ui.render(); }
    let claimed = false;
    try {
        if (!background || !record.requestEndpoint) record.requestEndpoint = ui.endpoint();
        if (offline()) {
            const queued = ui.store.updateRecording
                ? await ui.store.updateRecording(record.uid, record.projectKey, record.requestId, current => {
                    if (!voiceCanProcess(current, policy()) || current.processingLease?.until > Date.now()) throw Error('El audio no está disponible o ya se está procesando.');
                    return { ...current, requestEndpoint: record.requestEndpoint, processingState: 'queued', autoResume: true, error: null };
                }, { guard })
                : { ...record, processingState: 'queued', autoResume: true };
            guard(); if (!queued) throw Error('El audio fue eliminado.');
            Object.assign(record, queued); ui.message = 'Sin conexión. El audio se enviará cuando vuelva internet en esta cuenta y obra.';
            announce(record); return;
        }
        // Production storage claims the lease atomically across tabs. Lightweight
        // injected stores can still be used by isolated UI consumers.
        if (ui.store.claimProcessing) {
            const signature = await voiceRequestSignature(record); guard();
            const current = await ui.store.claimProcessing(record, signature, owner, policy(), { guard });
            if (!current) throw Error('El audio fue eliminado.');
            Object.assign(record, current); claimed = true;
        } else record.processingState = 'processing';
        announce(record);
        const result = await sendVoiceRecording({ url: record.requestEndpoint, record, externalSignal: controller.signal,
            getToken: async force => {
                guard(); const token = await ui.adapter.getUser().getIdToken(force); guard();
                if (claimed) {
                    const renewed = await ui.store.updateRecording(record.uid, record.projectKey, record.requestId, current => {
                        if (current.processingLease?.owner !== owner || current.processingLease.until <= Date.now() || !voiceCanProcess(current, policy())) throw Error('El envío cambió o el audio ya no está disponible.');
                        return { ...current, processingLease: { owner, until: Date.now() + VOICE_PROCESSING_LEASE_MS } };
                    }, { guard });
                    if (!renewed) throw Error('El audio fue eliminado.');
                }
                guard(); return token;
            } });
        guard();
        const apply = current => {
            guard();
            if (ui.store.claimProcessing && !voiceCanProcess(current, policy())) throw Error('El audio venció o ya no está disponible.');
            if (current.dirty || current.pendingResult || background && sameRecord(ui, record) && ui.dialog.open) current.pendingResult = result;
            else ui.applyResult(result, current);
            return { ...current, processingState: 'ready', autoResume: false, retryAt: null, error: null };
        };
        const saved = claimed ? await ui.store.finishProcessing(record, owner, apply, { guard }) : apply(record);
        if (!saved) throw Error('El audio fue eliminado o cambió el envío.');
        if (!claimed) await ui.store.put(saved);
        guard(); Object.assign(record, saved); delete record.processingLease;
        if (sameRecord(ui, record)) {
            Object.assign(ui.record, saved); delete ui.record.processingLease;
            ui.messageError = false;
            ui.message = saved.pendingResult ? 'Llegó un nuevo resultado. Tus ediciones se conservaron; puedes reemplazarlas explícitamente.' : 'Borrador listo para revisar.';
            if (!background && ui.dialog.open) { await ui.refreshMatches(); ui.busy = false; await ui.routeResult(); }
        }
        announce(record);
    } catch (error) {
        const paused = ui.destroyed || epoch !== (ui.processingEpoch || 0) || (() => { try { guard(); return false; } catch (_) { return true; } })();
        const failure = { code: paused ? 'PROCESSING_PAUSED' : error.code || 'ERROR', status: error.status || null,
            message: paused ? 'Envío pausado. Vuelve a abrir esta grabación para reintentarlo.' : error.message, retryable: paused || !!error.retryable };
        const waiting = !paused && (offline() || error.code === 'NETWORK_ERROR');
        const update = current => ({ ...current, processingState: paused ? 'paused' : waiting ? 'queued' : 'error', autoResume: waiting,
            error: failure, retryAt: error.retryAfterMs ? Date.now() + error.retryAfterMs : null });
        let saved = null;
        if (!record.discarded && !ui.wiped) {
            // Cleanup releases only our lease; it never applies a response to a
            // changed session, replaces edits, or recreates deleted audio.
            if (claimed) saved = await ui.store.finishProcessing(record, owner, update);
            else if (ui.store.updateRecording) saved = await ui.store.updateRecording(record.uid, record.projectKey, record.requestId, current => !current.audio || current.completedLoanId || current.completedCashId || current.processingLease?.until > Date.now() ? null : update(current));
            else if (!ui.store.claimProcessing) { saved = update(record); await ui.store.put(saved); }
        }
        if (!paused && sameRecord(ui, record)) {
            if (saved) { Object.assign(ui.record, saved); delete ui.record.processingLease; }
            ui.message = failure.message; ui.messageError = true;
        }
        if (saved) announce(saved);
        if (error.retryAfterMs && !background) {
            clearTimeout(ui.retryTimer); ui.retryTimer = setTimeout(() => { if (ui.dialog.open && sameRecord(ui, record)) ui.render(); }, Math.min(error.retryAfterMs, 2147483647));
        }
    } finally {
        if (!background) ui.busy = false;
        ui.processingRecord = null;
        if (!ui.destroyed && ui.dialog.open) ui.render();
    }
}

export async function resumeVoicePending(ui, { automatic = false } = {}) {
    if (ui.queueFlight || ui.processingFlight || ui.busy || ui.recording || offline() || !ui.store.list) return;
    const identity = ui.identity(), epoch = ui.processingEpoch || 0;
    const valid = () => { const current = ui.identity(); return !ui.destroyed && epoch === (ui.processingEpoch || 0) && current.uid === identity.uid && current.projectKey === identity.projectKey; };
    const run = async () => {
        const records = await ui.store.list(identity.uid, identity.projectKey);
        for (const record of records.slice().reverse()) {
            if (!valid() || offline() || ui.busy || ui.recording) break;
            if (!voiceHasPendingWork(record) || !voiceCanProcess(record, voiceRetentionPolicy(ui.adapter.getSettings?.()))
                || record.result && !record.error && record.processingState !== 'queued' && record.processingState !== 'processing'
                || record.processingLease?.until > Date.now() || record.retryAt > Date.now()
                || (automatic ? record.autoResume !== true : record.error?.retryable === false)) continue;
            await ui.process({ record, background: true });
        }
    };
    ui.queueFlight = run().finally(() => { ui.queueFlight = null; window.dispatchEvent(new Event('sa:voice-processing-changed')); });
    return ui.queueFlight;
}
