/**
 * 📱 InstallPromptManager.js - Gestor de Instalación PWA
 * Parte de la Fase 6: Infraestructura de Sistema (Alpha Refactorizer)
 * Maneja el evento de instalación y la interfaz de banner para móviles.
 */

export class InstallPromptManager {
    constructor(eventBus, notificationSystem, debugSystem, renderCallback) {
        this.eventBus = eventBus;
        this.Notification = notificationSystem;
        this.debug = debugSystem;
        this.render = renderCallback;
        
        this.deferredPrompt = null;
        this.isInstalled = false;
        
        this.setupListeners();
    }

    /**
     * Configurar escuchadores globales de PWA
     */
    setupListeners() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.debug.log('📱 Install prompt disponible');
            this.eventBus.emit('install:available');
            this.render(); // Actualizar UI para mostrar banner si aplica
        });

        window.addEventListener('appinstalled', () => {
            this.isInstalled = true;
            this.deferredPrompt = null;
            this.debug.log('✅ App instalada');
            this.Notification.success('✅ App instalada correctamente');
            this.eventBus.emit('install:completed');
            this.render();
        });
    }

    /**
     * Verificar si la instalación es posible actualmente
     */
    canInstall() {
        return this.deferredPrompt !== null;
    }

    /**
     * Lanzar el diálogo de instalación nativo
     */
    async install() {
        if (!this.deferredPrompt) {
            this.Notification.warning('⚠️ Instalación no disponible actualmente');
            return false;
        }

        try {
            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;

            if (outcome === 'accepted') {
                this.debug.log('✅ Usuario aceptó instalación');
                return true;
            } else {
                this.debug.log('❌ Usuario rechazó instalación');
                this.Notification.info('ℹ️ Instalación cancelada');
                return false;
            }
        } catch (error) {
            this.debug.error('❌ Error en instalación:', error);
            this.Notification.error('❌ Error al procesar instalación');
            return false;
        } finally {
            this.deferredPrompt = null;
            this.render();
        }
    }

    /**
     * Generar componente visual del banner de instalación
     */
    renderInstallBanner() {
        if (!this.canInstall()) return '';

        return `
            <div class="install-banner" style="
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, #06b6d4, #0891b2);
                color: white;
                padding: 16px 24px;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                gap: 16px;
                z-index: 9999;
                animation: slideUp 0.3s ease-out;">
                <div style="font-size: 2rem;">📱</div>
                <div style="flex: 1;">
                    <div style="font-weight: 700; margin-bottom: 2px; font-size: 1rem;">
                        Instalar Aplicación
                    </div>
                    <div style="font-size: 0.8rem; opacity: 0.9;">
                        Acceso rápido desde tu pantalla de inicio
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button id="pwa-install-btn" 
                            style="background: white; color: #0891b2; border: none; 
                                   padding: 8px 16px; border-radius: 8px; font-weight: 700;
                                   cursor: pointer; font-size: 0.85rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        Instalar
                    </button>
                    <button id="pwa-close-btn" 
                            style="background: rgba(255,255,255,0.2); color: white; border: none;
                                   padding: 4px; border-radius: 50%; cursor: pointer;
                                   width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
                        ✕
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Ocultar el banner temporalmente
     */
    dismissBanner() {
        this.deferredPrompt = null;
        this.render();
    }
}
