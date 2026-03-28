/**
 * 🎨 RENDERMANAGER (Selectivo por zonas)
 * Implementa renderizado parcial para mejorar el rendimiento.
 */
import { perfMonitor } from './Performance.js';

class RenderManager {
    constructor() {
        this.zones = new Map();
        this.renderCount = 0;
    }

    // Registrar una zona renderizable
    registerZone(zoneId, generator) {
        this.zones.set(zoneId, generator);
    }

    // Render selectivo de una zona específica
    renderZone(zoneId, data) {
        const element = document.getElementById(zoneId);
        if (!element) {
            console.warn('⚠️ Zone not found:', zoneId);
            return false;
        }

        const generator = this.zones.get(zoneId);
        if (!generator) {
            console.warn('⚠️ No generator for zone:', zoneId);
            return false;
        }

        try {
            if (perfMonitor) perfMonitor.start(`renderZone:${zoneId}`);
            
            const html = typeof generator === 'function' ? generator(data) : generator;
            element.innerHTML = html;
            this.renderCount++;
            
            if (perfMonitor) perfMonitor.end(`renderZone:${zoneId}`);
            
            console.log(`✅ Zone rendered: ${zoneId}`);
            return true;
        } catch (error) {
            console.error(`❌ Error rendering zone ${zoneId}:`, error);
            return false;
        }
    }

    // Render de múltiples zonas
    renderZones(zones) {
        const results = {};
        for (const [zoneId, data] of Object.entries(zones)) {
            results[zoneId] = this.renderZone(zoneId, data);
        }
        return results;
    }

    // Obtener estadísticas
    getStats() {
        return {
            registeredZones: this.zones.size,
            totalRenders: this.renderCount,
            zoneList: Array.from(this.zones.keys())
        };
    }
}

export const renderManager = new RenderManager();
