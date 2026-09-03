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
import { state, stateManager } from '../../core/AppState.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';

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
        confirmReactivate = null
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

    syncModalLayout() {
        const shell = this.modal?.element?.querySelector('[data-modal-container]');
        const reviewing = this.stage === 'review';
        shell?.classList.add('mini-attendance-review-shell');
        shell?.classList.toggle('is-detailed-table', reviewing && this.showDetailedTable);
        this.modal?.element?.classList.add('mini-attendance-review-overlay');
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
        section.append(renderTopbar(1, 4, 'Importar asistencia desde Mini', 'Paso 1 · Pegado', 'PEGADO', () => this.close()));
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
        const back = actionButton('Volver', 'back-review');
        back.classList.add('mini-import-action-secondary');
        back.disabled = this.applyStatus === 'pending' || this.applyStatus === 'success';
        back.addEventListener('click', () => {
            this.showAutomaticReview();
        });
        section.append(back, this.renderIndividualReview(view));
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
        const summary = element('p', null, {
            className: 'mini-import-review-summary-line',
            dataset: { miniReviewSummary: '' }
        });
        summary.textContent = `${view.summary.total} personas · ` +
            `${view.summary.needsAttention} ` +
            `${view.summary.needsAttention === 1 ? 'requiere' : 'requieren'} atención · ` +
            `${view.summary.confirmed} confirmadas · ${view.summary.ignored} ignoradas`;
        section.append(
            element('h3', this.individualReviewMode === 'single'
                ? 'Modificar asistencia'
                : 'Revisión de pendientes'),
            summary
        );
        const visibleItems = this.clampReviewPage(view);
        const unresolvedAllItems = view.items.filter(item => !item.confirmed);
        const allReviewsComplete = unresolvedAllItems.length === 0 &&
            !this.conflictPlan.hasBlockingIssues;
        if (visibleItems.length) {
            const currentIndex = this.reviewPageIndex;
            const currentItem = visibleItems[currentIndex];
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
            navigation.append(previous, next);
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
            section.append(queueStatus, navigation);
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
            section.append(empty);
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
        const imported = element('div', null, {
            className: 'mini-import-source-record mini-import-source-record-mini',
            dataset: { miniImportedBreakdown: '' },
            hidden: model.existingBreakdown.length === 0
        });
        imported.append(
            element('strong', 'Registro actual de Mini'),
            element(
                'p',
                duplicateHourTotals.length > 1
                    ? `Valores detectados: ${duplicateHourTotals.map(total => `${total} h`).join(' · ')}`
                    : `Total: ${model.allocation.normalHours} normales · ` +
                        `${model.allocation.overtimeHours} extra`
            )
        );
        const existing = element('div', null, {
            className: 'mini-import-source-record mini-import-source-record-sa',
            dataset: { miniExistingBreakdown: '' },
            hidden: model.existingBreakdown.length === 0
        });
        if (model.existingBreakdown.length) existing.append(element('strong', 'Registro actual de SA'));
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
