/**
 * 📊 LazyExcelJS — On-demand loader for the ExcelJS UMD bundle.
 *
 * ExcelJS is a ~2 MB script that takes ~1.2s to parse on a mid-range CPU.
 * Before this module it was loaded eagerly from <script src=...> in index.html,
 * which added ~5 seconds to first paint (the bundle plus its 3 anonymous IIFE
 * top-level functions showed up in DevTools Performance as the four largest
 * blocking-script entries on every page load).
 *
 * Now the <script> tag is removed and `ensureExcelJSLoaded()` injects it on
 * the first call. Subsequent calls return immediately. Concurrent calls
 * await the same in-flight promise (no duplicate loads).
 *
 * Usage:
 *   await ensureExcelJSLoaded();
 *   const workbook = new window.ExcelJS.Workbook();
 *
 * @returns {Promise<void>} resolves when window.ExcelJS is ready
 */

const SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js';

let _loadPromise = null;

export function ensureExcelJSLoaded() {
    // Already loaded
    if (typeof window !== 'undefined' && window.ExcelJS) {
        return Promise.resolve();
    }
    // Load in progress — share the promise
    if (_loadPromise) {
        return _loadPromise;
    }

    _loadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = () => {
            if (window.ExcelJS) {
                resolve();
            } else {
                reject(new Error('ExcelJS loaded but window.ExcelJS is undefined'));
            }
        };
        script.onerror = () => {
            _loadPromise = null; // Allow retry
            reject(new Error('Failed to load ExcelJS from CDN'));
        };
        document.head.appendChild(script);
    });

    return _loadPromise;
}

/**
 * Returns true if ExcelJS is currently available in window (no network call).
 * Useful for UIs that want to conditionally render a "loading..." state.
 */
export function isExcelJSReady() {
    return typeof window !== 'undefined' && !!window.ExcelJS;
}
