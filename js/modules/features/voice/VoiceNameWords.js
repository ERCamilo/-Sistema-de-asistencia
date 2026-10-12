import { escapeHTML } from '../../utils/Sanitize.js';
import { normalizeVoiceName, resolveVoiceEmployees } from './VoiceMatching.js';

export function transcriptWords(text) {
    return String(text || '').match(/[\p{L}\p{M}\p{N}]+(?:[’'−-][\p{L}\p{M}\p{N}]+)*/gu) || [];
}
export function selectedTranscriptName(words, indexes) {
    const selected = new Set(indexes);
    return words.filter((_, index) => selected.has(index)).join(' ');
}
// Suggestions only: never assign an employee or rewrite Gemini's response.
export function suggestTranscriptNames(text, employees, aliases = []) {
    const ignored = new Set('prestamo prestamos caja chica monto pesos dolares interes cuota cuotas buscar busca dale darle para por con hoy ayer mañana pago pagar gasto compra registrar registra factura concepto nota ciento mil'.split(' '));
    const words = transcriptWords(text);
    const queries = new Map();
    for (const word of words) {
        const key = normalizeVoiceName(word);
        if (key.length >= 3 && /\p{L}/u.test(key) && !ignored.has(key) && !queries.has(key)) queries.set(key, word);
        if (queries.size >= 80) break;
    }
    return [...queries.values()].map(name => ({ name, matches: resolveVoiceEmployees({ spokenName: name }, employees, aliases) }))
        .filter(item => item.matches[0]?.score >= .8)
        .sort((a, b) => b.matches[0].score - a.matches[0].score).slice(0, 6);
}
export function VoiceNameWords(ui, button) {
    const picker = ui.nameWordPicker;
    if (!picker || picker.requestId !== ui.record.requestId || picker.transcript !== ui.record.transcript) return button('name-words', 'Elegir nombre del audio', ui.busy);
    const selected = selectedTranscriptName(picker.words, picker.indexes);
    return `<section class="voice-name-words" aria-label="Elegir nombre del audio"><h3>¿Qué palabras son el nombre?</h3>${picker.suggestions.length ? `<div class="voice-name-suggestions"><span>Posibles nombres</span>${picker.suggestions.map((item, index) => button('name-suggestion', escapeHTML(item.name), ui.busy, String(index))).join('')}</div>` : ''}<div class="voice-word-chips">${picker.words.map((word, index) => button('name-word', escapeHTML(word), ui.busy, String(index)).replace('<button ', `<button aria-pressed="${picker.indexes.includes(index)}" `)).join('')}</div><p aria-live="polite">${escapeHTML(selected || 'Marca una o varias palabras')}</p>${button('name-apply', 'Buscar coincidencias', ui.busy || !selected)}${button('name-reset', 'Limpiar', ui.busy || !selected)}${button('name-close', 'Cerrar selección', ui.busy)}</section>`;
}
