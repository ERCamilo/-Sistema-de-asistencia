/**
 * 🧹 LegacyMigrator.js
 * Encargado de transformar formatos de datos antiguos al esquema actual.
 * Mantiene la base de datos central limpia de lógica de compatibilidad.
 */

export class LegacyMigrator {
    /**
     * Determina si un objeto de datos necesita migración
     */
    static needsMigration(rawData) {
        if (!rawData) return false;
        
        // Caso 1: Estructura plana (sin contenedor .data)
        if (!rawData.data && (rawData.employees || rawData.personal || rawData.asistencia)) {
            return true;
        }

        // Caso 2: Falta de metadatos modernos (updatedAt)
        if (rawData.data) {
            const hasUpdatedAt = rawData.data.employees?.every(e => e.updatedAt) && 
                               rawData.data.positions?.every(p => p.updatedAt);
            if (!hasUpdatedAt) return true;
        }

        return false;
    }

    /**
     * Transforma datos antiguos al formato actual (v6.x+)
     */
    static migrate(rawData) {
        if (!rawData) return null;
        console.log('🚛 Iniciando migración de datos legacy...');

        let migrated = {
            version: rawData.version || '0.0.0-legacy',
            exportDate: rawData.exportDate || new Date().toISOString(),
            companyName: rawData.companyName || 'Empresa Antigua',
            wasMigrated: true,
            originalVersion: rawData.version || 'Desconocida',
            data: {}
        };

        // 1. Normalizar contenedor principal
        const sourceData = rawData.data || rawData;

        // 2. Mapeo de Tablas (Renombrar si es necesario)
        migrated.data.settings = sourceData.settings || sourceData.configuracion || {};
        migrated.data.employees = sourceData.employees || sourceData.personal || [];
        migrated.data.positions = sourceData.positions || sourceData.cargos || [];
        migrated.data.leaders = sourceData.leaders || sourceData.lideres || [];
        migrated.data.attendance = sourceData.attendance || sourceData.asistencia || {};
        migrated.data.tempAssignments = sourceData.tempAssignments || [];
        migrated.data.dayHoursConfig = sourceData.dayHoursConfig || {};

        // 3. Inyectar Timestamps (Crucial para Smart Sync)
        const referenceTime = new Date(migrated.exportDate).getTime() || Date.now();
        
        this._ensureTimestamps(migrated.data.employees, referenceTime);
        this._ensureTimestamps(migrated.data.positions, referenceTime);
        this._ensureTimestamps(migrated.data.leaders, referenceTime);
        
        // Para asistencia, iterar el objeto
        Object.values(migrated.data.attendance).forEach(record => {
            if (!record.updatedAt) record.updatedAt = referenceTime;
        });

        // 4. Limpieza de campos obsoletos o formatos incorrectos
        this._sanitizeEntities(migrated.data);

        console.log('✅ Migración completada con éxito');
        return migrated;
    }

    /**
     * Asegura que cada entidad tenga un updatedAt para el sistema de sincronización
     */
    static _ensureTimestamps(collection, time) {
        if (!Array.isArray(collection)) return;
        collection.forEach(item => {
            if (!item.updatedAt) {
                // Intentar usar fechas existentes como fallback
                item.updatedAt = item.createdDate ? new Date(item.createdDate).getTime() : time;
            }
        });
    }

    /**
     * Ajustes finos de campos específicos que han cambiado de nombre o tipo
     */
    static _sanitizeEntities(data) {
        // Asegurar que settings tenga campos mínimos
        const s = data.settings;
        if (s.regularHoursPerDay === undefined) s.regularHoursPerDay = 8;
        if (s.attendancePositionWatermarks === undefined) s.attendancePositionWatermarks = true;
        if (s.overtimeFactor === undefined) s.overtimeFactor = 1;
        if (s.holidayFactor === undefined) s.holidayFactor = 2;
        if (!s.iconSet) s.iconSet = 'default';

        // Asegurar IDs consistentes en empleados
        data.employees.forEach(emp => {
            if (!emp.id && emp.key) emp.id = emp.key;
            if (!emp.id) emp.id = `LEGACY-${Math.random().toString(36).substr(2, 9)}`;
        });
    }
}
