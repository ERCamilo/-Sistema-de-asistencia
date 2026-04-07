/**
 * ðŸ’¾ PersistenceService.js - Central de Persistencia
 * Coordina el guardado de datos entre IndexedDB, LocalStorage y Firebase.
 */

import { state } from '../core/AppState.js';
import { buildAttendanceIndex } from '../core/AppState.js';
import FirebaseService from './FirebaseService.js';
import indexedDBService from './IndexedDBService.js';
import dataService from './DataService.js';
import { Notification as NotificationSystem } from '../components/Notification.js';
import { generateUUID, slugify } from '../utils/Helpers.js';

// Importar clases de entidad para inflar datos
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';
import { Attendance } from '../features/attendance/Attendance.js';
import { getDemoSeed } from '../data/DemoSeed.js';

// ⚡ Debounce de guardado: colapsa llamadas rápidas en un solo guardado
let _saveDebounceTimer = null;
let _pendingSaveOptions = {};

/**
 * âš¡ SINCRONIZACIÃ“N DEBUNCED PARA FIREBASE (Mirror Sync)
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
                    console.error('âš ï¸ Error en sincronizaciÃ³n debounced:', e);
                }
            }
        }, 2000); // 2 segundos de espera
    };
})();

/**
 * ðŸ’¾ GUARDADO SEGURO EN INDEXEDDB
 */
export async function saveToIndexedDB(options = {}) {
    try {
        await indexedDBService.saveState(state, options);
        console.log('ðŸ’¾ Datos guardados en IndexedDB');
        return true;
    } catch (error) {
        console.error('âŒ Error guardando en IndexedDB:', error);
    }
}

/**
 * 💾 FUNCIÓN PRINCIPAL DE PERSISTENCIA
 * Orquesta el guardado local y la sincronización con la nube.
 */
export function saveApplicationData(options = {}) {
    // Acumular opciones: si viene dateKey lo guardamos; si viene sin él, forzamos guardado completo
    if (options.dateKey && _pendingSaveOptions.dateKey) {
        _pendingSaveOptions.dateKey = options.dateKey; // Actualizar con el último dateKey
    } else {
        _pendingSaveOptions = { ...options }; // Guardado completo o primer call
    }

    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
        const opts = _pendingSaveOptions;
        _pendingSaveOptions = {};
        _executeSave(opts);
    }, 300);
}

async function _executeSave(options = {}) {
    if (!state.isDataLoaded) {
        console.warn('⚠️ Intento de guardado ignorado: datos aún no cargados.');
        return;
    }

    console.log('🔵 PersistenceService: _executeSave() iniciado', options.dateKey ? `para fecha: ${options.dateKey}` : '');

    // ☀️ Sincronización con Firebase
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
                console.error(`âš ï¸ Error en sync granular (${options.dateKey}):`, e)
            );
        }

        // 2. SincronizaciÃ³n Espejo (Full State) - DEBOUNCED
        syncFirebaseMirrorDebounced(state);

        // 3. Backup AutomÃ¡tico (Snapshots)
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
                }).catch(e => console.error('Error en backup automÃ¡tico:', e));
            }
        }
    }

    // ðŸ’¾ Persistencia Local
    if (state.useIndexedDB) {
        try {
            await indexedDBService.saveState(state, options);
        } catch (error) {
            // Manejo de conflictos de integridad
            if (error.name === 'ConstraintError' || error.message?.includes('ConstraintError')) {
                console.warn('âš¡ Conflicto de integridad en IndexedDB.');
                NotificationSystem.error('âŒ Conflicto de datos detectado');
            } else {
                // Fallback a localStorage
                if (dataService) dataService.saveAll();
                NotificationSystem.error('âŒ Error al guardar localmente');
            }
        }
    } else {
        if (dataService) dataService.saveAll();
    }

    // ðŸ“¡ Emitir evento de guardado si existe eventBus global o mediante globalThis
    if (globalThis.eventBus) {
        globalThis.eventBus.emit('data:saved', { timestamp: Date.now() });
    }

}

/**
 * ðŸ“‚ CARGA INICIAL DE DATOS
 * Maneja la migraciÃ³n de LocalStorage a IndexedDB si es necesario.
 */
export async function loadApplicationData() {
    try {
        console.log('ðŸ“‚ PersistenceService: Iniciando carga de datos...');
        
        // 1. Intentar cargar desde IndexedDB (Fase 2+)
        const idbData = await indexedDBService.loadFullState();
        
        if (idbData && (idbData.employees?.length > 0 || idbData.positions?.length > 0)) {
            console.log('âœ… Datos cargados desde IndexedDB');
            
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
            stateManager.markAttendanceDirty(); // Asegurar reconstrucción total tras carga masiva
            return true;
        }

        // 2. Fallback a LocalStorage (MigraciÃ³n o Legacy)
        console.log('ðŸ”„ No se detectaron datos en IndexedDB. Buscando en LocalStorage...');
        const hasDataInLS = dataService.loadAll();
        
        if (hasDataInLS) {
            console.log('âœ… Datos cargados desde LocalStorage');
            state.isDataLoaded = true;
            
            // Si el navegador soporta IndexedDB, migramos de inmediato
            if (indexedDBService.isSupported()) {
                console.log('ðŸš€ Migrando datos de LocalStorage a IndexedDB...');
                await indexedDBService.saveState(state);
                state.useIndexedDB = true;
                localStorage.setItem('migrated-to-idb', 'true');
            }
            
            validateDataIntegrity();
            return true;
        }

        console.log('â„¹ï¸ No hay datos guardados para cargar');
        state.isDataLoaded = true;
        return false;

    } catch (error) {
        console.error('âŒ Error fatal al cargar datos:', error);
        state.isDataLoaded = true; // No bloquear la UI
        return false;
    }
}

/**
 * ðŸŒ± CARGAR DATOS DEMO EN LA BASE DE DATOS
 * Limpia la base de datos actual e inyecta la semilla de prueba.
 */
export async function loadDemoDataIntoDB() {
    try {
        console.log('ðŸŒ± PersistenceService: Iniciando carga de datos DEMO...');
        const seed = getDemoSeed();
        
        // 1. Guardar en IndexedDB limpiando primero
        await indexedDBService.saveState(seed.data, { clearFirst: true });
        
        // 2. Recargar el estado global desde la base de datos reciÃ©n poblada
        await loadApplicationData();
        
        // 3. Marcar como modo demo
        state.usingDemoData = true;
        
        console.log('âœ… Datos DEMO cargados y persistidos correctamente');
        return true;
    } catch (error) {
        console.error('âŒ Error cargando datos demo:', error);
        throw error;
    }
}

/**
 * ðŸ›¡ï¸ VALIDACIÃ“N DE INTEGRIDAD
 * Limpia referencias huÃ©rfanas para evitar crashes en la UI.
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

    // 3. Limpiar lÃ­deres en posiciones
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
        console.log(`ðŸ›¡ï¸ PersistenceService: ${fixes} referencia(s) huÃ©rfana(s) corregida(s)`);
    }
    return fixes;
}

/**
 * ðŸ”„ REGENERACIÃ“N DE IDs PARA CLONADO
 * Genera nuevos UUIDs para todos los datos locales para poder 
 * subirlos a una cuenta nueva de Firebase/Supabase sin conflictos.
 */
export async function prepareDataForNewAccount() {
    console.log('ðŸ”„ Iniciando regeneraciÃ³n de IDs para nueva cuenta...');
    
    try {
        await indexedDBService.clear('leaders');
        await indexedDBService.clear('positions');
        await indexedDBService.clear('employees');
        await indexedDBService.clear('attendance');
        console.log('Sweep: Almacenes de IndexedDB limpiados');
    } catch (clearError) {
        console.warn('âš ï¸ Error limpiando stores:', clearError);
    }

    const idMap = new Map();
    const now = Date.now();

    // 1. LÃ­deres
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
    console.log('âœ… IDs regenerados exitosamente');
    return true;
}

/**
 * ðŸ’¾ SISTEMA DE AUTO-BACKUP (sessionStorage)
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
        console.error('âŒ Error en auto-backup:', error);
    }
}

export function restoreAutoBackup() {
    try {
        const backup = sessionStorage.getItem('attendance-backup');
        if (backup) {
            const parsed = JSON.parse(backup);
            if (parsed.data && state.employees.length === 0) {
                Object.assign(state, parsed.data);
                NotificationSystem.success('âœ… SesiÃ³n anterior restaurada');
                return true;
            }
        }
    } catch (error) {
        console.error('âŒ Error restaurando backup:', error);
    }
    return false;
}

/**
 * ðŸ§ª PRUEBA DE RESOLUCIÃ“N DE CONFLICTOS
 * Simula la restauraciÃ³n de un backup "sucio" con duplicados intencionales.
 */
export async function testConflictedRestore() {
    console.log('ðŸ§ª Iniciando prueba de restauraciÃ³n con CONFLICTOS...');
    
    try {
        // 1. Generar semilla con conflictos
        const conflictedSeed = getDemoSeed({ includeConflicts: true });
        console.log('ðŸ“¦ Backup de prueba generado (con duplicados intencionales)');
        
        // 2. Intentar restaurar usando IndexedDB
        // clearFirst: true simula una restauraciÃ³n limpia desde un archivo externo
        const stats = await indexedDBService.saveState(conflictedSeed.data, { clearFirst: true });
        
        // 3. Ejecutar saneamiento de puestos (donde unificamos por slug)
        const currentData = await indexedDBService.loadFullState();
        sanitizePositions(currentData);
        await indexedDBService.saveState(currentData);
        
        // 4. Recargar estado UI
        await loadApplicationData();
        
        NotificationSystem.success(`âœ… Prueba completada: ${stats.deduplicated} conflictos resueltos`);
        console.log('âœ… Resultado de la prueba:', stats);
        return stats;
    } catch (error) {
        console.error('âŒ Error en prueba de conflictos:', error);
        NotificationSystem.error('Error en prueba de conflictos');
    }
}

/**
 * ðŸ§¹ sanitizePositions() - Unifica puestos duplicados y migra IDs a Slugs
 * Este proceso es vital para evitar errores de cÃ¡lculo de nÃ³mina.
 */
export function sanitizePositions(state) {
    if (!state.positions || state.positions.length === 0) return false;

    console.log('ðŸ§¹ Iniciando sanitizaciÃ³n de posiciones...');
    const idMap = new Map(); // Mapa de ID_Viejo -> ID_Nuevo (Slug)
    const uniquePositions = [];
    const positionsBySlug = new Map();
    let hasChanges = false;

    state.positions.forEach(pos => {
        const slug = slugify(pos.name);
        if (!slug) return;

        if (!positionsBySlug.has(slug)) {
            // Es la primera vez que vemos este nombre de puesto
            const isNewId = pos.id !== slug;
            if (isNewId) hasChanges = true;

            const newPos = { ...pos, id: slug };
            positionsBySlug.set(slug, newPos);
            idMap.set(pos.id, slug);
            uniquePositions.push(newPos);
        } else {
            // Es un duplicado. Mapear el ID viejo al ID del puesto ya existente
            idMap.set(pos.id, slug);
            hasChanges = true;
            console.log(`ðŸ”— Fusionando duplicado: ${pos.name} (${pos.id} -> ${slug})`);
        }
    });

    if (!hasChanges) {
        console.log('âœ¨ No se encontraron duplicados ni IDs desactualizados.');
        return false;
    }

    // 1. Actualizar la lista oficial de puestos
    state.positions = uniquePositions;

    // 2. Actualizar empleados (sus arreglos de positions)
    if (state.employees) {
        state.employees.forEach(emp => {
            if (Array.isArray(emp.positions)) {
                const mapped = emp.positions.map(pid => idMap.get(pid) || pid);
                const unique = [...new Set(mapped)];
                if (JSON.stringify(emp.positions) !== JSON.stringify(unique)) {
                    emp.positions = unique;
                    hasChanges = true;
                }
            }
            // TambiÃ©n actualizar positionSalaries si existen
            if (emp.positionSalaries) {
                const newSalaries = {};
                Object.entries(emp.positionSalaries).forEach(([pid, val]) => {
                    const newId = idMap.get(pid) || pid;
                    newSalaries[newId] = val;
                });
                emp.positionSalaries = newSalaries;
            }
            
            // Especial: Sueldo por posiciÃ³n en el sistema viejo
            if (emp.positionId && idMap.has(emp.positionId)) {
                emp.positionId = idMap.get(emp.positionId);
            }
        });
    }

    // 3. Actualizar registros de asistencia (Attendance)
    if (state.attendance) {
        Object.values(state.attendance).forEach(att => {
            if (att.positionHours) {
                att.positionHours.forEach(ph => {
                    if (idMap.has(ph.positionId)) {
                        ph.positionId = idMap.get(ph.positionId);
                    }
                });
            }
            if (att.selectedPosition && idMap.has(att.selectedPosition)) {
                att.selectedPosition = idMap.get(att.selectedPosition);
            }
            // En algunos casos el record individual tiene positionId
            if (att.records) {
                Object.values(att.records).forEach(rec => {
                    if (rec.positionId && idMap.has(rec.positionId)) {
                        rec.positionId = idMap.get(rec.positionId);
                    }
                });
            }
        });
    }

    console.log('âœ… SanitizaciÃ³n completada.');
    return true;
}

// Inicializar alias globales (Legacy compatibility)
globalThis.saveApplicationData = saveApplicationData;
globalThis.loadApplicationData = loadApplicationData;
globalThis.validateDataIntegrity = validateDataIntegrity;
globalThis.prepareDataForNewAccount = prepareDataForNewAccount;
globalThis.createAutoBackup = createAutoBackup;
globalThis.restoreAutoBackup = restoreAutoBackup;
globalThis.sanitizePositions = sanitizePositions; // NUEVO
globalThis.saveToLocalStorage = saveApplicationData;
globalThis.loadFromLocalStorage = loadApplicationData;
globalThis.loadDemoDataIntoDB = loadDemoDataIntoDB;
globalThis.testConflictedRestore = testConflictedRestore;
