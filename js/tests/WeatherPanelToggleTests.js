/**
 * 🧪 WeatherPanelToggleTests — Caracterización de los toggles del panel del clima,
 * red para migrarlos a batchSetState (Fase 3). Se prueba la dirección de CIERRE
 * (que no dispara refreshWeather → sin fetch en los tests). WeatherUITests cubre
 * el resto del comportamiento del panel.
 */

import { state } from '../modules/core/AppState.js';
import {
    toggleWeatherPanel,
    toggleWeatherExpanded,
    closeWeatherPanel,
} from '../modules/features/weather/WeatherController.js';

function reset() {
    state.weather = { panelOpen: false };
    state.weatherExpanded = false;
}

testRunner.addSuite("WeatherController — Toggles del panel (caracterización)", {

    "toggleWeatherPanel cierra el panel cuando estaba abierto"() {
        reset();
        state.weather.panelOpen = true;
        toggleWeatherPanel();   // toggle → cerrado, no dispara refresh
        testRunner.assertEquals(state.weather.panelOpen, false, "panelOpen debe quedar false");
    },

    "closeWeatherPanel cierra el panel"() {
        reset();
        state.weather.panelOpen = true;
        closeWeatherPanel();
        testRunner.assertEquals(state.weather.panelOpen, false, "panelOpen debe quedar false");
    },

    "toggleWeatherExpanded colapsa la vista cuando estaba expandida"() {
        reset();
        state.weatherExpanded = true;
        toggleWeatherExpanded();   // colapsa → false, no dispara refresh
        testRunner.assertEquals(state.weatherExpanded, false, "weatherExpanded debe quedar false");
    }
});

console.log('🧪 WeatherPanelToggle tests cargados.');
