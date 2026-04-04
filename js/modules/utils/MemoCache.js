import icons from '../ui/IconSystem.js';

// ============================================
// 💡 CLASE MEMOCACHE (POO - Caché de resultados para optimización)
// ============================================
export class MemoCache {
    constructor() {
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            size: 0
        };
    }

    // Obtener o generar valor
    get(key, generator, deps = []) {
        const depsKey = JSON.stringify(deps);
        const fullKey = `${key}::${depsKey}`;

        if (this.cache.has(fullKey)) {
            this.stats.hits++;
            return this.cache.get(fullKey); // ⚡ Sin console.log en hot path
        }

        this.stats.misses++;
        const result = generator();
        this.cache.set(fullKey, result);
        this.stats.size = this.cache.size;
        return result;
    }

    // Limpiar cache específico
    clear(prefix) {
        if (prefix) {
            let cleared = 0;
            for (let key of this.cache.keys()) {
                if (key.startsWith(prefix)) {
                    this.cache.delete(key);
                    cleared++;
                }
            }
            console.log(`🧹 Cache cleared: ${cleared} entries with prefix "${prefix}"`);
        } else {
            const size = this.cache.size;
            this.cache.clear();
            console.log(`🧹 Cache cleared: ${size} entries`);
        }
        this.stats.size = this.cache.size;
    }

    // Invalidar por patrón
    invalidate(pattern) {
        const regex = new RegExp(pattern);
        let invalidated = 0;
        for (let key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                invalidated++;
            }
        }
        this.stats.size = this.cache.size;
        return invalidated;
    }

    // Get stats
    getStats() {
        return this.stats;
    }
}

// Instance default
export const memoCache = new MemoCache();

/**
 * ⚡ ComponentMemo: cache de HTML de componentes basado en huella digital barata.
 * Usa comparación de primitivos en lugar de JSON.stringify para mayor velocidad.
 * 
 * Uso:
 *   const html = componentMemo.get('row-emp123', () => EmployeeRow(emp), [emp.id, att?.present, att?.hoursWorked]);
 */
export class ComponentMemo {
    constructor() {
        this._cache = new Map(); // key → { fingerprint, html }
    }

    /**
     * @param {string} key - Identificador único del componente/instancia
     * @param {Function} generator - Función que produce el HTML
     * @param {Array<string|number|boolean>} deps - Valores primitivos que determinan si hay cambio
     * @returns {string} HTML del componente (cacheado o recién generado)
     */
    get(key, generator, deps) {
        const fingerprint = deps.join('|');
        const cached = this._cache.get(key);
        if (cached && cached.fingerprint === fingerprint) {
            return cached.html;
        }
        const html = generator();
        this._cache.set(key, { fingerprint, html });
        return html;
    }

    /** Invalida una entrada específica o todas las que empiezan con un prefijo */
    invalidate(keyOrPrefix) {
        if (!keyOrPrefix) { this._cache.clear(); return; }
        for (const key of this._cache.keys()) {
            if (key.startsWith(keyOrPrefix)) this._cache.delete(key);
        }
    }

    get size() { return this._cache.size; }
}

export const componentMemo = new ComponentMemo();
window.componentMemo = componentMemo;
