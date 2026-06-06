const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('c:\\Users\\the_b\\OneDrive - Universidad Autonoma de Santo Domingo\\Educacion\\Independiente\\control de asistencia mini\\aplicacionFull\\node_modules\\puppeteer-core');

const PORT = 5502;
const PUBLIC_DIR = 'c:\\Users\\the_b\\OneDrive - Universidad Autonoma de Santo Domingo\\Educacion\\Independiente\\control de asistencia mini\\aplicacionFull';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Asegurar que el directorio de capturas existe
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR);
}

// 1. Servidor Estático Minimalista y Resiliente
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url.split('?')[0]);
  if (filePath === PUBLIC_DIR || filePath.endsWith('\\') || filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  // Sanitizar path para evitar Directory Traversal fuera del PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Access Denied');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end(`File not found: ${req.url}`);
      } else {
        res.statusCode = 500;
        res.end(`Server error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Función de espera (delay)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Ejecución de capturas
server.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true, // headless para que corra en segundo plano
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // --- FLUJO 1: ONBOARDING MOBILE (Pestaña Dedicada) ---
    console.log('Auditing Onboarding Mobile (Dedicated Tab)...');
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await mobilePage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });
    await delay(2000); // Dar tiempo al loader
    await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding_welcome_mobile.png') });

    // Avanzar a Selección de Modo en Mobile
    await mobilePage.click('[data-onb-action="next"]');
    await delay(1000);
    await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding_mode_selection_mobile.png') });
    await mobilePage.close(); // Cerrar pestaña móvil para no interferir

    // --- FLUJO 2: FLUX COMPLET DESKTOP ---
    console.log('Auditing Desktop (Onboarding -> Dashboard -> Features)...');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });
    await delay(2000); // Dar tiempo al loader
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding_welcome_desktop.png') });

    // Avanzar a Selección de Modo
    await page.click('[data-onb-action="next"]');
    await delay(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding_mode_selection_desktop.png') });

    // Seleccionar Modo Demo
    console.log('Selecting Demo Mode...');
    await page.click('[data-onb-action="select-mode"][data-value="demo"]');
    await delay(5000); // Esperar a que se procesen los datos demo en IndexedDB

    // Capturar Done
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'onboarding_done_desktop.png') });

    // Completar Onboarding
    console.log('Completing Onboarding and entering Dashboard...');
    await page.click('[data-onb-action="complete"]');
    await delay(3000); // Esperar renderización de la app

    // Capturar Dashboard Vista Diaria
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_day_desktop.png') });

    // Ir a Vista Semanal
    console.log('Switching to Week View...');
    await page.evaluate(() => {
      if (typeof window.changeViewMode === 'function') {
        window.changeViewMode('week');
      } else {
        // Fallback si no está expuesto directamente
        state.viewMode = 'week';
        window.render();
      }
    });
    await delay(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_week_desktop.png') });

    // Abrir Perfil Empleado
    console.log('Opening Employee Profile...');
    const empId = await page.evaluate(() => {
      return state.employees && state.employees.length > 0 ? state.employees[0].id : null;
    });

    if (empId) {
      console.log(`Calling openEmployeeProfile for empId: ${empId}`);
      await page.evaluate((id) => {
        if (typeof window.openEmployeeProfile === 'function') {
          window.openEmployeeProfile(id);
        } else {
          state.employeeProfile = { id };
          state.modalType = 'employee-profile';
          state.showModal = true;
          window.render();
        }
      }, empId);
      await delay(2000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'employee_profile_desktop.png') });

      // Cerrar Perfil
      console.log('Closing Employee Profile...');
      await page.evaluate(() => {
        if (typeof window.closeEmployeeProfile === 'function') {
          window.closeEmployeeProfile();
        } else {
          state.employeeProfile = null;
          window.render();
        }
      });
      await delay(1000);
    }

    // Abrir Ajustes (Settings)
    console.log('Opening Settings...');
    await page.evaluate(() => {
      if (typeof window.changeTab === 'function') {
        window.changeTab('settings');
      } else {
        state.activeTab = 'settings';
        window.render();
      }
    });
    await delay(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings_general_desktop.png') });

    // Ir a Calendario en Ajustes
    console.log('Switching to Settings -> Calendario...');
    await page.evaluate(() => {
      if (typeof window.changeSettingsTab === 'function') {
        window.changeSettingsTab('calendar');
      } else {
        state.settingsActiveTab = 'calendar';
        window.render();
      }
    });
    await delay(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings_calendar_desktop.png') });

    // Ir a Datos/Sincronización en Ajustes
    console.log('Switching to Settings -> Datos/Sync...');
    await page.evaluate(() => {
      if (typeof window.changeSettingsTab === 'function') {
        window.changeSettingsTab('data');
      } else {
        state.settingsActiveTab = 'data';
        window.render();
      }
    });
    await delay(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings_data_desktop.png') });

    // --- FLUJO 3: VISTAS MOBILE CON DATOS DEMO (Pestaña Dedicada) ---
    console.log('Auditing Mobile Views with Demo Data (Dedicated Tab)...');
    const mobileDashboardPage = await browser.newPage();
    await mobileDashboardPage.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    // Navegar de nuevo. Como ya se completó el onboarding en esta sesión de browser, debe ir directo al dashboard.
    await mobileDashboardPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });
    await delay(3000); // Dar tiempo a que cargue e inicialice el dashboard en mobile

    // Capturar Dashboard Vista Diaria (Mobile)
    await mobileDashboardPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_day_mobile.png') });

    // Ir a Vista Semanal (Mobile)
    console.log('Switching to Week View (Mobile)...');
    await mobileDashboardPage.evaluate(() => {
      if (typeof window.changeViewMode === 'function') {
        window.changeViewMode('week');
      } else {
        state.viewMode = 'week';
        window.render();
      }
    });
    await delay(2000);
    await mobileDashboardPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_week_mobile.png') });

    // Capturar Vista Semanal en Landscape Móvil
    console.log('Switching to Week View Landscape (Mobile)...');
    await mobileDashboardPage.setViewport({ width: 812, height: 375, isMobile: true, hasTouch: true, isLandscape: true });
    await delay(2000);
    await mobileDashboardPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_week_mobile_landscape.png') });

    // Restaurar viewport portrait
    await mobileDashboardPage.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await delay(1000);

    // Abrir Perfil Empleado (Mobile)
    if (empId) {
      console.log(`Opening Employee Profile (Mobile) for empId: ${empId}...`);
      await mobileDashboardPage.evaluate((id) => {
        if (typeof window.openEmployeeProfile === 'function') {
          window.openEmployeeProfile(id);
        } else {
          state.employeeProfile = { id };
          window.render();
        }
      }, empId);
      await delay(2000);
      await mobileDashboardPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'employee_profile_mobile.png') });

      // Cerrar Perfil (Mobile)
      console.log('Closing Employee Profile (Mobile)...');
      await mobileDashboardPage.evaluate(() => {
        if (typeof window.closeEmployeeProfile === 'function') {
          window.closeEmployeeProfile();
        } else {
          state.employeeProfile = null;
          window.render();
        }
      });
      await delay(1000);
    }

    // Abrir Ajustes (Mobile)
    console.log('Opening Settings (Mobile)...');
    await mobileDashboardPage.evaluate(() => {
      if (typeof window.changeTab === 'function') {
        window.changeTab('settings');
      } else {
        state.activeTab = 'settings';
        window.render();
      }
    });
    await delay(2000);
    await mobileDashboardPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings_general_mobile.png') });

    await mobileDashboardPage.close();
    await page.close();
    console.log('Screenshots capture complete!');

  } catch (error) {
    console.error('Error during screenshot capture:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
    server.close(() => {
      console.log('Server stopped. Exiting process.');
    });
  }
});
