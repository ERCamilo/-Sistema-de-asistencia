/**
 * 💾 PersistenceService.js - Central de Persistencia
 * Coordina el guardado de datos entre IndexedDB, LocalStorage y Firebase.
 */

import { state, stateManager } from '../core/AppState.js';
import { buildAttendanceIndex } from '../core/AppState.js';
import FirebaseService from './FirebaseService.js';
import indexedDBService from './IndexedDBService.js';
import dataService from './DataService.js';
import { Notification as NotificationSystem } from '../components/Notification.js';
import { generateUUID, slugify } from '../utils/Helpers.js';
import { debug } from '../utils/Debug.js';

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
 * ⚡ SINCRONIZACIÓN DEBUNCED PARA FIREBASE (Mirror Sync)
 * Evita saturar la cuota de Firebase con guardados demasiado frecuentes
 */
export const syncFirebaseMirrorDebounced = (function() {
    let timeout;
    return function(state) {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            if (globalThis.currentUser && !globalThis._isApplyingRemoteData) {
                // ⚡ P4-OPT: Ejecutar guardado en Firebase solo cuando el hilo principal esté libre
                const runSync = () => {
                    FirebaseService.saveFullState(state).catch(e => {
                        console.warn('⚠️ Error en sincronización debounced:', e);
                    });
                };

                if (window.requestIdleCallback) {
                    window.requestIdleCallback(runSync, { timeout: 1000 });
                } else {
                    runSync();
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
        debug.log('💾 Datos guardados en IndexedDB');
        return true;
    } catch (error) {
        console.error('❌ Error guardando en IndexedDB:', error);
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

    // ⚡ FIX: Almacenar marca de tiempo de la última modificación local
    // Esto previene que la caché de Firebase sobrescriba cambios si se refresca la página
    // muy rápido antes de que se complete el debounced sync a la nube.
    if (!globalThis._isApplyingRemoteData) {
        if (!state.settings) state.settings = {};
        state.settings.localUpdatedAt = Date.now();
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
                const rawState = stateManager.getState();
                FirebaseService.createSnapshot(rawState, 'auto').then(() => {
                    state.settings.lastSnapshotTimestamp = now;
                }).catch(e => console.error('Error en backup automático:', e));
            }
        }
    }

    // 💾 Persistencia Local
    if (state.useIndexedDB && !globalThis._isApplyingRemoteData) {
        try {
            // ⚡ P2-OPT: Saltar validación de integridad pesada en guardados granulares
            if (!options.dateKey && !options.skipValidation) {
                validateDataIntegrity();
            }
            
            // ⚡ FIX: Usar el estado "raw" (sin proxy) para evitar DataCloneError en IndexedDB
            const rawState = stateManager.getState();
            await indexedDBService.saveState(rawState, options);
        } catch (error) {
            // Manejo de conflictos de integridad con defensa contra error nulo
            const errorName = error?.name || '';
            const errorMessage = error?.message || 'Error desconocido';

            if (errorName === 'ConstraintError' || errorMessage.includes('ConstraintError')) {
                console.warn('⚡ Conflicto de integridad en IndexedDB.');
                NotificationSystem.error('❌ Conflicto de datos detectado');
            } else {
                console.error('❌ Error fatal en persistencia local:', error);
                // Fallback a localStorage
                if (dataService) dataService.saveAll();
                NotificationSystem.error('❌ Error al guardar localmente: ' + errorMessage);
            }
        }
    } else {
        if (dataService) dataService.saveAll();
    }

    // 📡 Emitir evento de guardado
    if (globalThis.eventBus) {
        globalThis.eventBus.emit('data:saved', { timestamp: Date.now() });
    }
}

/**
 * 📂 CARGA INICIAL DE DATOS
 * Maneja la migración de LocalStorage a IndexedDB si es necesario.
 */
export async function loadApplicationData() {
    try {
        debug.log('📂 PersistenceService: Iniciando carga de datos...');
        
        // 1. Intentar cargar desde IndexedDB (Fase 2+)
        const idbData = await indexedDBService.loadFullState();
        
        if (idbData && (idbData.employees?.length > 0 || idbData.positions?.length > 0)) {
            debug.log('✅ Datos cargados desde IndexedDB');
            
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

            // 🛡️ Validar integridad. Si hubo correcciones, persistir inmediatamente
            // para evitar que Firebase reescriba el state con datos sucios después.
            const fixesOnLoad = validateDataIntegrity();
            if (fixesOnLoad > 0) {
                debug.log(`🛡️ Persistiendo ${fixesOnLoad} corrección(es) de integridad...`);
                // Guardado full (no granular) → también dispara sync con Firebase
                saveApplicationData({ force: true });
            }

            stateManager.markAttendanceDirty(); // Asegurar reconstrucción total tras carga masiva
            return true;
        }

        // 2. Fallback a LocalStorage (Migración o Legacy)
        console.log('🔄 No se detectaron datos en IndexedDB. Buscando en LocalStorage...');
        const hasDataInLS = dataService.loadAll();
        
        if (hasDataInLS) {
            debug.log('✅ Datos cargados desde LocalStorage');
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
 * 🌱 CARGAR DATOS DEMO EN LA BASE DE DATOS
 * Limpia la base de datos actual e inyecta la semilla de prueba.
 */
export async function loadDemoDataIntoDB() {
    try {
        console.log('🌱 PersistenceService: Iniciando carga de datos DEMO...');
        const seed = getDemoSeed();
        
        // 1. Guardar en IndexedDB limpiando primero
        await indexedDBService.saveState(seed.data, { clearFirst: true });
        
        // 2. Recargar el estado global desde la base de datos recién poblada
        await loadApplicationData();
        
        // 3. Marcar como modo demo
        state.usingDemoData = true;
        
        console.log('✅ Datos DEMO cargados y persistidos correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error cargando datos demo:', error);
        throw error;
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
            // ⚡ P3-OPT: Si la posición seleccionada no existe por ID, puede ser un "Legacy ID" (un número largo de Firebase)
            // Intentamos buscar una posición activa con un nombre similar antes de borrarla.
            if (att.selectedPosition && !positionIds.has(att.selectedPosition)) {
                const legacyId = att.selectedPosition;
                // Si es un ID numérico largo (indicativo de Firebase), no lo borramos de inmediato
                // ya que la sanitización en el otro módulo puede estar por ocurrir.
                if (legacyId.length > 10 && !isNaN(legacyId)) {
                    // Esperar a que la sanitización actúe, no borrar nada
                } else {
                    att.selectedPosition = null;
                    fixes++;
                }
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

/**
 * 🧪 PRUEBA DE RESOLUCIÓN DE CONFLICTOS
 * Simula la restauración de un backup "sucio" con duplicados intencionales.
 */
export async function testConflictedRestore() {
    console.log('🧪 Iniciando prueba de restauración con CONFLICTOS...');
    
    try {
        // 1. Generar semilla con conflictos
        const conflictedSeed = getDemoSeed({ includeConflicts: true });
        console.log('📦 Backup de prueba generado (con duplicados intencionales)');
        
        // 2. Intentar restaurar usando IndexedDB
        // clearFirst: true simula una restauración limpia desde un archivo externo
        const stats = await indexedDBService.saveState(conflictedSeed.data, { clearFirst: true });
        
        // 3. Ejecutar saneamiento de puestos (donde unificamos por slug)
        const currentData = await indexedDBService.loadFullState();
        sanitizePositions(currentData);
        await indexedDBService.saveState(currentData);
        
        // 4. Recargar estado UI
        await loadApplicationData();
        
        NotificationSystem.success(`✅ Prueba completada: ${stats.deduplicated} conflictos resueltos`);
        console.log('✅ Resultado de la prueba:', stats);
        return stats;
    } catch (error) {
        console.error('❌ Error en prueba de conflictos:', error);
        NotificationSystem.error('Error en prueba de conflictos');
    }
}

/**
 * 🧹 sanitizePositions() - Unifica puestos duplicados y migra IDs a Slugs
 * Este proceso es vital para evitar errores de cálculo de nómina.
 */
export function sanitizePositions(state) {
    if (!state.positions || state.positions.length === 0) return false;

    debug.log('🧹 Iniciando sanitización de posiciones...');
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
            console.log(`🔗 Fusionando duplicado: ${pos.name} (${pos.id} -> ${slug})`);
        }
    });

    if (!hasChanges) {
        debug.log('✨ No se encontraron duplicados ni IDs desactualizados.');
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
            // También actualizar positionSalaries si existen
            if (emp.positionSalaries) {
                const newSalaries = {};
                Object.entries(emp.positionSalaries).forEach(([pid, val]) => {
                    const newId = idMap.get(pid) || pid;
                    newSalaries[newId] = val;
                });
                emp.positionSalaries = newSalaries;
            }
            
            // Especial: Sueldo por posición en el sistema viejo
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

    console.log('✅ Sanitización completada.');
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

/**
 * 🔍 analyzeConflicts() - Detecta empleados duplicados por número de ficha
 * @returns {Array} Lista de grupos de conflictos
 */
export function analyzeConflicts() {
    if (!state.employees || state.employees.length === 0) return [];

    const groups = new Map();
    const processedIds = new Set();

    state.employees.forEach(emp => {
        if (!emp.number || !emp.id) return;
        
        // ⚡ FIX: Ignorar si ya procesamos este ID exacto en memoria (duplicado de referencia)
        if (processedIds.has(emp.id)) return;
        processedIds.add(emp.id);

        if (!groups.has(emp.number)) groups.set(emp.number, []);
        groups.get(emp.number).push(emp);
    });

    const conflicts = [];
    groups.forEach((members, number) => {
        if (members.length > 1) {
            const conflictGroup = members.map(emp => {
                // Calcular metadatos para ayudar en la decisión
                const idPrefix = `${emp.id}-`;
                const attendanceKeys = Object.keys(state.attendance || {}).filter(k => k.startsWith(idPrefix));
                
                let lastDate = 'Nunca';
                if (attendanceKeys.length > 0) {
                    const sortedDates = attendanceKeys.map(k => k.substring(idPrefix.length)).sort();
                    lastDate = sortedDates[sortedDates.length - 1];
                }

                // Calcular completitud del perfil (0-100)
                const fields = ['phone', 'email', 'salary', 'dailyRate', 'entryDate'];
                const filled = fields.filter(f => emp[f] && emp[f] !== '').length;
                const completeness = Math.round((filled / fields.length) * 100);

                return {
                    ...emp,
                    attendanceCount: attendanceKeys.length,
                    lastAttendance: lastDate,
                    completeness: completeness
                };
            });
            conflicts.push({ number, members: conflictGroup });
        }
    });

    return conflicts;
}

/**
 * 🤝 mergeEmployees() - Fusiona un registro duplicado en un registro maestro
 * ⚠️ NO guarda automáticamente. El caller debe llamar saveApplicationData() al terminar.
 */
export function mergeEmployees(masterId, duplicateId) {
    const master = state.employees.find(e => e.id === masterId);
    const duplicate = state.employees.find(e => e.id === duplicateId);

    // Protección contra auto-fusión y existencias
    if (!master || !duplicate || masterId === duplicateId) {
        console.warn(`⚠️ Fusión abortada: ${!master ? 'Maestro no existe' : !duplicate ? 'Duplicado no existe' : 'Son el mismo ID'}`);
        return false;
    }

    console.log(`🤝 Fusionando: ${duplicate.name} -> ${master.name}`);

    // 1. Remapear Asistencia
    const idPrefix = `${duplicateId}-`;
    Object.keys(state.attendance || {}).forEach(oldKey => {
        if (oldKey.startsWith(idPrefix)) {
            const datePart = oldKey.substring(idPrefix.length);
            const newKey = `${masterId}-${datePart}`;
            const oldRecord = state.attendance[oldKey];
            const existingRecord = state.attendance[newKey];

            if (!existingRecord) {
                // Simplemente mover
                oldRecord.employeeId = masterId;
                oldRecord.key = newKey;
                state.attendance[newKey] = oldRecord;
            } else {
                // Fusionar inteligentemente
                existingRecord.present = existingRecord.present || oldRecord.present;
                existingRecord.hoursWorked = Math.max(existingRecord.hoursWorked || 0, oldRecord.hoursWorked || 0);
                if (oldRecord.note && (!existingRecord.note || !existingRecord.note.includes(oldRecord.note))) {
                    existingRecord.note = existingRecord.note ? `${existingRecord.note} | ${oldRecord.note}` : oldRecord.note;
                }
                // Fusionar horas por posición si existen
                if (oldRecord.positionHours) {
                    existingRecord.positionHours = existingRecord.positionHours || [];
                    oldRecord.positionHours.forEach(oph => {
                        const existingPh = existingRecord.positionHours.find(eph => eph.positionId === oph.positionId);
                        if (existingPh) {
                            existingPh.hours = Math.max(existingPh.hours, oph.hours);
                        } else {
                            existingRecord.positionHours.push(oph);
                        }
                    });
                }
            }
            delete state.attendance[oldKey];
        }
    });

    // 2. Fusionar Datos Financieros
    if (duplicate.advances) {
        master.advances = [...(master.advances || []), ...(duplicate.advances || [])];
    }
    if (duplicate.bonuses) {
        master.bonuses = [...(master.bonuses || []), ...(duplicate.bonuses || [])];
    }
    if (duplicate.deductions) {
        master.deductions = [...(master.deductions || []), ...(duplicate.deductions || [])];
    }

    // 3. Completar campos del maestro si están vacíos
    ['phone', 'email', 'entryDate', 'salary', 'dailyRate'].forEach(field => {
        if (!master[field] && duplicate[field]) master[field] = duplicate[field];
    });

    // 4. Eliminar el duplicado del estado
    state.employees = state.employees.filter(e => e.id !== duplicateId);

    return true;
}

/**
 * 🔤 Normaliza un nombre para comparación (sin acentos, minúsculas, sin espacios extra)
 */
function normalizeName(name) {
    return (name || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim();
}

/**
 * 🔍 Determina si dos nombres son suficientemente similares para considerarlos la misma persona
 */
function areSamePerson(nameA, nameB) {
    const a = normalizeName(nameA);
    const b = normalizeName(nameB);
    if (a === b) return true;
    // Si uno contiene al otro (ej: "Juan" vs "Juan Perez")
    if (a.includes(b) || b.includes(a)) return true;
    return false;
}

/**
 * ⚡ executeAutoRepair() - Ejecuta limpieza automática basada en puntuación
 * Separa conflictos en dos categorías:
 *   - Misma persona (nombres similares) → fusión automática
 *   - Personas distintas (nombres diferentes) → pendientes de reasignación
 * @returns {{ success, fixed, pendingReassignments }}
 */
export async function executeAutoRepair() {
    const conflicts = analyzeConflicts();
    if (conflicts.length === 0) {
        NotificationSystem.info('✨ No se encontraron duplicados.');
        return { success: true, fixed: 0, pendingReassignments: [] };
    }

    let fixedCount = 0;
    const pendingReassignments = [];

    conflicts.forEach(group => {
        // Verificar si todos los miembros son la misma persona
        const firstMember = group.members[0];
        const allSamePerson = group.members.every(m => areSamePerson(m.name, firstMember.name));

        if (!allSamePerson) {
            // Personas distintas: no fusionar, acumular para reasignación
            console.log(`⚠️ Ficha ${group.number}: nombres diferentes detectados, omitiendo fusión automática`);
            pendingReassignments.push(group);
            return;
        }

        // Misma persona: fusionar automáticamente
        const sorted = [...group.members].sort((a, b) => {
            if (b.attendanceCount !== a.attendanceCount) return b.attendanceCount - a.attendanceCount;
            const timeA = new Date(a.updatedAt || 0).getTime();
            const timeB = new Date(b.updatedAt || 0).getTime();
            if (timeB !== timeA) return timeB - timeA;
            return b.completeness - a.completeness;
        });

        const master = sorted[0];
        const duplicates = sorted.slice(1);

        duplicates.forEach(dup => {
            if (mergeEmployees(master.id, dup.id)) fixedCount++;
        });
    });

    // Guardar UNA sola vez con limpieza de attendance en IndexedDB
    if (fixedCount > 0) {
        await saveApplicationData({ skipValidation: false, clearAttendance: true });
    }

    if (pendingReassignments.length > 0) {
        NotificationSystem.info(`⚡ ${fixedCount} duplicados fusionados. ${pendingReassignments.length} conflicto(s) requieren reasignación manual.`);
    } else {
        NotificationSystem.success(`⚡ Limpieza automática completada. Se eliminaron ${fixedCount} duplicados.`);
    }

    if (globalThis.render) globalThis.render();
    
    return { success: true, fixed: fixedCount, pendingReassignments };
}

/**
 * 🔄 reassignEmployeeNumber() - Cambia el número de ficha de un empleado
 * También actualiza las claves de asistencia para mantener coherencia.
 * ⚠️ NO guarda automáticamente. El caller debe llamar saveApplicationData().
 */
export function reassignEmployeeNumber(employeeId, newNumber) {
    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return false;

    // Verificar que el nuevo número no esté en uso
    const conflict = state.employees.find(e => e.number === newNumber && e.id !== employeeId);
    if (conflict) {
        console.warn(`⚠️ Número ${newNumber} ya en uso por ${conflict.name}`);
        return false;
    }

    const oldNumber = emp.number;
    emp.number = newNumber;
    emp.updatedAt = Date.now();
    emp._isDirty = true;

    console.log(`🔄 Ficha reasignada: ${emp.name} (${oldNumber} → ${newNumber})`);
    return true;
}

// Inicializar alias globales
globalThis.analyzeConflicts = analyzeConflicts;
globalThis.mergeEmployees = mergeEmployees;
globalThis.executeAutoRepair = executeAutoRepair;
globalThis.reassignEmployeeNumber = reassignEmployeeNumber;
