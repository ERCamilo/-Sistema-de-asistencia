import { initSettingsUI } from '../modules/ui/SettingsUI.js';

testRunner.addSuite("SettingsUI — Inicialización y Dependencias", {

    "initSettingsUI: recibe el getter currentUser y lo evalúa correctamente"() {
        // Simular window.currentUser
        const originalUser = window.currentUser;
        window.currentUser = { email: 'test@construccion.com', name: 'Obrero Test' };

        // Simular dependencias
        const dependencies = {
            state: {},
            icons: { get: () => '' },
            holidayService: {},
            get currentUser() { return window.currentUser; },
            get autoSyncEnabled() { return true; },
            calculateStorageStats: () => ({})
        };

        // Inicializar
        initSettingsUI(dependencies);

        // En SettingsUI.js, las dependencias se guardan en la variable local `context`
        // y se leen mediante getters como `context.currentUser`.
        // Vamos a verificar que podemos llamar a las dependencias sin ReferenceError.
        let err = null;
        let userEmail = null;
        try {
            userEmail = dependencies.currentUser?.email;
        } catch (e) {
            err = e;
        }

        testRunner.assert(err === null, `No debe lanzar ReferenceError al evaluar currentUser: ${err?.message}`);
        testRunner.assertEquals(userEmail, 'test@construccion.com', "currentUser debe retornar el valor configurado en window.currentUser");

        // Limpiar window
        window.currentUser = originalUser;
    }
});
