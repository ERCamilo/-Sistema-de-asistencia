/**
 * P2PAttendanceBridge — Dedicated P2P attendance transport bridge for SA.
 *
 * Implements F3.4 SA attendance request/response flow with linked Minis:
 * - Request envelope: `attendance-request/v1` (max 31 days, canonical saProjectId).
 * - Trusted connection: uses existing identity store makeIdentityStore('sa', 'SA - Oficina'),
 *   deriveTrustedRoute, SignalingClient, createRtcSession initiator:true, attachTrusted.
 * - Only sends after channel authentication succeeds.
 * - Strict response validator: `attendance-response/v1`, correlates requestId and saProjectId,
 *   ignores unrelated control/roster traffic, timeout fail-closed, always closes session/listeners.
 * - Stages returned `attendance-submission/v1` into `AttendanceSubmissionInboxStore` as pending drafts.
 * - Preserves transport provenance in record metadata { sourcePeerId, sourcePeerName }
 *   without faking or rewriting the received submission body.
 * - Pure and isolated: does NOT mutate P2PCore, P2PPairing, or state.attendance.
 */

import { p2pPeerAliasStore } from './P2PPeerAliasStore.js';
import {
    validateAttendanceSubmission,
    normalizeAttendanceSubmissionId
} from '../../services/AttendanceSubmissionInboxStore.js';

export const ATTENDANCE_REQUEST_SCHEMA = 'attendance-request/v1';
export const ATTENDANCE_RESPONSE_SCHEMA = 'attendance-response/v1';
export const MAX_REQUEST_RANGE_DAYS = 31;
export const ATTENDANCE_REQUEST_KEYS = Object.freeze([
    'schema',
    'requestId',
    'saProjectId',
    'fromDate',
    'toDate'
]);

const WORKDATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const REQUEST_ID_FORBIDDEN_RE = /[\s\x00-\x1f\x7f]/;

function getP2PCore(override) {
    if (override) return override;
    if (typeof window !== 'undefined' && window.SaMiniP2P) return window.SaMiniP2P;
    if (typeof globalThis !== 'undefined' && globalThis.SaMiniP2P) return globalThis.SaMiniP2P;
    return null;
}

function getP2PPairing(override) {
    if (override) return override;
    if (typeof window !== 'undefined' && window.SaMiniP2PPairing) return window.SaMiniP2PPairing;
    if (typeof globalThis !== 'undefined' && globalThis.SaMiniP2PPairing) return globalThis.SaMiniP2PPairing;
    return null;
}

function defaultUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export function validateCalendarDate(value, label = 'date') {
    if (typeof value !== 'string') {
        throw new TypeError(`${label} must be a string`);
    }
    const text = value.trim();
    if (!text) {
        throw new TypeError(`${label} is required`);
    }
    const match = WORKDATE_RE.exec(text);
    if (!match) {
        throw new TypeError(`${label} must be YYYY-MM-DD`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) {
        throw new TypeError(`${label} must be YYYY-MM-DD`);
    }
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > daysInMonth) {
        throw new TypeError(`${label} must be YYYY-MM-DD`);
    }
    const roundTrip = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    if (roundTrip !== text) {
        throw new TypeError(`${label} must be YYYY-MM-DD`);
    }
    return text;
}

function parseUtcDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

export function rangeDays(fromDate, toDate) {
    const t1 = parseUtcDate(fromDate);
    const t2 = parseUtcDate(toDate);
    const diff = t2 - t1;
    return Math.round(diff / 86400000) + 1;
}

export function requireCanonicalSaId(value, label = 'saProjectId') {
    const normalized = normalizeAttendanceSubmissionId(value);
    if (!normalized) {
        throw new TypeError(`${label} must be a canonical ID (trimmed, 1-128 chars, no whitespace/control)`);
    }
    return normalized;
}

export function requireCanonicalRequestId(value, label = 'requestId') {
    if (typeof value !== 'string') {
        throw new TypeError(`${label} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new TypeError(`${label} is required`);
    }
    if (trimmed.length > 128) {
        throw new TypeError(`${label} exceeds maximum length of 128 characters`);
    }
    if (REQUEST_ID_FORBIDDEN_RE.test(trimmed)) {
        throw new TypeError(`${label} must not contain whitespace or control characters`);
    }
    return trimmed;
}

export function buildAttendanceRequest({
    saProjectId,
    fromDate,
    toDate,
    requestId = defaultUuid()
} = {}) {
    const cleanProjectId = requireCanonicalSaId(saProjectId, 'saProjectId');
    const cleanFromDate = validateCalendarDate(fromDate, 'fromDate');
    const cleanToDate = validateCalendarDate(toDate, 'toDate');
    const cleanRequestId = requireCanonicalRequestId(requestId, 'requestId');

    const days = rangeDays(cleanFromDate, cleanToDate);
    if (days < 1) {
        throw new TypeError('fromDate must be less than or equal to toDate');
    }
    if (days > MAX_REQUEST_RANGE_DAYS) {
        throw new TypeError(`Date range (${days} days) exceeds maximum allowed range of ${MAX_REQUEST_RANGE_DAYS} days`);
    }

    return Object.freeze({
        schema: ATTENDANCE_REQUEST_SCHEMA,
        requestId: cleanRequestId,
        saProjectId: cleanProjectId,
        fromDate: cleanFromDate,
        toDate: cleanToDate
    });
}

export function validateAttendanceRequest(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError('attendance-request must be an object');
    }
    const allowed = [...ATTENDANCE_REQUEST_KEYS, 'type'];
    for (const key of Object.keys(raw)) {
        if (!allowed.includes(key)) {
            throw new TypeError(`attendance-request contains unsupported field "${key}"`);
        }
    }
    if (raw.schema !== ATTENDANCE_REQUEST_SCHEMA) {
        throw new TypeError(`schema must be ${ATTENDANCE_REQUEST_SCHEMA}`);
    }
    return buildAttendanceRequest({
        requestId: raw.requestId,
        saProjectId: raw.saProjectId,
        fromDate: raw.fromDate,
        toDate: raw.toDate
    });
}

export function validateAttendanceResponse(raw, {
    expectedRequestId = null,
    expectedSaProjectId = null,
    expectedFromDate = null,
    expectedToDate = null
} = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError('attendance-response must be an object');
    }
    const allowed = [
        'schema', 'requestId', 'saProjectId', 'ok',
        'fromDate', 'toDate', 'submissions', 'error'
    ];
    for (const key of Object.keys(raw)) {
        if (!allowed.includes(key)) {
            throw new TypeError(`attendance-response contains unsupported field "${key}"`);
        }
    }
    if (raw.schema !== ATTENDANCE_RESPONSE_SCHEMA) {
        throw new TypeError(`schema must be ${ATTENDANCE_RESPONSE_SCHEMA}`);
    }

    const requestId = requireCanonicalRequestId(raw.requestId, 'requestId');
    const saProjectId = requireCanonicalSaId(raw.saProjectId, 'saProjectId');
    if (expectedRequestId !== null && expectedRequestId !== undefined) {
        const expected = requireCanonicalRequestId(expectedRequestId, 'expectedRequestId');
        if (requestId !== expected) {
            throw new TypeError(`requestId mismatch: expected "${expected}", got "${requestId}"`);
        }
    }
    if (expectedSaProjectId !== null && expectedSaProjectId !== undefined) {
        const expected = requireCanonicalSaId(expectedSaProjectId, 'expectedSaProjectId');
        if (saProjectId !== expected) {
            throw new TypeError(`saProjectId mismatch: expected "${expected}", got "${saProjectId}"`);
        }
    }
    if (typeof raw.ok !== 'boolean') {
        throw new TypeError('ok field must be a boolean');
    }

    if (raw.ok === false) {
        if ('fromDate' in raw || 'toDate' in raw || 'submissions' in raw) {
            throw new TypeError('failed attendance-response must not contain date range or submissions');
        }
        if (typeof raw.error !== 'string' || !raw.error.trim()) {
            throw new TypeError('error is required when ok is false');
        }
        const errorMsg = raw.error.trim();
        if (errorMsg.length > 512) {
            throw new TypeError('attendance-response error exceeds maximum length');
        }
        const error = new Error(errorMsg);
        error.rawResponse = Object.freeze({
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId,
            saProjectId,
            ok: false,
            error: errorMsg
        });
        throw error;
    }

    if ('error' in raw) {
        throw new TypeError('successful attendance-response must not contain error');
    }
    const fromDate = validateCalendarDate(raw.fromDate, 'fromDate');
    const toDate = validateCalendarDate(raw.toDate, 'toDate');
    const days = rangeDays(fromDate, toDate);
    if (days < 1 || days > MAX_REQUEST_RANGE_DAYS) {
        throw new TypeError('attendance-response date range is invalid');
    }
    if (expectedFromDate !== null && expectedFromDate !== undefined) {
        const expected = validateCalendarDate(expectedFromDate, 'expectedFromDate');
        if (fromDate !== expected) {
            throw new TypeError(`fromDate mismatch: expected "${expected}", got "${fromDate}"`);
        }
    }
    if (expectedToDate !== null && expectedToDate !== undefined) {
        const expected = validateCalendarDate(expectedToDate, 'expectedToDate');
        if (toDate !== expected) {
            throw new TypeError(`toDate mismatch: expected "${expected}", got "${toDate}"`);
        }
    }
    if (!Array.isArray(raw.submissions)) {
        throw new TypeError('submissions must be an array');
    }

    const rangeStartMs = parseUtcDate(fromDate);
    const rangeEndMs = parseUtcDate(toDate);
    const seenSubmissionIds = new Set();
    const submissions = raw.submissions.map((submission, index) => {
        const validated = validateAttendanceSubmission(submission, saProjectId);
        const workDateMs = parseUtcDate(validated.workDate);
        if (workDateMs < rangeStartMs || workDateMs > rangeEndMs) {
            throw new TypeError(`submissions[${index}].workDate is outside requested range`);
        }
        if (seenSubmissionIds.has(validated.submissionId)) {
            throw new TypeError(`submissions[${index}].submissionId is duplicated`);
        }
        seenSubmissionIds.add(validated.submissionId);
        return validated;
    });

    return Object.freeze({
        schema: ATTENDANCE_RESPONSE_SCHEMA,
        requestId,
        saProjectId,
        ok: true,
        fromDate,
        toDate,
        submissions: Object.freeze(submissions)
    });
}

export async function listLinkedMiniPeers({
    identityStore = null,
    aliasStore = p2pPeerAliasStore,
    p2pCore = null
} = {}) {
    const core = getP2PCore(p2pCore);
    const store = identityStore || (core?.makeIdentityStore ? core.makeIdentityStore('sa', 'SA - Oficina') : null);
    if (!store || typeof store.listPeers !== 'function') {
        return [];
    }
    const allPeers = await store.listPeers();
    const miniPeers = (allPeers || []).filter(p => p && p.peerApp === 'mini');
    return miniPeers.map(peer => {
        const resolvedName = aliasStore?.resolveName ? aliasStore.resolveName(peer) : (peer.displayName || 'Mini');
        const alias = aliasStore?.getAlias ? aliasStore.getAlias(peer.peerId) : null;
        return {
            id: peer.peerId,
            peerId: peer.peerId,
            deviceId: peer.peerId,
            name: resolvedName,
            displayName: peer.displayName || 'Mini',
            alias: alias || null,
            linkedAt: peer.linkedAt || null,
            lastSeenAt: peer.lastSeenAt || null,
            peer
        };
    });
}

export async function requestAttendanceFromPeer({
    peerId,
    saProjectId,
    fromDate,
    toDate,
    timeoutMs = 15000,
    identityStore = null,
    aliasStore = p2pPeerAliasStore,
    p2pCore = null,
    p2pPairing = null,
    inboxStore = null,
    requestId = null,
    onStateChange = null,
    signal = null
} = {}) {
    const core = getP2PCore(p2pCore);
    if (!core) throw new Error('SaMiniP2P core no está disponible.');
    const pairing = getP2PPairing(p2pPairing);
    if (!pairing) throw new Error('SaMiniP2PPairing no está disponible.');

    const request = buildAttendanceRequest({
        saProjectId,
        fromDate,
        toDate,
        requestId: requestId || undefined
    });

    const store = identityStore || core.makeIdentityStore('sa', 'SA - Oficina');
    const self = await store.getSelf();
    const peer = await store.getPeer(peerId);
    if (!peer || peer.peerApp !== 'mini') {
        throw new Error(`Mini vinculado "${peerId}" no encontrado o no compatible.`);
    }
    const peerName = aliasStore?.resolveName ? aliasStore.resolveName(peer) : (peer.displayName || 'Mini');

    const notifyState = (state, details = {}) => {
        if (typeof onStateChange === 'function') {
            try {
                onStateChange(state, {
                    peerId: peer.peerId,
                    peerName,
                    ...details
                });
            } catch (_) {}
        }
    };

    if (signal?.aborted) {
        const cancelErr = new Error('Solicitud cancelada por el usuario.');
        cancelErr.name = 'AbortError';
        notifyState('cancelled', { error: cancelErr, message: 'Solicitud cancelada por el usuario.' });
        throw cancelErr;
    }

    const route = await core.deriveTrustedRoute(peer.linkToken);
    const signaling = new core.SignalingClient({
        room: route.room,
        peerId: self.deviceId,
        proof: route.proof
    });

    let session = null;
    let sessionPromise = null;
    let activeChannel = null;
    let trustedAttachment = null;
    let messageHandler = null;
    let timeoutTimer = null;
    let abortHandler = null;
    let isSettled = false;

    try {
        const response = await new Promise((resolve, reject) => {
            const fail = (error) => {
                if (isSettled) return;
                isSettled = true;
                if (timeoutTimer) clearTimeout(timeoutTimer);
                if (signal && abortHandler) {
                    try { signal.removeEventListener('abort', abortHandler); } catch (_) {}
                }
                const normalized = error instanceof Error ? error : new Error(String(error));
                const isAbort = normalized.name === 'AbortError' || normalized.message?.includes('cancelada');
                const isTimeout = normalized.isTimeout || normalized.message?.includes('timeout');
                if (isAbort) {
                    notifyState('cancelled', { error: normalized, message: 'Solicitud cancelada por el usuario.' });
                } else if (isTimeout) {
                    notifyState('timeout', { error: normalized, message: normalized.message });
                } else {
                    notifyState('error', { error: normalized, message: normalized.message || 'Error P2P' });
                }
                reject(normalized);
            };

            const succeed = (result) => {
                if (isSettled) return;
                isSettled = true;
                if (timeoutTimer) clearTimeout(timeoutTimer);
                if (signal && abortHandler) {
                    try { signal.removeEventListener('abort', abortHandler); } catch (_) {}
                }
                resolve(result);
            };

            notifyState('connecting', { message: `Conectando con ${peerName}…` });

            if (signal) {
                abortHandler = () => {
                    const cancelErr = new Error('Solicitud cancelada por el usuario.');
                    cancelErr.name = 'AbortError';
                    fail(cancelErr);
                };
                if (signal.aborted) {
                    abortHandler();
                    return;
                }
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            timeoutTimer = setTimeout(() => {
                const timeoutErr = new Error(`Mini "${peerName}" no respondió a tiempo (timeout de ${timeoutMs}ms).`);
                timeoutErr.isTimeout = true;
                fail(timeoutErr);
            }, timeoutMs);

            sessionPromise = core.createRtcSession({
                signaling,
                initiator: true,
                onState: (status, error) => {
                    if (error) {
                        fail(error);
                    }
                },
                onChannel: (channel) => {
                    activeChannel = channel;
                    try {
                        notifyState('authenticating', { message: `Autenticando canal seguro con ${peerName}…` });
                        trustedAttachment = pairing.attachTrusted(channel, {
                            self,
                            peer,
                            store,
                            onAuthenticated: () => {
                                try {
                                    notifyState('requesting', { message: `Solicitando asistencia a ${peerName}…` });
                                    // ONLY SEND AFTER AUTHENTICATION
                                    messageHandler = (event) => {
                                        try {
                                            if (typeof event?.data !== 'string') return;
                                            let parsed;
                                            try {
                                                parsed = JSON.parse(event.data);
                                            } catch (_) {
                                                return; // ignore unparseable frames
                                            }
                                            if (!parsed || typeof parsed !== 'object') return;
                                            // Ignore unrelated control / roster frames
                                            if (parsed.protocol === 'sa-mini-p2p-control/v1' ||
                                                parsed.protocol === 'sa-mini-p2p-transfer/v1') {
                                                return;
                                            }
                                            if (parsed.schema !== ATTENDANCE_RESPONSE_SCHEMA) {
                                                return;
                                            }

                                            // Correlate requestId and saProjectId; validate strictly
                                            if (typeof core.isChannelAuthenticated === 'function' &&
                                                core.isChannelAuthenticated(channel) !== true) {
                                                throw new Error('Canal P2P dejó de estar autenticado antes de recibir asistencia.');
                                            }
                                            const validated = validateAttendanceResponse(parsed, {
                                                expectedRequestId: request.requestId,
                                                expectedSaProjectId: request.saProjectId,
                                                expectedFromDate: request.fromDate,
                                                expectedToDate: request.toDate
                                            });
                                            succeed(validated);
                                        } catch (err) {
                                            fail(err);
                                        }
                                    };

                                    channel.addEventListener('message', messageHandler);
                                    channel.send(JSON.stringify(request));
                                    notifyState('receiving', { message: `Esperando respuesta de ${peerName}…` });
                                } catch (sendErr) {
                                    fail(sendErr);
                                }
                            },
                            onError: (authErr) => {
                                fail(authErr);
                            }
                        });
                    } catch (attachErr) {
                        fail(attachErr);
                    }
                }
            });
            sessionPromise.then(createdSession => {
                session = createdSession;
            }).catch(fail);
        });

        // Import returned submissions into inboxStore if provided
        const importedRecords = [];
        if (inboxStore && Array.isArray(response.submissions)) {
            for (const sub of response.submissions) {
                // Ensure individual submission validates against saProjectId
                validateAttendanceSubmission(sub, request.saProjectId);
                const imported = await inboxStore.importSubmission(sub, {
                    expectedSaProjectId: request.saProjectId,
                    metadata: {
                        sourcePeerId: peer.peerId,
                        sourcePeerName: peerName
                    }
                });
                importedRecords.push(imported);
            }
        }

        notifyState('success', {
            message: `Asistencia recibida de ${peerName}.`,
            submissions: response.submissions || [],
            importedRecords
        });

        return {
            peerId: peer.peerId,
            peerName,
            response,
            submissions: response.submissions || [],
            importedRecords
        };
    } finally {
        // ALWAYS clean up fail-closed
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (signal && abortHandler) {
            try { signal.removeEventListener('abort', abortHandler); } catch (_) {}
        }
        if (activeChannel && messageHandler) {
            try { activeChannel.removeEventListener('message', messageHandler); } catch (_) {}
        }
        if (trustedAttachment?.detach) {
            try { trustedAttachment.detach(); } catch (_) {}
        }
        let sessionToClose = session;
        if (!sessionToClose && sessionPromise) {
            try {
                sessionToClose = await sessionPromise;
                session = sessionToClose;
            } catch (_) {}
        }
        if (sessionToClose) {
            try { sessionToClose.close?.('attendance-request-finished'); } catch (_) {}
        }
    }
}

export async function requestMiniAttendance({
    miniId = '',
    targetMiniIds = null,
    date = '',
    rangeStart = '',
    rangeEnd = '',
    groupingMode = 'day',
    saProjectId = null,
    inboxStore = null,
    timeoutMs = 15000,
    identityStore = null,
    aliasStore = p2pPeerAliasStore,
    p2pCore = null,
    p2pPairing = null,
    onProgress = null,
    signal = null
} = {}) {
    if (!saProjectId || typeof saProjectId !== 'string' || !saProjectId.trim()) {
        throw new Error('Se requiere un proyecto activo para solicitar asistencia a Minis.');
    }
    const cleanSaProjectId = requireCanonicalSaId(saProjectId, 'saProjectId');

    let fromDate;
    let toDate;
    if (groupingMode === 'period') {
        fromDate = rangeStart;
        toDate = rangeEnd;
    } else {
        fromDate = date;
        toDate = date;
    }

    if (!fromDate || !toDate) {
        throw new Error('Se requiere una fecha o rango válido para solicitar asistencia.');
    }

    const validFromDate = validateCalendarDate(fromDate, 'fromDate');
    const validToDate = validateCalendarDate(toDate, 'toDate');
    const days = rangeDays(validFromDate, validToDate);
    if (days < 1) {
        throw new TypeError('fromDate must be less than or equal to toDate');
    }
    if (days > MAX_REQUEST_RANGE_DAYS) {
        throw new TypeError(`Date range (${days} days) exceeds maximum allowed range of ${MAX_REQUEST_RANGE_DAYS} days`);
    }

    const linkedMinis = await listLinkedMiniPeers({ identityStore, aliasStore, p2pCore });
    if (!linkedMinis || linkedMinis.length === 0) {
        throw new Error('No hay dispositivos Mini vinculados en este equipo.');
    }

    let targets = [];
    if (Array.isArray(targetMiniIds) && targetMiniIds.length > 0) {
        targets = linkedMinis.filter(m =>
            targetMiniIds.includes(m.id) ||
            targetMiniIds.includes(m.peerId) ||
            targetMiniIds.includes(m.deviceId)
        );
        if (targets.length === 0) {
            throw new Error('Ninguno de los Minis especificados fue encontrado.');
        }
    } else if (miniId && String(miniId).trim()) {
        const targetId = String(miniId).trim();
        const found = linkedMinis.find(m => m.id === targetId || m.peerId === targetId || m.deviceId === targetId);
        if (!found) {
            throw new Error(`Mini vinculado "${targetId}" no encontrado.`);
        }
        targets = [found];
    } else {
        targets = [...linkedMinis];
    }

    const results = [];
    const errors = [];
    let totalSubmissions = 0;
    let importedCount = 0;
    let duplicateCount = 0;

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (signal?.aborted) {
            const cancelErr = new Error('Solicitud cancelada por el usuario.');
            cancelErr.name = 'AbortError';
            if (targets.length === 1) {
                if (typeof onProgress === 'function') {
                    try {
                        onProgress({
                            peerId: target.peerId || target.id,
                            peerName: target.name || target.displayName || 'Mini',
                            state: 'cancelled',
                            message: 'Solicitud cancelada por el usuario.'
                        });
                    } catch (_) {}
                }
                throw cancelErr;
            }
            for (let j = i; j < targets.length; j++) {
                const remTarget = targets[j];
                const remErr = new Error('Solicitud cancelada por el usuario.');
                remErr.name = 'AbortError';
                errors.push({ peer: remTarget, error: remErr });
                if (typeof onProgress === 'function') {
                    try {
                        onProgress({
                            peerId: remTarget.peerId || remTarget.id,
                            peerName: remTarget.name || remTarget.displayName || 'Mini',
                            state: 'cancelled',
                            message: 'Solicitud cancelada por el usuario.'
                        });
                    } catch (_) {}
                }
            }
            break;
        }

        try {
            const peerResult = await requestAttendanceFromPeer({
                peerId: target.peerId || target.id,
                saProjectId: cleanSaProjectId,
                fromDate: validFromDate,
                toDate: validToDate,
                timeoutMs,
                identityStore,
                aliasStore,
                p2pCore,
                p2pPairing,
                inboxStore,
                signal,
                onStateChange: (peerState, detail) => {
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress({
                                peerId: target.peerId || target.id,
                                peerName: target.name || target.displayName || 'Mini',
                                state: peerState,
                                ...detail
                            });
                        } catch (_) {}
                    }
                }
            });
            results.push(peerResult);
            const subs = peerResult.submissions || [];
            totalSubmissions += subs.length;
            if (peerResult.importedRecords) {
                for (const rec of peerResult.importedRecords) {
                    if (rec.outcome === 'imported') importedCount++;
                    else if (rec.outcome === 'duplicate') duplicateCount++;
                }
            }
        } catch (err) {
            errors.push({ peer: target, error: err });
            if (targets.length === 1) {
                throw err;
            }
            if (err?.name === 'AbortError' || signal?.aborted) {
                for (let j = i + 1; j < targets.length; j++) {
                    const remTarget = targets[j];
                    const cancelErr = new Error('Solicitud cancelada por el usuario.');
                    cancelErr.name = 'AbortError';
                    errors.push({ peer: remTarget, error: cancelErr });
                    if (typeof onProgress === 'function') {
                        try {
                            onProgress({
                                peerId: remTarget.peerId || remTarget.id,
                                peerName: remTarget.name || remTarget.displayName || 'Mini',
                                state: 'cancelled',
                                message: 'Solicitud cancelada por el usuario.'
                            });
                        } catch (_) {}
                    }
                }
                break;
            }
        }
    }

    if (results.length === 0 && errors.length > 0) {
        const errorMessages = errors.map(e => `${e.peer.name}: ${e.error.message || e.error}`).join('; ');
        const combinedErr = new Error(`Error al solicitar asistencia: ${errorMessages}`);
        combinedErr.errors = errors;
        if (errors.every(e => e.error?.name === 'AbortError')) {
            combinedErr.name = 'AbortError';
        }
        throw combinedErr;
    }

    const hasPartialError = errors.length > 0;
    const status = hasPartialError ? 'partial_success' : 'success';

    let message;
    if (targets.length === 1) {
        if (totalSubmissions === 0) {
            message = `✓ Asistencia recibida de ${targets[0].name} (sin registros para esta fecha).`;
        } else {
            message = `✓ Asistencia recibida de ${targets[0].name} (${importedCount} nuevos, ${duplicateCount} duplicados).`;
        }
    } else {
        if (hasPartialError) {
            const failedNames = errors.map(e => e.peer.name).join(', ');
            message = `Parcial: ${results.length} de ${targets.length} Minis respondieron (${importedCount} nuevos${duplicateCount ? `, ${duplicateCount} duplicados` : ''}). Falló: ${failedNames}.`;
        } else if (totalSubmissions === 0) {
            message = `✓ Asistencia recibida de ${targets.length} Minis (sin registros para esta fecha).`;
        } else {
            message = `✓ Asistencia solicitada a ${targets.length} Minis (${results.length} respondieron, ${importedCount} nuevos, ${duplicateCount} duplicados).`;
        }
    }

    return {
        ok: true,
        status,
        hasPartialError,
        message,
        targetsCount: targets.length,
        respondedCount: results.length,
        totalSubmissions,
        importedCount,
        duplicateCount,
        results,
        errors
    };
}
