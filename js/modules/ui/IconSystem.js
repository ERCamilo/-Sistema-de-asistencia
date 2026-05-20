/**
 * Sistema centralizado de iconos.
 * Soporta múltiples librerías: Unicode Emojis, Lucide, Phosphor, Heroicons, Tabler, Bootstrap Icons
 *
 * CDNs requeridos (agregar al HTML según la librería que puedes usar):
 *
 * Lucide:
 *   <script src="https://unpkg.com/lucide@latest"></script>
 *
 * Phosphor:
 *   <script src="https://unpkg.com/@phosphor-icons/web"></script>
 *
 * Heroicons (vía SVG sprite — se usa fetch inline):
 *   No requiere CDN, los SVGs se insertan directamente.
 *
 * Tabler:
 *   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont/dist/tabler-icons.min.css">
 *
 * Bootstrap Icons:
 *   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
 */

class IconSystem {
    constructor() {
        // Sets disponibles
        this.availableSets = ['unicode', 'lucide', 'phosphor', 'tabler', 'bootstrap'];
        this.currentSet = this.availableSets[0];
        this._loadedSets = { unicode: true };
        this._loadingSets = {};

        this.assetRegistry = {
            lucide: [
                {
                    type: 'script',
                    url: 'https://unpkg.com/lucide@latest',
                    isLoaded: () => typeof window !== 'undefined' && !!window.lucide
                }
            ],
            phosphor: [
                {
                    type: 'script',
                    url: 'https://unpkg.com/@phosphor-icons/web',
                    isLoaded: () => typeof window !== 'undefined' && !!window.PhosphorIcons
                }
            ],
            tabler: [
                {
                    type: 'style',
                    url: 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont/dist/tabler-icons.min.css'
                }
            ],
            bootstrap: [
                {
                    type: 'style',
                    url: 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css'
                }
            ]
        };

        /**
         * Registro central de iconos.
         * Cada entrada tiene el nombre lógico como clave, y los nombres
         * específicos de cada librería como valores.
         */
        this.registry = {
            // ── UI Core ────────────────────────────────────────────────
            'menu': { unicode: '☰', lucide: 'menu', phosphor: 'list', tabler: 'menu-2', bootstrap: 'list' },
            'close': { unicode: '✕', lucide: 'x', phosphor: 'x', tabler: 'x', bootstrap: 'x-lg' },
            'search': { unicode: '🔍', lucide: 'search', phosphor: 'magnifying-glass', tabler: 'search', bootstrap: 'search' },
            'settings': { unicode: '⚙️', lucide: 'settings', phosphor: 'gear', tabler: 'settings', bootstrap: 'gear' },
            'bell': { unicode: '🔔', lucide: 'bell', phosphor: 'bell', tabler: 'bell', bootstrap: 'bell' },
            'home': { unicode: '🏠', lucide: 'home', phosphor: 'house', tabler: 'home', bootstrap: 'house' },
            'sidebar': { unicode: '▤', lucide: 'panel-left', phosphor: 'sidebar', tabler: 'layout-sidebar', bootstrap: 'layout-sidebar' },
            'grid': { unicode: '⊞', lucide: 'grid', phosphor: 'grid-four', tabler: 'layout-grid', bootstrap: 'grid' },

            // ── Navegación / Tabs ──────────────────────────────────────
            'attendance': { unicode: '📋', lucide: 'clipboard-list', phosphor: 'clipboard-text', tabler: 'clipboard-list', bootstrap: 'clipboard-check' },
            'personnel': { unicode: '👥', lucide: 'users', phosphor: 'users', tabler: 'users', bootstrap: 'people' },
            'reports': { unicode: '📊', lucide: 'bar-chart-2', phosphor: 'chart-bar', tabler: 'chart-bar', bootstrap: 'bar-chart' },
            'analytics': { unicode: '📈', lucide: 'line-chart', phosphor: 'chart-line-up', tabler: 'chart-arrows', bootstrap: 'graph-up-arrow' },
            'payroll': { unicode: '💰', lucide: 'dollar-sign', phosphor: 'currency-dollar', tabler: 'currency-dollar', bootstrap: 'currency-dollar' },
            'dollar': { unicode: '💵', lucide: 'dollar-sign', phosphor: 'currency-dollar-simple', tabler: 'currency-dollar', bootstrap: 'currency-dollar' },

            // ── Estados y validaciones ────────────────────────────────
            'check': { unicode: '✅', lucide: 'check-circle', phosphor: 'check-circle', tabler: 'circle-check', bootstrap: 'check-circle' },
            'x-circle': { unicode: '❌', lucide: 'x-circle', phosphor: 'x-circle', tabler: 'circle-x', bootstrap: 'x-circle' },
            'alert': { unicode: '⚠️', lucide: 'alert-triangle', phosphor: 'warning', tabler: 'alert-triangle', bootstrap: 'exclamation-triangle' },
            'info': { unicode: '💡', lucide: 'info', phosphor: 'info', tabler: 'info-circle', bootstrap: 'info-circle' },
            'help': { unicode: '❓', lucide: 'help-circle', phosphor: 'question', tabler: 'help-circle', bootstrap: 'question-circle' },

            // ── Acciones CRUD ─────────────────────────────────────────
            'add': { unicode: '➕', lucide: 'plus', phosphor: 'plus', tabler: 'plus', bootstrap: 'plus-lg' },
            'edit': { unicode: '✏️', lucide: 'edit-2', phosphor: 'pencil-simple', tabler: 'edit', bootstrap: 'pencil' },
            'delete': { unicode: '🗑️', lucide: 'trash-2', phosphor: 'trash', tabler: 'trash', bootstrap: 'trash' },
            'save': { unicode: '💾', lucide: 'save', phosphor: 'floppy-disk', tabler: 'device-floppy', bootstrap: 'floppy' },
            'copy': { unicode: '📋', lucide: 'copy', phosphor: 'copy', tabler: 'copy', bootstrap: 'copy' },
            'cut': { unicode: '✂️', lucide: 'scissors', phosphor: 'scissors', tabler: 'cut', bootstrap: 'scissors' },
            'paste': { unicode: '📌', lucide: 'clipboard', phosphor: 'clipboard', tabler: 'clipboard', bootstrap: 'clipboard' },
            'share': { unicode: '🔗', lucide: 'share-2', phosphor: 'share-network', tabler: 'share', bootstrap: 'share' },
            'export': { unicode: '📤', lucide: 'log-out', phosphor: 'export', tabler: 'file-export', bootstrap: 'box-arrow-up-right' },
            'import': { unicode: '📥', lucide: 'log-in', phosphor: 'import', tabler: 'file-import', bootstrap: 'box-arrow-in-down' },
            'filter': { unicode: '🔽', lucide: 'filter', phosphor: 'funnel', tabler: 'filter', bootstrap: 'funnel' },
            'sort': { unicode: '↕️', lucide: 'arrow-up-down', phosphor: 'arrows-down-up', tabler: 'arrows-sort', bootstrap: 'arrow-down-up' },

            // ── Sync y Nube ───────────────────────────────────────────
            'cloud': { unicode: '☁️', lucide: 'cloud', phosphor: 'cloud', tabler: 'cloud', bootstrap: 'cloud' },
            'upload': { unicode: '📤', lucide: 'upload-cloud', phosphor: 'cloud-arrow-up', tabler: 'cloud-upload', bootstrap: 'cloud-upload' },
            'download': { unicode: '📥', lucide: 'download-cloud', phosphor: 'cloud-arrow-down', tabler: 'cloud-download', bootstrap: 'cloud-download' },
            'sync': { unicode: '🔄', lucide: 'refresh-cw', phosphor: 'arrows-clockwise', tabler: 'refresh', bootstrap: 'arrow-repeat' },
            'cloud-off': { unicode: '☁️❌', lucide: 'cloud-off', phosphor: 'cloud-slash', tabler: 'cloud-off', bootstrap: 'cloud-slash' },

            // ── Datos y Tiempo ────────────────────────────────────────
            'calendar': { unicode: '📅', lucide: 'calendar', phosphor: 'calendar', tabler: 'calendar', bootstrap: 'calendar' },
            'clock': { unicode: '⏰', lucide: 'clock', phosphor: 'clock', tabler: 'clock', bootstrap: 'clock' },
            'timer': { unicode: '⏱️', lucide: 'timer', phosphor: 'timer', tabler: 'clock-play', bootstrap: 'stopwatch' },
            'play': { unicode: '▶️', lucide: 'play', phosphor: 'play', tabler: 'player-play', bootstrap: 'play' },
            'pause': { unicode: '⏸️', lucide: 'pause', phosphor: 'pause', tabler: 'player-pause', bootstrap: 'pause' },
            'date-left': { unicode: '◀', lucide: 'chevron-left', phosphor: 'caret-left', tabler: 'chevron-left', bootstrap: 'chevron-left' },
            'date-right': { unicode: '▶', lucide: 'chevron-right', phosphor: 'caret-right', tabler: 'chevron-right', bootstrap: 'chevron-right' },
            'chevron-left': { unicode: '◀', lucide: 'chevron-left', phosphor: 'caret-left', tabler: 'chevron-left', bootstrap: 'chevron-left' },
            'chevron-right': { unicode: '▶', lucide: 'chevron-right', phosphor: 'caret-right', tabler: 'chevron-right', bootstrap: 'chevron-right' },
            'map-pin': { unicode: '📍', lucide: 'map-pin', phosphor: 'map-pin', tabler: 'map-pin', bootstrap: 'geo-alt' },
            'chart-line': { unicode: '📈', lucide: 'line-chart', phosphor: 'chart-line', tabler: 'chart-line', bootstrap: 'graph-up' },
            'chart-pie': { unicode: '🥧', lucide: 'pie-chart', phosphor: 'chart-pie', tabler: 'chart-pie', bootstrap: 'pie-chart' },
            'table': { unicode: '📋', lucide: 'table', phosphor: 'table', tabler: 'table', bootstrap: 'table' },
            'database': { unicode: '🗄️', lucide: 'database', phosphor: 'database', tabler: 'database', bootstrap: 'database' },

            // ── Archivos y Documentos ─────────────────────────────────
            'file': { unicode: '📄', lucide: 'file', phosphor: 'file', tabler: 'file', bootstrap: 'file-earmark' },
            'file-text': { unicode: '📝', lucide: 'file-text', phosphor: 'file-text', tabler: 'file-text', bootstrap: 'file-earmark-text' },
            'file-pdf': { unicode: '📑', lucide: 'file-type', phosphor: 'file-pdf', tabler: 'file-type-pdf', bootstrap: 'file-earmark-pdf' },
            'folder': { unicode: '📁', lucide: 'folder', phosphor: 'folder', tabler: 'folder', bootstrap: 'folder' },
            'folder-open': { unicode: '📂', lucide: 'folder-open', phosphor: 'folder-open', tabler: 'folder-open', bootstrap: 'folder2-open' },
            'image': { unicode: '🖼️', lucide: 'image', phosphor: 'image', tabler: 'photo', bootstrap: 'image' },
            'link': { unicode: '🔗', lucide: 'link', phosphor: 'link', tabler: 'link', bootstrap: 'link' },
            'attachment': { unicode: '📎', lucide: 'paperclip', phosphor: 'paperclip', tabler: 'paperclip', bootstrap: 'paperclip' },
            'print': { unicode: '🖨️', lucide: 'printer', phosphor: 'printer', tabler: 'printer', bootstrap: 'printer' },

            // ── Comunicación ──────────────────────────────────────────
            'mail': { unicode: '📧', lucide: 'mail', phosphor: 'envelope', tabler: 'mail', bootstrap: 'envelope' },
            'mail-open': { unicode: '📨', lucide: 'mail-open', phosphor: 'envelope-open', tabler: 'mail-opened', bootstrap: 'envelope-open' },
            'message': { unicode: '💬', lucide: 'message-circle', phosphor: 'chat-circle', tabler: 'message-circle', bootstrap: 'chat' },
            'phone': { unicode: '📞', lucide: 'phone', phosphor: 'phone', tabler: 'phone', bootstrap: 'telephone' },
            'video': { unicode: '📹', lucide: 'video', phosphor: 'video-camera', tabler: 'video', bootstrap: 'camera-video' },

            // ── Usuario y Seguridad ───────────────────────────────────
            'user': { unicode: '👤', lucide: 'user', phosphor: 'user', tabler: 'user', bootstrap: 'person' },
            'user-plus': { unicode: '👤➕', lucide: 'user-plus', phosphor: 'user-plus', tabler: 'user-plus', bootstrap: 'person-plus' },
            'user-check': { unicode: '👤✅', lucide: 'user-check', phosphor: 'user-check', tabler: 'user-check', bootstrap: 'person-check' },
            'key': { unicode: '🔑', lucide: 'key', phosphor: 'key', tabler: 'key', bootstrap: 'key' },
            'lock': { unicode: '🔒', lucide: 'lock', phosphor: 'lock', tabler: 'lock', bootstrap: 'lock' },
            'unlock': { unicode: '🔓', lucide: 'unlock', phosphor: 'lock-open', tabler: 'lock-open', bootstrap: 'unlock' },
            'shield': { unicode: '🛡️', lucide: 'shield', phosphor: 'shield', tabler: 'shield', bootstrap: 'shield' },
            'eye': { unicode: '👁️', lucide: 'eye', phosphor: 'eye', tabler: 'eye', bootstrap: 'eye' },
            'eye-off': { unicode: '🙈', lucide: 'eye-off', phosphor: 'eye-slash', tabler: 'eye-off', bootstrap: 'eye-slash' },
            'fingerprint': { unicode: '🔏', lucide: 'fingerprint', phosphor: 'fingerprint', tabler: 'fingerprint', bootstrap: 'fingerprint' },

            // ── Dispositivos ──────────────────────────────────────────
            'smartphone': { unicode: '📱', lucide: 'smartphone', phosphor: 'device-mobile', tabler: 'device-mobile', bootstrap: 'phone' },
            'tablet': { unicode: '📲', lucide: 'tablet', phosphor: 'device-tablet', tabler: 'device-tablet', bootstrap: 'tablet' },
            'laptop': { unicode: '💻', lucide: 'laptop', phosphor: 'laptop', tabler: 'device-laptop', bootstrap: 'laptop' },
            'monitor': { unicode: '🖥️', lucide: 'monitor', phosphor: 'monitor', tabler: 'device-desktop', bootstrap: 'display' },
            'wifi': { unicode: '📶', lucide: 'wifi', phosphor: 'wifi-high', tabler: 'wifi', bootstrap: 'wifi' },
            'bluetooth': { unicode: '🔵', lucide: 'bluetooth', phosphor: 'bluetooth', tabler: 'bluetooth', bootstrap: 'bluetooth' },

            // ── Misceláneos ───────────────────────────────────────────
            'palette': { unicode: '🎨', lucide: 'palette', phosphor: 'palette', tabler: 'palette', bootstrap: 'palette' },
            'zap': { unicode: '⚡', lucide: 'zap', phosphor: 'lightning', tabler: 'bolt', bootstrap: 'lightning' },
            'moon': { unicode: '🌙', lucide: 'moon', phosphor: 'moon', tabler: 'moon', bootstrap: 'moon' },
            'sun': { unicode: '☀️', lucide: 'sun', phosphor: 'sun', tabler: 'sun', bootstrap: 'sun' },
            'chevron-down': { unicode: '▼', lucide: 'chevron-down', phosphor: 'caret-down', tabler: 'chevron-down', bootstrap: 'chevron-down' },
            'chevron-up': { unicode: '▲', lucide: 'chevron-up', phosphor: 'caret-up', tabler: 'chevron-up', bootstrap: 'chevron-up' },
            'target': { unicode: '🎯', lucide: 'target', phosphor: 'target', tabler: 'target', bootstrap: 'bullseye' },
            'rocket': { unicode: '🚀', lucide: 'rocket', phosphor: 'rocket', tabler: 'rocket', bootstrap: 'rocket' },
            'gamepad': { unicode: '🎮', lucide: 'gamepad-2', phosphor: 'game-controller', tabler: 'device-gamepad', bootstrap: 'controller' },
            'star': { unicode: '⭐', lucide: 'star', phosphor: 'star', tabler: 'star', bootstrap: 'star' },
            'heart': { unicode: '❤️', lucide: 'heart', phosphor: 'heart', tabler: 'heart', bootstrap: 'heart' },
            'bookmark': { unicode: '🔖', lucide: 'bookmark', phosphor: 'bookmark', tabler: 'bookmark', bootstrap: 'bookmark' },
            'tag': { unicode: '🏷️', lucide: 'tag', phosphor: 'tag', tabler: 'tag', bootstrap: 'tag' },
            'flag': { unicode: '🚩', lucide: 'flag', phosphor: 'flag', tabler: 'flag', bootstrap: 'flag' },
            'pin': { unicode: '📌', lucide: 'pin', phosphor: 'push-pin', tabler: 'pin', bootstrap: 'pin-angle' },
            'trending-up': { unicode: '📈', lucide: 'trending-up', phosphor: 'trend-up', tabler: 'trending-up', bootstrap: 'graph-up-arrow' },
            'trending-down': { unicode: '📉', lucide: 'trending-down', phosphor: 'trend-down', tabler: 'trending-down', bootstrap: 'graph-down-arrow' },
            'refresh': { unicode: '🔁', lucide: 'rotate-ccw', phosphor: 'arrow-counter-clockwise', tabler: 'refresh', bootstrap: 'arrow-counterclockwise' },
            'logout': { unicode: '🚪', lucide: 'log-out', phosphor: 'sign-out', tabler: 'logout', bootstrap: 'box-arrow-right' },
            'login': { unicode: '🔐', lucide: 'log-in', phosphor: 'sign-in', tabler: 'login', bootstrap: 'box-arrow-in-right' },
            'external-link': { unicode: '↗️', lucide: 'external-link', phosphor: 'arrow-square-out', tabler: 'external-link', bootstrap: 'box-arrow-up-right' },
            'layers': { unicode: '🗂️', lucide: 'layers', phosphor: 'stack', tabler: 'layers-subtract', bootstrap: 'layers' },
            'package': { unicode: '📦', lucide: 'package', phosphor: 'package', tabler: 'package', bootstrap: 'box' },
            'briefcase': { unicode: '💼', lucide: 'briefcase', phosphor: 'briefcase', tabler: 'briefcase', bootstrap: 'briefcase' },
            'code': { unicode: '👨‍💻', lucide: 'code', phosphor: 'code', tabler: 'code', bootstrap: 'code-slash' },
            'terminal': { unicode: '🖥️', lucide: 'terminal', phosphor: 'terminal-window', tabler: 'terminal', bootstrap: 'terminal' },
            'bug': { unicode: '🐛', lucide: 'bug', phosphor: 'bug', tabler: 'bug', bootstrap: 'bug' },
            'activity': { unicode: '📡', lucide: 'activity', phosphor: 'activity', tabler: 'activity', bootstrap: 'activity' },
            'calendar-check': { unicode: '📅✅', lucide: 'calendar-check', phosphor: 'calendar-check', tabler: 'calendar-check', bootstrap: 'calendar-check' },
            'calendar-off': { unicode: '📅❌', lucide: 'calendar-off', phosphor: 'calendar-off', tabler: 'calendar-off', bootstrap: 'calendar-x' },
            'palmtree': { unicode: '🌴', lucide: 'palm-tree', phosphor: 'palm-tree', tabler: 'tree-palm', bootstrap: 'brightness-high' }
        };
    }

    init(savedSet) {
        if (savedSet && this.availableSets.includes(savedSet)) {
            this.currentSet = savedSet;
        }
        this._ensureSetAssets(this.currentSet).then(() => this._postRenderInit());
    }

    _postRenderInit() {
        if (this.currentSet === 'lucide' && window.lucide) {
            setTimeout(() => window.lucide.createIcons(), 100);
        }
        if (this.currentSet === 'phosphor' && window.PhosphorIcons) {
            setTimeout(() => window.PhosphorIcons.createIcons?.(), 100);
        }
    }

    setSet(setName) {
        if (this.availableSets.includes(setName)) {
            this.currentSet = setName;
            this._ensureSetAssets(setName).then(() => this._postRenderInit());
            return true;
        }
        return false;
    }

    /**
     * Renderizar un icono según el set activo
     * @param {string} name     - Nombre lógico del icono (ej. 'calendar')
     * @param {object} options  - Opciones adicionales
     */
    get(name, options = {}) {
        const iconDef = this.registry[name];

        if (!iconDef) {
            console.warn(`Icon "${name}" not found in registry.`);
            return '';
        }

        const cls = options.class ? ` ${options.class}` : '';
        const style = options.style ? ` style="${options.style}"` : '';

        switch (this.currentSet) {
            case 'unicode':
                return `<span class="icon-unicode${cls}"${style}>${iconDef.unicode}</span>`;

            case 'lucide': {
                const iconName = iconDef.lucide;
                // ⚡ Optimización Alpha: Generar SVG inline si está disponible para evitar parpadeos
                if (window.lucide && window.lucide.icons && window.lucide.icons[iconName]) {
                    const size = options.size || 18;
                    const strokeWidth = options.strokeWidth || 2;
                    return window.lucide.icons[iconName].toSvg({
                        class: `icon-lucide${cls}`,
                        style: options.style || '',
                        width: size,
                        height: size,
                        'stroke-width': strokeWidth
                    });
                }
                const size = options.size ? `width="${options.size}" height="${options.size}"` : 'width="18" height="18"';
                const stroke = options.strokeWidth ? `stroke-width="${options.strokeWidth}"` : 'stroke-width="2"';
                return `<i data-lucide="${iconName}" class="icon-lucide${cls}"${style} ${size} ${stroke}></i>`;
            }

            case 'phosphor':
                return `<i class="ph ph-${iconDef.phosphor}${cls}"${style}></i>`;

            case 'tabler':
                return `<i class="ti ti-${iconDef.tabler}${cls}"${style}></i>`;

            case 'bootstrap':
                return `<i class="bi bi-${iconDef.bootstrap}${cls}"${style}></i>`;

            default:
                return '';
        }
    }

    getPhosphor(name, weight = 'regular', options = {}) {
        const iconDef = this.registry[name];
        if (!iconDef) return '';
        const cls = options.class ? ` ${options.class}` : '';
        const style = options.style ? ` style="${options.style}"` : '';
        const weightClass = weight !== 'regular' ? ` ph-${weight}` : '';
        return `<i class="ph ph-${iconDef.phosphor}${weightClass}${cls}"${style}></i>`;
    }

    refresh() {
        if (this.currentSet === 'lucide' && window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * Obtener la lista de todos los iconos registrados
     */
    getAvailableIcons() {
        return Object.keys(this.registry);
    }

    /**
     * Obtener los sets de iconos disponibles
     */
    getAvailableSets() {
        return [...this.availableSets];
    }

    /**
     * Verificar si un icono existe en el registro
     * @param {string} name
     */
    has(name) {
        return name in this.registry;
    }

    /**
     * Agregar o sobreescribir un icono en el registro
     * @param {string} name  - Nombre lógico
     * @param {object} defs  - Definiciones por librería
     */
    register(name, defs) {
        this.registry[name] = { ...this.registry[name], ...defs };
    }

    _ensureSetAssets(setName) {
        if (this._loadedSets[setName]) return Promise.resolve(true);
        if (this._loadingSets[setName]) return this._loadingSets[setName];
        const assets = this.assetRegistry[setName] || [];
        if (assets.length === 0) return Promise.resolve(true);
        this._loadingSets[setName] = Promise.all(assets.map(asset => this._loadAsset(asset))).then(() => {
            this._loadedSets[setName] = true;
            delete this._loadingSets[setName];
            return true;
        });
        return this._loadingSets[setName];
    }

    _loadAsset(asset) {
        if (asset.isLoaded && asset.isLoaded()) return Promise.resolve(true);
        const type = asset.type === 'style' ? 'link' : 'script';
        const attr = asset.type === 'style' ? 'href' : 'src';
        return new Promise((resolve) => {
            const el = document.createElement(type);
            if (type === 'link') el.rel = 'stylesheet';
            el[attr] = asset.url;
            el.onload = () => resolve(true);
            el.onerror = () => resolve(false);
            document.head.appendChild(el);
        });
    }
}

const icons = new IconSystem();
export default icons;
window.icons = icons;
