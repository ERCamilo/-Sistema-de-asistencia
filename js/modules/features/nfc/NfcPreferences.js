import { normalizeNfcEndpoint } from './NfcCore.js';

export const NFC_PREFS_PREFIX = 'sa-nfc-preferences:v1:';
export const NFC_PREFS_EVENT = 'sa:nfc-preferences';
let getUser = () => null;
export function nfcStorage() { try { return globalThis.localStorage; } catch (_) { return null; } }
export function configureNfcIdentity(provider) { getUser = provider; }
export function getNfcUser() { return getUser(); }

export function readNfcPreferences(ownerUid, storage = nfcStorage()) {
    const defaults = { enabled: false, mode: 'test', customUrl: '' };
    if (!ownerUid) return defaults;
    try {
        const data = JSON.parse(storage?.getItem(NFC_PREFS_PREFIX + ownerUid) || 'null');
        if (!data || typeof data !== 'object') return defaults;
        return { enabled: data.enabled === true, mode: ['test', 'production', 'custom'].includes(data.mode) ? data.mode : 'test', customUrl: typeof data.customUrl === 'string' ? data.customUrl : '' };
    } catch (_) { return defaults; }
}

export function saveNfcPreferences(ownerUid, patch, storage = nfcStorage()) {
    if (!ownerUid) throw Error('Inicia sesión para configurar las asociaciones NFC.');
    if ('mode' in patch && !['test', 'production', 'custom'].includes(patch.mode)) throw Error('Elige Test, Producción o Personalizado.');
    const next = { ...readNfcPreferences(ownerUid, storage), ...patch };
    if ('customUrl' in patch) next.customUrl = normalizeNfcEndpoint(patch.customUrl);
    const data = { enabled: next.enabled === true, mode: next.mode, customUrl: next.customUrl };
    try { if (!storage) throw Error(); storage.setItem(NFC_PREFS_PREFIX + ownerUid, JSON.stringify(data)); }
    catch (_) { throw Error('No se pudo guardar la configuración en este navegador.'); }
    globalThis.window?.dispatchEvent(new CustomEvent(NFC_PREFS_EVENT));
    return data;
}
