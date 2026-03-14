import { icons } from '../ui/IconSystem.js';

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
            console.log('💡 Cache HIT:', key);
            return this.cache.get(fullKey);
        }

        this.stats.misses++;
        console.log('💡 Cache MISS, generando:', key);
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
        console.log(`${icons.get('info')} Cache invalidated: ${invalidated} entries matching "${pattern}"`);
        this.stats.size = this.cache.size;
    }

    // Get stats
    getStats() {
        return this.stats;
    }
}

// Instance default
export const memoCache = new MemoCache();
