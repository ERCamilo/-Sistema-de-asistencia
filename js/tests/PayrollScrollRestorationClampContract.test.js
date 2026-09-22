/**
 * PayrollScrollRestorationClampContract.test.js
 *
 * Focal validation suite for scroll restoration clamping and interaction defects
 * in RenderManager.restoreScrollPosition().
 *
 * Defects frozen by this contract:
 *  (1) Viewport scroll clamping: when window.scrollY is captured at 500 and the browser
 *      clamps it to 300 following a render/layout shift without user interaction,
 *      scrollY must be restored to 500.
 *  (2) Axis decoupling: horizontal scroll (scrollX) must not block or interfere with
 *      restoration of vertical scroll (scrollY).
 *  (3) Container scroll clamping: for elements with [data-preserve-scroll], when scrollTop
 *      is captured at 400 and clamped to 80 after DOM changes without user interaction,
 *      scrollTop must be restored to 400.
 *  (4) User interaction precedence: genuine user scroll movements taking place after capture
 *      must not be overwritten, including deliberate scroll to 0. Relies on an explicit
 *      interaction signal rather than naively assuming (current !== 0) represents user input.
 */

import 'fake-indexeddb/auto';
import { saveScrollPosition, restoreScrollPosition } from 'actual/core/RenderManager.js';

describe('RenderManager.restoreScrollPosition - Clamping & Interaction Contracts', () => {
    let rAFCallbacks = [];
    let originalRAF = null;
    let originalScrollTo = null;
    let currentX = 0;
    let currentY = 0;
    let scrollToSpy = null;

    beforeEach(() => {
        document.body.innerHTML = '';
        rAFCallbacks = [];
        originalRAF = window.requestAnimationFrame;
        originalScrollTo = window.scrollTo;

        window.requestAnimationFrame = jest.fn((cb) => {
            rAFCallbacks.push(cb);
            return rAFCallbacks.length;
        });

        currentX = 0;
        currentY = 0;

        scrollToSpy = jest.fn((x, y) => {
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
    });

    afterEach(() => {
        window.requestAnimationFrame = originalRAF;
        window.scrollTo = originalScrollTo;
        jest.restoreAllMocks();
        document.body.innerHTML = '';
    });

    function flushRAF() {
        const cbs = [...rAFCallbacks];
        rAFCallbacks = [];
        cbs.forEach(cb => cb());
    }

    /**
     * Helper: Emits a testable signal representing genuine user scroll interaction.
     * Unlike layout reflow or browser clamping, genuine user interaction triggers
     * input events ('wheel', 'touchmove') and can be identified without assuming current !== 0.
     */
    function dispatchUserScrollSignal(target, { axis = 'y', value = 0 } = {}) {
        const wheelEvent = new Event('wheel', { bubbles: true, cancelable: true });
        target.dispatchEvent(wheelEvent);

        const customEvent = new CustomEvent('user-scroll-interaction', {
            bubbles: true,
            cancelable: true,
            detail: { axis, value, userInitiated: true }
        });
        target.dispatchEvent(customEvent);

        if (target && target.dataset) {
            target.dataset.userInteracted = 'true';
        }
        if (target === window || !target.dataset) {
            target.__userScrollInteracted = true;
        }
    }

    // =========================================================================
    // DEFECT 1: Viewport scroll clamped without user interaction
    // =========================================================================
    describe('Defect 1: Window scroll clamped after render without user interaction', () => {
        it('restores window.scrollY to 500 when captured at 500 and clamped to 300 by browser layout', () => {
            // 1. Initial captured state: scrollY = 500, scrollX = 0
            currentX = 0;
            currentY = 500;
            saveScrollPosition();

            // 2. Schedule restore
            restoreScrollPosition();
            scrollToSpy.mockClear();

            // 3. Browser layout / DOM update clamps scroll to 300 without user interaction
            currentY = 300;

            // 4. Run deferred restoration frame
            flushRAF();

            // CONTRACT: Without user interaction, restoration must not be skipped simply
            // because currentY (300) > 0. It must restore to the captured 500.
            expect(window.scrollY).toBe(500);
            expect(scrollToSpy).toHaveBeenCalledWith(0, 500);
        });
    });

    // =========================================================================
    // DEFECT 2: Axis decoupling (scrollX must not block scrollY restoration)
    // =========================================================================
    describe('Defect 2: Independent axis restoration without X/Y coupling', () => {
        it('restores vertical scroll Y to 500 even when horizontal scroll X is non-zero', () => {
            // 1. Capture with horizontal position at 120 and vertical at 500
            currentX = 120;
            currentY = 500;
            saveScrollPosition();

            // 2. Schedule restore
            restoreScrollPosition();
            scrollToSpy.mockClear();

            // 3. Post-render state: DOM collapse resets Y to 0, while X remains 120.
            // No user interaction occurred.
            currentX = 120;
            currentY = 0;

            // 4. Run deferred restoration frame
            flushRAF();

            // CONTRACT: scrollX > 0 must not prevent restoring vertical scrollY to 500.
            expect(window.scrollY).toBe(500);
            expect(scrollToSpy).toHaveBeenCalledWith(120, 500);
        });
    });

    // =========================================================================
    // DEFECT 3: Container [data-preserve-scroll] clamped scrollTop
    // =========================================================================
    describe('Defect 3: Container [data-preserve-scroll] clamped scrollTop', () => {
        it('restores container scrollTop to 400 when clamped to 80 after DOM update', () => {
            const container = document.createElement('div');
            container.dataset.preserveScroll = 'payroll-table-container';
            container.scrollTop = 400;
            container.scrollLeft = 0;
            document.body.appendChild(container);

            // 1. Capture container scroll position
            saveScrollPosition();

            // 2. Schedule restore
            restoreScrollPosition();

            // 3. DOM update shrinks container content, browser clamps scrollTop to 80.
            // No user interaction occurred.
            container.scrollTop = 80;

            // 4. Run deferred restoration frame
            flushRAF();

            // CONTRACT: Container scroll must restore to 400 even though current scrollTop (80) > 0.
            expect(container.scrollTop).toBe(400);
        });
    });

    // =========================================================================
    // DEFECT 4: Genuine user scroll must not be overwritten, including deliberate scroll to 0
    // =========================================================================
    describe('Defect 4: Respecting genuine user scroll movement after capture', () => {
        it('does not overwrite window scroll when user deliberately scrolls to 0 after capture', () => {
            // 1. Capture position at 500
            currentX = 0;
            currentY = 500;
            saveScrollPosition();

            // 2. Schedule restore
            restoreScrollPosition();
            scrollToSpy.mockClear();

            // 3. User deliberately scrolls to 0 (top of page) accompanied by user interaction signal
            currentY = 0;
            dispatchUserScrollSignal(window, { axis: 'y', value: 0 });

            // 4. Run deferred restoration frame
            flushRAF();

            // CONTRACT: User intentionally scrolled to 0. Restoration must NOT assume
            // that (currentX === 0 && currentY === 0) means browser reset, and must NOT
            // force scroll back to 500.
            expect(window.scrollY).toBe(0);
            expect(scrollToSpy).not.toHaveBeenCalledWith(0, 500);
        });

        it('does not overwrite [data-preserve-scroll] container when user deliberately scrolls to 0', () => {
            const container = document.createElement('div');
            container.dataset.preserveScroll = 'payroll-preview-list';
            container.scrollTop = 400;
            container.scrollLeft = 0;
            document.body.appendChild(container);

            // 1. Capture position at 400
            saveScrollPosition();

            // 2. Schedule restore
            restoreScrollPosition();

            // 3. User deliberately scrolls container to 0 accompanied by user interaction signal
            container.scrollTop = 0;
            dispatchUserScrollSignal(container, { axis: 'y', value: 0 });

            // 4. Run deferred restoration frame
            flushRAF();

            // CONTRACT: User intentionally scrolled container to 0. Restoration must NOT
            // assume that scrollTop === 0 means un-restored state and overwrite it to 400.
            expect(container.scrollTop).toBe(0);
        });
    });
});
