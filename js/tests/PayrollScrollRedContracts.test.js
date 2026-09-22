/**
 * PayrollScrollRedContracts.test.js
 *
 * 🛡️ VALIDATION CONTRACTS (RED SUITE) - Nómina Scroll Stability & Prevention of Bouncing/Reset
 *
 * Freezes the regression contracts for the Payroll scroll reset / bouncing defect:
 *
 * Contract 1: saveScrollPosition must be passive bookkeeping and NOT schedule reactive renders
 *             solely from writing scroll coordinates to state.
 *
 * Contract 2: Deferred scroll restoration must NOT overwrite subsequent user scroll movements
 *             that occurred after position capture (both window scroll and [data-preserve-scroll] containers).
 *
 * Contract 3: Programmatic focus management across Payroll controls must pass { preventScroll: true }
 *             to prevent jarring viewport jumps/bouncing when focusing controls.
 *
 * Contract 4 (Optional / Structural Stability):
 *             ScopedPayrollTab loading/placeholder state must maintain layout structure continuity
 *             (e.g., layout container, skeleton, or aria-busy placeholder) to prevent document height
 *             collapse during asynchronous transitions.
 */

import 'fake-indexeddb/auto';
import { saveScrollPosition, restoreScrollPosition } from 'actual/core/RenderManager.js';
import { renderOptimizer, state, stateManager } from 'actual/core/AppState.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import payrollClosureStore from 'actual/features/payroll/PayrollClosureStore.js';
import { openPayrollAdjustmentEmployeePicker } from 'actual/features/payroll/PayrollAdjustmentEmployeePicker.js';

describe('Payroll Scroll Stability & Red Contracts', () => {
    let rAFCallbacks = [];
    let originalRAF = null;

    beforeEach(() => {
        document.body.innerHTML = '';
        rAFCallbacks = [];
        originalRAF = window.requestAnimationFrame;
        window.requestAnimationFrame = jest.fn((cb) => {
            rAFCallbacks.push(cb);
            return rAFCallbacks.length;
        });
    });

    afterEach(() => {
        window.requestAnimationFrame = originalRAF;
        jest.restoreAllMocks();
        document.body.innerHTML = '';
    });

    function flushRAF() {
        const cbs = [...rAFCallbacks];
        rAFCallbacks = [];
        cbs.forEach(cb => cb());
    }

    // =========================================================================
    // CONTRACT 1: Reactive render isolation on saveScrollPosition
    // =========================================================================
    describe('Contract 1: saveScrollPosition render isolation', () => {
        it('does not schedule reactive renders when saving scroll position', () => {
            const scheduleSpy = jest.spyOn(renderOptimizer, 'scheduleRender');
            const originalRender = window.render;
            window.render = jest.fn();

            try {
                scheduleSpy.mockClear();

                // Capture current scroll
                saveScrollPosition();

                // CONTRACT: Scroll tracking is layout bookkeeping. Writing scroll coordinates
                // must NOT trigger reactive rendering (which in baseline creates infinite render loops
                // or scroll fighting while the user scrolls).
                expect(scheduleSpy).not.toHaveBeenCalled();
            } finally {
                scheduleSpy.mockRestore();
                window.render = originalRender;
            }
        });
    });

    // =========================================================================
    // CONTRACT 2: Deferred restoration must not overwrite user movements
    // =========================================================================
    describe('Contract 2: Deferred restoration respecting user scroll', () => {
        it('does not overwrite window scroll if the user moved after capture', () => {
            let currentX = 0;
            let currentY = 200;

            const scrollToSpy = jest.fn((x, y) => {
                if (typeof x === 'object' && x !== null) {
                    currentX = x.left ?? currentX;
                    currentY = x.top ?? currentY;
                } else {
                    currentX = x ?? currentX;
                    currentY = y ?? currentY;
                }
            });
            window.scrollTo = scrollToSpy;

            Object.defineProperty(window, 'scrollY', {
                get: () => currentY,
                set: (val) => { currentY = val; },
                configurable: true
            });
            Object.defineProperty(window, 'scrollX', {
                get: () => currentX,
                set: (val) => { currentX = val; },
                configurable: true
            });

            // 1. Position at Y = 200, captured by saveScrollPosition
            window.scrollY = 200;
            saveScrollPosition();

            // 2. Defer restoration
            restoreScrollPosition();
            scrollToSpy.mockClear();

            // 3. User actively scrolls down to Y = 600 after capture
            window.scrollY = 600;

            // 4. Deferred restoration frame executes
            flushRAF();

            // CONTRACT: A deferred restoration must NOT forcefully overwrite user movement
            // that took place after the snapshot.
            expect(window.scrollY).toBe(600);
            expect(scrollToSpy).not.toHaveBeenCalledWith(0, 200);
        });

        it('does not overwrite [data-preserve-scroll] container scroll if scrolled after capture', () => {
            const container = document.createElement('div');
            container.dataset.preserveScroll = 'payroll-preview-table';
            container.scrollTop = 150;
            container.scrollLeft = 0;
            document.body.appendChild(container);

            // 1. Capture scroll at 150
            saveScrollPosition();

            // 2. Schedule restore
            restoreScrollPosition();

            // 3. User scrolls the container down to 450
            container.scrollTop = 450;

            // 4. Deferred restore frame executes
            flushRAF();

            // CONTRACT: Container scroll updated by user must not bounce back to stale 150
            expect(container.scrollTop).toBe(450);
        });
    });

    // =========================================================================
    // CONTRACT 3: Programmatic focus in Payroll controls uses preventScroll
    // =========================================================================
    describe('Contract 3: Payroll programmatic focus uses preventScroll', () => {
        it('uses { preventScroll: true } when refocusing togglePayrollPreviewCategory', async () => {
            const button = document.createElement('button');
            button.dataset.payrollAction = 'toggle-payroll-preview-category';
            button.dataset.value = 'bonuses';
            document.body.appendChild(button);

            const rawState = stateManager.getState();
            rawState.exportConfig = {
                payrollPreviewInclusion: { bonuses: true, deductions: true, loans: true }
            };

            PayrollUI.init({
                state: rawState,
                render: jest.fn(),
                services: {
                    payroll: {
                        calculatePayroll: jest.fn().mockReturnValue([])
                    }
                }
            });

            const focusSpy = jest.spyOn(button, 'focus');

            // Trigger category toggle
            PayrollUI.togglePayrollPreviewCategory('bonuses', true);

            // Flush microtasks
            await Promise.resolve();
            await Promise.resolve();

            // CONTRACT: Focusing preview category controls must avoid forcing viewport scroll
            expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
        });

        it('uses { preventScroll: true } when focusing history controls via focusPayrollHistoryControl', async () => {
            const closeBtn = document.createElement('button');
            closeBtn.dataset.payrollAction = 'close-payroll-history-detail';
            document.body.appendChild(closeBtn);

            const openBtn = document.createElement('button');
            openBtn.dataset.payrollAction = 'open-payroll-history-detail';
            openBtn.dataset.id = 'CLOSURE-2026-03';
            document.body.appendChild(openBtn);

            const rawState = stateManager.getState();
            rawState.payrollViewMode = 'history';

            PayrollUI.init({
                state: rawState,
                render: jest.fn(),
                services: { payroll: {} }
            });

            jest.spyOn(payrollClosureStore, 'getById').mockResolvedValue({
                id: 'CLOSURE-2026-03',
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });
            jest.spyOn(payrollClosureStore, 'getSyncStates').mockResolvedValue({
                'CLOSURE-2026-03': 'synced'
            });

            const openFocusSpy = jest.spyOn(openBtn, 'focus');

            // Open detail and then close detail to trigger focusPayrollHistoryControl('open-payroll-history-detail', closedId)
            await PayrollUI.openPayrollHistoryDetail('CLOSURE-2026-03');
            await Promise.resolve();

            PayrollUI.closePayrollHistoryDetail();
            await Promise.resolve();
            await Promise.resolve();

            // CONTRACT: Refocusing history triggers must NOT jump/scroll the page
            expect(openFocusSpy).toHaveBeenCalledWith({ preventScroll: true });
        });

        it('uses { preventScroll: true } when opening PayrollAdjustmentEmployeePicker search input', async () => {
            const focusSpy = jest.spyOn(HTMLElement.prototype, 'focus');

            // Open the employee picker dialog
            const pickerPromise = openPayrollAdjustmentEmployeePicker({
                employees: [{ id: 'EMP-1', name: 'Test Employee', number: '1', active: true }],
                selectedIds: []
            });

            // Locate search input
            const searchInput = document.querySelector('[data-adjustment-picker-search]');
            expect(searchInput).not.toBeNull();

            // CONTRACT: Programmatic focus on picker search input must pass { preventScroll: true }
            expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

            // Close dialog
            const closeBtn = document.querySelector('.modal-close, [data-modal-close], .btn-secondary');
            closeBtn?.click();
            await pickerPromise;
        });
    });

    // =========================================================================
    // CONTRACT 4 (OPTIONAL): Structural stability of ScopedPayrollTab loading
    // =========================================================================
    describe('Contract 4 (Optional): ScopedPayrollTab structural stability', () => {
        it('preserves generator layout envelope or loading skeleton to prevent document collapse', () => {
            const root = document.createElement('div');
            root.id = 'root';
            document.body.appendChild(root);

            const rawState = stateManager.getState();
            rawState.payrollViewMode = 'generator';

            PayrollUI.init({
                state: rawState,
                render: jest.fn(),
                services: {
                    payroll: {},
                    payrollRuntime: {
                        getCurrentView: () => ({
                            enabled: true,
                            projectId: 'PRJ-ALPHA',
                            status: 'loading',
                            config: null,
                            period: null
                        })
                    }
                }
            });

            const html = PayrollUI.PayrollTab();
            root.innerHTML = html;

            // CONTRACT: During loading/transitional states, ScopedPayrollTab must not collapse into a bare
            // 2-line <section> that causes document height collapse and window.scrollY reset. It should
            // provide layout continuity (e.g. maintaining .payroll-generator container or placeholder/skeleton).
            const hasLayoutEnvelope = !!root.querySelector('.payroll-generator, .payroll-skeleton, .payroll-loading-placeholder, [aria-busy="true"]');

            expect(hasLayoutEnvelope).toBe(true);
        });
    });
});
