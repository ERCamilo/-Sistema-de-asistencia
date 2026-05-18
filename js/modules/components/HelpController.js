/**
 * 🎓 HelpController.js — Lógica del sistema de tooltips de ayuda
 *
 * Modos:
 *   - 'off'         → tooltips solo al pulsar (?)
 *   - 'first-time'  → auto-mostrar la primera vez que se enfoca cada campo (default)
 *   - 'always'      → auto-mostrar cada vez que se enfoca
 *
 * El controlador es agnóstico de la persistencia para facilitar tests.
 * En producción se inicializa con state.settings y state.helpSeen.
 */

const VALID_MODES = ['off', 'first-time', 'always'];
const DEFAULT_MODE = 'first-time';

export class HelpController {
    /**
     * @param {Object} options
     * @param {Function} options.getSettings  - () => settings (debe tener .helpMode)
     * @param {Function} options.getSeenMap   - () => objeto con claves vistas
     * @param {Function} [options.persist]    - callback para guardar cambios (opcional)
     */
    constructor(options = {}) {
        this._getSettings = options.getSettings || (() => ({ helpMode: DEFAULT_MODE }));
        this._getSeenMap = options.getSeenMap || (() => ({}));
        this._persist = options.persist || (() => {});
    }

    /**
     * @returns {string} modo actual ('off' | 'first-time' | 'always')
     */
    getMode() {
        const mode = this._getSettings().helpMode;
        return VALID_MODES.includes(mode) ? mode : DEFAULT_MODE;
    }

    /**
     * Cambia el modo. Valida que sea uno de los permitidos.
     * @param {string} mode
     */
    setMode(mode) {
        if (!VALID_MODES.includes(mode)) {
            console.warn(`HelpController: modo inválido "${mode}". Usando "${DEFAULT_MODE}".`);
            mode = DEFAULT_MODE;
        }
        const settings = this._getSettings();
        settings.helpMode = mode;
        this._persist();
    }

    /**
     * @param {string} key - clave del helpText (ej: 'position.hourlyRate')
     * @returns {boolean} si debe auto-mostrarse al enfocar el campo
     */
    shouldAutoShow(key) {
        const mode = this.getMode();
        if (mode === 'off') return false;
        if (mode === 'always') return true;
        // first-time: mostrar solo si no se ha visto
        return !this.hasBeenSeen(key);
    }

    /**
     * Marca una clave como vista. En modo 'first-time' previene futuras
     * apariciones automáticas para esta clave.
     * @param {string} key
     */
    markSeen(key) {
        const seen = this._getSeenMap();
        if (!seen[key]) {
            seen[key] = true;
            this._persist();
        }
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    hasBeenSeen(key) {
        return !!this._getSeenMap()[key];
    }

    /**
     * Reinicia el registro de "visto" — útil para botón de "ver todos los tips de nuevo"
     */
    resetAllSeen() {
        const seen = this._getSeenMap();
        Object.keys(seen).forEach(k => delete seen[k]);
        this._persist();
    }

    /**
     * @returns {Array<string>} modos válidos (útil para UI de selección)
     */
    static getValidModes() {
        return [...VALID_MODES];
    }
}
