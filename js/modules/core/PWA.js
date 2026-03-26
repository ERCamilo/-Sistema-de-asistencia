/**
 * 📱 GESTIÓN DE PWA E INSTALACIÓN
 * Este módulo maneja los prompts de instalación y el estado de la PWA.
 */

import { state } from './AppState.js';
import { Notification } from '../components/Notification.js';

export class InstallPromptManager {
    constructor() {
        this.deferredPrompt = null;
        this.isInstalled = false;
        this.setupListeners();
    }

    setupListeners() {
        // Capturar evento de instalación
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            console.log('📱 Install prompt disponible');
            if (window.eventBus) window.eventBus.emit('install:available');
        });

        // Detectar cuando se instala
        window.addEventListener('appinstalled', () => {
            this.isInstalled = true;
            this.deferredPrompt = null;
            console.log('✅ App instalada');
            Notification.success('✅ App instalada correctamente');
            if (window.eventBus) window.eventBus.emit('install:completed');
        });
    }

    canInstall() {
        return this.deferredPrompt !== null;
    }

    async install() {
        if (!this.deferredPrompt) {
            Notification.warning('⚠️ La app ya está instalada o no está disponible para instalación');
            return false;
        }

        try {
            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;

            if (outcome === 'accepted') {
                console.log('✅ Usuario aceptó instalación');
                return true;
            } else {
                console.log('❌ Usuario rechazó instalación');
                return false;
            }
        } catch (error) {
            console.error('❌ Error en instalación:', error);
            return false;
        } finally {
            this.deferredPrompt = null;
        }
    }

    dismissBanner() {
        this.deferredPrompt = null;
        if (window.render) window.render();
    }

    /**
     * 📂 MANEJO DE ARCHIVOS (API launchQueue)
     * Permite que la app abra archivos .json (backups) directamente.
     */
    initFileHandling() {
        if ('launchQueue' in window) {
            console.log('📬 Launch Queue detectado. Esperando archivos...');
            window.launchQueue.setConsumer(async (launchParams) => {
                if (launchParams.files && launchParams.files.length > 0) {
                    console.log('📂 Archivo recibido vía PWA Launch Handler');
                    for (const fileHandle of launchParams.files) {
                        const file = await fileHandle.getFile();
                        if (file.name.toLowerCase().endsWith('.json')) {
                            // Pequeño delay para asegurar que el sistema está listo
                            setTimeout(() => {
                                if (window.loadBackupFromFile) {
                                    window.loadBackupFromFile(file);
                                }
                            }, 1000);
                            break; 
                        }
                    }
                }
            });
        }
    }
}

export const installPrompt = new InstallPromptManager();
// Auto-inicializar manejo de archivos
installPrompt.initFileHandling();
