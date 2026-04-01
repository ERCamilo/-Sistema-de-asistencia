/**
 * 🛠️ Helpers.js - Utilidades Generales
 */

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function debounce(func, wait = 300) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

/**
 * 🔗 slugify() - Normaliza texto para usar como ID (minúsculas, sin espacios ni tildes)
 */
export function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
        .replace(/\s+/g, '-')           // Espacios a guiones
        .replace(/[^\w-]+/g, '')        // Quitar caracteres especiales
        .replace(/--+/g, '-')           // Quitar guiones dobles
        .replace(/^-+/, '')             // Quitar guiones al inicio
        .replace(/-+$/, '');            // Quitar guiones al final
}
