/**
 * Sistema centralizado de iconos.
 * Permite cambiar entre diferentes librerías de iconos (ej. Unicode Emojis vs Lucide Icons)
 * manteniendo la misma semántica en el código.
 */

class IconSystem {
    constructor() {
        // Set de iconos por defecto
        this.currentSet = 'unicode'; 
        
        // Registro central de todos los iconos usados en la app
        this.registry = {
            // UI Core
            'menu': { unicode: '☰', lucide: 'menu' },
            'close': { unicode: '✕', lucide: 'x' },
            'search': { unicode: '🔍', lucide: 'search' },
            'settings': { unicode: '⚙️', lucide: 'settings' },
            'bell': { unicode: '🔔', lucide: 'bell' },
            'home': { unicode: '🏠', lucide: 'home' },
            
            // Navegación principal / Tabs
            'attendance': { unicode: '📋', lucide: 'clipboard-list' },
            'personnel': { unicode: '👥', lucide: 'users' },
            'reports': { unicode: '📊', lucide: 'bar-chart-2' },
            'payroll': { unicode: '💰', lucide: 'dollar-sign' },
            
            // Estados y validaciones
            'check': { unicode: '✅', lucide: 'check-circle' },
            'x-circle': { unicode: '❌', lucide: 'x-circle' },
            'alert': { unicode: '⚠️', lucide: 'alert-triangle' },
            'info': { unicode: '💡', lucide: 'info' },
            
            // Acciones CRUD
            'add': { unicode: '➕', lucide: 'plus' },
            'edit': { unicode: '✏️', lucide: 'edit-2' },
            'delete': { unicode: '🗑️', lucide: 'trash-2' },
            'save': { unicode: '💾', lucide: 'save' },
            
            // Sync y Nube
            'cloud': { unicode: '☁️', lucide: 'cloud' },
            'upload': { unicode: '📤', lucide: 'upload-cloud' },
            'download': { unicode: '📥', lucide: 'download-cloud' },
            'sync': { unicode: '🔄', lucide: 'refresh-cw' },
            
            // Componentes de datos
            'calendar': { unicode: '📅', lucide: 'calendar' },
            'clock': { unicode: '⏰', lucide: 'clock' },
            'timer': { unicode: '⏱️', lucide: 'timer' },
            'map-pin': { unicode: '📍', lucide: 'map-pin' },
            
            // Misceláneos
            'palette': { unicode: '🎨', lucide: 'palette' },
            'zap': { unicode: '⚡', lucide: 'zap' },
            'moon': { unicode: '🌙', lucide: 'moon' },
            'sun': { unicode: '☀️', lucide: 'sun' },
            'chevron-down': { unicode: '▼', lucide: 'chevron-down' },
            'chevron-right': { unicode: '▶', lucide: 'chevron-right' },
            'chevron-left': { unicode: '◀', lucide: 'chevron-left' },
            'chevron-up': { unicode: '▲', lucide: 'chevron-up' },
            'target': { unicode: '🎯', lucide: 'target' },
            'rocket': { unicode: '🚀', lucide: 'rocket' },
            'gamepad': { unicode: '🎮', lucide: 'gamepad-2' },
            'user': { unicode: '👤', lucide: 'user' },
            'key': { unicode: '🔑', lucide: 'key' },
            'lock': { unicode: '🔒', lucide: 'lock' },
            'smartphone': { unicode: '📱', lucide: 'smartphone' }
        };
    }

    /**
     * Inicializar el sistema leyendo la preferencia guardada
     */
    init(savedSet) {
        if (savedSet && ['unicode', 'lucide'].includes(savedSet)) {
            this.currentSet = savedSet;
        }
        
        // Si usamos lucide, asegurar que la librería redibuje los iconos después del primer render
        if (this.currentSet === 'lucide' && window.lucide) {
            setTimeout(() => window.lucide.createIcons(), 100);
        }
    }

    /**
     * Cambiar el set de iconos en toda la app
     */
    setSet(setName) {
        if (['unicode', 'lucide'].includes(setName)) {
            this.currentSet = setName;
            
            // Actualizar la interfaz (requiere que la app se vuelva a renderizar)
            // Esto típicamente sería manejado guardando en state.settings.iconSet y llamando render()
            return true;
        }
        return false;
    }

    /**
     * Renderizar un icono basado en su nombre y el set actual
     * @param {string} name - Nombre lógico del icono (ej. 'calendar')
     * @param {object} options - Opciones adicionales (ej. size, class)
     * @returns {string} HTML string del icono
     */
    get(name, options = {}) {
        const iconDef = this.registry[name];
        
        if (!iconDef) {
            console.warn(`Icon "${name}" not found in registry.`);
            return '';
        }

        const className = options.class ? `class="${options.class}"` : '';
        const style = options.style ? `style="${options.style}"` : '';
        
        if (this.currentSet === 'unicode') {
            return `<span ${className} ${style}>${iconDef.unicode}</span>`;
        } 
        else if (this.currentSet === 'lucide') {
            // Lucide usa un atributo de data para inicializar
            const size = options.size ? `width="${options.size}" height="${options.size}"` : 'width="18" height="18"';
            const stroke = options.strokeWidth ? `stroke-width="${options.strokeWidth}"` : 'stroke-width="2"';
            
            // Devolvemos el markup base que la librería de Lucide convertirá en SVG
            return `<i data-lucide="${iconDef.lucide}" ${className} ${style} ${size} ${stroke}></i>`;
        }

        return '';
    }
    
    /**
     * Llamar después de actualizar el DOM manual o parcialmente si se usa Lucide
     */
    refresh() {
        if (this.currentSet === 'lucide' && window.lucide) {
            window.lucide.createIcons();
        }
    }
    
    /**
     * Obtener una lista de todos los iconos disponibles
     */
    getAvailableIcons() {
        return Object.keys(this.registry);
    }
}

// Exportar una instancia única
export const icons = new IconSystem();
