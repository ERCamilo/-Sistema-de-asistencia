/**
 * 🧪 RenderBatchingTests — Performance regression tests for AppState render scheduling.
 *
 * What this test locks in:
 *
 *   1. Proxy-driven state mutations schedule `window.render` ONCE per mutation,
 *      but the renderOptimizer's queue dedupes by function reference.
 *      Net effect: N mutations within the same tick → 1 entry in the queue
 *      → 1 actual render call on the next animation frame.
 *
 *   2. `stateManager.batchSetState(cb)` suppresses scheduling DURING the
 *      callback (proxy setters skip `scheduleRender` because the manager is
 *      "silent"). After the callback, a single `scheduleRender` is fired.
 *      Net effect: N mutations inside batchSetState → 0 schedule calls during
 *      the batch + 1 schedule call after = 1 schedule call total.
 *
 * Why this matters: a regression here (e.g. someone removes the dedup, or
 * silent-mode stops suppressing the proxy) would cause render() to fire
 * once per state mutation. With 20+ mutations during attendance load, that
 * would be 20× the render work. These assertions catch it.
 */

import { state, stateManager, renderOptimizer } from '../modules/core/AppState.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

let scheduleCallCount = 0;
let queueLengthAfterMutations = 0;
let originalScheduleRender = null;

function installScheduleSpy() {
    originalScheduleRender = renderOptimizer.scheduleRender.bind(renderOptimizer);
    renderOptimizer.scheduleRender = function spy(cb) {
        scheduleCallCount++;
        return originalScheduleRender(cb);
    };
}

function uninstallScheduleSpy() {
    if (originalScheduleRender) {
        renderOptimizer.scheduleRender = originalScheduleRender;
        originalScheduleRender = null;
    }
}

function reset() {
    scheduleCallCount = 0;
    queueLengthAfterMutations = 0;
    // Flush any pending queued renders from a previous test
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    renderOptimizer._lastRender = 0;
}

// ─────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("AppState — Render batching & dedup", {

    "proxy schedules render on every mutation (no dedup at call site)"() {
        installScheduleSpy();
        try {
            reset();
            state.activeTab = 'analytics';
            state.viewMode = 'week';
            state.showFilters = true;

            // The PROXY calls scheduleRender per mutation — no caller-side dedup.
            // The queue itself does dedup, but that's a separate concern.
            testRunner.assertEquals(
                scheduleCallCount,
                3,
                "Expected 3 scheduleRender calls (1 per mutation)"
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "renderQueue dedupes window.render by reference"() {
        installScheduleSpy();
        try {
            reset();
            // Three rapid mutations — proxy calls scheduleRender 3 times.
            state.activeTab = 'employees';
            state.viewMode = 'day';
            state.showFilters = false;

            // BUT the queue should only contain window.render once.
            testRunner.assertEquals(
                renderOptimizer._renderQueue.length,
                1,
                "Queue should dedupe to 1 entry even after 3 scheduleRender calls"
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "batchSetState suppresses per-mutation scheduling"() {
        installScheduleSpy();
        try {
            reset();
            stateManager.batchSetState(() => {
                state.activeTab = 'payroll';
                state.viewMode = 'month';
                state.showFilters = true;
                state.showLegend = true;
                state.bottomNavHidden = true;
            });

            // 5 mutations inside batchSetState should produce exactly 1
            // scheduleRender call (the one fired by batchSetState itself at the end).
            testRunner.assertEquals(
                scheduleCallCount,
                1,
                "Expected exactly 1 scheduleRender after 5 batched mutations"
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "batchSetState resets silent flag even when callback throws"() {
        installScheduleSpy();
        try {
            reset();
            let threw = false;
            try {
                stateManager.batchSetState(() => {
                    state.activeTab = 'attendance';
                    throw new Error('boom');
                });
            } catch (e) {
                threw = e.message === 'boom';
            }
            testRunner.assert(threw, "Error should have propagated");

            // After the failed batch, silent must be false again
            testRunner.assertEquals(
                stateManager.isSilent(),
                false,
                "isSilent() must be false after a thrown batch"
            );

            // And subsequent mutations should resume normal scheduling
            scheduleCallCount = 0;
            state.viewMode = 'day';
            testRunner.assertEquals(
                scheduleCallCount,
                1,
                "Post-throw mutation should schedule a render normally"
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "setting a value to the same value does NOT schedule a render"() {
        installScheduleSpy();
        try {
            reset();
            // Pre-set
            state.activeTab = 'attendance';
            scheduleCallCount = 0;

            // Setting to the same value should be a no-op per the proxy guard
            // (oldValue !== value check)
            state.activeTab = 'attendance';

            testRunner.assertEquals(
                scheduleCallCount,
                0,
                "Same-value assignment must not schedule a render"
            );
        } finally {
            uninstallScheduleSpy();
        }
    }
});

console.log('🧪 RenderBatching tests cargados.');
