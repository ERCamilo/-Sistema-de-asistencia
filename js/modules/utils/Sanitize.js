/**
 * 🛡️ Sanitize.js - Helpers de sanitización de HTML
 *
 * Evita inyección de HTML/XSS cuando interpolas datos de usuario
 * (nombres, notas, descripciones) dentro de template literals.
 *
 * Uso:
 *   import { escapeHTML, escapeAttr } from '../utils/Sanitize.js';
 *
 *   // Contenido de texto:
 *   return `<div>${escapeHTML(emp.name)}</div>`;
 *
 *   // Dentro de atributos HTML:
 *   return `<input value="${escapeAttr(emp.notes)}">`;
 *
 *   // Atajo: convierte cualquier valor a string seguro (texto)
 *   safeText(undefined) → ''
 *   safeText(null) → ''
 *   safeText('<script>') → '&lt;script&gt;'
 */

const ENTITY_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

const HTML_ESCAPE_RE = /[&<>"']/g;

/**
 * Escapa caracteres HTML peligrosos para uso seguro en contenido de texto.
 * @param {any} input - El valor a escapar (se convierte a string)
 * @returns {string} Cadena segura para interpolar en HTML
 */
export function escapeHTML(input) {
    if (input === null || input === undefined) return '';
    return String(input).replace(HTML_ESCAPE_RE, (ch) => ENTITY_MAP[ch]);
}

/**
 * Alias específico para atributos (mismo comportamiento, intención semántica).
 * Útil para hacer explícito el destino en el código.
 */
export const escapeAttr = escapeHTML;

/**
 * Atajo: como escapeHTML pero más conveniente para textos opcionales.
 * Devuelve '' para null/undefined sin lanzar errores.
 */
export function safeText(input) {
    return escapeHTML(input);
}

// Exponer en window para uso desde código legacy (templates inline)
if (typeof window !== 'undefined') {
    window.escapeHTML = escapeHTML;
    window.escapeAttr = escapeAttr;
    window.safeText = safeText;
}
