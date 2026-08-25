import fs from 'fs';
import path from 'path';

const BOOT_LOADER_PATH = path.resolve(__dirname, '../boot-loader.js');
const INDEX_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const SERVICE_WORKER_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');

function mountLoader() {
    document.body.innerHTML = `
        <div id="app-loader" role="status" aria-live="polite" aria-label="Preparando tus datos">
            <div class="loader-content">
                <div class="loader-dots"></div>
                <div id="app-loader-status" class="loader-text">Preparando tus datos...</div>
                <p id="app-loader-detail" class="loader-detail" hidden></p>
                <button id="app-loader-retry" class="loader-retry" type="button" hidden>Recargar aplicación</button>
                <button id="app-loader-simulation-close" class="loader-retry" type="button" hidden>Cerrar simulación</button>
            </div>
        </div>`;
}

function executeController() {
    const source = fs.readFileSync(BOOT_LOADER_PATH, 'utf8');
    new Function('window', 'document', source)(window, document);
}

describe('BootLoader', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mountLoader();
        delete window.appBootLoader;
        delete window.showLoader;
        delete window.hideLoader;
        delete window._isNavigating;
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    test('se carga antes del módulo principal y app.js solo publica el contrato de arranque', () => {
        expect(INDEX_SOURCE).toMatch(/<script src="js\/boot-loader\.js"><\/script>\s*<script type="module" src="js\/app\.js"><\/script>/);
        expect(APP_SOURCE).toContain("new CustomEvent('app:ready'");
        expect(APP_SOURCE).toContain("new CustomEvent('app:error'");
        expect(APP_SOURCE).not.toContain("document.getElementById('app-loader')");
        expect(APP_SOURCE).not.toMatch(/loaderTimeout|2500/);
        expect(APP_SOURCE).not.toMatch(/startSimulation|simulation-loading/);
        expect(SERVICE_WORKER_SOURCE).toContain("'./js/boot-loader.js'");
    });

    test('mantiene visible el arranque, informa demora y ofrece recuperación si nunca llega ready', () => {
        executeController();
        const loader = document.getElementById('app-loader');
        const status = document.getElementById('app-loader-status');
        const retry = document.getElementById('app-loader-retry');

        expect(loader.dataset.loaderState).toBe('loading');
        expect(loader.classList.contains('hidden')).toBe(false);

        jest.advanceTimersByTime(5000);
        expect(loader.dataset.loaderState).toBe('delayed');
        expect(status.textContent).toBe('Está tardando más de lo normal...');
        expect(retry.hidden).toBe(true);

        jest.advanceTimersByTime(10000);
        expect(loader.dataset.loaderState).toBe('error');
        expect(status.textContent).toBe('No pudimos iniciar la aplicación.');
        expect(retry.hidden).toBe(false);
        expect(typeof retry.onclick).toBe('function');
    });

    test('app:ready cancela la demora y completa el fade antes de retirar la superficie', () => {
        executeController();
        const loader = document.getElementById('app-loader');

        window.dispatchEvent(new CustomEvent('app:ready'));

        expect(loader.dataset.loaderState).toBe('ready');
        expect(loader.classList.contains('hidden')).toBe(true);
        expect(loader.style.display).not.toBe('none');

        jest.advanceTimersByTime(500);
        expect(loader.style.display).toBe('none');

        jest.advanceTimersByTime(15000);
        expect(loader.dataset.loaderState).toBe('ready');
    });

    test('app:error conserva una salida visible, accesible y recuperable', () => {
        executeController();
        const loader = document.getElementById('app-loader');
        const detail = document.getElementById('app-loader-detail');
        const retry = document.getElementById('app-loader-retry');

        window.dispatchEvent(new CustomEvent('app:error'));

        expect(loader.dataset.loaderState).toBe('error');
        expect(loader.getAttribute('role')).toBe('alert');
        expect(loader.classList.contains('hidden')).toBe(false);
        expect(detail.hidden).toBe(false);
        expect(retry.hidden).toBe(false);
    });

    test('la compatibilidad de navegación no puede cerrar ni reiniciar el arranque inicial', () => {
        executeController();
        const loader = document.getElementById('app-loader');

        expect(window.hideLoader()).toBe(false);
        expect(loader.dataset.loaderState).toBe('loading');

        window.dispatchEvent(new CustomEvent('app:ready'));
        jest.advanceTimersByTime(500);
        expect(window.showLoader(true)).toBe(true);
        expect(loader.dataset.loaderState).toBe('navigation');
        expect(loader.style.display).toBe('flex');
        expect(window._isNavigating).toBe(true);

        window._isNavigating = false;
        expect(window.hideLoader()).toBe(true);
        expect(loader.classList.contains('hidden')).toBe(true);
    });

    test('la simulación usa tiempos temporales, queda detenida y puede ocultar la recarga', () => {
        executeController();
        const loader = document.getElementById('app-loader');
        const status = document.getElementById('app-loader-status');
        const retry = document.getElementById('app-loader-retry');
        const close = document.getElementById('app-loader-simulation-close');

        window.dispatchEvent(new CustomEvent('app:ready'));
        jest.advanceTimersByTime(500);

        expect(window.appBootLoader.startSimulation({
            slowDelayMs: 100,
            failureDelayMs: 250,
            reloadEnabled: false
        })).toBe(true);
        expect(loader.dataset.loaderState).toBe('simulation-loading');
        expect(close.hidden).toBe(false);

        jest.advanceTimersByTime(100);
        expect(loader.dataset.loaderState).toBe('simulation-delayed');
        expect(status.textContent).toBe('Está tardando más de lo normal...');

        jest.advanceTimersByTime(150);
        expect(loader.dataset.loaderState).toBe('simulation-error');
        expect(retry.hidden).toBe(true);
        expect(close.hidden).toBe(false);

        jest.advanceTimersByTime(10000);
        expect(loader.dataset.loaderState).toBe('simulation-error');
    });

    test('cerrar una simulación cancela sus timers y restaura el loader listo', () => {
        executeController();
        const loader = document.getElementById('app-loader');
        const retry = document.getElementById('app-loader-retry');
        const close = document.getElementById('app-loader-simulation-close');

        window.dispatchEvent(new CustomEvent('app:ready'));
        jest.advanceTimersByTime(500);
        window.appBootLoader.startSimulation({
            slowDelayMs: 100,
            failureDelayMs: 200,
            reloadEnabled: true
        });
        jest.advanceTimersByTime(200);
        expect(retry.hidden).toBe(false);

        close.click();
        expect(loader.dataset.loaderState).toBe('ready');
        expect(loader.classList.contains('hidden')).toBe(true);
        expect(close.hidden).toBe(true);
        expect(retry.hidden).toBe(true);

        jest.advanceTimersByTime(500);
        expect(loader.style.display).toBe('none');
    });
});
