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
    createMultiDayAttendanceResolver
} from '../../features/attendance/MultiDayAttendanceResolver.js';

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

function isIncorporatedDraft(draft) {
    return draft?.status === 'incorporated' || draft?.status === 'imported';
}

function renderTopbar(step, totalSteps, title = 'Importar asistencia desde Mini', subtitle = '', chipText = '', onClose = null) {
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

    const rightGroup = element('div', null, { className: 'mini-import-topbar-right' });
    if (chipText) {
        rightGroup.append(element('div', chipText, { className: 'mini-import-chip mini-import-topbar-chip' }));
    }
    const stepEl = element('div', `${step}/${totalSteps}`, { className: 'mini-import-topbar-step' });
    rightGroup.append(stepEl);

    if (onClose) {
        const closeBtn = element('button', '✕', {
            type: 'button',
            className: 'mini-import-topbar-close',
            'aria-label': 'Cerrar'
        });
        closeBtn.addEventListener('click', onClose);
        rightGroup.append(closeBtn);
    }

    const progress = element('div', null, {
        className: 'mini-import-progress-bar',
        style: `width: ${Math.round((step / totalSteps) * 100)}%;`
    });
    bar.append(brand, rightGroup, progress);
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
        if (this.host && this.connectedView === 'inbox') this.render();
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
            const completedCount = drafts.length;
            this.selectedDraftIds.clear();
            this.consolidatedResult = null;
            this.consolidationProposal = null;
            this.multiDayResolver = null;
            this.connectedView = 'inbox';
            this.completionStatusMessage = `Importación completada. ${completedCount} borrador${completedCount === 1 ? '' : 'es'} marcado${completedCount === 1 ? '' : 's'} como incorporado${completedCount === 1 ? '' : 's'}.`;
            this.render();
        } catch (err) {
            console.error('Error completing connected import:', err);
            this.completionStatusMessage = 'No se pudo completar la importación. Los borradores no fueron marcados como incorporados.';
            this.render();
        }
    }

    consolidateSelectedDrafts() {
        const drafts = this.savedDrafts.filter(d => this.selectedDraftIds.has(d.submissionId) && !isIncorporatedDraft(d));
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
        this.consolidationProposal = buildConsolidationProposal(this.consolidatedResult, {
            employees: employeesSnapshot,
            attendance: attendanceSnapshot
        });
        this.multiDayResolver = createMultiDayAttendanceResolver({
            consolidation: this.consolidatedResult,
            employees: employeesSnapshot,
            attendance: attendanceSnapshot,
            positions: positionsSnapshot,
            saProjectId: this.saProjectId,
            entityScope: entityScopeSnapshot,
            regularLimit: this.regularLimit,
            applyPlan: this.applyPlan
        });
        this.connectedView = 'consolidation';
        this.reviewStatusPromise = this.markDraftsReviewed(drafts);
        this.render();
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
            this.transportStatusMessage = `Reintentando ${targetMiniIds.length} Mini(s) fallido(s)...`;
        } else if (requestedMiniId) {
            const targetName = activeTargets[0]?.name || 'Mini vinculado';
            this.transportStatusMessage = `Solicitando asistencia a ${targetName}...`;
        } else {
            this.transportStatusMessage = this.linkedMinis.length > 1
                ? `Solicitando asistencia a ${this.linkedMinis.length} Minis vinculados...`
                : 'Solicitando asistencia al Mini vinculado...';
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
                const baseMessage = result?.message || 'Asistencia recibida parcialmente de algunos Minis.';
                this.transportStatusMessage = stillHasFailures && isRetry
                    ? `${baseMessage} · ${this.failedMiniTargets.length} Mini(s) aún pendientes de reintento.`
                    : baseMessage;
            } else {
                this.connectionState = 'success';
                const count = result?.importedCount ?? (Array.isArray(result?.submissions) ? result.submissions.length : (result?.totalSubmissions ?? ''));
                const countText = count !== '' ? ` (${count} importados)` : '';
                this.transportStatusMessage = result?.message || `✓ Asistencia recibida y guardada en borrador${countText}.`;
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
                this.transportStatusMessage = 'Solicitud cancelada por el usuario.';
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
            case 'requesting': return 'Solicitando…';
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

        tabs.append(connectedBtn, pasteBtn);
        return tabs;
    }

    renderPaste() {
        const section = element('div', null, { className: 'mini-import-paste' });
        section.append(renderTopbar(1, 4, 'Importar asistencia desde Mini', 'Paso 1 · Pegado', 'PEGADO', () => this.close()));
        section.append(this.renderModeTabs());
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
        section.append(label, textarea, footer);
        return section;
    }

    renderConnected() {
        const section = element('div', null, {
            className: `mini-import-paste mini-import-connected mini-import-connected-view-${this.connectedView}`,
            dataset: { miniConnectedView: this.connectedView }
        });
        const connectedStep = this.connectedView === 'inbox' ? 2 : this.connectedView === 'consolidation' ? 3 : 1;
        const subtitle = this.connectedView === 'inbox'
            ? 'Paso 2 · Bandeja de borradores'
            : this.connectedView === 'consolidation'
                ? 'Paso 3 · Consolidación y conciliación'
                : 'Paso 1 · Solicitar asistencia';
        const chip = this.connectedView === 'inbox'
            ? 'BANDEJA'
            : this.connectedView === 'consolidation'
                ? 'REVISIÓN'
                : 'CONECTADOS';
        section.append(renderTopbar(connectedStep, 3, 'Importar asistencia desde Mini', subtitle, chip, () => this.close()));
        if (this.connectedView === 'request') section.append(this.renderModeTabs());

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
                const opt = element('option', `${mini.name || 'Mini'} (${mini.deviceId || mini.id})`, {
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

        const hint = element('p', 'Vincula dispositivos Mini desde Ajustes P2P para sincronización directa.', {
            className: 'mini-import-hint',
            dataset: { miniConnectedHint: '' }
        });
        selectionSection.append(selectLabel, selector, hint);

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
            this.isFetchingConnected ? 'Solicitando...' : (this.connectionState === 'error' ? 'Reintentar solicitud' : 'Solicitar asistencia al Mini'),
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
                `Reintentar fallidos (${this.failedMiniTargets.length})`,
                'retry-failed'
            );
            retryBtn.classList.add('mini-import-retry-btn');
            retryBtn.dataset.miniAction = 'retry-failed';
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
                const displayName = mini.alias && mini.alias !== mini.name
                    ? `${mini.name} (${mini.alias})`
                    : (mini.name || mini.displayName || 'Mini');
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

        const counts = {
            all: this.savedDrafts.length,
            new: this.savedDrafts.filter(draft => draft.status === 'pending').length,
            notIncorporated: this.savedDrafts.filter(draft => !isIncorporatedDraft(draft)).length,
            incorporated: this.savedDrafts.filter(draft => isIncorporatedDraft(draft)).length
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

        if (!this.savedDrafts.length) {
            draftsSection.append(
                element('p', 'No hay borradores guardados en la bandeja de entrada.', {
                    className: 'mini-import-empty-drafts',
                    dataset: { miniEmptyDrafts: '' }
                })
            );
        } else {
            const listEl = element('div', null, { className: 'mini-import-draft-list', dataset: { miniDraftList: '' } });
            const visibleDrafts = this.getVisibleDrafts();
            visibleDrafts.forEach(draft => {
                const incorporated = isIncorporatedDraft(draft);
                const itemEl = element('div', null, {
                    className: `mini-import-draft-card${incorporated ? ' is-incorporated' : ''}`,
                    dataset: { miniDraftItem: draft.submissionId, miniDraftState: incorporated ? 'incorporated' : draft.status || 'pending' }
                });
                const isChecked = !incorporated && this.selectedDraftIds.has(draft.submissionId);
                const checkbox = element('input', null, {
                    type: 'checkbox',
                    checked: isChecked,
                    disabled: incorporated,
                    dataset: { miniDraftCheckbox: draft.submissionId }
                });
                checkbox.addEventListener('change', () => this.toggleDraftSelection(draft.submissionId));

                const info = element('div', null, { className: 'mini-import-draft-info' });
                const sourceName = draft.metadata?.sourcePeerName ||
                    draft.metadata?.sourcePeerId ||
                    draft.sourceSnapshot?.scope?.sourceId ||
                    draft.sourceSnapshot?.deviceId ||
                    'Mini desconocido';
                const statusLabel = draft.status === 'pending'
                    ? 'Nuevo'
                    : draft.status === 'reviewed'
                        ? 'No incorporado'
                        : isIncorporatedDraft(draft)
                            ? 'Incorporado'
                            : draft.status || 'No incorporado';
                const headline = element('div', null, { className: 'mini-import-draft-title' });
                headline.append(
                    element('strong', displayDate(draft.workDate) || draft.workDate),
                    element('span', sourceName, { className: 'mini-import-draft-source' })
                );
                const meta = element('div', null, { className: 'mini-import-draft-meta' });
                meta.append(
                    element('span', `${draft.sourceSnapshot?.rows?.length || 0} fila${draft.sourceSnapshot?.rows?.length === 1 ? '' : 's'}`),
                    element('span', statusLabel, {
                        className: `mini-import-draft-status is-${draft.status || 'pending'}${incorporated ? ' is-incorporated' : ''}`,
                        dataset: draft.status === 'pending' ? { miniDraftNew: '' } : {}
                    })
                );
                if (draft.receivedAt) meta.append(element('span', `Recibido: ${formatMiniDate(draft.receivedAt)}`));
                if (draft.updatedAt && draft.updatedAt !== draft.receivedAt) meta.append(element('span', `Actualizado: ${formatMiniDate(draft.updatedAt)}`));
                info.append(headline, meta);
                itemEl.append(checkbox, info);
                listEl.append(itemEl);
            });
            if (!visibleDrafts.length) {
                listEl.append(element('p', 'No hay borradores que coincidan con este filtro.', {
                    className: 'mini-import-empty-drafts',
                    dataset: { miniEmptyFilteredDrafts: '' }
                }));
            }
            draftsSection.append(listEl);

            const consolidateBtn = actionButton(
                `Consolidar borradores seleccionados (${this.selectedDraftIds.size})`,
                'consolidate-drafts',
                this.selectedDraftIds.size === 0
            );
            consolidateBtn.classList.add('mini-import-action-primary');
            consolidateBtn.addEventListener('click', () => this.consolidateSelectedDrafts());
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
                element('p', this.savedDrafts.length
                    ? `${this.savedDrafts.length} borrador${this.savedDrafts.length === 1 ? '' : 'es'} guardado${this.savedDrafts.length === 1 ? '' : 's'} para revisar cuando quieras.`
                    : 'Las respuestas recibidas se guardan aquí sin modificar la asistencia oficial de SA.')
            );
            const openInboxBtn = actionButton(
                `Revisar borradores (${this.savedDrafts.length})`,
                'open-connected-inbox'
            );
            openInboxBtn.classList.add('mini-import-action-primary');
            openInboxBtn.addEventListener('click', () => { void this.openConnectedInbox(); });
            inboxCard.append(inboxCopy, openInboxBtn);
            section.append(selectionSection, dateSection, inboxCard);
            return section;
        }

        if (this.connectedView === 'inbox') {
            const nav = element('div', null, { className: 'mini-import-connected-nav' });
            const back = actionButton('← Volver a solicitar', 'back-connected-request');
            back.classList.add('mini-import-action-secondary');
            back.addEventListener('click', () => this.openConnectedRequest());
            nav.append(back, element('p', 'Selecciona uno o varios borradores. Nada se escribe en SA hasta completar la conciliación.', {
                className: 'mini-import-hint'
            }));
            section.append(nav, draftsSection);
            return section;
        }

        const nav = element('div', null, { className: 'mini-import-connected-nav' });
        const back = actionButton('← Volver a la bandeja', 'back-connected-inbox');
        back.classList.add('mini-import-action-secondary');
        back.addEventListener('click', () => { void this.openConnectedInbox(); });
        nav.append(back, element('p', 'Primero se resuelven diferencias entre Minis y después se compara la propuesta con SA.', {
            className: 'mini-import-hint'
        }));
        section.append(nav);
        if (this.consolidatedResult) {
            section.append(this.renderConsolidationSkeleton());
        } else {
            section.append(element('div', 'No hay una consolidación activa. Vuelve a la bandeja y selecciona borradores.', {
                className: 'mini-import-empty-drafts'
            }));
        }
        return section;
    }

    renderConsolidationSkeleton() {
        const container = element('div', null, {
            className: 'mini-import-consolidation-skeleton',
            dataset: { miniConsolidationSkeleton: '' }
        });

        const summary = this.consolidatedResult.summary;
        const badges = element('div', null, { className: 'mini-consolidation-summary-badges' });
        badges.append(
            element('span', `Total: ${summary.totalItems}`, { className: 'mini-badge mini-badge-total' }),
            element('span', `Resueltos: ${summary.resolvedCount}`, { className: 'mini-badge mini-badge-resolved' }),
            element('span', `Conflictos de horas: ${summary.hoursConflictCount}`, { className: 'mini-badge mini-badge-conflict' }),
            element('span', `Identidades no resueltas: ${summary.unresolvedIdentityCount}`, { className: 'mini-badge mini-badge-unresolved' })
        );

        if (this.multiDayResolver) {
            const multiSummary = this.multiDayResolver.getMultiDaySummary();
            badges.append(
                element('span', `Días listos: ${multiSummary.readyDaysCount}`, { className: 'mini-badge mini-badge-ready-days' }),
                element('span', `Días aplicados: ${multiSummary.appliedDaysCount}`, { className: 'mini-badge mini-badge-applied-days' })
            );
        }

        // Grouped view
        const grouped = groupConsolidatedAttendance(this.consolidatedResult, this.groupingMode);
        const groupsContainer = element('div', null, { className: 'mini-consolidation-groups' });

        if (grouped.mode === 'day') {
            grouped.groups.forEach(group => {
                const groupEl = element('div', null, { className: 'mini-consolidation-group-card' });
                const headerEl = element('div', null, { className: 'mini-consolidation-group-header' });
                headerEl.append(
                    element('h4', `Fecha: ${group.workDate} (${group.items.length} trabajadores)`)
                );

                const dayState = this.multiDayResolver ? this.multiDayResolver.getDayState(group.workDate) : null;
                if (dayState) {
                    const statusText = dayState.status === 'applied'
                        ? 'Aplicado'
                        : dayState.status === 'ready'
                            ? 'Listo para aplicar'
                            : dayState.status === 'stage_b_conflict'
                                ? 'Conflicto con SA'
                                : 'Conflicto entre Minis';
                    headerEl.append(element('span', statusText, {
                        className: `mini-day-status is-${dayState.status}`,
                        dataset: { miniDayStatus: dayState.status, miniDayDate: group.workDate }
                    }));

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
                groupEl.append(headerEl);

                const itemsList = element('div', null, { className: 'mini-consolidation-items-list' });
                group.items.forEach(item => {
                    const rowEl = element('div', null, {
                        className: `mini-consolidation-row is-${item.status}`,
                        dataset: { miniConsolidationItem: item.id }
                    });
                    const statusLabel = item.status === 'conflict' ? 'Conflicto horas' : 'Identidad no resuelta';
                    const sourcesText = Array.isArray(item.sources)
                        ? [...new Set(item.sources.map(s => s.deviceId).filter(Boolean))].join(', ')
                        : '';
                    rowEl.append(
                        element('span', item.displayName || 'Sin nombre', { className: 'mini-row-name' }),
                        element('span', item.displayNumber ? `#${item.displayNumber}` : '', { className: 'mini-row-number' }),
                        element('span', item.normalHours !== null ? `${item.normalHours}h` : 'Horas en conflicto', { className: 'mini-row-hours' }),
                        item.status === 'resolved'
                            ? resolvedCheckSvg('Resuelto')
                            : element('span', statusLabel, { className: `mini-row-status is-${item.status}` })
                    );
                    if (sourcesText) {
                        rowEl.append(element('span', sourcesText, { className: 'mini-row-provenance', dataset: { miniSourceProvenance: '' } }));
                    }

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
                            linkBtn.addEventListener('click', () => {
                                if (!empSelect.value) return;
                                this.multiDayResolver.resolveItemIdentity(item.id, empSelect.value);
                                this.render();
                            });
                            resolveIdentityEl.append(empSelect, linkBtn);
                            rowEl.append(resolveIdentityEl);
                        }

                        // 2. Hours conflict between Minis
                        if (item.status === 'conflict' && Array.isArray(item.sources) && item.sources.length > 1) {
                            const resolveHoursEl = element('div', null, {
                                className: 'mini-hours-resolve-row',
                                dataset: { miniHoursConflict: item.id }
                            });
                            resolveHoursEl.append(element('span', 'Elegir horas reportadas:', { className: 'mini-control-label' }));
                            item.sources.forEach((src, srcIndex) => {
                                const srcBtn = actionButton(
                                    `Mini ${src.sourceId || src.deviceId}: ${src.normalHours}h / ${src.overtimeHours}h`,
                                    'resolve-hours'
                                );
                                srcBtn.dataset.miniItemId = item.id;
                                srcBtn.dataset.miniSourceIndex = String(srcIndex);
                                srcBtn.addEventListener('click', () => {
                                    this.multiDayResolver.resolveItemHours(item.id, { sourceIndex: srcIndex });
                                    this.render();
                                });
                                resolveHoursEl.append(srcBtn);
                            });
                            rowEl.append(resolveHoursEl);
                        }

                        // 3. Existing SA conflict
                        if (dayState && dayState.conflictPlan) {
                            const conflictRow = dayState.conflictPlan.rows.find(r => r.employeeId === item.saEmployeeId);
                            if (conflictRow && !conflictRow.isIdentical && !conflictRow.decision.acknowledged) {
                                const saConflictEl = element('div', null, {
                                    className: 'mini-sa-conflict-row',
                                    dataset: { miniSaConflict: item.saEmployeeId }
                                });
                                const existingNormal = conflictRow.existing?.record?.hoursWorked || 0;
                                const existingOvertime = conflictRow.existing?.record?.overtimeHours || 0;
                                saConflictEl.append(
                                    element('span', `SA tiene ${existingNormal}h norm / ${existingOvertime}h extra vs Mini ${item.normalHours}h:`, { className: 'mini-control-label' })
                                );

                                const keepSaBtn = actionButton('Conservar SA', 'keep-sa');
                                keepSaBtn.dataset.miniEmployeeId = item.saEmployeeId;
                                keepSaBtn.dataset.miniDate = group.workDate;
                                keepSaBtn.addEventListener('click', () => {
                                    this.multiDayResolver.resolveDayConflict(group.workDate, item.saEmployeeId, { action: 'keep_existing' });
                                    this.render();
                                });

                                const useImportedBtn = actionButton('Usar Mini', 'use-imported');
                                useImportedBtn.dataset.miniEmployeeId = item.saEmployeeId;
                                useImportedBtn.dataset.miniDate = group.workDate;
                                useImportedBtn.addEventListener('click', () => {
                                    this.multiDayResolver.resolveDayConflict(group.workDate, item.saEmployeeId, { action: 'use_imported' });
                                    this.render();
                                });

                                saConflictEl.append(keepSaBtn, useImportedBtn);
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

                    itemsList.append(rowEl);
                });
                groupEl.append(itemsList);
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
                    const sourcesText = Array.isArray(item.sources)
                        ? [...new Set(item.sources.map(s => s.deviceId).filter(Boolean))].join(', ')
                        : '';
                    rowEl.append(
                        element('span', item.displayName || 'Sin nombre', { className: 'mini-row-name' }),
                        element('span', item.displayNumber ? `#${item.displayNumber}` : '', { className: 'mini-row-number' }),
                        element('span', `${item.normalHours}h`, { className: 'mini-row-hours' }),
                        element('span', 'Identidad no resuelta', { className: 'mini-row-status is-identity_conflict' })
                    );
                    if (sourcesText) {
                        rowEl.append(element('span', sourcesText, { className: 'mini-row-provenance', dataset: { miniSourceProvenance: '' } }));
                    }

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

        // Proposal Seam banner
        const proposalNotice = element('div', null, {
            className: 'mini-proposal-seam-notice',
            dataset: { miniProposalSeam: '' }
        });
        proposalNotice.append(
            element('strong', 'Seam de propuesta para conciliación:'),
            element('p', 'La propuesta está consolidada y lista para el conciliador oficial. No se ha escrito en la asistencia oficial de SA.')
        );
        if (this.consolidationProposal) {
            const pSummary = this.consolidationProposal.summary;
            proposalNotice.append(
                element('div', `Propuestas generadas: ${pSummary.total} · Listas: ${pSummary.readyToApply} · Bloqueadas: ${pSummary.blockedCount}`)
            );
        }

        container.append(badges, groupsContainer, proposalNotice);

        // Batch Apply footer
        if (this.multiDayResolver) {
            const multiSummary = this.multiDayResolver.getMultiDaySummary();
            const batchSection = element('div', null, {
                className: 'mini-consolidation-batch-actions',
                dataset: { miniBatchActions: '' }
            });
            const applyReadyBtn = actionButton(
                `Aplicar días listos (${multiSummary.readyDaysCount})`,
                'apply-ready-days',
                multiSummary.readyDaysCount === 0
            );
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
                'Completar importación',
                'complete-connected-import',
                !allDaysApplied || this.selectedDraftIds.size === 0
            );
            completeBtn.classList.add('mini-import-action-primary');
            completeBtn.addEventListener('click', () => { void this.completeConnectedImport(); });
            batchSection.append(applyReadyBtn, completeBtn);
            if (!allDaysApplied) {
                batchSection.append(element('span', 'Resuelve y aplica todos los días para completar la importación.', {
                    className: 'mini-import-complete-hint'
                }));
            }
            container.append(batchSection);
        }

        return container;
    }

    renderSetup() {
        const section = element('div', null, { className: 'mini-import-setup' });
        section.append(renderTopbar(2, 4, 'Importar asistencia desde Mini', 'Paso 2 · Validación', 'VALIDACIÓN', () => this.close()));

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

        section.append(
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
            }),
            footer
        );
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
        panel.append(execCard);

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
        panel.append(detailedSection);

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
        panel.append(note, footer);
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
            status.append(element(
                'span',
                item.confirmed ? 'Resuelto' : item.problemSummary.label,
                {
                    className: item.confirmed
                        ? 'mini-import-status-badge is-resolved'
                        : `mini-import-status-badge is-${item.problemSummary.severity}`,
                    title: item.confirmed
                        ? 'Asistencia resuelta'
                        : item.problems.map(problem => problem.message).join(' ')
                }
            ));
            if (!item.confirmed) {
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
        section.append(
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
        section.append(cards, totals);

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
        section.append(table);

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
        section.append(footer);
        const status = this.renderApplyStatus();
        if (status) section.append(status);
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
