/**
 * 📸 SnapshotReasons.js
 * Catálogo central de razones por las que se crea un snapshot.
 *
 * Cada snapshot tiene un `type` (auto/manual/pre-restore — compat hacia atrás)
 * y opcionalmente un `reason` más específico (por qué exactamente se creó).
 * `reason` permite al usuario entender de un vistazo qué causó cada punto
 * de restauración: "Antes de migrar el sistema" es mucho más útil que "AUTO".
 */

export const SNAPSHOT_REASONS = {
    // Usuario
    manual: {
        label: 'Backup manual',
        icon: '📸',
        type: 'manual',
        color: '#06b6d4'
    },

    // Programados
    'daily-auto': {
        label: 'Backup automático',
        icon: '⚙️',
        type: 'auto',
        color: '#10b981'
    },

    // Eventos del sistema (todos protegidos: no se borran sin confirmación extra)
    'pre-restore': {
        label: 'Antes de restaurar otra versión',
        icon: '🛡️',
        type: 'pre-restore',
        color: '#10b981',
        protected: true
    },
    'pre-migration-v2': {
        label: 'Antes de migrar al sistema multi-dispositivo',
        icon: '🔄',
        type: 'pre-restore',
        color: '#a855f7',
        protected: true
    },
    'pre-migration-v3': {
        label: 'Antes de migrar cargos y líderes a multi-dispositivo',
        icon: '🔄',
        type: 'pre-restore',
        color: '#a855f7',
        protected: true
    },
    'pre-bulk-delete': {
        label: 'Antes de borrado masivo',
        icon: '⚠️',
        type: 'pre-restore',
        color: '#f59e0b',
        protected: true
    },
    'pre-import': {
        label: 'Antes de importar archivo',
        icon: '📥',
        type: 'pre-restore',
        color: '#f59e0b',
        protected: true
    },
    'pre-mantenimiento-auto': {
        label: 'Antes de mantenimiento automático',
        icon: '🧹',
        type: 'pre-restore',
        color: '#f59e0b',
        protected: true
    },
    'pre-loan-change': {
        label: 'Antes de cambio en préstamos',
        icon: '💵',
        type: 'pre-restore',
        color: '#10b981',
        protected: true
    },
    'pre-cloud-dedup': {
        label: 'Antes de fusionar duplicados (local + nube)',
        icon: '🧹',
        type: 'pre-restore',
        color: '#a855f7',
        protected: true
    },
    // Fase 0.5 (R2-1): respaldo de la NUBE que 'Subir y Reemplazar' está por
    // destruir. Protegido: es la única vía de recuperación de esa operación —
    // no debe caer con 'Borrar Todos los Autos' ni con alsoSnapshots.
    'pre-replace-cloud-backup': {
        label: 'Respaldo de la nube antes de Subir y Reemplazar',
        icon: '🛟',
        type: 'pre-restore',
        color: '#f59e0b',
        protected: true
    }
};

/**
 * Obtiene info de visualización para una razón. Si la razón no existe en el
 * catálogo (snapshot viejo o futuro), cae al `type` con etiqueta genérica.
 */
export function getReasonInfo(reason, type) {
    if (reason && SNAPSHOT_REASONS[reason]) {
        return SNAPSHOT_REASONS[reason];
    }
    // Fallback por type (compat con snapshots viejos sin razón)
    const fallback = {
        auto: { label: 'Backup automático', icon: '⚙️', type: 'auto', color: '#10b981' },
        manual: { label: 'Backup manual', icon: '📸', type: 'manual', color: '#06b6d4' },
        'pre-restore': { label: 'Punto protegido', icon: '🛡️', type: 'pre-restore', color: '#10b981', protected: true }
    };
    return fallback[type] || fallback.auto;
}

/**
 * Resuelve `reason` por defecto a partir del `type` legacy. Para callers
 * viejos que solo pasan type, mapeamos a la razón más probable.
 */
export function defaultReasonForType(type) {
    if (type === 'manual') return 'manual';
    if (type === 'auto') return 'daily-auto';
    if (type === 'pre-restore') return 'pre-restore';
    // Si el caller pasó algo que ya parece un código de razón, úsalo tal cual.
    return type;
}
