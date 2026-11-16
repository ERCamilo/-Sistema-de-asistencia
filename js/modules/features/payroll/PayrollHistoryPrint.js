import { renderPayrollHistoryDetail } from './PayrollHistoryUI.js';
import { escapeHTML } from '../../utils/Sanitize.js';

// Self-contained report: no current payroll calculation, remote assets or storage writes.
export function buildPayrollHistoryPrintDocument(closure, { leaderId = '' } = {}) {
    if (!closure || !Array.isArray(closure.rows)) {
        throw new Error('No hay un cierre completo para imprimir.');
    }
    const title = `Cierre de nómina · ${closure.periodStart} – ${closure.periodEnd}`;
    const content = renderPayrollHistoryDetail(closure, {
        detailFilters: { leaderId }, readOnly: true, forPrint: true
    });
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHTML(title)}</title>
        <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 24px; background: white; color: #111; font: 10pt/1.4 Arial, sans-serif; }
            h1 { margin: 0 0 4px; font-size: 18pt; } h2 { margin: 4px 0; font-size: 14pt; }
            p { margin: 5px 0; } small { font-size: 9pt; }
            .print-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 20px; }
            .print-controls button { min-height: 44px; padding: 8px 16px; border: 1px solid #111; border-radius: 8px; background: #111; color: white; font: inherit; cursor: pointer; }
            .print-controls span { color: #444; }
            .print-reference { color: #444; overflow-wrap: anywhere; }
            .payroll-history-detail__header { margin-top: 16px; }
            .payroll-history-card__status { font-weight: bold; text-transform: uppercase; }
            .is-voided { border: 2px solid #111; padding: 2px 8px; }
            .payroll-history-detail__notice { margin: 12px 0; padding: 8px; border: 1px solid #999; }
            .payroll-history-detail__totals { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 12px 0; }
            .payroll-history-detail__totals small, .payroll-history-detail__totals strong { display: block; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 16px; }
            th, td { padding: 7px 5px; border-bottom: 1px solid #999; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
            thead { display: table-header-group; } thead th { border-bottom: 2px solid #111; }
            th:first-child { width: 22%; text-align: left; } th:nth-child(2), td:nth-child(2) { width: 22%; text-align: left; }
            th small, td small { display: block; font-weight: normal; color: #444; }
            tr { break-inside: avoid; } .is-net { font-weight: bold; }
            .payroll-leader-adjustment { margin: 16px 0; padding: 8px; border: 1px solid #999; }
            .payroll-leader-adjustment__heading label, .payroll-leader-adjustment svg { display: none; }
            .payroll-leader-adjustment__heading { font-weight: bold; }
            .payroll-leader-adjustment article { padding: 6px 0; border-bottom: 1px solid #ccc; break-inside: avoid; }
            .payroll-leader-adjustment article span { display: block; }
            .payroll-leader-adjustment__balance { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 8px; }
            summary { list-style: none; } summary > span { margin-right: 12px; }
            @media screen { .payroll-history-detail__table-wrap { overflow-x: auto; } table { min-width: 760px; } }
            @media print { body { margin: 0; } .print-controls { display: none; } }
        </style></head><body>
        <nav class="print-controls" aria-label="Impresión">
            <button type="button" data-print-history>Imprimir</button>
            <span>También puedes elegir Guardar como PDF en la ventana de impresión.</span>
        </nav>
        <main><h1>Cierre de nómina</h1>
            <p class="print-reference">Referencia: ${escapeHTML(String(closure.id || 'Sin referencia'))}</p>
            ${content}
        </main></body></html>`;
}

export function printPayrollHistoryClosure(closure, options = {}) {
    // Capture the loaded historical record before opening a window. Filters or
    // employee edits made afterwards cannot replace the report's frozen data.
    const html = buildPayrollHistoryPrintDocument(closure, options);
    const report = window.open('', '_blank');
    if (!report) throw new Error('El navegador bloqueó la impresión. Permite abrir la ventana e inténtalo de nuevo.');
    try {
        report.opener = null;
        report.document.open();
        report.document.write(html);
        report.document.close();
        const expandDetails = () => report.document.querySelectorAll('details').forEach(node => { node.open = true; });
        report.addEventListener?.('beforeprint', expandDetails);
        const print = () => {
            if (report.closed) return;
            try { expandDetails(); report.focus(); report.print(); }
            catch (_) {
                // Keep the report available if automatic printing is unsupported.
                report.document.querySelector('.print-controls span').textContent =
                    'No se abrió la impresión automática. Usa Imprimir o la opción de impresión del navegador.';
            }
        };
        report.document.querySelector('[data-print-history]').addEventListener('click', print);
        report.requestAnimationFrame(() => report.requestAnimationFrame(print));
        return report;
    } catch (error) {
        report.close();
        throw error;
    }
}
