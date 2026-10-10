import { indexedDBService } from './IndexedDBService.js';
import { appImageClient } from './AppImageClient.js';
import { EmployeeRepository } from './EmployeeRepository.js';
import { normalizeEmployeePhoto } from '../features/employees/Employee.js';

const PROFILE_COORDINATES = Object.freeze({
    category: 'employee-profile',
    ownerType: 'employee',
    assetId: 'profile'
});
const PHOTO_VARIANTS = Object.freeze(['thumbnail', 'original']);
export const DEFAULT_ORIGINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// Reintento de subida tras un fallo: 15 s, 30 s, 1 min... hasta 15 min. Las
// lecturas (cada render del avatar) no vuelven a subir antes de ese plazo; un
// reemplazo explícito del usuario siempre lo intenta de inmediato.
const UPLOAD_RETRY_BASE_MS = 15_000;
const UPLOAD_RETRY_MAX_MS = 15 * 60 * 1000;
const READ_RETRY_BASE_MS = 15_000;
const READ_RETRY_MAX_MS = 15 * 60 * 1000;

function normalizeEmployeeId(employeeId) {
    return String(employeeId || '').trim();
}

function coordinates(employeeId, variant) {
    return { ...PROFILE_COORDINATES, ownerId: normalizeEmployeeId(employeeId), variant };
}

function uploadFileName(employeeId, variant, blob) {
    // Pending uploads can still contain photos processed before WebP was used.
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/png' ? 'png' : 'webp';
    return `${employeeId}-profile-${variant}.${extension}`;
}

function assetStamp(asset, fallback) {
    const value = asset?.updatedAt || asset?.uploadedAt;
    return typeof value === 'string' && value.trim() ? value.trim() : String(fallback);
}

function remoteVersion(asset, fallback) {
    const parsed = Date.parse(asset?.updatedAt || asset?.uploadedAt || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function combinedRemoteRevision(originalAsset, thumbnailAsset, fallback) {
    return `original:${assetStamp(originalAsset, fallback)}|thumbnail:${assetStamp(thumbnailAsset, fallback)}`;
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function mergeRecord(employeeId, current, patch, now) {
    const value = key => hasOwn(patch, key) ? patch[key] : current?.[key] ?? null;
    return {
        employeeId,
        thumbnailBlob: value('thumbnailBlob'),
        optimizedBlob: value('optimizedBlob'),
        width: value('width'),
        height: value('height'),
        version: hasOwn(patch, 'version') ? patch.version : current?.version || now,
        updatedAt: hasOwn(patch, 'updatedAt') ? patch.updatedAt : current?.updatedAt || now,
        remoteSyncedVersion: value('remoteSyncedVersion'),
        remoteRevision: value('remoteRevision'),
        remoteSignalUpdatedAt: value('remoteSignalUpdatedAt'),
        pendingDelete: false,
        pendingDeleteVariants: [],
        deleteIntentAt: null,
        pendingDeleteSignal: false,
        deleteRevision: null
    };
}

function tombstone(employeeId, current, variants, deleteIntentAt, patch = {}) {
    return {
        employeeId,
        thumbnailBlob: null,
        optimizedBlob: null,
        width: null,
        height: null,
        version: current?.version || deleteIntentAt,
        updatedAt: deleteIntentAt,
        remoteSyncedVersion: null,
        remoteRevision: current?.remoteRevision || null,
        remoteSignalUpdatedAt: current?.remoteSignalUpdatedAt || null,
        pendingDelete: true,
        pendingDeleteVariants: PHOTO_VARIANTS.filter(variant => variants.includes(variant)),
        deleteIntentAt,
        pendingDeleteSignal: patch.pendingDeleteSignal === true,
        deleteRevision: patch.deleteRevision || current?.deleteRevision || `deleted:${deleteIntentAt}`
    };
}

function isUnsyncedLocalPhoto(record) {
    return record?.optimizedBlob instanceof Blob
        && record.remoteSyncedVersion !== record.version;
}

function localSignalUpdatedAt(record) {
    const candidates = [record?.remoteSignalUpdatedAt];
    if (record?.pendingDelete) candidates.push(record.deleteIntentAt);
    const finite = candidates.filter(Number.isFinite);
    return finite.length ? Math.max(...finite) : null;
}

export class EmployeePhotoService {
    constructor({
        localStore = indexedDBService,
        imageClient = appImageClient,
        publishSignal = async () => true,
        now = () => Date.now()
    } = {}) {
        this.localStore = localStore;
        this.imageClient = imageClient;
        this.publishSignal = publishSignal;
        this.now = now;
        this.pendingSyncs = new Map();
        this.queuedRecords = new Map();
        this.pendingRemoteReads = new Map();
        this.pendingDeletes = new Map();
        this.pendingSignalPublications = new Map();
        this.intentRevisions = new Map();
        this.localMutations = new Map();
        this.uploadRetries = new Map();
        this.remoteReadRetries = new Map();
        this.remotePhotoRevisions = new Map();
    }

    /** Estado de la subida remota pendiente (diagnóstico), o null si no hay fallo. */
    getUploadRetryState(employeeId) {
        const retry = this.uploadRetries.get(normalizeEmployeeId(employeeId));
        return retry ? { ...retry } : null;
    }

    /**
     * ¿La foto local todavía no llegó a la nube? Para la UI: antes el único
     * rastro era la consola. `retryAt` solo existe si ya hubo un fallo.
     */
    async getPendingUploadStatus(employeeId) {
        const id = normalizeEmployeeId(employeeId);
        const record = id ? await this.readLocal(id) : null;
        if (!isUnsyncedLocalPhoto(record) || record?.pendingDelete) return { pending: false };
        const retry = this.uploadRetries.get(id);
        return { pending: true, retryAt: retry?.retryAt ?? null, code: retry?.code ?? null };
    }

    recordUploadFailure(employeeId, error) {
        const attempts = (this.uploadRetries.get(employeeId)?.attempts || 0) + 1;
        const delay = Math.min(UPLOAD_RETRY_MAX_MS, UPLOAD_RETRY_BASE_MS * (2 ** (attempts - 1)));
        this.uploadRetries.set(employeeId, {
            attempts,
            code: error?.code || null,
            retryAt: this.now() + delay
        });
    }

    nextIntent(employeeId) {
        this.clearRemoteReadRetries(employeeId);
        const revision = (this.intentRevisions.get(employeeId) || 0) + 1;
        this.intentRevisions.set(employeeId, revision);
        return revision;
    }

    currentIntent(employeeId) {
        return this.intentRevisions.get(employeeId) || 0;
    }

    enqueueLocalMutation(employeeId, mutation) {
        const previous = this.localMutations.get(employeeId) || Promise.resolve();
        const pending = previous.catch(() => {}).then(mutation).finally(() => {
            if (this.localMutations.get(employeeId) === pending) this.localMutations.delete(employeeId);
        });
        this.localMutations.set(employeeId, pending);
        return pending;
    }

    async readLocal(employeeId) {
        try { return await this.localStore.getEmployeePhoto(employeeId); }
        catch { return null; }
    }

    clearRemoteReadRetries(employeeId) {
        for (const variant of PHOTO_VARIANTS) {
            this.remoteReadRetries.delete(`${employeeId}:${variant}`);
        }
    }

    readRemoteVariant(employeeId, variant, { force = false } = {}) {
        const key = `${employeeId}:${variant}`;
        if (this.pendingRemoteReads.has(key)) return this.pendingRemoteReads.get(key);
        const retry = this.remoteReadRetries.get(key);
        if (!force && retry && this.now() < retry.retryAt) return Promise.reject(retry.error);
        const intent = this.currentIntent(employeeId);
        const revision = this.remotePhotoRevisions.get(employeeId);
        const pending = this.imageClient.lookupAndDownload(coordinates(employeeId, variant))
            .then(remote => {
                this.remoteReadRetries.delete(key);
                return remote;
            })
            .catch(error => {
                // Local and backend authentication failures must not delay
                // recovery after the session/token becomes valid again.
                if (['AUTH_REQUIRED', 'AUTH_CHANGED', 'INVALID_FIREBASE_TOKEN', 'MISSING_ID_TOKEN'].includes(error?.code)) {
                    this.remoteReadRetries.delete(key);
                    throw error;
                }
                // An obsolete request must not delay recovery of a newer photo.
                if (this.currentIntent(employeeId) === intent
                    && this.remotePhotoRevisions.get(employeeId) === revision) {
                    const attempts = (retry?.attempts || 0) + 1;
                    const delay = Math.min(READ_RETRY_MAX_MS, READ_RETRY_BASE_MS * (2 ** (attempts - 1)));
                    this.remoteReadRetries.set(key, { attempts, error, retryAt: this.now() + delay });
                }
                throw error;
            })
            .finally(() => {
                if (this.pendingRemoteReads.get(key) === pending) this.pendingRemoteReads.delete(key);
            });
        this.pendingRemoteReads.set(key, pending);
        return pending;
    }

    retryPendingDelete(employeeId) {
        if (this.pendingDeletes.has(employeeId)) return this.pendingDeletes.get(employeeId);
        return this.runDelete(employeeId, { registerIntent: false });
    }

    async recoverRemoteVariant(employeeId, variant, current, intentRevision, options) {
        const remote = await this.readRemoteVariant(employeeId, variant, options);
        if (this.currentIntent(employeeId) !== intentRevision) return this.readLocal(employeeId);
        return this.enqueueLocalMutation(employeeId, async () => {
            const latest = await this.readLocal(employeeId);
            if (latest?.pendingDelete) return null;
            if (this.currentIntent(employeeId) !== intentRevision) return latest;
            const version = variant === 'thumbnail'
                ? remoteVersion(remote.asset, this.now())
                : latest?.version || remoteVersion(remote.asset, this.now());
            const patch = variant === 'thumbnail'
                ? {
                    thumbnailBlob: remote.blob,
                    version,
                    updatedAt: version,
                    remoteSyncedVersion: version,
                    remoteRevision: `thumbnail:${assetStamp(remote.asset, version)}`,
                    remoteSignalUpdatedAt: version
                }
                : {
                    optimizedBlob: remote.blob,
                    version,
                    updatedAt: latest?.updatedAt || version,
                    remoteSyncedVersion: version
                };
            return this.localStore.replaceEmployeePhoto(employeeId, mergeRecord(
                employeeId,
                latest || current,
                patch,
                this.now()
            ));
        });
    }

    async getEmployeePhoto(employeeId) {
        const id = normalizeEmployeeId(employeeId);
        const intentRevision = this.currentIntent(id);
        const current = await this.readLocal(id);
        if (current?.pendingDelete) {
            void this.retryPendingDelete(id);
            return null;
        }
        if (current?.thumbnailBlob instanceof Blob) {
            if (isUnsyncedLocalPhoto(current)) this.queueRemoteUpload(id, current);
            return current;
        }
        try {
            return await this.recoverRemoteVariant(id, 'thumbnail', current, intentRevision);
        } catch {
            const latest = await this.readLocal(id);
            return latest?.pendingDelete ? null : latest || current;
        }
    }

    async getEmployeeOriginal(employeeId) {
        const id = normalizeEmployeeId(employeeId);
        const intentRevision = this.currentIntent(id);
        const current = await this.readLocal(id);
        if (current?.pendingDelete) {
            void this.retryPendingDelete(id);
            return null;
        }
        if (current?.optimizedBlob instanceof Blob) return current;
        try {
            // Originals are requested by an explicit viewer action, rather
            // than avatar renders, so reopening must allow an immediate retry.
            return await this.recoverRemoteVariant(id, 'original', current, intentRevision, { force: true });
        } catch {
            const latest = await this.readLocal(id);
            return latest?.pendingDelete ? null : latest || current;
        }
    }

    async replaceEmployeePhoto(employeeId, value) {
        const id = normalizeEmployeeId(employeeId);
        this.nextIntent(id);
        const deletion = this.pendingDeletes.get(id);
        if (deletion) await deletion.catch(() => {});
        const record = await this.enqueueLocalMutation(
            id,
            () => this.localStore.replaceEmployeePhoto(id, value)
        );
        this.uploadRetries.delete(id);
        this.queueRemoteUpload(id, record);
        return record;
    }

    queueRemoteUpload(employeeId, record) {
        const id = normalizeEmployeeId(employeeId);
        if (!record || record.pendingDelete) return false;
        const retry = this.uploadRetries.get(id);
        if (retry && this.now() < retry.retryAt && !this.pendingSyncs.has(id)) return false;
        this.queuedRecords.set(id, record);
        if (this.pendingSyncs.has(id)) return this.pendingSyncs.get(id);
        const pending = (async () => {
            let allSynced = true;
            try {
                while (this.queuedRecords.has(id)) {
                    const target = this.queuedRecords.get(id);
                    this.queuedRecords.delete(id);
                    try {
                        const original = await this.imageClient.upload(
                            coordinates(id, 'original'),
                            target.optimizedBlob,
                            uploadFileName(id, 'original', target.optimizedBlob)
                        );
                        const thumbnail = await this.imageClient.upload(
                            coordinates(id, 'thumbnail'),
                            target.thumbnailBlob,
                            uploadFileName(id, 'thumbnail', target.thumbnailBlob)
                        );
                        const signal = {
                            state: 'ready',
                            revision: combinedRemoteRevision(original?.asset, thumbnail?.asset, this.now()),
                            updatedAt: this.now()
                        };
                        this.pendingSignalPublications.set(id, signal);
                        await this.publishSignal(id, signal);
                        await this.enqueueLocalMutation(id, async () => {
                            const current = await this.readLocal(id);
                            if (!current?.pendingDelete && current?.version === target.version) {
                                await this.localStore.replaceEmployeePhoto(id, {
                                    ...current,
                                    remoteSyncedVersion: current.version,
                                    remoteRevision: signal.revision,
                                    remoteSignalUpdatedAt: signal.updatedAt
                                });
                            }
                        });
                        this.uploadRetries.delete(id);
                    } catch (error) {
                        this.recordUploadFailure(id, error);
                        // Remote sync failures were previously swallowed whole, which made
                        // upload outages undiagnosable (photo showed locally, no requests).
                        console.warn('[employee-photo] remote sync failed', {
                            code: error?.code || null,
                            message: error?.message || String(error)
                        });
                        allSynced = false;
                    } finally {
                        this.pendingSignalPublications.delete(id);
                    }
                }
                return allSynced;
            } finally {
                if (this.pendingSyncs.get(id) === pending) this.pendingSyncs.delete(id);
            }
        })();
        this.pendingSyncs.set(id, pending);
        return pending;
    }

    async waitForPendingSync(employeeId) {
        const id = normalizeEmployeeId(employeeId);
        const deletion = this.pendingDeletes.get(id);
        if (deletion) return deletion;
        return this.pendingSyncs.get(id) || false;
    }

    async reconcileEmployeePhotoSignal(employeeId, value) {
        const id = normalizeEmployeeId(employeeId);
        const signal = normalizeEmployeePhoto(value);
        if (!id || !signal) return { status: 'error', record: await this.readLocal(id) };
        const current = await this.readLocal(id);
        const localUpdatedAt = localSignalUpdatedAt(current);

        if (localUpdatedAt !== null && signal.updatedAt < localUpdatedAt) {
            return {
                status: current?.pendingDelete ? 'pending' : 'current',
                record: current
            };
        }

        if (isUnsyncedLocalPhoto(current)) {
            this.queueRemoteUpload(id, current);
            return { status: 'pending', record: current };
        }
        if (this.pendingSignalPublications.get(id)?.revision === signal.revision) {
            return { status: 'current', record: current };
        }
        if (current?.pendingDelete && signal.state === 'ready') {
            return { status: 'pending', record: current };
        }
        if (signal.state === 'deleted') {
            if (!current) return { status: 'current', record: null };
            this.nextIntent(id);
            await this.enqueueLocalMutation(id, () => this.localStore.deleteEmployeePhoto(id));
            return { status: 'deleted', record: null };
        }
        if (current?.remoteRevision === signal.revision && current.thumbnailBlob instanceof Blob) {
            return { status: 'current', record: current };
        }

        const intentRevision = this.currentIntent(id);
        try {
            if (this.remotePhotoRevisions.get(id) !== signal.revision) {
                this.remotePhotoRevisions.set(id, signal.revision);
                this.clearRemoteReadRetries(id);
            }
            const remote = await this.readRemoteVariant(id, 'thumbnail');
            if (this.currentIntent(id) !== intentRevision) {
                return { status: 'current', record: await this.readLocal(id) };
            }
            const record = await this.enqueueLocalMutation(id, async () => {
                const latest = await this.readLocal(id);
                if (latest?.pendingDelete || isUnsyncedLocalPhoto(latest)) return latest;
                const version = Math.max(1, Math.floor(signal.updatedAt));
                return this.localStore.replaceEmployeePhoto(id, mergeRecord(id, latest, {
                    thumbnailBlob: remote.blob,
                    optimizedBlob: null,
                    version,
                    updatedAt: signal.updatedAt,
                    remoteSyncedVersion: version,
                    remoteRevision: signal.revision,
                    remoteSignalUpdatedAt: signal.updatedAt
                }, this.now()));
            });
            return { status: 'updated', record };
        } catch {
            return { status: 'error', record: await this.readLocal(id) || current };
        }
    }

    async evictStaleOriginals(maxAgeMs = DEFAULT_ORIGINAL_RETENTION_MS) {
        let records;
        try {
            records = await this.localStore.listEmployeePhotos?.();
        } catch {
            return { evicted: 0, scanned: 0 };
        }
        if (!Array.isArray(records)) return { evicted: 0, scanned: 0 };
        let evicted = 0;
        for (const record of records) {
            if (!record || record.pendingDelete === true) continue;
            // Nunca se desaloja una foto local sin sincronizar: el remoto aún
            // no tiene el original y el desalojo implicaría pérdida de datos.
            if (record.remoteSyncedVersion !== record.version) continue;
            if (!(record.optimizedBlob instanceof Blob)) continue;
            const reference = Number.isFinite(record.remoteSignalUpdatedAt)
                ? record.remoteSignalUpdatedAt
                : Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
            if (this.now() - reference <= maxAgeMs) continue;
            const didEvict = await this.enqueueLocalMutation(record.employeeId, async () => {
                const latest = await this.readLocal(record.employeeId);
                if (!latest || latest.pendingDelete) return false;
                if (latest.remoteSyncedVersion !== latest.version) return false;
                if (!(latest.optimizedBlob instanceof Blob)) return false;
                await this.localStore.replaceEmployeePhoto(latest.employeeId || record.employeeId, {
                    ...latest,
                    optimizedBlob: null,
                    optimizedMimeType: null
                });
                return true;
            }).catch(() => false);
            if (didEvict) evicted += 1;
        }
        return { evicted, scanned: records.length };
    }

    async reconcileEmployeePhotoSignals(employees) {
        const candidates = (Array.isArray(employees) ? employees : [])
            .filter(employee => employee?.id && normalizeEmployeePhoto(employee.photo));
        const results = await Promise.allSettled(candidates.map(employee =>
            this.reconcileEmployeePhotoSignal(employee.id, employee.photo)
        ));
        void this.evictStaleOriginals().catch(() => {});
        return results;
    }

    async refreshEmployeePhoto(employeeId) {
        const id = normalizeEmployeeId(employeeId);
        const current = await this.readLocal(id);
        if (!id || current?.pendingDelete || isUnsyncedLocalPhoto(current)) {
            return { status: 'error', record: current };
        }
        const intentRevision = this.currentIntent(id);
        try {
            const [original, thumbnail] = await Promise.all([
                this.readRemoteVariant(id, 'original', { force: true }),
                this.readRemoteVariant(id, 'thumbnail', { force: true })
            ]);
            const revision = combinedRemoteRevision(original.asset, thumbnail.asset, this.now());
            if (current?.remoteRevision === revision) return { status: 'current', record: current };
            if (this.currentIntent(id) !== intentRevision) {
                return { status: 'error', record: await this.readLocal(id) || current };
            }
            const record = await this.enqueueLocalMutation(id, async () => {
                const latest = await this.readLocal(id);
                if (latest?.pendingDelete || isUnsyncedLocalPhoto(latest)) return latest;
                const version = Math.max(
                    1,
                    remoteVersion(original.asset, this.now()),
                    remoteVersion(thumbnail.asset, this.now())
                );
                return this.localStore.replaceEmployeePhoto(id, mergeRecord(id, latest, {
                    thumbnailBlob: thumbnail.blob,
                    optimizedBlob: original.blob,
                    version,
                    updatedAt: version,
                    remoteSyncedVersion: version,
                    remoteRevision: revision,
                    remoteSignalUpdatedAt: version
                }, this.now()));
            });
            return { status: 'updated', record };
        } catch {
            return { status: 'error', record: await this.readLocal(id) || current };
        }
    }

    deleteEmployeePhoto(employeeId) {
        return this.runDelete(normalizeEmployeeId(employeeId), { registerIntent: true });
    }

    runDelete(employeeId, { registerIntent }) {
        if (registerIntent) this.nextIntent(employeeId);
        if (this.pendingDeletes.has(employeeId)) return this.pendingDeletes.get(employeeId);
        const pending = (async () => {
            const activeSync = this.pendingSyncs.get(employeeId);
            if (activeSync) await activeSync.catch(() => false);
            let current;
            let deleteIntentAt;
            let pendingVariants;
            let deleteRevision;
            await this.enqueueLocalMutation(employeeId, async () => {
                current = await this.readLocal(employeeId);
                deleteIntentAt = current?.pendingDelete ? current.deleteIntentAt : this.now();
                pendingVariants = current?.pendingDelete
                    ? PHOTO_VARIANTS.filter(variant => current.pendingDeleteVariants?.includes(variant))
                    : [...PHOTO_VARIANTS];
                deleteRevision = current?.deleteRevision || `deleted:${deleteIntentAt}`;
                if (!current?.pendingDelete) {
                    await this.localStore.replaceEmployeePhoto(
                        employeeId,
                        tombstone(employeeId, current, pendingVariants, deleteIntentAt, { deleteRevision })
                    );
                }
            });

            for (const variant of [...pendingVariants]) {
                try {
                    const result = await this.imageClient.delete(coordinates(employeeId, variant));
                    if (result?.cleanupPending === true) continue;
                    pendingVariants = pendingVariants.filter(item => item !== variant);
                } catch { /* the durable tombstone keeps this variant hidden and retryable */ }
            }

            if (!pendingVariants.length) {
                const signal = { state: 'deleted', revision: deleteRevision, updatedAt: deleteIntentAt };
                try {
                    await this.publishSignal(employeeId, signal);
                    await this.enqueueLocalMutation(
                        employeeId,
                        () => this.localStore.deleteEmployeePhoto(employeeId)
                    );
                    return { complete: true, pendingVariants: [] };
                } catch { /* retain a signal-only tombstone for a later retry */ }
            }
            await this.enqueueLocalMutation(employeeId, () => this.localStore.replaceEmployeePhoto(
                employeeId,
                tombstone(employeeId, current, pendingVariants, deleteIntentAt, {
                    pendingDeleteSignal: pendingVariants.length === 0,
                    deleteRevision
                })
            ));
            return { complete: false, pendingVariants };
        })().finally(() => {
            if (this.pendingDeletes.get(employeeId) === pending) this.pendingDeletes.delete(employeeId);
        });
        this.pendingDeletes.set(employeeId, pending);
        return pending;
    }
}

export const employeePhotoService = new EmployeePhotoService({
    publishSignal: (employeeId, signal) => EmployeeRepository.savePhotoSignal(employeeId, signal)
});
