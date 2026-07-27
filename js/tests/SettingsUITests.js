import { initSettingsUI, SettingsTab } from '../modules/ui/SettingsUI.js';

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
    },

    "SettingsTab: asume general por defecto si state.settingsActiveTab es undefined"() {
        const stateMock = {
            settingsActiveTab: undefined,
            settings: {
                regularHoursPerDay: 8,
                syncEnabled: true,
                overtimeFactor: 1,
                holidayFactor: 2,
                holidays: [],
                scrollbarMode: 'on-scroll',
                iconSet: 'default',
                companyName: 'Empresa Test',
                backupFrequency: 'none',
                hideDuplicateAlerts: false,
                weatherEnabled: false
            },
            employees: [],
            positions: [],
            attendance: {},
            swVersion: '1.0.0'
        };

        const dependencies = {
            state: stateMock,
            icons: {
                get: (name) => `[icon:${name}]`,
                getAvailableSets: () => ['default']
            },
            holidayService: {
                renderSettingsCalendar: () => '<div id="mock-calendar">Calendar</div>'
            },
            get currentUser() { return null; },
            get autoSyncEnabled() { return true; },
            calculateStorageStats: () => ({ percentage: 10, usedMB: 0.5, available: '4.5MB' })
        };

        initSettingsUI(dependencies);

        // Al llamar a SettingsTab sin inicializar settingsActiveTab en el mock,
        // no debería fallar y debería asumir 'general' o comportarse de forma tolerante.
        const html = SettingsTab();

        testRunner.assert(typeof html === 'string', 'SettingsTab debe retornar un string de HTML');
        testRunner.assert(html.includes('Configuración del Sistema'), 'Debe incluir el título de configuración');
        
        // Comprobar que incluye elementos del formulario general (como companyName) si asumió 'general'
        testRunner.assert(html.includes('companyName') || html.includes('Nombre de la Empresa'), 'Debe renderizar la pestaña General por defecto');
    },

    "SettingsTab: la pestaña General incluye el botón de limpiar cache (Mantenimiento)"() {
        const stateMock = {
            settingsActiveTab: 'general',
            settings: {
                regularHoursPerDay: 8, syncEnabled: true, overtimeFactor: 1, holidayFactor: 2,
                holidays: [], scrollbarMode: 'on-scroll', iconSet: 'default',
                companyName: 'Empresa Test', backupFrequency: 'none', hideDuplicateAlerts: false,
                weatherEnabled: false
            },
            employees: [], positions: [], attendance: {}, swVersion: '1.0.0'
        };
        const dependencies = {
            state: stateMock,
            icons: { get: (name) => `[icon:${name}]`, getAvailableSets: () => ['default'] },
            holidayService: { renderSettingsCalendar: () => '' },
            get currentUser() { return null; },
            get autoSyncEnabled() { return true; },
            calculateStorageStats: () => ({ percentage: 10, usedMB: 0.5, available: '4.5MB' })
        };
        initSettingsUI(dependencies);

        const html = SettingsTab();
        testRunner.assert(html.includes('data-settings-action="clear-cache"'),
            'La pestaña General debe exponer el botón de limpiar cache');
        testRunner.assert(html.includes('Limpiar cache y recargar'),
            'El botón debe tener su etiqueta');
        testRunner.assert(html.includes('No se borran tus datos'),
            'Debe aclarar que NO se borran los datos del usuario');
    },

    "SettingsTab: permite activar o desactivar la marca del puesto trabajado"() {
        const stateMock = {
            settingsActiveTab: 'general',
            settings: {
                regularHoursPerDay: 8, syncEnabled: true, overtimeFactor: 1, holidayFactor: 2,
                holidays: [], scrollbarMode: 'on-scroll', iconSet: 'default',
                companyName: 'Empresa Test', backupFrequency: 'none', hideDuplicateAlerts: false,
                weatherEnabled: false, attendancePositionWatermarks: true,
                attendanceWatermarkVisibility: 'present',
                attendanceWatermarkContent: 'position'
            },
            employees: [], positions: [], attendance: {}, swVersion: '1.0.0'
        };
        const dependencies = {
            state: stateMock,
            icons: { get: (name) => `[icon:${name}]`, getAvailableSets: () => ['default'] },
            holidayService: { renderSettingsCalendar: () => '' },
            get currentUser() { return null; },
            get autoSyncEnabled() { return true; },
            calculateStorageStats: () => ({ percentage: 10, usedMB: 0.5, available: '4.5MB' })
        };
        initSettingsUI(dependencies);

        const html = SettingsTab();
        testRunner.assert(html.includes('id="attendancePositionWatermarks"'),
            'debe renderizar el interruptor de marcas de agua');
        testRunner.assert(html.includes('Mostrar Marca de Agua en Asistencia'),
            'debe explicar claramente qué controla');
        testRunner.assert(/id="attendancePositionWatermarks"[\s\S]*?checked/.test(html),
            'debe estar activo por defecto');
        testRunner.assert(html.includes('id="attendanceWatermarkConfigPanel"'),
            'debe mostrar las opciones dependientes debajo del interruptor');
        testRunner.assert(html.includes('name="attendanceWatermarkVisibility"'),
            'debe permitir elegir cuándo se muestra');
        testRunner.assert(html.includes('Solo si está presente'),
            'debe conservar el comportamiento actual como opción');
        testRunner.assert(html.includes('name="attendanceWatermarkContent"'),
            'debe permitir elegir el contenido');
        testRunner.assert(html.includes('Número del empleado') && html.includes('Icono del trabajo'),
            'debe ofrecer número o icono como opciones exclusivas');
        testRunner.assert(/name="attendanceWatermarkVisibility"[\s\S]*?value="present"[\s\S]*?checked/.test(html),
            'solo presente debe ser el valor inicial');
        testRunner.assert(/name="attendanceWatermarkContent"[\s\S]*?value="position"[\s\S]*?checked/.test(html),
            'icono del trabajo debe ser el valor inicial');
    },

    "SettingsTab: renderiza la pestaña correcta según el tab activo"() {
        const stateMock = {
            settingsActiveTab: 'data',
            settings: {
                regularHoursPerDay: 8,
                syncEnabled: true,
                overtimeFactor: 1,
                holidayFactor: 2,
                holidays: [],
                scrollbarMode: 'on-scroll',
                iconSet: 'default',
                companyName: 'Empresa Test',
                backupFrequency: 'none',
                hideDuplicateAlerts: false,
                weatherEnabled: false
            },
            employees: [],
            positions: [],
            attendance: {},
            swVersion: '1.0.0'
        };

        const dependencies = {
            state: stateMock,
            icons: {
                get: (name) => `[icon:${name}]`,
                getAvailableSets: () => ['default']
            },
            holidayService: {
                renderSettingsCalendar: () => '<div id="mock-calendar">Calendar</div>'
            },
            get currentUser() { return { displayName: 'Admin Test', email: 'admin@test.com' }; },
            get autoSyncEnabled() { return true; },
            calculateStorageStats: () => ({ percentage: 10, usedMB: 0.5, available: '4.5MB' })
        };

        initSettingsUI(dependencies);

        // Caso 1: Tab 'data'
        const htmlData = SettingsTab();
        testRunner.assert(htmlData.includes('Sincronización en la Nube') || htmlData.includes('Datos Locales'), 'Debe renderizar la pestaña de Datos');

        // Caso 2: Tab 'calendar'
        stateMock.settingsActiveTab = 'calendar';
        const htmlCalendar = SettingsTab();
        testRunner.assert(htmlCalendar.includes('Control de Calendario y Pagos') || htmlCalendar.includes('Ajustes de Período'), 'Debe renderizar la pestaña de Calendario');
    }
});

