/**
 * 📤 ExportMenuService — Pure state operations for the export popover.
 *
 * The export popover is a small contextual menu that appears when the user
 * triggers an export. It carries a Blob ready to download or share. This
 * module owns the state shape; Sprint 4 will extract the rendering UI.
 *
 * State shape owned here:
 *   state.showExportMenu        : boolean
 *   state.showShareOptions      : boolean
 *   state.exportMenuData        : { x, y, filename, blob, title, text }
 */

export const EMPTY_EXPORT_DATA = Object.freeze({
    x: 0,
    y: 0,
    filename: '',
    blob: null,
    title: '',
    text: ''
});

/**
 * Open the export menu with a payload ready to share or download.
 *
 * @param {object} state           - global state object
 * @param {object} options
 * @param {number} [options.x=0]   - anchor x coordinate
 * @param {number} [options.y=0]   - anchor y coordinate
 * @param {string} [options.filename='archivo']
 * @param {Blob}   [options.blob]
 * @param {string} [options.title='Archivo']
 * @param {string} [options.text='']
 */
export function openExportMenu(state, options = {}) {
    state.showExportMenu = true;
    state.showShareOptions = false;
    state.exportMenuData = {
        x: options.x || 0,
        y: options.y || 0,
        filename: options.filename || 'archivo',
        blob: options.blob || null,
        title: options.title || 'Archivo',
        text: options.text || ''
    };
}

/**
 * Close the export menu and reset all related popover state.
 * Mirrors the existing closeExportMenu in app.js — it also dismisses sibling
 * popovers (notes, import) because they share screen real estate.
 */
export function closeExportMenu(state) {
    state.showExportMenu = false;
    state.showShareOptions = false;
    state.exportMenuData = { ...EMPTY_EXPORT_DATA };
}

/**
 * Returns true if the current environment supports Web Share API for files.
 * Used by the UI to decide whether to render the "Share" button.
 */
export function canShareFiles() {
    if (typeof navigator === 'undefined') return false;
    if (typeof navigator.canShare !== 'function') return false;
    try {
        // Probing with an empty array is a safe canShare invocation.
        return navigator.canShare({ files: [] });
    } catch {
        return false;
    }
}
