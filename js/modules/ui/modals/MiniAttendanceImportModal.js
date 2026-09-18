import { Modal } from '../../components/Modal.js';
import { parseMiniAttendanceReport } from '../../features/attendance/MiniAttendanceParser.js';
import {
    buildMiniAttendanceApplyPlan,
    confirmMiniAttendanceDraftDate,
    createMiniAttendanceConflictPlan,
    createMiniAttendanceDraft,
    editMiniAttendanceDraftRow,
    excludeMiniAttendanceDraftRow,
    isMiniAttendanceEmployeeEligible,
    reactivateMiniAttendanceDraftEmployee,
    reviewMiniAttendanceConflict,
    reviewMiniAttendanceDraftRow,
    setMiniAttendanceAllocationMode,
    suggestMiniAttendanceDate
} from '../../features/attendance/MiniAttendanceDraft.js';
import { applyMiniAttendancePlan } from '../../features/attendance/MiniAttendanceImportService.js';
import { buildMiniAttendanceReviewViewModel } from '../MiniAttendanceReviewViewModel.js';
import { state, stateManager, toRaw } from '../../core/AppState.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import {
    consolidateAttendanceSubmissions,
    groupConsolidatedAttendance,
    buildConsolidationProposal
} from '../../features/attendance/AttendanceConsolidation.js';
import {
    createMultiDayAttendanceResolver,
    isSafeBulkSaConflict
} from '../../features/attendance/MultiDayAttendanceResolver.js';
import { P2P_SUCCESS_EVENTS, signalP2PSuccess } from '../../features/p2p/P2PSuccessFeedback.js';

let nextControlId = 1;

function defaultReactivateEmployee(employeeId) {
    const currentState = stateManager?.getState() || state;
    const emp = currentState?.employees?.find(e => e.id === employeeId || e.key === employeeId);
    if (!emp) throw new Error(`Empleado no encontrado en SA: ${employeeId}`);
    const changeDate = getDateKey(new Date());
    stateManager.batchSetState(() => {
        emp.active = true;
        emp.lastStatusChange = changeDate;
        emp.updatedAt = Date.now();
        emp._isDirty = true;
        if (!Array.isArray(emp.statusHistory)) emp.statusHistory = [];
        emp.statusHistory.push({
            date: changeDate,
            active: true,
            timestamp: Date.now()
        });
    });
    saveApplicationData();
    return emp;
}

function element(tag, text = null, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) {
        if (name === 'className') node.className = value;
        else if (name === 'dataset') Object.assign(node.dataset, value);
        else if (name in node) node[name] = value;
        else node.setAttribute(name, value);
    }
    return node;
}

function actionButton(text, action, disabled = false) {
    return element('button', text, {
        type: 'button',
        className: 'mini-import-action',
        disabled,
        dataset: { miniAction: action }
    });
}

function renderChip(text) {
    return element('div', text, { className: 'mini-import-chip' });
}

function chevronSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'mini-import-substep-chevron');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 9l6 6 6-6');
    svg.appendChild(path);
    return svg;
}

function closeSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    first.setAttribute('d', 'M6 6l12 12');
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    second.setAttribute('d', 'M18 6 6 18');
    svg.append(first, second);
    return svg;
}

function resolvedCheckSvg(label = 'Resuelto') {
    const wrap = element('span', null, {
        className: 'mini-row-resolved-icon',
        role: 'img',
        title: label,
        'aria-label': label
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 6 9 17l-5-5');
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
}

function selectedCheckSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'mini-source-choice-check');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 6 9 17l-5-5');
    svg.appendChild(path);
    return svg;
}

function comparisonArrowSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'mini-sa-compare-arrow');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12h14M14 7l5 5-5 5');
    svg.appendChild(path);
    return svg;
}

function isIncorporatedDraft(draft) {
    return draft?.status === 'incorporated' || draft?.status === 'imported';
}

function draftHasActualAttendance(draft) {
    const rows = draft?.sourceSnapshot?.rows;
    if (!Array.isArray(rows)) return true;
    return rows.some(row => row?.status === 'present' && (Number(row.normalHours || 0) + Number(row.overtimeHours || 0)) > 0);
}

function humanMiniLabel(mini) {
    if (!mini || typeof mini !== 'object') return 'Mini';
    const alias = typeof mini.alias === 'string' ? mini.alias.trim() : '';
    const name = typeof mini.name === 'string' ? mini.name.trim() : '';
    const displayName = typeof mini.displayName === 'string' ? mini.displayName.trim() : '';
    if (name && alias && alias !== name) return `${name} (${alias})`;
    return name || alias || displayName || 'Mini';
}

function humanSourceLabel(source) {
    if (!source || typeof source !== 'object') return 'Mini';
    const peerName = typeof source.sourcePeerName === 'string' ? source.sourcePeerName.trim() : '';
    if (peerName) return peerName;
    return 'Mini';
}

function humanDraftSourceLabel(draft) {
    const peerName = draft?.metadata?.sourcePeerName || draft?.sourceSnapshot?.scope?.sourcePeerName;
    if (typeof peerName === 'string' && peerName.trim()) return peerName.trim();
    return 'Mini desconocido';
}

function renderCountBadge(count, options = {}) {
    const numeric = Number(count);
    const safe = Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
    const label = typeof options.label === 'string' && options.label.trim() ? options.label.trim() : 'elementos';
    const tone = typeof options.tone === 'string' && options.tone.trim() ? options.tone.trim() : 'accent';
    const hideWhenZero = options.hideWhenZero !== false;
    const badge = element('span', String(safe), {
        className: `mini-count-badge is-${tone}`,
        dataset: { miniCountBadge: '', miniCountValue: String(safe) }
    });
    badge.setAttribute('aria-label', `${safe} ${label}`);
    // The number itself is the visual; AT gets the full count phrase.
    badge.setAttribute('role', 'status');
    if (hideWhenZero && safe === 0) badge.hidden = true;
    return badge;
}

function closeOpenTechnicalPopups(scope = null) {
    const root = scope && scope.querySelectorAll ? scope : (typeof document !== 'undefined' ? document : null);
    if (!root) return;
    root.querySelectorAll('[data-mini-technical-popup-overlay]').forEach(overlay => {
        const trigger = overlay._miniTrigger || null;
        try { overlay.remove(); } catch (_) {}
        if (trigger && trigger.isConnected) {
            try { trigger.setAttribute('aria-expanded', 'false'); } catch (_) {}
        }
    });
}

function openTechnicalPopup(trigger, items, options = {}) {
    if (!trigger || !(trigger instanceof HTMLElement)) return;
    const scope = trigger.closest('.mini-attendance-import') || trigger.parentElement || document.body;
    closeOpenTechnicalPopups(scope === document.body ? document : scope);
    // If the same trigger was open, closing above is enough (toggle behaviour).
    trigger.setAttribute('aria-expanded', 'true');
    const overlay = element('div', null, {
        className: 'mini-technical-popup-overlay',
        dataset: { miniTechnicalPopupOverlay: '' }
    });
    overlay._miniTrigger = trigger;
    const dialog = element('div', null, {
        className: 'mini-technical-popup',
        dataset: { miniTechnicalPopup: '' }
    });
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', options.dialogLabel || 'Detalles técnicos');
    dialog.setAttribute('aria-modal', 'false');
    const header = element('div', null, { className: 'mini-technical-popup-header' });
    header.append(element('strong', options.dialogLabel || 'Detalles técnicos'));
    const closeBtn = element('button', null, {
        type: 'button',
        className: 'mini-technical-popup-close',
        dataset: { miniTechnicalClose: '' },
        'aria-label': 'Cerrar detalles técnicos'
    });
    closeBtn.textContent = '✕';
    const close = () => {
        try { overlay.remove(); } catch (_) {}
        try { trigger.setAttribute('aria-expanded', 'false'); } catch (_) {}
        try { trigger.focus({ preventScroll: true }); } catch (_) { try { trigger.focus(); } catch (_) {} }
        if (typeof document !== 'undefined' && document.removeEventListener && close._onKey) {
            document.removeEventListener('keydown', close._onKey);
        }
    };
    const onKey = (event) => {
        if (event?.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    };
    close._onKey = onKey;
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('keydown', onKey);
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    header.append(closeBtn);
    dialog.append(header);
    const list = element('div', null, { className: 'mini-technical-details-list' });
    items.forEach(text => list.append(element('div', text, { className: 'mini-technical-details-row' })));
    dialog.append(list);
    overlay.append(dialog);
    scope.append(overlay);
    try { closeBtn.focus({ preventScroll: true }); } catch (_) { try { closeBtn.focus(); } catch (_) {} }
}

function technicalDetailsDisclosure(lines, options = {}) {
    const items = Array.isArray(lines) ? lines.filter(text => typeof text === 'string' && text.trim()) : [];
    if (!items.length) return null;
    const wrap = element('div', null, {
        className: 'mini-technical-wrap',
        dataset: { miniTechnicalDetails: '' }
    });
    const trigger = element('button', 'Detalles', {
        type: 'button',
        className: 'mini-technical-trigger',
        dataset: { miniTechnicalTrigger: '' }
    });
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    const countLabel = options.triggerAriaLabel || `Ver detalles técnicos, ${items.length} elementos`;
    trigger.setAttribute('aria-label', countLabel);
    trigger.addEventListener('click', () => {
        const isOpen = trigger.getAttribute('aria-expanded') === 'true' &&
            Boolean(trigger.closest('.mini-attendance-import')?.querySelector('[data-mini-technical-popup-overlay]'));
        if (isOpen) {
            const scope = trigger.closest('.mini-attendance-import') || document;
            closeOpenTechnicalPopups(scope);
            trigger.setAttribute('aria-expanded', 'false');
            return;
        }
        openTechnicalPopup(trigger, items, options);
    });
    wrap.append(trigger);
    return wrap;
}

function draftTechnicalLines(draft) {
    const snapshot = draft?.sourceSnapshot || {};
    return [
        draft?.submissionId ? `Envío: ${draft.submissionId}` : '',
        snapshot?.submissionId && snapshot.submissionId !== draft?.submissionId ? `Envío original: ${snapshot.submissionId}` : '',
        snapshot?.deviceId ? `Dispositivo: ${snapshot.deviceId}` : '',
        draft?.metadata?.sourcePeerId ? `Mini (técnico): ${draft.metadata.sourcePeerId}` : '',
        snapshot?.scope?.sourceId ? `Origen: ${snapshot.scope.sourceId}` : ''
    ];
}

function consolidationTechnicalLines(item) {
    const lines = [];
    if (item?.saEmployeeId) lines.push(`Empleado SA (técnico): ${item.saEmployeeId}`);
    const seen = new Set();
    (item?.sources || []).forEach(source => {
        const key = `${source?.submissionId || ''}|${source?.deviceId || ''}|${source?.sourcePeerId || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (source?.submissionId) lines.push(`Envío: ${source.submissionId}`);
        if (source?.deviceId) lines.push(`Dispositivo: ${source.deviceId}`);
        if (source?.sourcePeerId) lines.push(`Mini (técnico): ${source.sourcePeerId}`);
    });
    return lines;
}

function renderTopbar(step, totalSteps, title = 'Importar asistencia desde Mini', subtitle = '', chipText = '', onClose = null, progressOptions = null) {
    const bar = element('div', null, { className: 'mini-import-topbar' });
    const brand = element('div', null, { className: 'mini-import-topbar-brand' });
    const img = element('img', null, { src: 'icon-512.png', alt: '', width: '28', height: '28' });
    img.addEventListener('error', () => { img.style.display = 'none'; });
    const brandText = element('div');
    brandText.append(
        element('div', title, { className: 'mini-import-topbar-title' }),
        element('div', subtitle || `Paso ${step}`, { className: 'mini-import-topbar-subtitle' })
    );
    brand.append(img, brandText);

    const centerDate = typeof progressOptions?.centerDate === 'string' ? progressOptions.centerDate.trim() : '';
    const centerDay = typeof progressOptions?.dayText === 'string' ? progressOptions.dayText.trim() : '';
    let centerEl = null;
    if (centerDate || centerDay) {
        centerEl = element('div', null, {
            className: 'mini-import-topbar-center',
            dataset: { miniTopbarWorkdate: '' }
        });
        const centerLabel = [centerDate, centerDay].filter(Boolean).join(' · ');
        centerEl.setAttribute('aria-label', centerLabel);
        centerEl.setAttribute('role', 'status');
        if (centerDate) {
            centerEl.append(element('div', centerDate, {
                className: 'mini-import-topbar-date',
                dataset: { miniTopbarDate: '' }
            }));
        }
        if (centerDay) {
            centerEl.append(element('div', centerDay, {
                className: 'mini-import-topbar-day',
                dataset: { miniTopbarDay: '' }
            }));
        }
    }

    const rightGroup = element('div', null, { className: 'mini-import-topbar-right' });
    if (chipText) {
        rightGroup.append(element('div', chipText, { className: 'mini-import-chip mini-import-topbar-chip' }));
    }
    const stepText = progressOptions?.stepText || `${step}/${totalSteps}`;
    const stepEl = element('div', stepText, { className: 'mini-import-topbar-step' });
    if (progressOptions?.stepAriaLabel) stepEl.setAttribute('aria-label', progressOptions.stepAriaLabel);
    else stepEl.setAttribute('aria-label', subtitle || `${step} de ${totalSteps}`);
    rightGroup.append(stepEl);

    if (onClose) {
        const closeBtn = element('button', null, {
            type: 'button',
            className: 'mini-import-topbar-close',
            'aria-label': 'Cerrar',
            title: 'Cerrar'
        });
        closeBtn.append(closeSvg());
        closeBtn.addEventListener('click', onClose);
        rightGroup.append(closeBtn);
    }

    const now = Number.isFinite(Number(progressOptions?.now)) ? Number(progressOptions.now) : step;
    const min = Number.isFinite(Number(progressOptions?.min)) ? Number(progressOptions.min) : 1;
    const max = Number.isFinite(Number(progressOptions?.max)) && Number(progressOptions.max) > 0
        ? Number(progressOptions.max)
        : totalSteps;
    const safeMax = max > 0 ? max : 1;
    const safeNow = Math.max(min, Math.min(now, safeMax));
    const percent = Math.round((safeNow / safeMax) * 100);
    const progress = element('div', null, {
        className: 'mini-import-progress-bar',
        style: `width: ${percent}%;`,
        role: 'progressbar',
        'aria-valuemin': String(min),
        'aria-valuemax': String(safeMax),
        'aria-valuenow': String(safeNow),
        'aria-label': progressOptions?.ariaLabel || subtitle || title
    });
    if (centerEl) bar.append(brand, centerEl, rightGroup, progress);
    else bar.append(brand, rightGroup, progress);
    return bar;
}

function dateBlockerText(code) {
    const messages = {
        date_confirmation_required: 'Confirma la fecha completa antes de continuar.',
        date_hint_mismatch: 'La fecha seleccionada no coincide con el encabezado de Mini.',
        invalid_iso_date: 'Ingresa una fecha válida con año, mes y día.'
    };
    return messages[code] || code;
}

function modeLabel(mode) {
    return mode === 'split_at_regular_limit'
        ? 'Separar normales y extra'
        : 'Todas las horas como normales';
}

function matchLabel(status) {
    const labels = {
        number_match: 'Coincidencia por número',
        number_name_match: 'Coincidencia por número y nombre',
        name_suggestion: 'Sugerencia por nombre',
        remembered_match: 'Coincidencia recordada',
        ambiguous: 'Requiere seleccionar empleado',
        unmatched: 'Sin coincidencia',
        confirmed: 'Empleado confirmado'
    };
    return labels[status] || 'Requiere revisión';
}

function displayDate(isoDate) {
    const [year, month, day] = String(isoDate || '').split('-');
    return year && month && day ? `${day}/${month}/${year}` : '';
}

function formatMiniDate(value) {
    if (!value) return 'Sin registro';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO') : 'Sin registro';
}


function versionDiffSummaryText(diff) {
    const summary = diff?.summary || {};
    const parts = [];
    const add = (count, singular, plural) => { if (count) parts.push(`${count} ${count === 1 ? singular : plural}`); };
    add(summary.hoursChanged, 'hora modificada', 'horas modificadas');
    add(summary.attendanceAdded, 'asistencia agregada', 'asistencias agregadas');
    add(summary.attendanceRemoved, 'asistencia eliminada', 'asistencias eliminadas');
    add(summary.activated, 'empleado activado', 'empleados activados');
    add(summary.paused, 'empleado pausado', 'empleados pausados');
    add(summary.employeesAdded, 'empleado agregado al roster', 'empleados agregados al roster');
    add(summary.employeesRemoved, 'empleado que ya no aparece', 'empleados que ya no aparecen');
    return parts.length ? parts.join(' · ') : 'Sin cambios de asistencia';
}

function versionDetailText(detail) {
    const prefix = detail.number ? `${detail.number}. ` : '';
    const name = detail.name || detail.saEmployeeId || 'Empleado';
    const bits = [];
    if (detail.types?.includes('employee_added')) bits.push('agregado al roster');
    if (detail.types?.includes('employee_removed')) bits.push('ya no aparece en el roster');
    if (detail.types?.includes('activated')) bits.push('activado');
    if (detail.types?.includes('paused')) bits.push('pausado');
    if (detail.types?.some(type => ['hours_changed', 'attendance_added', 'attendance_removed'].includes(type))) {
        const delta = Number(detail.deltaHours || 0);
        const sign = delta > 0 ? '+' : '';
        bits.push(`${sign}${delta}h · ${detail.beforeHours}h → ${detail.afterHours}h`);
    }
    return `${prefix}${name}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
}

export class MiniAttendanceImportModal {
    constructor({
        employees = [],
        attendance = {},
        positions = [],
        proposedDate = '',
        regularLimit = 8,
        onContinue = null,
        applyPlan = applyMiniAttendancePlan,
        reactivateEmployee = null,
        aliases = [],
        aliasScope = null,
        aliasStore = null,
        actorUid = null,
        confirmIgnore = null,
        confirmReactivate = null,
        inboxStore = null,
        consolidationStore = null,
        linkedMinis = [],
        onRequestSubmissions = null,
        importMode = 'paste',
        groupingMode = 'day',
        selectedMiniId = null,
        saProjectId = null,
        entityScope = null
    } = {}) {
        this.employees = employees;
        this.attendance = attendance;
        this.positions = positions;
        this.proposedDate = proposedDate;
        this.pendingDate = proposedDate;
        this.regularLimit = regularLimit;
        this.onContinue = onContinue;
        this.applyPlan = applyPlan;
        this.reactivateEmployee = reactivateEmployee || ((id) => defaultReactivateEmployee(id));
        this.confirmReactivate = confirmReactivate;
        this.aliases = aliases;
        this.aliasScope = aliasScope;
        this.aliasStore = aliasStore;
        this.actorUid = actorUid;
        this.confirmIgnore = confirmIgnore;
        this.inboxStore = inboxStore;
        this.consolidationStore = consolidationStore;
        this.linkedMinis = Array.isArray(linkedMinis) ? linkedMinis : [];
        this.onRequestSubmissions = onRequestSubmissions;
        this.importMode = importMode;
        this.groupingMode = groupingMode;
        this.saProjectId = saProjectId;
        this.entityScope = entityScope;
        this.selectedMiniId = selectedMiniId !== null ? selectedMiniId : (this.linkedMinis[0]?.id || this.linkedMinis[0]?.deviceId || '');
        this.connectedDate = proposedDate || '';
        this.connectedRangeStart = proposedDate || '';
        this.connectedRangeEnd = proposedDate || '';
        this.connectedView = 'request';
        this.savedDrafts = [];
        this.selectedDraftIds = new Set();
        this.draftSortMode = 'workDate';
        this.draftStatusFilter = 'all';
        this.completionStatusMessage = '';
        this.reviewStatusPromise = Promise.resolve();
        this.consolidatedResult = null;
        this.consolidationProposal = null;
        this.multiDayResolver = null;
        this.mergeOvertimeIntoNormal = true;
        this.activeConsolidationId = null;
        this.activeConsolidationRecord = null;
        this.resumableConsolidation = null;
        this.consolidationDayIndex = 0;
        this.transportStatusMessage = '';
        this.isFetchingConnected = false;
        this.connectionState = 'idle';
        this.connectionStatusDetail = '';
        this.peerProgress = new Map();
        this.failedMiniTargets = [];
        this.activeAbortController = null;
        this.applyStatus = 'idle';
        this.applyResult = null;
        this.applyError = null;
        this.reviewStep = 'individual';
        this.reviewPageIndex = 0;
        this.automaticReviewKeys = [];
        this.automaticReviewChoices = new Map();
        this.duplicateHourChoices = new Map();
        this.individualReviewKeys = [];
        this.individualReviewMode = 'queue';
        this.hideAssignedEmployees = true;
        this.stage = 'paste';
        this.source = '';
        this.parsed = null;
        this.draft = null;
        this.controlId = nextControlId++;
        this.showDetailedTable = false;
        this.dateCardCollapsed = false;
        this.allocationCardCollapsed = true;
        this.resolvedRowsExpanded = new Map();
        this._modalLayoutSignature = null;
        this._activeMorphCleanup = null;
    }

    mount(host) {
        if (!(host instanceof HTMLElement)) throw new TypeError('Modal host must be an element');
        this.host = host;
        this.render();
        return this;
    }

    open() {
        const content = document.createElement('div');
        this.modal = new Modal({
            title: 'Importar asistencia desde Mini',
            size: 'large',
            content,
            onClose: () => this.handleModalClosed()
        });
        this.modal.open();
        this.mount(content);
        return this;
    }

    close() {
        this.modal?.close();
    }

    handleModalClosed() {
        if (this.activeAbortController && !this.activeAbortController.signal?.aborted) {
            try { this.activeAbortController.abort(); } catch (_) {}
        }
        if (typeof this._activeMorphCleanup === 'function') {
            try { this._activeMorphCleanup(); } catch (_) {}
        }
        this._activeMorphCleanup = null;
        // Prevent background request settlement from rendering into a closing/detached modal.
        this.host = null;
    }

    analyze() {
        this.parsed = parseMiniAttendanceReport(this.source);
        const suggestedDate = suggestMiniAttendanceDate(this.parsed, this.proposedDate);
        this.draft = createMiniAttendanceDraft({
            parsed: this.parsed,
            employees: this.employees,
            aliases: this.aliases,
            aliasScope: this.aliasScope,
            proposedDate: suggestedDate,
            regularLimit: this.regularLimit
        });
        this.pendingDate = suggestedDate;
        this.duplicateHourChoices.clear();
        this.stage = 'setup';
        this.dateCardCollapsed = Boolean(this.draft.confirmedDate);
        this.allocationCardCollapsed = true;
        this.render();
    }

    confirmDate() {
        this.draft = confirmMiniAttendanceDraftDate(this.draft, this.pendingDate);
        if (this.draft.confirmedDate && this.draft.dateBlockers.length === 0) {
            this.dateCardCollapsed = true;
            const dateCard = this.host?.querySelector('[data-mini-date-card]');
            if (dateCard) {
                const titleWrap = dateCard.querySelector('.mini-import-substep-title-wrap');
                if (titleWrap) {
                    let dateBadge = titleWrap.querySelector('.mini-import-substep-badge');
                    if (!dateBadge) {
                        dateBadge = element('span', null, { className: 'mini-import-substep-badge is-confirmed' });
                        titleWrap.append(dateBadge);
                    }
                    dateBadge.className = 'mini-import-substep-badge is-confirmed';
                    dateBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><polyline points="20 6 9 17 4 12"/></svg>${displayDate(this.draft.confirmedDate)}`;
                }
                dateCard.classList.remove('is-active');
                dateCard.classList.add('is-collapsed');

                const blockers = dateCard.querySelector('[data-mini-date-blockers]');
                if (blockers) blockers.textContent = '';

                const summaryDate = this.host.querySelector('[data-mini-summary-date]');
                if (summaryDate) summaryDate.textContent = displayDate(this.draft.confirmedDate);

                const continueBtn = this.host.querySelector('[data-mini-action="continue"]');
                if (continueBtn) continueBtn.disabled = !this.canContinue();

                const helpText = this.host.querySelector('[data-mini-continue-help]');
                if (helpText) {
                    helpText.textContent = this.canContinue()
                        ? 'La preparación está completa. Haz clic para avanzar a la conciliación.'
                        : 'Confirma la fecha y corrige las advertencias antes de continuar.';
                }
                return;
            }
        }
        this.render();
    }

    setAllocationMode(mode) {
        this.draft = setMiniAttendanceAllocationMode(this.draft, mode);
        this.duplicateHourChoices.clear();
        this.resetApplyState();
        this.render();
    }

    resetApplyState() {
        this.applyStatus = 'idle';
        this.applyResult = null;
        this.applyError = null;
    }

    rebuildConflictPlan() {
        const previous = this.conflictPlan;
        let next = createMiniAttendanceConflictPlan(this.draft, this.attendance);
        if (previous?.rows?.length) {
            next.rows.forEach((row, rowIndex) => {
                const reviewed = previous.rows.find(candidate =>
                    candidate.key === row.key &&
                    candidate.employeeId === row.employeeId &&
                    candidate.sourceIndexes.length === row.sourceIndexes.length &&
                    candidate.sourceIndexes.every(index => row.sourceIndexes.includes(index))
                );
                if (!reviewed?.decision?.acknowledged) return;
                next = reviewMiniAttendanceConflict(next, rowIndex, {
                    action: reviewed.decision.action,
                    acknowledged: true,
                    positionAllocations: reviewed.positionAllocations,
                    collapseAcknowledged:
                        reviewed.decision.collapseAcknowledged === true
                });
            });
        }
        this.conflictPlan = next;
    }

    startReview() {
        if (!this.canContinue()) return;
        this.resetApplyState();
        this.stage = 'review';
        this.reviewPageIndex = 0;
        this.rebuildConflictPlan();
        const view = this.buildReviewView();
        const safeIndexes = new Set(view.safeBulkSourceIndexes);
        const automaticItems = view.items.filter(item =>
            item.sourceIndexes.length > 0 &&
            item.sourceIndexes.every(sourceIndex => safeIndexes.has(sourceIndex))
        );
        this.automaticReviewKeys = automaticItems.map(item => this.reviewItemKey(item));
        this.automaticReviewChoices = new Map(
            this.automaticReviewKeys.map(key => [key, 'accept'])
        );
        this.reviewStep = 'automatic';
        this.individualReviewKeys = [];
        if (typeof this.onContinue === 'function') this.onContinue(this.draft);
        this.render();
    }

    canContinue() {
        return Boolean(this.draft?.confirmedDate) &&
            this.draft.sourceBlockers.length === 0 &&
            this.draft.rows.length > 0 &&
            this.draft.rows.every(row => row.sourceRow.errors.length === 0);
    }

    captureStructuralFocus() {
        if (!this.host || typeof document === 'undefined') return null;
        const active = document.activeElement;
        if (!active || active === document.body || !this.host.contains(active)) return null;
        return {
            id: active.id || '',
            miniAction: active.dataset?.miniAction || '',
            miniMode: active.dataset?.miniMode || '',
            miniGrouping: active.dataset?.miniGrouping || '',
            miniDraftCheckbox: active.dataset?.miniDraftCheckbox || ''
        };
    }

    restoreStructuralFocus(reference) {
        if (!reference || !this.host) return;
        const candidates = Array.from(this.host.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
        let target = null;
        if (reference.id) target = this.host.querySelector(`#${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(reference.id) : reference.id}`);
        if (!target && reference.miniAction) target = candidates.find(el => el.dataset?.miniAction === reference.miniAction);
        if (!target && reference.miniMode) target = candidates.find(el => el.dataset?.miniMode === reference.miniMode);
        if (!target && reference.miniGrouping) target = candidates.find(el => el.dataset?.miniGrouping === reference.miniGrouping);
        if (!target && reference.miniDraftCheckbox) target = candidates.find(el => el.dataset?.miniDraftCheckbox === reference.miniDraftCheckbox);
        if (!target) target = candidates[0] || this.modal?.element?.querySelector('[data-modal-container]');
        try { target?.focus?.({ preventScroll: true }); } catch (_) { try { target?.focus?.(); } catch (_) {} }
    }

    modalLayoutSignature() {
        return [
            this.stage,
            this.stage === 'paste' ? this.importMode : '',
            this.stage === 'paste' && this.importMode === 'connected' ? this.connectedView : '',
            this.showDetailedTable ? 'detail' : 'summary',
            this.consolidatedResult ? 'consolidated' : 'plain'
        ].join('|');
    }

    prefersReducedMotion() {
        try {
            return Boolean(
                typeof window !== 'undefined' &&
                typeof window.matchMedia === 'function' &&
                window.matchMedia('(prefers-reduced-motion: reduce)')?.matches
            );
        } catch (_) {
            return false;
        }
    }

    prepareModalMorph(nextSignature) {
        const previousSignature = this._modalLayoutSignature;
        this._modalLayoutSignature = nextSignature;
        const shell = this.modal?.element?.querySelector('[data-modal-container]');
        if (!shell || !previousSignature || previousSignature === nextSignature || this.prefersReducedMotion()) {
            return null;
        }
        if (typeof shell.getBoundingClientRect !== 'function') return null;
        const rect = shell.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return null;

        if (typeof this._activeMorphCleanup === 'function') this._activeMorphCleanup();

        const snapshot = {
            shell,
            fromWidth: Math.round(rect.width),
            fromHeight: Math.round(rect.height),
            transition: shell.style.transition,
            overflow: shell.style.overflow,
            width: shell.style.width,
            height: shell.style.height
        };
        shell.style.transition = 'none';
        shell.style.width = `${snapshot.fromWidth}px`;
        shell.style.height = `${snapshot.fromHeight}px`;
        shell.style.overflow = 'hidden';
        return snapshot;
    }

    finishModalMorph(snapshot, contentRoot) {
        if (!snapshot) return;
        const { shell } = snapshot;
        shell.style.transition = 'none';
        shell.style.width = '';
        shell.style.height = '';
        const targetRect = shell.getBoundingClientRect();
        const toWidth = Math.round(targetRect.width);
        const toHeight = Math.round(targetRect.height);

        const restore = () => {
            shell.style.transition = snapshot.transition;
            shell.style.overflow = snapshot.overflow;
            shell.style.width = snapshot.width;
            shell.style.height = snapshot.height;
            contentRoot?.classList.remove('is-morph-entering');
            this._activeMorphCleanup = null;
        };

        if (!(toWidth > 0) || !(toHeight > 0) ||
            (toWidth === snapshot.fromWidth && toHeight === snapshot.fromHeight)) {
            restore();
            return;
        }

        shell.style.width = `${snapshot.fromWidth}px`;
        shell.style.height = `${snapshot.fromHeight}px`;
        shell.style.overflow = 'hidden';
        contentRoot?.classList.add('is-morph-entering');
        void shell.offsetHeight;

        const duration = 260;
        let timeoutId = null;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            shell.removeEventListener?.('transitionend', onTransitionEnd);
            restore();
        };
        const onTransitionEnd = (event) => {
            if (event?.target === shell && (event.propertyName === 'width' || event.propertyName === 'height')) {
                finish();
            }
        };
        this._activeMorphCleanup = finish;
        shell.addEventListener?.('transitionend', onTransitionEnd);
        timeoutId = setTimeout(finish, duration + 40);

        const start = () => {
            shell.style.transition = `width ${duration}ms cubic-bezier(.2,.8,.2,1), height ${duration}ms cubic-bezier(.2,.8,.2,1)`;
            shell.style.width = `${toWidth}px`;
            shell.style.height = `${toHeight}px`;
        };
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(start);
        } else {
            start();
        }
    }

    syncModalLayout() {
        const shell = this.modal?.element?.querySelector('[data-modal-container]');
        const reviewing = this.stage === 'review';
        shell?.classList.add('mini-attendance-review-shell');
        shell?.classList.toggle('is-detailed-table', reviewing && this.showDetailedTable);
        this.modal?.element?.classList.add('mini-attendance-review-overlay');
        if (this.modal?.element) {
            this.modal.element.scrollLeft = 0;
            if (reviewing) this.modal.element.scrollTop = 0;
        }
        if (this.host) this.host.scrollLeft = 0;
        if (shell) shell.scrollLeft = 0;
    }

    render() {
        if (!this.host) return;
        const focusReference = this.captureStructuralFocus();
        const morphSnapshot = this.prepareModalMorph(this.modalLayoutSignature());
        this.syncModalLayout();
        const root = element('section', null, {
            className: 'mini-attendance-import',
            dataset: { miniStage: this.stage },
            'aria-live': 'polite'
        });
        const content = this.stage === 'paste'
            ? (this.importMode === 'connected' ? this.renderConnected() : this.renderPaste())
            : this.stage === 'setup' ? this.renderSetup() : this.renderReview();
        root.append(content);
        this.host.replaceChildren(root);
        this.host.scrollLeft = 0;
        if (morphSnapshot) this.restoreStructuralFocus(focusReference);
        this.finishModalMorph(morphSnapshot, root);
    }

    async setImportMode(mode) {
        this.importMode = mode;
        if (mode === 'connected') {
            this.connectedView = 'request';
            if (this.inboxStore) {
                try {
                    this.savedDrafts = await this.inboxStore.list(
                        this.saProjectId ? { saProjectId: this.saProjectId } : null
                    );
                } catch (err) {
                    console.warn('Error loading inbox drafts:', err);
                }
            }
        }
        this.render();
    }

    openConnectedRequest() {
        this.connectedView = 'request';
        this.render();
    }

    async openConnectedInbox() {
        // Switch immediately so the modal morphs as one continuous object; refresh
        // the persisted inbox in-place when IndexedDB resolves.
        this.connectedView = 'inbox';
        this.render();
        if (this.inboxStore) {
            try {
                this.savedDrafts = await this.inboxStore.list(
                    this.saProjectId ? { saProjectId: this.saProjectId } : null
                );
            } catch (err) {
                console.warn('Error loading inbox drafts:', err);
            }
        }
        await this.loadResumableConsolidation();
        if (this.host && this.connectedView === 'inbox') this.render();
    }

    async loadResumableConsolidation() {
        if (!this.consolidationStore || !this.saProjectId) {
            this.resumableConsolidation = null;
            return null;
        }
        try {
            const records = await this.consolidationStore.list({ saProjectId: this.saProjectId });
            this.resumableConsolidation = records.find(record => record.status !== 'incorporated' && record.status !== 'discarded') || null;
            return this.resumableConsolidation;
        } catch (error) {
            console.warn('No se pudo cargar la consolidación pendiente:', error);
            this.resumableConsolidation = null;
            return null;
        }
    }

    _newConsolidationId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `mini-consolidation-${crypto.randomUUID()}`;
        }
        return `mini-consolidation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    getSelectedSourceDrafts() {
        return this.savedDrafts.filter(draft => this.selectedDraftIds.has(draft.submissionId) && !isIncorporatedDraft(draft) && draftHasActualAttendance(draft));
    }

    async persistMiniProgress() {
        if (!this.consolidationStore || !this.multiDayResolver || this.multiDayResolver.stage !== 'mini' || !this.activeConsolidationId) return null;
        const snapshot = this.multiDayResolver.getMiniProgressSnapshot();
        this.activeConsolidationRecord = await this.consolidationStore.saveProgress({
            consolidationId: this.activeConsolidationId,
            snapshot,
            sourceDrafts: this.getSelectedSourceDrafts(),
            revision: this.activeConsolidationRecord?.revision || 1
        });
        this.resumableConsolidation = this.activeConsolidationRecord;
        return this.activeConsolidationRecord;
    }

    async completeMiniDay(date) {
        if (!this.multiDayResolver || this.multiDayResolver.stage !== 'mini') return;
        this.multiDayResolver.completeMiniDay(date);
        await this.persistMiniProgress();
        const dates = this.multiDayResolver.workDates || [];
        const nextIndex = dates.findIndex((workDate, index) => index > this.consolidationDayIndex && this.multiDayResolver.getDayState(workDate)?.status !== 'mini_day_completed');
        if (nextIndex >= 0) this.consolidationDayIndex = nextIndex;
        else if (this.consolidationDayIndex < dates.length - 1) this.consolidationDayIndex += 1;
        this.render();
    }

    async leaveMiniDayPendingAndContinue() {
        if (!this.multiDayResolver || this.multiDayResolver.stage !== 'mini') return;
        await this.persistMiniProgress();
        const dates = this.multiDayResolver.workDates || [];
        if (this.consolidationDayIndex < dates.length - 1) this.consolidationDayIndex += 1;
        this.render();
    }

    async createMiniConsolidatedDraft() {
        if (!this.multiDayResolver || this.multiDayResolver.stage !== 'mini' || !this.activeConsolidationId) return;
        const revision = this.activeConsolidationRecord?.revision || 1;
        const draft = this.multiDayResolver.buildMiniConsolidatedDraft({
            consolidationId: this.activeConsolidationId,
            revision,
            now: Date.now()
        });
        this.activeConsolidationRecord = this.consolidationStore
            ? await this.consolidationStore.saveConsolidated(draft, { sourceDrafts: this.getSelectedSourceDrafts() })
            : draft;
        if (this.consolidationStore) {
            this.activeConsolidationRecord = await this.consolidationStore.updateStatus(
                draft.saProjectId,
                draft.consolidationId,
                'comparing_sa'
            );
        }
        this.consolidatedResult = draft;
        const employeesSnapshot = toRaw(this.employees);
        const attendanceSnapshot = toRaw(this.attendance);
        const positionsSnapshot = toRaw(this.positions);
        const entityScopeSnapshot = this.entityScope ? toRaw(this.entityScope) : null;
        this.consolidationProposal = buildConsolidationProposal(draft, {
            employees: employeesSnapshot,
            attendance: attendanceSnapshot
        });
        this.multiDayResolver = createMultiDayAttendanceResolver({
            consolidation: draft,
            employees: employeesSnapshot,
            attendance: attendanceSnapshot,
            positions: positionsSnapshot,
            saProjectId: this.saProjectId,
            entityScope: entityScopeSnapshot,
            regularLimit: this.regularLimit,
            applyPlan: this.applyPlan,
            mergeOvertimeIntoNormal: this.mergeOvertimeIntoNormal,
            stage: 'sa'
        });
        this.connectedView = 'sa-comparison';
        this.consolidationDayIndex = 0;
        this.resumableConsolidation = this.activeConsolidationRecord;
        this.clearResolvedRowsExpansion();
        this.render();
    }

    async resumeConsolidation(record = this.resumableConsolidation) {
        if (!record) return;
        this.activeConsolidationId = record.consolidationId;
        this.activeConsolidationRecord = record;
        this.selectedDraftIds.clear();
        for (const ref of record.sourceRefs || []) {
            if (ref.submissionId) this.selectedDraftIds.add(ref.submissionId);
        }
        const employeesSnapshot = toRaw(this.employees);
        const attendanceSnapshot = toRaw(this.attendance);
        const positionsSnapshot = toRaw(this.positions);
        const entityScopeSnapshot = this.entityScope ? toRaw(this.entityScope) : null;
        const miniStage = record.status === 'resolving' || record.schema === 'mini-attendance-consolidation-progress/v1';
        this.consolidatedResult = record;
        this.consolidationProposal = miniStage ? null : buildConsolidationProposal(record, {
            employees: employeesSnapshot,
            attendance: attendanceSnapshot
        });
        this.multiDayResolver = createMultiDayAttendanceResolver({
            consolidation: record,
            employees: employeesSnapshot,
            attendance: attendanceSnapshot,
            positions: positionsSnapshot,
            saProjectId: this.saProjectId,
            entityScope: entityScopeSnapshot,
            regularLimit: this.regularLimit,
            applyPlan: this.applyPlan,
            mergeOvertimeIntoNormal: this.mergeOvertimeIntoNormal,
            stage: miniStage ? 'mini' : 'sa',
            completedMiniDates: record.completedDays || []
        });
        const dates = this.multiDayResolver.workDates || [];
        const firstPending = miniStage ? dates.findIndex(date => this.multiDayResolver.getDayState(date)?.status !== 'mini_day_completed') : 0;
        this.consolidationDayIndex = firstPending >= 0 ? firstPending : Math.max(0, dates.length - 1);
        this.connectedView = miniStage ? 'consolidation' : 'sa-comparison';
        this.clearResolvedRowsExpansion();
        this.render();
    }

    async discardResumableConsolidation() {
        const record = this.resumableConsolidation;
        if (!record || !this.consolidationStore) return;
        await this.consolidationStore.discard(record.saProjectId, record.consolidationId, 'Descartado desde la bandeja');
        this.resumableConsolidation = null;
        await this.loadResumableConsolidation();
        this.render();
    }

    async discardActiveConsolidation() {
        if (this.consolidationStore && this.activeConsolidationId && this.saProjectId) {
            await this.consolidationStore.discard(this.saProjectId, this.activeConsolidationId, 'Descartado por el usuario para crear una nueva revisión');
        }
        this.activeConsolidationId = null;
        this.activeConsolidationRecord = null;
        this.resumableConsolidation = null;
        this.consolidatedResult = null;
        this.consolidationProposal = null;
        this.multiDayResolver = null;
        this.consolidationDayIndex = 0;
        this.selectedDraftIds.clear();
        this.connectedView = 'inbox';
        this.clearResolvedRowsExpansion();
        await this.loadResumableConsolidation();
        this.render();
    }

    openConnectedConsolidation() {
        if (!this.consolidatedResult) return;
        this.connectedView = 'consolidation';
        this.render();
    }

    setGroupingMode(mode) {
        this.groupingMode = mode;
        this.render();
    }

    setDraftSortMode(mode) {
        this.draftSortMode = mode === 'updatedAt' ? 'updatedAt' : 'workDate';
        this.render();
    }

    setDraftStatusFilter(filter) {
        const allowed = new Set(['all', 'new', 'not-incorporated', 'incorporated']);
        this.draftStatusFilter = allowed.has(filter) ? filter : 'all';
        this.render();
    }

    getVersionGroups() {
        const bySeries = new Map();
        for (const draft of this.savedDrafts) {
            const seriesKey = draft.versioning?.seriesKey || `legacy:${draft.submissionId}`;
            if (!bySeries.has(seriesKey)) bySeries.set(seriesKey, []);
            bySeries.get(seriesKey).push(draft);
        }
        return [...bySeries.entries()].map(([seriesKey, drafts]) => {
            const ordered = [...drafts].sort((a, b) => Number(a.receivedAt || 0) - Number(b.receivedAt || 0));
            const original = ordered.find(item => item.versioning?.role === 'original') || ordered[0];
            const current = ordered.find(item => item.versioning?.role === 'current') || ordered[ordered.length - 1];
            const selected = ordered.find(item => this.selectedDraftIds.has(item.submissionId)) || null;
            const diff = current?.versioning?.diffFromOriginal || original?.versioning?.diffFromOriginal || null;
            return { seriesKey, original, current, selected, diff, updateCount: Math.max(Number(original?.versioning?.updateCount || 0), Number(current?.versioning?.updateCount || 0)) };
        }).filter(group => {
            // Meta 2: legacy persisted zero-attendance series are not actionable.
            try {
                return draftHasActualAttendance(group?.current);
            } catch {
                return true;
            }
        });
    }

    getVisibleDateSections() {
        const visible = this.getVisibleVersionGroups();
        const byDate = new Map();
        for (const group of visible) {
            const workDate = group?.current?.workDate || group?.original?.workDate || 'sin-fecha';
            if (!byDate.has(workDate)) byDate.set(workDate, []);
            byDate.get(workDate).push(group);
        }
        const updatedTime = draft => Number(draft?.updatedAt || draft?.receivedAt || 0);
        for (const groups of byDate.values()) {
            groups.sort((a, b) => updatedTime(b.current) - updatedTime(a.current) || String(a.seriesKey).localeCompare(String(b.seriesKey)));
        }
        const sections = [...byDate.entries()].map(([workDate, groups]) => ({
            workDate,
            displayDate: displayDate(workDate) || workDate,
            groups
        }));
        if (this.draftSortMode === 'updatedAt') {
            const maxTime = section => Math.max(0, ...section.groups.map(group => updatedTime(group.current)));
            sections.sort((a, b) => maxTime(b) - maxTime(a) || String(b.workDate).localeCompare(String(a.workDate)));
        } else {
            sections.sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)));
        }
        return sections;
    }

    getSelectableVisibleGroups() {
        return this.getVisibleVersionGroups().filter(group => !isIncorporatedDraft(group?.current));
    }

    isAllVisibleSelected() {
        const selectable = this.getSelectableVisibleGroups();
        if (!selectable.length) return false;
        return selectable.every(group => [group.original, group.current].some(item => item?.submissionId && this.selectedDraftIds.has(item.submissionId)));
    }

    toggleSelectAllVisible() {
        const selectable = this.getSelectableVisibleGroups();
        if (!selectable.length) return;
        if (this.isAllVisibleSelected()) {
            for (const group of selectable) {
                for (const draft of [group.original, group.current]) {
                    if (draft?.submissionId) this.selectedDraftIds.delete(draft.submissionId);
                }
            }
        } else {
            for (const group of selectable) {
                for (const draft of [group.original, group.current]) {
                    if (draft?.submissionId) this.selectedDraftIds.delete(draft.submissionId);
                }
                const choice = group.current || group.original;
                if (choice?.submissionId && !isIncorporatedDraft(choice)) this.selectedDraftIds.add(choice.submissionId);
            }
        }
        this.render();
    }

    getVisibleVersionGroups() {
        const groups = this.getVersionGroups().filter(group => {
            const draft = group.current;
            if (this.draftStatusFilter === 'new') return draft?.status === 'pending';
            if (this.draftStatusFilter === 'not-incorporated') return !isIncorporatedDraft(draft);
            if (this.draftStatusFilter === 'incorporated') return isIncorporatedDraft(draft);
            return true;
        });
        const updatedTime = draft => Number(draft?.updatedAt || draft?.receivedAt || 0);
        return groups.sort((a, b) => {
            if (this.draftSortMode === 'updatedAt') {
                return updatedTime(b.current) - updatedTime(a.current) || String(b.current?.workDate || '').localeCompare(String(a.current?.workDate || ''));
            }
            return String(b.current?.workDate || '').localeCompare(String(a.current?.workDate || '')) || updatedTime(b.current) - updatedTime(a.current);
        });
    }

    toggleVersionGroupSelection(group, checked) {
        for (const draft of [group.original, group.current]) {
            if (draft?.submissionId) this.selectedDraftIds.delete(draft.submissionId);
        }
        if (checked) {
            const choice = group.selected || group.current || group.original;
            if (choice?.submissionId && !isIncorporatedDraft(choice)) this.selectedDraftIds.add(choice.submissionId);
        }
        this.render();
    }

    selectVersionForGroup(group, draft) {
        const wasSelected = [group.original, group.current].some(item => item?.submissionId && this.selectedDraftIds.has(item.submissionId));
        for (const item of [group.original, group.current]) {
            if (item?.submissionId) this.selectedDraftIds.delete(item.submissionId);
        }
        if (wasSelected && draft?.submissionId && !isIncorporatedDraft(draft)) this.selectedDraftIds.add(draft.submissionId);
        this.render();
    }

    getVisibleDrafts() {
        const filtered = this.savedDrafts.filter(draft => {
            if (this.draftStatusFilter === 'new') return draft.status === 'pending';
            if (this.draftStatusFilter === 'not-incorporated') return !isIncorporatedDraft(draft);
            if (this.draftStatusFilter === 'incorporated') return isIncorporatedDraft(draft);
            return true;
        });
        const updatedTime = draft => Number(draft?.updatedAt || draft?.receivedAt || 0);
        return [...filtered].sort((a, b) => {
            if (this.draftSortMode === 'updatedAt') {
                return updatedTime(b) - updatedTime(a) || String(b.workDate || '').localeCompare(String(a.workDate || ''));
            }
            return String(b.workDate || '').localeCompare(String(a.workDate || '')) || updatedTime(b) - updatedTime(a);
        });
    }

    toggleDraftSelection(submissionId) {
        const draft = this.savedDrafts.find(item => item.submissionId === submissionId);
        if (isIncorporatedDraft(draft)) return;
        if (this.selectedDraftIds.has(submissionId)) {
            this.selectedDraftIds.delete(submissionId);
        } else {
            this.selectedDraftIds.add(submissionId);
        }
        this.render();
    }

    async markDraftsReviewed(drafts) {
        if (!this.inboxStore) return;
        const pending = drafts.filter(draft => draft.status === 'pending');
        if (!pending.length) return;
        const reviewedAt = Date.now();
        this.savedDrafts = this.savedDrafts.map(draft => pending.some(item => item.submissionId === draft.submissionId)
            ? { ...draft, status: 'reviewed', updatedAt: reviewedAt, metadata: { ...(draft.metadata || {}), reviewedAt } }
            : draft);
        try {
            const persisted = await Promise.all(pending.map(draft => this.inboxStore.updateStatus(
                draft.saProjectId,
                draft.submissionId,
                'reviewed',
                { metadata: { reviewedAt } }
            )));
            const byId = new Map(persisted.map(record => [record.submissionId, record]));
            this.savedDrafts = this.savedDrafts.map(draft => byId.get(draft.submissionId) || draft);
            try { globalThis.refreshSaP2PHeaderIndicator?.(); } catch (_) {}
        } catch (err) {
            console.warn('No se pudo marcar el borrador como revisado:', err);
        }
    }

    async completeConnectedImport() {
        if (!this.multiDayResolver || !this.inboxStore || !this.selectedDraftIds.size) return;
        const summary = this.multiDayResolver.getMultiDaySummary();
        if (!summary.totalDays || summary.appliedDaysCount !== summary.totalDays) return;
        const drafts = this.savedDrafts.filter(draft => this.selectedDraftIds.has(draft.submissionId));
        if (!drafts.length) return;
        const incorporatedAt = Date.now();
        try {
            await this.reviewStatusPromise;
            await Promise.all(drafts.map(draft => this.inboxStore.updateStatus(
                draft.saProjectId,
                draft.submissionId,
                'incorporated',
                { metadata: { incorporatedAt, incorporatedWorkDates: [...summary.workDates] } }
            )));
            this.savedDrafts = await this.inboxStore.list(
                this.saProjectId ? { saProjectId: this.saProjectId } : null
            );
            try { globalThis.refreshSaP2PHeaderIndicator?.(); } catch (_) {}
            const completedCount = drafts.length;
            this.selectedDraftIds.clear();
            this.consolidatedResult = null;
            this.consolidationProposal = null;
            this.multiDayResolver = null;
            this.connectedView = 'inbox';
            this.completionStatusMessage = `Importación completada. ${completedCount} borrador${completedCount === 1 ? '' : 'es'} marcado${completedCount === 1 ? '' : 's'} como incorporado${completedCount === 1 ? '' : 's'}.`;
            this.render();
            try {
                const completionEl = this.host?.querySelector('.mini-import-completion-message');
                signalP2PSuccess(P2P_SUCCESS_EVENTS.IMPORT_COMPLETED, {
                    message: this.completionStatusMessage,
                    title: 'Importación completada',
                    statusEl: completionEl || undefined,
                    pulseEl: completionEl || undefined
                });
            } catch (_) {}
        } catch (err) {
            console.error('Error completing connected import:', err);
            this.completionStatusMessage = 'No se pudo completar la importación. Los borradores no fueron marcados como incorporados.';
            this.render();
        }
    }

    async consolidateSelectedDrafts() {
        const drafts = this.getSelectedSourceDrafts();
        if (!drafts.length) return;

        // Never feed AppState's recursive proxies into the reconciliation engine.
        // A previously stored/frozen attendance record can contain non-configurable
        // nested values (for example positionHours); recursively proxying those values
        // violates Proxy invariants.  toRaw() crosses this boundary with plain mutable
        // snapshots while the canonical writer remains the only path back to state.
        const employeesSnapshot = toRaw(this.employees);
        const attendanceSnapshot = toRaw(this.attendance);
        const positionsSnapshot = toRaw(this.positions);
        const entityScopeSnapshot = this.entityScope ? toRaw(this.entityScope) : null;

        this.consolidatedResult = consolidateAttendanceSubmissions(drafts, {
            expectedSaProjectId: this.saProjectId
        });
        this.consolidationProposal = null;
        this.activeConsolidationId = this._newConsolidationId();
        this.activeConsolidationRecord = null;
        this.multiDayResolver = createMultiDayAttendanceResolver({
            consolidation: this.consolidatedResult,
            employees: employeesSnapshot,
            attendance: attendanceSnapshot,
            positions: positionsSnapshot,
            saProjectId: this.saProjectId,
            entityScope: entityScopeSnapshot,
            regularLimit: this.regularLimit,
            applyPlan: this.applyPlan,
            stage: 'mini'
        });
        this.connectedView = 'consolidation';
        this.consolidationDayIndex = 0;
        this.clearResolvedRowsExpansion();
        this.reviewStatusPromise = this.markDraftsReviewed(drafts);
        // Render the Mini↔Mini step immediately; persistence then completes in the
        // same action without blocking the modal transition.
        this.render();
        await this.persistMiniProgress();
    }

    async handleFetchConnected({ targetMiniIds = null } = {}) {
        if (this.isFetchingConnected) return;

        if (typeof this.onRequestSubmissions !== 'function') {
            this.transportStatusMessage = 'Transporte P2P en preparación: callback seam disponible (onRequestSubmissions).';
            this.render();
            return;
        }

        const isRetry = Array.isArray(targetMiniIds) && targetMiniIds.length > 0;
        const previousFailedTargets = new Set(isRetry ? this.failedMiniTargets : []);
        if (!isRetry) this.failedMiniTargets = [];
        const requestedMiniId = isRetry ? '' : this.selectedMiniId;
        const activeTargets = isRetry
            ? this.linkedMinis.filter(m =>
                targetMiniIds.includes(m.id) ||
                targetMiniIds.includes(m.peerId) ||
                targetMiniIds.includes(m.deviceId)
            )
            : (requestedMiniId
                ? this.linkedMinis.filter(m => (m.id || m.deviceId || m.peerId) === requestedMiniId)
                : this.linkedMinis);

        this.isFetchingConnected = true;
        this.connectionState = 'connecting';
        this.activeAbortController = new AbortController();

        // Initialize or update progress state for active targets
        activeTargets.forEach(target => {
            const peerKey = target.peerId || target.id || target.deviceId;
            this.peerProgress.set(peerKey, {
                peerId: peerKey,
                peerName: target.name || target.displayName || 'Mini',
                alias: target.alias || null,
                lastSeenAt: target.lastSeenAt || null,
                state: 'connecting',
                message: `Conectando con ${target.name || 'Mini'}…`
            });
        });

        if (isRetry) {
            this.transportStatusMessage = `Reintentando transferencia de ${targetMiniIds.length} Mini(s)...`;
        } else if (requestedMiniId) {
            const targetName = activeTargets[0]?.name || 'Mini vinculado';
            this.transportStatusMessage = `Transfiriendo asistencia desde ${targetName}...`;
        } else {
            this.transportStatusMessage = this.linkedMinis.length > 1
                ? `Transfiriendo asistencia desde ${this.linkedMinis.length} Minis vinculados...`
                : 'Transfiriendo asistencia desde el Mini vinculado...';
        }

        // Render once at start to mount in-flight UI, cancel button, and initial progress state
        this.render();

        try {
            const result = await this.onRequestSubmissions({
                miniId: requestedMiniId,
                targetMiniIds: isRetry ? targetMiniIds : null,
                date: this.connectedDate,
                rangeStart: this.connectedRangeStart,
                rangeEnd: this.connectedRangeEnd,
                groupingMode: this.groupingMode,
                signal: this.activeAbortController.signal,
                onProgress: (progress) => this.handlePeerProgress(progress)
            });

            if (this.inboxStore) {
                try {
                    this.savedDrafts = await this.inboxStore.list(
                        this.saProjectId ? { saProjectId: this.saProjectId } : null
                    );
                } catch (_) {}
            }

            const failedThisAttempt = new Set(
                Array.isArray(result?.errors)
                    ? result.errors.map(e => e.peer?.peerId || e.peer?.id || e.peer?.deviceId).filter(Boolean)
                    : []
            );
            if (isRetry) {
                // Differential retry: only mutate the peers that were retried.
                for (const targetId of targetMiniIds) previousFailedTargets.delete(targetId);
                for (const targetId of failedThisAttempt) previousFailedTargets.add(targetId);
                this.failedMiniTargets = [...previousFailedTargets];
            } else {
                this.failedMiniTargets = [...failedThisAttempt];
            }

            const stillHasFailures = this.failedMiniTargets.length > 0;
            if (result?.hasPartialError || result?.status === 'partial_success' || stillHasFailures) {
                this.connectionState = 'partial_success';
                const baseMessage = result?.message || 'Asistencia transferida parcialmente desde algunos Minis.';
                this.transportStatusMessage = stillHasFailures && isRetry
                    ? `${baseMessage} · ${this.failedMiniTargets.length} Mini(s) aún pendientes de transferir.`
                    : baseMessage;
            } else {
                this.connectionState = 'success';
                const count = result?.importedCount ?? (Array.isArray(result?.submissions) ? result.submissions.length : (result?.totalSubmissions ?? ''));
                const countText = count !== '' ? ` (${count} importados)` : '';
                this.transportStatusMessage = result?.message || `Asistencia transferida y guardada en borrador${countText}.`;
            }
        } catch (error) {
            if (this.inboxStore) {
                try {
                    this.savedDrafts = await this.inboxStore.list(
                        this.saProjectId ? { saProjectId: this.saProjectId } : null
                    );
                } catch (_) {}
            }

            const isAbort = error?.name === 'AbortError' ||
                error?.message?.includes('cancelad') ||
                this.connectionState === 'cancelled';

            if (isAbort) {
                this.connectionState = 'cancelled';
                this.transportStatusMessage = 'Transferencia cancelada por el usuario.';
            } else {
                this.connectionState = 'error';
                this.transportStatusMessage = `Error: ${error.message || error}`;
            }

            const failedThisAttempt = new Set(
                Array.isArray(error?.errors) && error.errors.length > 0
                    ? error.errors.map(e => e.peer?.peerId || e.peer?.id || e.peer?.deviceId).filter(Boolean)
                    : activeTargets.map(t => t.peerId || t.id || t.deviceId).filter(Boolean)
            );
            if (isRetry) {
                if (!isAbort) {
                    for (const targetId of targetMiniIds) previousFailedTargets.delete(targetId);
                    for (const targetId of failedThisAttempt) previousFailedTargets.add(targetId);
                }
                this.failedMiniTargets = [...previousFailedTargets];
            } else {
                this.failedMiniTargets = [...failedThisAttempt];
            }
        } finally {
            this.isFetchingConnected = false;
            this.activeAbortController = null;
            // Render only while the modal/mounted host still exists.
            if (this.host) this.render();
            // Terminal success only: full success, never partial/error/cancelled
            // and never intermediate connecting/authenticating/requesting states.
            if (this.connectionState === 'success' && this.host) {
                try {
                    const statusEl = this.host.querySelector('[data-mini-transport-seam]');
                    signalP2PSuccess(P2P_SUCCESS_EVENTS.ATTENDANCE_TRANSFERRED, {
                        message: this.transportStatusMessage || 'Asistencia transferida correctamente',
                        title: 'Asistencia recibida',
                        statusEl: statusEl || undefined,
                        pulseEl: statusEl || undefined
                    });
                } catch (_) {}
            }
        }
    }

    handleCancelFetch() {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
        }
    }

    handleRetryFailed() {
        if (this.failedMiniTargets.length > 0) {
            this.handleFetchConnected({ targetMiniIds: [...this.failedMiniTargets] });
        }
    }

    handlePeerProgress(progress) {
        if (!progress || !progress.peerId) return;
        const key = progress.peerId;
        const existing = this.peerProgress.get(key) || {};
        this.peerProgress.set(key, {
            ...existing,
            ...progress
        });
        this.updatePeerProgressDOM(progress);
    }

    /**
     * Targeted DOM patch for peer progress updates.
     * Avoids calling full this.render() on every progress tick to eliminate
     * UI flicker, element churn, loss of focus, and scroll position resets.
     * Full render is only performed once at start and once at conclusion.
     */
    updatePeerProgressDOM(progress) {
        if (!this.host) return;

        const peerId = progress.peerId;
        let statusBadge = this.host.querySelector(`[data-mini-peer-status="${peerId}"]`);
        if (!statusBadge) {
            const matched = this.linkedMinis.find(m => m.peerId === peerId || m.id === peerId || m.deviceId === peerId);
            if (matched) {
                const altKey = matched.id || matched.peerId || matched.deviceId;
                statusBadge = this.host.querySelector(`[data-mini-peer-status="${altKey}"]`);
            }
        }

        if (statusBadge) {
            statusBadge.textContent = this.getStateLabel(progress.state);
            statusBadge.dataset.miniPeerState = progress.state;
            statusBadge.className = `mini-import-peer-progress-status ${this.getStateClass(progress.state)}`.trim();
        }

        const noticeEl = this.host.querySelector('[data-mini-transport-seam]');
        if (noticeEl && progress.message) {
            noticeEl.textContent = progress.message;
            noticeEl.className = `mini-import-transport-notice is-${progress.state}`;
        }
    }

    getStateLabel(state) {
        switch (state) {
            case 'connecting': return 'Conectando…';
            case 'authenticating': return 'Autenticando…';
            case 'requesting': return 'Transfiriendo…';
            case 'receiving': return 'Recibiendo…';
            case 'success': return 'Completado';
            case 'timeout': return 'Tiempo agotado';
            case 'error': return 'Error';
            case 'cancelled': return 'Cancelado';
            case 'pending':
            default:
                return 'En espera';
        }
    }

    getStateClass(state) {
        switch (state) {
            case 'connecting':
            case 'authenticating':
            case 'requesting':
            case 'receiving':
                return 'is-active';
            case 'success':
                return 'is-success';
            case 'timeout':
                return 'is-timeout';
            case 'error':
                return 'is-error';
            case 'cancelled':
                return 'is-cancelled';
            default:
                return '';
        }
    }

    renderModeTabs() {
        const tabs = element('div', null, { className: 'mini-import-mode-tabs', dataset: { miniModeTabs: '' } });
        const connectedBtn = actionButton('Conectados', 'switch-mode-connected');
        connectedBtn.classList.add('mini-import-mode-btn');
        if (this.importMode === 'connected') connectedBtn.classList.add('is-active');
        connectedBtn.dataset.miniMode = 'connected';
        connectedBtn.addEventListener('click', () => this.setImportMode('connected'));

        const pasteBtn = actionButton('Pegar texto', 'switch-mode-paste');
        pasteBtn.classList.add('mini-import-mode-btn');
        if (this.importMode === 'paste') pasteBtn.classList.add('is-active');
        pasteBtn.dataset.miniMode = 'paste';
        pasteBtn.addEventListener('click', () => this.setImportMode('paste'));

        tabs.append(pasteBtn, connectedBtn);
        return tabs;
    }

    renderPaste() {
        const section = element('div', null, { className: 'mini-import-paste' });
        section.append(renderTopbar(1, 4, 'Importar asistencia desde Mini', 'Paso 1 · Pegado', 'PEGADO', () => this.close()));
        const content = element('div', null, { className: 'mini-import-content-gutter' });
        content.append(this.renderModeTabs());
        const id = `mini-attendance-source-${this.controlId}`;
        const label = element('label', 'Pega el reporte de Mini enviado por WhatsApp', { htmlFor: id });
        const textarea = element('textarea', null, {
            id,
            rows: 10,
            placeholder: 'Pega aquí el reporte copiado desde WhatsApp o la app Mini...',
            value: this.source,
            dataset: { miniSource: '' }
        });
        const analyze = actionButton('Analizar reporte', 'analyze', !this.source.trim());
        analyze.classList.add('mini-import-action-primary');
        textarea.addEventListener('input', () => {
            this.source = textarea.value;
            analyze.disabled = !this.source.trim();
        });
        analyze.addEventListener('click', () => this.analyze());
        const footer = element('div', null, { className: 'mini-import-footer mini-import-footer-end' });
        footer.append(analyze);
        content.append(label, textarea, footer);
        section.append(content);
        return section;
    }

    renderConnected() {
        const section = element('div', null, {
            className: `mini-import-paste mini-import-connected mini-import-connected-view-${this.connectedView}`,
            dataset: { miniConnectedView: this.connectedView }
        });
        const connectedStep = this.connectedView === 'inbox' ? 2
            : this.connectedView === 'consolidation' ? 3
                : this.connectedView === 'sa-comparison' ? 4 : 1;
        let subtitle = this.connectedView === 'inbox'
            ? 'Paso 2 · Bandeja de borradores'
            : this.connectedView === 'consolidation'
                ? 'Consolidar Minis'
                : this.connectedView === 'sa-comparison'
                    ? 'Comparar con SA'
                    : 'Paso 1 · Transferir desde Mini';
        let chip = this.connectedView === 'inbox'
            ? 'BANDEJA'
            : this.connectedView === 'consolidation'
                ? 'CONSOLIDAR'
                : this.connectedView === 'sa-comparison'
                    ? 'COMPARAR'
                    : 'TRANSFERIR';
        let topbarStep = connectedStep;
        let topbarTotal = 4;
        let topbarProgress = null;
        if (this.connectedView === 'consolidation' || this.connectedView === 'sa-comparison') {
            const isMiniStage = this.multiDayResolver?.stage === 'mini' || this.connectedView === 'consolidation';
            const stageLabel = isMiniStage ? 'Consolidar Minis' : 'Comparar con SA';
            const dates = this.multiDayResolver?.workDates || this.consolidatedResult?.workDates || [];
            const totalDays = Array.isArray(dates) ? dates.length : 0;
            if (totalDays > 0) {
                const currentDay = Math.max(1, Math.min(this.consolidationDayIndex + 1, totalDays));
                const dayText = `Día ${currentDay} de ${totalDays}`;
                const currentWorkDateIso = Array.isArray(dates) ? (dates[this.consolidationDayIndex] || dates[currentDay - 1] || '') : '';
                const centerWorkDate = currentWorkDateIso ? (displayDate(currentWorkDateIso) || currentWorkDateIso) : '';
                subtitle = `${stageLabel} · ${dayText}`;
                chip = isMiniStage ? 'CONSOLIDAR' : 'COMPARAR';
                topbarStep = currentDay;
                topbarTotal = totalDays;
                topbarProgress = {
                    stepText: dayText,
                    stepAriaLabel: subtitle,
                    now: currentDay,
                    min: 1,
                    max: totalDays,
                    ariaLabel: subtitle,
                    centerDate: centerWorkDate,
                    dayText
                };
            } else {
                subtitle = stageLabel;
                chip = isMiniStage ? 'CONSOLIDAR' : 'COMPARAR';
                topbarProgress = {
                    stepText: stageLabel,
                    stepAriaLabel: subtitle,
                    now: 1,
                    min: 1,
                    max: 1,
                    ariaLabel: subtitle
                };
            }
        }
        section.append(renderTopbar(topbarStep, topbarTotal, 'Importar asistencia desde Mini', subtitle, chip, () => this.close(), topbarProgress));
        const content = element('div', null, { className: 'mini-import-content-gutter' });
        if (this.connectedView === 'request') content.append(this.renderModeTabs());

        // 1. Linked Mini selection
        const selectionSection = element('div', null, { className: 'mini-import-connected-section', dataset: { miniConnectedSelection: '' } });
        const selectLabel = element('label', 'Seleccionar Mini vinculado:', { htmlFor: `mini-connected-${this.controlId}` });
        const selector = element('select', null, {
            id: `mini-connected-${this.controlId}`,
            className: 'mini-import-select',
            dataset: { miniConnectedSelector: '' }
        });

        if (this.linkedMinis.length > 0) {
            const defaultOpt = element('option', 'Todos los Minis vinculados', {
                value: '',
                selected: this.selectedMiniId === ''
            });
            selector.append(defaultOpt);
            this.linkedMinis.forEach(mini => {
                const opt = element('option', humanMiniLabel(mini), {
                    value: mini.id || mini.deviceId,
                    selected: Boolean(this.selectedMiniId) && (mini.id || mini.deviceId) === this.selectedMiniId
                });
                selector.append(opt);
            });
        } else {
            const noMinisOpt = element('option', 'No hay Minis vinculados en esta sesión', { value: '', disabled: true, selected: true });
            selector.append(noMinisOpt);
        }
        selector.addEventListener('change', (e) => {
            this.selectedMiniId = e.target.value;
            this.render();
        });

        const hint = element('p', 'Vincula dispositivos Mini desde Ajustes P2P para transferencia directa.', {
            className: 'mini-import-hint',
            dataset: { miniConnectedHint: '' }
        });
        selectionSection.append(selectLabel, selector, hint);
        if (this.linkedMinis.length > 0) {
            const linkedTechnical = this.linkedMinis.map(mini => {
                const human = humanMiniLabel(mini);
                const technicalId = mini.deviceId || mini.id || mini.peerId || '';
                return technicalId ? `${human} · ID: ${technicalId}` : '';
            });
            const linkedDetails = technicalDetailsDisclosure(linkedTechnical);
            if (linkedDetails) selectionSection.append(linkedDetails);
        }

        // 2. Day / Range controls + Grouping mode
        const dateSection = element('div', null, { className: 'mini-import-date-controls', dataset: { miniDateControls: '' } });
        const groupingToggle = element('div', null, { className: 'mini-import-grouping-toggle', dataset: { miniGroupingToggle: '' } });

        const dayGroupingBtn = actionButton('Por día', 'set-grouping-day');
        if (this.groupingMode === 'day') dayGroupingBtn.classList.add('is-active');
        dayGroupingBtn.dataset.miniGrouping = 'day';
        dayGroupingBtn.addEventListener('click', () => this.setGroupingMode('day'));

        const periodGroupingBtn = actionButton('Por período', 'set-grouping-period');
        if (this.groupingMode === 'period') periodGroupingBtn.classList.add('is-active');
        periodGroupingBtn.dataset.miniGrouping = 'period';
        periodGroupingBtn.addEventListener('click', () => this.setGroupingMode('period'));

        groupingToggle.append(dayGroupingBtn, periodGroupingBtn);

        const dateFields = element('div', null, { className: 'mini-import-date-fields' });
        if (this.groupingMode === 'day') {
            const dayLabel = element('label', 'Fecha de asistencia:', { htmlFor: `mini-date-${this.controlId}` });
            const dayInput = element('input', null, {
                type: 'date',
                id: `mini-date-${this.controlId}`,
                value: this.connectedDate,
                dataset: { miniDateInput: '' }
            });
            dayInput.addEventListener('input', (e) => {
                this.connectedDate = e.target.value;
            });
            dateFields.append(dayLabel, dayInput);
        } else {
            const startLabel = element('label', 'Desde:', { htmlFor: `mini-start-${this.controlId}` });
            const startInput = element('input', null, {
                type: 'date',
                id: `mini-start-${this.controlId}`,
                value: this.connectedRangeStart,
                dataset: { miniRangeStart: '' }
            });
            startInput.addEventListener('input', (e) => {
                this.connectedRangeStart = e.target.value;
            });

            const endLabel = element('label', 'Hasta:', { htmlFor: `mini-end-${this.controlId}` });
            const endInput = element('input', null, {
                type: 'date',
                id: `mini-end-${this.controlId}`,
                value: this.connectedRangeEnd,
                dataset: { miniRangeEnd: '' }
            });
            endInput.addEventListener('input', (e) => {
                this.connectedRangeEnd = e.target.value;
            });

            dateFields.append(startLabel, startInput, endLabel, endInput);
        }

        const actionsContainer = element('div', null, { className: 'mini-import-connected-actions' });

        const fetchBtn = actionButton(
            this.isFetchingConnected ? 'Transfiriendo...' : (this.connectionState === 'error' ? 'Reintentar transferencia' : 'Transferir asistencia desde Mini'),
            'fetch-connected',
            this.isFetchingConnected
        );
        fetchBtn.classList.add('mini-import-action-primary');
        fetchBtn.addEventListener('click', () => this.handleFetchConnected());
        actionsContainer.append(fetchBtn);

        if (this.isFetchingConnected) {
            const cancelBtn = actionButton('Cancelar', 'cancel-fetch');
            cancelBtn.classList.add('mini-import-cancel-btn');
            cancelBtn.dataset.miniAction = 'cancel-fetch';
            cancelBtn.addEventListener('click', () => this.handleCancelFetch());
            actionsContainer.append(cancelBtn);
        }

        if (!this.isFetchingConnected && this.failedMiniTargets.length > 0) {
            const retryBtn = actionButton(
                'Reintentar transferencia',
                'retry-failed'
            );
            retryBtn.classList.add('mini-import-retry-btn');
            retryBtn.dataset.miniAction = 'retry-failed';
            retryBtn.setAttribute('aria-label', `Reintentar transferencia, ${this.failedMiniTargets.length} pendientes`);
            retryBtn.append(renderCountBadge(this.failedMiniTargets.length, { label: 'pendientes', tone: 'warn' }));
            retryBtn.addEventListener('click', () => this.handleRetryFailed());
            actionsContainer.append(retryBtn);
        }

        dateSection.append(groupingToggle, dateFields, actionsContainer);

        if (this.transportStatusMessage) {
            const noticeClasses = ['mini-import-transport-notice'];
            if (this.connectionState && this.connectionState !== 'idle') {
                noticeClasses.push(`is-${this.connectionState}`);
            }
            const statusMsg = element('div', this.transportStatusMessage, {
                className: noticeClasses.join(' '),
                dataset: { miniTransportSeam: '' }
            });
            dateSection.append(statusMsg);
        }

        // Target progress list for all-Mini requests
        if (!this.selectedMiniId && this.linkedMinis.length > 0) {
            const progressList = element('div', null, {
                className: 'mini-import-peer-progress-list',
                dataset: { miniPeerProgressList: '' }
            });

            this.linkedMinis.forEach(mini => {
                const peerId = mini.id || mini.peerId || mini.deviceId;
                const progress = this.peerProgress.get(peerId);
                const currentState = progress?.state || 'pending';
                const displayName = humanMiniLabel(mini);
                const lastSeenText = `Última vez: ${formatMiniDate(mini.lastSeenAt)}`;

                const row = element('div', null, {
                    className: 'mini-import-peer-progress-row',
                    dataset: { miniPeerRow: peerId }
                });

                const nameWrap = element('div', null, {
                    className: 'mini-import-peer-progress-name',
                    dataset: { miniPeerName: peerId }
                });
                const nameTitle = element('strong', displayName);
                const lastSeenEl = element('div', lastSeenText, {
                    className: 'mini-import-peer-info-meta',
                    dataset: { miniPeerLastSeen: peerId }
                });
                nameWrap.append(nameTitle, lastSeenEl);

                const statusBadge = element('span', this.getStateLabel(currentState), {
                    className: `mini-import-peer-progress-status ${this.getStateClass(currentState)}`.trim(),
                    dataset: {
                        miniPeerStatus: peerId,
                        miniPeerState: currentState
                    }
                });

                row.append(nameWrap, statusBadge);

                if (!this.isFetchingConnected && (currentState === 'error' || currentState === 'timeout')) {
                    const peerRetryBtn = actionButton('Reintentar', `retry-peer-${peerId}`);
                    peerRetryBtn.classList.add('mini-import-peer-retry-btn');
                    peerRetryBtn.dataset.miniAction = 'retry-peer';
                    peerRetryBtn.dataset.miniTargetPeerId = peerId;
                    peerRetryBtn.addEventListener('click', () => {
                        this.handleFetchConnected({ targetMiniIds: [peerId] });
                    });
                    row.append(peerRetryBtn);
                }

                progressList.append(row);
            });

            dateSection.append(progressList);
        }

        // 3. Saved Draft List
        const draftsSection = element('div', null, { className: 'mini-import-saved-drafts', dataset: { miniSavedDrafts: '' } });
        const draftsHeader = element('div', null, { className: 'mini-import-drafts-header' });
        draftsHeader.append(element('h3', 'Borradores guardados en bandeja'));

        const refreshBtn = actionButton('Actualizar bandeja', 'refresh-drafts');
        refreshBtn.addEventListener('click', async () => {
            if (this.inboxStore) {
                this.savedDrafts = await this.inboxStore.list(
                    this.saProjectId ? { saProjectId: this.saProjectId } : null
                );
                this.render();
            }
        });
        draftsHeader.append(refreshBtn);
        draftsSection.append(draftsHeader);

        const allVersionGroups = this.getVersionGroups();
        const counts = {
            all: allVersionGroups.length,
            new: allVersionGroups.filter(group => group.current?.status === 'pending').length,
            notIncorporated: allVersionGroups.filter(group => !isIncorporatedDraft(group.current)).length,
            incorporated: allVersionGroups.filter(group => isIncorporatedDraft(group.current)).length
        };
        const filterBar = element('div', null, { className: 'mini-import-draft-filters', dataset: { miniDraftFilters: '' } });
        const statusLabelWrap = element('label', null, { className: 'mini-import-draft-filter' });
        statusLabelWrap.append(element('span', 'Estado'));
        const statusSelect = element('select', null, {
            className: 'mini-import-select',
            value: this.draftStatusFilter,
            dataset: { miniDraftStatusFilter: '' },
            'aria-label': 'Filtrar borradores por estado'
        });
        [
            ['all', `Todos (${counts.all})`],
            ['new', `Nuevos (${counts.new})`],
            ['not-incorporated', `No incorporados (${counts.notIncorporated})`],
            ['incorporated', `Incorporados (${counts.incorporated})`]
        ].forEach(([value, label]) => statusSelect.append(element('option', label, { value })));
        statusSelect.value = this.draftStatusFilter;
        statusSelect.addEventListener('change', () => this.setDraftStatusFilter(statusSelect.value));
        statusLabelWrap.append(statusSelect);

        const sortLabelWrap = element('label', null, { className: 'mini-import-draft-filter' });
        sortLabelWrap.append(element('span', 'Ordenar por'));
        const sortSelect = element('select', null, {
            className: 'mini-import-select',
            value: this.draftSortMode,
            dataset: { miniDraftSort: '' },
            'aria-label': 'Ordenar borradores'
        });
        sortSelect.append(
            element('option', 'Fecha del día', { value: 'workDate' }),
            element('option', 'Fecha de actualización', { value: 'updatedAt' })
        );
        sortSelect.value = this.draftSortMode;
        sortSelect.addEventListener('change', () => this.setDraftSortMode(sortSelect.value));
        sortLabelWrap.append(sortSelect);
        filterBar.append(statusLabelWrap, sortLabelWrap);
        draftsSection.append(filterBar);

        if (this.completionStatusMessage) {
            draftsSection.append(element('div', this.completionStatusMessage, {
                className: 'mini-import-completion-message',
                role: 'status'
            }));
        }

        if (!allVersionGroups.length) {
            draftsSection.append(
                element('p', 'No hay borradores guardados en la bandeja de entrada.', {
                    className: 'mini-import-empty-drafts', dataset: { miniEmptyDrafts: '' }
                })
            );
        } else {
            const renderGroupCard = (group) => {
                const draft = group.current;
                const original = group.original;
                const incorporated = isIncorporatedDraft(draft);
                const selectedId = group.selected?.submissionId || draft?.submissionId;
                const isChecked = !incorporated && [original, draft].some(item => item?.submissionId && this.selectedDraftIds.has(item.submissionId));
                const itemEl = element('div', null, {
                    className: `mini-import-draft-card mini-import-version-card${incorporated ? ' is-incorporated' : ''}`,
                    dataset: { miniDraftItem: draft.submissionId, miniDraftSeries: group.seriesKey, miniDraftState: incorporated ? 'incorporated' : draft.status || 'pending' }
                });
                const checkbox = element('input', null, { type: 'checkbox', checked: isChecked, disabled: incorporated, dataset: { miniDraftCheckbox: draft.submissionId } });
                checkbox.addEventListener('change', () => this.toggleVersionGroupSelection(group, checkbox.checked));
                const info = element('div', null, { className: 'mini-import-draft-info' });
                const sourceName = humanDraftSourceLabel(draft);
                const statusLabel = draft.status === 'pending' ? 'Nuevo' : draft.status === 'reviewed' ? 'No incorporado' : incorporated ? 'Incorporado' : draft.status || 'No incorporado';
                const headline = element('div', null, { className: 'mini-import-draft-title' });
                headline.append(element('strong', displayDate(draft.workDate) || draft.workDate), element('span', sourceName, { className: 'mini-import-draft-source' }));
                const meta = element('div', null, { className: 'mini-import-draft-meta' });
                meta.append(
                    element('span', `${draft.sourceSnapshot?.rows?.length || 0} empleado${draft.sourceSnapshot?.rows?.length === 1 ? '' : 's'}`),
                    element('span', statusLabel, { className: `mini-import-draft-status is-${draft.status || 'pending'}${incorporated ? ' is-incorporated' : ''}`, dataset: draft.status === 'pending' ? { miniDraftNew: '' } : {} })
                );
                if (group.updateCount > 0) meta.append(element('span', `Actualizado ${group.updateCount} ${group.updateCount === 1 ? 'vez' : 'veces'}`));
                info.append(headline, meta);
                const draftDetails = technicalDetailsDisclosure(draftTechnicalLines(draft));
                if (draftDetails) info.append(draftDetails);

                if (original?.submissionId !== draft?.submissionId) {
                    const choices = element('div', null, { className: 'mini-import-version-choices', dataset: { miniVersionChoices: group.seriesKey } });
                    const radioName = `mini-version-${this.controlId}-${group.seriesKey.replace(/[^a-z0-9_-]/gi, '-')}`;
                    [[original, 'Original'], [draft, 'Actual']].forEach(([candidate, label]) => {
                        const choice = element('label', null, { className: 'mini-import-version-choice' });
                        const radio = element('input', null, { type: 'radio', name: radioName, value: candidate.submissionId, checked: selectedId === candidate.submissionId, disabled: incorporated });
                        radio.addEventListener('change', () => { if (radio.checked) this.selectVersionForGroup(group, candidate); });
                        const captured = formatMiniDate(candidate.sourceSnapshot?.capturedAt || candidate.receivedAt);
                        choice.append(radio, element('span', `${label} · ${captured}`));
                        choices.append(choice);
                    });
                    info.append(choices);
                    const diff = group.diff;
                    const changes = element('details', null, { className: 'mini-import-version-diff', dataset: { miniVersionDiff: group.seriesKey } });
                    changes.append(element('summary', versionDiffSummaryText(diff)));
                    const detailsList = element('div', null, { className: 'mini-import-version-diff-list' });
                    if (diff?.details?.length) diff.details.forEach(detail => detailsList.append(element('div', versionDetailText(detail), { className: 'mini-import-version-diff-row' })));
                    else detailsList.append(element('div', 'La captura cambió, pero no hay diferencias de asistencia ni de estado.', { className: 'mini-import-version-diff-row' }));
                    changes.append(detailsList);
                    info.append(changes);
                }
                itemEl.append(checkbox, info);
                return itemEl;
            };
            const selectableGroups = this.getSelectableVisibleGroups();
            const allSelected = this.isAllVisibleSelected();
            const toggleAllBtn = actionButton(allSelected ? 'Deseleccionar todo' : 'Seleccionar todo', 'toggle-select-all', selectableGroups.length === 0);
            toggleAllBtn.classList.add('mini-import-select-all-btn');
            toggleAllBtn.dataset.miniSelectAll = '';
            toggleAllBtn.setAttribute('aria-label', allSelected ? 'Deseleccionar todo' : 'Seleccionar todo');
            toggleAllBtn.addEventListener('click', () => this.toggleSelectAllVisible());
            draftsSection.append(toggleAllBtn);
            const listEl = element('div', null, { className: 'mini-import-draft-list', dataset: { miniDraftList: '' } });
            const dateSections = this.getVisibleDateSections();
            dateSections.forEach(section => {
                const sectionEl = element('section', null, {
                    className: 'mini-import-date-section',
                    dataset: { miniDateSection: section.workDate }
                });
                const header = element('h4', `${section.displayDate} (${section.groups.length} fuente${section.groups.length === 1 ? '' : 's'})`, {
                    className: 'mini-import-date-title',
                    dataset: { miniDateTitle: section.workDate }
                });
                sectionEl.append(header);
                section.groups.forEach(group => sectionEl.append(renderGroupCard(group)));
                listEl.append(sectionEl);
            });
            if (!dateSections.length) {
                listEl.append(element('p', 'No hay borradores que coincidan con este filtro.', { className: 'mini-import-empty-drafts', dataset: { miniEmptyFilteredDrafts: '' } }));
            }
            draftsSection.append(listEl);
            const consolidateBtn = actionButton('Consolidar selecciones', 'consolidate-drafts', this.selectedDraftIds.size === 0);
            consolidateBtn.classList.add('mini-import-action-primary');
            consolidateBtn.setAttribute('aria-label', `Consolidar selecciones, ${this.selectedDraftIds.size} seleccionados`);
            consolidateBtn.append(renderCountBadge(this.selectedDraftIds.size, { label: 'seleccionados', tone: 'accent' }));
            consolidateBtn.addEventListener('click', () => { void this.consolidateSelectedDrafts(); });
            draftsSection.append(consolidateBtn);
        }

        // 4. Connected wizard navigation: request -> inbox -> consolidation.
        // Each view owns the body instead of stacking every stage into one long screen.
        if (this.connectedView === 'request') {
            const inboxCard = element('section', null, {
                className: 'mini-import-inbox-entry-card',
                dataset: { miniInboxEntry: '' }
            });
            const inboxCopy = element('div', null, { className: 'mini-import-inbox-entry-copy' });
            inboxCopy.append(
                element('h3', 'Bandeja de borradores'),
                element('p', this.getVersionGroups().length
                    ? `${this.getVersionGroups().length} fuente${this.getVersionGroups().length === 1 ? '' : 's'}/día guardada${this.getVersionGroups().length === 1 ? '' : 's'} para revisar cuando quieras.`
                    : 'Las transferencias recibidas se guardan aquí sin aplicar nada en SA.')
            );
            const openInboxBtn = actionButton(
                'Revisar borradores',
                'open-connected-inbox'
            );
            openInboxBtn.classList.add('mini-import-action-primary');
            openInboxBtn.setAttribute('aria-label', `Revisar borradores, ${this.getVersionGroups().length} pendientes`);
            openInboxBtn.append(renderCountBadge(this.getVersionGroups().length, { label: 'borradores pendientes', tone: 'accent' }));
            openInboxBtn.addEventListener('click', () => { void this.openConnectedInbox(); });
            inboxCard.append(inboxCopy, openInboxBtn);
            content.append(selectionSection, dateSection, inboxCard);
            section.append(content);
            return section;
        }

        if (this.connectedView === 'inbox') {
            const nav = element('div', null, { className: 'mini-import-connected-nav' });
            const back = actionButton('Volver a transferir', 'back-connected-request');
            back.classList.add('mini-import-action-secondary');
            back.addEventListener('click', () => this.openConnectedRequest());
            nav.append(back, element('p', 'Selecciona uno o varios borradores. Nada se aplica en SA hasta consolidar y comparar.', {
                className: 'mini-import-hint'
            }));
            content.append(nav);
            if (this.resumableConsolidation) {
                const resume = element('section', null, { className: 'mini-import-resume-card', dataset: { miniResumeConsolidation: this.resumableConsolidation.consolidationId } });
                const completed = this.resumableConsolidation.completedDays?.length || 0;
                const total = this.resumableConsolidation.workDates?.length || 0;
                const label = this.resumableConsolidation.status === 'resolving'
                    ? `Consolidación Mini pendiente · ${completed}/${total} días completados`
                    : 'Consolidado Mini revisado · pendiente de comparar/aplicar en SA';
                resume.append(element('strong', 'Continuar consolidación guardada'), element('p', label));
                const resumeBtn = actionButton('Continuar', 'resume-consolidation');
                resumeBtn.classList.add('mini-import-action-primary');
                resumeBtn.addEventListener('click', () => { void this.resumeConsolidation(); });
                const discardBtn = actionButton('Descartar consolidado', 'discard-consolidation');
                discardBtn.classList.add('mini-import-action-secondary');
                discardBtn.addEventListener('click', () => { void this.discardResumableConsolidation(); });
                resume.append(resumeBtn, discardBtn);
                content.append(resume);
            }
            content.append(draftsSection);
            section.append(content);
            return section;
        }

        const nav = element('div', null, { className: 'mini-import-connected-nav' });
        const back = actionButton('← Volver a la bandeja', 'back-connected-inbox');
        back.classList.add('mini-import-action-secondary');
        back.addEventListener('click', () => { void this.openConnectedInbox(); });
        nav.append(back);
        content.append(nav);
        if (this.consolidatedResult) {
            content.append(this.renderConsolidationSkeleton());
        } else {
            content.append(element('div', 'No hay una consolidación activa. Vuelve a la bandeja y selecciona borradores.', {
                className: 'mini-import-empty-drafts'
            }));
        }
        section.append(content);
        return section;
    }

    formatConnectedHours(normalHours, overtimeHours, { status = null, rosterStatus = null, missingRoster = false } = {}) {
        if (missingRoster) return 'No existe en este Mini';
        const normal = Number(normalHours || 0);
        const overtime = Number(overtimeHours || 0);
        const total = normal + overtime;
        if (rosterStatus === 'paused' && total === 0) return 'Pausado · 0h';
        if (status === 'unmarked' && total === 0) return '0h · Sin asistencia';
        if (overtime > 0) return `${total}h · ${normal} normales + ${overtime} extra`;
        return `${total}h`;
    }

    connectedConflictLabel(item) {
        const reasons = new Set(item?.conflictReasons || []);
        if (reasons.has('coverage_conflict')) return 'Conflicto de cobertura';
        if (reasons.has('roster_status_conflict')) return 'Conflicto de estado';
        if (reasons.has('attendance_status_conflict') || reasons.has('hours_conflict')) return 'Conflicto de asistencia';
        return item?.status === 'identity_conflict' ? 'Identidad no resuelta' : 'Conflicto';
    }

    isConsolidationRowPending(item, dayState, isMiniStage) {
        if (!item) return false;
        if (isMiniStage) {
            if (item.status !== 'resolved') return true;
            // Keep explicitly chosen rows visible until the day is confirmed so the
            // decision remains inspectable/changeable (live selection state).
            const hasVisibleSourceChoice = Array.isArray(item.sources) && item.sources.length > 1 &&
                (item.resolutionSource || Array.isArray(item.conflictingHours));
            if (hasVisibleSourceChoice) return true;
            return false;
        }
        if (!item.saEmployeeId || item.status === 'identity_conflict' || item.status === 'conflict') return true;
        const conflictRow = dayState?.conflictPlan?.rows?.find(row => row.employeeId === item.saEmployeeId);
        if (!conflictRow) return item.status !== 'resolved';
        // A safe keep-current default remains visible so the user can switch to Mini,
        // even though it no longer blocks applying the day.
        if (conflictRow.decision?.defaulted === true) return true;
        if (Array.isArray(conflictRow.blockers) && conflictRow.blockers.length > 0) return true;
        if (conflictRow.decision?.acknowledged !== true) return true;
        return false;
    }

    partitionConsolidationDayItems(group, dayState, isMiniStage) {
        const pending = [];
        const resolved = [];
        for (const item of (group?.items || [])) {
            if (this.isConsolidationRowPending(item, dayState, isMiniStage)) pending.push(item);
            else resolved.push(item);
        }
        return { pending, resolved };
    }

    isResolvedSectionExpanded(workDate) {
        return this.resolvedRowsExpanded?.get(workDate) === true;
    }

    toggleResolvedSection(workDate) {
        if (!this.resolvedRowsExpanded) this.resolvedRowsExpanded = new Map();
        const next = !this.isResolvedSectionExpanded(workDate);
        this.resolvedRowsExpanded.set(workDate, next);
        this.render();
    }

    getSafeBulkSaCandidates(group, dayState) {
        if (!group || !dayState?.conflictPlan) return [];
        const rowsByEmployee = new Map(
            (dayState.conflictPlan.rows || []).map(row => [row.employeeId, row])
        );
        return (group.items || []).filter(item => {
            const conflictRow = rowsByEmployee.get(item.saEmployeeId);
            return isSafeBulkSaConflict(item, conflictRow, this.employees);
        });
    }

    applySafeBulkForDay(workDate, action) {
        if (!this.multiDayResolver || typeof this.multiDayResolver.resolveDaySafeBulkConflicts !== 'function') return;
        try {
            this.multiDayResolver.resolveDaySafeBulkConflicts(workDate, action);
        } catch (err) {
            console.error('Error applying day bulk action:', err);
            return;
        }
        this.render();
    }

    clearResolvedRowsExpansion() {
        if (this.resolvedRowsExpanded) this.resolvedRowsExpanded.clear();
    }

    buildSaBulkActions(group, dayState) {
        const safeCandidates = this.getSafeBulkSaCandidates(group, dayState);
        if (!safeCandidates.length) return null;
        const bar = element('div', null, {
            className: 'mini-sa-bulk-actions',
            dataset: { miniSaBulkActions: group.workDate }
        });
        bar.append(element('span', `Acción para ${safeCandidates.length} diferencia${safeCandidates.length === 1 ? '' : 's'}:`, { className: 'mini-control-label' }));
        const useBtn = actionButton('Usar Mini en cambios', 'bulk-use-mini');
        useBtn.classList.add('mini-sa-choice-button');
        useBtn.dataset.miniDate = group.workDate;
        useBtn.dataset.miniSaBulk = 'use';
        useBtn.addEventListener('click', () => this.applySafeBulkForDay(group.workDate, 'use_imported'));
        const keepBtn = actionButton('Conservar actuales', 'bulk-keep-sa');
        keepBtn.classList.add('mini-sa-choice-button', 'is-selected');
        keepBtn.setAttribute('aria-pressed', 'true');
        keepBtn.dataset.miniDate = group.workDate;
        keepBtn.dataset.miniSaBulk = 'keep';
        keepBtn.addEventListener('click', () => this.applySafeBulkForDay(group.workDate, 'keep_existing'));
        bar.append(useBtn, keepBtn);
        return bar;
    }

    buildResolvedToggle(group, resolvedCount, expanded) {
        const wrap = element('div', null, {
            className: 'mini-resolved-toggle-wrap',
            dataset: { miniResolvedWrap: group.workDate }
        });
        const toggle = actionButton(
            `${resolvedCount} resuelto${resolvedCount === 1 ? '' : 's'} · ${expanded ? 'Ocultar' : 'Mostrar'}`,
            'toggle-resolved-rows'
        );
        toggle.classList.add('mini-import-action-secondary', 'mini-resolved-toggle');
        toggle.dataset.miniDate = group.workDate;
        toggle.dataset.miniResolvedToggle = group.workDate;
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.addEventListener('click', () => this.toggleResolvedSection(group.workDate));
        wrap.append(toggle);
        return wrap;
    }

    renderConsolidationSkeleton() {
        const container = element('div', null, {
            className: 'mini-import-consolidation-skeleton',
            dataset: { miniConsolidationSkeleton: '' }
        });

        const isMiniStage = this.multiDayResolver?.stage === 'mini';
        const isSaStage = this.multiDayResolver?.stage === 'sa';
        const summary = this.consolidatedResult.summary || this.multiDayResolver?.getMiniProgressSnapshot?.().summary || {
            totalItems: 0, resolvedCount: 0, hoursConflictCount: 0, unresolvedIdentityCount: 0
        };
        const badges = element('div', null, {
            className: 'mini-consolidation-summary-badges',
            dataset: { miniExecutiveStatus: '' },
            role: 'status'
        });
        const appendPositiveBadge = (value, label, className) => {
            const count = Number(value || 0);
            if (count <= 0) return;
            badges.append(element('span', `${label}: ${count}`, { className: `mini-badge ${className}` }));
        };
        appendPositiveBadge(summary.totalItems, 'Total', 'mini-badge-total');
        appendPositiveBadge(summary.resolvedCount, 'Resueltos', 'mini-badge-resolved');
        appendPositiveBadge(summary.hoursConflictCount, 'Conflictos entre Minis', 'mini-badge-conflict');
        appendPositiveBadge(summary.unresolvedIdentityCount, 'Identidades no resueltas', 'mini-badge-unresolved');

        if (this.multiDayResolver) {
            const multiSummary = this.multiDayResolver.getMultiDaySummary();
            if (isMiniStage) {
                const reviewedDays = this.multiDayResolver.completedMiniDates?.size || 0;
                if (reviewedDays > 0) {
                    badges.append(element('span', `Días revisados: ${reviewedDays}/${multiSummary.totalDays}`, {
                        className: 'mini-badge mini-badge-ready-days'
                    }));
                }
            } else {
                appendPositiveBadge(multiSummary.readyDaysCount, 'Días listos', 'mini-badge-ready-days');
                appendPositiveBadge(multiSummary.appliedDaysCount, 'Días aplicados', 'mini-badge-applied-days');
            }
        }

        // La conciliación conectada siempre se pagina por día. El modo por período
        // sólo controla la solicitud/agrupación de entrada, no la resolución humana.
        const grouped = this.multiDayResolver
            ? this.multiDayResolver.getConsolidatedView('day')
            : groupConsolidatedAttendance(this.consolidatedResult, 'day');
        const groupsContainer = element('div', null, { className: 'mini-consolidation-groups' });

        if (grouped.mode === 'day') {
            const totalDays = grouped.groups.length;
            if (totalDays > 0) this.consolidationDayIndex = Math.max(0, Math.min(this.consolidationDayIndex, totalDays - 1));
            const visibleGroups = totalDays ? [grouped.groups[this.consolidationDayIndex]] : [];
            if (totalDays) {
                groupsContainer.append(element('div', `Día ${this.consolidationDayIndex + 1} de ${totalDays}`, {
                    className: 'mini-consolidation-day-counter',
                    dataset: { miniDayCounter: '' }
                }));
            }
            visibleGroups.forEach(group => {
                const groupEl = element('div', null, { className: 'mini-consolidation-group-card' });
                const headerEl = element('div', null, { className: 'mini-consolidation-group-header' });
                headerEl.append(
                    element('h4', `${displayDate(group.workDate)} · ${group.items.length} trabajadores`)
                );

                const dayState = this.multiDayResolver ? this.multiDayResolver.getDayState(group.workDate) : null;
                if (dayState) {
                    const statusText = dayState.status === 'mini_day_completed'
                        ? 'Día consolidado'
                        : dayState.status === 'mini_day_ready'
                            ? 'Listo para completar'
                            : dayState.status === 'applied'
                                ? 'Aplicado'
                                : dayState.status === 'ready'
                                    ? 'Listo para aplicar'
                                    : dayState.status === 'stage_b_conflict'
                                        ? 'Cambio por revisar'
                                        : 'Conflicto entre Minis';
                    headerEl.append(element('span', statusText, {
                        className: `mini-day-status is-${dayState.status}`,
                        dataset: { miniDayStatus: dayState.status, miniDayDate: group.workDate }
                    }));

                    if (!isMiniStage) {
                        const applyDayBtn = actionButton('Aplicar este día', 'apply-day', !dayState.canApply);
                        applyDayBtn.dataset.miniDate = group.workDate;
                        applyDayBtn.addEventListener('click', async () => {
                            try {
                                await this.multiDayResolver.applyDay(group.workDate);
                                this.render();
                            } catch (err) {
                                console.error('Error applying day:', err);
                            }
                        });
                        headerEl.append(applyDayBtn);
                    }
                }
                groupEl.append(headerEl);

                if (isMiniStage && this.multiDayResolver) {
                    const sourceMap = new Map();
                    let hasCrossMiniChoice = false;
                    group.items.forEach(item => {
                        if (Array.isArray(item.sources) && item.sources.length > 1) hasCrossMiniChoice = true;
                        (item.sources || []).forEach(source => {
                            if (!source?.deviceId || source.missingRoster === true) return;
                            if (!sourceMap.has(source.deviceId)) {
                                sourceMap.set(source.deviceId, humanSourceLabel(source));
                            }
                        });
                    });
                    if (hasCrossMiniChoice && sourceMap.size > 0) {
                        const quickActions = element('div', null, {
                            className: 'mini-day-source-actions',
                            dataset: { miniDaySourceActions: group.workDate }
                        });
                        quickActions.append(element('span', 'Acción rápida para este día:', { className: 'mini-control-label' }));
                        sourceMap.forEach((sourceName, deviceId) => {
                            const useSourceBtn = actionButton(`Usar todo de ${sourceName}`, 'use-day-source');
                            useSourceBtn.dataset.miniDate = group.workDate;
                            useSourceBtn.dataset.miniDeviceId = deviceId;
                            useSourceBtn.addEventListener('click', async () => {
                                this.multiDayResolver.resolveDayFromSource(group.workDate, deviceId);
                                await this.persistMiniProgress();
                                this.render();
                            });
                            quickActions.append(useSourceBtn);
                        });
                        groupEl.append(quickActions);
                    }
                }

                if (!isMiniStage && dayState?.conflictPlan) {
                    const bulkBar = this.buildSaBulkActions(group, dayState);
                    if (bulkBar) groupEl.append(bulkBar);
                }
                const __partition = this.partitionConsolidationDayItems(group, dayState, isMiniStage);
                const __showResolvedToggle = __partition.pending.length > 0 && __partition.resolved.length > 0;
                const __resolvedExpanded = this.isResolvedSectionExpanded(group.workDate);
                const __displayItems = !__showResolvedToggle
                    ? [...__partition.pending, ...__partition.resolved]
                    : (__resolvedExpanded ? [...__partition.pending, ...__partition.resolved] : [...__partition.pending]);
                const itemsList = element('div', null, { className: 'mini-consolidation-items-list' });
                __displayItems.forEach(item => {
                    const rowEl = element('div', null, {
                        className: `mini-consolidation-row is-${item.status}`,
                        dataset: { miniConsolidationItem: item.id }
                    });
                    const statusLabel = this.connectedConflictLabel(item);
                    const humanSources = Array.isArray(item.sources)
                        ? [...new Set(item.sources.map(humanSourceLabel).filter(Boolean))]
                        : [];
                    const sourcesText = humanSources.join(', ');
                    rowEl.append(
                        element('span', item.displayName || 'Sin nombre', { className: 'mini-row-name' }),
                        element('span', item.displayNumber ? `#${item.displayNumber}` : '', { className: 'mini-row-number' }),
                        element('span', item.normalHours !== null
                            ? this.formatConnectedHours(item.normalHours, item.overtimeHours, { status: item.sourceStatus, rosterStatus: item.rosterStatus })
                            : 'Requiere resolución', { className: 'mini-row-hours' }),
                        item.status === 'resolved'
                            ? resolvedCheckSvg('Resuelto')
                            : element('span', statusLabel, { className: `mini-row-status is-${item.status}` })
                    );
                    if (sourcesText) {
                        rowEl.append(element('span', `Mini: ${sourcesText}`, { className: 'mini-row-provenance', dataset: { miniSourceProvenance: '' } }));
                    }
                    const itemTechnical = technicalDetailsDisclosure(consolidationTechnicalLines(item));
                    if (itemTechnical) rowEl.append(itemTechnical);

                    // Multi-day Resolver interactive controls
                    if (this.multiDayResolver) {
                        // 1. Unresolved Identity
                        if (item.status === 'identity_conflict' || !item.saEmployeeId) {
                            const resolveIdentityEl = element('div', null, {
                                className: 'mini-identity-resolve-row',
                                dataset: { miniUnresolvedIdentity: item.id }
                            });
                            resolveIdentityEl.append(element('span', 'Vincular a empleado SA:', { className: 'mini-control-label' }));
                            const empSelect = element('select', null, {
                                className: 'mini-import-select',
                                dataset: { miniSelectEmployee: item.id }
                            });
                            empSelect.append(element('option', '-- Seleccionar empleado --', { value: '', disabled: true, selected: true }));
                            this.multiDayResolver.getIdentityCandidates().forEach(emp => {
                                empSelect.append(element('option', `${emp.number ? '#' + emp.number + ' ' : ''}${emp.name}`, { value: emp.id }));
                            });
                            const linkBtn = actionButton('Vincular', 'resolve-identity', true);
                            linkBtn.dataset.miniItemId = item.id;
                            empSelect.addEventListener('change', () => {
                                linkBtn.disabled = !empSelect.value;
                            });
                            linkBtn.addEventListener('click', async () => {
                                if (!empSelect.value) return;
                                this.multiDayResolver.resolveItemIdentity(item.id, empSelect.value);
                                if (isMiniStage) await this.persistMiniProgress();
                                this.render();
                            });
                            resolveIdentityEl.append(empSelect, linkBtn);
                            rowEl.append(resolveIdentityEl);
                        }

                        // 2. Hours conflict between Minis. Keep the chosen source visible
                        // until the day is confirmed so the decision remains inspectable/changeable.
                        const hadSourceChoice = Array.isArray(item.sources) && item.sources.length > 1 &&
                            (item.status === 'conflict' || item.resolutionSource || Array.isArray(item.conflictingHours));
                        if (isMiniStage && hadSourceChoice) {
                            const resolveHoursEl = element('div', null, {
                                className: 'mini-hours-resolve-row',
                                dataset: { miniHoursConflict: item.id }
                            });
                            resolveHoursEl.append(element('span', item.resolutionSource
                                ? 'Versión seleccionada para el consolidado:'
                                : 'Elegir versión para el consolidado:', { className: 'mini-control-label' }));
                            item.sources.forEach((src, srcIndex) => {
                                if (src.missingRoster === true) return;
                                const sourceName = humanSourceLabel(src);
                                const sourceDetail = this.formatConnectedHours(src.normalHours, src.overtimeHours, {
                                    status: src.status,
                                    rosterStatus: src.rosterStatus,
                                    missingRoster: false
                                });
                                const selected = Boolean(item.resolutionSource?.deviceId && item.resolutionSource.deviceId === src.deviceId);
                                const srcBtn = actionButton(`${sourceName}: ${sourceDetail}`, 'resolve-hours');
                                srcBtn.dataset.miniItemId = item.id;
                                srcBtn.dataset.miniSourceIndex = String(srcIndex);
                                srcBtn.classList.toggle('is-selected', selected);
                                srcBtn.setAttribute('aria-pressed', selected ? 'true' : 'false');
                                if (selected) srcBtn.append(selectedCheckSvg());
                                srcBtn.addEventListener('click', async () => {
                                    this.multiDayResolver.resolveItemHours(item.id, { sourceIndex: srcIndex });
                                    await this.persistMiniProgress();
                                    this.render();
                                });
                                resolveHoursEl.append(srcBtn);
                            });
                            rowEl.append(resolveHoursEl);
                        }

                        // 3. Existing SA conflict
                        if (dayState && dayState.conflictPlan) {
                            const conflictRow = dayState.conflictPlan.rows.find(r => r.employeeId === item.saEmployeeId);
                            if (conflictRow && !conflictRow.isIdentical) {
                                const saConflictEl = element('div', null, {
                                    className: 'mini-sa-conflict-row',
                                    dataset: { miniSaConflict: item.saEmployeeId }
                                });
                                const existingRecord = conflictRow.existing?.record || null;
                                const existingNormal = existingRecord?.hoursWorked || 0;
                                const existingOvertime = existingRecord?.overtimeHours || 0;
                                const importedTotal = Number(item.normalHours || 0) + Number(item.overtimeHours || 0);
                                const existingTotal = existingNormal + existingOvertime;
                                const selectedAction = conflictRow.decision?.action || 'keep_existing';
                                const importedSelected = selectedAction === 'use_imported';
                                const currentSelected = !importedSelected;

                                const compare = element('div', null, {
                                    className: 'mini-sa-compare',
                                    dataset: { miniSaCompare: item.saEmployeeId }
                                });
                                const importedSide = element('div', null, {
                                    className: `mini-sa-compare-side ${importedSelected ? 'is-selected' : 'is-discarded'}`
                                });
                                importedSide.append(
                                    element('span', 'Mini', { className: 'mini-sa-compare-label' }),
                                    element('strong', this.formatConnectedHours(item.normalHours, item.overtimeHours, {
                                        status: item.sourceStatus,
                                        rosterStatus: item.rosterStatus
                                    }), { className: 'mini-sa-compare-value' })
                                );
                                const currentStatus = existingRecord?.present === false && existingTotal === 0 ? 'unmarked' : 'present';
                                const currentSide = element('div', null, {
                                    className: `mini-sa-compare-side ${currentSelected ? 'is-selected' : 'is-discarded'}`
                                });
                                currentSide.append(
                                    element('span', 'Actual', { className: 'mini-sa-compare-label' }),
                                    element('strong', this.formatConnectedHours(existingNormal, existingOvertime, {
                                        status: currentStatus
                                    }), { className: 'mini-sa-compare-value' })
                                );
                                compare.append(importedSide, comparisonArrowSvg(), currentSide);

                                const actions = element('div', null, { className: 'mini-sa-conflict-actions' });
                                const useImportedBtn = actionButton('Usar Mini', 'use-imported');
                                useImportedBtn.classList.add('mini-sa-choice-button');
                                useImportedBtn.classList.toggle('is-selected', importedSelected);
                                useImportedBtn.setAttribute('aria-pressed', importedSelected ? 'true' : 'false');
                                useImportedBtn.dataset.miniEmployeeId = item.saEmployeeId;
                                useImportedBtn.dataset.miniDate = group.workDate;
                                useImportedBtn.addEventListener('click', () => {
                                    this.multiDayResolver.resolveDayConflict(group.workDate, item.saEmployeeId, { action: 'use_imported' });
                                    this.render();
                                });

                                const keepCurrentBtn = actionButton('Conservar actual', 'keep-sa');
                                keepCurrentBtn.classList.add('mini-sa-choice-button');
                                keepCurrentBtn.classList.toggle('is-selected', currentSelected);
                                keepCurrentBtn.setAttribute('aria-pressed', currentSelected ? 'true' : 'false');
                                keepCurrentBtn.dataset.miniEmployeeId = item.saEmployeeId;
                                keepCurrentBtn.dataset.miniDate = group.workDate;
                                keepCurrentBtn.addEventListener('click', () => {
                                    this.multiDayResolver.resolveDayConflict(group.workDate, item.saEmployeeId, { action: 'keep_existing' });
                                    this.render();
                                });
                                actions.append(useImportedBtn, keepCurrentBtn);
                                saConflictEl.append(compare, actions);
                                rowEl.append(saConflictEl);
                            }

                            const needsPosition = conflictRow &&
                                conflictRow.decision?.action === 'use_imported' &&
                                conflictRow.blockers?.some(blocker =>
                                    blocker === 'target_position_required' || blocker === 'target_position_invalid'
                                );
                            if (needsPosition) {
                                const positionEl = element('div', null, {
                                    className: 'mini-position-resolve-row',
                                    dataset: { miniPositionConflict: item.saEmployeeId }
                                });
                                positionEl.append(element('span', 'Asignar las horas importadas a una posición:', {
                                    className: 'mini-control-label'
                                }));
                                const positionSelect = element('select', null, {
                                    className: 'mini-import-select',
                                    dataset: { miniSelectPosition: item.saEmployeeId }
                                });
                                positionSelect.append(element('option', '-- Seleccionar posición --', {
                                    value: '', disabled: true, selected: true
                                }));
                                (conflictRow.employeePositionIds || []).forEach(positionId => {
                                    const position = this.positions.find(pos => pos.id === positionId);
                                    positionSelect.append(element('option', position?.name || positionId, { value: positionId }));
                                });
                                const assignPositionBtn = actionButton(
                                    'Asignar posición y continuar',
                                    'resolve-position',
                                    true
                                );
                                assignPositionBtn.dataset.miniEmployeeId = item.saEmployeeId;
                                assignPositionBtn.dataset.miniDate = group.workDate;
                                positionSelect.addEventListener('change', () => {
                                    assignPositionBtn.disabled = !positionSelect.value;
                                });
                                assignPositionBtn.addEventListener('click', () => {
                                    if (!positionSelect.value) return;
                                    this.multiDayResolver.resolveDayConflict(group.workDate, item.saEmployeeId, {
                                        action: 'use_imported',
                                        targetPositionId: positionSelect.value
                                    });
                                    this.render();
                                });
                                positionEl.append(positionSelect, assignPositionBtn);
                                rowEl.append(positionEl);
                            }
                        }
                    }

                    if (isSaStage && dayState?.status !== 'applied' && this.multiDayResolver) {
                        const ignoreActions = element('div', null, {
                            className: 'mini-import-unit-actions',
                            dataset: { miniIgnoreAttendance: item.id }
                        });
                        const ignoreBtn = actionButton('Ignorar esta asistencia', 'ignore-consolidated-attendance');
                        ignoreBtn.classList.add('mini-import-action-secondary');
                        ignoreBtn.dataset.miniItemId = item.id;
                        ignoreBtn.dataset.miniDate = group.workDate;
                        ignoreBtn.addEventListener('click', () => this.requestIgnoreConsolidatedItem(item));
                        ignoreActions.append(ignoreBtn);
                        rowEl.append(ignoreActions);
                    }

                    itemsList.append(rowEl);
                });
                groupEl.append(itemsList);
                if (__showResolvedToggle) {
                    groupEl.append(this.buildResolvedToggle(group, __partition.resolved.length, __resolvedExpanded));
                }
                groupsContainer.append(groupEl);
            });
        } else {
            // mode === 'period'
            const periodHeader = element('h4', `Período: ${grouped.periodStart} al ${grouped.periodEnd}`);
            groupsContainer.append(periodHeader);

            const itemsList = element('div', null, { className: 'mini-consolidation-items-list' });
            grouped.employeeGroups.forEach(emp => {
                const rowEl = element('div', null, {
                    className: `mini-consolidation-row is-${emp.hasConflicts ? 'conflict' : 'resolved'}`,
                    dataset: { miniConsolidationItem: `period:${emp.saEmployeeId}` }
                });
                rowEl.append(
                    element('span', emp.displayName, { className: 'mini-row-name' }),
                    element('span', `#${emp.displayNumber}`, { className: 'mini-row-number' }),
                    element('span', `${emp.totalNormalHours}h norm / ${emp.totalOvertimeHours}h extra`, { className: 'mini-row-hours' }),
                    emp.hasConflicts
                        ? element('span', 'Conflicto', { className: 'mini-row-status is-conflict' })
                        : resolvedCheckSvg('Resuelto')
                );
                itemsList.append(rowEl);
            });
            if (grouped.unresolvedItems.length > 0) {
                const unresHeader = element('h5', `Identidades no resueltas (${grouped.unresolvedItems.length})`);
                groupsContainer.append(unresHeader);
                grouped.unresolvedItems.forEach(item => {
                    const rowEl = element('div', null, {
                        className: 'mini-consolidation-row is-identity_conflict',
                        dataset: { miniConsolidationItem: item.id }
                    });
                    const periodSources = Array.isArray(item.sources)
                        ? [...new Set(item.sources.map(humanSourceLabel).filter(Boolean))].join(', ')
                        : '';
                    rowEl.append(
                        element('span', item.displayName || 'Sin nombre', { className: 'mini-row-name' }),
                        element('span', item.displayNumber ? `#${item.displayNumber}` : '', { className: 'mini-row-number' }),
                        element('span', `${item.normalHours}h`, { className: 'mini-row-hours' }),
                        element('span', 'Identidad no resuelta', { className: 'mini-row-status is-identity_conflict' })
                    );
                    if (periodSources) {
                        rowEl.append(element('span', `Mini: ${periodSources}`, { className: 'mini-row-provenance', dataset: { miniSourceProvenance: '' } }));
                    }
                    const periodTechnical = technicalDetailsDisclosure(consolidationTechnicalLines(item));
                    if (periodTechnical) rowEl.append(periodTechnical);

                    if (this.multiDayResolver) {
                        const resolveIdentityEl = element('div', null, {
                            className: 'mini-identity-resolve-row',
                            dataset: { miniUnresolvedIdentity: item.id }
                        });
                        resolveIdentityEl.append(element('span', 'Vincular a empleado SA:', { className: 'mini-control-label' }));
                        const empSelect = element('select', null, {
                            className: 'mini-import-select',
                            dataset: { miniSelectEmployee: item.id }
                        });
                        empSelect.append(element('option', '-- Seleccionar empleado --', { value: '', disabled: true, selected: true }));
                        this.multiDayResolver.getIdentityCandidates().forEach(emp => {
                            empSelect.append(element('option', `${emp.number ? '#' + emp.number + ' ' : ''}${emp.name}`, { value: emp.id }));
                        });
                        const linkBtn = actionButton('Vincular', 'resolve-identity', true);
                        linkBtn.dataset.miniItemId = item.id;
                        empSelect.addEventListener('change', () => {
                            linkBtn.disabled = !empSelect.value;
                        });
                        linkBtn.addEventListener('click', () => {
                            if (!empSelect.value) return;
                            this.multiDayResolver.resolveItemIdentity(item.id, empSelect.value);
                            this.render();
                        });
                        resolveIdentityEl.append(empSelect, linkBtn);
                        rowEl.append(resolveIdentityEl);
                    }

                    itemsList.append(rowEl);
                });
            }
            groupsContainer.append(itemsList);
        }

        // Single compact stage notice: one sentence, no counts (counts live only in the executive badges above).
        const proposalNotice = element('div', null, {
            className: 'mini-proposal-seam-notice',
            dataset: { miniProposalSeam: '' }
        });
        proposalNotice.append(
            element('strong', isMiniStage ? 'Consolidar Minis:' : 'Comparar con SA:'),
            element('p', isMiniStage
                ? 'En este paso solo se consolidan los Minis. SA no participa todavía y nada se aplica.'
                : 'Esta etapa usa únicamente el consolidado Mini revisado para compararlo con SA. Nada se aplica sin confirmación.')
        );

        container.append(badges, groupsContainer);
        if (!isMiniStage && this.multiDayResolver) {
            const overtimeOption = element('label', null, {
                className: 'mini-import-overtime-option',
                dataset: { miniMergeOvertimeOption: '' }
            });
            const overtimeCheckbox = element('input', null, {
                type: 'checkbox',
                checked: this.mergeOvertimeIntoNormal,
                dataset: { miniMergeOvertime: '' }
            });
            const overtimeCopy = element('span', null, { className: 'mini-import-overtime-option-copy' });
            overtimeCopy.append(
                element('strong', 'Sumar horas extra a las horas normales al aplicar'),
                element('span', 'Activo por defecto. Ejemplo: 8 normales + 3 extra se guardan en SA como 11 horas normales.')
            );
            overtimeCheckbox.addEventListener('change', () => {
                this.mergeOvertimeIntoNormal = overtimeCheckbox.checked;
                this.multiDayResolver.setMergeOvertimeIntoNormal(this.mergeOvertimeIntoNormal);
                this.render();
            });
            overtimeOption.append(overtimeCheckbox, overtimeCopy);
            container.append(overtimeOption);
        }
        container.append(proposalNotice);

        // Footer de etapa: Mini↔Mini nunca aplica en SA. Sólo completa días y
        // produce un draft revisado; la aplicación existe únicamente en etapa SA.
        if (this.multiDayResolver) {
            const multiSummary = this.multiDayResolver.getMultiDaySummary();
            const batchSection = element('div', null, {
                className: 'mini-consolidation-batch-actions',
                dataset: { miniBatchActions: '' }
            });
            const dates = this.multiDayResolver.workDates || [];
            const currentDate = dates[this.consolidationDayIndex] || null;
            const currentState = currentDate ? this.multiDayResolver.getDayState(currentDate) : null;
            const navWrap = element('div', null, {
                className: 'mini-consolidation-footer-nav',
                dataset: { miniFooterNav: '' }
            });
            navWrap.setAttribute('role', 'group');
            navWrap.setAttribute('aria-label', 'Navegación por días');
            const pager = element('div', null, { className: 'mini-consolidation-day-pager' });
            const prev = actionButton('Anterior', 'previous-consolidation-day', this.consolidationDayIndex <= 0);
            prev.classList.add('mini-import-action-secondary');
            prev.addEventListener('click', () => { this.consolidationDayIndex = Math.max(0, this.consolidationDayIndex - 1); this.render(); });
            const next = actionButton('Siguiente', 'next-consolidation-day', this.consolidationDayIndex >= dates.length - 1);
            next.classList.add('mini-import-action-secondary');
            next.addEventListener('click', () => { this.consolidationDayIndex = Math.min(dates.length - 1, this.consolidationDayIndex + 1); this.render(); });
            pager.append(prev, next);
            navWrap.append(pager);
            batchSection.append(navWrap);

            if (isMiniStage) {
                const decisionWrap = element('div', null, {
                    className: 'mini-consolidation-footer-decision',
                    dataset: { miniFooterDecision: '' }
                });
                decisionWrap.setAttribute('role', 'group');
                decisionWrap.setAttribute('aria-label', 'Decisión del día actual');
                const reviewActions = element('div', null, { className: 'mini-day-review-actions' });
                const leavePendingBtn = actionButton(
                    'Pendiente',
                    'leave-mini-day-pending',
                    currentState?.status === 'mini_day_completed'
                );
                leavePendingBtn.title = 'Guardar el progreso y continuar sin completar este día';
                leavePendingBtn.setAttribute('aria-label', 'Dejar este día pendiente y continuar');
                leavePendingBtn.classList.add('mini-import-action-secondary');
                leavePendingBtn.addEventListener('click', () => { void this.leaveMiniDayPendingAndContinue(); });
                const confirmDayBtn = actionButton(
                    'Confirmar día',
                    'complete-mini-day',
                    currentState?.status !== 'mini_day_ready'
                );
                confirmDayBtn.title = 'Marcar este día como completamente revisado';
                confirmDayBtn.classList.add('mini-import-action-primary');
                confirmDayBtn.dataset.miniDate = currentDate || '';
                confirmDayBtn.addEventListener('click', () => { if (currentDate) void this.completeMiniDay(currentDate); });
                reviewActions.append(leavePendingBtn, confirmDayBtn);
                decisionWrap.append(reviewActions);
                batchSection.append(decisionWrap);

                const createBtn = actionButton(
                    'Crear consolidado',
                    'create-mini-consolidated',
                    !this.multiDayResolver.isMiniStageComplete()
                );
                createBtn.classList.add('mini-import-action-primary');
                createBtn.addEventListener('click', () => { void this.createMiniConsolidatedDraft(); });
                const discardBtn = actionButton('Descartar', 'discard-active-consolidation');
                discardBtn.classList.add('mini-import-action-danger');
                discardBtn.setAttribute('aria-label', 'Descartar consolidación actual');
                discardBtn.addEventListener('click', () => { void this.discardActiveConsolidation(); });
                const flowActions = element('div', null, {
                    className: 'mini-consolidation-flow-actions is-global'
                });
                flowActions.append(discardBtn, createBtn);
                const globalWrap = element('div', null, {
                    className: 'mini-consolidation-footer-global',
                    dataset: { miniFooterGlobal: '' }
                });
                globalWrap.setAttribute('role', 'group');
                globalWrap.setAttribute('aria-label', 'Acciones globales');
                globalWrap.append(flowActions);
                batchSection.append(globalWrap);
                if (!this.multiDayResolver.isMiniStageComplete()) {
                    batchSection.append(element('span', 'Consolida cada día antes de crear el consolidado revisado.', {
                        className: 'mini-import-complete-hint'
                    }));
                }
            } else {
                const applyReadyBtn = actionButton(
                    'Aplicar listos',
                    'apply-ready-days',
                    multiSummary.readyDaysCount === 0
                );
                applyReadyBtn.title = `${multiSummary.readyDaysCount} día(s) listos para aplicar`;
                applyReadyBtn.classList.add('mini-import-action-primary');
                applyReadyBtn.addEventListener('click', async () => {
                    try {
                        await this.multiDayResolver.applyReadyDays();
                        this.render();
                    } catch (err) {
                        console.error('Error applying ready days:', err);
                    }
                });
                const allDaysApplied = multiSummary.totalDays > 0 && multiSummary.appliedDaysCount === multiSummary.totalDays;
                const completeBtn = actionButton(
                    'Finalizar',
                    'complete-connected-import',
                    !allDaysApplied || this.selectedDraftIds.size === 0
                );
                completeBtn.title = 'Finalizar la importación cuando todos los días estén aplicados';
                completeBtn.classList.add('mini-import-action-primary');
                completeBtn.addEventListener('click', () => { void this.completeConnectedImport(); });
                const flowActions = element('div', null, { className: 'mini-consolidation-flow-actions' });
                flowActions.append(applyReadyBtn, completeBtn);
                const globalWrap = element('div', null, {
                    className: 'mini-consolidation-footer-global',
                    dataset: { miniFooterGlobal: '' }
                });
                globalWrap.setAttribute('role', 'group');
                globalWrap.setAttribute('aria-label', 'Acciones globales');
                globalWrap.append(flowActions);
                batchSection.append(globalWrap);
                if (!allDaysApplied) {
                    batchSection.append(element('span', 'Compara y aplica todos los días para completar la importación.', {
                        className: 'mini-import-complete-hint'
                    }));
                }
            }
            container.append(batchSection);
        }

        return container;
    }

    renderSetup() {
        const section = element('div', null, { className: 'mini-import-setup' });
        section.append(renderTopbar(2, 4, 'Importar asistencia desde Mini', 'Paso 2 · Validación', 'VALIDACIÓN', () => this.close()));
        const content = element('div', null, { className: 'mini-import-content-gutter' });

        const introCard = element('div', null, { className: 'mini-import-intro-card' });
        introCard.append(
            element('h2', 'Comprueba la fecha y jornada'),
            element('p', 'Verifica los datos generales detectados antes de conciliar.')
        );
        const summary = element('dl', null, {
            className: 'mini-import-setup-summary',
            dataset: { miniSetupSummary: '' }
        });
        const summaries = [
            ['Fecha', this.draft.confirmedDate
                ? displayDate(this.draft.confirmedDate) : 'Fecha pendiente', 'miniSummaryDate'],
            ['Distribución', modeLabel(this.draft.allocationMode), 'miniSummaryMode'],
            ['Personas', `${this.parsed.rows.length} detectadas`, 'miniRowCount']
        ];
        summaries.forEach(([term, value, key]) => {
            summary.append(element('div', null, { className: 'mini-import-summary-item' }));
            summary.lastElementChild.append(
                element('dt', term),
                element('dd', value, { dataset: { [key]: '' } })
            );
        });
        introCard.append(summary);

        const footer = element('div', null, { className: 'mini-import-footer' });
        const back = actionButton('Volver al texto', 'back');
        back.classList.add('mini-import-action-secondary');
        back.addEventListener('click', () => {
            this.stage = 'paste';
            this.render();
        });
        const continueButton = actionButton('Continuar a revisión', 'continue', !this.canContinue());
        continueButton.classList.add('mini-import-action-primary');
        continueButton.addEventListener('click', () => this.startReview());
        footer.append(back, continueButton);

        content.append(
            introCard,
            this.renderDateSetup(),
            this.renderAllocationSetup(),
            this.renderSourceSummary(),
            this.renderRows(),
            element('p', this.canContinue()
                ? 'La preparación está completa. Haz clic para avanzar a la conciliación.'
                : 'Confirma la fecha y corrige las advertencias antes de continuar.', {
                className: 'mini-import-help',
                dataset: { miniContinueHelp: '' }
            })
        );
        section.append(content, footer);
        return section;
    }

    renderSourceSummary() {
        const section = element('section', null, { className: 'mini-import-source-summary' });
        const details = element('details', null, {
            className: 'mini-import-source-details',
            dataset: { miniSourceDetails: '' }
        });
        details.append(
            element('summary', 'Ver reporte original'),
            element('pre', this.source, { dataset: { miniSourcePreview: '' } })
        );
        section.append(details);
        if (this.parsed.unparsedFragments.length) {
            const unparsed = element('div', null, {
                className: 'mini-import-warning',
                dataset: { miniUnparsed: '' },
                role: 'alert'
            });
            unparsed.append(element('strong', 'Texto no interpretado:'));
            const list = element('ul');
            this.parsed.unparsedFragments.forEach(fragment => {
                list.append(element('li', fragment.text));
            });
            unparsed.append(list);
            section.append(unparsed);
        }
        const invalidRows = this.draft.rows.filter(row => row.sourceRow.errors.length);
        if (invalidRows.length) {
            section.append(element(
                'div',
                `${invalidRows.length} fila(s) tienen horas que requieren corrección.`,
                { className: 'mini-import-warning', role: 'alert' }
            ));
        }
        return section;
    }

    renderDateSetup() {
        const isCollapsed = Boolean(this.dateCardCollapsed && this.draft?.confirmedDate && this.draft.dateBlockers.length === 0);
        const card = element('div', null, {
            className: `mini-import-substep-card ${isCollapsed ? 'is-collapsed' : 'is-active'}`,
            dataset: { miniDateCard: '' }
        });

        const header = element('div', null, { className: 'mini-import-substep-header' });
        header.addEventListener('click', () => {
            this.dateCardCollapsed = !this.dateCardCollapsed;
            card.classList.toggle('is-collapsed', this.dateCardCollapsed);
            card.classList.toggle('is-active', !this.dateCardCollapsed);
        });

        const titleWrap = element('div', null, { className: 'mini-import-substep-title-wrap' });
        titleWrap.append(element('span', '1. Confirmar fecha', { className: 'mini-import-substep-title' }));
        if (this.draft?.confirmedDate) {
            const dateBadge = element('span', null, {
                className: 'mini-import-substep-badge is-confirmed'
            });
            dateBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><polyline points="20 6 9 17 4 12"/></svg>${displayDate(this.draft.confirmedDate)}`;
            titleWrap.append(dateBadge);
        }
        header.append(titleWrap, chevronSvg());
        card.append(header);

        const body = element('div', null, { className: 'mini-import-substep-body' });
        const hint = this.parsed.header.dateHint;
        body.append(element('p', hint
            ? `${hint.weekday}, ${hint.day}/${hint.month} · ${hint.year ?? 'año no incluido'}`
            : 'El reporte no incluye una fecha reconocible.', {
            className: 'mini-import-date-hint-text',
            dataset: { miniDateHint: '' }
        }));
        body.append(element(
            'p',
            'Compara la fecha completa con el encabezado de Mini. No se importará nada hasta confirmarla.',
            { className: 'mini-import-help', dataset: { miniDateHelp: '' } }
        ));
        const id = `mini-attendance-date-${this.controlId}`;
        const input = element('input', null, {
            id,
            type: 'date',
            value: this.pendingDate,
            dataset: { miniDate: '' }
        });
        input.addEventListener('input', () => { this.pendingDate = input.value; });
        const confirm = actionButton('Confirmar fecha', 'confirm-date');
        confirm.classList.add('mini-import-action-primary');
        confirm.addEventListener('click', () => this.confirmDate());
        const blockers = element('div', this.draft.dateBlockers.map(dateBlockerText).join(' '), {
            dataset: { miniDateBlockers: '' },
            role: 'status'
        });
        const dateRow = element('div', null, { className: 'mini-import-date-row' });
        dateRow.append(input, confirm);
        body.append(
            element('label', 'Fecha completa', {
                htmlFor: id,
                style: 'font-weight: 600; font-size: 13px; display: block; margin-bottom: 4px;'
            }),
            dateRow,
            blockers
        );

        const wrapper = element('div', null, { className: 'mini-import-substep-collapse-wrapper' });
        wrapper.append(body);
        card.append(wrapper);
        return card;
    }

    renderAllocationSetup() {
        const isCollapsed = Boolean(this.allocationCardCollapsed);
        const card = element('div', null, {
            className: `mini-import-substep-card ${isCollapsed ? 'is-collapsed' : 'is-active'}`
        });

        const header = element('div', null, { className: 'mini-import-substep-header' });
        header.addEventListener('click', () => {
            this.allocationCardCollapsed = !this.allocationCardCollapsed;
            card.classList.toggle('is-collapsed', this.allocationCardCollapsed);
            card.classList.toggle('is-active', !this.allocationCardCollapsed);
        });

        const titleWrap = element('div', null, { className: 'mini-import-substep-title-wrap' });
        titleWrap.append(element('span', '2. Distribuir horas', { className: 'mini-import-substep-title' }));
        titleWrap.append(element('span', modeLabel(this.draft.allocationMode), {
            className: 'mini-import-substep-badge',
            dataset: { miniCurrentMode: '' }
        }));
        header.append(titleWrap, chevronSvg());
        card.append(header);

        const body = element('div', null, { className: 'mini-import-substep-body' });
        body.append(element(
            'p',
            `Puedes mantener todo como normal o separar el excedente sobre el límite regular de ${this.regularLimit} horas.`,
            { className: 'mini-import-help', dataset: { miniAllocationHelp: '' } }
        ));
        const options = element('div', null, { className: 'mini-import-allocation-options' });
        for (const mode of ['all_normal', 'split_at_regular_limit']) {
            const id = `mini-mode-${mode}-${this.controlId}`;
            const optCard = element('label', null, {
                htmlFor: id,
                className: `mini-import-allocation-card ${this.draft.allocationMode === mode ? 'is-selected' : ''}`
            });
            const radio = element('input', null, {
                id,
                type: 'radio',
                name: `mini-allocation-${this.controlId}`,
                value: mode,
                checked: this.draft.allocationMode === mode
            });
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.setAllocationMode(mode);
                }
            });
            const textWrap = element('div');
            textWrap.append(
                element('div', modeLabel(mode), { style: 'font-weight: 700; font-size: 13.5px; color: var(--mini-text);' }),
                element('div', mode === 'all_normal' ? 'Asigna todas las horas como jornada ordinaria' : `Separa las horas que pasen de ${this.regularLimit}h como extra`, { style: 'font-size: 11.5px; color: var(--mini-text-dim); margin-top: 3px;' })
            );
            optCard.append(radio, textWrap);
            options.append(optCard);
        }
        body.append(options);

        const wrapper = element('div', null, { className: 'mini-import-substep-collapse-wrapper' });
        wrapper.append(body);
        card.append(wrapper);
        return card;
    }

    renderRows() {
        const warningCount = this.draft.rows.filter(row => row.blockers.length > 0).length;
        const section = element('details', null, {
            className: 'mini-import-preview',
            dataset: { miniRowsDetails: '' }
        });
        const summary = element('summary', null);
        summary.append(
            element('strong', 'Vista previa de empleados'),
            element(
                'span',
                `${this.draft.rows.length} fila${this.draft.rows.length === 1 ? '' : 's'} · ` +
                `${warningCount} ${warningCount === 1 ? 'requiere' : 'requieren'} atención`
            )
        );
        section.append(
            summary,
            element('p', 'Estas coincidencias todavía pueden corregirse en la revisión.', {
                className: 'mini-import-help'
            })
        );
        const table = element('table', null, {
            className: 'mini-import-rows',
            dataset: { miniRowsTable: '' }
        });
        const labels = ['N.º Mini', 'Nombre', 'Total', 'Normales', 'Extra', 'Coincidencia SA'];
        const head = element('thead');
        const headingRow = element('tr');
        labels.forEach(label => headingRow.append(element('th', label, { scope: 'col' })));
        head.append(headingRow);
        const body = element('tbody');
        this.draft.rows.forEach(row => {
            const item = element('tr', null, {
                dataset: { miniRawRow: '', miniAllocationRow: '' }
            });
            const values = [
                row.sourceRow.rawNumber,
                row.sourceRow.rawName,
                `${row.sourceRow.totalHours} h`,
                `${row.allocation.normalHours} h`,
                `${row.allocation.overtimeHours} h`,
                matchLabel(row.match.status)
            ];
            values.forEach((value, index) => {
                item.append(element('td', value, { dataset: { label: labels[index] } }));
            });
            body.append(item);
        });
        table.append(head, body);
        section.append(table);
        return section;
    }

    updateDraftUnit(item, container, approved) {
        const employeeId = container.querySelector('[data-mini-employee]').value;
        const allocation = {
            normalHours: Number(container.querySelector('[data-mini-normal]').value),
            overtimeHours: Number(container.querySelector('[data-mini-overtime]').value)
        };
        item.sourceIndexes.forEach(sourceIndex => {
            this.draft = editMiniAttendanceDraftRow(this.draft, sourceIndex, allocation);
            this.draft = reviewMiniAttendanceDraftRow(this.draft, sourceIndex, {
                ...(employeeId ? { employeeId } : {}),
                approved
            });
        });
        this.resetApplyState();
        this.rebuildConflictPlan();
        this.render();
    }

    acceptReviewUnit(item, container) {
        const employeeId = container.querySelector('[data-mini-employee]')?.value || '';
        const positionAllocations = this.readPositionAllocations(container);
        const remember = container.querySelector('[data-mini-remember-match]')?.checked === true;
        const selectedDecision = container
            .querySelector('[data-mini-attendance-source]:checked')?.value;
        const conflictingSourceHours = new Set(item.occurrences.map(occurrence =>
            occurrence.totalHours
        )).size > 1;
        const consolidatedAllocation = positionAllocations.reduce((summary, allocation) => ({
            normalHours: summary.normalHours + allocation.normalHours,
            overtimeHours: summary.overtimeHours + allocation.overtimeHours
        }), { normalHours: 0, overtimeHours: 0 });

        item.sourceIndexes.forEach(sourceIndex => {
            if (conflictingSourceHours && selectedDecision !== 'keep_existing' &&
                positionAllocations.length > 0) {
                this.draft = editMiniAttendanceDraftRow(
                    this.draft,
                    sourceIndex,
                    consolidatedAllocation
                );
            }
            this.draft = reviewMiniAttendanceDraftRow(this.draft, sourceIndex, {
                ...(employeeId ? { employeeId } : {}),
                approved: true
            });
        });

        this.resetApplyState();
        this.rebuildConflictPlan();
        const rowIndex = this.conflictPlan.rows.findIndex(row =>
            row.sourceIndexes.some(index => item.sourceIndexes.includes(index))
        );
        if (rowIndex >= 0) {
            const row = this.conflictPlan.rows[rowIndex];
            const action = selectedDecision ||
                (row.existing ? 'keep_existing' : 'use_imported');
            this.conflictPlan = reviewMiniAttendanceConflict(this.conflictPlan, rowIndex, {
                action,
                acknowledged: true,
                positionAllocations,
                collapseAcknowledged: action === 'use_imported' &&
                    (row.existing?.breakdown.length || 0) > 1
            });
        }

        if (remember && employeeId) {
            this.rememberSelectedMatch(item, employeeId);
        }
        if (this.automaticReviewKeys.includes(this.reviewItemKey(item))) {
            this.automaticReviewChoices.set(this.reviewItemKey(item), 'accept');
        }
        if (this.individualReviewMode === 'single') {
            this.showAutomaticReview();
            return;
        }
        this.advanceReviewPageAfter(item.sourceIndexes);
        this.render();
        this.resetReviewViewport();
    }

    async rememberSelectedMatch(item, employeeId) {
        if (!this.aliasStore || !this.aliasScope) return;
        const employee = this.employees.find(candidate => candidate.id === employeeId);
        if (!isMiniAttendanceEmployeeEligible(employee)) return;
        try {
            for (const occurrence of item.occurrences) {
                await this.aliasStore.record({
                    scope: this.aliasScope,
                    rawNumber: occurrence.number,
                    rawName: occurrence.name,
                    targetEmployeeId: employeeId,
                    targetNumberSnapshot: employee.number ?? null,
                    targetNameSnapshot: employee.name ?? null
                }, { allowReplace: true, actorUid: this.actorUid });
            }
            this.aliases = await this.aliasStore.list(this.aliasScope);
            window.showNotification?.(
                `Coincidencia recordada para ${item.occurrences[0]?.number} · ` +
                `${item.occurrences[0]?.name}.`,
                'success'
            );
        } catch (error) {
            window.showNotification?.(
                `La asistencia fue revisada, pero no se pudo recordar la coincidencia: ` +
                `${error?.message || 'error desconocido'}`,
                'error'
            );
        }
    }

    ignoreReviewUnit(item) {
        item.sourceIndexes.forEach(sourceIndex => {
            this.draft = excludeMiniAttendanceDraftRow(this.draft, sourceIndex);
        });
        this.resetApplyState();
        this.rebuildConflictPlan();
        const occurrence = item.occurrences[0];
        window.showNotification?.(
            `${occurrence?.number} · ${occurrence?.name} fue excluido de esta importación.`,
            'info'
        );
        if (this.individualReviewMode === 'single') {
            this.showAutomaticReview();
            return;
        }
        this.clampReviewPage();
        this.render();
        this.resetReviewViewport();
    }

    requestIgnoreReviewUnit(item) {
        const occurrence = item.occurrences[0] || {};
        const message = `${occurrence.number} · ${occurrence.name} se excluirá únicamente ` +
            'de esta importación y no modificará la asistencia de SA. ¿Deseas continuar?';
        const proceed = () => this.ignoreReviewUnit(item);
        if (typeof this.confirmIgnore === 'function') {
            Promise.resolve(this.confirmIgnore({ item, message })).then(confirmed => {
                if (confirmed) proceed();
            });
            return;
        }
        if (window.showConfirm) {
            window.showConfirm({
                title: 'Empleado no registrado',
                message,
                confirmText: 'Ignorar y continuar',
                cancelText: 'Volver',
                type: 'warning',
                onConfirm: proceed
            });
            return;
        }
        if (window.confirm?.(message)) proceed();
    }

    requestIgnoreConsolidatedItem(item) {
        if (!this.multiDayResolver || !item?.id) return;
        const label = [item.displayNumber ? `#${item.displayNumber}` : '', item.displayName || 'esta asistencia']
            .filter(Boolean).join(' · ');
        const message = `${label} se excluirá únicamente de esta importación y no modificará la asistencia de SA. ¿Deseas continuar?`;
        const proceed = () => {
            this.multiDayResolver.excludeItem(item.id);
            this.resetApplyState();
            window.showNotification?.(`${label} fue ignorada en esta importación.`, 'info');
            this.render();
        };
        if (typeof this.confirmIgnore === 'function') {
            Promise.resolve(this.confirmIgnore({ item, message })).then(confirmed => {
                if (confirmed) proceed();
            });
            return;
        }
        if (window.showConfirm) {
            window.showConfirm({
                title: 'Ignorar asistencia',
                message,
                confirmText: 'Ignorar y continuar',
                cancelText: 'Volver',
                type: 'warning',
                onConfirm: proceed
            });
            return;
        }
        if (window.confirm?.(message)) proceed();
    }

    async handleReactivateAndApply(item, container) {
        const empId = item.inactiveEmployee?.id || item.employee?.id;
        const empName = item.inactiveEmployee?.name || item.employee?.name || 'Empleado';
        const empNumber = item.inactiveEmployee?.number || item.employee?.number || '';
        const totalHours = item.allocation.normalHours + item.allocation.overtimeHours;

        const proceed = async () => {
            try {
                const reactivatedEmp = await this.reactivateEmployee(empId);
                const existingIdx = this.employees.findIndex(e => e.id === empId);
                if (existingIdx >= 0) {
                    this.employees[existingIdx] = { ...this.employees[existingIdx], ...reactivatedEmp, active: true };
                } else {
                    this.employees.push({ ...reactivatedEmp, active: true });
                }
                this.draft = reactivateMiniAttendanceDraftEmployee(this.draft, reactivatedEmp);
                item.sourceIndexes.forEach(sourceIndex => {
                    this.draft = reviewMiniAttendanceDraftRow(this.draft, sourceIndex, {
                        employeeId: empId,
                        approved: true
                    });
                });
                this.resetApplyState();
                this.rebuildConflictPlan();

                const rowIndex = this.conflictPlan.rows.findIndex(row =>
                    row.sourceIndexes.some(index => item.sourceIndexes.includes(index))
                );
                if (rowIndex >= 0) {
                    const row = this.conflictPlan.rows[rowIndex];
                    const positionAllocations = row.positionAllocations.length
                        ? row.positionAllocations
                        : (row.employeePositionIds.length === 1 ? [{
                            positionId: row.employeePositionIds[0],
                            normalHours: item.allocation.normalHours,
                            overtimeHours: item.allocation.overtimeHours
                        }] : []);
                    this.conflictPlan = reviewMiniAttendanceConflict(this.conflictPlan, rowIndex, {
                        action: 'use_imported',
                        acknowledged: true,
                        positionAllocations
                    });
                }

                window.showNotification?.(
                    `Empleado ${empNumber ? `#${empNumber} ` : ''}${empName} reactivado en SA y asistencia lista para aplicar.`,
                    'success'
                );

                if (this.individualReviewMode === 'single') {
                    this.showAutomaticReview();
                    return;
                }
                this.advanceReviewPageAfter(item.sourceIndexes);
                this.render();
                this.resetReviewViewport();
            } catch (err) {
                console.error('Error reactivando empleado:', err);
                window.showNotification?.(
                    `Error reactivando empleado: ${err?.message || 'error desconocido'}`,
                    'error'
                );
            }
        };

        const message = `¿Deseas reactivar a ${empNumber ? `#${empNumber} ` : ''}${empName} en SA y aplicar su asistencia de ${totalHours} h?`;
        if (typeof this.confirmReactivate === 'function') {
            const confirmed = await this.confirmReactivate({ item, message });
            if (confirmed) await proceed();
            return;
        }
        if (window.showConfirm) {
            window.showConfirm({
                title: 'Reactivar empleado en SA',
                message,
                confirmText: 'Sí, reactivar y aplicar',
                cancelText: 'Cancelar',
                type: 'info',
                onConfirm: proceed
            });
            return;
        }
        if (window.confirm?.(message)) {
            await proceed();
        }
    }

    updateConflictUnit(item, container, transition) {
        const rowIndex = this.conflictPlan.rows.findIndex(row =>
            row.sourceIndexes.some(index => item.sourceIndexes.includes(index))
        );
        if (rowIndex < 0) return;
        const targetPositionId = transition === 'select_position'
            ? container.querySelector('[data-mini-target-position]')?.value || undefined
            : undefined;
        this.conflictPlan = reviewMiniAttendanceConflict(this.conflictPlan, rowIndex, {
            action: container.querySelector('[data-mini-conflict-action]').value,
            acknowledged: true,
            targetPositionId,
            collapseAcknowledged: transition === 'confirm_collapse'
        });
        this.resetApplyState();
        this.render();
    }

    confirmReviewUnit(item, container) {
        if (!this.isReviewUnitComplete(item, container)) return;
        this.acceptReviewUnit(item, container);
    }

    acceptAutomaticMatches(container) {
        const view = this.buildReviewView();
        const automaticItems = this.automaticReviewItems(view);
        automaticItems.forEach(item => {
            const key = this.reviewItemKey(item);
            const choice = container.querySelector(
                `[data-mini-auto-choice="${key}"]:checked`
            )?.value || 'accept';
            this.automaticReviewChoices.set(key, choice);
            item.sourceIndexes.forEach(sourceIndex => {
                this.draft = reviewMiniAttendanceDraftRow(this.draft, sourceIndex, {
                    approved: choice === 'accept'
                });
            });
        });
        this.resetApplyState();
        if (automaticItems.length) {
            this.rebuildConflictPlan();
            automaticItems
                .filter(item =>
                    (this.automaticReviewChoices.get(this.reviewItemKey(item)) || 'accept') ===
                    'accept'
                )
                .forEach(item => {
                    const rowIndex = this.conflictPlan.rows.findIndex(row =>
                        row.sourceIndexes.some(sourceIndex =>
                            item.sourceIndexes.includes(sourceIndex)
                        )
                    );
                    if (rowIndex < 0) return;
                    const row = this.conflictPlan.rows[rowIndex];
                    const existingBreakdown = row.existing?.breakdown || [];
                    const positionAllocations = row.positionAllocations.length
                        ? row.positionAllocations
                        : existingBreakdown.map(allocation => ({
                            positionId: allocation.positionId,
                            normalHours: allocation.hours || 0,
                            overtimeHours: allocation.overtimeHours || 0
                        }));
                    this.conflictPlan = reviewMiniAttendanceConflict(
                        this.conflictPlan,
                        rowIndex,
                        {
                            action: 'use_imported',
                            acknowledged: true,
                            positionAllocations,
                            collapseAcknowledged: existingBreakdown.length > 1
                        }
                    );
                });
        }
        const nextView = this.buildReviewView();
        this.reviewStep = 'individual';
        this.individualReviewKeys = nextView.items
            .filter(item => !item.confirmed)
            .map(item => this.reviewItemKey(item));
        this.individualReviewMode = 'queue';
        this.reviewPageIndex = 0;
        this.render();
        this.resetReviewViewport();
        if (!this.individualReviewKeys.length && !this.conflictPlan.hasBlockingIssues) {
            this.showFinalSummary();
        }
    }

    acceptAllReadyMatches(container) {
        container.querySelectorAll('[data-mini-auto-choice][value="accept"]')
            .forEach(input => {
                input.checked = true;
                this.automaticReviewChoices.set(input.dataset.miniAutoChoice, 'accept');
            });
        this.acceptAutomaticMatches(container);
    }

    showFinalSummary() {
        if (this.conflictPlan?.hasBlockingIssues) return;
        this.reviewStep = 'summary';
        this.reviewPageIndex = 0;
        this.render();
        this.resetReviewViewport();
    }

    async applyCurrentPlan() {
        if (this.applyStatus === 'pending' || this.applyStatus === 'success') return null;
        try {
            const plan = buildMiniAttendanceApplyPlan(this.conflictPlan, {
                expectedDraftRevision: this.draft.revision
            });
            this.applyStatus = 'pending';
            this.applyError = null;
            this.render();
            const result = await this.applyPlan(plan, {
                announce: 'Asistencia de Mini importada'
            });
            this.applyResult = result;
            this.applyStatus = 'success';
            this.render();
            return result;
        } catch (error) {
            this.applyError = error;
            this.applyStatus = 'error';
            this.render();
            return null;
        }
    }

    positionName(positionId) {
        return this.positions.find(position => position.id === positionId)?.name || positionId;
    }

    buildReviewView() {
        return buildMiniAttendanceReviewViewModel({
            draft: this.draft,
            conflictPlan: this.conflictPlan,
            employees: this.employees,
            positions: this.positions
        });
    }

    reviewItemKey(item) {
        return [...item.sourceIndexes].sort((left, right) => left - right).join('-');
    }

    automaticReviewItems(view = this.buildReviewView()) {
        const keys = new Set(this.automaticReviewKeys);
        return view.items.filter(item => keys.has(this.reviewItemKey(item)));
    }

    attentionReviewItems(view = this.buildReviewView()) {
        const automaticKeys = new Set(this.automaticReviewKeys);
        return view.items.filter(item =>
            !automaticKeys.has(this.reviewItemKey(item))
        );
    }

    openIndividualReview(keys) {
        this.reviewStep = 'individual';
        this.individualReviewKeys = [...new Set(keys)];
        this.individualReviewMode = this.individualReviewKeys.length === 1 ? 'single' : 'queue';
        this.reviewPageIndex = 0;
        this.render();
        this.resetReviewViewport();
    }

    visibleReviewItems(view = this.buildReviewView()) {
        const sourceIndexes = new Set(this.individualReviewKeys.flatMap(key =>
            String(key).split('-').map(Number).filter(Number.isInteger)
        ));
        return view.items.filter(item =>
            item.sourceIndexes.some(sourceIndex => sourceIndexes.has(sourceIndex))
        );
    }

    clampReviewPage(view = this.buildReviewView()) {
        const items = this.visibleReviewItems(view);
        this.reviewPageIndex = items.length
            ? Math.min(Math.max(this.reviewPageIndex, 0), items.length - 1)
            : 0;
        return items;
    }

    resetReviewViewport() {
        const modalBody = this.host?.closest('.modal-body');
        if (modalBody) modalBody.scrollTop = 0;
        if (this.modal?.element) this.modal.element.scrollTop = 0;
    }

    showAutomaticReview() {
        this.reviewStep = 'automatic';
        this.reviewPageIndex = 0;
        this.render();
        this.resetReviewViewport();
    }

    setReviewPage(index) {
        const items = this.visibleReviewItems();
        if (!items.length) return;
        this.reviewPageIndex = Math.min(Math.max(index, 0), items.length - 1);
        this.render();
        this.resetReviewViewport();
    }

    advanceReviewPageAfter(reviewSourceIndexes) {
        const reviewedIndexes = new Set(reviewSourceIndexes);
        const items = this.visibleReviewItems();
        const retainedIndex = items.findIndex(item =>
            item.sourceIndexes.some(sourceIndex => reviewedIndexes.has(sourceIndex))
        );
        if (retainedIndex >= 0 && retainedIndex < items.length - 1) {
            this.reviewPageIndex = retainedIndex + 1;
            return;
        }
        this.reviewPageIndex = items.length
            ? Math.min(this.reviewPageIndex, items.length - 1)
            : 0;
    }

    isReviewUnitComplete(model, container) {
        return this.reviewUnitValidation(model, container).complete;
    }

    reviewUnitValidation(model, container) {
        const employeeId = container.querySelector('[data-mini-employee]')?.value || '';
        const employee = this.employees.find(candidate => candidate.id === employeeId);
        const employeeValid = isMiniAttendanceEmployeeEligible(employee);
        const selectedDecision = container
            .querySelector('[data-mini-attendance-source]:checked')?.value;
        const requiresAllocation = model.existingBreakdown.length === 0 ||
            selectedDecision === 'use_imported';
        const allocations = this.readPositionAllocations(container);
        const totalHours = allocations.reduce((total, allocation) =>
            total + allocation.normalHours + allocation.overtimeHours, 0);
        const allocationValid = allocations.length > 0 &&
            allocations.every(allocation =>
                (employee?.positions || []).includes(allocation.positionId) &&
                Number.isFinite(allocation.normalHours) &&
                Number.isFinite(allocation.overtimeHours) &&
                allocation.normalHours >= 0 &&
                allocation.overtimeHours >= 0
            ) &&
            totalHours > 0 &&
            totalHours <= 24;
        const decisionValid = model.existingBreakdown.length === 0 ||
            Boolean(selectedDecision);
        const allocationRequirementMet = !requiresAllocation || allocationValid;
        const hasConflictingSourceHours = new Set(model.occurrences.map(occurrence =>
            occurrence.totalHours
        )).size > 1;
        const duplicateHoursValid = !hasConflictingSourceHours ||
            selectedDecision === 'keep_existing' ||
            Boolean(container.querySelector('[data-mini-duplicate-hour-choice]:checked'));
        return {
            complete: model.confirmed ||
                (employeeValid && allocationRequirementMet && decisionValid &&
                    duplicateHoursValid),
            employeeValid,
            employeeNeedsConfirmation: !model.confirmed &&
                ['identity', 'duplicate'].includes(model.issue),
            allocationValid: allocationRequirementMet,
            decisionValid,
            duplicateHoursValid
        };
    }

    readPositionAllocations(container) {
        return [...container.querySelectorAll('[data-mini-position-allocation]')]
            .map(row => ({
                active: row.querySelector('[data-mini-target-position-option]')?.checked === true,
                positionId: row.dataset.miniPositionAllocation,
                normalHours: Number(row.querySelector('[data-mini-position-normal]')?.value),
                overtimeHours: Number(row.querySelector('[data-mini-position-overtime]')?.value)
            }))
            .filter(allocation =>
                allocation.active ||
                allocation.normalHours > 0 ||
                allocation.overtimeHours > 0
            )
            .map(({ active: _active, ...allocation }) => allocation);
    }

    assignedEmployeeIds(currentItem) {
        const currentIndexes = new Set(currentItem.sourceIndexes);
        return new Set(this.draft.rows
            .filter((row, sourceIndex) =>
                row.approved === true &&
                row.excluded !== true &&
                !currentIndexes.has(sourceIndex) &&
                row.match?.employeeId
            )
            .map(row => row.match.employeeId));
    }

    renderReview() {
        const section = element('div', null, { className: 'mini-import-review' });
        const modeEl = element('span', modeLabel(this.draft.allocationMode), {
            dataset: { miniCurrentMode: '' },
            style: 'display: none;'
        });
        section.append(modeEl);

        const view = this.buildReviewView();
        if (this.reviewStep === 'summary') {
            section.append(this.renderFinalSummary(view));
            return section;
        }
        if (this.reviewStep === 'automatic') {
            section.append(this.renderAutomaticReview(view));
            return section;
        }
        section.append(this.renderIndividualReview(view));
        return section;
    }

    renderAutomaticReview(view) {
        const panel = element('section', null, {
            className: 'mini-import-automatic-review',
            dataset: { miniAutomaticReview: '' }
        });
        panel.append(renderTopbar(3, 4, 'Importar asistencia desde Mini', 'Paso 3 · Conciliación', 'CONCILIACIÓN', () => this.close()));
        const content = element('div', null, { className: 'mini-import-content-gutter' });

        const automaticItems = this.automaticReviewItems(view);
        const attentionItems = this.attentionReviewItems(view);
        const pendingAttentionItems = attentionItems.filter(item => !item.confirmed);
        const resolvedAttentionCount = attentionItems.length - pendingAttentionItems.length;

        const execCard = element('div', null, {
            className: 'mini-import-executive-card',
            dataset: { miniExecutiveReconciliation: '' }
        });
        const stats = element('div', null, { className: 'mini-import-executive-stats' });

        const readyBox = element('div', null, { className: 'mini-import-stat-box is-ready' });
        const readyIcon = element('div', null, { className: 'mini-import-stat-icon' });
        readyIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
        const readyContent = element('div');
        readyContent.append(
            element('div', String(automaticItems.length), { className: 'mini-import-stat-number' }),
            element('div', 'Empleados listos para aplicar', { className: 'mini-import-stat-label' })
        );
        readyBox.append(readyIcon, readyContent);

        const attentionBox = element('div', null, { className: 'mini-import-stat-box is-attention' });
        const attentionIcon = element('div', null, { className: 'mini-import-stat-icon' });
        attentionIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        const attentionContent = element('div');
        attentionContent.append(
            element('div', String(pendingAttentionItems.length), { className: 'mini-import-stat-number' }),
            element('div', pendingAttentionItems.length === 0 ? 'Sin advertencias pendientes' : 'Requieren atención', { className: 'mini-import-stat-label' })
        );
        attentionBox.append(attentionIcon, attentionContent);

        stats.append(readyBox, attentionBox);
        execCard.append(stats);

        const toggleWrap = element('div', null, { className: 'mini-import-detailed-view-toggle' });
        const openDetailedBtn = actionButton(
            this.showDetailedTable
                ? '← Volver a la vista ejecutiva'
                : `Ver listado detallado en tabla (${view.items.length}) →`,
            this.showDetailedTable ? 'close-detailed-table' : 'open-detailed-table'
        );
        openDetailedBtn.classList.add(this.showDetailedTable ? 'mini-import-action-secondary' : 'mini-import-inspect-btn');
        openDetailedBtn.addEventListener('click', () => {
            this.showDetailedTable = !this.showDetailedTable;
            this.render();
        });
        toggleWrap.append(openDetailedBtn);
        execCard.append(toggleWrap);
        content.append(execCard);

        const detailedSection = element('div', null, {
            className: 'mini-import-detailed-section'
        });
        if (!this.showDetailedTable) {
            detailedSection.hidden = true;
        }

        const detailedHeading = element('div', null, { className: 'mini-import-step-header' });
        detailedHeading.append(
            element('h3', 'Listado detallado de conciliación'),
            element(
                'p',
                'Primero confirma las coincidencias claras. Después resuelve únicamente ' +
                    'las filas que tienen una advertencia.',
                { className: 'mini-import-help' }
            )
        );
        detailedSection.append(detailedHeading);
        const readyHeading = element('div', null, {
            className: 'mini-import-reconciliation-heading'
        });
        const readyHeadingCopy = element('div', null, {
            className: 'mini-import-reconciliation-copy'
        });
        readyHeadingCopy.append(
            element('h4', `Listos para aceptar (${automaticItems.length})`),
            element('span', 'Se aplicarán las horas importadas desde Mini')
        );
        const acceptAllReady = actionButton(
            'Aceptar todos con Mini',
            'accept-all-ready',
            automaticItems.length === 0
        );
        acceptAllReady.classList.add('mini-import-action-primary');
        acceptAllReady.addEventListener('click', () =>
            this.acceptAllReadyMatches(panel)
        );
        readyHeading.append(readyHeadingCopy, acceptAllReady);
        detailedSection.append(readyHeading);
        const table = element('table', null, {
            className: 'mini-import-rows mini-import-auto-table',
            dataset: { miniAutomaticTable: '' }
        });
        const labels = ['Mini', 'Empleado en SA', 'Horas', 'Cargo', 'Estado', 'Decisión'];
        const head = element('thead');
        const headingRow = element('tr');
        labels.forEach(label => headingRow.append(element('th', label, { scope: 'col' })));
        head.append(headingRow);
        const body = element('tbody');
        automaticItems.forEach(item => {
            const occurrence = item.occurrences[0] || {};
            const key = this.reviewItemKey(item);
            const row = element('tr', null, {
                dataset: { miniAutomaticRow: key }
            });
            const miniIdentity = `${occurrence.number} · ${occurrence.name}`;
            const localIdentity = item.employee
                ? `${item.employee.number} · ${item.employee.name}`
                : 'Sin empleado';
            const totalHours = item.allocation.normalHours + item.allocation.overtimeHours;
            const position = item.targetPositionOptions.find(option =>
                option.id === item.targetPositionId
            ) || item.targetPositionOptions[0];
            const readyType = item.readyReason?.type || (item.confirmed ? 'confirmed' : 'ready');
            const readyLabel = item.readyReason?.label || (item.confirmed ? 'Confirmado' : 'Listo');
            const readyReason = element('span', readyLabel, {
                className: `mini-import-ready-reason is-${readyType}`,
                dataset: { miniReadyReason: readyType }
            });
            const decision = element('div', null, {
                className: 'mini-import-segmented mini-import-auto-choice',
                role: 'radiogroup',
                'aria-label': `Decisión para ${miniIdentity}`
            });
            [
                ['accept', 'Aceptar'],
                ['modify', 'Modificar']
            ].forEach(([value, labelText]) => {
                const id = `mini-auto-${this.controlId}-${key}-${value}`;
                const label = element('label', null, { htmlFor: id });
                label.append(
                    element('input', null, {
                        id,
                        type: 'radio',
                        name: `mini-auto-${this.controlId}-${key}`,
                        value,
                        checked: (this.automaticReviewChoices.get(key) || 'accept') === value,
                        dataset: { miniAutoChoice: key }
                    }),
                    element('span', labelText)
                );
                decision.append(label);
            });
            const values = [
                miniIdentity,
                localIdentity,
                `${totalHours} h`,
                position?.name || 'Sin cargo',
                readyReason,
                decision
            ];
            values.forEach((value, index) => {
                const cell = element('td', null, { dataset: { label: labels[index] } });
                if (value instanceof Node) cell.append(value);
                else cell.textContent = value;
                row.append(cell);
            });
            body.append(row);
        });
        table.append(head, body);
        detailedSection.append(table);
        if (!automaticItems.length) {
            table.hidden = true;
            detailedSection.append(element(
                'p',
                'No hay filas que puedan confirmarse automáticamente.',
                { className: 'mini-import-empty-table' }
            ));
        }
        const attentionHeading = element('div', null, {
            className: 'mini-import-reconciliation-heading'
        });
        attentionHeading.append(
            element('h4', `Requieren atención (${pendingAttentionItems.length})`, {
                dataset: { miniAttentionHeading: '' }
            }),
            element(
                'span',
                resolvedAttentionCount
                    ? `${resolvedAttentionCount} resuelto${resolvedAttentionCount === 1 ? '' : 's'}`
                    : 'SA necesita una decisión',
                { dataset: { miniAttentionResolution: '' } }
            )
        );
        detailedSection.append(
            attentionHeading,
            this.renderAttentionReviewTable(attentionItems, pendingAttentionItems)
        );
        content.append(detailedSection);

        const attentionCount = pendingAttentionItems.length;
        const note = element(
            'p',
            attentionCount
                ? `${attentionCount} empleado${attentionCount === 1 ? '' : 's'} ` +
                    `${attentionCount === 1 ? 'pasará' : 'pasarán'} a ` +
                    'revisión individual después de aceptar esta tabla.'
                : 'Todas las filas están listas para pasar al resumen final.',
            { className: 'mini-import-next-action', dataset: { miniAutomaticHint: '' } }
        );
        const back = actionButton('Volver', 'back-review');
        back.classList.add('mini-import-action-secondary');
        back.disabled = this.applyStatus === 'pending' || this.applyStatus === 'success';
        back.addEventListener('click', () => {
            this.stage = 'setup';
            this.render();
        });

        const accept = actionButton('', 'accept-automatic');
        accept.classList.add('mini-import-action-primary');
        panel.addEventListener('change', () => this.syncAutomaticReviewStatus(panel));
        accept.addEventListener('click', () => this.acceptAutomaticMatches(panel));

        const footer = element('div', null, { className: 'mini-import-footer' });
        footer.append(back, accept);
        content.append(note);
        panel.append(content, footer);
        this.syncAutomaticReviewStatus(panel, view);
        return panel;
    }

    syncAutomaticReviewStatus(panel, view = this.buildReviewView()) {
        const attentionItems = this.attentionReviewItems(view);
        const pendingCount = attentionItems.filter(item => !item.confirmed).length;
        const resolvedCount = attentionItems.length - pendingCount;
        const heading = panel.querySelector('[data-mini-attention-heading]');
        const resolution = panel.querySelector('[data-mini-attention-resolution]');
        const hint = panel.querySelector('[data-mini-automatic-hint]');
        const accept = panel.querySelector('[data-mini-action="accept-automatic"]');
        if (heading) heading.textContent = `Requieren atención (${pendingCount})`;
        if (resolution) {
            resolution.textContent = resolvedCount
                ? `${resolvedCount} resuelto${resolvedCount === 1 ? '' : 's'}`
                : 'SA necesita una decisión';
        }
        if (hint) {
            hint.textContent = pendingCount
                ? `${pendingCount} empleado${pendingCount === 1 ? '' : 's'} ` +
                    `${pendingCount === 1 ? 'pasará' : 'pasarán'} a ` +
                    'revisión individual después de aceptar esta tabla.'
                : 'Todas las filas están listas para pasar al resumen final.';
        }
        if (accept) {
            const modifyCount = panel.querySelectorAll(
                '[data-mini-auto-choice]:checked[value="modify"]'
            ).length;
            accept.textContent = !pendingCount && !modifyCount
                ? 'Aceptar y revisar resumen'
                : 'Aceptar selección y continuar';
        }
    }

    refreshAttentionReviewTable() {
        const panel = this.host?.querySelector('[data-mini-automatic-review]');
        const current = panel?.querySelector('[data-mini-attention-table]');
        if (!panel || !current) return;
        const modalBody = current.closest('.modal-body');
        const scrollTop = modalBody?.scrollTop;
        const view = this.buildReviewView();
        const items = this.attentionReviewItems(view);
        const pendingItems = items.filter(item => !item.confirmed);
        current.replaceWith(this.renderAttentionReviewTable(items, pendingItems));
        this.syncAutomaticReviewStatus(panel, view);
        if (modalBody && Number.isFinite(scrollTop)) modalBody.scrollTop = scrollTop;
    }

    renderAttentionReviewTable(items, pendingItems = items.filter(item => !item.confirmed)) {
        const wrapper = element('div', null, {
            className: 'mini-import-attention-table-wrap',
            dataset: { miniAttentionTable: '' }
        });
        if (!items.length) {
            wrapper.append(element(
                'p',
                'No hay advertencias pendientes.',
                { className: 'mini-import-empty-table' }
            ));
            return wrapper;
        }
        const labels = ['Mini', 'Empleado en SA', 'Horas', 'Estado', 'Acción'];
        const table = element('table', null, {
            className: 'mini-import-rows mini-import-attention-table'
        });
        const head = element('thead');
        const headingRow = element('tr');
        labels.forEach(label => headingRow.append(element('th', label, { scope: 'col' })));
        head.append(headingRow);
        const body = element('tbody');
        items.forEach(item => {
            const occurrence = item.occurrences[0] || {};
            const key = this.reviewItemKey(item);
            const row = element('tr', null, {
                className: item.confirmed
                    ? 'is-resolved'
                    : `has-${item.problemSummary.severity}-problems`,
                dataset: {
                    miniAttentionRow: key,
                    miniAttentionStatus: item.confirmed ? 'resolved' : 'pending',
                    miniProblemSeverity: item.problemSummary.severity
                }
            });
            const isInactiveUnconfirmed = item.isInactive && !item.confirmed;
            const action = actionButton(
                item.confirmed ? 'Modificar' : isInactiveUnconfirmed ? 'Resolver' : item.canIgnore ? 'Ignorar' : 'Resolver',
                item.confirmed
                    ? 'edit-resolved-attention'
                    : isInactiveUnconfirmed ? 'edit-attention' : item.canIgnore ? 'ignore-attention' : 'edit-attention'
            );
            action.classList.add(item.canIgnore && !item.confirmed && !isInactiveUnconfirmed
                ? 'mini-import-action-secondary'
                : 'mini-import-action-primary');
            if (item.confirmed) {
                action.addEventListener('click', () => this.openIndividualReview([key]));
            } else if (isInactiveUnconfirmed) {
                action.addEventListener('click', () => this.openIndividualReview([key]));
            } else if (item.canIgnore) {
                action.addEventListener('click', () => this.requestIgnoreReviewUnit(item));
            } else {
                action.addEventListener('click', () => this.openIndividualReview([key]));
            }
            const status = element('div', null, {
                className: 'mini-import-problem-status'
            });
            if (item.confirmed) {
                status.append(resolvedCheckSvg('Resuelto'));
            } else {
                status.append(element(
                    'span',
                    item.problemSummary.label,
                    {
                        className: `mini-import-status-badge is-${item.problemSummary.severity}`,
                        title: item.problems.map(problem => problem.message).join(' ')
                    }
                ));
                status.append(element('small', item.nextAction));
            }
            const hours = this.renderAttentionHoursChoice(item);
            const values = [
                `${occurrence.number} · ${occurrence.name}`,
                item.employee
                    ? `${item.employee.number} · ${item.employee.name}`
                    : 'Sin coincidencia',
                hours,
                status,
                action
            ];
            values.forEach((value, index) => {
                const cell = element('td', null, { dataset: { label: labels[index] } });
                if (value instanceof Node) cell.append(value);
                else cell.textContent = value;
                row.append(cell);
            });
            body.append(row);
        });
        table.append(head, body);
        const bulkItems = items.filter(item => item.existingBreakdown.length > 0);
        if (bulkItems.length) {
            const bulkActions = element('div', null, {
                className: 'mini-import-attention-bulk',
                dataset: { miniAttentionBulk: '' }
            });
            bulkActions.append(element(
                'span',
                `Cambiar las horas de ${bulkItems.length} ` +
                    `${bulkItems.length === 1 ? 'fila' : 'filas'} con datos en SA`
            ));
            const useMini = actionButton('Usar Mini en todos', 'use-mini-all');
            const useSa = actionButton('Usar SA en todos', 'use-sa-all');
            useMini.classList.add('mini-import-action-primary');
            useSa.classList.add('mini-import-action-secondary');
            useMini.addEventListener('click', () =>
                this.chooseAllAttentionSources(bulkItems, 'use_imported')
            );
            useSa.addEventListener('click', () =>
                this.chooseAllAttentionSources(bulkItems, 'keep_existing')
            );
            bulkActions.append(useMini, useSa);
            wrapper.append(bulkActions);
        }
        wrapper.append(table);
        if (pendingItems.length) {
            const reviewAll = actionButton(
                `Revisar todos los pendientes (${pendingItems.length})`,
                'review-all-attention'
            );
            reviewAll.classList.add('mini-import-action-secondary');
            reviewAll.addEventListener('click', () => this.openIndividualReview(
                pendingItems.map(item => this.reviewItemKey(item))
            ));
            wrapper.append(reviewAll);
        }
        return wrapper;
    }

    renderAttentionHoursChoice(item) {
        const miniTotal = item.allocation.normalHours + item.allocation.overtimeHours;
        if (!item.existingBreakdown.length) {
            return element('span', `${miniTotal} h de Mini`);
        }
        const saTotal = item.existingBreakdown.reduce((total, allocation) =>
            total + allocation.hours + allocation.overtimeHours, 0);
        const key = this.reviewItemKey(item);
        const field = element('fieldset', null, {
            className: 'mini-import-inline-source',
            dataset: { miniInlineSource: key }
        });
        field.append(element('legend', 'Horas a usar'));
        [
            ['use_imported', `Mini ${miniTotal} h`],
            ['keep_existing', `SA ${saTotal} h`]
        ].forEach(([value, labelText]) => {
            const id = `mini-inline-source-${this.controlId}-${key}-${value}`;
            const label = element('label', null, { htmlFor: id });
            const input = element('input', null, {
                id,
                type: 'radio',
                name: `mini-inline-source-${this.controlId}-${key}`,
                value,
                checked: item.decision?.acknowledged === true &&
                    item.decision.action === value,
                dataset: { miniAttentionSource: value }
            });
            input.addEventListener('change', () => {
                if (input.checked) this.chooseAttentionSource(item, value);
            });
            label.append(input, element('span', labelText));
            field.append(label);
        });
        return field;
    }

    chooseAttentionSource(item, action) {
        this.chooseAllAttentionSources([item], action);
    }

    chooseAllAttentionSources(items, action) {
        const candidates = items.filter(item => item.existingBreakdown.length > 0);
        if (!candidates.length) return;
        if (action === 'use_imported') {
            candidates.forEach(item => item.sourceIndexes.forEach(sourceIndex => {
                this.draft = reviewMiniAttendanceDraftRow(this.draft, sourceIndex, {
                    approved: true
                });
            }));
            this.rebuildConflictPlan();
        }
        candidates.forEach(item => {
            const rowIndex = this.conflictPlan.rows.findIndex(row =>
                row.sourceIndexes.some(sourceIndex => item.sourceIndexes.includes(sourceIndex))
            );
            if (rowIndex < 0) return;
            const row = this.conflictPlan.rows[rowIndex];
            this.conflictPlan = reviewMiniAttendanceConflict(this.conflictPlan, rowIndex, {
                action,
                acknowledged: true,
                positionAllocations: row.positionAllocations,
                collapseAcknowledged: action === 'use_imported' &&
                    (row.existing?.breakdown.length || 0) > 1
            });
        });
        this.resetApplyState();
        this.refreshAttentionReviewTable();
    }

    renderIndividualReview(view) {
        const section = element('section', null, {
            className: 'mini-import-individual-review',
            dataset: { miniIndividualReview: '' }
        });

        const visibleItems = this.clampReviewPage(view);
        const unresolvedAllItems = view.items.filter(item => !item.confirmed);
        const allReviewsComplete = unresolvedAllItems.length === 0 &&
            !this.conflictPlan.hasBlockingIssues;
        const currentIndex = this.reviewPageIndex;
        const currentItem = visibleItems[currentIndex];

        section.append(renderTopbar(
            3,
            4,
            this.individualReviewMode === 'single' ? 'Modificar asistencia' : 'Resolución de pendientes',
            visibleItems.length ? `Empleado ${currentIndex + 1} de ${visibleItems.length}` : '',
            'CONFLICTOS',
            () => this.close()
        ));

        const summary = element('p', null, {
            className: 'mini-import-review-summary-line',
            dataset: { miniReviewSummary: '' }
        });
        summary.textContent = `${view.summary.total} personas · ` +
            `${view.summary.needsAttention} ` +
            `${view.summary.needsAttention === 1 ? 'requiere' : 'requieren'} atención · ` +
            `${view.summary.confirmed} confirmadas · ${view.summary.ignored} ignoradas`;

        if (visibleItems.length) {
            const scrollContent = element('div', null, {
                className: 'mini-import-review-scroll-content'
            });

            const statusBar = element('div', null, {
                className: 'mini-import-review-status-bar'
            });
            const progress = element('div', null, {
                className: 'mini-import-review-progress',
                dataset: { miniReviewProgress: '' }
            });
            progress.append(
                element(
                    'strong',
                    this.individualReviewMode === 'single'
                        ? 'Edición puntual'
                        : `Empleado ${currentIndex + 1} de ${visibleItems.length}`
                ),
                element('span', currentItem.confirmed ? 'Completo' : 'Pendiente')
            );

            statusBar.append(progress, summary);
            scrollContent.append(statusBar, this.renderReviewUnit(currentItem));
            section.append(scrollContent);

            const footer = element('nav', null, {
                className: 'mini-import-footer mini-import-review-navigation',
                dataset: { miniReviewNavigation: '' },
                'aria-label': 'Navegación entre empleados'
            });

            const back = actionButton('← Volver a lista', 'back-review');
            back.classList.add('mini-import-action-secondary');
            back.disabled = this.applyStatus === 'pending' || this.applyStatus === 'success';
            back.addEventListener('click', () => {
                this.showAutomaticReview();
            });

            const previous = actionButton('Anterior', 'previous-unit', currentIndex === 0);
            previous.classList.add('mini-import-action-secondary');
            previous.addEventListener('click', () => this.setReviewPage(currentIndex - 1));

            const isLast = currentIndex === visibleItems.length - 1;
            const nextLabel = isLast && currentItem.confirmed
                ? allReviewsComplete
                    ? 'Revisar resumen'
                    : `Ir al pendiente (${unresolvedAllItems.length})`
                : 'Siguiente';
            const next = actionButton(
                nextLabel,
                'next-unit',
                !currentItem.confirmed
            );
            next.classList.add('mini-import-action-primary');
            next.addEventListener('click', () => {
                if (isLast && allReviewsComplete) {
                    this.showFinalSummary();
                    return;
                }
                if (isLast) {
                    this.openIndividualReview(
                        unresolvedAllItems.map(item => this.reviewItemKey(item))
                    );
                    return;
                }
                this.setReviewPage(currentIndex + 1);
            });

            const queueStatus = element(
                'p',
                allReviewsComplete
                    ? 'Todas las asistencias están resueltas.'
                    : `${unresolvedAllItems.length} asistencia` +
                        `${unresolvedAllItems.length === 1 ? '' : 's'} pendiente` +
                        `${unresolvedAllItems.length === 1 ? '' : 's'} de revisión.`,
                {
                    className: allReviewsComplete
                        ? 'mini-import-queue-status is-complete'
                        : 'mini-import-queue-status',
                    dataset: { miniQueueStatus: '' }
                }
            );

            const navGroup = element('div', null, { style: 'display: flex; gap: 8px; align-items: center;' });
            navGroup.append(previous, next);

            footer.append(back, queueStatus, navGroup);
            section.append(footer);
        }
        if (!visibleItems.length) {
            const empty = element('div', null, {
                className: 'mini-import-review-empty',
                dataset: { miniReviewEmpty: '' }
            });
            empty.append(element(
                'p',
                allReviewsComplete
                    ? 'La revisión está completa. Comprueba el resumen y aplica la asistencia.'
                    : `Quedan ${unresolvedAllItems.length} asistencias pendientes.`
            ));
            if (!allReviewsComplete) {
                const resume = actionButton(
                    'Continuar con pendientes',
                    'resume-pending'
                );
                resume.addEventListener('click', () => this.openIndividualReview(
                    unresolvedAllItems.map(item => this.reviewItemKey(item))
                ));
                empty.append(resume);
            }
            const footer = element('nav', null, {
                className: 'mini-import-footer mini-import-review-navigation',
                dataset: { miniReviewNavigation: '' }
            });
            const back = actionButton('← Volver a lista', 'back-review');
            back.classList.add('mini-import-action-secondary');
            back.addEventListener('click', () => this.showAutomaticReview());
            footer.append(back);
            section.append(summary, empty, footer);
        }
        const locked = this.applyStatus === 'pending' || this.applyStatus === 'success';
        if (locked) {
            section.querySelectorAll('button, input, select').forEach(control => {
                control.disabled = true;
            });
        }
        const reviewComplete = allReviewsComplete;
        if (reviewComplete || this.applyStatus !== 'idle') {
            const apply = actionButton(
                'Revisar resumen final',
                'show-summary',
                this.conflictPlan.hasBlockingIssues || locked
            );
            apply.addEventListener('click', () => this.showFinalSummary());
            section.append(apply);
        }
        const status = this.renderApplyStatus();
        if (status) section.append(status);
        return section;
    }

    renderFinalSummary(view) {
        const section = element('section', null, {
            className: 'mini-import-final-summary',
            dataset: { miniFinalSummary: '' }
        });
        const ignoredCount = this.draft.rows.filter(row => row.excluded).length;
        const automaticKeys = new Set(
            [...this.automaticReviewChoices.entries()]
                .filter(([, choice]) => choice === 'accept')
                .map(([key]) => key)
        );
        const resolvedItems = view.items.filter(item => item.confirmed);
        const automaticCount = resolvedItems.filter(item =>
            automaticKeys.has(this.reviewItemKey(item))
        ).length;
        const manualCount = resolvedItems.length - automaticCount;
        const rowSummaries = this.conflictPlan.rows.map(row => {
            const miniTotal = row.imported.normalHours + row.imported.overtimeHours;
            const usingMini = row.decision.action === 'use_imported';
            const saTotal = usingMini
                ? row.positionAllocations.reduce((total, allocation) =>
                    total + allocation.normalHours + allocation.overtimeHours, 0)
                : (row.existing?.breakdown || []).reduce((total, allocation) =>
                    total + (allocation.hours || 0) + (allocation.overtimeHours || 0), 0);
            const employee = this.employees.find(candidate => candidate.id === row.employeeId);
            const source = row.sourceRows[0] || {};
            return {
                mini: `${source.rawNumber ?? ''} · ${source.rawName ?? ''}`,
                employee: employee
                    ? `${employee.number ?? ''} · ${employee.name ?? ''}`
                    : row.employeeId,
                decision: usingMini ? 'Usar asistencia de Mini' : 'Conservar registro de SA',
                miniTotal,
                saTotal,
                difference: Math.round((saTotal - miniTotal) * 100) / 100
            };
        });
        const miniTotal = rowSummaries.reduce((total, row) => total + row.miniTotal, 0);
        const saTotal = rowSummaries.reduce((total, row) => total + row.saTotal, 0);
        section.append(renderTopbar(4, 4, 'Importar asistencia desde Mini', 'Paso 4 · Resumen final', 'RESUMEN', () => this.close()));
        const content = element('div', null, { className: 'mini-import-content-gutter' });
        content.append(
            element('h3', 'Resumen final'),
            element(
                'p',
                'Esta es la única pantalla que escribe la asistencia en SA. ' +
                    'Revisa los totales antes de aplicar.',
                { className: 'mini-import-help' }
            )
        );
        const cards = element('div', null, { className: 'mini-import-summary-cards' });
        [
            ['Fecha', displayDate(this.conflictPlan.date)],
            ['Personas', String(view.summary.total + ignoredCount)],
            ['Automáticas', String(automaticCount)],
            ['Revisadas', String(manualCount)],
            ['Ignoradas', String(ignoredCount)],
            ['Pendientes', String(view.summary.needsAttention)]
        ].forEach(([label, value]) => {
            const card = element('div');
            card.append(element('span', label), element('strong', value));
            cards.append(card);
        });
        const totals = element('div', null, {
            className: 'mini-import-total-comparison',
            dataset: { miniFinalTotals: '' }
        });
        const difference = Math.round((saTotal - miniTotal) * 100) / 100;
        totals.append(
            element('span', `Mini reportó ${miniTotal} h`),
            element('span', `SA aplicará ${saTotal} h`),
            element(
                'strong',
                `Diferencia ${difference > 0 ? '+' : ''}${difference} h`
            )
        );
        content.append(cards, totals);

        const labels = ['Mini', 'Empleado en SA', 'Decisión', 'Mini', 'SA', 'Diferencia'];
        const table = element('table', null, {
            className: 'mini-import-rows mini-import-final-table'
        });
        const head = element('thead');
        const headingRow = element('tr');
        labels.forEach(label => headingRow.append(element('th', label, { scope: 'col' })));
        head.append(headingRow);
        const body = element('tbody');
        rowSummaries.forEach(summary => {
            const row = element('tr');
            [
                summary.mini,
                summary.employee,
                summary.decision,
                `${summary.miniTotal} h`,
                `${summary.saTotal} h`,
                `${summary.difference > 0 ? '+' : ''}${summary.difference} h`
            ].forEach((value, index) => {
                row.append(element('td', value, { dataset: { label: labels[index] } }));
            });
            body.append(row);
        });
        table.append(head, body);
        content.append(table);

        const locked = this.applyStatus === 'pending' || this.applyStatus === 'success';
        const back = actionButton('Volver', 'back-review');
        back.classList.add('mini-import-action-secondary');
        back.disabled = locked;
        back.addEventListener('click', () => this.showAutomaticReview());

        const apply = actionButton(
            this.applyStatus === 'error'
                ? 'Reintentar aplicación'
                : 'Aplicar asistencia en SA',
            'apply',
            this.conflictPlan.hasBlockingIssues || locked
        );
        apply.classList.add('mini-import-action-primary');
        apply.addEventListener('click', () => this.applyCurrentPlan());

        const footer = element('div', null, { className: 'mini-import-footer' });
        footer.append(back, apply);
        section.append(content, footer);
        const status = this.renderApplyStatus();
        if (status) content.append(status);
        return section;
    }

    renderApplyStatus() {
        if (this.applyStatus === 'idle') return null;
        const status = element('div', null, {
            dataset: { miniApplyStatus: '' },
            role: this.applyStatus === 'error' ? 'alert' : 'status'
        });
        if (this.applyStatus === 'pending') {
            status.textContent = 'Aplicando asistencia revisada…';
        } else if (this.applyStatus === 'error') {
            status.textContent = `No se pudo aplicar: ${this.applyError?.message || 'Error desconocido'}`;
        } else {
            status.append(element('p',
                `${this.applyResult.appliedCount} aplicadas · ` +
                `${this.applyResult.keptCount} conservadas · ` +
                `${this.draft.rows.filter(row => row.excluded).length} ignoradas`
            ));
            const close = actionButton('Cerrar', 'close-result');
            close.addEventListener('click', () => this.close());
            status.append(close);
        }
        return status;
    }

    renderReviewUnit(model) {
        const container = element('section', null, {
            className: `mini-import-review-unit${model.confirmed ? ' is-confirmed' : ''}`,
            dataset: { miniReviewUnit: model.id }
        });
        const identity = element('div', null, {
            className: 'mini-import-identity-card mini-import-identity-source'
        });
        identity.append(element('strong', model.probableDuplicate
            ? 'Apariciones en Mini' : 'Mini'));
        if (model.probableDuplicate) {
            identity.append(element(
                'small',
                'Se detectaron filas iguales. ' +
                'No se combinarán hasta que confirmes el empleado.'
            ));
        }
        model.occurrences.forEach(row => identity.append(element(
            'p', `${row.number} · ${row.name} · ${row.totalHours} h`
        )));
        const employeeSelect = element('select', null, {
            dataset: { miniEmployee: '' },
            'aria-label': 'Empleado SA'
        });
        const assignedEmployeeIds = this.assignedEmployeeIds(model);
        employeeSelect.append(element('option', 'Selecciona un empleado', { value: '' }));
        model.employeeOptions
            .filter(employee =>
                !this.hideAssignedEmployees ||
                !assignedEmployeeIds.has(employee.id) ||
                employee.id === model.employee?.id
            )
            .forEach(employee => {
            employeeSelect.append(element('option', `${employee.number} · ${employee.name}`, {
                value: employee.id,
                selected: model.employee?.id === employee.id
            }));
        });
        const assignedFilter = element('label', null, {
            className: 'mini-import-assigned-filter'
        });
        assignedFilter.append(
            element('input', null, {
                type: 'checkbox',
                checked: this.hideAssignedEmployees,
                dataset: { miniHideAssigned: '' }
            }),
            document.createTextNode(' Ocultar empleados ya asignados')
        );
        assignedFilter.querySelector('input').addEventListener('change', event => {
            this.hideAssignedEmployees = event.currentTarget.checked;
            this.render();
        });
        const localPosition = element('small', '', {
            dataset: { miniLocalPosition: '' }
        });
        const localHours = element(
            'p',
            `${model.allocation.normalHours + model.allocation.overtimeHours} h importadas`
        );
        const localIdentity = element('div', null, {
            className: 'mini-import-identity-card mini-import-identity-local'
        });
        localIdentity.append(
            element('strong', 'SA'),
            employeeSelect,
            assignedFilter,
            localHours,
            localPosition
        );
        const identityMap = element('div', null, {
            className: 'mini-import-identity-map',
            dataset: { miniIdentityMap: '' }
        });
        identityMap.append(
            identity,
            element('span', '→', {
                className: 'mini-import-identity-arrow',
                'aria-hidden': 'true'
            }),
            localIdentity
        );
        const buildHourControl = (labelText, input, kind, positionName) => {
            const controls = element('div', null, {
                className: 'mini-import-hour-stepper',
                dataset: { miniHourStepper: kind }
            });
            const decrease = element('button', '−', {
                type: 'button',
                className: 'mini-import-hour-step',
                dataset: { miniHourAdjust: '-0.25' },
                'aria-label': `Restar 15 minutos a ${labelText.toLowerCase()} de ${positionName}`
            });
            const increase = element('button', '+', {
                type: 'button',
                className: 'mini-import-hour-step',
                dataset: { miniHourAdjust: '0.25' },
                'aria-label': `Agregar 15 minutos a ${labelText.toLowerCase()} de ${positionName}`
            });
            controls.append(decrease, input, increase);
            const field = element('div', null, { className: 'mini-import-hour-field' });
            field.append(element('span', labelText), controls);
            return field;
        };
        const positionChoices = element('fieldset', null, {
            className: 'mini-import-position-allocation-field',
            dataset: { miniTargetPosition: '' },
            hidden: model.targetPositionOptions.length === 0
        });
        positionChoices.append(element('legend', 'Horas por cargo desempeñado'));
        positionChoices.append(element(
            'p',
            'Activa uno o más cargos y asigna sus horas normales y extra.',
            { className: 'mini-import-help' }
        ));
        const positionSegments = element('div', null, {
            className: 'mini-import-position-allocation-list',
            dataset: { miniPositionAllocationList: '' }
        });
        let syncCompletion = () => {};
        const duplicateChoiceKey = this.reviewItemKey(model);
        const duplicateHourTotals = [...new Set(model.occurrences
            .map(occurrence => Number(occurrence.totalHours))
            .filter(Number.isFinite))];
        const allocationForMiniTotal = totalHours => this.draft.allocationMode === 'all_normal'
            ? { normalHours: totalHours, overtimeHours: 0 }
            : {
                normalHours: Math.min(totalHours, this.draft.regularLimit),
                overtimeHours: Math.max(0, totalHours - this.draft.regularLimit)
            };
        const rememberedDuplicateTotal = this.duplicateHourChoices.get(duplicateChoiceKey);
        let selectedMiniBaseAllocation = Number.isFinite(rememberedDuplicateTotal)
            ? allocationForMiniTotal(rememberedDuplicateTotal)
            : null;
        const renderPositionSegments = (employeeId, preferredAllocations = []) => {
            const employee = this.employees.find(candidate => candidate.id === employeeId);
            const positionIds = Array.isArray(employee?.positions) ? employee.positions : [];
            const options = positionIds
                .map(positionId => this.positions.find(position => position.id === positionId))
                .filter(Boolean);
            const allocationByPosition = new Map(
                preferredAllocations.map(allocation => [allocation.positionId, allocation])
            );
            positionSegments.replaceChildren();
            options.forEach((position, index) => {
                const id = `mini-position-${this.controlId}-${model.id}-${position.id}`;
                const saved = allocationByPosition.get(position.id);
                const defaultSingle = !allocationByPosition.size && options.length === 1;
                const defaultFromMiniBase = !allocationByPosition.size &&
                    selectedMiniBaseAllocation && index === 0;
                const normalValue = saved?.normalHours ??
                    (defaultFromMiniBase
                        ? selectedMiniBaseAllocation.normalHours
                        : defaultSingle ? model.allocation.normalHours : 0);
                const overtimeValue = saved?.overtimeHours ??
                    (defaultFromMiniBase
                        ? selectedMiniBaseAllocation.overtimeHours
                        : defaultSingle ? model.allocation.overtimeHours : 0);
                const toggle = element('input', null, {
                    id,
                    type: 'checkbox',
                    value: position.id,
                    checked: Boolean(saved) || defaultSingle || Boolean(defaultFromMiniBase),
                    dataset: { miniTargetPositionOption: '' }
                });
                const label = element('label', null, {
                    htmlFor: id,
                    className: 'mini-import-position-toggle'
                });
                label.append(toggle, element('span', position.name));
                const normal = element('input', null, {
                    type: 'number',
                    min: 0,
                    max: 24,
                    step: 0.25,
                    value: normalValue,
                    dataset: { miniPositionNormal: '' },
                    'aria-label': `Horas normales de ${position.name}`
                });
                const overtime = element('input', null, {
                    type: 'number',
                    min: 0,
                    max: 24,
                    step: 0.25,
                    value: overtimeValue,
                    dataset: { miniPositionOvertime: '' },
                    'aria-label': `Horas extra de ${position.name}`
                });
                const allocationRow = element('div', null, {
                    className: 'mini-import-position-allocation',
                    dataset: { miniPositionAllocation: position.id }
                });
                allocationRow.append(
                    label,
                    buildHourControl('Normales', normal, 'normal', position.name),
                    buildHourControl('Extra', overtime, 'overtime', position.name)
                );
                toggle.addEventListener('change', () => {
                    if (!toggle.checked) {
                        normal.value = '0';
                        overtime.value = '0';
                    } else {
                        const totalAssigned = this.readPositionAllocations(container)
                            .reduce((total, allocation) =>
                                total + allocation.normalHours + allocation.overtimeHours, 0);
                        if (totalAssigned === 0) {
                            normal.value = String(model.allocation.normalHours);
                            overtime.value = String(model.allocation.overtimeHours);
                        }
                    }
                    syncCompletion();
                });
                [normal, overtime].forEach(input => input.addEventListener('input', () => {
                    if (Number(input.value) > 0) toggle.checked = true;
                    syncCompletion();
                }));
                positionSegments.append(allocationRow);
            });
            positionChoices.hidden = options.length === 0;
            localPosition.textContent = options.length
                ? 'Distribución pendiente'
                : 'Sin cargo disponible';
            syncCompletion();
        };
        renderPositionSegments(model.employee?.id, model.positionAllocations);
        employeeSelect.addEventListener('change', () => {
            renderPositionSegments(employeeSelect.value, []);
        });
        positionChoices.append(positionSegments);

        const duplicateHoursChoice = element('fieldset', null, {
            className: 'mini-import-duplicate-hours',
            dataset: { miniDuplicateHours: '' },
            hidden: duplicateHourTotals.length < 2 ||
                (model.existingBreakdown.length > 0 &&
                    model.decision?.action !== 'use_imported')
        });
        duplicateHoursChoice.append(
            element('legend', 'Mini envió horas diferentes'),
            element(
                'p',
                'Elige una cifra como base. Después puedes ajustar las horas por cargo.',
                { className: 'mini-import-help' }
            )
        );
        const duplicateHourSegments = element('div', null, {
            className: 'mini-import-segmented',
            role: 'radiogroup',
            'aria-label': 'Horas de Mini que se usarán como base'
        });
        duplicateHourTotals.forEach(totalHours => {
            const id = `mini-duplicate-hours-${this.controlId}-${model.id}-${totalHours}`;
            const input = element('input', null, {
                id,
                type: 'radio',
                name: `mini-duplicate-hours-${this.controlId}-${model.id}`,
                value: totalHours,
                checked: rememberedDuplicateTotal === totalHours,
                dataset: { miniDuplicateHourChoice: '' }
            });
            const label = element('label', null, { htmlFor: id });
            label.append(input, element('span', `Usar ${totalHours} h`));
            input.addEventListener('change', () => {
                if (!input.checked) return;
                this.duplicateHourChoices.set(duplicateChoiceKey, totalHours);
                selectedMiniBaseAllocation = allocationForMiniTotal(totalHours);
                renderPositionSegments(employeeSelect.value, []);
            });
            duplicateHourSegments.append(label);
        });
        duplicateHoursChoice.append(duplicateHourSegments);

        const decisionField = element('fieldset', null, {
            className: 'mini-import-segmented-field mini-import-source-choice',
            dataset: { miniAttendanceDecision: '' },
            hidden: model.existingBreakdown.length === 0
        });
        decisionField.append(element('legend', 'Usar asistencia de'));
        const decisionSegments = element('div', null, {
            className: 'mini-import-segmented',
            role: 'radiogroup',
            'aria-label': 'Origen de la asistencia'
        });
        [
            ['use_imported', 'Mini'],
            ['keep_existing', 'SA']
        ].forEach(([value, labelText]) => {
            const id = `mini-source-${this.controlId}-${model.id}-${value}`;
            const label = element('label', null, { htmlFor: id });
            label.append(
                element('input', null, {
                    id,
                    type: 'radio',
                    name: `mini-source-${this.controlId}-${model.id}`,
                    value,
                    checked: (model.decision?.action || 'keep_existing') === value,
                    dataset: { miniAttendanceSource: '' }
                }),
                element('span', labelText)
            );
            decisionSegments.append(label);
        });
        decisionField.append(decisionSegments);
        const importedTotalHours = model.allocation.normalHours + model.allocation.overtimeHours;
        const imported = element('div', null, {
            className: 'mini-import-source-record mini-import-source-record-mini',
            dataset: { miniImportedBreakdown: '' },
            hidden: model.existingBreakdown.length === 0
        });
        const importedHeader = element('div', null, { className: 'mini-import-card-header' });
        importedHeader.append(
            element('strong', 'Horas de Mini (Reporte)'),
            element('span', '', { className: 'mini-import-card-indicator' })
        );
        imported.append(
            importedHeader,
            element('div', `${importedTotalHours}.00 h`, { className: 'mini-import-card-metric' }),
            element(
                'p',
                duplicateHourTotals.length > 1
                    ? `Valores detectados: ${duplicateHourTotals.map(total => `${total} h`).join(' · ')}`
                    : `Total: ${model.allocation.normalHours} normales · ${model.allocation.overtimeHours} extra`
            )
        );

        const existingTotalHours = model.existingBreakdown.reduce((total, part) =>
            total + (part.hours || 0) + (part.overtimeHours || 0), 0);
        const existing = element('div', null, {
            className: 'mini-import-source-record mini-import-source-record-sa',
            dataset: { miniExistingBreakdown: '' },
            hidden: model.existingBreakdown.length === 0
        });
        const existingHeader = element('div', null, { className: 'mini-import-card-header' });
        existingHeader.append(
            element('strong', 'Registro actual en SA'),
            element('span', '', { className: 'mini-import-card-indicator' })
        );
        existing.append(
            existingHeader,
            element('div', `${existingTotalHours}.00 h`, { className: 'mini-import-card-metric' })
        );
        model.existingBreakdown.forEach(part => existing.append(element('p',
            `${part.position?.name || part.positionId}: ${part.hours} normales · ` +
            `${part.overtimeHours} extra`
        )));

        const recordComparison = element('div', null, {
            className: 'mini-import-record-comparison',
            dataset: { miniRecordComparison: '' },
            hidden: model.existingBreakdown.length === 0
        });
        recordComparison.append(imported, existing);

        const syncDecisionCards = () => {
            const currentSource = decisionSegments
                .querySelector('[data-mini-attendance-source]:checked')?.value;
            imported.classList.toggle('is-selected', currentSource === 'use_imported');
            existing.classList.toggle('is-selected', currentSource === 'keep_existing');
        };

        imported.addEventListener('click', () => {
            const radio = decisionSegments.querySelector('[data-mini-attendance-source][value="use_imported"]');
            if (radio && !radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        existing.addEventListener('click', () => {
            const radio = decisionSegments.querySelector('[data-mini-attendance-source][value="keep_existing"]');
            if (radio && !radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        syncDecisionCards();

        const collapse = element('p',
            'Al aceptar Mini se reemplazará la distribución actual por las horas indicadas.', {
            className: 'mini-import-warning',
            dataset: { miniCollapseWarning: '' },
            hidden: model.existingBreakdown.length < 2 || model.decision?.action !== 'use_imported'
        });
        decisionSegments.addEventListener('change', () => {
            const modalBody = container.closest('.modal-body');
            const overlay = container.closest('[data-modal-overlay]');
            const previousScrollTop = modalBody?.scrollTop;
            const useMini = decisionSegments
                .querySelector('[data-mini-attendance-source]:checked')?.value === 'use_imported';
            duplicateHoursChoice.hidden = duplicateHourTotals.length < 2 || !useMini;
            collapse.hidden = model.existingBreakdown.length < 2 || !useMini;
            if (overlay) overlay.scrollTop = 0;
            if (modalBody && Number.isFinite(previousScrollTop)) {
                modalBody.scrollTop = previousScrollTop;
            }
            syncDecisionCards();
            syncCompletion();
        });
        const remember = element('label', null, {
            className: 'mini-import-remember mini-import-switch',
            hidden: model.rememberedMatch ||
                !model.canRememberMatch ||
                !this.aliasStore ||
                !this.aliasScope
        });
        remember.append(
            element('input', null, {
                type: 'checkbox',
                checked: true,
                dataset: { miniRememberMatch: '' }
            }),
            element('span', '', { className: 'mini-import-switch-track', 'aria-hidden': 'true' }),
            element('strong', 'Recordar esta asociación')
        );
        const remembered = element('p', 'Coincidencia recordada en este dispositivo.', {
            className: 'mini-import-remembered',
            hidden: !model.rememberedMatch,
            dataset: { miniRememberedMatch: '' }
        });
        const completionHint = element('p', model.nextAction, {
            className: model.needsAttention ? 'mini-import-next-action attention'
                : 'mini-import-next-action',
            dataset: { miniNextAction: '', miniCompletionHint: '' }
        });
        const requiresIdentityConfirmation =
            ['identity', 'duplicate'].includes(model.issue);
        const confirmLabel = model.confirmed
            ? 'Confirmado'
            : requiresIdentityConfirmation
                ? 'Confirmar coincidencia'
                : 'Guardar selección';
        const confirm = actionButton(confirmLabel, 'confirm-unit', model.confirmed);
        confirm.classList.add('mini-import-action-primary');
        confirm.addEventListener('click', () => this.confirmReviewUnit(model, container));
        const ignore = actionButton('Ignorar en esta importación', 'ignore-unit', false);
        ignore.classList.add('mini-import-action-secondary');
        ignore.addEventListener('click', () => this.requestIgnoreReviewUnit(model));
        const choiceControls = element('div', null, {
            className: 'mini-import-review-choices'
        });
        choiceControls.append(
            decisionField,
            duplicateHoursChoice,
            recordComparison,
            positionChoices
        );
        const reviewControls = element('div', null, {
            className: 'mini-import-review-controls'
        });
        reviewControls.append(choiceControls);
        const actions = element('div', null, {
            className: 'mini-import-unit-actions'
        });
        actions.append(confirm, ignore);

        if (model.isInactive) {
            const inactiveBanner = element('div', null, {
                className: 'mini-import-inactive-banner',
                dataset: { miniInactiveBanner: '' },
                style: 'margin: 12px 0; padding: 12px 16px; background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px;'
            });
            inactiveBanner.append(
                element('strong', 'Empleado inactivo en SA', { style: 'display: block; color: #92400e; font-size: 0.95rem; margin-bottom: 4px;' }),
                element('p', 'Este empleado coincide de forma inequívoca con un registro inactivo en SA. Elige cómo deseas resolverlo:', { style: 'margin: 0; color: #78350f; font-size: 0.85rem;' })
            );
            const reactivateBtn = actionButton('Reactivar y aplicar asistencia', 'reactivate-apply');
            reactivateBtn.classList.add('mini-import-action-primary');
            reactivateBtn.addEventListener('click', () => this.handleReactivateAndApply(model, container));

            const ignoreInactiveBtn = actionButton('Ignorar esta asistencia', 'ignore-inactive');
            ignoreInactiveBtn.classList.add('mini-import-action-secondary');
            ignoreInactiveBtn.addEventListener('click', () => this.requestIgnoreReviewUnit(model));

            const postponeBtn = actionButton('Resolver después', 'postpone-inactive');
            postponeBtn.classList.add('mini-import-action-secondary');
            postponeBtn.addEventListener('click', () => {
                if (this.individualReviewMode === 'single') {
                    this.showAutomaticReview();
                    return;
                }
                this.setReviewPage(this.reviewPageIndex + 1);
            });

            actions.replaceChildren(reactivateBtn, ignoreInactiveBtn, postponeBtn);
            container.prepend(inactiveBanner);
        }

        container.append(
            identityMap,
            reviewControls,
            collapse,
            remember,
            remembered,
            completionHint,
            actions
        );
        syncCompletion = () => {
            const validation = this.reviewUnitValidation(model, container);
            confirm.disabled = model.confirmed || !validation.complete;
            const allocations = this.readPositionAllocations(container);
            const saTotal = allocations.reduce((total, allocation) =>
                total + allocation.normalHours + allocation.overtimeHours, 0);
            const miniTotal = selectedMiniBaseAllocation
                ? selectedMiniBaseAllocation.normalHours +
                    selectedMiniBaseAllocation.overtimeHours
                : model.allocation.normalHours + model.allocation.overtimeHours;
            const difference = Math.round((saTotal - miniTotal) * 100) / 100;
            localHours.textContent = duplicateHourTotals.length > 1 &&
                !selectedMiniBaseAllocation
                ? `Mini: ${duplicateHourTotals.join(' / ')} h · SA: ${saTotal} h · ` +
                    'Elige una base'
                : `Mini: ${miniTotal} h · SA: ${saTotal} h · ` +
                    `Diferencia: ${difference > 0 ? '+' : ''}${difference} h`;
            localHours.dataset.miniHoursComparison = '';
            const activeNames = allocations.map(allocation =>
                this.positionName(allocation.positionId)
            );
            localPosition.textContent = activeNames.length
                ? activeNames.join(' · ')
                : 'Selecciona al menos un cargo';
            const employeeInvalid = !validation.employeeValid ||
                validation.employeeNeedsConfirmation;
            localIdentity.classList.toggle('mini-import-invalid', employeeInvalid);
            employeeSelect.setAttribute('aria-invalid', String(employeeInvalid));
            positionChoices.classList.toggle(
                'mini-import-invalid',
                !validation.allocationValid
            );
            decisionField.classList.toggle(
                'mini-import-invalid',
                !validation.decisionValid
            );
            duplicateHoursChoice.classList.toggle(
                'mini-import-invalid',
                !validation.duplicateHoursValid
            );
            if (model.confirmed) {
                completionHint.textContent =
                    'Asistencia confirmada. Puedes continuar con el siguiente paso.';
                completionHint.classList.remove('attention');
                return;
            }
            const missing = [];
            if (!validation.employeeValid) missing.push('seleccionar el empleado');
            else if (validation.employeeNeedsConfirmation) {
                missing.push('confirmar la coincidencia con el botón de abajo');
            }
            if (!validation.allocationValid) missing.push('asignar horas y cargo');
            if (!validation.decisionValid) missing.push('elegir SA o Mini');
            if (!validation.duplicateHoursValid) {
                missing.push('elegir una de las horas enviadas por Mini');
            }
            completionHint.textContent = missing.length
                ? `Falta: ${missing.join('; ')}.`
                : model.nextAction;
            completionHint.classList.toggle(
                'attention',
                missing.length > 0 || model.needsAttention
            );
        };
        container.querySelectorAll('[data-mini-hour-adjust]').forEach(button => {
            button.addEventListener('click', () => {
                const input = button.closest('[data-mini-hour-stepper]')?.querySelector('input');
                if (!input) return;
                const next = Math.min(
                    24,
                    Math.max(0, Number(input.value || 0) + Number(button.dataset.miniHourAdjust))
                );
                input.value = String(Math.round(next * 100) / 100);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
        syncCompletion();
        return container;
    }
}

export default MiniAttendanceImportModal;
