import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { getNfcUser, readNfcPreferences } from './NfcPreferences.js';
import { nfcEndpoint } from './NfcCore.js';

export const nfcCardIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9v6m3-6v6m4-5a3 3 0 0 1 0 4m3-7a7 7 0 0 1 0 10"/></svg>';

export function NfcEmployeeEntry(employee) {
    const id = escapeAttr(employee?.id || '');
    const config = readNfcPreferences(getNfcUser()?.uid);
    if (!config.enabled) return `<section class="employee-nfc-entry" data-nfc-editor="${id}" hidden></section>`;
    let ready = true;
    try { nfcEndpoint(config); } catch (_) { ready = false; }
    const hint = !employee?.id ? 'Guarda el empleado antes de asociar una tarjeta.' : !ready ? 'Configura una URL válida en Ajustes → Pruebas.' : 'Registro experimental en el webhook elegido.';
    return `<section class="employee-nfc-entry" data-nfc-editor="${id}"><button type="button" data-nfc-employee="${id}" ${employee?.id && ready ? '' : 'disabled'}>${nfcCardIcon}<span>Asociar tarjeta NFC</span></button><small>${hint}</small></section>`;
}

export function NfcSettingsFields() {
    const uid = getNfcUser()?.uid || '';
    const config = readNfcPreferences(uid);
    const current = document.querySelector('[data-nfc-settings-owner]');
    // Preserve an unfinished URL through unrelated application renders, within the same account only.
    const draft = current?.dataset.nfcSettingsOwner === uid ? current.querySelector('[data-nfc-setting="customUrl"]')?.value : null;
    const feedback = current?.dataset.nfcSettingsOwner === uid ? current.querySelector('[data-nfc-settings-status]')?.textContent || '' : '';
    let endpoint;
    try { endpoint = nfcEndpoint(config); } catch (_) { endpoint = 'Escribe y guarda una URL HTTPS.'; }
    return `<div class="nfc-settings-fields" data-nfc-settings-owner="${escapeAttr(uid)}"><label class="stg-switch-row ${config.enabled ? 'is-active' : ''}" role="switch" aria-checked="${config.enabled}"><input type="checkbox" data-nfc-setting="enabled" ${config.enabled ? 'checked' : ''} ${uid ? '' : 'disabled'}><span class="stg-switch-copy"><strong>Activar asociación de tarjetas</strong><small>Habilita NFC en el editor de cada empleado.</small></span><span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span></label>${uid ? '' : '<p>Inicia sesión para activar las asociaciones.</p>'}<label for="nfc-destination">Destino de registro</label><select id="nfc-destination" data-nfc-setting="mode" ${uid ? '' : 'disabled'}>${[['test','Test'],['production','Producción'],['custom','Personalizado']].map(([value,label])=>`<option value="${value}" ${config.mode===value?'selected':''}>${label}</option>`).join('')}</select><div ${config.mode==='custom'?'':'hidden'}><label for="nfc-custom-url">Webhook personalizado</label><input id="nfc-custom-url" data-nfc-setting="customUrl" type="url" inputmode="url" value="${escapeAttr(draft ?? config.customUrl)}" placeholder="https://…/webhook/…" autocomplete="off" spellcheck="false"><button type="button" data-nfc-setting-action="save-url">Guardar URL</button></div><small class="nfc-endpoint">${escapeHTML(endpoint)}</small><small>Configuración local para esta cuenta y navegador. El destino recibe la identidad de la cuenta para validar el registro.</small><p data-nfc-settings-status role="status" aria-live="polite">${escapeHTML(feedback)}</p></div>`;
}

export function nfcEmployeeSummary(employee, config) {
    return `<div class="nfc-person"><strong>${escapeHTML(employee.name)}</strong><span>N.º ${escapeHTML(employee.number ?? '')}</span></div><span class="nfc-mode">${config.mode==='production'?'Producción':config.mode==='custom'?'Personalizado':'Test'}</span><small class="nfc-endpoint">${escapeHTML(nfcEndpoint(config))}</small>`;
}
