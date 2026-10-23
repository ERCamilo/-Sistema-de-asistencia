import { ProjectReadOnlyContext } from './ProjectReadOnlyContext.js';
import { attachProjectDialogA11y } from './ProjectDialogA11y.js';

const labels = { employees: 'Personal', positions: 'Puestos', leaders: 'Líderes', attendance: 'Asistencia', loans: 'Préstamos', payrollClosures: 'Cierres de nómina', pettyCashProjects: 'Cajas', pettyCashPeriods: 'Períodos de caja', pettyCashMovements: 'Movimientos de caja' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const display = value => value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
function csvCell(value) {
    let text = display(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}
export function projectHistoryCSV(snapshot) {
    const output = [['Obra', 'Sección', 'Registro', 'Campo', 'Valor']];
    for (const [section, records] of Object.entries(snapshot.sections)) records.forEach((record, index) => {
        for (const [field, value] of Object.entries(record)) output.push([snapshot.project.name, labels[section] || section, record.id || index + 1, field, value]);
    });
    return '\uFEFF' + output.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function renderProjectHistory(snapshot) {
    return `<h2>Historial: ${esc(snapshot.project.name)}</h2><p>Consulta de solo lectura · ${esc(snapshot.project.status)} · Registros guardados en este dispositivo.</p>${Object.entries(snapshot.sections).map(([key, records]) => `<section><h3>${labels[key] || esc(key)} (${records.length})</h3>${records.length ? records.map(record => `<details><summary>${esc(record.name || record.date || record.id || record.employeeId || 'Registro')}</summary><dl>${Object.entries(record).map(([field, value]) => `<dt>${esc(field)}</dt><dd>${esc(display(value))}</dd>`).join('')}</dl></details>`).join('') : '<p>Sin registros.</p>'}</section>`).join('')}`;
}
export async function openProjectHistory(projectId, { context = new ProjectReadOnlyContext(), doc = document } = {}) {
    const snapshot = await context.open(projectId);
    doc.getElementById('project-history-modal')?.remove();
    const overlay = doc.createElement('div');
    overlay.id = 'project-history-modal';
    overlay.className = 'project-shell-overlay';
    overlay.innerHTML = `<section class="project-shell" role="dialog" aria-modal="true" aria-label="Historial de obra"><header class="project-shell-header"><button type="button" data-history-csv>Exportar CSV</button><button type="button" data-history-print>Imprimir</button><button type="button" data-history-close>Cerrar</button></header><div class="project-shell-body">${renderProjectHistory(snapshot)}</div></section>`;
    doc.body.appendChild(overlay);
    let detach;
    const close = () => { detach?.(); overlay.remove(); };
    detach = attachProjectDialogA11y(overlay, { onEscape: close });
    overlay.querySelector('[data-history-close]').onclick = close;
    overlay.querySelector('[data-history-csv]').onclick = () => {
        const url = URL.createObjectURL(new Blob([projectHistoryCSV(snapshot)], { type: 'text/csv;charset=utf-8' }));
        const link = doc.createElement('a');
        link.href = url; link.download = `historial-${snapshot.project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    overlay.querySelector('[data-history-print]').onclick = () => {
        const popup = doc.defaultView.open('', '_blank');
        if (!popup) { doc.defaultView.showNotification?.('Permite ventanas emergentes para imprimir.', 'warning'); return; }
        popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Historial de obra</title><style>body{font:14px sans-serif}dd{white-space:pre-wrap;overflow-wrap:anywhere}section{break-inside:avoid}</style></head><body>${renderProjectHistory(snapshot)}</body></html>`);
        popup.document.close();
        popup.document.querySelectorAll('details').forEach(item => { item.open = true; });
        popup.focus(); popup.print();
    };
    return { snapshot, close };
}
