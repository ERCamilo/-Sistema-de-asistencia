/**
 * 🔔 NotificationPreviewGallery.js — Galería interactiva de previsualización de notificaciones.
 * Permite probar visualmente los diferentes tipos de toasts, botones de acción,
 * animaciones de carga y apilamiento directamente desde la pestaña de Pruebas.
 */

import { Notification } from '../components/Notification.js';

export function openSafeNotificationPreview(kind, deps = {}) {
    const notify = deps.notification || Notification;

    if (kind === 'success') {
        notify.success('✅ Estado general sincronizado con la nube');
        return true;
    }

    if (kind === 'warning-retry') {
        let toast;
        toast = notify.warning('Icono de "Johan" actualizado · solo en este equipo (aún no en la nube)', {
            duration: 8000,
            actions: [{
                label: 'Reintentar',
                icon: 'sync',
                closeOnClick: false,
                onClick: () => {
                    if (toast?.element) {
                        const btn = toast.element.querySelector('.notification-action');
                        if (btn) {
                            btn.classList.add('is-loading');
                            btn.disabled = true;
                            const label = btn.querySelector('.notification-action-label');
                            if (label) label.textContent = 'Reintentando...';
                        }
                    }
                    setTimeout(() => {
                        toast?.update({
                            type: 'success',
                            message: '✅ Conexión recuperada y guardado en la nube',
                            actions: []
                        });
                    }, 1200);
                }
            }]
        });
        return true;
    }

    if (kind === 'error') {
        notify.error('❌ Error al sincronizar con Firebase: sin conexión a internet', {
            duration: 8000,
            actions: [{
                label: 'Ver diagnóstico',
                icon: 'alert',
                onClick: () => {
                    notify.info('ℹ️ Diagnóstico: Estado sin conexión (offline mode)');
                }
            }]
        });
        return true;
    }

    if (kind === 'info') {
        notify.info('ℹ️ Modo fuera de línea activado. Tus cambios se guardan localmente.');
        return true;
    }

    if (kind === 'loading') {
        const loader = notify.loading('Subiendo historial completo a Firebase...');
        setTimeout(() => {
            loader.update({
                type: 'success',
                message: '✅ Historial de asistencia sincronizado con éxito',
                duration: 4000
            });
        }, 1800);
        return true;
    }

    if (kind === 'update') {
        new notify({
            variant: 'update',
            position: 'top-center',
            type: 'info',
            duration: 10000,
            updateInfo: {
                version: '2026.08.17.2',
                currentVersion: '2026.08.15.1',
                summary: 'Optimizaciones en sincronización y feedback de notificaciones.',
                details: [
                    'Cadencia configurable del mirror en Ajustes',
                    'Feedback interactivo en botón Reintentar',
                    'Galería de previsualización de notificaciones'
                ]
            }
        }).show();
        return true;
    }

    if (kind === 'stack') {
        notify.clearAll();
        notify.info('1. Iniciando verificación de integridad de datos...', 6000);
        setTimeout(() => {
            notify.warning('2. 3 asistencias pendientes de sincronizar con la nube', { duration: 6000 });
        }, 300);
        setTimeout(() => {
            notify.success('3. ✅ 42 registros cargados correctamente', 6000);
        }, 600);
        return true;
    }

    return false;
}

export default { openSafeNotificationPreview };
