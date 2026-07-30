import { Modal } from '../../components/Modal.js';
import { parseMiniAttendanceReport } from '../../features/attendance/MiniAttendanceParser.js';
import {
    buildMiniAttendanceApplyPlan,
    confirmMiniAttendanceDraftDate,
    createMiniAttendanceConflictPlan,
    createMiniAttendanceDraft,
    editMiniAttendanceDraftRow,
    excludeMiniAttendanceDraftRow,
    reviewMiniAttendanceConflict,
    reviewMiniAttendanceDraftRow,
    setMiniAttendanceAllocationMode
} from '../../features/attendance/MiniAttendanceDraft.js';
import { applyMiniAttendancePlan } from '../../features/attendance/MiniAttendanceImportService.js';
import { buildMiniAttendanceReviewViewModel } from '../MiniAttendanceReviewViewModel.js';

let nextControlId = 1;

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

export class MiniAttendanceImportModal {
    constructor({
        employees = [],
        attendance = {},
        positions = [],
        proposedDate = '',
        regularLimit = 8,
        onContinue = null,
        applyPlan = applyMiniAttendancePlan,
        aliases = [],
        aliasScope = null,
        aliasStore = null,
        actorUid = null,
        confirmIgnore = null
    } = {}) {
        this.employees = employees;
        this.attendance = attendance;
        this.positions = positions;
        this.proposedDate = proposedDate;
        this.pendingDate = proposedDate;
        this.regularLimit = regularLimit;
        this.onContinue = onContinue;
        this.applyPlan = applyPlan;
        this.aliases = aliases;
        this.aliasScope = aliasScope;
        this.aliasStore = aliasStore;
        this.actorUid = actorUid;
        this.confirmIgnore = confirmIgnore;
        this.applyStatus = 'idle';
        this.applyResult = null;
        this.applyError = null;
        this.reviewStep = 'individual';
        this.reviewPageIndex = 0;
        this.automaticReviewKeys = [];
        this.automaticReviewChoices = new Map();
        this.individualReviewKeys = [];
        this.stage = 'paste';
        this.source = '';
        this.parsed = null;
        this.draft = null;
        this.controlId = nextControlId++;
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
            content
        });
        this.modal.open();
        this.mount(content);
        return this;
    }

    close() {
        this.modal?.close();
    }

    analyze() {
        this.parsed = parseMiniAttendanceReport(this.source);
        this.draft = createMiniAttendanceDraft({
            parsed: this.parsed,
            employees: this.employees,
            aliases: this.aliases,
            aliasScope: this.aliasScope,
            proposedDate: this.proposedDate,
            regularLimit: this.regularLimit
        });
        this.pendingDate = this.proposedDate;
        this.stage = 'setup';
        this.render();
    }

    confirmDate() {
        this.draft = confirmMiniAttendanceDraftDate(this.draft, this.pendingDate);
        this.render();
    }

    setAllocationMode(mode) {
        this.draft = setMiniAttendanceAllocationMode(this.draft, mode);
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
                    targetPositionId: reviewed.targetPositionId || undefined,
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
        this.reviewStep = automaticItems.length ? 'automatic' : 'individual';
        this.individualReviewKeys = automaticItems.length
            ? []
            : view.items.map(item => this.reviewItemKey(item));
        if (typeof this.onContinue === 'function') this.onContinue(this.draft);
        this.render();
    }

    canContinue() {
        return Boolean(this.draft?.confirmedDate) &&
            this.draft.sourceBlockers.length === 0 &&
            this.draft.rows.length > 0 &&
            this.draft.rows.every(row => row.sourceRow.errors.length === 0);
    }

    syncModalLayout() {
        const shell = this.modal?.element?.querySelector('[data-modal-container]');
        const reviewing = this.stage === 'review';
        shell?.classList.toggle('mini-attendance-review-shell', reviewing);
        this.modal?.element?.classList.toggle('mini-attendance-review-overlay', reviewing);
        if (reviewing && this.modal?.element) this.modal.element.scrollTop = 0;
    }

    render() {
        if (!this.host) return;
        this.syncModalLayout();
        const root = element('section', null, {
            className: 'mini-attendance-import',
            dataset: { miniStage: this.stage },
            'aria-live': 'polite'
        });
        const content = this.stage === 'paste'
            ? this.renderPaste()
            : this.stage === 'setup' ? this.renderSetup() : this.renderReview();
        root.append(content);
        this.host.replaceChildren(root);
    }

    renderPaste() {
        const section = element('div', null, { className: 'mini-import-paste' });
        const id = `mini-attendance-source-${this.controlId}`;
        const label = element('label', 'Pega el reporte de Mini enviado por WhatsApp', { htmlFor: id });
        const textarea = element('textarea', null, {
            id,
            rows: 10,
            value: this.source,
            dataset: { miniSource: '' }
        });
        const analyze = actionButton('Analizar reporte', 'analyze', !this.source.trim());
        textarea.addEventListener('input', () => {
            this.source = textarea.value;
            analyze.disabled = !this.source.trim();
        });
        analyze.addEventListener('click', () => this.analyze());
        section.append(label, textarea, analyze);
        return section;
    }

    renderSetup() {
        const section = element('div', null, { className: 'mini-import-setup' });
        const back = actionButton('Volver al texto', 'back');
        back.addEventListener('click', () => {
            this.stage = 'paste';
            this.render();
        });
        const header = element('header', null, { className: 'mini-import-setup-header' });
        header.append(
            element('h2', 'Preparar importación'),
            element('p', 'Comprueba la fecha, las horas y las coincidencias antes de continuar.')
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
        header.append(summary);
        section.append(back, header, this.renderSourceSummary(), this.renderDateSetup(),
            this.renderAllocationSetup(), this.renderRows());
        const continueButton = actionButton('Continuar a revisión', 'continue', !this.canContinue());
        continueButton.classList.add('mini-import-action-primary');
        continueButton.addEventListener('click', () => this.startReview());
        section.append(
            element('p', this.canContinue()
                ? 'La preparación está completa.'
                : 'Confirma la fecha y corrige las advertencias antes de continuar.', {
                className: 'mini-import-help',
                dataset: { miniContinueHelp: '' }
            }),
            continueButton
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
        const section = element('fieldset');
        section.append(element('legend', '1. Confirmar fecha'));
        section.append(element(
            'p',
            'Compara la fecha completa con el encabezado de Mini. No se importará nada hasta confirmarla.',
            { className: 'mini-import-help', dataset: { miniDateHelp: '' } }
        ));
        const hint = this.parsed.header.dateHint;
        section.append(element('p', hint
            ? `${hint.weekday}, ${hint.day}/${hint.month} · ${hint.year ?? 'año no incluido'}`
            : 'El reporte no incluye una fecha reconocible.', {
            dataset: { miniDateHint: '' }
        }));
        const id = `mini-attendance-date-${this.controlId}`;
        const input = element('input', null, {
            id,
            type: 'date',
            value: this.pendingDate,
            dataset: { miniDate: '' }
        });
        input.addEventListener('input', () => { this.pendingDate = input.value; });
        const confirm = actionButton('Confirmar fecha', 'confirm-date');
        confirm.addEventListener('click', () => this.confirmDate());
        const blockers = element('div', this.draft.dateBlockers.map(dateBlockerText).join(' '), {
            dataset: { miniDateBlockers: '' },
            role: 'status'
        });
        section.append(element('label', 'Fecha completa', { htmlFor: id }), input, confirm, blockers);
        return section;
    }

    renderAllocationSetup() {
        const section = element('fieldset');
        section.append(element('legend', '2. Distribuir horas'));
        section.append(element(
            'p',
            `Puedes mantener todo como normal o separar el excedente sobre el límite regular de ${this.regularLimit} horas.`,
            { className: 'mini-import-help', dataset: { miniAllocationHelp: '' } }
        ));
        for (const mode of ['all_normal', 'split_at_regular_limit']) {
            const id = `mini-mode-${mode}-${this.controlId}`;
            const radio = element('input', null, {
                id,
                type: 'radio',
                name: `mini-allocation-${this.controlId}`,
                value: mode,
                checked: this.draft.allocationMode === mode
            });
            radio.addEventListener('change', () => {
                if (radio.checked) this.setAllocationMode(mode);
            });
            section.append(radio, element('label', modeLabel(mode), { htmlFor: id }));
        }
        section.append(element('p', modeLabel(this.draft.allocationMode), {
            dataset: { miniCurrentMode: '' }
        }));
        return section;
    }

    renderRows() {
        const section = element('section', null, { className: 'mini-import-preview' });
        section.append(
            element('h3', 'Vista previa de empleados'),
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
        const allocation = {
            normalHours: Number(container.querySelector('[data-mini-normal]')?.value),
            overtimeHours: Number(container.querySelector('[data-mini-overtime]')?.value)
        };
        const remember = container.querySelector('[data-mini-remember-match]')?.checked === true;
        const selectedDecision = container
            .querySelector('[data-mini-attendance-source]:checked')?.value;
        const selectedPosition = container
            .querySelector('[data-mini-target-position-option]:checked')?.value;

        item.sourceIndexes.forEach(sourceIndex => {
            this.draft = editMiniAttendanceDraftRow(this.draft, sourceIndex, allocation);
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
                targetPositionId: selectedPosition || row.targetPositionId || undefined,
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
        this.advanceReviewPageAfter(item.id);
        this.render();
        this.resetReviewViewport();
    }

    async rememberSelectedMatch(item, employeeId) {
        if (!this.aliasStore || !this.aliasScope) return;
        const employee = this.employees.find(candidate => candidate.id === employeeId);
        if (!employee) return;
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
        this.clampReviewPage();
        this.render();
        this.resetReviewViewport();
    }

    requestIgnoreReviewUnit(item) {
        const occurrence = item.occurrences[0] || {};
        const message = `${occurrence.number} · ${occurrence.name} no existe en el registro ` +
            'actual de SA. ¿Deseas ignorarlo y continuar?';
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
        if (!automaticItems.length) return;
        this.resetApplyState();
        this.rebuildConflictPlan();
        const nextView = this.buildReviewView();
        this.reviewStep = 'individual';
        this.individualReviewKeys = nextView.items
            .filter(item => !item.confirmed)
            .map(item => this.reviewItemKey(item));
        this.reviewPageIndex = 0;
        this.render();
        this.resetReviewViewport();
        if (!this.individualReviewKeys.length && !this.conflictPlan.hasBlockingIssues) {
            void this.applyCurrentPlan();
        }
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

    visibleReviewItems(view = this.buildReviewView()) {
        const keys = new Set(this.individualReviewKeys);
        return view.items.filter(item => keys.has(this.reviewItemKey(item)));
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
        if (!this.automaticReviewKeys.length) {
            this.stage = 'setup';
        } else {
            this.reviewStep = 'automatic';
        }
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

    advanceReviewPageAfter(reviewItemId) {
        const items = this.visibleReviewItems();
        const retainedIndex = items.findIndex(item => item.id === reviewItemId);
        if (retainedIndex >= 0 && retainedIndex < items.length - 1) {
            this.reviewPageIndex = retainedIndex + 1;
            return;
        }
        this.reviewPageIndex = items.length
            ? Math.min(this.reviewPageIndex, items.length - 1)
            : 0;
    }

    isReviewUnitComplete(model, container) {
        if (model.confirmed) return false;
        const employeeId = container.querySelector('[data-mini-employee]')?.value || '';
        const employee = this.employees.find(candidate => candidate.id === employeeId);
        if (!employee) return false;
        const normalHours = Number(container.querySelector('[data-mini-normal]')?.value);
        const overtimeHours = Number(container.querySelector('[data-mini-overtime]')?.value);
        const validHours = [normalHours, overtimeHours].every(value =>
            Number.isFinite(value) && value >= 0
        ) && normalHours + overtimeHours > 0 && normalHours + overtimeHours <= 24;
        if (!validHours) return false;
        const availablePositionIds = (employee.positions || [])
            .filter(positionId => this.positions.some(position => position.id === positionId));
        const selectedPosition = container
            .querySelector('[data-mini-target-position-option]:checked')?.value;
        const selectedDecision = container
            .querySelector('[data-mini-attendance-source]:checked')?.value;
        const requiresPosition = model.existingBreakdown.length === 0 ||
            selectedDecision === 'use_imported';
        if (requiresPosition && availablePositionIds.length > 0 &&
            !availablePositionIds.includes(selectedPosition)) {
            return false;
        }
        if (model.existingBreakdown.length > 0 &&
            !selectedDecision) {
            return false;
        }
        return true;
    }

    renderReview() {
        const section = element('div', null, { className: 'mini-import-review' });
        const back = actionButton('Volver', 'back-review');
        back.classList.add('mini-import-action-secondary');
        back.addEventListener('click', () => {
            if (this.reviewStep === 'automatic') {
                this.stage = 'setup';
                this.render();
                return;
            }
            this.showAutomaticReview();
        });
        section.append(back, element('p', modeLabel(this.draft.allocationMode), {
            dataset: { miniCurrentMode: '' }
        }));
        const view = this.buildReviewView();
        if (this.reviewStep === 'automatic' && this.automaticReviewKeys.length) {
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
        const automaticItems = this.automaticReviewItems(view);
        panel.append(
            element('h3', 'Confirmaciones automáticas'),
            element(
                'p',
                'Estas personas tienen una coincidencia clara o recordada, no poseen horas ' +
                    'registradas en SA y solo tienen un cargo disponible. Puedes aceptarlas ' +
                    'o marcar las que quieras modificar.',
                { className: 'mini-import-help' }
            )
        );
        const table = element('table', null, {
            className: 'mini-import-rows mini-import-auto-table',
            dataset: { miniAutomaticTable: '' }
        });
        const labels = ['Mini', 'Empleado en SA', 'Horas', 'Cargo', 'Decisión'];
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
        panel.append(table);
        const attentionCount = view.items
            .filter(item => !this.automaticReviewKeys.includes(this.reviewItemKey(item)) &&
                !item.confirmed)
            .length;
        const note = element(
            'p',
            attentionCount
                ? `${attentionCount} empleado${attentionCount === 1 ? '' : 's'} ` +
                    `${attentionCount === 1 ? 'pasará' : 'pasarán'} a ` +
                    'revisión individual después de aceptar esta tabla.'
                : 'Si aceptas todas las filas, las horas se aplicarán inmediatamente.',
            { className: 'mini-import-next-action', dataset: { miniAutomaticHint: '' } }
        );
        const accept = actionButton('', 'accept-automatic');
        accept.classList.add('mini-import-action-primary');
        const syncLabel = () => {
            const modifyCount = panel.querySelectorAll(
                '[data-mini-auto-choice]:checked[value="modify"]'
            ).length;
            accept.textContent = !attentionCount && !modifyCount
                ? 'Aceptar y aplicar horas'
                : 'Aceptar selección y continuar';
        };
        panel.addEventListener('change', syncLabel);
        accept.addEventListener('click', () => this.acceptAutomaticMatches(panel));
        syncLabel();
        panel.append(note, accept);
        return panel;
    }

    renderIndividualReview(view) {
        const section = element('section', null, {
            className: 'mini-import-individual-review',
            dataset: { miniIndividualReview: '' }
        });
        const summary = element('p', null, {
            className: 'mini-import-review-summary-line',
            dataset: { miniReviewSummary: '' }
        });
        summary.textContent = `${view.summary.total} personas · ` +
            `${view.summary.needsAttention} ` +
            `${view.summary.needsAttention === 1 ? 'requiere' : 'requieren'} atención · ` +
            `${view.summary.confirmed} confirmadas · ${view.summary.ignored} ignoradas`;
        section.append(element('h3', 'Revisión individual'), summary);
        const visibleItems = this.clampReviewPage(view);
        if (visibleItems.length) {
            const currentIndex = this.reviewPageIndex;
            const currentItem = visibleItems[currentIndex];
            const progress = element('div', null, {
                className: 'mini-import-review-progress',
                dataset: { miniReviewProgress: '' }
            });
            progress.append(
                element('strong', `Empleado ${currentIndex + 1} de ${visibleItems.length}`),
                element('span', currentItem.confirmed ? 'Completo' : 'Pendiente')
            );
            section.append(
                progress,
                this.renderReviewUnit(currentItem)
            );
            const navigation = element('nav', null, {
                className: 'mini-import-review-navigation',
                dataset: { miniReviewNavigation: '' },
                'aria-label': 'Navegación entre empleados'
            });
            const previous = actionButton('Anterior', 'previous-unit', currentIndex === 0);
            previous.addEventListener('click', () => this.setReviewPage(currentIndex - 1));
            const next = actionButton(
                'Siguiente',
                'next-unit',
                currentIndex === visibleItems.length - 1 || !currentItem.confirmed
            );
            next.addEventListener('click', () => this.setReviewPage(currentIndex + 1));
            navigation.append(previous, next);
            section.append(navigation);
        }
        if (!visibleItems.length) {
            const empty = element('div', null, {
                className: 'mini-import-review-empty',
                dataset: { miniReviewEmpty: '' }
            });
            empty.append(element(
                'p',
                'La revisión está completa. Comprueba el resumen y aplica la asistencia.'
            ));
            section.append(empty);
        }
        const locked = this.applyStatus === 'pending' || this.applyStatus === 'success';
        if (locked) {
            section.querySelectorAll('button, input, select').forEach(control => {
                control.disabled = true;
            });
        }
        const reviewComplete = visibleItems.length === 0 ||
            visibleItems.every(item => item.confirmed);
        if (reviewComplete || this.applyStatus !== 'idle') {
            const apply = actionButton(
                this.applyStatus === 'error'
                    ? 'Reintentar aplicación'
                    : 'Aplicar asistencia revisada',
                'apply',
                this.conflictPlan.hasBlockingIssues || locked
            );
            apply.addEventListener('click', () => this.applyCurrentPlan());
            section.append(apply);
        }
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
        employeeSelect.append(element('option', 'Selecciona un empleado', { value: '' }));
        model.employeeOptions.forEach(employee => {
            employeeSelect.append(element('option', `${employee.number} · ${employee.name}`, {
                value: employee.id,
                selected: model.employee?.id === employee.id
            }));
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
        const normal = element('input', null, {
            type: 'number',
            min: 0,
            max: 24,
            step: 0.25,
            value: model.allocation.normalHours,
            dataset: { miniNormal: '' },
            'aria-label': 'Horas normales'
        });
        const overtime = element('input', null, {
            type: 'number',
            min: 0,
            max: 24,
            step: 0.25,
            value: model.allocation.overtimeHours,
            dataset: { miniOvertime: '' },
            'aria-label': 'Horas extra'
        });
        const buildHourControl = (labelText, input, kind) => {
            const controls = element('div', null, {
                className: 'mini-import-hour-stepper',
                dataset: { miniHourStepper: kind }
            });
            const decrease = element('button', '−', {
                type: 'button',
                className: 'mini-import-hour-step',
                dataset: { miniHourAdjust: '-0.25' },
                'aria-label': `Restar 15 minutos a ${labelText.toLowerCase()}`
            });
            const increase = element('button', '+', {
                type: 'button',
                className: 'mini-import-hour-step',
                dataset: { miniHourAdjust: '0.25' },
                'aria-label': `Agregar 15 minutos a ${labelText.toLowerCase()}`
            });
            controls.append(decrease, input, increase);
            const field = element('div', null, { className: 'mini-import-hour-field' });
            field.append(element('span', labelText), controls);
            return field;
        };
        const normalControl = buildHourControl('Horas normales', normal, 'normal');
        const overtimeControl = buildHourControl('Horas extra', overtime, 'overtime');
        const positionChoices = element('fieldset', null, {
            className: 'mini-import-segmented-field',
            dataset: { miniTargetPosition: '' },
            hidden: model.targetPositionOptions.length === 0
        });
        positionChoices.append(element('legend', 'Cargo desempeñado'));
        const positionSegments = element('div', null, {
            className: 'mini-import-segmented',
            role: 'radiogroup',
            'aria-label': 'Cargo desempeñado'
        });
        let syncCompletion = () => {};
        const renderPositionSegments = (employeeId, preferredPositionId = null) => {
            const employee = this.employees.find(candidate => candidate.id === employeeId);
            const positionIds = Array.isArray(employee?.positions) ? employee.positions : [];
            const options = positionIds
                .map(positionId => this.positions.find(position => position.id === positionId))
                .filter(Boolean);
            positionSegments.replaceChildren();
            options.forEach((position, index) => {
                const id = `mini-position-${this.controlId}-${model.id}-${position.id}`;
                const label = element('label', null, { htmlFor: id });
                label.append(
                    element('input', null, {
                        id,
                        type: 'radio',
                        name: `mini-position-${this.controlId}-${model.id}`,
                        value: position.id,
                        checked: preferredPositionId === position.id ||
                            (!preferredPositionId && options.length === 1 && index === 0),
                        dataset: { miniTargetPositionOption: '' }
                    }),
                    element('span', position.name)
                );
                positionSegments.append(label);
            });
            positionChoices.hidden = options.length === 0;
            const selected = positionSegments
                .querySelector('[data-mini-target-position-option]:checked')?.value;
            localPosition.textContent = selected
                ? this.positionName(selected)
                : options.length ? 'Selecciona un cargo' : 'Sin cargo disponible';
            syncCompletion();
        };
        renderPositionSegments(model.employee?.id, model.targetPositionId);
        employeeSelect.addEventListener('change', () => {
            renderPositionSegments(employeeSelect.value);
        });
        positionSegments.addEventListener('change', () => {
            const selected = positionSegments
                .querySelector('[data-mini-target-position-option]:checked')?.value;
            localPosition.textContent = selected
                ? this.positionName(selected)
                : 'Selecciona un cargo';
            syncCompletion();
        });
        positionChoices.append(positionSegments);

        const decisionField = element('fieldset', null, {
            className: 'mini-import-segmented-field',
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
            ['keep_existing', 'SA'],
            ['use_imported', 'Mini']
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
        const existing = element('div', null, {
            className: 'mini-import-unit-existing',
            dataset: { miniExistingBreakdown: '' },
            hidden: model.existingBreakdown.length === 0
        });
        if (model.existingBreakdown.length) existing.append(element('strong', 'Registro actual de SA'));
        model.existingBreakdown.forEach(part => existing.append(element('p',
            `${part.position?.name || part.positionId}: ${part.hours} normales · ` +
            `${part.overtimeHours} extra`
        )));
        const collapse = element('p',
            'Al aceptar Mini se reemplazará la distribución actual de cargos por el cargo elegido.', {
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
            collapse.hidden = model.existingBreakdown.length < 2 || !useMini;
            if (overlay) overlay.scrollTop = 0;
            if (modalBody && Number.isFinite(previousScrollTop)) {
                modalBody.scrollTop = previousScrollTop;
            }
            syncCompletion();
        });
        const remember = element('label', null, {
            className: 'mini-import-remember',
            hidden: model.rememberedMatch || !this.aliasStore || !this.aliasScope
        });
        remember.append(
            element('input', null, {
                type: 'checkbox',
                dataset: { miniRememberMatch: '' }
            }),
            document.createTextNode(' Recordar esta coincidencia para próximas importaciones')
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
        const confirmLabel = model.confirmed
            ? 'Confirmado'
            : 'Guardar selección';
        const confirm = actionButton(confirmLabel, 'confirm-unit', model.confirmed);
        confirm.classList.add('mini-import-action-primary');
        confirm.addEventListener('click', () => this.confirmReviewUnit(model, container));
        const ignore = actionButton('Ignorar en esta importación', 'ignore-unit', false);
        ignore.classList.add('mini-import-action-secondary');
        ignore.hidden = !model.canIgnore;
        ignore.addEventListener('click', () => this.requestIgnoreReviewUnit(model));
        const choiceControls = element('div', null, {
            className: 'mini-import-review-choices'
        });
        choiceControls.append(positionChoices, decisionField);
        const hourControls = element('div', null, {
            className: 'mini-import-review-hours'
        });
        hourControls.append(normalControl, overtimeControl);
        const reviewControls = element('div', null, {
            className: 'mini-import-review-controls'
        });
        reviewControls.append(choiceControls, hourControls);
        const actions = element('div', null, {
            className: 'mini-import-unit-actions'
        });
        actions.append(confirm, ignore);
        container.append(
            identityMap,
            existing,
            reviewControls,
            collapse,
            remember,
            remembered,
            completionHint,
            actions
        );
        syncCompletion = () => {
            const complete = this.isReviewUnitComplete(model, container);
            confirm.disabled = model.confirmed || !complete;
            localHours.textContent = `${Number(normal.value) + Number(overtime.value)} h importadas`;
            completionHint.textContent = complete
                ? model.nextAction
                : 'Completa el empleado, las horas y el cargo antes de continuar.';
            completionHint.classList.toggle('attention', !complete || model.needsAttention);
        };
        normal.addEventListener('input', syncCompletion);
        overtime.addEventListener('input', syncCompletion);
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
