/**
 * PettyCashUI — pantalla de Caja Chica (Fase 1, integración Paso 4 · opción C).
 *
 * State PLANO: { projects[], periods[], movements[] } (per-doc, enlazado por
 * projectId/periodId). La vista anidada se compone con selectores puros.
 *
 * Persistencia (opción C):
 *   - localStorage como caché local (offline básico, sin tocar el schema de
 *     IndexedDB todavía).
 *   - Firestore vía PettyCashRepository en cada cambio (si hay sesión).
 *   - PettyCashLiveSync aplica cambios remotos (multi-dispositivo).
 * La migración a stores propios de IndexedDB (opción A) queda para después.
 */

import { state } from '../../core/AppState.js';
import icons from '../../ui/IconSystem.js';
import { Modal } from '../../components/Modal.js';
import {
    resumenPeriodo, round2,
    periodsOfProject, movementsOfPeriod, saldoProyectoFlat
} from './PettyCashCalc.js';
import { PettyCashRepository } from '../../services/PettyCashRepository.js';
import { PettyCashLiveSync } from '../../services/PettyCashLiveSync.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { PettyCashStore } from './PettyCashStore.js';
import {
    createReceiptPreview,
    prepareReceiptForOcr,
    cloneOriginalReceipt,
    blobToDataUrl,
    isPdfReceipt,
    receiptMimeType,
    requestPersistentReceiptStorage
} from './PettyCashPhoto.js';
import {
    normalizeReceiptOcr,
    applyReceiptOcrToMovement,
    applyReceiptOcrToForm,
    requestReceiptOcr,
    receiptRetryState
} from './PettyCashReceiptOCR.js';
import { createReceiptQueueProcessor } from './PettyCashReceiptProcessor.js';
import {
    isReceiptReadyForBackup,
    uploadReceiptBackup,
    lookupReceiptBackup
} from './PettyCashReceiptBackup.js';
import {
    formatPettyCashDate,
    isEmptyReceiptPlaceholder,
    isReceiptJobIncomplete,
    summarizeReceiptBatch
} from './PettyCashPresentation.js';
import { buildPeriodSheets } from './PettyCashExport.js';
import {
    allocatePettyCashRecordNumber,
    formatPettyCashRecordNumber,
    normalizePettyCashRecordNumbers
} from './PettyCashRecordNumber.js';
import { APP_CONFIG } from '../../config/Config.js';
import { auth } from '../../data/firebase.js';
import { ensureExcelJSLoaded } from '../../utils/LazyExcelJS.js';

const SEL_KEY = '_pettycash_sel_v1'; // solo la selección de UI (los datos van a IndexedDB)
const CATEGORIAS = ['Materiales', 'Transporte', 'Comida', 'Herramientas', 'Mano de obra', 'Combustible', 'Otros'];

// ── state ─────────────────────────────────────────────────────────────
// Los DATOS (projects/periods/movements) viven en IndexedDB (vía PettyCashStore)
// y se cargan async a state.pettyCash en el arranque. localStorage solo guarda
// la selección de UI (proyecto/periodo activos), que es chica y desechable.
function _base() {
    return { projects: [], periods: [], movements: [], selectedProjectId: null, selectedPeriodId: null, form: null, periodForm: null, editMov: null };
}
function _loadSelection() {
    try { return JSON.parse(localStorage.getItem(SEL_KEY)) || {}; } catch { return {}; }
}
function pc() {
    if (!state.pettyCash) {
        const sel = _loadSelection();
        state.pettyCash = { ..._base(), selectedProjectId: sel.selectedProjectId || null, selectedPeriodId: sel.selectedPeriodId || null };
    }
    return state.pettyCash;
}
// Persistir SOLO la selección (los datos se guardan por item en PettyCashStore).
function persist() {
    try {
        const d = pc();
        localStorage.setItem(SEL_KEY, JSON.stringify({ selectedProjectId: d.selectedProjectId, selectedPeriodId: d.selectedPeriodId }));
    } catch { /* noop */ }
}

// ── persistencia durable: IndexedDB local + outbox + Firestore ────────
// `announce` (opcional): etiqueta para el toast HONESTO del resultado —
// verde si llegó a la nube, amarillo si quedó solo local, rojo si ni local.
const saveProject  = (p, announce) => PettyCashStore.save('projects', p, { announce });
const savePeriod   = (p, announce) => PettyCashStore.save('periods', p, { announce });
const saveMovement = (m, announce) => PettyCashStore.save('movements', m, { announce });
const removeProjectDoc  = (id, announce) => PettyCashStore.remove('projects', id, { announce });
const removePeriodDoc   = (id, announce) => PettyCashStore.remove('periods', id, { announce });
const removeMovementDoc = (id, announce) => PettyCashStore.remove('movements', id, { announce });

async function assignNewMovementIdentity(movement, period, createdAt = Date.now()) {
    const d = pc();
    const project = d.projects.find((item) => item.id === period?.projectId);
    if (!project) throw new Error('No se encontró el proyecto del movimiento.');
    movement.createdAt = Number(createdAt) || Date.now();
    movement.recordNumber = allocatePettyCashRecordNumber(project, d.movements, movement.createdAt);
    await saveProject(project);
    return movement;
}

async function normalizeMovementIdentity(d = pc()) {
    const { changedProjects, changedMovements } = normalizePettyCashRecordNumbers(
        d.projects,
        d.movements
    );
    await Promise.all([
        ...changedProjects.map((project) => saveProject(project)),
        ...changedMovements.map((movement) => saveMovement(movement))
    ]);
    return { changedProjects, changedMovements };
}

async function prepareReceiptCapture(file) {
    const isPdf = isPdfReceipt(file);
    const originalBlob = cloneOriginalReceipt(file);
    if (!originalBlob) throw new Error('Comprobante inválido.');
    await requestPersistentReceiptStorage();
    const preview = await createReceiptPreview(file);
    const prepared = preview.processingDataUrl
        ? {
            fileDataUrl: preview.processingDataUrl,
            mimeType: 'image/jpeg',
            fileName: file?.name || 'factura.jpg'
        }
        : await prepareReceiptForOcr(file);
    return {
        originalBlob,
        processingDataUrl: prepared.fileDataUrl,
        processingMimeType: prepared.mimeType,
        previewDataUrl: preview.previewDataUrl,
        originalName: file?.name || null,
        originalType: receiptMimeType(file) || originalBlob.type || null,
        originalSize: Number(file?.size) || Number(originalBlob.size) || 0,
        originalLastModified: Number(file?.lastModified) || null,
        receiptKind: isPdf ? 'pdf' : 'image',
        pageCount: preview.pageCount
    };
}

async function saveLocalReceiptCapture(txId, capture, metadata = {}) {
    return indexedDBService.saveReceiptOriginal(
        txId,
        capture.originalBlob,
        capture.previewDataUrl,
        {
            originalName: capture.originalName,
            originalType: capture.originalType,
            originalSize: capture.originalSize,
            originalLastModified: capture.originalLastModified,
            receiptKind: capture.receiptKind,
            pageCount: capture.pageCount,
            ...metadata
        }
    );
}

async function enqueueReceiptFile(file, period) {
    if (!file || !period) throw new Error('No hay una factura o periodo válido.');
    const capture = await prepareReceiptCapture(file);
    const now = Date.now();
    const movement = {
        id: uid('mov'),
        periodId: period.id,
        projectId: period.projectId,
        type: 'gasto',
        amount: 0,
        date: today(),
        hasReceipt: true,
        receiptStatus: 'local',
        receiptStorage: 'local-only',
        receiptKind: capture.receiptKind,
        receiptMimeType: capture.originalType,
        receiptPageCount: capture.pageCount,
        reviewPending: true,
        createdBy: 'app',
        updatedAt: now
    };
    await assignNewMovementIdentity(movement, period, now);
    await saveLocalReceiptCapture(movement.id, capture, {
        periodId: period.id,
        projectId: period.projectId,
        queueStatus: 'queued',
        ocrStatus: 'pending'
    });
    pc().movements.push(movement);
    await saveMovement(movement);
    return { movement, capture };
}

let _receiptQueueProcessor = null;
let _receiptQueueFollowUpTimer = null;

function scheduleReceiptQueueFollowUp() {
    if (_receiptQueueFollowUpTimer !== null) return;
    _receiptQueueFollowUpTimer = setTimeout(() => {
        _receiptQueueFollowUpTimer = null;
        const processor = getReceiptQueueProcessor();
        if (processor.isRunning()) {
            scheduleReceiptQueueFollowUp();
            return;
        }
        pc().receiptQueueRequested = false;
        processPendingReceiptJobs().catch((error) => {
            console.warn('receipt queue follow-up', error);
        });
    }, 250);
}

async function refreshReceiptQueueSummary() {
    try {
        const jobs = await indexedDBService.listReceiptJobs();
        const counts = {
            active: 0,
            paused: 0,
            review: 0,
            drafts: 0
        };
        jobs.forEach((job) => {
            if (job.queueStatus === 'draft') counts.drafts++;
            else if (job.queueStatus === 'paused') counts.paused++;
            else if (job.queueStatus === 'awaiting-review') counts.review++;
            else if (['queued', 'retry-wait', 'waiting-network', 'waiting-session', 'processing'].includes(job.queueStatus)) counts.active++;
        });
        const d = pc();
        d.receiptQueueSummary = counts;
        d.receiptQueueHiddenIds = jobs
            .filter(isReceiptJobIncomplete)
            .map((job) => job.txId);

        const batchProgress = summarizeReceiptBatch(d.receiptBatchProgress, jobs);
        if (batchProgress) {
            d.batchStatus = batchProgress.label;
            if (batchProgress.finished && batchProgress.failedToSave === 0) {
                d.receiptBatchProgress = null;
                d.batchStatus = null;
            }
        }
        window.render?.();
        return counts;
    } catch (error) {
        console.warn('receipt queue summary', error);
        return { active: 0, paused: 0, review: 0, drafts: 0 };
    }
}

function getReceiptQueueProcessor() {
    if (_receiptQueueProcessor) return _receiptQueueProcessor;
    _receiptQueueProcessor = createReceiptQueueProcessor({
        receiptStore: indexedDBService,
        getMovement: (id) => pc().movements.find((movement) => movement.id === id),
        saveMovement,
        getIdToken: async () => auth?.currentUser?.getIdToken(),
        getOcrUrl: () => APP_CONFIG?.OCR_WEBHOOK_URL,
        allowedCategories: CATEGORIAS,
        onProgress: refreshReceiptQueueSummary
    });
    return _receiptQueueProcessor;
}

export async function processPendingReceiptJobs(options = {}) {
    const d = pc();
    const processor = getReceiptQueueProcessor();
    if (processor.isRunning()) {
        d.receiptQueueRequested = true;
        scheduleReceiptQueueFollowUp();
        return { running: true, processed: 0, failed: 0, skipped: 0 };
    }
    d.receiptQueueRunning = true;
    window.render?.();
    try {
        return await processor.process(options);
    } finally {
        d.receiptQueueRunning = false;
        await refreshReceiptQueueSummary();
        if (d.receiptQueueRequested) {
            scheduleReceiptQueueFollowUp();
        }
    }
}

async function recoverLocalReceiptDrafts() {
    const d = pc();
    const jobs = await indexedDBService.listReceiptJobs([
        'draft',
        'queued',
        'retry-wait',
        'waiting-network',
        'waiting-session',
        'processing'
    ]).catch(() => []);
    if (!jobs.length) return 0;
    const periodById = new Map(d.periods.map((period) => [period.id, period]));
    let recovered = 0;

    for (const job of jobs) {
        const existing = d.movements.find((movement) => movement.id === job.txId);
        if (existing) {
            if (job.queueStatus === 'draft' || job.queueStatus === 'processing') {
                await indexedDBService.updateReceiptJob(job.txId, {
                    queueStatus: 'queued',
                    ocrStatus: job.ocrStatus === 'extracted' ? 'extracted' : 'pending'
                });
            }
            recovered++;
            continue;
        }
        const period = periodById.get(job.periodId);
        if (!period) continue;
        const captured = Number(job.createdAt) ? new Date(Number(job.createdAt)) : new Date();
        const now = Date.now();
        const movement = {
            id: job.txId,
            periodId: period.id,
            projectId: job.projectId || period.projectId,
            type: 'gasto',
            amount: 0,
            date: captured.toISOString().slice(0, 10),
            hasReceipt: true,
            receiptStatus: 'local',
            receiptStorage: 'local-only',
            reviewPending: true,
            recoveredFromReceipt: true,
            createdBy: 'app',
            updatedAt: now
        };
        await assignNewMovementIdentity(movement, period, Number(job.createdAt) || now);
        d.movements.push(movement);
        await saveMovement(movement);
        await indexedDBService.updateReceiptJob(job.txId, {
            queueStatus: 'queued',
            ocrStatus: 'pending',
            recoveredAt: Date.now()
        });
        recovered++;
    }
    return recovered;
}

function dedupById(arr) {
    return arr ? [...new Map(arr.map(i => [i.id, i])).values()] : [];
}

// ── helpers varios ────────────────────────────────────────────────────
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function rd(n) { return 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function currentProject() {
    const d = pc();
    return d.projects.find(p => p.id === d.selectedProjectId) || null;
}
function currentPeriod() {
    const d = pc();
    return d.periods.find(p => p.id === d.selectedPeriodId) || null;
}

// ══ carga local (IndexedDB) — corre al arrancar, con o sin sesión ═════════
let _pcLocalLoadPromise = null;
export async function loadPettyCashLocal() {
    if (_pcLocalLoadPromise) return _pcLocalLoadPromise;
    _pcLocalLoadPromise = (async () => {
        const d = pc();
        try {
            await PettyCashStore.migrateFromLocalStorage();
            const local = await PettyCashStore.loadLocal();
            d.projects = dedupById(local.projects);
            d.periods = dedupById(local.periods);
            d.movements = dedupById(local.movements);
            await normalizeMovementIdentity(d);
            await recoverLocalReceiptDrafts();
            await refreshReceiptQueueSummary();
            window.render?.();
        } catch (e) {
            console.warn('⚠️ loadPettyCashLocal:', e);
        }
    })();
    return _pcLocalLoadPromise;
}

// ══ carga inicial + live sync (llamado desde app.js tras login) ════════
export async function startPettyCashSync() {
    const d = pc();
    await loadPettyCashLocal();          // primero lo local (offline-safe)
    PettyCashStore.flush();              // empujar cambios pendientes (offline → nube)
    PettyCashStore.flushMirror();        // espejo secundario; nunca bloquea Firebase

    try {
        const [projects, periods, movements] = await Promise.all([
            PettyCashRepository.projects.loadAll(),
            PettyCashRepository.periods.loadAll(),
            PettyCashRepository.movements.loadAll()
        ]);
        if (projects.length || periods.length || movements.length) {
            d.projects = dedupById(projects);
            d.periods = dedupById(periods);
            d.movements = dedupById(movements);
            // Espejar lo de la nube al IndexedDB local (caché offline).
            await Promise.all([
                PettyCashStore.applyRemote('projects', d.projects),
                PettyCashStore.applyRemote('periods', d.periods),
                PettyCashStore.applyRemote('movements', d.movements)
            ]);
            await normalizeMovementIdentity(d);
            window.render?.();
        }
    } catch (e) {
        console.warn('⚠️ startPettyCashSync loadAll:', e);
    }

    PettyCashLiveSync.start({
        projects: {
            subscribe: (cb) => PettyCashRepository.projects.subscribe(cb),
            onApply: (list) => { const l = dedupById(list); pc().projects = l; PettyCashStore.applyRemote('projects', l); window.render?.(); }
        },
        periods: {
            subscribe: (cb) => PettyCashRepository.periods.subscribe(cb),
            onApply: (list) => { const l = dedupById(list); pc().periods = l; PettyCashStore.applyRemote('periods', l); window.render?.(); }
        },
        movements: {
            subscribe: (cb) => PettyCashRepository.movements.subscribe(cb),
            onApply: async (list) => {
                const l = dedupById(list);
                pc().movements = l;
                await PettyCashStore.applyRemote('movements', l);
                await normalizeMovementIdentity(pc());
                window.render?.();
            }
        }
    });

    // Reanudar OCR local después de tener movimientos y sesión disponibles.
    processPendingReceiptJobs().catch((e) => console.warn('receipt queue startup', e));

    // Respaldar comprobantes confirmados que todavía están solo en local.
    uploadPendingReceipts();
}

function receiptOcrMetadata(movement) {
    if (!movement) return {};
    const fields = [
        'rncEmisor', 'ncf', 'cliente', 'rncCliente', 'subtotal', 'itbis',
        'total', 'fechaEmision', 'fechaVencimiento', 'notas', 'items'
    ];
    return fields.reduce((result, field) => {
        if (movement[field] !== undefined && movement[field] !== null) {
            result[field] = movement[field];
        }
        return result;
    }, {});
}

// Respalda en Supabase (vía n8n) únicamente originales ya confirmados por el
// usuario. El Blob local se conserva; los reintentos son idempotentes por txId.
let _uploadingReceipts = false;
export async function uploadPendingReceipts() {
    if (_uploadingReceipts) return;
    const url = APP_CONFIG && APP_CONFIG.RECEIPT_UPLOAD_URL;
    const user = auth && auth.currentUser;
    if (!url || !user) return;
    let pend = [];
    try {
        const confirmed = await indexedDBService.listReceiptJobs(['confirmed']);
        pend = confirmed.filter(isReceiptReadyForBackup);
    } catch { return; }
    if (!pend || !pend.length) return;
    _uploadingReceipts = true;
    try {
        const idToken = await user.getIdToken();
        for (const rec of pend) {
            try {
                const movement = pc().movements.find(m => m.id === rec.txId);
                const fileDataUrl = await blobToDataUrl(rec.originalBlob);
                await indexedDBService.updateReceiptJob(rec.txId, {
                    uploadStatus: 'uploading',
                    uploadLastError: null
                });
                const data = await uploadReceiptBackup({
                    url,
                    idToken,
                    txId: rec.txId,
                    fileDataUrl,
                    mimeType: rec.originalType || rec.originalBlob?.type || 'image/jpeg',
                    originalName: rec.originalName || null,
                    pageCount: rec.pageCount || null,
                    projectId: rec.projectId || movement?.projectId || null,
                    periodId: rec.periodId || movement?.periodId || null,
                    userConfirmedAt: rec.userConfirmedAt,
                    ocr: receiptOcrMetadata(movement),
                    movement: movement || {}
                });
                await indexedDBService.updateReceiptJob(rec.txId, {
                    status: 'uploaded',
                    uploadStatus: 'uploaded',
                    remotePath: data.path || data.receipt?.storage_path || null,
                    remoteUploadedAt: Date.now(),
                    uploadLastError: null
                });
                if (movement) {
                    movement.receiptStatus = 'uploaded';
                    movement.receiptStorage = 'supabase';
                    movement.receiptUrl = data.path || data.receipt?.storage_path || null;
                    movement.updatedAt = Date.now();
                    saveMovement(movement);
                }
            } catch (e) {
                console.warn('⚠️ uploadPendingReceipts(' + rec.txId + '):', e);
                const attempts = (Number(rec.uploadAttempts) || 0) + 1;
                await indexedDBService.updateReceiptJob(rec.txId, {
                    uploadStatus: 'retry-wait',
                    uploadAttempts: attempts,
                    uploadLastError: e.message || 'Error de respaldo',
                    nextUploadRetryAt: Date.now() + Math.min(60 * 60 * 1000, 15_000 * (2 ** Math.min(attempts, 6)))
                }).catch(() => null);
            }
        }
        persist(); window.render?.();
    } finally {
        _uploadingReceipts = false;
    }
}

// ══ render ═════════════════════════════════════════════════════════════
export function PettyCashTab() {
    const d = pc();
    // Auto-seleccionar el primer proyecto/periodo si no hay nada seleccionado
    // (en un dispositivo nuevo selectedProjectId viene null aunque haya datos).
    if (!d.selectedProjectId && d.projects.length) {
        d.selectedProjectId = d.projects[0].id;
    }
    if (d.selectedProjectId && !d.selectedPeriodId) {
        const pers = periodsOfProject(d.periods, d.selectedProjectId);
        if (pers.length) d.selectedPeriodId = pers[0].id;
    }
    const proj = currentProject();
    return `
    <div class="pc-wrap" style="max-width:980px;margin:0 auto;padding:16px;color:#e2e8f0;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
            <h2 style="margin:0;font-size:1.4rem;display:flex;align-items:center;gap:8px;">
                ${icons.get('dollar', { size: 22 })} Caja Chica
            </h2>
        </div>
        ${_receiptQueueBanner(d)}
        ${_projectBar(d)}
        ${proj ? _projectBody(proj) : _emptyProjects()}
    </div>`;
}

function _receiptQueueBanner(d) {
    const summary = d.receiptQueueSummary || {};
    const pending = Number(summary.active) || 0;
    const paused = Number(summary.paused) || 0;
    if (!pending && !paused) return '';
    const running = !!d.receiptQueueRunning;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const border = paused ? '#ef4444' : (offline ? '#f59e0b' : '#0ea5e9');
    const label = [
        pending ? `${pending} pendiente${pending === 1 ? '' : 's'}` : '',
        paused ? `${paused} pausada${paused === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;background:#172033;border:1px solid ${border};border-radius:10px;">
        <div>
            <div style="font-weight:700;font-size:.85rem;">Facturas por procesar</div>
            <div style="font-size:.72rem;color:#94a3b8;">${esc(label)}${offline ? ' · Sin conexión' : ''}</div>
        </div>
        <button type="button" data-app-fn="pcContinueReceiptQueue" ${running || offline ? 'disabled' : ''}
            style="background:${running || offline ? '#334155' : '#0ea5e9'};color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:${running || offline ? 'not-allowed' : 'pointer'};">
            ${running ? 'Procesando…' : 'Continuar pendientes'}
        </button>
    </div>`;
}

function _cameraBatchModal(session) {
    if (!session?.active) return '';
    const count = Number(session.count) || 0;
    return `
    <div role="dialog" aria-modal="true" aria-labelledby="pc-camera-batch-title"
        style="position:fixed;inset:0;z-index:1200;background:rgba(2,6,23,.82);display:flex;align-items:center;justify-content:center;padding:18px;">
        <div style="width:min(430px,100%);background:#111827;border:1px solid #334155;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;">
            <div style="padding:16px 18px;border-bottom:1px solid #273449;">
                <div id="pc-camera-batch-title" style="font-size:1rem;font-weight:800;color:#f8fafc;">Facturas desde la cámara</div>
                <div style="font-size:.76rem;color:#94a3b8;margin-top:4px;">Cada foto se guarda completa en este dispositivo antes de continuar.</div>
            </div>
            <div style="padding:16px 18px;">
                ${session.lastPreviewDataUrl
                    ? `<img src="${session.lastPreviewDataUrl}" alt="Última factura capturada" style="display:block;width:100%;height:190px;object-fit:contain;background:#020617;border:1px solid #26364d;border-radius:10px;">`
                    : '<div style="height:150px;border:1px dashed #475569;border-radius:10px;display:grid;place-items:center;color:#64748b;">Sin capturas todavía</div>'}
                <div aria-live="polite" style="margin-top:12px;padding:10px 12px;background:#0b1220;border:1px solid #26364d;border-radius:9px;display:flex;justify-content:space-between;gap:12px;">
                    <span style="color:#94a3b8;font-size:.78rem;">Guardadas localmente</span>
                    <strong style="color:#22d3ee;">${count}</strong>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1.35fr;gap:10px;padding:0 18px 18px;">
                <button type="button" data-app-fn="pcFinishCameraBatch"
                    style="min-height:44px;background:#263244;border:1px solid #475569;border-radius:9px;color:#f8fafc;font-weight:750;cursor:pointer;">Terminar</button>
                <label style="min-height:44px;background:#06b6d4;border-radius:9px;color:#06202a;font-weight:850;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                    ${icons.get('camera', { size: 17 })} Otra foto
                    <input type="file" accept="image/*" capture="environment" onchange="window.pcCameraBatchPhoto(this)" style="display:none;">
                </label>
            </div>
        </div>
    </div>`;
}

function _projectBar(d) {
    const options = d.projects.map(p =>
        `<option value="${p.id}" ${p.id === d.selectedProjectId ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;">
        <select onchange="window.pcSelectProject(this.value)"
            style="flex:1;min-width:180px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:9px 12px;font-size:.95rem;">
            <option value="">— Selecciona un proyecto —</option>
            ${options}
        </select>
        ${d.selectedProjectId ? `
        <button type="button" data-app-fn="pcEditProject" title="Renombrar proyecto"
            style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:9px 12px;cursor:pointer;">✏️</button>
        <button type="button" data-app-fn="pcDeleteProject" title="Eliminar proyecto"
            style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:9px 12px;cursor:pointer;">🗑️</button>` : ''}
        <button type="button" data-app-fn="pcNewProject"
            style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;">+ Proyecto</button>
    </div>`;
}

function _emptyProjects() {
    return `<div style="text-align:center;padding:48px 20px;color:#64748b;">
        <div style="font-size:3rem;opacity:.4;">🏗️</div>
        <p>Crea tu primer proyecto/obra para empezar.</p>
    </div>`;
}

function _projectBody(proj) {
    const d = pc();
    const periods = periodsOfProject(d.periods, proj.id);
    const totalProyecto = saldoProyectoFlat(d.movements, proj.id);
    const period = currentPeriod();

    const periodChips = periods.map(p => {
        const r = resumenPeriodo(movementsOfPeriod(d.movements, p.id));
        const active = period && p.id === period.id;
        const color = r.saldo < 0 ? '#f87171' : '#34d399';
        return `<button type="button" data-app-fn="pcSelectPeriod" data-arg="${p.id}"
            style="text-align:left;background:${active ? '#0f3a4d' : '#1e293b'};border:1px solid ${active ? '#0ea5e9' : '#334155'};border-radius:10px;padding:10px 12px;cursor:pointer;min-width:150px;">
            <div style="font-weight:600;font-size:.85rem;">${esc(p.label)} ${p.status === 'cerrada' ? '🔒' : ''}</div>
            <div style="color:${color};font-weight:700;margin-top:4px;">${rd(r.saldo)}</div>
        </button>`;
    }).join('');

    return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <div style="font-size:.8rem;color:#94a3b8;">Saldo total del proyecto</div>
        <div style="font-size:1.25rem;font-weight:800;color:${totalProyecto < 0 ? '#f87171' : '#34d399'};">${rd(totalProyecto)}</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;margin-bottom:18px;">
        ${periodChips}
        <button type="button" data-app-fn="pcNewPeriod"
            style="background:transparent;border:1px dashed #475569;color:#94a3b8;border-radius:10px;padding:10px 14px;cursor:pointer;min-width:120px;">+ Periodo</button>
    </div>
    ${period ? _periodPanel(period) : '<div style="color:#64748b;padding:20px 0;">Selecciona o crea un periodo de caja.</div>'}`;
}

function _periodPanel(period) {
    const d = pc();
    const movs = movementsOfPeriod(d.movements, period.id);
    const hiddenReceiptIds = new Set(d.receiptQueueHiddenIds || []);
    const visibleMovs = movs.filter((movement) =>
        !hiddenReceiptIds.has(movement.id) || !isEmptyReceiptPlaceholder(movement)
    );
    const r = resumenPeriodo(movs);
    const cerrada = period.status === 'cerrada';
    const form = d.form;
    const periodForm = d.periodForm;
    const editMov = d.editMov ? movs.find(m => m.id === d.editMov) : null;

    return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
                <div style="font-weight:700;font-size:1.05rem;display:flex;align-items:center;gap:8px;">
                    ${esc(period.label)} ${cerrada ? '<span style="font-size:.7rem;color:#fbbf24;">🔒 cerrada</span>' : ''}
                    <button type="button" data-app-fn="pcEditPeriod" title="Editar nombre / fechas" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:.85rem;">✏️</button>
                    <button type="button" data-app-fn="pcDeletePeriod" title="Eliminar periodo" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:.85rem;">🗑️</button>
                </div>
                <div style="font-size:.72rem;color:#64748b;margin-top:4px;">📅 Apertura: ${esc(formatPettyCashDate(period.openingDate))} · Cierre: ${esc(formatPettyCashDate(period.closingDate))}</div>
            </div>
            ${cerrada ? '' : `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" data-app-fn="pcOpenForm" data-arg="reposicion" style="background:#22c55e;color:#062;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">+ Reposición</button>
                <button type="button" data-app-fn="pcOpenForm" data-arg="gasto" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;">− Gasto</button>
                <label style="background:#8b5cf6;color:#fff;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;" title="Tomar varias fotos consecutivas">
                    ${icons.get('camera', { size: 16 })} Cámara
                    <input type="file" accept="image/*" capture="environment" onchange="window.pcCameraBatchPhoto(this)" style="display:none;">
                </label>
                <label style="background:#263244;color:#fff;border:1px solid #475569;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;" title="Elegir varias facturas de la galería">
                    ${icons.get('image', { size: 16 })} Archivos
                    <input type="file" accept="image/*,application/pdf" multiple onchange="window.pcBatchPhotos(this)" style="display:none;">
                </label>
            </div>`}
        </div>

        ${d.batchStatus ? `<div style="margin:10px 0;font-size:.85rem;color:#a78bfa;display:flex;align-items:center;gap:8px;">⏳ ${esc(d.batchStatus)}</div>` : ''}
        ${_cameraBatchModal(d.cameraBatchSession)}

        ${periodForm ? _periodEditForm(period) : ''}

        <div style="display:flex;gap:18px;flex-wrap:wrap;margin:14px 0;padding:12px;background:#1e293b;border-radius:10px;">
            <div><div style="font-size:.7rem;color:#94a3b8;">Saldo</div><div style="font-weight:800;font-size:1.2rem;color:${r.saldo < 0 ? '#f87171' : '#34d399'};">${rd(r.saldo)}</div></div>
            <div><div style="font-size:.7rem;color:#94a3b8;">Reposiciones</div><div style="font-weight:600;color:#34d399;">${rd(r.reposiciones)}</div></div>
            <div><div style="font-size:.7rem;color:#94a3b8;">Gastos</div><div style="font-weight:600;color:#f87171;">${rd(r.gastos)}</div></div>
            ${r.reembolso > 0 ? `<div><div style="font-size:.7rem;color:#fbbf24;">Por reembolsar</div><div style="font-weight:800;color:#fbbf24;">${rd(r.reembolso)}</div></div>` : ''}
        </div>

        ${cerrada && period.efectivoContado !== undefined && period.efectivoContado !== null ? _conciliacionBlock(period) : ''}
        ${form && !cerrada ? _movementForm(form) : ''}
        ${editMov ? _movementEditForm(editMov, cerrada) : ''}
        ${_movementsList(visibleMovs, cerrada)}

        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
            <button type="button" data-app-fn="pcExportExcel" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.85rem;">⬇️ Excel</button>
            ${cerrada ? '' : `<button type="button" data-app-fn="pcClosePeriod" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.85rem;">🔒 Cerrar periodo</button>`}
        </div>
    </div>`;
}

function _conciliacionBlock(period) {
    const dif = Number(period.diferencia || 0);
    const estado = dif === 0 ? { t: 'Cuadra ✓', c: '#34d399' } : dif > 0 ? { t: 'Sobra', c: '#fbbf24' } : { t: 'Falta', c: '#f87171' };
    return `<div style="display:flex;gap:18px;flex-wrap:wrap;margin:0 0 14px;padding:12px;background:#172033;border:1px solid #334155;border-radius:10px;">
        <div><div style="font-size:.7rem;color:#94a3b8;">Efectivo contado</div><div style="font-weight:700;">${rd(period.efectivoContado)}</div></div>
        <div><div style="font-size:.7rem;color:#94a3b8;">Saldo calculado</div><div style="font-weight:700;">${rd(period.saldoFinal)}</div></div>
        <div><div style="font-size:.7rem;color:${estado.c};">Diferencia · ${estado.t}</div><div style="font-weight:800;color:${estado.c};">${rd(dif)}</div></div>
    </div>`;
}

function _periodEditForm(period) {
    return `
    <div style="background:#172033;border:1px solid #334155;border-radius:10px;padding:14px;margin:12px 0;">
        <div style="font-weight:700;margin-bottom:10px;">✏️ Editar periodo</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nombre / etiqueta
                <input id="pc-per-label" type="text" value="${esc(period.label)}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha de apertura
                <input id="pc-per-open" type="date" value="${esc(period.openingDate || today())}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha de cierre
                <input id="pc-per-close" type="date" value="${esc(period.closingDate || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelPeriodEdit" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">Cancelar</button>
            <button type="button" data-app-fn="pcSavePeriodEdit" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar</button>
        </div>
    </div>`;
}

function _movementForm(form) {
    const isGasto = form.type === 'gasto';
    return `
    <div style="background:#172033;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:700;margin-bottom:10px;">${isGasto ? '− Nuevo gasto' : '+ Nueva reposición'}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            <label style="font-size:.75rem;color:#94a3b8;">Monto (RD$)
                <input id="pc-amount" type="number" inputmode="decimal" step="0.01" min="0" value="${form.amount || ''}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha
                <input id="pc-date" type="date" value="${form.date || today()}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            ${isGasto ? `
            <label style="font-size:.75rem;color:#94a3b8;">Tienda / proveedor
                <input id="pc-tienda" type="text" value="${esc(form.paidTo || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Categoría
                <select id="pc-cat" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">${CATEGORIAS.map(c => `<option ${form.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </label>
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Descripción
                <input id="pc-desc" type="text" value="${esc(form.description || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.8rem;color:#cbd5e1;display:flex;align-items:center;gap:8px;grid-column:1/-1;">
                <input id="pc-receipt" type="checkbox" ${form.hasReceipt ? 'checked' : ''}> Tiene comprobante (foto o PDF)
            </label>
            <div style="grid-column:1/-1;">
                <label style="font-size:.75rem;color:#94a3b8;display:block;margin-bottom:6px;">Comprobante de la factura</label>
                ${(form.photoPreviewDataUrl || form.photoDataUrl)
                    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <img src="${form.photoPreviewDataUrl || form.photoDataUrl}" style="max-height:120px;border-radius:8px;border:1px solid #334155;">
                        <button type="button" data-app-fn="pcScanReceipt" style="background:#8b5cf6;color:#fff;border:none;border-radius:7px;padding:8px 12px;font-weight:700;cursor:pointer;">⚡ Escanear con IA</button>
                        <button type="button" data-app-fn="pcRemovePhotoNew" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;">Quitar</button>
                        ${form.scanStatus ? `<span style="font-size:.72rem;color:#94a3b8;">${esc(form.scanStatus)}</span>` : ''}
                       </div>`
                    : `<div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <label style="display:inline-flex;align-items:center;gap:6px;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:.85rem;">
                            ${icons.get('camera', { size: 16 })} Tomar foto
                            <input type="file" accept="image/*" capture="environment" onchange="window.pcPhotoNew(this)" style="display:none;">
                        </label>
                        <label style="display:inline-flex;align-items:center;gap:6px;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:.85rem;">
                            ${icons.get('image', { size: 16 })} Elegir imagen o PDF
                            <input type="file" accept="image/*,application/pdf" onchange="window.pcPhotoNew(this)" style="display:none;">
                        </label>
                       </div>`}
            </div>` : `
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nota (opcional)
                <input id="pc-desc" type="text" value="${esc(form.description || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>`}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelForm" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">Cancelar</button>
            <button type="button" data-app-fn="pcSaveMovement" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar</button>
        </div>
    </div>`;
}

function _movementEditForm(mov, cerrada) {
    const isGasto = mov.type === 'gasto';
    const ro = cerrada ? 'disabled' : '';
    const inp = (id, val, type = 'text', extra = '') => `<input id="${id}" type="${type}" ${extra} ${ro} value="${esc(val ?? '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">`;
    const lab = (text, field) => `<label style="font-size:.75rem;color:#94a3b8;">${text}${field}</label>`;
    return `
    <div style="background:#172033;border:1px solid #0ea5e9;border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:700;margin-bottom:10px;">${isGasto ? '🏪 Detalle del gasto' : '💰 Detalle de la reposición'}${cerrada ? ' <span style="font-size:.7rem;color:#fbbf24;">(periodo cerrado · solo lectura)</span>' : ''}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            ${lab('Monto (RD$)', inp('pce-amount', mov.amount, 'number', 'step="0.01" min="0" inputmode="decimal"'))}
            ${lab('Fecha del movimiento', inp('pce-date', mov.date || today(), 'date'))}
            ${isGasto ? `
            ${lab('Tienda / proveedor', inp('pce-tienda', mov.paidTo))}
            ${lab('RNC / comprobante de la empresa', inp('pce-rnc', mov.rncEmisor))}
            ${lab('Cliente (opcional)', inp('pce-cliente', mov.cliente))}
            ${lab('RNC cliente (opcional)', inp('pce-rnccli', mov.rncCliente))}
            ${lab('NCF · N° de comprobante fiscal', inp('pce-ncf', mov.ncf))}
            ${lab('Categoría', `<select id="pce-cat" ${ro} style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">${CATEGORIAS.map(c => `<option ${mov.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Descripción${inp('pce-desc', mov.description)}</label>
            <label style="font-size:.8rem;color:#cbd5e1;display:flex;align-items:center;gap:8px;grid-column:1/-1;"><input id="pce-receipt" type="checkbox" ${ro} ${mov.hasReceipt ? 'checked' : ''}> Tiene comprobante (foto o PDF)</label>
            <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <label style="font-size:.75rem;color:#94a3b8;">📷 Comprobante:</label>
                ${pc()._editPhoto ? `<img src="${pc()._editPhoto}" style="max-height:90px;border-radius:8px;border:1px solid #0ea5e9;"><span style="font-size:.7rem;color:#34d399;">(nuevo comprobante)</span>`
                    : (mov.receiptStatus ? `<button type="button" data-app-fn="pcViewReceipt" data-arg="${mov.id}" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;">🧾 Ver comprobante</button>` : '<span style="font-size:.75rem;color:#64748b;">Sin comprobante</span>')}
                ${ro ? '' : `
                    <label style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:.8rem;">
                        ${icons.get('camera', { size: 15 })} Cámara
                        <input type="file" accept="image/*" capture="environment" onchange="window.pcPhotoEdit(this)" style="display:none;">
                    </label>
                    <label style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:.8rem;">
                        ${icons.get('image', { size: 15 })} Imagen o PDF
                        <input type="file" accept="image/*,application/pdf" onchange="window.pcPhotoEdit(this)" style="display:none;">
                    </label>`}
                ${(!ro && (mov.receiptStatus || pc()._editPhoto)) ? `<button type="button" data-app-fn="pcRescanReceipt" data-arg="${mov.id}" style="background:#8b5cf6;color:#fff;border:none;border-radius:7px;padding:6px 10px;font-weight:700;cursor:pointer;">⚡ Re-escanear con IA</button>` : ''}
                ${pc()._rescanStatus ? `<span style="font-size:.72rem;color:#a78bfa;">${esc(pc()._rescanStatus)}</span>` : ''}
            </div>
            <div style="grid-column:1/-1;border-top:1px solid #334155;margin-top:6px;padding-top:10px;font-size:.72rem;color:#64748b;font-weight:700;letter-spacing:.04em;">DATOS FISCALES DE LA FACTURA</div>
            ${lab('Subtotal', inp('pce-subtotal', mov.subtotal, 'number', 'step="0.01"'))}
            ${lab('ITBIS', inp('pce-itbis', mov.itbis, 'number', 'step="0.01"'))}
            ${lab('Total', inp('pce-total', mov.total, 'number', 'step="0.01"'))}
            ${lab('Fecha emisión', inp('pce-femision', mov.fechaEmision, 'date'))}
            ${lab('Fecha vencimiento', inp('pce-fvenc', mov.fechaVencimiento, 'date'))}
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Notas / detalles<textarea id="pce-notas" ${ro} rows="2" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;resize:vertical;">${esc(mov.notas || '')}</textarea></label>
            ${(Array.isArray(mov.items) && mov.items.length) ? `<div style="grid-column:1/-1;border-top:1px solid #334155;margin-top:6px;padding-top:10px;"><div style="font-size:.72rem;color:#64748b;font-weight:700;letter-spacing:.04em;margin-bottom:6px;">ARTÍCULOS (${mov.items.length})</div>${mov.items.map(it => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:.8rem;color:#cbd5e1;padding:2px 0;"><span>${esc((it.cantidad ? it.cantidad + '× ' : '') + (it.descripcion || '—'))}</span><span style="color:#94a3b8;white-space:nowrap;">${it.precio != null ? rd(it.precio) : ''}</span></div>`).join('')}</div>` : ''}
            ` : `
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nota${inp('pce-desc', mov.description)}</label>
            `}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px;flex-wrap:wrap;">
            ${(mov.reviewPending && !cerrada) ? `<button type="button" data-app-fn="pcConfirmMovement" data-arg="${mov.id}" style="margin-right:auto;background:#22c55e;color:#062;border:none;border-radius:7px;padding:8px 14px;font-weight:700;cursor:pointer;">✓ Confirmar revisado</button>` : ''}
            <button type="button" data-app-fn="pcCancelMovementEdit" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">${cerrada ? 'Cerrar' : 'Cancelar'}</button>
            ${cerrada ? '' : `<button type="button" data-app-fn="pcSaveMovementEdit" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar cambios</button>`}
        </div>
    </div>`;
}

function _movementsList(movs, cerrada) {
    const list = (movs || []).slice().sort((left, right) =>
        (Number(right.recordNumber) || 0) - (Number(left.recordNumber) || 0)
    );
    if (!list.length) return '<div style="color:#64748b;padding:14px 0;">Sin movimientos aún.</div>';
    return `<div style="display:flex;flex-direction:column;gap:6px;">
        ${list.map(m => {
            const isGasto = m.type === 'gasto';
            const sign = isGasto ? '−' : '+';
            const color = isGasto ? '#f87171' : '#34d399';
            const titulo = isGasto ? (m.paidTo || m.description || 'Gasto') : 'Reposición';
            return `<div data-app-fn="pcOpenMovement" data-arg="${m.id}" role="button" tabindex="0" title="Ver / editar detalle"
                style="display:flex;align-items:center;gap:10px;background:#0f172a;border:1px solid #1e293b;border-radius:9px;padding:10px 12px;cursor:pointer;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:.9rem;display:flex;align-items:center;gap:6px;">
                        <span style="font-size:.68rem;color:#38bdf8;font-variant-numeric:tabular-nums;">${formatPettyCashRecordNumber(m.recordNumber)}</span>
                        ${isGasto ? '🏪' : '💰'} ${esc(titulo)}
                        ${m.reviewPending ? '<span title="Creado automáticamente — toca para revisar y confirmar" style="font-size:.62rem;background:rgba(245,158,11,.18);color:#fbbf24;border:1px solid rgba(245,158,11,.5);padding:1px 7px;border-radius:999px;font-weight:700;">⚠️ Revisar</span>' : ''}
                        ${isGasto && m.hasReceipt ? '<span title="Tiene comprobante">🧾</span>' : ''}
                        ${isGasto && m.category ? `<span style="font-size:.68rem;background:#1e293b;border:1px solid #334155;padding:1px 7px;border-radius:999px;color:#94a3b8;">${esc(m.category)}</span>` : ''}
                    </div>
                    <div style="font-size:.72rem;color:#64748b;">📅 ${esc(formatPettyCashDate(m.date))}${isGasto && m.ncf ? ' · NCF: ' + esc(m.ncf) : ''}${m.description && isGasto && m.paidTo ? ' · ' + esc(m.description) : ''}</div>
                </div>
                <div style="font-weight:800;color:${color};white-space:nowrap;">${sign} ${rd(m.amount)}</div>
                ${cerrada ? '' : `<button type="button" data-app-fn="pcDeleteMovement" data-arg="${m.id}" data-app-stop="1" aria-label="Eliminar" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:1rem;padding:4px 6px;">✕</button>`}
            </div>`;
        }).join('')}
    </div>`;
}

// ══ handlers (window.*) ════════════════════════════════════════════════
export function registerPettyCashGlobals() {
    window.startPettyCashSync = startPettyCashSync;

    // Cargar datos locales (IndexedDB) al arrancar, aun sin sesión (offline-safe).
    loadPettyCashLocal();
    // Al volver la conexión: reintentar datos, OCR y comprobantes heredados.
    if (typeof window !== 'undefined' && !window._pcOnlineHooked) {
        window._pcOnlineHooked = true;
        window.addEventListener('online', () => {
            PettyCashStore.flush();
            PettyCashStore.flushMirror();
            processPendingReceiptJobs().catch((e) => console.warn('receipt queue online', e));
            uploadPendingReceipts();
        });
    }

    window.pcContinueReceiptQueue = () => processPendingReceiptJobs({ force: true });

    window.pcNewProject = async () => {
        const name = (await Modal.prompt({ title: '🏗️ Nuevo proyecto / obra', message: 'Nombre del proyecto u obra:', placeholder: 'Ej. Torre A', confirmText: 'Crear' }) || '').trim();
        if (!name) return;
        const d = pc();
        const p = { id: uid('proj'), name, status: 'activo', createdBy: 'app', updatedAt: Date.now() };
        d.projects.push(p);
        d.selectedProjectId = p.id;
        d.selectedPeriodId = null;
        persist(); saveProject(p, 'Proyecto creado'); window.render?.();
    };

    window.pcSelectProject = (id) => {
        const d = pc();
        d.selectedProjectId = id || null;
        d.selectedPeriodId = null;
        d.form = null; d.periodForm = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcEditProject = async () => {
        const proj = currentProject();
        if (!proj) return;
        const name = (await Modal.prompt({ title: '✏️ Renombrar proyecto', message: 'Nuevo nombre del proyecto:', defaultValue: proj.name, confirmText: 'Guardar' }) || '').trim();
        if (!name) return;
        proj.name = name; proj.updatedAt = Date.now();
        persist(); saveProject(proj, 'Proyecto renombrado'); window.render?.();
    };

    window.pcDeleteProject = async () => {
        const d = pc();
        const proj = currentProject();
        if (!proj) return;
        const pers = periodsOfProject(d.periods, proj.id);
        const ok = await Modal.confirm({ title: '🗑️ Eliminar proyecto', message: `¿Eliminar el proyecto "${esc(proj.name)}"${pers.length ? ` y sus ${pers.length} periodo(s)` : ''}? No se puede deshacer.`, confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'danger' });
        if (!ok) return;
        // cascada: movimientos + periodos del proyecto
        d.movements.filter(m => m.projectId === proj.id).forEach(m => {
            if (m.receiptStatus) indexedDBService.deleteReceipt(m.id);
            removeMovementDoc(m.id);
        });
        pers.forEach(p => removePeriodDoc(p.id));
        removeProjectDoc(proj.id);
        d.movements = d.movements.filter(m => m.projectId !== proj.id);
        d.periods = d.periods.filter(p => p.projectId !== proj.id);
        d.projects = d.projects.filter(p => p.id !== proj.id);
        d.selectedProjectId = null; d.selectedPeriodId = null; d.form = null; d.periodForm = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcNewPeriod = async () => {
        const proj = currentProject();
        if (!proj) return;
        const label = (await Modal.prompt({ title: '💵 Nuevo periodo de caja', message: 'Etiqueta del periodo:', placeholder: 'Ej. Quincena 1 - Enero', confirmText: 'Crear' }) || '').trim();
        if (!label) return;
        const d = pc();
        const per = { id: uid('per'), projectId: proj.id, label, status: 'abierta', openingDate: today(), closingDate: null, createdBy: 'app', updatedAt: Date.now() };
        d.periods.push(per);
        d.selectedPeriodId = per.id;
        d.form = null; d.periodForm = null; d.editMov = null;
        persist(); savePeriod(per, 'Periodo creado'); window.render?.();
    };

    window.pcSelectPeriod = (id) => {
        const d = pc();
        d.selectedPeriodId = id;
        d.form = null; d.periodForm = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcEditPeriod = () => {
        if (!currentPeriod()) return;
        pc().periodForm = true; pc().form = null; pc().editMov = null;
        window.render?.();
    };
    window.pcCancelPeriodEdit = () => { pc().periodForm = null; window.render?.(); };
    window.pcSavePeriodEdit = () => {
        const period = currentPeriod();
        if (!period) return;
        const label = document.getElementById('pc-per-label')?.value?.trim();
        if (!label) { Modal.alert({ title: 'Nombre requerido', message: 'El nombre del periodo no puede estar vacío.' }); return; }
        period.label = label;
        period.openingDate = document.getElementById('pc-per-open')?.value || period.openingDate || today();
        period.closingDate = document.getElementById('pc-per-close')?.value || null;
        period.updatedAt = Date.now();
        pc().periodForm = null;
        persist(); savePeriod(period, 'Periodo actualizado'); window.render?.();
    };

    window.pcDeletePeriod = async () => {
        const d = pc();
        const period = currentPeriod();
        if (!period) return;
        const movs = movementsOfPeriod(d.movements, period.id);
        const ok = await Modal.confirm({ title: '🗑️ Eliminar periodo', message: `¿Eliminar el periodo "${esc(period.label)}"${movs.length ? ` y sus ${movs.length} movimiento(s)` : ''}? No se puede deshacer.`, confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'danger' });
        if (!ok) return;
        movs.forEach(m => {
            if (m.receiptStatus) indexedDBService.deleteReceipt(m.id);
            removeMovementDoc(m.id);
        });
        removePeriodDoc(period.id);
        d.movements = d.movements.filter(m => m.periodId !== period.id);
        d.periods = d.periods.filter(p => p.id !== period.id);
        d.selectedPeriodId = null; d.periodForm = null; d.form = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcOpenForm = (type) => {
        pc().form = {
            id: uid('mov'),
            type,
            amount: '',
            date: today(),
            category: CATEGORIAS[0],
            hasReceipt: false
        };
        pc().periodForm = null; pc().editMov = null;
        window.render?.();
    };
    window.pcCancelForm = async () => {
        const form = pc().form;
        pc().form = null;
        window.render?.();
        if (form?.receiptStoredLocally && form?.id) {
            try { await indexedDBService.deleteReceipt(form.id); }
            catch (e) { console.warn('delete receipt draft', e); }
        }
    };

    window.pcSaveMovement = async () => {
        const d = pc();
        const period = currentPeriod();
        const form = d.form;
        if (!period || !form) return;
        const amount = parseFloat(document.getElementById('pc-amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) { Modal.alert({ title: 'Monto inválido', message: 'Ingresa un monto válido mayor que 0.' }); return; }
        const photo = form.photoDataUrl || null;
        const hasLocalOriginal = !!form.receiptStoredLocally;
        const now = Date.now();
        const mov = {
            id: form.id || uid('mov'), periodId: period.id, projectId: period.projectId,
            type: form.type, amount: round2(amount),
            date: document.getElementById('pc-date')?.value || today(),
            description: document.getElementById('pc-desc')?.value?.trim() || '',
            createdBy: 'app', updatedAt: now
        };
        await assignNewMovementIdentity(mov, period, now);
        if (form.type === 'gasto') {
            mov.paidTo = document.getElementById('pc-tienda')?.value?.trim() || '';
            mov.category = document.getElementById('pc-cat')?.value || '';
            mov.hasReceipt = !!document.getElementById('pc-receipt')?.checked || !!photo;
            if (hasLocalOriginal) {
                mov.receiptStatus = 'local';
                mov.receiptStorage = 'local-only';
                mov.receiptKind = form.photoCapture?.receiptKind || null;
                mov.receiptMimeType = form.photoCapture?.originalType || null;
                mov.receiptPageCount = form.photoCapture?.pageCount || null;
            }
            // Datos fiscales pre-extraídos por el OCR (no visibles en el form rápido)
            if (form.ocr) {
                if (form.ocr.rncEmisor) mov.rncEmisor = form.ocr.rncEmisor;
                if (form.ocr.ncf) mov.ncf = form.ocr.ncf;
                if (form.ocr.cliente) mov.cliente = form.ocr.cliente;
                if (form.ocr.rncCliente) mov.rncCliente = form.ocr.rncCliente;
                if (form.ocr.subtotal != null) mov.subtotal = form.ocr.subtotal;
                if (form.ocr.itbis != null) mov.itbis = form.ocr.itbis;
                if (form.ocr.total != null) mov.total = form.ocr.total;
                if (form.ocr.fechaEmision) mov.fechaEmision = form.ocr.fechaEmision;
                if (form.ocr.notas) mov.notas = form.ocr.notas;
                if (Array.isArray(form.ocr.items) && form.ocr.items.length) mov.items = form.ocr.items;
            }
        }
        d.movements.push(mov);
        d.form = null;
        persist(); saveMovement(mov, mov.type === 'gasto' ? 'Gasto guardado' : 'Movimiento guardado'); window.render?.();
        // La captura se guarda al seleccionarla. Aquí se confirma el borrador,
        // se conserva el Blob original y se inicia el respaldo remoto.
        if (photo && mov.type === 'gasto') {
            try {
                if (!hasLocalOriginal && form.photoCapture) {
                    await saveLocalReceiptCapture(mov.id, form.photoCapture, {
                        periodId: period.id,
                        projectId: period.projectId,
                        queueStatus: 'confirmed',
                        ocrStatus: form.ocr ? 'extracted' : 'skipped',
                        userConfirmedAt: Date.now()
                    });
                } else {
                    await indexedDBService.updateReceiptJob(mov.id, {
                        periodId: period.id,
                        projectId: period.projectId,
                        queueStatus: 'confirmed',
                        ocrStatus: form.ocr ? 'extracted' : 'skipped',
                        userConfirmedAt: Date.now()
                    });
                }
                mov.receiptStatus = 'local';
                mov.receiptStorage = 'local-only';
                mov.hasReceipt = true;
                mov.updatedAt = Date.now();
                persist(); saveMovement(mov); window.render?.();
                uploadPendingReceipts().catch((error) => console.warn('receipt backup after save', error));
            } catch (e) {
                console.warn('⚠️ saveReceipt local:', e);
                Modal.alert({ title: 'Comprobante', message: 'El gasto se guardó, pero el comprobante no se pudo guardar localmente.' });
            }
        }
    };

    window.pcOpenMovement = (movId) => {
        pc().editMov = movId;
        pc().form = null;
        pc().periodForm = null;
        pc()._editPhoto = null;
        pc()._editPhotoCapture = null;
        pc()._rescanStatus = null;
        window.render?.();
    };
    window.pcCancelMovementEdit = () => {
        pc().editMov = null;
        pc()._editPhoto = null;
        pc()._editPhotoCapture = null;
        pc()._rescanStatus = null;
        window.render?.();
    };

    window.pcConfirmMovement = async (movId) => {
        const mov = pc().movements.find(m => m.id === movId);
        if (!mov) return;
        mov.reviewPending = false;
        mov.updatedAt = Date.now();
        persist(); saveMovement(mov, 'Movimiento confirmado'); window.render?.();
        if (mov.receiptStatus) {
            try {
                await indexedDBService.updateReceiptJob(movId, {
                    queueStatus: 'confirmed',
                    userConfirmedAt: Date.now()
                });
                await refreshReceiptQueueSummary();
                uploadPendingReceipts().catch((error) => console.warn('receipt backup after confirm', error));
            } catch (e) {
                console.warn('confirm receipt job', e);
            }
        }
    };

    window.pcExportExcel = async () => {
        const proj = currentProject();
        const period = currentPeriod();
        if (!proj || !period) return;
        const loading = (typeof window.showNotification === 'function') ? window.showNotification('📊 Generando Excel...', 'loading') : null;
        try {
            await ensureExcelJSLoaded();
            const ExcelJS = window.ExcelJS;
            if (!ExcelJS) throw new Error('ExcelJS no disponible');
            const movs = movementsOfPeriod(pc().movements, period.id);
            const sheets = buildPeriodSheets(proj, period, movs);
            const wb = new ExcelJS.Workbook();
            wb.addWorksheet('Resumen').addRows(sheets.resumen);
            wb.addWorksheet('Movimientos').addRows(sheets.movimientos);
            if (sheets.items.length > 1) wb.addWorksheet('Artículos').addRows(sheets.items);
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const safe = (s) => String(s || '').replace(/[^\w\-]+/g, '_').slice(0, 40);
            const filename = `CajaChica_${safe(proj.name)}_${safe(period.label)}.xlsx`;
            loading?.dismiss?.();
            if (typeof window.showExportMenu === 'function') {
                window.showExportMenu({ filename, blob, title: `Caja Chica — ${proj.name}`, text: period.label });
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
            }
        } catch (e) {
            loading?.dismiss?.();
            console.warn('pcExportExcel:', e);
            Modal.alert({ title: 'Excel', message: 'No se pudo generar el Excel. (' + (e.message || '') + ')' });
        }
    };

    // Re-escanear con IA un comprobante existente (desde el detalle).
    window.pcRescanReceipt = async (movId) => {
        const url = APP_CONFIG && APP_CONFIG.OCR_WEBHOOK_URL;
        const user = auth && auth.currentUser;
        if (!url) { Modal.alert({ title: 'OCR', message: 'No hay URL de OCR configurada.' }); return; }
        if (!user) { Modal.alert({ title: 'Sesión requerida', message: 'Inicia sesión para escanear con IA.' }); return; }
        const d = pc();
        const mov = d.movements.find(m => m.id === movId);
        if (!mov) return;
        let prepared = d._editPhotoCapture
            ? {
                fileDataUrl: d._editPhotoCapture.processingDataUrl,
                mimeType: d._editPhotoCapture.processingMimeType,
                fileName: d._editPhotoCapture.originalName
            }
            : null;
        if (!prepared) {
            try {
                const rec = await indexedDBService.getReceipt(movId);
                if (rec?.originalBlob) {
                    prepared = await prepareReceiptForOcr(rec.originalBlob);
                    prepared.mimeType = rec.originalType || prepared.mimeType;
                    prepared.fileName = rec.originalName || prepared.fileName;
                } else if (rec?.dataUrl || rec?.previewDataUrl) {
                    prepared = {
                        fileDataUrl: rec.dataUrl || rec.previewDataUrl,
                        mimeType: 'image/jpeg',
                        fileName: rec.originalName || 'factura.jpg'
                    };
                }
            } catch { /* noop */ }
        }
        if (!prepared?.fileDataUrl) { Modal.alert({ title: 'Re-escanear', message: 'No hay un comprobante para escanear. Agrega o cambia el archivo primero.' }); return; }
        d._rescanStatus = '⏳ Escaneando...';
        window.render?.();
        try {
            await indexedDBService.updateReceiptJob(movId, {
                queueStatus: 'processing',
                ocrStatus: 'processing',
                lastError: null
            });
            const idToken = await user.getIdToken();
            const data = await requestReceiptOcr({
                url,
                idToken,
                fileDataUrl: prepared.fileDataUrl,
                mimeType: prepared.mimeType,
                fileName: prepared.fileName
            });
            const normalized = normalizeReceiptOcr(data, CATEGORIAS);
            applyReceiptOcrToMovement(mov, normalized);
            mov.reviewPending = true;
            mov.updatedAt = Date.now();
            d._rescanStatus = null;
            await indexedDBService.updateReceiptJob(movId, {
                queueStatus: 'awaiting-review',
                ocrStatus: normalized.got ? 'extracted' : 'needs-review',
                attempts: 0,
                nextRetryAt: null,
                lastError: null
            });
            await refreshReceiptQueueSummary();
            persist(); saveMovement(mov, 'Movimiento actualizado'); window.render?.();
        } catch (e) {
            console.warn('rescan OCR:', e);
            const rec = await indexedDBService.getReceipt(movId).catch(() => null);
            const retry = receiptRetryState(rec?.attempts, {
                online: typeof navigator === 'undefined' || navigator.onLine !== false
            });
            await indexedDBService.updateReceiptJob(movId, {
                ...retry,
                ocrStatus: 'failed',
                lastError: e.message || 'Error de OCR'
            }).catch(() => null);
            getReceiptQueueProcessor().scheduleNextRetry().catch(() => null);
            await refreshReceiptQueueSummary();
            pc()._rescanStatus = null;
            window.render?.();
            Modal.alert({ title: 'Re-escanear', message: 'No se pudo escanear. (' + (e.message || '') + ')' });
        }
    };

    // Lote: varios comprobantes → un gasto por archivo, OCR automático y revisión.
    window.pcBatchPhotos = async (input) => {
        const files = input && input.files ? Array.from(input.files) : [];
        if (input) input.value = '';
        const period = currentPeriod();
        if (!files.length || !period) return;
        const d = pc();
        const queuedIds = [];
        d.receiptBatchProgress = {
            total: files.length,
            queuedIds,
            failedToSave: 0
        };
        d.batchStatus = `0/${files.length} procesados · ${files.length} aún procesándose`;
        window.render?.();

        for (let i = 0; i < files.length; i++) {
            try {
                const { movement } = await enqueueReceiptFile(files[i], period);
                queuedIds.push(movement.id);
                d.receiptQueueHiddenIds = [
                    ...new Set([...(d.receiptQueueHiddenIds || []), movement.id])
                ];
            } catch (e) {
                console.warn('batch save original receipt', e);
                d.receiptBatchProgress.failedToSave++;
                continue;
            }
            window.render?.();
        }

        await refreshReceiptQueueSummary();
        persist(); window.render?.();
        if (queuedIds.length) {
            processPendingReceiptJobs({ txIds: queuedIds })
                .catch((e) => console.warn('batch OCR queue', e));
        }
    };

    window.pcCameraBatchPhoto = async (input) => {
        const file = input?.files?.[0];
        if (input) input.value = '';
        const period = currentPeriod();
        if (!file || !period) return;
        const d = pc();
        if (!d.cameraBatchSession?.active) {
            d.cameraBatchSession = { active: true, count: 0, queuedIds: [], lastPreviewDataUrl: null };
        }
        d.batchStatus = 'Guardando foto original...';
        window.render?.();
        try {
            const { movement, capture } = await enqueueReceiptFile(file, period);
            d.cameraBatchSession.count++;
            d.cameraBatchSession.queuedIds.push(movement.id);
            d.cameraBatchSession.lastPreviewDataUrl = capture.previewDataUrl;
            d.batchStatus = null;
            await refreshReceiptQueueSummary();
            window.render?.();
            processPendingReceiptJobs({ txIds: [movement.id] })
                .catch((error) => console.warn('camera batch OCR queue', error));
        } catch (error) {
            d.batchStatus = null;
            window.render?.();
            console.warn('camera batch receipt', error);
            Modal.alert({
                title: 'No se guardó la foto',
                message: 'La factura no se agregó. Puedes volver a tomarla sin perder las anteriores.'
            });
        }
    };

    window.pcFinishCameraBatch = () => {
        const d = pc();
        d.cameraBatchSession = null;
        d.batchStatus = null;
        window.render?.();
        processPendingReceiptJobs().catch((error) => console.warn('camera batch finish', error));
    };

    window.pcPhotoNew = async (input) => {
        const file = input?.files?.[0];
        if (!file || !pc().form) return;
        try {
            const form = pc().form;
            const period = currentPeriod();
            const capture = await prepareReceiptCapture(file);
            await saveLocalReceiptCapture(form.id, capture, {
                periodId: period?.id || null,
                projectId: period?.projectId || null,
                queueStatus: 'draft',
                ocrStatus: 'pending'
            });
            form.photoCapture = capture;
            form.photoDataUrl = capture.processingDataUrl;
            form.photoPreviewDataUrl = capture.previewDataUrl;
            form.receiptStoredLocally = true;
            form.hasReceipt = true;
            window.render?.();
        }
        catch (e) {
            console.warn('prepareReceiptCapture', e);
            Modal.alert({ title: 'Comprobante', message: e.message || 'No se pudo procesar el archivo.' });
        }
    };
    window.pcRemovePhotoNew = async () => {
        const form = pc().form;
        if (!form) return;
        if (form.receiptStoredLocally && form.id) {
            try { await indexedDBService.deleteReceipt(form.id); }
            catch (e) { console.warn('delete receipt draft', e); }
        }
        form.photoCapture = null;
        form.photoDataUrl = null;
        form.photoPreviewDataUrl = null;
        form.receiptStoredLocally = false;
        form.scanStatus = null;
        form.ocr = null;
        window.render?.();
    };

    window.pcScanReceipt = async () => {
        const form = pc().form;
        if (!form || !form.photoDataUrl) return;
        const url = APP_CONFIG && APP_CONFIG.OCR_WEBHOOK_URL;
        if (!url) { Modal.alert({ title: 'OCR', message: 'No hay URL de OCR configurada.' }); return; }
        const user = auth && auth.currentUser;
        if (!user) { Modal.alert({ title: 'Sesión requerida', message: 'Inicia sesión para escanear con IA.' }); return; }
        form.scanStatus = '⏳ Escaneando...';
        window.render?.();
        try {
            await indexedDBService.updateReceiptJob(form.id, {
                queueStatus: 'processing',
                ocrStatus: 'processing',
                lastError: null
            });
            const idToken = await user.getIdToken();
            const data = await requestReceiptOcr({
                url,
                idToken,
                fileDataUrl: form.photoDataUrl,
                mimeType: form.photoCapture?.processingMimeType || 'image/jpeg',
                fileName: form.photoCapture?.originalName || null
            });
            console.log('🤖 OCR respuesta:', data);
            const f = pc().form;
            if (!f) return;
            const normalized = normalizeReceiptOcr(data, CATEGORIAS);
            applyReceiptOcrToForm(f, normalized);
            const got = normalized.got;
            f.scanStatus = got ? '✅ Datos extraídos — revisa y guarda' : '⚠️ La IA no pudo leer datos de este comprobante';
            await indexedDBService.updateReceiptJob(form.id, {
                queueStatus: 'awaiting-review',
                ocrStatus: got ? 'extracted' : 'needs-review',
                lastError: null
            });
            window.render?.();
            // El re-render puede preservar los inputs existentes (no reescribe .value);
            // los seteamos directo tras el frame de render para garantizar que se vean.
            setTimeout(() => {
                const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = String(v); };
                setVal('pc-amount', f.amount);
                setVal('pc-tienda', f.paidTo);
                setVal('pc-desc', f.description);
                setVal('pc-date', f.date);
                const cat = document.getElementById('pc-cat');
                if (cat && f.category) cat.value = f.category;
            }, 60);
        } catch (e) {
            console.warn('OCR scan:', e);
            const f = pc().form;
            if (f) f.scanStatus = '❌ No se pudo escanear';
            const rec = await indexedDBService.getReceipt(form.id).catch(() => null);
            await indexedDBService.updateReceiptJob(form.id, {
                queueStatus: 'draft',
                ocrStatus: 'failed',
                attempts: (Number(rec?.attempts) || 0) + 1,
                lastError: e.message || 'Error de OCR'
            }).catch(() => null);
            window.render?.();
            Modal.alert({ title: 'Escaneo', message: 'No se pudo escanear la factura; llena los datos a mano. (' + (e.message || '') + ')' });
        }
    };

    window.pcPhotoEdit = async (input) => {
        const file = input?.files?.[0];
        if (!file) return;
        try {
            const capture = await prepareReceiptCapture(file);
            pc()._editPhoto = capture.previewDataUrl;
            pc()._editPhotoCapture = capture;
            window.render?.();
        }
        catch (e) {
            console.warn('prepareReceiptCapture', e);
            Modal.alert({ title: 'Comprobante', message: e.message || 'No se pudo procesar el archivo.' });
        }
    };

    window.pcViewReceipt = async (movId) => {
        try {
            const rec = await indexedDBService.getReceipt(movId);
            let source = null;
            let mimeType = rec?.originalType || rec?.originalBlob?.type || null;
            let objectUrl = null;
            if (rec?.originalBlob) {
                if (mimeType === 'application/pdf') {
                    objectUrl = URL.createObjectURL(rec.originalBlob);
                    source = objectUrl;
                } else {
                    source = await blobToDataUrl(rec.originalBlob);
                }
            }
            if (!source) source = rec?.dataUrl || rec?.previewDataUrl || null;
            if (!source && auth?.currentUser && APP_CONFIG?.RECEIPT_UPLOAD_URL) {
                const idToken = await auth.currentUser.getIdToken();
                const remote = await lookupReceiptBackup({
                    url: APP_CONFIG.RECEIPT_UPLOAD_URL,
                    idToken,
                    txId: movId
                });
                source = remote.signedUrl || null;
                mimeType = remote.receipt?.mime_type || mimeType;
            }
            if (!source) throw new Error('Comprobante no disponible');
            if (mimeType === 'application/pdf') {
                Modal.alert({
                    title: '🧾 Comprobante PDF',
                    message: `<div style="display:grid;gap:12px;text-align:center;">
                        ${rec?.previewDataUrl ? `<img src="${esc(rec.previewDataUrl)}" alt="Vista previa del PDF" style="max-width:100%;max-height:260px;margin:auto;border-radius:8px;">` : ''}
                        <a href="${esc(source)}" target="_blank" rel="noopener" style="display:inline-flex;justify-content:center;background:#06b6d4;color:#06202a;border-radius:8px;padding:10px 14px;font-weight:800;text-decoration:none;">Abrir PDF original</a>
                    </div>`
                });
                if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 300000);
            } else {
                Modal.alert({ title: '🧾 Comprobante', message: `<img src="${esc(source)}" style="max-width:100%;border-radius:8px;">` });
            }
        } catch (e) {
            console.warn('getReceipt', e);
            Modal.alert({ title: 'Comprobante', message: 'No se pudo cargar el archivo.' });
        }
    };

    window.pcSaveMovementEdit = async () => {
        const d = pc();
        const mov = d.movements.find(m => m.id === d.editMov);
        if (!mov) return;
        const numOrNull = (id) => { const v = document.getElementById(id)?.value; return (v === '' || v == null) ? null : round2(parseFloat(v)); };
        const txt = (id) => document.getElementById(id)?.value?.trim() || '';
        const amount = parseFloat(document.getElementById('pce-amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) { Modal.alert({ title: 'Monto inválido', message: 'Ingresa un monto válido mayor que 0.' }); return; }
        mov.amount = round2(amount);
        mov.date = document.getElementById('pce-date')?.value || mov.date;
        mov.description = txt('pce-desc');
        if (mov.type === 'gasto') {
            mov.paidTo = txt('pce-tienda');
            mov.rncEmisor = txt('pce-rnc');
            mov.cliente = txt('pce-cliente');
            mov.rncCliente = txt('pce-rnccli');
            mov.ncf = txt('pce-ncf');
            mov.category = document.getElementById('pce-cat')?.value || '';
            mov.hasReceipt = !!document.getElementById('pce-receipt')?.checked;
            mov.subtotal = numOrNull('pce-subtotal');
            mov.itbis = numOrNull('pce-itbis');
            mov.total = numOrNull('pce-total');
            mov.fechaEmision = document.getElementById('pce-femision')?.value || null;
            mov.fechaVencimiento = document.getElementById('pce-fvenc')?.value || null;
            mov.notas = document.getElementById('pce-notas')?.value?.trim() || '';
        }
        mov.reviewPending = false; // guardar el detalle = revisado/confirmado
        mov.updatedAt = Date.now();
        const pendingPhoto = d._editPhoto;
        const pendingCapture = d._editPhotoCapture;
        d.editMov = null; d._editPhoto = null; d._editPhotoCapture = null;
        persist(); saveMovement(mov, 'Movimiento actualizado'); window.render?.();
        // Sustituir la copia local únicamente después de que el usuario guarde.
        if (pendingPhoto && pendingCapture && mov.type === 'gasto') {
            try {
                await saveLocalReceiptCapture(mov.id, pendingCapture, {
                    periodId: mov.periodId,
                    projectId: mov.projectId,
                    queueStatus: 'confirmed',
                    ocrStatus: 'pending',
                    userConfirmedAt: Date.now()
                });
                mov.receiptStatus = 'local';
                mov.receiptStorage = 'local-only';
                mov.receiptKind = pendingCapture.receiptKind;
                mov.receiptMimeType = pendingCapture.originalType;
                mov.receiptPageCount = pendingCapture.pageCount;
                mov.hasReceipt = true;
                mov.updatedAt = Date.now();
                persist(); saveMovement(mov); window.render?.();
                uploadPendingReceipts().catch((error) => console.warn('receipt backup after edit', error));
            } catch (e) {
                console.warn('⚠️ saveReceipt local (edit):', e);
                Modal.alert({ title: 'Comprobante', message: 'Los cambios se guardaron, pero el comprobante no se pudo guardar localmente.' });
            }
        } else if (mov.receiptStatus) {
            try {
                await indexedDBService.updateReceiptJob(mov.id, {
                    queueStatus: 'confirmed',
                    userConfirmedAt: Date.now()
                });
                uploadPendingReceipts().catch((error) => console.warn('receipt backup after edit', error));
            } catch (e) {
                console.warn('confirm existing receipt after edit', e);
            }
        }
    };

    window.pcDeleteMovement = async (movId) => {
        const d = pc();
        const mov = d.movements.find(m => m.id === movId);
        if (!mov) return;
        const label = mov.type === 'gasto' ? (mov.paidTo || mov.description || 'gasto') : 'reposición';
        const ok = await Modal.confirm({ title: '🗑️ Eliminar movimiento', message: `¿Eliminar "${esc(label)}" de ${rd(mov.amount)}?`, confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'danger' });
        if (!ok) return;
        if (mov.receiptStatus) await indexedDBService.deleteReceipt(movId);
        removeMovementDoc(movId, 'Movimiento eliminado');
        d.movements = d.movements.filter(m => m.id !== movId);
        await refreshReceiptQueueSummary();
        persist(); window.render?.();
    };

    window.pcClosePeriod = async () => {
        const d = pc();
        const period = currentPeriod();
        if (!period) return;
        const r = resumenPeriodo(movementsOfPeriod(d.movements, period.id));
        const contadoStr = await Modal.prompt({ title: '🔒 Cerrar periodo — conciliación', message: `Saldo calculado: <b>${rd(r.saldo)}</b>. Ingresa el efectivo realmente contado (RD$):`, inputType: 'number', defaultValue: String(Math.max(0, r.saldo)), confirmText: 'Cerrar periodo', cancelText: 'Cancelar' });
        if (contadoStr === null) return;
        const contado = round2(parseFloat(contadoStr) || 0);
        const diferencia = round2(contado - r.saldo);
        period.status = 'cerrada';
        period.saldoFinal = r.saldo;
        period.efectivoContado = contado;
        period.diferencia = diferencia;
        period.closingDate = today();
        period.updatedAt = Date.now();
        persist(); savePeriod(period, 'Periodo cerrado'); window.render?.();
        const estado = diferencia === 0 ? 'Cuadra perfecto ✓' : diferencia > 0 ? `Sobra ${rd(diferencia)}` : `Falta ${rd(-diferencia)}`;
        Modal.alert({ title: 'Periodo cerrado', message: `Saldo calculado: ${rd(r.saldo)}<br>Efectivo contado: ${rd(contado)}<br><b>Diferencia: ${estado}</b>` });
    };
}
