/**
 * 📦 LazyCDN — On-demand loaders for heavy 3rd-party scripts.
 *
 * Companion to LazyExcelJS.js. Each library that used to be loaded
 * eagerly via <script src=...> in index.html now has its own loader
 * exported here. Initial page parse drops by the combined size of all
 * deferred libraries (~500 KB-1.5 MB depending on which user actually
 * needs which feature).
 *
 * All loaders share the same shape: cache a single Promise the first
 * call kicks off, return the same Promise on concurrent calls, return
 * an immediately-resolved Promise once the global is available.
 */

function loadScript(url, isLoaded) {
    return new Promise((resolve, reject) => {
        if (isLoaded()) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => {
            if (isLoaded()) {
                resolve();
            } else {
                reject(new Error(`Script loaded but global not found: ${url}`));
            }
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
        document.head.appendChild(script);
    });
}

// ─── jsPDF (with auto-table plugin) ──────────────────────────────────────────
// The plugin must load AFTER the base library — it extends jsPDF.prototype.

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';

let _jsPDFPromise = null;
export function ensureJsPDFLoaded() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) {
        return Promise.resolve();
    }
    if (_jsPDFPromise) return _jsPDFPromise;

    _jsPDFPromise = loadScript(JSPDF_URL, () => !!(window.jspdf && window.jspdf.jsPDF))
        .then(() => loadScript(JSPDF_AUTOTABLE_URL, () => !!(window.jspdf?.jsPDF?.API?.autoTable)))
        .catch(err => {
            _jsPDFPromise = null; // Allow retry
            throw err;
        });
    return _jsPDFPromise;
}

// ─── html2canvas ─────────────────────────────────────────────────────────────

const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

let _html2canvasPromise = null;
export function ensureHtml2CanvasLoaded() {
    if (typeof window.html2canvas === 'function') return Promise.resolve();
    if (_html2canvasPromise) return _html2canvasPromise;
    _html2canvasPromise = loadScript(HTML2CANVAS_URL, () => typeof window.html2canvas === 'function')
        .catch(err => { _html2canvasPromise = null; throw err; });
    return _html2canvasPromise;
}

// ─── Chart.js ────────────────────────────────────────────────────────────────
// Used by AnalyticsUI for dashboard charts. The Analytics tab is not the
// default tab on boot, so deferring is safe.

const CHARTJS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';

let _chartJsPromise = null;
export function ensureChartJsLoaded() {
    if (typeof window.Chart === 'function') return Promise.resolve();
    if (_chartJsPromise) return _chartJsPromise;
    _chartJsPromise = loadScript(CHARTJS_URL, () => typeof window.Chart === 'function')
        .catch(err => { _chartJsPromise = null; throw err; });
    return _chartJsPromise;
}
