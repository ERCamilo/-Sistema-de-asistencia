/**
 * 🚀 PERFORMANCE UTILS (Alpha Refactor)
 * Utilidades para optimizar el renderizado y la interacción del usuario.
 */

/**
 * ⚡ DEBOUNCE
 * Evita que una función se ejecute demasiadas veces seguidas.
 * Útil para campos de búsqueda y redimensionamiento.
 */
export const debounce = (func, wait = 300) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

/**
 * 🌊 RENDER IN CHUNKS (Optimización de UI)
 * Divide el renderizado de listas grandes para no bloquear el hilo principal.
 * 
 * @param {string} containerId - ID del contenedor DOM
 * @param {Array} items - Array de datos a procesar
 * @param {Function} renderer - Función que transforma un item en HTML
 * @param {Object} options - Configuración adicional (chunkSize, onComplete, initialHTML)
 */
export const renderInChunks = (containerId, items, renderer, options = {}) => {
    const { chunkSize = 15, onComplete, initialHTML = '' } = options;
    const container = document.getElementById(containerId);
    if (!container) return;

    let index = 0;
    
    if (initialHTML) {
        container.innerHTML = initialHTML;
    } else {
        container.innerHTML = ''; 
    }

    function next() {
        const currentContainer = document.getElementById(containerId);
        if (!currentContainer || currentContainer !== container) return;

        const chunk = items.slice(index, index + chunkSize);
        if (index === 0) container.innerHTML = '';

        if (chunk.length === 0) {
            if (onComplete) onComplete();
            return;
        }

        const html = chunk.map(item => renderer(item)).join('');
        container.insertAdjacentHTML('beforeend', html);
        
        index += chunkSize;
        if (index < items.length) {
            requestAnimationFrame(next);
        } else if (onComplete) {
            onComplete();
        }
    }

    if (items.length > 0) {
        next();
    } else {
        container.innerHTML = '<div class="empty-state">No hay resultados</div>';
    }
};

/**
 * 📊 CLASE PERFORMANCEMONITOR (POO - Monitoreo de performance)
 */
class PerformanceMonitor {
    constructor() {
        this._metrics = new Map();
        this._marks = new Map();
    }

    // Iniciar medición
    start(name) {
        this._marks.set(name, performance.now());
    }

    // Finalizar medición
    end(name) {
        const start = this._marks.get(name);
        if (!start) {
            if (window.debug) window.debug.warn(`⚠️ No se encontró marca '${name}'`);
            return 0;
        }

        const duration = performance.now() - start;
        this._marks.delete(name);

        // Guardar métrica
        if (!this._metrics.has(name)) {
            this._metrics.set(name, []);
        }
        this._metrics.get(name).push(duration);

        if (window.debug) window.debug.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`);
        return duration;
    }

    // Medir función
    measure(name, fn) {
        this.start(name);
        const result = fn();
        this.end(name);
        return result;
    }

    // Medir función async
    async measureAsync(name, fn) {
        this.start(name);
        const result = await fn();
        this.end(name);
        return result;
    }

    // Obtener estadísticas
    getStats(name) {
        const measurements = this._metrics.get(name);
        if (!measurements || measurements.length === 0) {
            return null;
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const sum = measurements.reduce((a, b) => a + b, 0);

        return {
            count: measurements.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: sum / measurements.length,
            median: sorted[Math.floor(sorted.length / 2)]
        };
    }

    // Reporte completo
    report() {
        const report = {};
        this._metrics.forEach((_, name) => {
            report[name] = this.getStats(name);
        });
        return report;
    }

    // Limpiar métricas
    clear() {
        this._metrics.clear();
        this._marks.clear();
    }
}

// Instancia global
export const perfMonitor = new PerformanceMonitor();

// 🌍 BRIDGE GLOBAL (Solo para mantener compatibilidad mientras migramos)
window.renderInChunks = renderInChunks;
window.debounce = debounce;
window.perfMonitor = perfMonitor;
