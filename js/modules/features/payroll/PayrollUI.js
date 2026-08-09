import icons from '../../ui/IconSystem.js';
import { stateManager } from '../../core/AppState.js';
import { Modal } from '../../components/Modal.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { getDateKey, formatDateShort } from '../../utils/DateUtils.js';
import { LoansLedger } from '../loans/LoansLedger.js';
import { migrateAllAdvances } from '../loans/LoansController.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import {
    applyPayrollLoanDeductions,
    buildPayrollLoanSelection,
    calculatePayrollBeforeLoans,
    getEligiblePayrollLoans,
    getInvalidPayrollLoanRows,
    removeEmployeePayrollLoans as removeEmployeePayrollLoansFromSelection,
    setEmployeePayrollLoans,
    setPayrollLoanChargeCount,
    summarizePayrollLoans,
    togglePayrollLoan,
    toSplitXRows
} from './PayrollLoans.js';
import { renderPayrollLoansDesktop } from './PayrollLoansDesktop.js';
import {
    applyPayrollLoanSettlementBatch,
    buildPayrollPreviewFingerprint,
    confirmPayrollPaid
} from './PayrollLoanSettlement.js';
import {
    openPayrollClosureModal,
    renderPayrollClosurePanel
} from './PayrollClosureUI.js';
import { renderPayrollHistoryView } from './PayrollHistoryUI.js';
import {
    buildPayrollClosureDraft,
    getPayrollClosureGate,
    undoPayrollClosureEffects
} from './PayrollClosureWorkflow.js';
import payrollClosureStore from './PayrollClosureStore.js';
import payrollClosureSync from './PayrollClosureSync.js';
import {
    consumePayrollClosureAdjustments,
    restorePayrollClosureAdjustments
} from './PayrollClosureAdjustments.js';
import { getPayrollEmployeesForPeriod, resolvePayrollPeriod } from './PayrollPeriod.js';
import { summarizeAdjustmentDetails } from './PayrollSummary.js';
import { buildPayrollHistoricalOrganization } from './PayrollHistoricalIdentity.js';
import {
    hydrateRememberedAdjustments,
    resolveAdjustmentScope,
    summarizeGlobalAdjustments,
    updateRememberedDefault
} from './PayrollAdjustments.js';
import {
    readAdjustmentForm,
    renderDesktopAdjustmentWorkspace,
    updateAdjustmentFormPresentation
} from './PayrollAdjustmentDesktop.js';

let context = null;
let payrollService = null;
let latestPayrollPreviewRows = [];
let payrollClosureInProgress = false;
let payrollPeriodClosureCache = {
    key: null,
    items: [],
    ready: false,
    loading: false,
    error: null
};
let payrollHistoryState = {
    items: [],
    pages: [],
    pageIndex: 0,
    page: 1,
    hasPrevious: false,
    filters: { status: '', periodStart: '', periodEnd: '' },
    nextCursor: null,
    selectedClosure: null,
    loading: false,
    ready: false,
    error: null,
    detailFilters: {
        leaderId: '',
        includeBonuses: true,
        includeDeductions: true,
        includeLoans: true
    }
};
let payrollHistoryLoadToken = 0;

// ============================================
// 🎯 EVENT DELEGATION (data-payroll-action)
// ============================================
const _ACTION_MAP = {
    'toggle-step': (step) => window.PayrollUI?.toggleStep?.(step),
    'set-payroll-guide-step': (step) => window.PayrollUI?.setPayrollGuideStep?.(step),
    'toggle-payroll-mobile-summary': () => window.PayrollUI?.togglePayrollMobileSummary?.(),
    'toggle-payroll-summary-detail': (kind) => window.PayrollUI?.togglePayrollSummaryDetail?.(kind),
    'set-export-preset': (preset) => window.PayrollUI?.setExportPreset?.(preset),
    'add-export-deduction': () => window.PayrollUI?.addExportDeduction?.(),
    'remove-export-deduction': (idx) => window.PayrollUI?.removeExportDeduction?.(parseInt(idx, 10)),
    'add-employee-deductions-to-export': () => window.PayrollUI?.addEmployeeDeductionsToExport?.(),
    'add-employee-deduction-from-form': () => window.PayrollUI?.addEmployeeDeductionFromForm?.(),
    'add-export-bonus': () => window.PayrollUI?.addExportBonus?.(),
    'remove-export-bonus': (idx) => window.PayrollUI?.removeExportBonus?.(parseInt(idx, 10)),
    'add-employee-bonuses-to-export': () => window.PayrollUI?.addEmployeeBonusesToExport?.(),
    'add-employee-bonus-from-form': () => window.PayrollUI?.addEmployeeBonusFromForm?.(),
    'add-payroll-loans': () => window.PayrollUI?.addPayrollLoansToExport?.(),
    'remove-employee-payroll-loans': (employeeId) => window.PayrollUI?.removeEmployeePayrollLoans?.(employeeId),
    'clear-payroll-loans': () => window.PayrollUI?.clearPayrollLoans?.(),
    'toggle-payroll-loan-employee': (employeeId, _target, event) => {
        event.preventDefault();
        event.stopPropagation();
        window.PayrollUI?.toggleEmployeePayrollLoans?.(employeeId);
    },
    'toggle-payroll-loan': (employeeId, target, event) => {
        event.stopPropagation();
        window.PayrollUI?.togglePayrollLoanSelection?.(employeeId, target.dataset.loanId);
    },
    'adjust-payroll-loan-charge-count': (employeeId, target, event) => {
        event.stopPropagation();
        window.PayrollUI?.adjustPayrollLoanChargeCount?.(
            employeeId,
            target.dataset.loanId,
            Number(target.dataset.delta) || 0
        );
    },
    'select-all-payroll-loan-charges': (employeeId, target, event) => {
        event.stopPropagation();
        window.PayrollUI?.selectAllPayrollLoanCharges?.(employeeId, target.dataset.loanId);
    },
    'toggle-payroll-paid': (_id, target) => window.PayrollUI?.togglePayrollPaidConfirmation?.(target.checked),
    'open-payroll-closure': () => window.PayrollUI?.openPayrollClosure?.(),
    'undo-payroll-closure': (closureId) => window.PayrollUI?.undoPayrollClosure?.(closureId),
    'prepare-payroll-correction': (closureId) => window.PayrollUI?.preparePayrollCorrection?.(closureId),
    'open-payroll-history-detail': (closureId) => window.PayrollUI?.openPayrollHistoryDetail?.(closureId),
    'close-payroll-history-detail': () => window.PayrollUI?.closePayrollHistoryDetail?.(),
    'previous-payroll-history-page': () => window.PayrollUI?.loadPayrollHistory?.({ direction: 'previous' }),
    'next-payroll-history-page': () => window.PayrollUI?.loadPayrollHistory?.({ direction: 'next' }),
    'toggle-payroll-loan-details': (_employeeId, target, event) => {
        event.preventDefault();
        event.stopPropagation();
        const group = target.closest('.payroll-loan-group');
        if (!group) return;
        group.open = !group.open;
        target.setAttribute('aria-expanded', String(group.open));
        target.setAttribute(
            'aria-label',
            `${group.open ? 'Ocultar' : 'Mostrar'} préstamos de ${group.querySelector('.payroll-loan-group__employee-copy strong')?.textContent || 'empleado'}`
        );
    },
    'toggle-remember-adjustment': (index, target) => window.PayrollUI?.toggleRememberGlobalAdjustment?.(
        target.dataset.kind,
        parseInt(index, 10),
        target.checked
    ),
    'add-desktop-adjustment': (kind, target) => window.PayrollUI?.addDesktopAdjustment?.(kind, target),
    'update-desktop-adjustment': (kind, target) => window.PayrollUI?.updateDesktopAdjustment?.(kind, target),
    'remove-desktop-adjustment': (kind, target) => window.PayrollUI?.removeDesktopAdjustment?.(kind, target),
    'copy-export-json': () => window.PayrollUI?.copyExportJSON?.(),
    'download-export-json': () => window.PayrollUI?.downloadExportJSON?.(),
    'change-payroll-view-mode': (mode) => window.PayrollUI?.changePayrollViewMode?.(mode)
};

function _handlePayrollClick(e) {
    const target = e.target.closest('[data-payroll-action]');
    if (!target) return;
    const action = target.dataset.payrollAction;
    const handler = _ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

function _handlePayrollKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-payroll-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handlePayrollClick(e);
}

function _handlePayrollAdjustmentInput(e) {
    const historyFilter = e.target.dataset.payrollHistoryFilter;
    if (historyFilter && e.type === 'change') {
        window.PayrollUI?.setPayrollHistoryFilter?.(historyFilter, e.target.value);
        return;
    }
    const historyDetailFilter = e.target.dataset.payrollHistoryDetailFilter;
    if (historyDetailFilter && e.type === 'change') {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        window.PayrollUI?.setPayrollHistoryDetailFilter?.(historyDetailFilter, value);
        return;
    }
    const form = e.target.closest('.payroll-adjustment-form');
    if (!form) return;
    updateAdjustmentFormPresentation(
        form,
        latestPayrollPreviewRows,
        getState().positions || []
    );
}

let _payrollDelegationAttached = false;

export function init(ctx) {
    context = ctx;
    payrollService = ctx.services.payroll;
    if (!_payrollDelegationAttached) {
        document.addEventListener('click', _handlePayrollClick);
        document.addEventListener('keydown', _handlePayrollKeydown);
        document.addEventListener('input', _handlePayrollAdjustmentInput);
        document.addEventListener('change', _handlePayrollAdjustmentInput);
        _payrollDelegationAttached = true;
    }
}

function getState() {
    return context.state;
}

function getSummaryAmountClass(amount, nonZeroClass) {
    return Math.abs(Number(amount) || 0) < 0.005 ? 'is-zero' : nonZeroClass;
}

function payrollPeriodKey(periodStart, periodEnd) {
    return `${String(periodStart || '')}:${String(periodEnd || '')}`;
}

function canUsePayrollRemote() {
    return Boolean(globalThis.currentUser) && globalThis.navigator?.onLine !== false;
}

function requestPayrollPeriodClosures(periodStart, periodEnd, { force = false } = {}) {
    const key = payrollPeriodKey(periodStart, periodEnd);
    if (payrollPeriodClosureCache.key !== key) {
        payrollPeriodClosureCache = {
            key,
            items: [],
            ready: false,
            loading: false,
            error: null
        };
    }
    if ((payrollPeriodClosureCache.ready && !force) || payrollPeriodClosureCache.loading) {
        return payrollPeriodClosureCache;
    }
    payrollPeriodClosureCache.loading = true;
    payrollPeriodClosureCache.error = null;
    Promise.resolve()
        .then(async () => {
            if (!canUsePayrollRemote()) {
                throw new Error('No se puede verificar el historial remoto sin conexión.');
            }
            await payrollClosureSync.pullPeriod(periodStart, periodEnd);
            return payrollClosureStore.getByPeriod(periodStart, periodEnd);
        })
        .then(items => {
            if (payrollPeriodClosureCache.key !== key) return;
            payrollPeriodClosureCache = {
                key,
                items,
                ready: true,
                loading: false,
                error: null
            };
            context?.render?.();
        })
        .catch(error => {
            if (payrollPeriodClosureCache.key !== key) return;
            payrollPeriodClosureCache.loading = false;
            payrollPeriodClosureCache.ready = false;
            payrollPeriodClosureCache.error = error;
            console.warn('No se pudo cargar el historial de nómina:', error);
            context?.render?.();
        });
    return payrollPeriodClosureCache;
}

function updatePayrollPeriodClosureCache(closure) {
    const key = payrollPeriodKey(closure.periodStart, closure.periodEnd);
    if (payrollPeriodClosureCache.key !== key) return;
    const byId = new Map(payrollPeriodClosureCache.items.map(item => [item.id, item]));
    byId.set(closure.id, closure);
    payrollPeriodClosureCache = {
        key,
        items: [...byId.values()],
        ready: true,
        loading: false,
        error: null
    };
}

function getEmployeesWithDeductions() {
    const state = getState();
    return state.employees.filter(e => Array.isArray(e.deductions) && e.deductions.length > 0);
}

function getEmployeesWithBonuses() {
    const state = getState();
    return state.employees.filter(e => Array.isArray(e.bonuses) && e.bonuses.length > 0);
}

function getLeaderFilteredEmployees(state) {
    return getPayrollEmployeesForPeriod(
        state,
        state.exportConfig.periodStart,
        state.exportConfig.periodEnd
    );
}

/**
 * Top-level Nómina tab. Mirrors the Reports tab pattern: a header with two
 * sub-tab buttons that switch the inner view between the existing payroll
 * generator and the new Cuentas-por-Cobrar (loans ledger).
 */
export function PayrollTab() {
    const state = getState();
    const mode = state.payrollViewMode || 'generator';

    return `
        <div>
            <div class="date-controls payroll-view-switcher">
                <div class="view-controls">
                    <button type="button"
                            class="view-btn ${mode === 'generator' ? 'active' : ''}"
                            data-payroll-action="change-payroll-view-mode"
                            data-value="generator">
                        ${icons.get('payroll')} Generar Nómina
                    </button>
                    <button type="button"
                            class="view-btn ${mode === 'ledger' ? 'active' : ''}"
                            data-payroll-action="change-payroll-view-mode"
                            data-value="ledger">
                        ${icons.get('dollar')} Cuentas por Cobrar
                    </button>
                    <button type="button"
                            class="view-btn ${mode === 'history' ? 'active' : ''}"
                            data-payroll-action="change-payroll-view-mode"
                            data-value="history">
                        ${icons.get('calendar')} Historial
                    </button>
                </div>
            </div>
            ${mode === 'ledger'
                ? LoansLedger()
                : (mode === 'history' ? PayrollHistoryTab() : PayrollGeneratorTab())}
        </div>
    `;
}

/** Setter wired through data-payroll-action="change-payroll-view-mode". */
export function changePayrollViewMode(mode) {
    if (!['generator', 'ledger', 'history'].includes(mode)) return;
    stateManager.setState({ payrollViewMode: mode });
    // 🛡️ When entering the loans ledger, pull any legacy advances that the
    // user just registered through the in-profile editor into emp.loans[] so
    // they appear immediately (without forcing a page refresh). The migration
    // is idempotent and free when nothing new exists.
    if (mode === 'ledger') {
        try { migrateAllAdvances(); } catch (_) { /* never block the view switch */ }
    }
    context.render();
    if (mode === 'history') loadPayrollHistory();
}

/**
 * The existing payroll-generation view (previously the entire body of
 * PayrollTab). Renamed to make room for the sub-tab dispatcher above.
 */
function PayrollGeneratorTab() {
    const state = getState();
    const guideSteps = ['period', 'deductions', 'bonuses', 'loans', 'review'];

    // Inicializar secciones colapsadas y defaults recordados una sola vez por sesión.
    // Guard first: this runs during render, and batchSetState schedules a render
    // when it closes — entering it unconditionally would re-render on every pass.
    const needsInit = state.exportConfig.collapsedSteps === undefined ||
        !guideSteps.includes(state.exportConfig.payrollGuideStep) ||
        !state.exportConfig.rememberedGlobalsHydrated ||
        !state.exportConfig.periodStart || !state.exportConfig.periodEnd ||
        !state.exportConfig.leaderFilter;
    if (needsInit) {
        stateManager.batchSetState(() => {
            if (!guideSteps.includes(state.exportConfig.payrollGuideStep)) {
                state.exportConfig.payrollGuideStep = 'period';
            }
            if (state.exportConfig.collapsedSteps === undefined) {
                state.exportConfig.collapsedSteps = ['step2', 'step2b', 'step2c', 'step3'];
            }
            if (!state.exportConfig.rememberedGlobalsHydrated) {
                const hydrated = hydrateRememberedAdjustments(state.exportConfig, state.settings);
                state.exportConfig.deductions = hydrated.deductions;
                state.exportConfig.bonuses = hydrated.bonuses;
                state.exportConfig.rememberedGlobalsHydrated = true;
            }
            if (!state.exportConfig.periodStart || !state.exportConfig.periodEnd) {
                const period = resolvePayrollPeriod(state.settings.payPeriod, new Date());
                state.exportConfig.periodStart = period.periodStart;
                state.exportConfig.periodEnd = period.periodEnd;
                state.exportConfig.periodSource = period.source;
                state.exportConfig.activePreset = period.source === 'configured' ? 'payPeriod' : 'thisMonth';
            }
            if (!state.exportConfig.leaderFilter) state.exportConfig.leaderFilter = 'all';
        });
    }
    const isStepCollapsed = (id) => (state.exportConfig.collapsedSteps || []).includes(id);

    const exportData = generateExportData();
    latestPayrollPreviewRows = exportData;
    const invalidLoanRows = getInvalidPayrollLoanRows(exportData);
    const hasInvalidLoanRows = invalidLoanRows.length > 0;
    const previewFingerprint = buildPayrollPreviewFingerprint({
        periodStart: state.exportConfig.periodStart,
        periodEnd: state.exportConfig.periodEnd,
        rows: exportData
    });
    const closureCache = requestPayrollPeriodClosures(
        state.exportConfig.periodStart,
        state.exportConfig.periodEnd
    );
    let payrollClosureGate = getPayrollClosureGate({
        rows: exportData,
        fingerprint: previewFingerprint,
        paidConfirmation: state.exportConfig.payrollPaidConfirmation,
        activeClosures: closureCache.items,
        correctionSupersedesId: state.exportConfig.payrollCorrectionSupersedesId,
        historyReady: closureCache.ready,
        inProgress: payrollClosureInProgress
    });
    if (closureCache.error) {
        payrollClosureGate = { ...payrollClosureGate, enabled: false, reason: 'history-error' };
    }
    const totalAmount = exportData.reduce((sum, item) => sum + item.monto, 0);
    const filteredPayrollEmployees = getLeaderFilteredEmployees(state);
    const loanSummary = summarizePayrollLoans(
        filteredPayrollEmployees,
        state.exportConfig.payrollLoanSelection || [],
        state.exportConfig.periodEnd
    );
    const deductionSummary = summarizeGlobalAdjustments(state.exportConfig.deductions, '-', formatCurrency);
    const bonusSummary = summarizeGlobalAdjustments(state.exportConfig.bonuses, '+', formatCurrency);
    const employeesWithDeductions = getEmployeesWithDeductions();
    const hasEmployeeDeductions = employeesWithDeductions.length > 0;
    const employeeDeductionsAdded = !!state.exportConfig.employeeDeductionsAdded;

    const employeesWithBonuses = getEmployeesWithBonuses();
    const hasEmployeeBonuses = employeesWithBonuses.length > 0;
    const employeeBonusesAdded = !!state.exportConfig.employeeBonusesAdded;
    
    const employeeOptions = state.employees
        .filter(e => e.active !== false)
        .sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }))
        .map(e => `<option value="${e.id}">${e.number} - ${e.name}</option>`)
        .join('');
        
    const leaderFilter = state.exportConfig.leaderFilter || 'all';
    const leaders = state.leaders.filter(l => l.active);
    const guideStep = guideSteps.includes(state.exportConfig.payrollGuideStep)
        ? state.exportConfig.payrollGuideStep
        : 'period';
    const guideStepIndex = guideSteps.indexOf(guideStep);
    const previousGuideStep = guideSteps[Math.max(guideStepIndex - 1, 0)];
    const nextGuideStep = guideSteps[Math.min(guideStepIndex + 1, guideSteps.length - 1)];
    const grossAmount = exportData.reduce((sum, item) => sum + (Number(item._brutoOriginal) || 0), 0);
    const bonusAmount = exportData.reduce((sum, item) => sum + (Number(item._bonuses) || 0), 0);
    const deductionAmount = exportData.reduce((sum, item) => sum + (Number(item._deductions) || 0), 0);
    const loanAmount = exportData.reduce((sum, item) => sum + (Number(item._loans) || 0), 0);
    const isVisibleReviewAmount = value => Math.abs(Number(value) || 0) >= 0.005;
    const hasReviewAmount = key => exportData.some(item => isVisibleReviewAmount(item[key]));
    const showBonusColumn = hasReviewAmount('_bonuses');
    const showDeductionColumn = hasReviewAmount('_deductions');
    const showLoanColumn = hasReviewAmount('_loans');
    const deductionDetails = summarizeAdjustmentDetails(
        state.exportConfig.deductions,
        exportData,
        'Deducción'
    );
    const bonusDetails = summarizeAdjustmentDetails(
        state.exportConfig.bonuses,
        exportData,
        'Bonificación'
    );
    const expandedSummary = state.exportConfig.payrollSummaryExpanded || {};
    const mobileSummaryExpanded = Boolean(state.exportConfig.payrollMobileSummaryExpanded);
    const guideItems = [
        ['period', '1', 'Período', 'Seleccionar rango', 'Período'],
        ['deductions', '2', 'Deducciones', `${formatCurrency(deductionAmount)} aplicado`, 'Deducc.'],
        ['bonuses', '3', 'Bonificaciones', `${formatCurrency(bonusAmount)} agregado`, 'Bonos'],
        ['loans', '4', 'Préstamos', `${loanSummary.selectedCount} seleccionados`, 'Préstamos'],
        ['review', '5', 'Vista previa', `${exportData.length} empleados`, 'Vista']
    ];

    return `
        <div class="payroll-generator">
            <!-- Header -->
            <div class="payroll-generator__header">
                <div>
                    <h2>
                        <span>Nómina</span>
                    </h2>
                    <p>
                        Generá la nómina del período y exportala a tu sistema de pagos.
                    </p>
                </div>
            </div>

            <div class="payroll-guided-layout">
                <nav class="payroll-guide-steps" aria-label="Pasos de nómina">
                    ${guideItems.map(([id, number, label, detail, mobileLabel], index) => `
                        <button type="button"
                                class="payroll-guide-step ${id === guideStep ? 'is-active' : ''} ${index < guideStepIndex ? 'is-complete' : ''}"
                                data-payroll-action="set-payroll-guide-step"
                                data-value="${id}"
                                aria-label="Paso ${number}: ${label}"
                                aria-current="${id === guideStep ? 'step' : 'false'}">
                            <span class="payroll-guide-step__number">${index < guideStepIndex ? icons.get('check', { size: 15 }) : number}</span>
                            <span class="payroll-guide-step__copy" data-mobile-label="${mobileLabel}">
                                <small>Paso ${number}</small>
                                <strong>${label}</strong>
                                <span>${detail}</span>
                            </span>
                        </button>
                    `).join('')}
                </nav>

                <main class="payroll-guide-content">
                    <section class="payroll-guide-panel payroll-guide-panel--period" ${guideStep === 'period' ? '' : 'hidden'}>
                        <div class="payroll-guide-panel__intro">
                            <h3>Período de pago</h3>
                            <p>Seleccioná el rango de fechas a liquidar.</p>
                        </div>
            
            <!-- Paso 1: Período -->
            <div style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step1') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div role="button" tabindex="0" data-payroll-action="toggle-step" data-value="step1" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step1') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        Paso 1: Período de Pago
                    </h3>
                    ${isStepCollapsed('step1') ? `<span style="font-size: 0.75rem; color: #64748b; font-weight: 600;">${formatDateShort(state.exportConfig.periodStart)} - ${formatDateShort(state.exportConfig.periodEnd)}</span>` : ''}
                </div>
                
                <div style="display: ${isStepCollapsed('step1') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px;">
                        <div class="form-group">
                            <label class="form-label">Desde:</label>
                            <input type="date" 
                                   value="${state.exportConfig.periodStart}" 
                                   onchange="PayrollUI.updateExportPeriod('start', this.value)"
                                   class="form-input">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Hasta:</label>
                            <input type="date" 
                                   value="${state.exportConfig.periodEnd}" 
                                   onchange="PayrollUI.updateExportPeriod('end', this.value)"
                                   class="form-input">
                        </div>
                    </div>
                
                <div class="payroll-period-presets" style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" class="payroll-period-preset" data-payroll-action="set-export-preset" data-value="thisMonth"
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'thisMonth' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'thisMonth' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'thisMonth' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        Este mes
                    </button>
                    <button type="button" class="payroll-period-preset" data-payroll-action="set-export-preset" data-value="lastMonth"
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'lastMonth' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'lastMonth' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'lastMonth' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        Mes anterior
                    </button>
                    <button type="button" class="payroll-period-preset" data-payroll-action="set-export-preset" data-value="payPeriod"
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'payPeriod' ? '#8b5cf6' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'payPeriod' ? '#8b5cf6' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'payPeriod' ? '#fff' : '#a78bfa'}; cursor: pointer; font-size: 0.75rem; font-weight: 700;">
                        ${icons.get('calendar', { size: 14 })} Período Actual
                    </button>
                </div>
                </div>
            </div>
                    </section>

                    <section class="payroll-guide-panel" ${guideStep === 'deductions' ? '' : 'hidden'}>
                        <div class="payroll-guide-panel__intro">
                            <h3>Deducciones</h3>
                            <p>Aplicá descuentos generales, individuales y préstamos activos.</p>
                        </div>
            
            ${renderDesktopAdjustmentWorkspace('deductions', state, exportData)}

            <!-- Interfaz móvil heredada: se mantiene hasta el rediseño móvil -->
            <div id="export-deductions-section" class="payroll-adjustment-legacy" style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step2') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div role="button" tabindex="0" data-payroll-action="toggle-step" data-value="step2" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step2') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        ${icons.get('payroll')} Paso 2: Deducciones Globales
                    </h3>
                    ${isStepCollapsed('step2') ? `<span style="font-size:0.75rem;color:#94a3b8;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%;">${deductionSummary}</span>` : ''}
                </div>
                
                <div style="display: ${isStepCollapsed('step2') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button type="button" data-payroll-action="add-export-deduction" 
                                style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; min-width: 44px; min-height: 44px; padding: 10px 16px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.transform='scale(1.05)'"
                                onmouseout="this.style.transform='scale(1)'">
                            +
                        </button>
                    </div>
                
                <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 16px;">
                    Estas deducciones se aplicarán a todos los empleados de forma encadenada
                </p>

                ${hasEmployeeDeductions ? `
                    <div style="margin-bottom: 16px; padding: 10px 12px; border: 1px solid ${employeeDeductionsAdded ? '#10b981' : '#ef4444'}; border-radius: 8px; background: ${employeeDeductionsAdded ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)'};">
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 8px; color: ${employeeDeductionsAdded ? '#86efac' : '#fecaca'}; font-size: 0.875rem;">
                                <span style="width: 8px; height: 8px; border-radius: 999px; background: ${employeeDeductionsAdded ? '#10b981' : '#ef4444'}; display: inline-block; ${employeeDeductionsAdded ? '' : 'animation: pulse 1.5s infinite;'}"></span>
                                <span>${employeeDeductionsAdded ? `${icons.get('check')} Descuentos individuales agregados` : `${icons.get('alert')} Hay ${employeesWithDeductions.length} empleados con descuentos programados`}</span>
                            </div>
                            <button type="button" data-payroll-action="add-employee-deductions-to-export"
                                    style="padding: 6px 12px; background: ${employeeDeductionsAdded ? '#10b981' : '#ef4444'}; border: none; border-radius: 6px; color: #fff; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                                ${employeeDeductionsAdded ? 'Actualizar lista' : 'Agregar a nómina'}
                            </button>
                        </div>
                    </div>
                ` : ''}

                <div style="margin-bottom: 16px; padding: 12px; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
                    <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px;">Cargo individual por empleado</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px;">
                        <select id="payroll-emp-deduction-employee" class="form-input">
                            <option value="">Seleccionar empleado</option>
                            ${employeeOptions}
                        </select>
                        <select id="payroll-emp-deduction-type" class="form-input">
                            <option value="fixed">Monto</option>
                            <option value="percentage">Porcentaje</option>
                        </select>
                        <input id="payroll-emp-deduction-value" type="number" inputmode="decimal" class="form-input" placeholder="0.00" min="0" step="0.01">
                        <input id="payroll-emp-deduction-name" type="text" class="form-input" placeholder="Nombre del cargo">
                        <button type="button" data-payroll-action="add-employee-deduction-from-form"
                                style="padding: 8px 12px; background: #06b6d4; border: none; border-radius: 6px; color: #000; font-weight: 700; cursor: pointer;">
                            Agregar cargo
                        </button>
                    </div>
                </div>
                
                ${generateExportDeductionsHTML()}
            </div>
            </div>
                    </section>

                    <section class="payroll-guide-panel" ${guideStep === 'bonuses' ? '' : 'hidden'}>
                        <div class="payroll-guide-panel__intro">
                            <h3>Bonificaciones</h3>
                            <p>Agregá bonos generales o individuales al período actual.</p>
                        </div>

            ${renderDesktopAdjustmentWorkspace('bonuses', state, exportData)}

            <!-- Interfaz móvil heredada: se mantiene hasta el rediseño móvil -->
            <div id="export-bonuses-section" class="payroll-adjustment-legacy" style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step2b') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div role="button" tabindex="0" data-payroll-action="toggle-step" data-value="step2b" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step2b') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        ${icons.get('star', { size: 18 })} Paso 2B: Bonificaciones Globales
                    </h3>
                    ${isStepCollapsed('step2b') ? `<span style="font-size:0.75rem;color:#10b981;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%;">${bonusSummary}</span>` : ''}
                </div>
                
                <div style="display: ${isStepCollapsed('step2b') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button type="button" data-payroll-action="add-export-bonus" 
                                style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; min-width: 44px; min-height: 44px; padding: 10px 16px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.transform='scale(1.05)'"
                                onmouseout="this.style.transform='scale(1)'">
                            +
                        </button>
                    </div>
                
                <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 16px;">
                    Estos bonos se sumarán a todos los empleados de forma general o por empleado
                </p>

                ${hasEmployeeBonuses ? `
                    <div style="margin-bottom: 16px; padding: 10px 12px; border: 1px solid ${employeeBonusesAdded ? '#10b981' : '#f59e0b'}; border-radius: 8px; background: ${employeeBonusesAdded ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)'};">
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 8px; color: ${employeeBonusesAdded ? '#86efac' : '#fcd34d'}; font-size: 0.875rem;">
                                <span style="width: 8px; height: 8px; border-radius: 999px; background: ${employeeBonusesAdded ? '#10b981' : '#f59e0b'}; display: inline-block; ${employeeBonusesAdded ? '' : 'animation: pulse 1.5s infinite;'}"></span>
                                <span>${employeeBonusesAdded ? `${icons.get('check')} Bonos individuales agregados` : `${icons.get('star', { size: 14 })} Hay ${employeesWithBonuses.length} empleados con bonos programados`}</span>
                            </div>
                            <button type="button" data-payroll-action="add-employee-bonuses-to-export"
                                    style="padding: 6px 12px; background: ${employeeBonusesAdded ? '#10b981' : '#f59e0b'}; border: none; border-radius: 6px; color: #fff; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                                ${employeeBonusesAdded ? 'Actualizar lista' : 'Agregar a nómina'}
                            </button>
                        </div>
                    </div>
                ` : ''}

                <div style="margin-bottom: 16px; padding: 12px; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
                    <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px;">Abonar bono individual por empleado</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px;">
                        <select id="payroll-emp-bonus-employee" class="form-input">
                            <option value="">Seleccionar empleado</option>
                            ${employeeOptions}
                        </select>
                        <select id="payroll-emp-bonus-type" class="form-input">
                            <option value="fixed">Monto</option>
                            <option value="percentage">Porcentaje</option>
                        </select>
                        <input id="payroll-emp-bonus-value" type="number" inputmode="decimal" class="form-input" placeholder="0.00" min="0" step="0.01">
                        <input id="payroll-emp-bonus-name" type="text" class="form-input" placeholder="Nombre del bono">
                        <button type="button" data-payroll-action="add-employee-bonus-from-form"
                                style="padding: 8px 12px; background: #10b981; border: none; border-radius: 6px; color: #fff; font-weight: 700; cursor: pointer;">
                            Agregar bono
                        </button>
                    </div>
                </div>
                
                ${generateExportBonusesHTML()}
            </div>
            </div>
                    </section>

                    <section class="payroll-guide-panel payroll-guide-panel--loans" ${guideStep === 'loans' ? '' : 'hidden'}>
                        <div class="payroll-guide-panel__intro">
                            <h3>Préstamos del período</h3>
                            <p>Esta selección es temporal y no registra abonos en las cuentas por cobrar.</p>
                        </div>

                        ${renderPayrollLoansDesktop({
                            employees: filteredPayrollEmployees,
                            selection: state.exportConfig.payrollLoanSelection || [],
                            payrollRows: exportData,
                            expandedEmployeeIds: state.exportConfig.payrollLoanExpandedEmployees || [],
                            periodEnd: state.exportConfig.periodEnd
                        })}
                    </section>

                    <section class="payroll-guide-panel payroll-guide-panel--review" ${guideStep === 'review' ? '' : 'hidden'}>
                        <div class="payroll-guide-panel__intro">
                            <h3>Vista previa · ${exportData.length} empleados</h3>
                            <p>Revisá los montos antes de exportar.</p>
                        </div>

            <!-- Paso 3: Vista Previa -->
            <div style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step3') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid ${hasInvalidLoanRows ? '#ef4444' : '#334155'}; transition: all 0.2s;">
                <div role="button" tabindex="0" aria-expanded="${!isStepCollapsed('step3')}" data-payroll-action="toggle-step" data-value="step3" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step3') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        Paso 3: Vista Previa (${exportData.length} empleados)
                    </h3>
                    ${isStepCollapsed('step3') ? `<span style="font-size: 1rem; color: ${hasInvalidLoanRows ? '#f87171' : '#10b981'}; font-weight: 700;">${hasInvalidLoanRows ? `⚠️ ${invalidLoanRows.length} pago(s) inválido(s)` : formatCurrency(totalAmount)}</span>` : ''}
                </div>
                
                <div style="display: ${isStepCollapsed('step3') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                    <div style="display: flex; gap: 8px; align-items: center; max-width: 60%;">
                        <span style="font-size: 0.75rem; color: #94a3b8; margin-right: 4px;">Líder:</span>
                        <select onchange="PayrollUI.setLeaderFilter(this.value)" class="form-input" style="padding: 6px 12px; font-size: 0.875rem; border-color: #334155; background: #0f172a; color: #f1f5f9; border-radius: 6px; cursor: pointer; outline: none;">
                            <option value="all" ${leaderFilter === 'all' ? 'selected' : ''}>Todos</option>
                            ${leaders.map(ldr => `
                                <option value="${ldr.id}" ${leaderFilter === ldr.id ? 'selected' : ''}>${ldr.name}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                ${hasInvalidLoanRows ? `
                    <div role="alert" style="margin-bottom: 14px; padding: 12px; border: 1px solid #ef4444; border-radius: 8px; background: rgba(239, 68, 68, 0.1); color: #fca5a5; font-weight: 700; font-size: 0.85rem;">
                        ⚠️ Hay ${invalidLoanRows.length} empleado(s) cuyo descuento de préstamos deja el pago en cero o negativo. Elimina sus préstamos temporales para habilitar la exportación.
                    </div>
                ` : ''}

                <div class="responsive-table-wrapper" role="region" aria-label="Tabla de nómina" tabindex="0">
                    <table class="payroll-review-table">
                        <thead>
                            <tr>
                                <th class="payroll-review-table__number">#</th>
                                <th class="payroll-review-table__employee">EMPLEADO</th>
                                <th>BRUTO</th>
                                ${showBonusColumn ? '<th class="is-bonus">BONIFIC.</th>' : ''}
                                ${showDeductionColumn ? '<th class="is-deduction">DEDUCCIONES</th>' : ''}
                                ${showLoanColumn ? '<th class="is-loan">PRÉSTAMOS</th>' : ''}
                                <th>NETO</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${exportData.map((emp, idx) => `
                                <tr class="payroll-review-table__row ${idx % 2 === 0 ? 'is-even' : ''} ${emp._invalidLoanNet ? 'is-invalid' : ''}">
                                    <td class="payroll-review-table__number">${escapeHTML(String(emp._number || emp.id))}</td>
                                    <td class="payroll-review-table__employee">
                                        ${escapeHTML(emp._employeeName)}
                                        ${emp._invalidLoanNet ? '<span>Pago inválido: elimina préstamos</span>' : ''}
                                    </td>
                                    <td class="payroll-review-table__amount">${formatCurrency(emp._brutoOriginal)}</td>
                                    ${showBonusColumn ? `<td class="payroll-review-table__amount is-bonus">+${formatCurrency(emp._bonuses)}</td>` : ''}
                                    ${showDeductionColumn ? `<td class="payroll-review-table__amount is-deduction">−${formatCurrency(emp._deductions)}</td>` : ''}
                                    ${showLoanColumn ? `<td class="payroll-review-table__amount ${isVisibleReviewAmount(emp._loans) ? 'is-loan' : 'is-empty'}">${isVisibleReviewAmount(emp._loans) ? `−${formatCurrency(emp._loans)}` : '—'}</td>` : ''}
                                    <td class="payroll-review-table__amount is-net ${emp._invalidLoanNet ? 'is-invalid' : ''}">${formatCurrency(emp.monto)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="2">Totales</td>
                                <td class="payroll-review-table__amount">${formatCurrency(grossAmount)}</td>
                                ${showBonusColumn ? `<td class="payroll-review-table__amount is-bonus">+${formatCurrency(bonusAmount)}</td>` : ''}
                                ${showDeductionColumn ? `<td class="payroll-review-table__amount is-deduction">−${formatCurrency(deductionAmount)}</td>` : ''}
                                ${showLoanColumn ? `<td class="payroll-review-table__amount is-loan">−${formatCurrency(loanAmount)}</td>` : ''}
                                <td class="payroll-review-table__amount is-net">${formatCurrency(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                ${renderPayrollClosurePanel({
                    gate: payrollClosureGate,
                    now: Date.now()
                })}
            </div>
            </div>
            
                    </section>

                    <div class="payroll-guide-navigation">
                        <button type="button"
                                class="payroll-guide-navigation__back"
                                data-payroll-action="set-payroll-guide-step"
                                data-value="${previousGuideStep}"
                                ${guideStep === 'period' ? 'disabled aria-disabled="true"' : ''}>
                            Atrás
                        </button>
                        ${guideStep !== 'review' ? `
                            <button type="button"
                                    class="payroll-guide-navigation__next"
                                    data-payroll-action="set-payroll-guide-step"
                                    data-value="${nextGuideStep}">
                                Continuar <span aria-hidden="true">→</span>
                            </button>
                        ` : '<span class="payroll-guide-navigation__ready">Listo para exportar →</span>'}
                    </div>
                </main>

                <aside class="payroll-guide-summary ${mobileSummaryExpanded ? 'is-mobile-expanded' : ''}" aria-label="Resumen de nómina">
                    <button type="button"
                            class="payroll-guide-summary__mobile-toggle"
                            data-payroll-action="toggle-payroll-mobile-summary"
                            aria-expanded="${mobileSummaryExpanded}"
                            aria-label="${mobileSummaryExpanded ? 'Ocultar' : 'Mostrar'} resumen completo de nómina">
                        <span class="payroll-guide-summary__mobile-meta">
                            <strong>${formatDateShort(state.exportConfig.periodStart)} – ${formatDateShort(state.exportConfig.periodEnd)}</strong>
                            <small>${exportData.length} empleados</small>
                        </span>
                        <span class="payroll-guide-summary__mobile-total">
                            <small>Total neto</small>
                            <strong>${formatCurrency(totalAmount)}</strong>
                        </span>
                        <span class="payroll-guide-summary__mobile-state ${hasInvalidLoanRows ? 'is-invalid' : 'is-valid'}">
                            <i aria-hidden="true"></i>
                            ${hasInvalidLoanRows ? 'Revisar' : 'Listo'}
                        </span>
                        <span class="payroll-guide-summary__mobile-label">
                            ${mobileSummaryExpanded ? 'Ocultar' : 'Resumen'}
                            ${icons.get(mobileSummaryExpanded ? 'chevron-up' : 'chevron-down', { size: 15 })}
                        </span>
                    </button>
                    <div class="payroll-guide-summary__details">
                        <div class="payroll-guide-summary__header">
                            <span>Resumen de nómina</span>
                            <strong>${formatDateShort(state.exportConfig.periodStart)} – ${formatDateShort(state.exportConfig.periodEnd)}</strong>
                        </div>
                        <dl class="payroll-guide-summary__values">
                        <div class="payroll-guide-summary__employee-count"><dt>Empleados</dt><dd>${exportData.length}</dd></div>
                        <div><dt>Salario bruto</dt><dd>${formatCurrency(grossAmount)}</dd></div>
                        <div class="payroll-guide-summary__expandable">
                            <dt>
                                <button type="button"
                                        class="payroll-guide-summary__toggle"
                                        data-payroll-action="toggle-payroll-summary-detail"
                                        data-value="bonuses"
                                        aria-expanded="${Boolean(expandedSummary.bonuses)}"
                                        aria-label="${expandedSummary.bonuses ? 'Ocultar' : 'Mostrar'} detalle de bonificaciones">
                                    <span>Bonificaciones</span>
                                    ${icons.get(expandedSummary.bonuses ? 'chevron-up' : 'chevron-down', { size: 13 })}
                                </button>
                            </dt>
                            <dd class="${getSummaryAmountClass(bonusAmount, 'is-positive')}">+${formatCurrency(bonusAmount)}</dd>
                        </div>
                        ${expandedSummary.bonuses ? renderAdjustmentSummaryDetails(bonusDetails, 'bonuses') : ''}
                        <div class="payroll-guide-summary__expandable">
                            <dt>
                                <button type="button"
                                        class="payroll-guide-summary__toggle"
                                        data-payroll-action="toggle-payroll-summary-detail"
                                        data-value="deductions"
                                        aria-expanded="${Boolean(expandedSummary.deductions)}"
                                        aria-label="${expandedSummary.deductions ? 'Ocultar' : 'Mostrar'} detalle de deducciones">
                                    <span>Deducciones</span>
                                    ${icons.get(expandedSummary.deductions ? 'chevron-up' : 'chevron-down', { size: 13 })}
                                </button>
                            </dt>
                            <dd class="${getSummaryAmountClass(deductionAmount, 'is-negative')}">−${formatCurrency(deductionAmount)}</dd>
                        </div>
                        ${expandedSummary.deductions ? renderAdjustmentSummaryDetails(deductionDetails, 'deductions') : ''}
                        <div class="payroll-guide-summary__loan-row">
                            <dt>Préstamos</dt>
                            <span class="${getSummaryAmountClass(loanSummary.selectedInterest, 'is-loan')}">Interés ${formatCurrency(loanSummary.selectedInterest)}</span>
                            <dd class="${getSummaryAmountClass(loanAmount, 'is-loan')}">−${formatCurrency(loanAmount)}</dd>
                        </div>
                        <div class="is-total"><dt>Total neto</dt><dd>${formatCurrency(totalAmount)}</dd></div>
                        </dl>
                        <div class="payroll-guide-summary__validation ${hasInvalidLoanRows ? 'is-invalid' : 'is-valid'}">
                        ${hasInvalidLoanRows
                            ? `${icons.get('alert', { size: 16 })} ${invalidLoanRows.length} pago(s) requieren revisión`
                            : `${icons.get('check', { size: 16 })} Cálculo listo para continuar`}
                        </div>
                        <div class="payroll-guide-summary__actions ${guideStep === 'review' ? '' : 'is-mobile-deferred'}">
                        <button type="button"
                                data-payroll-action="copy-export-json"
                                ${hasInvalidLoanRows ? 'disabled aria-disabled="true"' : ''}>
                            ${icons.get('copy', { size: 15 })} Copiar JSON
                        </button>
                        <button type="button"
                                data-payroll-action="download-export-json"
                                ${hasInvalidLoanRows ? 'disabled aria-disabled="true"' : ''}>
                            ${icons.get('download', { size: 15 })} Descargar .json
                        </button>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    `;
}

function renderAdjustmentSummaryDetails(summary, kind) {
    const isBonus = kind === 'bonuses';
    const amountClass = isBonus ? 'is-positive' : 'is-negative';
    const individualLabel = isBonus ? 'Bonificaciones individuales' : 'Deducciones individuales';
    const totalLabel = isBonus ? 'Total bonificaciones' : 'Total deducciones';
    const globalRows = summary.globals.map(item => {
        const basis = item.type === 'percentage'
            ? `${item.value}%`
            : formatCurrency(item.value);
        return `
            <div class="payroll-summary-detail__row">
                <span>
                    <strong>${escapeHTML(item.label)}</strong>
                    <small>${basis}</small>
                </span>
                <b class="${getSummaryAmountClass(item.amount, amountClass)}">${formatCurrency(item.amount)}</b>
            </div>
        `;
    }).join('');
    const individualRow = summary.individualCount > 0
        ? `
            <div class="payroll-summary-detail__row">
                <span>
                    <strong>${individualLabel}</strong>
                    <small>${summary.individualCount} ajuste(s) agrupado(s)</small>
                </span>
                <b class="${getSummaryAmountClass(summary.individualAmount, amountClass)}">${formatCurrency(summary.individualAmount)}</b>
            </div>
        `
        : '';

    return `
        <div class="payroll-summary-detail payroll-summary-detail--${kind}">
            ${globalRows || individualRow ? `${globalRows}${individualRow}` : '<p>No hay ajustes incluidos.</p>'}
            <div class="payroll-summary-detail__total">
                <span>${totalLabel}</span>
                <strong class="${getSummaryAmountClass(summary.totalAmount, amountClass)}">${formatCurrency(summary.totalAmount)}</strong>
            </div>
        </div>
    `;
}

function generateExportData() {
    const state = getState();
    const { periodStart, periodEnd, deductions } = state.exportConfig;
    if (!periodStart || !periodEnd) return [];

    const filteredEmployees = getLeaderFilteredEmployees(state);

    const baseRows = filteredEmployees.map(emp => {
        // PayrollService resuelve el alcance contra el desglose real del período.
        // Pasar la colección completa evita decidir aquí con posiciones actuales
        // y perder trabajo histórico o multiposición.
        // Loans are applied once, below, from the temporary selection.
        const payroll = calculatePayrollBeforeLoans(
            payrollService,
            emp.id,
            periodStart,
            periodEnd,
            deductions || [],
            state.exportConfig.bonuses || []
        );
        
        const organization = buildPayrollHistoricalOrganization({
            employee: emp,
            breakdown: payroll.breakdown || [],
            positions: state.positions,
            leaders: state.leaders
        });
            
        return {
            id: parseInt(emp.number) || 0,
            nombre: `${emp.name} (Ref #${emp.number})`,
            monto: payroll.neto, // <--- PRECISIÓN TOTAL: No redondear aquí (Permitir estilo Excel)
            _brutoOriginal: payroll.brutoOriginal,
            _bruto: payroll.bruto,
            _bonuses: payroll.bonuses,
            _deductions: payroll.deductions,
            _bonusDetails: payroll.bonusBreakdown || [],
            _deductionDetails: payroll.deductionBreakdown || [],
            _positionBreakdown: payroll.breakdown || [],
            _employeeId: emp.id,
            _employeeName: emp.name,
            _employeePosition: organization.positionName,
            _leaderRefs: organization.leaderRefs,
            _number: emp.number
        };
    });

    return applyPayrollLoanDeductions(
        baseRows,
        state.employees,
        state.exportConfig.payrollLoanSelection || [],
        periodEnd
    )
        // Keep selected-loan rows even when their resulting payment is invalid,
        // so the UI can show the error instead of silently omitting the employee.
        .filter(emp => emp._montoBeforeLoans > 0.001 || emp._loans > 0)
        .sort((a, b) => String(a._number || a.id).localeCompare(String(b._number || b.id), 'es', { numeric: true }));
}

function adjustmentKindLabel(kind) {
    return kind === 'bonuses' ? 'bonificación' : 'deducción';
}

function buildDesktopAdjustment(kind, draft, current = {}) {
    const state = getState();
    const prefix = kind === 'bonuses' ? 'BON' : 'DED';
    const defaultName = kind === 'bonuses' ? 'Bono' : 'Descuento';
    const item = {
        id: current.id || `${prefix}-${Date.now()}-${state.exportConfig[kind]?.length || 0}`,
        name: draft.name || defaultName,
        type: draft.type,
        value: draft.value,
        scope: draft.scope,
        targetId: draft.scope === 'global' ? null : String(draft.targetId),
        remembered: draft.scope !== 'employee' && draft.remembered,
        source: current.source || 'manual'
    };

    if (draft.scope === 'employee') {
        const employee = (state.employees || []).find(
            entry => String(entry.id) === String(draft.targetId)
        );
        item.employeeId = draft.targetId;
        item.employeeName = employee?.name || '';
    }

    return item;
}

function validateDesktopAdjustment(draft) {
    if (!draft) return 'No se pudo leer el ajuste.';
    if (!Number.isFinite(draft.value) || draft.value <= 0) {
        return 'El valor debe ser mayor que cero.';
    }
    if (draft.scope !== 'global' && !draft.targetId) {
        return 'Seleccioná el destino del ajuste.';
    }
    return null;
}

function persistAdjustmentDefault(kind, previous, next) {
    const state = getState();
    stateManager.batchSetState(() => {
        let defaults = state.settings;
        if (previous?.id && resolveAdjustmentScope(previous).scope !== 'employee') {
            state.settings.payrollDefaults = updateRememberedDefault(defaults, kind, previous, false);
            defaults = state.settings;
        }
        if (next?.remembered && resolveAdjustmentScope(next).scope !== 'employee') {
            state.settings.payrollDefaults = updateRememberedDefault(defaults, kind, next, true);
        }
    });
    context.saveToLocalStorage({ immediate: true, announce: false });
}

export function addDesktopAdjustment(kind, target) {
    if (!['deductions', 'bonuses'].includes(kind)) return;
    const form = target?.closest('.payroll-adjustment-form');
    const draft = readAdjustmentForm(form);
    const validationError = validateDesktopAdjustment(draft);
    if (validationError) {
        window.showNotification?.(validationError, 'error');
        return;
    }

    const state = getState();
    const item = buildDesktopAdjustment(kind, draft);
    stateManager.batchSetState(() => {
        if (!state.exportConfig[kind]) state.exportConfig[kind] = [];
        state.exportConfig[kind].push(item);
    });
    if (item.remembered) persistAdjustmentDefault(kind, null, item);
    window.showNotification?.(`${adjustmentKindLabel(kind)} agregada.`, 'success');
    context.render();
}

export function updateDesktopAdjustment(kind, target) {
    if (!['deductions', 'bonuses'].includes(kind)) return;
    const index = Number(target?.dataset.index);
    const state = getState();
    const previous = state.exportConfig[kind]?.[index];
    if (!previous) return;

    const form = target.closest('.payroll-adjustment-form');
    const draft = readAdjustmentForm(form);
    const validationError = validateDesktopAdjustment(draft);
    if (validationError) {
        window.showNotification?.(validationError, 'error');
        return;
    }

    const next = buildDesktopAdjustment(kind, draft, previous);
    stateManager.batchSetState(() => {
        state.exportConfig[kind][index] = next;
    });
    if (previous.remembered || next.remembered) {
        persistAdjustmentDefault(kind, previous, next);
    }
    window.showNotification?.(`${adjustmentKindLabel(kind)} actualizada.`, 'success');
    context.render();
}

export function removeDesktopAdjustment(kind, target) {
    if (!['deductions', 'bonuses'].includes(kind)) return;
    const index = Number(target?.dataset.index);
    const state = getState();
    const item = state.exportConfig[kind]?.[index];
    if (!item) return;

    stateManager.batchSetState(() => {
        state.exportConfig[kind].splice(index, 1);
    });
    if (item.remembered || resolveAdjustmentScope(item).scope !== 'employee') {
        persistAdjustmentDefault(kind, item, null);
    }
    window.showNotification?.(`${adjustmentKindLabel(kind)} eliminada.`, 'success');
    context.render();
}

function generateExportDeductionsHTML() {
    const state = getState();
    const deductions = state.exportConfig.deductions || [];
    if (deductions.length === 0) return '<div style="text-align: center; color: #64748b; padding: 20px;">No hay deducciones configuradas</div>';

    // 🛡️ REFACTOR INDUSTRIAL: Preservar índices originales antes de filtrar
    // El sistema de Proxy de AppState genera nuevas instancias en cada acceso,
    // por lo que indexOf(ded) fallaría devolviendo -1.
    const mappedDeductions = deductions.map((ded, originalIndex) => ({ 
        data: ded, 
        index: originalIndex 
    }));

    const globalDeductions = mappedDeductions.filter(item => !item.data.employeeId);
    const employeeDeductions = mappedDeductions.filter(item => item.data.employeeId);

    const groupedByEmployee = employeeDeductions.reduce((acc, item) => {
        const key = item.data.employeeId || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    const renderDeductionRow = (item, allItems) => {
        const ded = item.data;
        const index = item.index;
        return `
        <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 12px;">
            <div style="display: flex; gap: 12px; align-items: start;">
                <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportDeductionType_${index}" value="fixed" ${ded.type === 'fixed' ? 'checked' : ''} onchange="PayrollUI.updateExportDeductionType(${index}, 'fixed')" style="accent-color: #06b6d4;">
                        <span style="color: #f1f5f9;">Monto</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportDeductionType_${index}" value="percentage" ${ded.type === 'percentage' ? 'checked' : ''} onchange="PayrollUI.updateExportDeductionType(${index}, 'percentage')" style="accent-color: #06b6d4;">
                        <span style="color: #f1f5f9;">Porcentaje%</span>
                    </label>
                </div>
                <div style="flex: 1;">
                    <input type="number" inputmode="decimal" class="form-input" 
                        value="${ded.value || 0}" 
                        oninput="PayrollUI.updateExportDeductionValue(${index}, this.value)" 
                        placeholder="0.00" min="0" step="${ded.type === 'fixed' ? '0.01' : '0.1'}" 
                        style="width: 100%; font-size: 0.875rem; padding: 8px; margin-bottom: 8px;">
                    <input type="text" class="form-input" 
                        value="${ded.name || ''}" 
                        oninput="PayrollUI.updateExportDeductionName(${index}, this.value)" 
                        placeholder="Nombre (ej: AFP, SFS...)" 
                        style="width: 100%; font-size: 0.75rem; padding: 6px;">
                    ${ded.employeeId ? `<div style="font-size: 0.7rem; color: #94a3b8; margin-top: 6px;">Empleado: ${ded.employeeName || (state.employees.find(e => e.id === ded.employeeId)?.name || 'N/A')}</div>` : ''}
                    ${!ded.employeeId ? `<label style="display: flex; align-items: center; gap: 6px; margin-top: 8px; cursor: pointer; font-size: 0.75rem; color: #cbd5e1;">
                        <input type="checkbox" data-payroll-action="toggle-remember-adjustment" data-kind="deductions" data-id="${index}" ${ded.remembered ? 'checked' : ''} style="accent-color: #06b6d4;">
                        Recordar
                    </label>` : ''}
                </div>
                ${allItems.length > 0 ? `<button type="button" data-payroll-action="remove-export-deduction" data-value="${index}" aria-label="Eliminar deducción" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">${icons.get('delete')}</button>` : ''}
            </div>
        </div>
    `;
    };

    const globalHTML = globalDeductions.length > 0
        ? `<div style="margin-bottom: 12px; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">${icons.get('info')} Deducciones generales</div>
           ${globalDeductions.map(item => renderDeductionRow(item, globalDeductions)).join('')}`
        : '';

    const employeeHTML = Object.entries(groupedByEmployee).map(([id, items]) => `
        <div style="margin-top: 16px; margin-bottom: 12px; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">
            ${icons.get('personnel')} ${items[0].data.employeeName || (state.employees.find(e => e.id === id)?.name || 'Empleado')}
        </div>
        ${items.map(item => renderDeductionRow(item, items)).join('')}
    `).join('');

    return `${globalHTML}${employeeHTML}`;
}

export function addExportDeduction() {
    const state = getState();
    if (!state.exportConfig.deductions) state.exportConfig.deductions = [];
    state.exportConfig.deductions.push({ type: 'percentage', value: 0, name: '' });
    context.render();
}

export function removeExportDeduction(index) {
    const state = getState();
    const item = state.exportConfig.deductions?.[index];
    if (item && !item.employeeId && item.id) {
        stateManager.batchSetState(() => {
            state.settings.payrollDefaults = updateRememberedDefault(state.settings, 'deductions', item, false);
        });
        context.saveToLocalStorage({ immediate: true, announce: false });
    }
    state.exportConfig.deductions.splice(index, 1);
    context.render();
}

function syncRememberedAdjustment(kind, item, immediate = false) {
    if (!item || item.employeeId || !item.remembered) return;
    const state = getState();
    stateManager.batchSetState(() => {
        state.settings.payrollDefaults = updateRememberedDefault(state.settings, kind, item, true);
    });
    context.saveToLocalStorage(immediate ? { immediate: true, announce: false } : undefined);
}

export function toggleRememberGlobalAdjustment(kind, index, checked) {
    if (!['deductions', 'bonuses'].includes(kind)) return;
    const state = getState();
    const item = state.exportConfig[kind]?.[index];
    if (!item || item.employeeId) return;
    if (checked && !item.id) item.id = `${kind === 'deductions' ? 'DED' : 'BON'}-${Date.now()}-${index}`;
    item.remembered = Boolean(checked);
    stateManager.batchSetState(() => {
        state.settings.payrollDefaults = updateRememberedDefault(state.settings, kind, item, checked);
    });
    context.saveToLocalStorage({ immediate: true, announce: false });
    context.render();
}

export function updateExportDeductionType(index, type) {
    const state = getState();
    const deductions = state.exportConfig.deductions;
    if (deductions && deductions[index]) {
        deductions[index].type = type;
        syncRememberedAdjustment('deductions', deductions[index]);
        context.render();
    }
}

export function updateExportDeductionValue(index, value) {
    const state = getState();
    const deductions = state.exportConfig.deductions;
    if (deductions && deductions[index]) {
        // Guardar el número directamente en el estado
        deductions[index].value = parseFloat(value) || 0;
        syncRememberedAdjustment('deductions', deductions[index]);
        
        // No llamamos a render aquí para evitar perder el foco mientras se escribe (oninput)
        // El proxy de AppState se encargará de cualquier efecto secundario si es necesario, 
        // pero preferimos re-renderizar solo cuando el usuario termine o cambie de sección.
        // ACTUALIZACIÓN: Para ver los cambios en la tabla de vista previa, necesitamos un render debounced.
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function updateExportDeductionName(index, value) {
    const state = getState();
    const deductions = state.exportConfig.deductions;
    if (deductions && deductions[index]) {
        deductions[index].name = value;
        syncRememberedAdjustment('deductions', deductions[index]);
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function addEmployeeDeductionsToExport() {
    const state = getState();
    if (!state.exportConfig.deductions) state.exportConfig.deductions = [];

    const employeesWithDeductions = getEmployeesWithDeductions();
    const existingKeys = new Set(
        state.exportConfig.deductions
            .filter(d => d.employeeId)
            .map(d => `${d.employeeId}:${d.type}:${d.value}:${d.name || ''}`)
    );

    employeesWithDeductions.forEach(emp => {
        (emp.deductions || []).forEach(ded => {
            const newDed = {
                id: ded.id || `DED-${Date.now()}`,
                type: ded.type,
                value: ded.value,
                name: ded.name || `Deducción ${emp.name}`,
                employeeId: emp.id,
                employeeName: emp.name,
                source: 'employee'
            };
            const key = `${newDed.employeeId}:${newDed.type}:${newDed.value}:${newDed.name || ''}`;
            if (!existingKeys.has(key)) {
                state.exportConfig.deductions.push(newDed);
                existingKeys.add(key);
            }
        });
    });

    state.exportConfig.employeeDeductionsAdded = true;
    if (window.showNotification) window.showNotification('✅ Deducciones individuales agregadas', 'success');
    context.render();
}

export function addEmployeeDeductionFromForm() {
    const state = getState();
    const employeeId = document.getElementById('payroll-emp-deduction-employee')?.value;
    const type = document.getElementById('payroll-emp-deduction-type')?.value || 'fixed';
    const value = parseFloat(document.getElementById('payroll-emp-deduction-value')?.value) || 0;
    const name = document.getElementById('payroll-emp-deduction-name')?.value?.trim() || 'Cargo individual';

    if (!employeeId) {
        if (window.showNotification) window.showNotification('❌ Selecciona un empleado', 'error');
        return;
    }
    if (value <= 0) {
        if (window.showNotification) window.showNotification('❌ El valor debe ser mayor a 0', 'error');
        return;
    }

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    if (!state.exportConfig.deductions) state.exportConfig.deductions = [];
    state.exportConfig.deductions.push({
        id: `DED-${Date.now()}`,
        type,
        value,
        name,
        employeeId: emp.id,
        employeeName: emp.name,
        source: 'manual'
    });

    if (window.showNotification) window.showNotification('✅ Cargo individual agregado', 'success');
    context.render();
}

// ---------------------- BONIFICACIONES GLOBALES E INDIVIDUALES ----------------------

function generateExportBonusesHTML() {
    const state = getState();
    const bonuses = state.exportConfig.bonuses || [];
    if (bonuses.length === 0) return '<div style="text-align: center; color: #64748b; padding: 20px;">No hay bonificaciones configuradas</div>';

    const mappedBonuses = bonuses.map((bon, originalIndex) => ({ 
        data: bon, 
        index: originalIndex 
    }));

    const globalBonuses = mappedBonuses.filter(item => !item.data.employeeId);
    const employeeBonuses = mappedBonuses.filter(item => item.data.employeeId);

    const groupedByEmployee = employeeBonuses.reduce((acc, item) => {
        const key = item.data.employeeId || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    const renderBonusRow = (item, allItems) => {
        const bon = item.data;
        const index = item.index;
        return `
        <div style="background: rgba(16, 185, 129, 0.05); padding: 12px; border-radius: 8px; border: 1px solid #10b981; margin-bottom: 12px;">
            <div style="display: flex; gap: 12px; align-items: start;">
                <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportBonusType_${index}" value="fixed" ${bon.type === 'fixed' ? 'checked' : ''} onchange="PayrollUI.updateExportBonusType(${index}, 'fixed')" style="accent-color: #10b981;">
                        <span style="color: #f1f5f9;">Monto</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportBonusType_${index}" value="percentage" ${bon.type === 'percentage' ? 'checked' : ''} onchange="PayrollUI.updateExportBonusType(${index}, 'percentage')" style="accent-color: #10b981;">
                        <span style="color: #f1f5f9;">Porcentaje%</span>
                    </label>
                </div>
                <div style="flex: 1;">
                    <input type="number" inputmode="decimal" class="form-input" 
                        value="${bon.value || 0}" 
                        oninput="PayrollUI.updateExportBonusValue(${index}, this.value)" 
                        placeholder="0.00" min="0" step="${bon.type === 'fixed' ? '0.01' : '0.1'}" 
                        style="width: 100%; font-size: 0.875rem; padding: 8px; margin-bottom: 8px; border-color: rgba(16, 185, 129, 0.3);">
                    <input type="text" class="form-input" 
                        value="${bon.name || ''}" 
                        oninput="PayrollUI.updateExportBonusName(${index}, this.value)" 
                        placeholder="Nombre (ej: Bono mensual...)" 
                        style="width: 100%; font-size: 0.75rem; padding: 6px; border-color: rgba(16, 185, 129, 0.3);">
                    ${bon.employeeId ? `<div style="font-size: 0.7rem; color: #10b981; margin-top: 6px;">Empleado: ${bon.employeeName || (state.employees.find(e => e.id === bon.employeeId)?.name || 'N/A')}</div>` : ''}
                    ${!bon.employeeId ? `<label style="display: flex; align-items: center; gap: 6px; margin-top: 8px; cursor: pointer; font-size: 0.75rem; color: #cbd5e1;">
                        <input type="checkbox" data-payroll-action="toggle-remember-adjustment" data-kind="bonuses" data-id="${index}" ${bon.remembered ? 'checked' : ''} style="accent-color: #10b981;">
                        Recordar
                    </label>` : ''}
                </div>
                ${allItems.length > 0 ? `<button type="button" data-payroll-action="remove-export-bonus" data-value="${index}" aria-label="Eliminar bono" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">${icons.get('delete')}</button>` : ''}
            </div>
        </div>
    `;
    };

    const globalHTML = globalBonuses.length > 0
        ? `<div style="margin-bottom: 12px; color: #10b981; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 6px;">${icons.get('star', { size: 12 })} Bonos generales</div>
           ${globalBonuses.map(item => renderBonusRow(item, globalBonuses)).join('')}`
        : '';

    const employeeHTML = Object.entries(groupedByEmployee).map(([id, items]) => `
        <div style="margin-top: 16px; margin-bottom: 12px; color: #10b981; font-size: 0.75rem; font-weight: 700;">
            ${icons.get('personnel')} ${items[0].data.employeeName || (state.employees.find(e => e.id === id)?.name || 'Empleado')}
        </div>
        ${items.map(item => renderBonusRow(item, items)).join('')}
    `).join('');

    return `${globalHTML}${employeeHTML}`;
}

export function addExportBonus() {
    const state = getState();
    if (!state.exportConfig.bonuses) state.exportConfig.bonuses = [];
    state.exportConfig.bonuses.push({ type: 'fixed', value: 0, name: '' });
    context.render();
}

export function removeExportBonus(index) {
    const state = getState();
    const item = state.exportConfig.bonuses?.[index];
    if (item && !item.employeeId && item.id) {
        stateManager.batchSetState(() => {
            state.settings.payrollDefaults = updateRememberedDefault(state.settings, 'bonuses', item, false);
        });
        context.saveToLocalStorage({ immediate: true, announce: false });
    }
    state.exportConfig.bonuses.splice(index, 1);
    context.render();
}

export function updateExportBonusType(index, type) {
    const state = getState();
    const bonuses = state.exportConfig.bonuses;
    if (bonuses && bonuses[index]) {
        bonuses[index].type = type;
        syncRememberedAdjustment('bonuses', bonuses[index]);
        context.render();
    }
}

export function updateExportBonusValue(index, value) {
    const state = getState();
    const bonuses = state.exportConfig.bonuses;
    if (bonuses && bonuses[index]) {
        bonuses[index].value = parseFloat(value) || 0;
        syncRememberedAdjustment('bonuses', bonuses[index]);
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function updateExportBonusName(index, value) {
    const state = getState();
    const bonuses = state.exportConfig.bonuses;
    if (bonuses && bonuses[index]) {
        bonuses[index].name = value;
        syncRememberedAdjustment('bonuses', bonuses[index]);
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function addEmployeeBonusesToExport() {
    const state = getState();
    if (!state.exportConfig.bonuses) state.exportConfig.bonuses = [];

    const employeesWithBonuses = getEmployeesWithBonuses();
    const existingKeys = new Set(
        state.exportConfig.bonuses
            .filter(b => b.employeeId)
            .map(b => `${b.employeeId}:${b.type}:${b.value}:${b.name || ''}`)
    );

    employeesWithBonuses.forEach(emp => {
        (emp.bonuses || []).forEach(bon => {
            const newBon = {
                id: bon.id || `BON-${Date.now()}`,
                type: bon.type,
                value: bon.value,
                name: bon.name || `Bono ${emp.name}`,
                employeeId: emp.id,
                employeeName: emp.name,
                source: 'employee'
            };
            const key = `${newBon.employeeId}:${newBon.type}:${newBon.value}:${newBon.name || ''}`;
            if (!existingKeys.has(key)) {
                state.exportConfig.bonuses.push(newBon);
                existingKeys.add(key);
            }
        });
    });

    state.exportConfig.employeeBonusesAdded = true;
    if (window.showNotification) window.showNotification('✅ Bonos individuales agregados', 'success');
    context.render();
}

export function addEmployeeBonusFromForm() {
    const state = getState();
    const employeeId = document.getElementById('payroll-emp-bonus-employee')?.value;
    const type = document.getElementById('payroll-emp-bonus-type')?.value || 'fixed';
    const value = parseFloat(document.getElementById('payroll-emp-bonus-value')?.value) || 0;
    const name = document.getElementById('payroll-emp-bonus-name')?.value?.trim() || 'Abono individual';

    if (!employeeId) {
        if (window.showNotification) window.showNotification('❌ Selecciona un empleado', 'error');
        return;
    }
    if (value <= 0) {
        if (window.showNotification) window.showNotification('❌ El valor debe ser mayor a 0', 'error');
        return;
    }

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    if (!state.exportConfig.bonuses) state.exportConfig.bonuses = [];
    state.exportConfig.bonuses.push({
        id: `BON-${Date.now()}`,
        type,
        value,
        name,
        employeeId: emp.id,
        employeeName: emp.name,
        source: 'manual'
    });

    if (window.showNotification) window.showNotification('✅ Bono individual agregado', 'success');
    context.render();
}

// ---------------------- PRÉSTAMOS TEMPORALES DE NÓMINA ----------------------

export function addPayrollLoansToExport() {
    const state = getState();
    const eligibleEmployees = getLeaderFilteredEmployees(state);
    const selection = buildPayrollLoanSelection(eligibleEmployees, state.exportConfig.periodEnd);
    stateManager.batchSetState(() => {
        state.exportConfig.payrollLoanSelection = selection;
    });

    if (window.showNotification) {
        const invalidRows = getInvalidPayrollLoanRows(generateExportData());
        if (invalidRows.length > 0) {
            window.showNotification(
                `❌ ${invalidRows.length} pago(s) quedan en cero o negativo. Elimina sus préstamos temporales.`,
                'error'
            );
        } else {
            const message = selection.length > 0
                ? `✅ Préstamos activos agregados para ${selection.length} empleado(s)`
                : 'ℹ️ No hay préstamos activos con saldo para agregar';
            window.showNotification(message, selection.length > 0 ? 'success' : 'info');
        }
    }
    context.render();
}

export function removeEmployeePayrollLoans(employeeId) {
    const state = getState();
    stateManager.batchSetState(() => {
        state.exportConfig.payrollLoanSelection = removeEmployeePayrollLoansFromSelection(
            state.exportConfig.payrollLoanSelection || [],
            employeeId
        );
    });
    if (window.showNotification) window.showNotification('✅ Préstamos eliminados del listado temporal', 'success');
    context.render();
}

// ---------------------- PERIODOS DE EXPORTACIÓN ----------------------

export function updateExportPeriod(type, value) {
    const state = getState();
    stateManager.batchSetState(() => {
        if (type === 'start') state.exportConfig.periodStart = value;
        if (type === 'end') state.exportConfig.periodEnd = value;
        state.exportConfig.activePreset = null;
        state.exportConfig.payrollLoanSelection = [];
        state.exportConfig.payrollLoanExpandedEmployees = [];
    });
    context.render();
}

export function setLeaderFilter(leaderId) {
    const state = getState();
    state.exportConfig.leaderFilter = leaderId;
    context.render();
}

export function setExportPreset(preset) {
    const state = getState();
    const today = new Date();
    let start, end = today;

    if (preset === 'thisMonth') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === 'lastMonth') {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === 'last15') {
        start = new Date();
        start.setDate(today.getDate() - 15);
    } else if (preset === 'sinceLastPay') {
        const lastPay = state.settings.globalLastPaymentDate ? new Date(state.settings.globalLastPaymentDate) : null;
        if (lastPay) {
            start = new Date(lastPay);
            start.setDate(start.getDate() + 1);
        } else {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
        }
    } else if (preset === 'payPeriod') {
        const period = resolvePayrollPeriod(state.settings.payPeriod, today);
        stateManager.batchSetState(() => {
            state.exportConfig.periodStart = period.periodStart;
            state.exportConfig.periodEnd = period.periodEnd;
            state.exportConfig.activePreset = preset;
            state.exportConfig.periodSource = period.source;
            state.exportConfig.payrollLoanSelection = [];
            state.exportConfig.payrollLoanExpandedEmployees = [];
        });
        if (period.source === 'month-fallback' && window.showNotification) {
            window.showNotification('⚠️ El período configurado no es válido; se usó el mes actual.', 'warning');
        }
        context.render();
        return;
    }

    stateManager.batchSetState(() => {
        state.exportConfig.periodStart = getDateKey(start);
        state.exportConfig.periodEnd = getDateKey(end);
        state.exportConfig.activePreset = preset;
        state.exportConfig.payrollLoanSelection = [];
        state.exportConfig.payrollLoanExpandedEmployees = [];
    });
    context.render();
}

function getSplitXExportData() {
    const previewRows = generateExportData();
    const invalidRows = getInvalidPayrollLoanRows(previewRows);
    if (invalidRows.length > 0) {
        if (window.showNotification) {
            window.showNotification(
                `❌ No se puede exportar: ${invalidRows.length} pago(s) quedan en cero o negativo por préstamos`,
                'error'
            );
        }
        return null;
    }
    return toSplitXRows(previewRows);
}

export function copyExportJSON() {
    const data = getSplitXExportData();
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        if (window.showNotification) window.showNotification('✅ Datos para SplitX copiados', 'success');
    }).catch(() => {
        if (window.showNotification) window.showNotification('❌ No se pudo copiar al portapapeles', 'error');
    });
}

export function downloadExportJSON() {
    const data = getSplitXExportData();
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nomina_${getDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.showNotification) window.showNotification('✅ Archivo para SplitX descargado', 'success');
}

export function toggleStep(stepId) {
    const state = getState();
    if (!state.exportConfig.collapsedSteps) state.exportConfig.collapsedSteps = [];
    
    if (state.exportConfig.collapsedSteps.includes(stepId)) {
        state.exportConfig.collapsedSteps = state.exportConfig.collapsedSteps.filter(id => id !== stepId);
    } else {
        state.exportConfig.collapsedSteps.push(stepId);
    }
    context.render();
}

function expandedPayrollLoanEmployeeIds() {
    if (typeof document === 'undefined') return [];
    return [...document.querySelectorAll('.payroll-loan-group[open]')]
        .map(group => group.dataset.employeeId)
        .filter(Boolean);
}

function updatePayrollLoanSelection(nextSelection) {
    stateManager.batchSetState(() => {
        const state = getState();
        state.exportConfig.payrollLoanSelection = nextSelection;
        state.exportConfig.payrollLoanExpandedEmployees = expandedPayrollLoanEmployeeIds();
    });
    context.render();
}

export function clearPayrollLoans() {
    updatePayrollLoanSelection([]);
}

export function toggleEmployeePayrollLoans(employeeId) {
    const state = getState();
    const employee = state.employees.find(item => String(item.id) === String(employeeId));
    if (!employee) return;
    const eligibleLoans = getEligiblePayrollLoans(employee, state.exportConfig.periodEnd);
    const current = (state.exportConfig.payrollLoanSelection || [])
        .find(item => String(item.employeeId) === String(employee.id));
    const selectedCounts = new Map(
        (current?.loans || (current?.loanIds || []).map(loanId => ({ loanId, chargeCount: 1 })))
            .map(item => [String(item.loanId), Number(item.chargeCount) || 0])
    );
    const allSelected = eligibleLoans.length > 0 &&
        eligibleLoans.every(loan => (selectedCounts.get(String(loan.loanId)) || 0) > 0);
    updatePayrollLoanSelection(setEmployeePayrollLoans(
        state.exportConfig.payrollLoanSelection || [],
        employee.id,
        allSelected ? [] : eligibleLoans.map(loan => ({
            loanId: loan.loanId,
            chargeCount: Math.max(1, loan.defaultChargeCount)
        }))
    ));
}

export function togglePayrollLoanSelection(employeeId, loanId) {
    const state = getState();
    const employee = state.employees.find(item => String(item.id) === String(employeeId));
    const loan = employee
        ? getEligiblePayrollLoans(employee, state.exportConfig.periodEnd)
            .find(item => String(item.loanId) === String(loanId))
        : null;
    if (!employee || !loan) return;
    const current = (state.exportConfig.payrollLoanSelection || [])
        .find(item => String(item.employeeId) === String(employee.id));
    const selected = (current?.loans || (current?.loanIds || []).map(id => ({ loanId: id, chargeCount: 1 })))
        .some(item => String(item.loanId) === String(loan.loanId) && Number(item.chargeCount) > 0);
    updatePayrollLoanSelection(togglePayrollLoan(
        state.exportConfig.payrollLoanSelection || [],
        employee.id,
        loan.loanId,
        !selected
    ));
}

export function adjustPayrollLoanChargeCount(employeeId, loanId, delta) {
    const state = getState();
    const employee = state.employees.find(item => String(item.id) === String(employeeId));
    const loan = employee
        ? getEligiblePayrollLoans(employee, state.exportConfig.periodEnd)
            .find(item => String(item.loanId) === String(loanId))
        : null;
    if (!employee || !loan) return;

    const current = (state.exportConfig.payrollLoanSelection || [])
        .find(item => String(item.employeeId) === String(employee.id));
    const currentLoan = (current?.loans || (current?.loanIds || []).map(id => ({ loanId: id, chargeCount: 1 })))
        .find(item => String(item.loanId) === String(loan.loanId));
    const currentCount = Number(currentLoan?.chargeCount) || 0;
    const nextCount = Math.max(0, Math.min(loan.maxChargeCount, currentCount + Number(delta || 0)));

    updatePayrollLoanSelection(setPayrollLoanChargeCount(
        state.exportConfig.payrollLoanSelection || [],
        employee.id,
        loan.loanId,
        nextCount
    ));
}

export function selectAllPayrollLoanCharges(employeeId, loanId) {
    const state = getState();
    const employee = state.employees.find(item => String(item.id) === String(employeeId));
    const loan = employee
        ? getEligiblePayrollLoans(employee, state.exportConfig.periodEnd)
            .find(item => String(item.loanId) === String(loanId))
        : null;
    if (!employee || !loan) return;

    updatePayrollLoanSelection(setPayrollLoanChargeCount(
        state.exportConfig.payrollLoanSelection || [],
        employee.id,
        loan.loanId,
        loan.maxChargeCount
    ));
}

function currentPayrollClosureState({ activeClosures = null, historyReady = null, ignoreInProgress = false } = {}) {
    const state = getState();
    const rows = generateExportData();
    const fingerprint = buildPayrollPreviewFingerprint({
        periodStart: state.exportConfig.periodStart,
        periodEnd: state.exportConfig.periodEnd,
        rows
    });
    const cache = activeClosures === null
        ? requestPayrollPeriodClosures(
            state.exportConfig.periodStart,
            state.exportConfig.periodEnd
        )
        : { items: activeClosures, ready: historyReady !== false, error: null };
    let gate = getPayrollClosureGate({
        rows,
        fingerprint,
        paidConfirmation: state.exportConfig.payrollPaidConfirmation,
        activeClosures: cache.items,
        correctionSupersedesId: state.exportConfig.payrollCorrectionSupersedesId,
        historyReady: historyReady ?? cache.ready,
        inProgress: ignoreInProgress ? false : payrollClosureInProgress
    });
    if (cache.error) gate = { ...gate, enabled: false, reason: 'history-error' };
    return { state, rows, fingerprint, activeClosures: cache.items, gate };
}

async function loadCurrentPayrollClosureState({ ignoreInProgress = false } = {}) {
    const state = getState();
    const periodStart = state.exportConfig.periodStart;
    const periodEnd = state.exportConfig.periodEnd;
    if (!canUsePayrollRemote()) {
        throw new Error('Conectate para verificar que este período no tenga un cierre remoto.');
    }
    await payrollClosureSync.pullPeriod(periodStart, periodEnd);
    const activeClosures = await payrollClosureStore.getByPeriod(
        periodStart,
        periodEnd
    );
    payrollPeriodClosureCache = {
        key: payrollPeriodKey(periodStart, periodEnd),
        items: activeClosures,
        ready: true,
        loading: false,
        error: null
    };
    return currentPayrollClosureState({
        activeClosures,
        historyReady: true,
        ignoreInProgress
    });
}

export function togglePayrollPaidConfirmation(checked) {
    const current = currentPayrollClosureState();
    if (!checked) {
        stateManager.setState({
            exportConfig: {
                ...current.state.exportConfig,
                payrollPaidConfirmation: null
            }
        });
        context.render();
        return;
    }
    if (!current.gate.hasRows || current.gate.invalidCount > 0 ||
        !current.gate.payrollPaid && ['history-loading', 'history-error', 'in-progress', 'already-closed']
            .includes(current.gate.reason)) {
        if (window.showNotification) {
            window.showNotification('⚠️ Resolvé los saldos y verificá el historial antes de confirmar el pago.', 'warning');
        }
        context.render();
        return;
    }
    stateManager.setState({
        exportConfig: {
            ...current.state.exportConfig,
            payrollPaidConfirmation: confirmPayrollPaid(current.fingerprint)
        }
    });
    if (window.showNotification) {
        window.showNotification('✅ Nómina marcada como pagada para esta vista previa', 'success');
    }
    context.render();
}

function PayrollHistoryTab() {
    if (!payrollHistoryState.ready && !payrollHistoryState.loading) {
        queueMicrotask(() => loadPayrollHistory());
    }
    return renderPayrollHistoryView({
        ...payrollHistoryState,
        currentEmployees: getState().employees || []
    });
}

function payrollHistorySummary(item = {}) {
    const summary = { ...item };
    delete summary.rows;
    delete summary.paymentRefs;
    delete summary.loanSettlementBatchId;
    return summary;
}

export async function loadPayrollHistory({ direction = 'current', force = false } = {}) {
    if (payrollHistoryState.loading && !force) return;
    if (direction === 'previous') {
        const previousIndex = payrollHistoryState.pageIndex - 1;
        const previous = payrollHistoryState.pages[previousIndex];
        if (!previous) return;
        payrollHistoryState = {
            ...payrollHistoryState,
            ...previous,
            pageIndex: previousIndex,
            page: previousIndex + 1,
            hasPrevious: previousIndex > 0,
            selectedClosure: null
        };
        context?.render?.();
        return;
    }
    if (direction === 'next') {
        const cachedIndex = payrollHistoryState.pageIndex + 1;
        const cached = payrollHistoryState.pages[cachedIndex];
        if (cached) {
            payrollHistoryState = {
                ...payrollHistoryState,
                ...cached,
                pageIndex: cachedIndex,
                page: cachedIndex + 1,
                hasPrevious: true,
                selectedClosure: null
            };
            context?.render?.();
            return;
        }
        if (!payrollHistoryState.nextCursor) return;
    }
    const token = ++payrollHistoryLoadToken;
    const cursor = direction === 'next' ? payrollHistoryState.nextCursor : null;
    const targetIndex = direction === 'next' ? payrollHistoryState.pageIndex + 1 : 0;
    payrollHistoryState = {
        ...payrollHistoryState,
        items: [],
        pages: force ? [] : payrollHistoryState.pages,
        nextCursor: null,
        selectedClosure: null,
        loading: true,
        error: null
    };
    context?.render?.();
    try {
        const page = canUsePayrollRemote()
            ? await payrollClosureSync.pullPage({
                limit: 10,
                status: payrollHistoryState.filters.status || null,
                periodStart: payrollHistoryState.filters.periodStart || null,
                periodEnd: payrollHistoryState.filters.periodEnd || null,
                cursor
            })
            : await payrollClosureStore.listPage({
                limit: 10,
                status: payrollHistoryState.filters.status || null,
                periodStart: payrollHistoryState.filters.periodStart || null,
                periodEnd: payrollHistoryState.filters.periodEnd || null,
                cursor
            });
        const syncStates = await payrollClosureStore.getSyncStates(page.items.map(item => item.id));
        if (token !== payrollHistoryLoadToken) return;
        const items = page.items.slice(0, 10).map(item => ({
            ...payrollHistorySummary(item),
            syncStatus: syncStates[item.id] || 'synced'
        }));
        if (direction === 'next' && items.length === 0) {
            const currentIndex = payrollHistoryState.pageIndex;
            const currentPage = payrollHistoryState.pages[currentIndex] || { items: [] };
            const pages = [...payrollHistoryState.pages];
            pages[currentIndex] = { ...currentPage, nextCursor: null };
            payrollHistoryState = {
                ...payrollHistoryState,
                ...pages[currentIndex],
                pages,
                loading: false,
                ready: true,
                error: null
            };
            context?.render?.();
            return;
        }
        const pageState = { items, nextCursor: page.nextCursor };
        const pages = payrollHistoryState.pages.slice(0, targetIndex);
        pages[targetIndex] = pageState;
        payrollHistoryState = {
            ...payrollHistoryState,
            ...pageState,
            pages,
            pageIndex: targetIndex,
            page: targetIndex + 1,
            hasPrevious: targetIndex > 0,
            nextCursor: page.nextCursor,
            loading: false,
            ready: true,
            error: null
        };
    } catch (error) {
        if (token !== payrollHistoryLoadToken) return;
        payrollHistoryState = {
            ...payrollHistoryState,
            loading: false,
            ready: true,
            error: error?.message || 'No se pudo cargar el historial local.'
        };
    }
    context?.render?.();
}

export function setPayrollHistoryFilter(name, value) {
    if (!['status', 'periodStart', 'periodEnd'].includes(name)) return;
    payrollHistoryState = {
        ...payrollHistoryState,
        filters: { ...payrollHistoryState.filters, [name]: String(value || '') },
        selectedClosure: null,
        pages: [],
        pageIndex: 0,
        page: 1,
        hasPrevious: false,
        nextCursor: null,
        ready: false
    };
    loadPayrollHistory({ force: true });
}

export function setPayrollHistoryDetailFilter(name, value) {
    const booleanFilters = ['includeBonuses', 'includeDeductions', 'includeLoans'];
    if (name !== 'leaderId' && !booleanFilters.includes(name)) return;
    payrollHistoryState = {
        ...payrollHistoryState,
        detailFilters: {
            ...payrollHistoryState.detailFilters,
            [name]: booleanFilters.includes(name) ? Boolean(value) : String(value || '')
        }
    };
    context?.render?.();
}

function focusPayrollHistoryControl(action, id = null) {
    queueMicrotask(() => {
        const controls = document.querySelectorAll(`[data-payroll-action="${action}"]`);
        const target = id === null
            ? controls[0]
            : [...controls].find(control => String(control.dataset.id) === String(id));
        target?.focus?.();
    });
}

export async function openPayrollHistoryDetail(closureId) {
    const id = String(closureId || '');
    if (!id) return;
    stateManager.setState({ payrollViewMode: 'history' });
    const loaded = payrollHistoryState.items.find(item => String(item.id) === id);
    payrollHistoryState = {
        ...payrollHistoryState,
        loading: true,
        error: null,
        detailFilters: {
            leaderId: '',
            includeBonuses: true,
            includeDeductions: true,
            includeLoans: true
        }
    };
    context?.render?.();
    try {
        const closure = canUsePayrollRemote() && loaded?.syncStatus === 'synced'
            ? await payrollClosureSync.pullDetail(id)
            : await payrollClosureStore.getById(id);
        if (!closure) throw new Error('No se encontró el cierre en el historial local.');
        const syncStates = await payrollClosureStore.getSyncStates([id]);
        payrollHistoryState = {
            ...payrollHistoryState,
            selectedClosure: { ...closure, syncStatus: syncStates[id] || 'synced' },
            loading: false
        };
    } catch (error) {
        payrollHistoryState = {
            ...payrollHistoryState,
            loading: false,
            error: error?.message || 'No se pudo abrir el cierre.'
        };
    }
    context?.render?.();
    if (payrollHistoryState.selectedClosure) {
        focusPayrollHistoryControl('close-payroll-history-detail');
    }
}

export function closePayrollHistoryDetail() {
    const closedId = payrollHistoryState.selectedClosure?.id || null;
    payrollHistoryState = { ...payrollHistoryState, selectedClosure: null };
    context?.render?.();
    if (closedId) focusPayrollHistoryControl('open-payroll-history-detail', closedId);
}

function updatePayrollHistoryState(closure) {
    payrollHistoryState = {
        ...payrollHistoryState,
        items: payrollHistoryState.items.map(item => item.id === closure.id
            ? { ...closure, syncStatus: 'pending' }
            : item),
        selectedClosure: payrollHistoryState.selectedClosure?.id === closure.id
            ? { ...closure, syncStatus: 'pending' }
            : payrollHistoryState.selectedClosure
    };
}

function settlementOperatorId() {
    return globalThis.currentUser?.uid || globalThis.currentUser?.email || null;
}

export function preparePayrollCorrection(closureId) {
    const current = currentPayrollClosureState();
    const active = current.gate.activeClosure;
    if (!active || String(active.id) !== String(closureId)) return;
    stateManager.setState({
        exportConfig: {
            ...current.state.exportConfig,
            payrollCorrectionSupersedesId: active.id
        }
    });
    window.showNotification?.('Corrección preparada. El cierre anterior conservará su auditoría.', 'info');
    context.render();
}

export async function openPayrollClosure() {
    if (payrollClosureInProgress) return;
    payrollClosureInProgress = true;
    try {
        const current = await loadCurrentPayrollClosureState({ ignoreInProgress: true });
        if (!current.gate.enabled) {
            window.showNotification?.('⚠️ El cierre de nómina todavía no está habilitado.', 'warning');
            return;
        }
        const draft = buildPayrollClosureDraft({
            employees: current.state.employees,
            rows: current.rows,
            periodStart: current.state.exportConfig.periodStart,
            periodEnd: current.state.exportConfig.periodEnd,
            periodSource: current.state.exportConfig.periodSource,
            closedAt: Date.now(),
            closedBy: settlementOperatorId(),
            bonuses: current.state.exportConfig.bonuses,
            deductions: current.state.exportConfig.deductions,
            supersedesId: current.gate.nextSupersedesId
        });
        const verified = await openPayrollClosureModal(draft);
        if (!verified) return;

        const latest = await loadCurrentPayrollClosureState({ ignoreInProgress: true });
        if (!latest.gate.enabled || latest.fingerprint !== draft.closure.fingerprint) {
            throw new Error('La vista previa cambió mientras se verificaba el cierre. Revisala y confirmá la Nómina nuevamente.');
        }

        const closedAt = Date.now();
        const employeeCopies = JSON.parse(JSON.stringify(latest.state.employees || []));
        const finalized = buildPayrollClosureDraft({
            employees: employeeCopies,
            rows: latest.rows,
            periodStart: latest.state.exportConfig.periodStart,
            periodEnd: latest.state.exportConfig.periodEnd,
            periodSource: latest.state.exportConfig.periodSource,
            closedAt,
            closedBy: settlementOperatorId(),
            bonuses: latest.state.exportConfig.bonuses,
            deductions: latest.state.exportConfig.deductions,
            supersedesId: latest.gate.nextSupersedesId
        });
        if (finalized.batch) {
            applyPayrollLoanSettlementBatch(employeeCopies, finalized.batch, {
                now: closedAt,
                recordedBy: settlementOperatorId()
            });
        }
        const affectedIds = new Set(
            (finalized.batch?.employees || []).map(item => String(item.employeeId))
        );
        const affectedEmployees = employeeCopies.filter(item => affectedIds.has(String(item.id)));
        const savedClosure = await payrollClosureStore.saveWithEmployees(
            finalized.closure,
            affectedEmployees,
            {
                enqueueCloud: true,
                queuedAt: closedAt,
                schemaVersion: latest.state.settings?.schemaVersion
            }
        );

        const nextExportConfig = {
            ...consumePayrollClosureAdjustments(latest.state.exportConfig, savedClosure),
            payrollPaidConfirmation: null,
            payrollCorrectionSupersedesId: null,
            payrollLoanSelection: []
        };
        stateManager.setState(finalized.batch
            ? { employees: employeeCopies, exportConfig: nextExportConfig }
            : { exportConfig: nextExportConfig });
        updatePayrollPeriodClosureCache(savedClosure);
        updatePayrollHistoryState(savedClosure);

        try {
            await Promise.resolve(context.saveToLocalStorage({
                immediate: true,
                announce: `Nómina cerrada: ${savedClosure.totals.net.toFixed(2)}`
            }));
        } catch (error) {
            console.warn('El cierre quedó guardado, pero el guardado general debe reintentarse:', error);
            window.showNotification?.('⚠️ El cierre quedó local; la sincronización general se reintentará.', 'warning');
        }
        context.render();
    } catch (error) {
        await Modal.alert({
            title: 'No se cerró la nómina',
            message: escapeHTML(error?.message || 'La información cambió. Revisá la Nómina antes de intentarlo nuevamente.')
        });
    } finally {
        payrollClosureInProgress = false;
        context?.render?.();
    }
}

export async function undoPayrollClosure(closureId) {
    if (payrollClosureInProgress) return;
    payrollClosureInProgress = true;
    try {
        const state = getState();
        const closure = await payrollClosureStore.getById(closureId);
        if (!closure) throw new Error('No se encontró el cierre de Nómina');
        if (!canUsePayrollRemote()) {
            throw new Error('Conectate para verificar que este período no tenga una corrección remota.');
        }
        const refresh = await payrollClosureSync.pullPeriod(
            closure.periodStart,
            closure.periodEnd
        );
        if (refresh.conflicts?.length) {
            throw new Error('No se pudo verificar el estado remoto de este cierre de Nómina.');
        }
        const activeClosures = await payrollClosureStore.getByPeriod(
            closure.periodStart,
            closure.periodEnd
        );
        const restoredExportConfig = restorePayrollClosureAdjustments(state.exportConfig, closure);
        const employeeCopies = JSON.parse(JSON.stringify(state.employees || []));
        const result = undoPayrollClosureEffects(employeeCopies, closure, {
            now: Date.now(),
            voidedBy: settlementOperatorId(),
            activeClosures
        });
        const affectedIds = new Set((closure.paymentRefs || []).map(ref => String(ref.employeeId)));
        const affectedEmployees = employeeCopies.filter(item => affectedIds.has(String(item.id)));
        const savedClosure = await payrollClosureStore.saveWithEmployees(
            result.closure,
            affectedEmployees,
            { enqueueCloud: true, schemaVersion: state.settings?.schemaVersion }
        );
        stateManager.setState({
            employees: employeeCopies,
            exportConfig: {
                ...restoredExportConfig,
                payrollPaidConfirmation: null,
                payrollCorrectionSupersedesId: null
            }
        });
        updatePayrollPeriodClosureCache(savedClosure);
        updatePayrollHistoryState(savedClosure);
        await Promise.resolve(context.saveToLocalStorage({
            immediate: true,
            announce: 'Cierre de nómina deshecho'
        }));
        window.showNotification?.(
            `↩️ Cierre anulado${result.voidedPaymentCount ? ` · ${result.voidedPaymentCount} pago(s) restaurado(s)` : ''}${result.voidedBonusCount || result.voidedDeductionCount ? ' · ajustes restaurados' : ''}`,
            'info'
        );
        context.render();
    } catch (error) {
        await Modal.alert({
            title: 'No se puede deshacer',
            message: escapeHTML(error?.message || 'El cierre no se puede deshacer de forma segura.')
        });
    } finally {
        payrollClosureInProgress = false;
        context?.render?.();
    }
}

// Compatibility aliases for extensions that still call the previous loan-only API.
export const openPayrollLoanSettlement = openPayrollClosure;
export const undoPayrollLoanSettlement = undoPayrollClosure;

export function setPayrollGuideStep(stepId) {
    const stepMap = {
        period: ['step2', 'step2b', 'step2c', 'step3'],
        deductions: ['step1', 'step2b', 'step2c', 'step3'],
        bonuses: ['step1', 'step2', 'step2c', 'step3'],
        loans: ['step1', 'step2', 'step2b', 'step3'],
        review: ['step1', 'step2', 'step2b', 'step2c']
    };
    if (!Object.hasOwn(stepMap, stepId)) return;

    stateManager.batchSetState(() => {
        const state = getState();
        state.exportConfig.payrollGuideStep = stepId;
        state.exportConfig.collapsedSteps = [...stepMap[stepId]];
    });
}

export function togglePayrollSummaryDetail(kind) {
    if (!['bonuses', 'deductions'].includes(kind)) return;
    stateManager.batchSetState(() => {
        const state = getState();
        const expanded = state.exportConfig.payrollSummaryExpanded || {};
        state.exportConfig.payrollSummaryExpanded = {
            ...expanded,
            [kind]: !expanded[kind]
        };
    });
}

export function togglePayrollMobileSummary() {
    stateManager.batchSetState(() => {
        const state = getState();
        state.exportConfig.payrollMobileSummaryExpanded =
            !state.exportConfig.payrollMobileSummaryExpanded;
    });
}
