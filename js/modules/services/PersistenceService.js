/**
 * 💾 PersistenceService.js - Central de Persistencia
 * Coordina el guardado de datos entre IndexedDB, LocalStorage y Firebase.
 */

import { state } from '../core/AppState.js';
import { FirebaseService, indexedDBService, dataService } from './index.js';
import { Notification as NotificationSystem } from '../components/Notification.js';
import { generateUUID } from '../utils/Helpers.js';

// Importar clases de entidad para inflar datos
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';
import { Attendance } from '../features/attendance/Attendance.js';

// Lock para evitar guardados concurrentes
let _isSavingData = false;

/**
 * ⚡ SINCRONIZACIÓN DEBUNCED PARA FIREBASE (Mirror Sync)
 * Evita saturar la cuota de Firebase con guardados demasiado frecuentes
 */
export const syncFirebaseMirrorDebounced = (function() {
    let timeout;
    return function(state) {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            if (globalThis.currentUser && !globalThis._isApplyingRemoteData) {
                try {
                    await FirebaseService.saveFullState(state);
                } catch (e) {
                    console.error('⚠️ Error en sincronización debounced:', e);
                }
            }
        }, 2000); // 2 segundos de espera
    };
})();

/**
 * 💾 GUARDADO SEGURO EN INDEXEDDB
 */
export async function saveToIndexedDB(options = {}) {
    try {
        await indexedDBService.saveState(state, options);
        console.log('💾 Datos guardados en IndexedDB');
        return true;
    } catch (error) {
        console.error('❌ Error guardando en IndexedDB:', error);
        throw error;
    }
}

/**
 * 💾 FUNCIÓN PRINCIPAL DE PERSISTENCIA
 * Orquesta el guardado local y la sincronización con la nube.
 */
export async function saveApplicationData(options = {}) {
    if (_isSavingData) return;
    _isSavingData = true;

    if (!state.isDataLoaded) {
        console.warn('⚠️ Intento de guardado ignorado: los datos aún no se han cargado completamente.');
        _isSavingData = false;
        return;
    }

    console.log('🔵 PersistenceService: saveApplicationData() iniciado', options.dateKey ? `para fecha: ${options.dateKey}` : '');

    // ☁️ Sincronización con Firebase
    if (globalThis.currentUser && !globalThis._isApplyingRemoteData) {
        // 1. Sincronización Granular (si hay dateKey)
        if (options.dateKey) {
            const dayRecords = {};
            const suffix = `-${options.dateKey}`;
            Object.entries(state.attendance).forEach(([key, record]) => {
                if (key.endsWith(suffix)) {
                    dayRecords[key] = record;
                }
            });
            FirebaseService.saveDailyAttendance(options.dateKey, dayRecords).catch(e => 
                console.error(`⚠️ Error en sync granular (${options.dateKey}):`, e)
            );
        }

        // 2. Sincronización Espejo (Full State) - DEBOUNCED
        syncFirebaseMirrorDebounced(state);

        // 3. Backup Automático (Snapshots)
        const freq = state.settings?.backupFrequency || 'none';
        if (freq !== 'none') {
            const now = Date.now();
            const lastBackup = state.settings?.lastSnapshotTimestamp || 0;
            const intervals = {
                daily: 24 * 60 * 60 * 1000,
                weekly: 7 * 24 * 60 * 60 * 1000,
                monthly: 30 * 24 * 60 * 60 * 1000
            };

            if (now - lastBackup > (intervals[freq] || Infinity)) {
                FirebaseService.createSnapshot(state, 'auto').then(() => {
                    state.settings.lastSnapshotTimestamp = now;
                }).catch(e => console.error('Error en backup automático:', e));
            }
        }
    }

    // 💾 Persistencia Local
    if (state.useIndexedDB) {
        try {
            await indexedDBService.saveState(state, options);
        } catch (error) {
            // Manejo de conflictos de integridad
            if (error.name === 'ConstraintError' || error.message?.includes('ConstraintError')) {
                console.warn('⚡ Conflicto de integridad en IndexedDB.');
                NotificationSystem.error('❌ Conflicto de datos detectado');
            } else {
                // Fallback a localStorage
                if (dataService) dataService.saveAll();
                NotificationSystem.error('❌ Error al guardar localmente');
            }
        }
    } else {
        if (dataService) dataService.saveAll();
    }

    // 📡 Emitir evento de guardado si existe eventBus global o mediante globalThis
    if (globalThis.eventBus) {
        globalThis.eventBus.emit('data:saved', { timestamp: Date.now() });
    }

    _isSavingData = false;
}

/**
 * 📂 CARGA INICIAL DE DATOS
 * Maneja la migración de LocalStorage a IndexedDB si es necesario.
 */
export async function loadApplicationData() {
    try {
        console.log('📂 PersistenceService: Iniciando carga de datos...');
        
        // 1. Intentar cargar desde IndexedDB (Fase 2+)
        const idbData = await indexedDBService.loadFullState();
        
        if (idbData && (idbData.employees?.length > 0 || idbData.positions?.length > 0)) {
            console.log('✅ Datos cargados desde IndexedDB');
            
            // Inflar datos (convertir a instancias de clase)
            const inflatedData = {
                employees: (idbData.employees || []).map(e => e instanceof Employee ? e : new Employee(e)),
                positions: (idbData.positions || []).map(p => p instanceof Position ? p : new Position(p)),
                leaders: (idbData.leaders || []).map(l => l instanceof Leader ? l : new Leader(l)),
                attendance: {},
                settings: idbData.settings || {}
            };

            // Inflar asistencia
            Object.entries(idbData.attendance || {}).forEach(([key, val]) => {
                inflatedData.attendance[key] = val instanceof Attendance ? val : new Attendance(val);
            });

            // Poblar el estado global
            Object.assign(state, inflatedData);
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            
            validateDataIntegrity();
            return true;
        }

        // 2. Fallback a LocalStorage (Migración o Legacy)
        console.log('🔄 No se detectaron datos en IndexedDB. Buscando en LocalStorage...');
        const hasDataInLS = dataService.loadAll();
        
        if (hasDataInLS) {
            console.log('✅ Datos cargados desde LocalStorage');
            state.isDataLoaded = true;
            
            // Si el navegador soporta IndexedDB, migramos de inmediato
            if (indexedDBService.isSupported()) {
                console.log('🚀 Migrando datos de LocalStorage a IndexedDB...');
                await indexedDBService.saveState(state);
                state.useIndexedDB = true;
                localStorage.setItem('migrated-to-idb', 'true');
            }
            
            validateDataIntegrity();
            return true;
        }

        console.log('ℹ️ No hay datos guardados para cargar');
        state.isDataLoaded = true;
        return false;

    } catch (error) {
        console.error('❌ Error fatal al cargar datos:', error);
        state.isDataLoaded = true; // No bloquear la UI
        return false;
    }
}

/**
 * 🛡️ VALIDACIÓN DE INTEGRIDAD
 * Limpia referencias huérfanas para evitar crashes en la UI.
 */
export function validateDataIntegrity() {
    let fixes = 0;
    const positionIds = new Set(state.positions.map(p => p.id));
    const leaderIds = new Set(state.leaders.map(l => l.id));

    // 1. Limpiar posiciones en empleados
    state.employees.forEach(emp => {
        if (emp.positions) {
            const validPositions = emp.positions.filter(pid => positionIds.has(pid));
            if (validPositions.length !== emp.positions.length) {
                emp.positions = validPositions;
                fixes++;
            }
        }
        
        // 2. Limpiar positionSalaries con IDs que ya no existen
        if (emp.positionSalaries) {
            Object.keys(emp.positionSalaries).forEach(posId => {
                if (!positionIds.has(posId)) {
                    delete emp.positionSalaries[posId];
                    fixes++;
                }
            });
        }
    });

    // 3. Limpiar líderes en posiciones
    state.positions.forEach(pos => {
        if (pos.leaderId && !leaderIds.has(pos.leaderId)) {
            pos.leaderId = null;
            fixes++;
        }
    });

    // 4. Limpiar positionHours en asistencia
    Object.values(state.attendance).forEach(att => {
        if (att.positionHours) {
            const validPh = att.positionHours.filter(ph => positionIds.has(ph.positionId));
            if (validPh.length !== att.positionHours.length) {
                att.positionHours = validPh;
                fixes++;
            }
        }
        if (att.selectedPosition && !positionIds.has(att.selectedPosition)) {
            att.selectedPosition = null;
            fixes++;
        }
    });

    if (fixes > 0) {
        console.log(`🛡️ PersistenceService: ${fixes} referencia(s) huérfana(s) corregida(s)`);
    }
    return fixes;
}

/**
 * 🔄 REGENERACIÓN DE IDs PARA CLONADO
 * Genera nuevos UUIDs para todos los datos locales para poder 
 * subirlos a una cuenta nueva de Firebase/Supabase sin conflictos.
 */
export async function prepareDataForNewAccount() {
    console.log('🔄 Iniciando regeneración de IDs para nueva cuenta...');
    
    try {
        await indexedDBService.clear('leaders');
        await indexedDBService.clear('positions');
        await indexedDBService.clear('employees');
        await indexedDBService.clear('attendance');
        console.log('Sweep: Almacenes de IndexedDB limpiados');
    } catch (clearError) {
        console.warn('⚠️ Error limpiando stores:', clearError);
    }

    const idMap = new Map();
    const now = Date.now();

    // 1. Líderes
    state.leaders.forEach(l => {
        const oldId = l.id;
        l.id = generateUUID();
        l.updatedAt = now;
        idMap.set(oldId, l.id);
    });

    // 2. Posiciones
    state.positions.forEach(p => {
        const oldId = p.id;
        p.id = generateUUID();
        p.updatedAt = now;
        if (p.leaderId && idMap.has(p.leaderId)) {
            p.leaderId = idMap.get(p.leaderId);
        }
        idMap.set(oldId, p.id);
    });

    // 3. Empleados
    state.employees.forEach(e => {
        const oldId = e.id;
        e.id = generateUUID();
        e.updatedAt = now;
        if (e.positions) {
            e.positions = e.positions.map(pid => idMap.has(pid) ? idMap.get(pid) : pid);
        }
        idMap.set(oldId, e.id);
    });

    // 4. Asistencia
    const newAttendance = {};
    Object.entries(state.attendance).forEach(([oldKey, att]) => {
        const oldEmpId = att.employeeId || oldKey.split('-')[0];
        const newEmpId = idMap.get(oldEmpId) || oldEmpId;
        const newKey = `${newEmpId}-${att.date}`;
        
        att.id = generateUUID();
        att.employeeId = newEmpId;
        att.updatedAt = now;
        if (att.selectedPosition && idMap.has(att.selectedPosition)) {
            att.selectedPosition = idMap.get(att.selectedPosition);
        }
        if (att.positionHours) {
            att.positionHours.forEach(ph => {
                if (idMap.has(ph.positionId)) ph.positionId = idMap.get(ph.positionId);
            });
        }
        newAttendance[newKey] = att;
    });
    state.attendance = newAttendance;

    await saveApplicationData();
    console.log('✅ IDs regenerados exitosamente');
    return true;
}

/**
 * 💾 SISTEMA DE AUTO-BACKUP (sessionStorage)
 */
export function createAutoBackup() {
    try {
        const backupData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            data: {
                employees: state.employees,
                positions: state.positions,
                leaders: state.leaders,
                attendance: state.attendance,
                settings: state.settings
            }
        };
        sessionStorage.setItem('attendance-backup', JSON.stringify(backupData));
    } catch (error) {
        console.error('❌ Error en auto-backup:', error);
    }
}

export function restoreAutoBackup() {
    try {
        const backup = sessionStorage.getItem('attendance-backup');
        if (backup) {
            const parsed = JSON.parse(backup);
            if (parsed.data && state.employees.length === 0) {
                Object.assign(state, parsed.data);
                NotificationSystem.success('✅ Sesión anterior restaurada');
                return true;
            }
        }
    } catch (error) {
        console.error('❌ Error restaurando backup:', error);
    }
    return false;
}

// Inicializar alias globales (Legacy compatibility)
globalThis.saveApplicationData = saveApplicationData;
globalThis.loadApplicationData = loadApplicationData;
globalThis.validateDataIntegrity = validateDataIntegrity;
globalThis.prepareDataForNewAccount = prepareDataForNewAccount;
globalThis.createAutoBackup = createAutoBackup;
globalThis.restoreAutoBackup = restoreAutoBackup;
globalThis.saveToLocalStorage = saveApplicationData;
globalThis.loadFromLocalStorage = loadApplicationData;
