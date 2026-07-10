import icons from './IconSystem.js';

let context = null;

// ============================================
// 🎯 EVENT DELEGATION (data-sync-action)
// ============================================
const _SYNC_ACTION_MAP = {
    'login-with-google': () => window.loginWithGoogle?.(),
    'change-tab': (tab) => window.changeTab?.(tab),
    'close-modal': () => window.closeModal?.(),
    'upload-to-cloud': () => window.uploadToCloud?.(),
    'download-from-cloud': () => window.downloadFromCloud?.(),
    'close-overlay': (_, el, e) => { if (e.target === el) window.closeModal?.(); }
};

function _handleSyncClick(e) {
    const target = e.target.closest('[data-sync-action]');
    if (!target) return;
    const action = target.dataset.syncAction;
    const handler = _SYNC_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

let _syncDelegationAttached = false;

export function initSyncUI(ctx) {
    context = ctx;
    if (!_syncDelegationAttached) {
        document.addEventListener('click', _handleSyncClick);
        _syncDelegationAttached = true;
    }
}

// Helper para acceder a dependencias globales si no fueron inyectadas directas
function getState() { return context.state; }
function getIcons() { return icons; }

// ============================================
// INDICADOR DE SINCRONIZACIÓN
// ============================================
export function SyncIndicator() {
    const state = getState();
    const currentUser = window.currentUser;

    if (!currentUser) {
        return `
            <button 
                class="settings-btn" 
                style="color: #94a3b8; font-size: 1.25rem;"
                title="Iniciar sesión con Google"
                type="button" data-sync-action="login-with-google"
            >
                ${icons.get('user')}
            </button>
        `;
    }

    const status = state.syncStatus;
    const iconsMap = getIcons();

    function getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " años";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " meses";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " días";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " horas";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " minutos";
        return Math.floor(seconds) + " segundos";
    }

    const statusConfig = {
        idle: {
            icon: iconsMap.get('cloud'),
            color: '#64748b',
            text: 'Sin actividad',
            title: 'Nube: Sin actividad'
        },
        syncing: {
            icon: iconsMap.get('sync'),
            color: '#06b6d4',
            text: 'Sincronizando...',
            title: 'Sincronizando con la nube...',
            animate: true
        },
        synced: {
            icon: iconsMap.get('check'),
            color: '#10b981',
            text: 'Sincronizado',
            title: `Última sync: ${state.lastSync ? getTimeAgo(new Date(state.lastSync)) : 'Recién ahora'}`
        },
        error: {
            icon: iconsMap.get('x-circle'),
            color: '#ef4444',
            text: 'Error',
            title: 'Error en la sincronización'
        }
    };

    const config = statusConfig[status] || statusConfig.idle;

    return `
                <button 
                    class="settings-btn sync-indicator-btn" 
                    style="
                        color: ${config.color}; 
                        font-size: 1.25rem;
                        position: relative;
                        ${config.animate ? 'animation: spin 2s linear infinite;' : ''}
                    "
                    title="${config.title}"
                    type="button" data-sync-action="change-tab" data-value="settings"
                >
                    ${config.icon}
                </button>
            `;
}

// ============================================
// MODALES DE SINCRONIZACIÓN INICIAL
// ============================================

export function getSyncSummaryHTML(local, remote) {
    const formatDate = (ts) => {
        if (!ts) return 'Nunca';
        const d = new Date(ts);
        return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + 
               d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return `
        <div style="margin: 15px 0 25px 0; border: 1px solid #334155; border-radius: 12px; overflow: hidden; background: #0f172a; font-size: 0.85rem;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #1e293b; color: #94a3b8; text-align: left;">
                        <th style="padding: 10px 12px; border-bottom: 1px solid #334155;">Detalle</th>
                        <th style="padding: 10px 12px; border-bottom: 1px solid #334155;">💻 Local</th>
                        <th style="padding: 10px 12px; border-bottom: 1px solid #334155;">☁️ Nube</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #334155; color: #94a3b8;">Personal</td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #334155;">${local ? local.employees : '-'}</td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #334155;">${remote ? remote.employees : '-'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #334155; color: #94a3b8;">Asistencias</td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #334155;">${local ? local.attendance : '-'}</td>
                        <td style="padding: 10px 12px; border-bottom: 1px solid #334155;">${remote ? remote.attendance : '-'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 12px; color: #94a3b8;">Última Act.</td>
                        <td style="padding: 10px 12px;">${local ? formatDate(local.lastUpdate) : '-'}</td>
                        <td style="padding: 10px 12px; color: #6366f1;">${remote ? formatDate(remote.lastUpdate) : '-'}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

export function buildUploadConfirmModalHTML(local) {
    return `
                <div class="modal-overlay" data-sync-action="close-overlay">
                    <div class="modal-content" style="max-width: 480px;">
                        <div class="modal-header">
                            <h2 class="modal-title">📤 Subir datos a la nube</h2>
                            <button class="modal-close" type="button" data-sync-action="close-modal" aria-label="Cerrar">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #cbd5e1; margin-bottom: 15px; line-height: 1.6;">
                                Tienes datos guardados en este dispositivo, pero tu cuenta de la nube está vacía.
                            </p>
                            
                            ${getSyncSummaryHTML(local, null)}

                            <p style="color: #cbd5e1; margin-bottom: 20px; line-height: 1.6;">
                                ¿Deseas subirlos ahora para tener una copia de seguridad y sincronizarlos?
                            </p>
                            
                            <div style="display: flex; gap: 10px; margin-top: 20px;">
                                <button type="button" data-sync-action="upload-to-cloud" class="btn-primary" style="flex: 1;">
                                    📤 Sí, subir datos
                                </button>
                                <button type="button" data-sync-action="close-modal" class="btn-secondary" style="flex: 1;">
                                    Ahora no
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
}

export function buildDownloadConfirmModalHTML(remote) {
    return `
                <div class="modal-overlay" data-sync-action="close-overlay">
                    <div class="modal-content" style="max-width: 480px;">
                        <div class="modal-header">
                            <h2 class="modal-title">☁️ Descargar desde la nube</h2>
                            <button class="modal-close" type="button" data-sync-action="close-modal" aria-label="Cerrar">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #cbd5e1; margin-bottom: 15px; line-height: 1.6;">
                                Se han detectado datos previos en tu cuenta en la nube.
                            </p>

                            ${getSyncSummaryHTML(null, remote)}

                            <p style="color: #cbd5e1; margin-bottom: 20px; line-height: 1.6;">
                                ¿Deseas descargarlos para empezar a trabajar con ellos en este dispositivo?
                            </p>
                            
                            <div style="display: flex; gap: 10px; margin-top: 20px;">
                                <button type="button" data-sync-action="download-from-cloud" class="btn-primary" style="flex: 1;">
                                    ☁️ Sí, descargar
                                </button>
                                <button type="button" data-sync-action="close-modal" class="btn-secondary" style="flex: 1;">
                                    Ahora no
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
}

export function buildFullSyncModalHTML(local, remote) {
    return `
                <div class="modal-overlay" data-sync-action="close-overlay">
                    <div class="modal-content" style="max-width: 600px;">
                        <div class="modal-header">
                            <h2 class="modal-title">🔄 Sincronización Inicial</h2>
                            <button class="modal-close" type="button" data-sync-action="close-modal" aria-label="Cerrar">✕</button>
                        </div>
                        <div class="modal-body">
                            <p style="color: #cbd5e1; margin-bottom: 15px; line-height: 1.6;">
                                Tienes datos <strong>locales</strong> y en la <strong>nube</strong>. Por favor, compara y elige la acción a realizar:
                            </p>

                            ${getSyncSummaryHTML(local, remote)}
                            
                            <div style="display: flex; flex-direction: column; gap: 12px;">
                                <button type="button" data-sync-action="upload-to-cloud" class="btn-primary" style="text-align: left; padding: 18px; background: linear-gradient(135deg, #3b82f6, #2563eb);">
                                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                                        <span style="font-size: 1.5rem;">📤</span>
                                        <span style="font-weight: 700; font-size: 1.05rem;">Subir y combinar con la nube</span>
                                    </div>
                                    <div style="font-size: 0.85rem; opacity: 0.9; margin-left: 40px;">
                                        Combina lo de este equipo hacia la nube. No borra nada de la nube.
                                    </div>
                                </button>

                                <button type="button" data-sync-action="download-from-cloud" class="btn-primary" style="text-align: left; padding: 18px; background: linear-gradient(135deg, #06b6d4, #0891b2);">
                                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                                        <span style="font-size: 1.5rem;">☁️</span>
                                        <span style="font-weight: 700; font-size: 1.05rem;">Descargar y combinar</span>
                                    </div>
                                    <div style="font-size: 0.85rem; opacity: 0.9; margin-left: 40px;">
                                        Combina lo de la nube con lo de este equipo. No borra nada local.
                                    </div>
                                </button>
                                
                                <button type="button" data-sync-action="close-modal" class="btn-secondary" style="margin-top: 8px;">
                                    ❌ Cancelar (no hacer nada ahora)
                                </button>
                            </div>
                            
                            <div style="margin-top: 20px; padding: 14px; background: rgba(251,191,36,0.1); border-left: 3px solid #f59e0b; border-radius: 6px; font-size: 0.85rem; color: #fbbf24;">
                                <strong>⚠️ Importante:</strong> Ambas opciones COMBINAN los datos: si el mismo registro existe en los dos lados, gana el que se sincroniza. Para un reemplazo total (borrar un lado y quedarte solo con el otro) usa Ajustes → Datos.
                            </div>
                        </div>
                    </div>
                </div>
            `;
}
