/**
 * 📊 MONITOREO DE PERFORMANCE (Fase 3 - Modularización)
 * Proporciona herramientas para medir y reportar el rendimiento de la aplicación.
 */

class PerformanceMonitor {
    constructor() {
        this._metrics = new Map();
        this._marks = new Map();
    }

    /**
     * Iniciar una marca de tiempo
     */
    start(name) {
        this._marks.set(name, performance.now());
    }

    /**
     * Finalizar una marca y calcular duración
     */
    end(name) {
        const start = this._marks.get(name);
        if (!start) {
            console.warn(`⚠️ No se encontró marca '${name}'`);
            return 0;
        }

        const duration = performance.now() - start;
        this._marks.delete(name);

        if (!this._metrics.has(name)) {
            this._metrics.set(name, []);
        }
        this._metrics.get(name).push(duration);

        return duration;
    }

    /**
     * Medir una función síncrona
     */
    measure(name, fn) {
        this.start(name);
        const result = fn();
        this.end(name);
        return result;
    }

    /**
     * Medir una función asíncrona
     */
    async measureAsync(name, fn) {
        this.start(name);
        const result = await fn();
        this.end(name);
        return result;
    }

    getStats(name) {
        const measurements = this._metrics.get(name);
        if (!measurements || measurements.length === 0) return null;

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

    report() {
        const report = {};
        this._metrics.forEach((_, name) => {
            report[name] = this.getStats(name);
        });
        return report;
    }

    clear() {
        this._metrics.clear();
        this._marks.clear();
    }
}

export const perfMonitor = new PerformanceMonitor();
