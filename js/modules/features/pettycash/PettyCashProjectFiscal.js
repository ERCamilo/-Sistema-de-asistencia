/**
 * PettyCashProjectFiscal.js — Datos fiscales de cada proyecto de caja chica.
 *
 *   companyRnc       RNC de la empresa que factura en este proyecto. Con él,
 *                    las facturas de crédito fiscal (B01/E31) deben estar a
 *                    su nombre (PettyCashReceiptChecks: 'client-rnc').
 *   consumerNoteMin  Desde qué total se anuncian las facturas de consumo
 *                    (B02/E32, no dan crédito fiscal). 0 = en todas.
 *
 * Se editan desde Caja chica (botón "Datos fiscales" del proyecto) y viajan
 * con el proyecto como cualquier otro dato suyo.
 *
 * Probado en js/tests/PettyCashProjectFiscal.test.js.
 */
import { isValidRnc } from './PettyCashReceiptChecks.js';

const digits = (value) => String(value ?? '').replace(/\D/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Lo que usan las revisiones de la factura. */
export function projectFiscal(project) {
    const min = Number(project?.consumerNoteMin);
    return {
        companyRnc: digits(project?.companyRnc),
        consumerNoteMin: Number.isFinite(min) && min > 0 ? min : 0
    };
}

export function projectFiscalFormHTML(project = {}) {
    const { companyRnc, consumerNoteMin } = projectFiscal(project);
    const above = consumerNoteMin > 0;
    const field = 'width:100%;box-sizing:border-box;padding:10px 12px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:0.95rem;';
    const option = (value, checked, label) => `<label style="display:flex;align-items:center;gap:8px;color:#e2e8f0;font-size:0.9rem;min-height:36px;">
                <input type="radio" name="consumerNote" value="${value}" ${checked ? 'checked' : ''}> ${label}</label>`;
    return `
        <div style="display:flex;flex-direction:column;gap:14px;">
            <div>
                <label for="pc-fiscal-rnc" style="display:block;font-weight:700;color:#e2e8f0;margin-bottom:6px;">RNC de la empresa</label>
                <input id="pc-fiscal-rnc" data-fiscal-rnc inputmode="numeric" autocomplete="off" placeholder="RNC o cédula" value="${esc(companyRnc)}" style="${field}">
                <small style="display:block;color:#94a3b8;margin-top:6px;line-height:1.45;">Las facturas de crédito fiscal (B01 o E31) de este proyecto deben estar a nombre de este RNC. Déjalo vacío para no revisarlo.</small>
            </div>
            <fieldset style="border:0;padding:0;margin:0;">
                <legend style="font-weight:700;color:#e2e8f0;margin-bottom:6px;">Anunciar facturas de consumo (B02 o E32)</legend>
                <small style="display:block;color:#94a3b8;margin-bottom:6px;line-height:1.45;">No dan crédito fiscal. La nota recuerda pedir factura con el RNC de la empresa.</small>
                ${option('all', !above, 'En todas')}
                ${option('above', above, 'Solo en facturas mayores a')}
                <input data-fiscal-min aria-label="Monto mínimo para anunciar" inputmode="decimal" placeholder="RD$ 0.00" value="${above ? esc(consumerNoteMin) : ''}" style="${field}margin-top:4px;">
            </fieldset>
            <p data-fiscal-error role="alert" style="margin:0;color:#fca5a5;font-size:0.85rem;" hidden></p>
        </div>`;
}

/** Valida el formulario y devuelve el cambio para el proyecto. */
export function readProjectFiscalForm(root) {
    const rnc = digits(root.querySelector('[data-fiscal-rnc]')?.value);
    if (rnc && !isValidRnc(rnc)) return { ok: false, field: 'rnc', error: 'El RNC no es válido: revisa los dígitos.' };
    const above = root.querySelector('input[name="consumerNote"]:checked')?.value === 'above';
    let consumerNoteMin = 0;
    if (above) {
        consumerNoteMin = Number(String(root.querySelector('[data-fiscal-min]')?.value ?? '').replace(/[^\d.]/g, ''));
        if (!Number.isFinite(consumerNoteMin) || consumerNoteMin <= 0) return { ok: false, field: 'min', error: 'Escribe un monto mayor que cero.' };
    }
    return { ok: true, patch: { companyRnc: rnc, consumerNoteMin } };
}
