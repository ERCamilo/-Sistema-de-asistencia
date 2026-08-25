/**
 * Boot loader lifecycle.
 *
 * This is deliberately a classic script: it must run even when the application's
 * module graph cannot be downloaded or evaluated. The module application owns
 * only the `app:ready` and `app:error` events.
 *
 * `showLoader(true)` / `hideLoader()` remain as a narrow compatibility bridge
 * for existing navigation call sites. They do not control the initial boot.
 */
(function initializeBootLoader(window, document) {
    'use strict';

    var SLOW_BOOT_MS = 5000;
    var FAILED_BOOT_MS = 15000;
    var FADE_OUT_MS = 500;

    var loader = document.getElementById('app-loader');
    if (!loader) return;

    var status = document.getElementById('app-loader-status');
    var detail = document.getElementById('app-loader-detail');
    var retry = document.getElementById('app-loader-retry');
    var simulationClose = document.getElementById('app-loader-simulation-close');
    var state = 'loading';
    var slowTimer;
    var failureTimer;
    var fadeTimer;
    var simulationSlowTimer;
    var simulationFailureTimer;

    function clearBootTimers() {
        window.clearTimeout(slowTimer);
        window.clearTimeout(failureTimer);
    }

    function clearFadeTimer() {
        window.clearTimeout(fadeTimer);
    }

    function clearSimulationTimers() {
        window.clearTimeout(simulationSlowTimer);
        window.clearTimeout(simulationFailureTimer);
    }

    function setMessage(message, explanation, recoverable) {
        if (status) status.textContent = message;
        if (detail) {
            detail.textContent = explanation || '';
            detail.hidden = !explanation;
        }
        if (retry) retry.hidden = !recoverable;
    }

    function setSimulationCloseVisible(visible) {
        if (simulationClose) simulationClose.hidden = !visible;
    }

    function showSurface() {
        clearFadeTimer();
        loader.style.display = 'flex';
        void loader.offsetWidth;
        loader.classList.remove('hidden');
    }

    function hideSurface() {
        if (loader.classList.contains('hidden')) return false;
        loader.classList.add('hidden');
        fadeTimer = window.setTimeout(function removeHiddenSurface() {
            if (loader.classList.contains('hidden')) loader.style.display = 'none';
        }, FADE_OUT_MS);
        return true;
    }

    function enterError(message) {
        if (state === 'ready' || state === 'navigation') return false;
        clearBootTimers();
        state = 'error';
        loader.dataset.loaderState = state;
        loader.setAttribute('role', 'alert');
        loader.setAttribute('aria-live', 'assertive');
        setSimulationCloseVisible(false);
        showSurface();
        setMessage(
            message || 'No pudimos iniciar la aplicación.',
            'Revisa tu conexión e inténtalo nuevamente.',
            true
        );
        return true;
    }

    function completeBoot() {
        if (state !== 'loading' && state !== 'delayed') return false;
        clearBootTimers();
        state = 'ready';
        loader.dataset.loaderState = state;
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-live', 'polite');
        return hideSurface();
    }

    function beginNavigation(message) {
        if (state !== 'ready') return false;
        state = 'navigation';
        window._isNavigating = true;
        loader.dataset.loaderState = state;
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-live', 'polite');
        setMessage(message || 'Cargando sección...', '', false);
        showSurface();
        return true;
    }

    function completeNavigation() {
        if (state !== 'navigation') return false;
        state = 'ready';
        window._isNavigating = false;
        loader.dataset.loaderState = state;
        return hideSurface();
    }

    function normalizeSimulationDelay(value, fallback) {
        var parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    }

    function isSimulationState() {
        return state.indexOf('simulation-') === 0;
    }

    function startSimulation(options) {
        if (state !== 'ready') return false;

        var settings = options || {};
        var slowDelayMs = normalizeSimulationDelay(settings.slowDelayMs, SLOW_BOOT_MS);
        var failureDelayMs = normalizeSimulationDelay(settings.failureDelayMs, FAILED_BOOT_MS);
        var reloadEnabled = settings.reloadEnabled !== false;

        clearSimulationTimers();
        state = 'simulation-loading';
        loader.dataset.loaderState = state;
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-live', 'polite');
        setMessage('Preparando tus datos...', 'Simulación activa. Permanecerá abierta hasta que la cierres.', false);
        setSimulationCloseVisible(true);
        showSurface();

        simulationSlowTimer = window.setTimeout(function announceSimulationDelay() {
            if (state !== 'simulation-loading') return;
            state = 'simulation-delayed';
            loader.dataset.loaderState = state;
            setMessage(
                'Está tardando más de lo normal...',
                'Simulación activa. Permanecerá abierta hasta que la cierres.',
                false
            );
        }, slowDelayMs);

        simulationFailureTimer = window.setTimeout(function announceSimulationError() {
            if (state !== 'simulation-loading' && state !== 'simulation-delayed') return;
            state = 'simulation-error';
            loader.dataset.loaderState = state;
            loader.setAttribute('role', 'alert');
            loader.setAttribute('aria-live', 'assertive');
            setMessage(
                'No pudimos iniciar la aplicación.',
                'Esta es una simulación. Puedes cerrarla sin afectar tus datos.',
                reloadEnabled
            );
        }, failureDelayMs);

        return true;
    }

    function stopSimulation() {
        if (!isSimulationState()) return false;
        clearSimulationTimers();
        state = 'ready';
        loader.dataset.loaderState = state;
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-live', 'polite');
        setMessage('Preparando tus datos...', '', false);
        setSimulationCloseVisible(false);
        return hideSurface();
    }

    function retryBoot() {
        window.location.reload();
    }

    loader.dataset.loaderState = state;
    if (retry) retry.onclick = retryBoot;
    if (simulationClose) simulationClose.onclick = stopSimulation;

    window.addEventListener('app:ready', completeBoot);
    window.addEventListener('app:error', function onAppError(event) {
        var message = event && event.detail && event.detail.userMessage;
        enterError(typeof message === 'string' ? message : undefined);
    });

    slowTimer = window.setTimeout(function announceSlowBoot() {
        if (state !== 'loading') return;
        state = 'delayed';
        loader.dataset.loaderState = state;
        setMessage('Está tardando más de lo normal...', '', false);
    }, SLOW_BOOT_MS);

    failureTimer = window.setTimeout(function offerBootRecovery() {
        if (state === 'loading' || state === 'delayed') enterError();
    }, FAILED_BOOT_MS);

    window.appBootLoader = Object.freeze({
        getState: function getState() { return state; },
        beginNavigation: beginNavigation,
        completeNavigation: completeNavigation,
        startSimulation: startSimulation,
        stopSimulation: stopSimulation
    });

    // Compatibility bridge for legacy navigation handlers only.
    window.showLoader = function showNavigationLoader(isNavigation) {
        return isNavigation === true ? beginNavigation() : false;
    };
    window.hideLoader = function hideNavigationLoader() {
        return completeNavigation();
    };
}(window, document));
