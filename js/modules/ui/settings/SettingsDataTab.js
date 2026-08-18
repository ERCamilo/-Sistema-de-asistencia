/**
 * SettingsDataTab.js - Componente de la pestaña Datos, Sincronización y Backups
 * Estilo visual: SyncCenter (stg-* classes)
 */
import { DateUtils } from '../../utils/DateUtils.js';
import { getReasonInfo } from '../../services/SnapshotReasons.js';

export function SettingsDataTab(context) {
    const state = context.state;
    const icons = context.icons;
    const currentUser = context.currentUser;

    return `
                    <!-- Sincronización con Firebase (Google) -->
                    <div class="stg-panel ${currentUser ? 'connected' : ''}">
                        <div class="stg-header">
                            <div>
                                <h3>Sincronización en la Nube</h3>
                                <p>${currentUser ? 'Gestiona tu conexión con Google y tus respaldos en la nube.' : 'Conecta tu cuenta de Google para respaldar tus datos y acceder desde cualquier dispositivo.'}</p>
                            </div>
                        </div>
                        
                        ${!currentUser ? `
                            <button type="button" data-settings-action="login-with-google" class="stg-login-cta">
                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" height="20">
                                Continuar con Google
                            </button>
                        ` : `
                            <div class="stg-user-card">
                                <img src="${currentUser.photoURL || ''}" onerror="this.src='https://ui-avatars.com/api/?name=${currentUser.displayName}'">
                                <div class="stg-user-card-info">
                                    <div class="stg-user-card-name">${currentUser.displayName || 'Usuario'}</div>
                                    <div class="stg-user-card-email">${currentUser.email}</div>
                                </div>
                                <button type="button" data-settings-action="logout-firebase" style="padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">
                                    Salir
                                </button>
                            </div>

                            <!-- Herramientas de Nube -->
                            <div class="stg-card-title">Backup y Snapshots</div>
                            <div class="stg-actions-grid">
                                <button type="button" data-settings-action="sync-firebase-now" class="stg-action">
                                    <span class="stg-action-icon blue">&#8635;</span>
                                    <span class="stg-action-copy">
                                        <strong>Sync Actual</strong>
                                        <small>Sincronizar estado actual con la nube.</small>
                                    </span>
                                </button>
                                <button type="button" data-settings-action="sync-history-now" class="stg-action">
                                    <span class="stg-action-icon cyan">&#128197;</span>
                                    <span class="stg-action-copy">
                                        <strong>Sync Historial</strong>
                                        <small>Sincronizar historial completo.</small>
                                    </span>
                                </button>
                                <button type="button" data-settings-action="create-firebase-snapshot" class="stg-action span-2">
                                    <span class="stg-action-icon green">&#9679;</span>
                                    <span class="stg-action-copy">
                                        <strong>Crear Snapshot Manual</strong>
                                        <small>Guarda una copia manual del estado actual.</small>
                                    </span>
                                </button>
                            </div>
                            
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 12px;">
                                <div class="form-group" style="margin-bottom: 0;">
                                    <label class="form-label" style="font-size: 0.78rem; color: #64748b; margin-bottom: 6px; display: block;">Auto-Backup (Snapshot)</label>
                                    <select id="backupFrequency" onchange="updateBackupFrequency(this.value)" class="form-input" style="padding: 9px 36px 9px 12px; font-size: 0.88rem; line-height: 1.4; height: auto;">
                                        <option value="none" ${state.settings?.backupFrequency === 'none' ? 'selected' : ''}>Desactivado</option>
                                        <option value="daily" ${state.settings?.backupFrequency === 'daily' ? 'selected' : ''}>Diario</option>
                                        <option value="weekly" ${state.settings?.backupFrequency === 'weekly' ? 'selected' : ''}>Semanal</option>
                                        <option value="monthly" ${state.settings?.backupFrequency === 'monthly' ? 'selected' : ''}>Mensual</option>
                                    </select>
                                </div>
                                <div class="form-group" style="margin-bottom: 0;">
                                    <label class="form-label" style="font-size: 0.78rem; color: #64748b; margin-bottom: 6px; display: block;">Respaldo Espejo (Mirror)</label>
                                    <select id="mirrorCadence" onchange="updateMirrorCadence(this.value)" class="form-input" style="padding: 9px 36px 9px 12px; font-size: 0.88rem; line-height: 1.4; height: auto;">
                                        <option value="instant" ${state.settings?.mirrorCadence === 'instant' ? 'selected' : ''}>Instantáneo (Sin espera)</option>
                                        <option value="1m" ${state.settings?.mirrorCadence === '1m' ? 'selected' : ''}>1 min (Rápido)</option>
                                        <option value="5m" ${(state.settings?.mirrorCadence === '5m' || !state.settings?.mirrorCadence) ? 'selected' : ''}>5 min (Recomendado)</option>
                                        <option value="15m" ${state.settings?.mirrorCadence === '15m' ? 'selected' : ''}>15 min (Ahorro)</option>
                                        <option value="manual" ${state.settings?.mirrorCadence === 'manual' ? 'selected' : ''}>Solo al cerrar / Manual</option>
                                    </select>
                                </div>
                            </div>
                        `}
                    </div>

                    <!-- Historial de Snapshots -->
                    ${currentUser ? SnapshotHistory(context) : ''}
                    
                    <!-- Salud de Datos y Duplicados -->
                    <div class="stg-panel accent">
                        <div class="stg-header">
                            <div>
                                <h3>Salud de los Datos</h3>
                                <p>Busca y resuelve inconsistencias, como empleados con números de ficha duplicados.</p>
                            </div>
                        </div>
                        <button type="button" data-settings-action="start-maintenance-wizard" class="stg-action" style="width: 100%;">
                            <span class="stg-action-icon cyan">&#9881;</span>
                            <span class="stg-action-copy">
                                <strong>Iniciar Asistente de Saneamiento</strong>
                                <small>Esto asegura que la nómina y las asistencias sean precisas.</small>
                            </span>
                        </button>
                    </div>

                    <!-- Gestión de Datos -->
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        
                        <!-- Datos Locales -->
                        <div class="stg-panel">
                            <div class="stg-header">
                                <div>
                                    <h3>Datos Locales (Este dispositivo)</h3>
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">
                                <!-- Sistema de Almacenamiento -->
                                <div class="stg-card">
                                    <div class="stg-card-title">Almacenamiento Interno</div>
                                    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                                        <label style="flex: 1; cursor: pointer;">
                                            <input type="radio" name="storageTypeData" value="localStorage" ${!state.useIndexedDB ? 'checked' : ''} onchange="handleStorageTypeChange(this.value)" style="display: none;">
                                            <div style="padding: 10px; background: ${!state.useIndexedDB ? 'var(--stg-accent)' : 'var(--stg-card-bg)'}; border-radius: 8px; text-align: center; border: 1px solid ${!state.useIndexedDB ? 'var(--stg-accent)' : 'var(--stg-border-card)'};">
                                                <div style="font-weight: 600; font-size: 0.9rem; color: ${!state.useIndexedDB ? 'white' : '#94a3b8'};">Local</div>
                                            </div>
                                        </label>
                                        <label style="flex: 1; cursor: pointer;">
                                            <input type="radio" name="storageTypeData" value="indexedDB" ${state.useIndexedDB ? 'checked' : ''} onchange="handleStorageTypeChange(this.value)" style="display: none;">
                                            <div style="padding: 10px; background: ${state.useIndexedDB ? 'var(--stg-accent)' : 'var(--stg-card-bg)'}; border-radius: 8px; text-align: center; border: 1px solid ${state.useIndexedDB ? 'var(--stg-accent)' : 'var(--stg-border-card)'};">
                                                <div style="font-weight: 600; font-size: 0.9rem; color: ${state.useIndexedDB ? 'white' : '#94a3b8'};">IndexedDB</div>
                                            </div>
                                        </label>
                                    </div>
                                    <div id="indexeddb-stats" style="font-size: 0.7rem; color: #64748b; line-height: 1.5;">${state.useIndexedDB ? 'Cargando estadísticas...' : 'Usando LocalStorage (límite 5MB)'}</div>
                                </div>

                                <!-- Backups Manuales -->
                                <div class="stg-card" style="display: flex; flex-direction: column; gap: 10px;">
                                    <div class="stg-card-title" style="margin-bottom: 2px;">Archivo Backup (.json)</div>
                                    <button type="button" data-settings-action="export-data" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px; border-radius: 8px;">Descargar Backup</button>
                                    <button type="button" data-settings-action="open-import-input" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px; border-radius: 8px;">Cargar Backup</button>
                                    <input type="file" id="import-file-input" accept=".json" style="display: none;" onchange="importData(event)">
                                </div>
                            </div>

                            <!-- Borrado Local -->
                            <div class="stg-danger-zone">
                                <div class="stg-danger-zone-copy">
                                    <div class="stg-danger-zone-title">BORRADO LOCAL TOTAL</div>
                                    <div class="stg-danger-zone-desc">Limpia este teléfono por completo. Los datos en la nube NO se borrarán.</div>
                                </div>
                                <button type="button" data-settings-action="delete-all-data" class="btn-danger" style="white-space: nowrap; padding: 10px 20px;">Borrar Local</button>
                            </div>
                        </div>

                        <!-- Datos en la Nube -->
                        ${currentUser ? `
                        <div class="stg-panel connected">
                            <div class="stg-header">
                                <div>
                                    <h3>Gestión de Nube (Google Account)</h3>
                                </div>
                            </div>

                            <div class="stg-actions-grid">
                                <!-- Override: Download (reemplazo real, Fase 0.5 U4) -->
                                <button type="button" data-settings-action="download-from-cloud" class="stg-action">
                                    <span class="stg-action-icon blue">&#8595;</span>
                                    <span class="stg-action-copy">
                                        <strong>Descargar y Reemplazar</strong>
                                        <small>Borra lo de este equipo y deja la nube como única fuente.</small>
                                    </span>
                                </button>

                                <!-- Override: Upload (reemplazo real, Fase 0.5 U5) -->
                                <button type="button" data-settings-action="upload-to-cloud" class="stg-action">
                                    <span class="stg-action-icon green">&#8593;</span>
                                    <span class="stg-action-copy">
                                        <strong>Subir y Reemplazar</strong>
                                        <small>Borra lo de la nube y la deja igual a este equipo (con snapshot previo).</small>
                                    </span>
                                </button>
                            </div>

                            <!-- Borrado Nube -->
                            <div class="stg-danger-zone">
                                <div class="stg-danger-zone-copy">
                                    <div class="stg-danger-zone-title">ELIMINAR DATOS DE LA NUBE</div>
                                    <div class="stg-danger-zone-desc">Borra permanentemente tu respaldo en Google/Firebase. El teléfono no se verá afectado.</div>
                                </div>
                                <button type="button" data-settings-action="delete-cloud-data" class="btn-danger" style="white-space: nowrap; padding: 10px 20px; background: none; border: 1px solid #ef4444; color: #ef4444;">Borrar Nube</button>
                            </div>
                            
                            <!-- Limpieza de Historial Masiva -->
                            <div class="stg-card" style="margin-top: 14px;">
                                <div class="stg-card-title" style="display: flex; align-items: center; gap: 8px;">
                                    Limpieza de Historial (Snapshots)
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                    <button type="button" data-settings-action="bulk-delete-snapshots" data-value="auto" class="btn-secondary" style="font-size: 0.75rem; padding: 8px; border-color: rgba(239, 68, 68, 0.3); color: #94a3b8; border-radius: 8px;">
                                        Borrar Todos los Autos
                                    </button>
                                    <button type="button" data-settings-action="bulk-delete-snapshots" data-value="manual" class="btn-secondary" style="font-size: 0.75rem; padding: 8px; border-color: rgba(239, 68, 68, 0.3); color: #94a3b8; border-radius: 8px;">
                                        Borrar Todos los Manuales
                                    </button>
                                </div>
                                <p style="margin: 8px 0 0 0; font-size: 0.65rem; color: #64748b;">
                                    * Las versiones marcadas como 'Protegidas' (p. ej. pre-restauración) no se borrarán.
                                </p>
                            </div>
                        </div>
                        ` : ''}
                    </div>

                    <!-- Limpieza de datos locales (aparece siempre) -->
                    <div class="stg-panel">
                        <div class="stg-header">
                            <div>
                                <h3>Limpieza de datos</h3>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <span style="font-size: 0.8rem; color: #94a3b8; flex: 1; min-width: 200px; line-height: 1.5;">
                                Elimina el historial de asistencia de empleados que ya <strong style="color:#cbd5e1;">fueron borrados</strong> y cuyos registros quedaron sueltos. No afecta a los empleados actuales.
                            </span>
                            <button type="button" data-settings-action="purge-orphan-attendance" class="btn-secondary" style="padding: 8px 16px; font-size: 0.8rem; white-space: nowrap; border-color: rgba(239,68,68,0.3); color: #fca5a5;">
                                Eliminar historial de empleados borrados
                            </button>
                        </div>
                    </div>
            `;
}

function SnapshotHistory(context) {
    const state = context.state;
    const icons = context.icons;
    const snapshots = state.snapshots || [];
    const isLoading = state.isLoadingSnapshots;

    return `
        <div class="stg-panel">
            <div class="stg-header">
                <div>
                    <h3>Historial de Versiones (Snapshots)</h3>
                </div>
            </div>
            
            ${isLoading ? `
                <div style="padding: 20px; text-align: center; color: #94a3b8;">
                    <div class="spinner" style="margin: 0 auto 10px;"></div>
                    Cargando versiones desde la nube...
                </div>
            ` : snapshots.length === 0 ? `
                <div style="padding: 20px; text-align: center; color: #64748b; font-style: italic;">
                    No hay snapshots disponibles en esta cuenta.
                </div>
            ` : `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${snapshots.map(snap => {
                        const info = getReasonInfo(snap.reason, snap.type);
                        const badgeLabel = snap.type === 'pre-restore'
                            ? 'PROTEGIDO'
                            : (snap.type === 'auto' ? 'AUTO' : 'MANUAL');
                        const badgeColor = snap.type === 'pre-restore' ? '#10b981'
                            : (snap.type === 'auto' ? '#10b981' : '#06b6d4');
                        const badgeBg = snap.type === 'pre-restore'
                            ? 'rgba(16, 185, 129, 0.2)'
                            : (snap.type === 'auto' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(6, 182, 212, 0.1)');
                        return `
                        <div class="stg-snapshot">
                            <div style="flex: 1; min-width: 0;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                                    <span style="font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}; font-weight: ${snap.type === 'pre-restore' ? '700' : '600'};">
                                        ${badgeLabel}
                                    </span>
                                    <span style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">
                                        ${DateUtils.formatDateTime(snap.createdAt)}
                                    </span>
                                </div>
                                <!-- Razón legible del snapshot -->
                                <div style="color: ${info.color || '#cbd5e1'}; font-size: 0.8rem; font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                                    <span>${info.icon || ''}</span>
                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${info.label}</span>
                                </div>
                                ${snap.userNote ? `
                                    <div style="color: #94a3b8; font-size: 0.75rem; font-style: italic; margin-bottom: 4px; padding-left: 4px; border-left: 2px solid #334155;">
                                        "${snap.userNote}"
                                    </div>
                                ` : ''}
                                <div style="color: #94a3b8; font-size: 0.75rem; display: flex; align-items: center; gap: 4px;">
                                    ${icons.get('personnel', { size: 12 })} ${snap.employeeCount} empleados <span style="opacity: 0.4;">|</span> ${icons.get('file', { size: 12 })} ${snap.attendanceCount} registros
                                </div>
                            </div>
                            <div class="stg-snapshot-actions">
                                <button type="button" data-settings-action="delete-snapshot" data-id="${snap.id}" aria-label="Eliminar snapshot"
                                        style="padding: 8px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"
                                        title="Eliminar permanentemente">
                                    &#x1F5D1;
                                </button>
                                <button type="button" data-settings-action="restore-snapshot" data-id="${snap.id}" aria-label="Restaurar snapshot" 
                                        style="padding: 8px 16px; background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">
                                    Restaurar
                                </button>
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            `}
            
            <p style="margin: 16px 0 0 0; font-size: 0.7rem; color: #64748b; line-height: 1.4;">
                <strong>Nota:</strong> Al restaurar una versión, se sobrescribirán los datos actuales. Asegúrate de crear un snapshot nuevo antes si no estás seguro.
            </p>
        </div>
    `;
}
