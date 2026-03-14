import { icons } from '../ui/IconSystem.js';
import { Notification } from '../components/Notification.js';

export class StorageService {
    constructor(storageKey = 'asistencia-data') {
        this.storageKey = storageKey;
        this.isAvailable = this.checkAvailability();
    }

    // Verificar si localStorage está disponible
    checkAvailability() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            console.warn('localStorage no disponible:', e);
            return false;
        }
    }

    // Guardar datos completos
    save(data) {
        console.log('🟡 StorageService.save() iniciado');

        if (!this.isAvailable) {
            console.error(`${icons.get('info')} LocalStorage NO disponible`);
            if (window.debug) window.debug.warn(`${icons.get('info')} LocalStorage no disponible - datos no guardados`);
            return false;
        }

        console.log('💡 LocalStorage disponible');

        try {
            const serialized = JSON.stringify(data);
            console.log('📦 Datos serializados:', serialized.length, 'bytes');

            localStorage.setItem(this.storageKey, serialized);
            console.log('💡 \ localStorage.setItem() ejecutado exitosamente');
            console.log('💡 Key:', this.storageKey);

            // Verificar que se guardó
            const verification = localStorage.getItem(this.storageKey);
            if (verification) {
                console.log('💡 Verificación: Datos encontrados en localStorage');
                console.log('💡 Tamaño verificado:', verification.length, 'bytes');
            } else {
                console.error(`${icons.get('info')} Verificación falló: No se encontraron datos`);
            }

            if (window.debug) window.debug.log(`${icons.get('info')} Datos guardados en localStorage`);
            return true;
        } catch (e) {
            console.error(`${icons.get('info')} Error al guardar en localStorage:`, e);
            console.error(`${icons.get('info')} Tipo de error:`, e.name);
            console.error(`${icons.get('info')} Mensaje:`, e.message);
            if (window.debug) window.debug.error(`${icons.get('info')} Error al guardar en localStorage:`, e);
            Notification.error('Error al guardar datos', 5000);
            return false;
        }
    }

    // Cargar datos
    load() {
        if (!this.isAvailable) {
            if (window.debug) window.debug.warn(`${icons.get('info')} LocalStorage no disponible`);
            return null;
        }

        try {
            const serialized = localStorage.getItem(this.storageKey);
            if (!serialized) return null;

            const data = JSON.parse(serialized);
            if (window.debug) window.debug.log(`${icons.get('info')} Datos cargados desde localStorage`);
            return data;
        } catch (e) {
            if (window.debug) window.debug.error(`${icons.get('info')} Error al cargar desde localStorage:`, e);
            return null;
        }
    }

    // Limpiar datos
    clear() {
        if (!this.isAvailable) return false;

        try {
            localStorage.removeItem(this.storageKey);
            if (window.debug) window.debug.log(`${icons.get('info')} Datos eliminados de localStorage`);
            return true;
        } catch (e) {
            if (window.debug) window.debug.error(`${icons.get('info')} Error al eliminar de localStorage:`, e);
            return false;
        }
    }

    // Exportar a JSON
    export() {
        const data = this.load();
        if (!data) return null;

        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
        });
        return URL.createObjectURL(blob);
    }

    // Importar desde JSON
    import(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    this.save(data);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    // Obtener tamaño de datos
    getSize() {
        if (!this.isAvailable) return 0;

        const data = localStorage.getItem(this.storageKey);
        return data ? new Blob([data]).size : 0;
    }

    // Formatear tamaño
    getFormattedSize() {
        const bytes = this.getSize();
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}
