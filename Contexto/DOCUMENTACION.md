# 📋 Control de Asistencia - Documentación Completa

> **Última actualización:** 12 de febrero de 2026  
> **Ubicación:** `control de asistencia mini/aplicacionFull/index.html`
> **Versión del Código:** 6.5 (Hybrid Codebase)

---

## 🎯 Propósito de la Aplicación

Sistema de **control de asistencia para trabajadores de construcción** con las siguientes características principales:

- ✅ Registro de asistencia diaria de empleados
- ✅ Gestión de múltiples posiciones/cargos por empleado
- ✅ Cálculo automático de horas trabajadas, extras y festivos
- ✅ Generación de reportes y nóminas
- ✅ Funcionamiento offline (PWA)
- ✅ Sincronización opcional con Supabase

---

## 🏗️ Arquitectura General

### Tipo de Aplicación
- **Single-File Application (SPA)**: Todo el código está en `index.html` (~921KB, 20,000+ líneas)
- **PWA (Progressive Web App)**: Funciona offline con `manifest.json` y Service Worker
- **Hybrid Architecture**: Mezcla de Clases ES6 (UI compleja) y Funciones Globales (Lógica core)

### Estructura del Archivo
```
index.html
├── <head>
│   ├── Meta tags (PWA, viewport, theme-color)
│   ├── CDN imports (Chart.js, ExcelJS, jsPDF, html2canvas, Supabase)
│   └── <style> (1,700+ líneas de CSS)
│
└── <body>
    ├── <div id="root"> (punto de montaje)
    └── <script> (16,500+ líneas de JavaScript)
```

---

## 🎨 Estilo Visual

### Paleta de Colores
| Color | Hex | Uso |
|-------|-----|-----|
| **Cyan principal** | `#06b6d4` | Acentos, botones primarios, links |
| **Verde éxito** | `#10b981` | Asistencia regular, notificaciones éxito |
| **Dorado festivo** | `#f59e0b` | Días festivos, advertencias |
| **Púrpura multi-posición** | `#8b5cf6` | Indica múltiples posiciones |
| **Rojo peligro** | `#ef4444` | Errores, eliminación, horas bajo mínimo |
| **Fondo oscuro** | `#000000` | Body background |
| **Fondo tarjetas** | `#0f172a` | Contenedores principales |
| **Fondo elementos** | `#1e293b` | Inputs, botones secundarios |
| **Borde default** | `#334155` | Bordes de elementos |
| **Texto principal** | `#f1f5f9` | Texto claro |
| **Texto secundario** | `#94a3b8` | Labels, meta info |
| **Texto terciario** | `#64748b` | Texto muy sutil |

### Tipografía
- **Fuente principal:** Inter (Google Fonts)
- **Pesos usados:** 300, 400, 500, 600, 700, 800, 900

### Diseño Responsivo
```css
/* Mobile first - breakpoints */
@media (max-width: 375px) { /* Pantallas muy pequeñas */ }
@media (max-width: 640px) { /* Mobile */ }
@media (max-width: 768px) { /* Tablet */ }
@media (min-width: 768px) { /* Desktop */ }
```

---

## 🧩 Modelo de Datos

### Employee (Empleado)
```javascript
{
    id: "EMP1234567890",        // ID único
    key: "EMP1234567890",       // Compatibilidad legacy
    number: "001",              // Número de empleado
    name: "Juan Pérez",         // Nombre completo
    positions: ["POS1", "POS2"], // Array de IDs de posiciones
    customSalary: null,         // Salario personalizado (opcional)
    active: true,               // Estado activo/inactivo
    hireDate: "2024-01-15",     // Fecha de contratación
    phone: "809-555-1234",      // Teléfono (opcional)
    email: "juan@email.com",    // Email (opcional)
    notes: "",                  // Notas adicionales
    customWorkingDays: {},      // Días laborables personalizados por posición
    createdDate: "ISO string",
    lastStatusChange: "ISO string",
    statusHistory: []           // Historial de cambios de estado
}
```

### Position (Posición/Cargo)
```javascript
{
    id: "POS1234567890",
    name: "Albañil",
    color: "#10b981",           // Color identificador
    active: true,
    salaryConfig: {
        amount: 1500,           // Monto del salario
        period: "day",          // 'day' | 'week' | 'month'
        workDays: [1,2,3,4,5]   // Días laborables (1=Lun, 5=Vie)
    },
    baseSalary: 1500,           // Compatibilidad legacy
    workingDays: [1,2,3,4,5],
    statusHistory: []
}
```

### Leader (Líder/Encargado)
```javascript
{
    id: "LEAD1234567890",
    number: "L001",
    name: "Supervisor Juan",
    active: true,
    phone: "",
    email: "",
    notes: "",
    createdDate: "ISO string",
    statusHistory: []
}
```

### Attendance (Asistencia)
```javascript
{
    employeeId: "EMP123",
    date: "2024-01-15",         // Formato YYYY-MM-DD
    present: true,
    hoursWorked: 8,             // Horas normales
    overtimeHours: 2,           // Horas extras
    isHoliday: false,
    selectedPosition: "POS1",   // ID de posición principal
    multiPosition: false,       // Si trabaja múltiples posiciones ese día
    positionHours: [            // Detalle por posición (si multiPosition)
        { positionId: "POS1", hours: 4, overtimeHours: 0 },
        { positionId: "POS2", hours: 4, overtimeHours: 2 }
    ],
    notes: ""
}
```

### Key de Asistencia
La clave única para cada registro de asistencia es: `${employeeId}-${date}`  
Ejemplo: `EMP1234567890-2024-01-15`

---

## 📦 Clases Principales

### 1. Clases de UI
| Clase | Propósito |
|-------|-----------|
| `Notification` | Sistema de notificaciones toast (Static Methods) |
| `Modal` | Sistema de modales/diálogos (Instanciable) |
| `OnboardingWizard` | **[NUEVO]** Asistente de configuración inicial |
| `UndoManager` | Permite deshacer última acción |
| `ComponentBase` | Clase base para componentes UI |
| `TabComponent` | Pestañas de navegación |
| `TableComponent` | Tablas reutilizables |
| `FormComponent` | Formularios genéricos |
| `CalendarPickerComponent` | Selector de fechas |
| `StatCardComponent` | Tarjetas de estadísticas |
| `SearchComponent` | Barra de búsqueda |
| `BadgeComponent` | Etiquetas/badges |
| `TooltipComponent` | Tooltips |

### 2. Clases de Datos
| Clase | Propósito |
|-------|-----------|
| `Employee` | Estructura de Datos (Objeto Literal, no Clase) |
| `Position` | Estructura de Datos (Objeto Literal, no Clase) |
| `Leader` | Estructura de Datos (Objeto Literal, no Clase) |
| `Attendance` | Estructura de Datos (Objeto Literal, no Clase) |

### 3. Clases de Servicios
| Clase | Propósito |
|-------|-----------|
| `StorageService` | Persistencia en localStorage |
| `AttendanceService` | Lógica de negocio de asistencia |
| `DataService` | Orquestación de datos |
| `ValidationService` | Validaciones de formularios |
| `CacheService` | Caché con TTL y memoización |
| `RenderOptimizer` | Optimización de renders |
| `StateManager` | Gestión centralizada de estado |

### 4. Clases de Fechas
| Clase | Propósito |
|-------|-----------|
| `DateRangeManager` | Base para rangos de fechas |
| `DashboardDateManager` | Fechas del dashboard |
| `EmployeeReportDateManager` | Fechas del reporte |
| `ModalManager` | Control de modales avanzados |

---

## 🗂️ Estado Global (state)

El objeto `state` contiene toda la información de la aplicación:

```javascript
const state = {
    // Navegación
    activeTab: 'attendance',      // Tab activa: 'attendance' | 'employees' | 'reports' | 'settings'
    viewMode: 'day',              // Vista: 'day' | 'week' | 'month'
    
    // Fechas (formato YYYY-MM-DD)
    today: "2024-01-15",          // Fecha de hoy (fija)
    selectedDate: "2024-01-15",   // Fecha seleccionada (cambia)
    
    // Datos
    employees: [],                // Array de Employee
    positions: [],                // Array de Position
    leaders: [],                  // Array de Leader
    attendance: {},               // { "EMP-DATE": AttendanceRecord }
    
    // Configuración global
    settings: {
        companyName: 'Control de Asistencia',
        regularHoursPerDay: 8,
        overtimeFactor: 1.5,      // Multiplicador horas extras
        holidayFactor: 2,         // Multiplicador festivos
        defaultDeductionPercentage: 2,
        globalPaymentDay: null,   // Día del mes para pagos
        holidays: []              // Array de fechas festivas
    },
    
    // Filtros
    filters: {
        position: 'all',
        search: ''
    },

    // Onboarding (NUEVO V6.5)
    showOnboarding: false,        // Si se debe mostrar el wizard
    onboardingStep: 0,            // Paso actual del wizard
    onboardingMode: null,         // 'demo' | 'scratch'
    usingDemoData: false,         // Flag para saber si se usan datos demo
    
    // Más propiedades de UI...
};
```

---

## 💾 Persistencia de Datos

### localStorage
- **Clave:** `asistencia-data`
- **Formato:** JSON serializado

### Estructura guardada
```javascript
{
    employees: [...],
    positions: [...],
    leaders: [...],
    attendance: {...},
    settings: {...},
    today: "YYYY-MM-DD",
    selectedDate: "YYYY-MM-DD",
    dayHoursConfig: {...},
    quickWeekHours: 8,
    version: "2.0",
    savedAt: "ISO string"
}
```

### Funciones clave
```javascript
saveToLocalStorage()   // Guardar estado
loadFromLocalStorage() // Cargar estado
```

---

## ☁️ Integración con Supabase

### Configuración
```javascript
const SUPABASE_URL = 'https://whmkrkxphqmczsklvxpk.supabase.co';
const SUPABASE_ANON_KEY = '...';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### Variables de control
```javascript
let useSupabase = false;      // false = localStorage (default)
let currentUser = null;       // Usuario autenticado
let isSyncing = false;        // Evita sincronizaciones simultáneas
let autoSyncEnabled = false;  // Auto-sync desactivado por defecto
```

---

## 🔧 Funciones Utilitarias Importantes

### Fechas
```javascript
// Convertir Date a string YYYY-MM-DD
getDateKey(date) → "2024-01-15"

// Convertir string YYYY-MM-DD a Date
parseDate("2024-01-15") → Date object

// Formatear para mostrar
formatDate(date) → "lunes, 15 de enero de 2024"
formatDateShort(date) → "Lun, 15 ene 2024"
formatMonthYear(date) → "Enero 2024"

// Verificar si es festivo
isDayHoliday(date) → boolean
```

### Moneda
```javascript
formatCurrency(1500) → "$1,500.00"
```

### Utilidades
```javascript
// Debounce para búsquedas
window.debounce(func, wait = 300)

// Generar UUID válido
generateUUID() → "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
```

---

## 🖥️ Tabs/Pestañas de la Aplicación

1. **📋 Asistencia** (`attendance`)
   - Vista diaria, semanal o mensual
   - Marcar asistencia con checkbox grande
   - Vistas: día, semana, mes

2. **👷 Empleados** (`employees`)
   - Gestión de empleados, líderes y posiciones
   - Sub-vistas: employees, leaders, positions

3. **📊 Reportes** (`reports`)
   - Dashboard con gráficos
   - Reporte por empleado
   - Exportación de nómina

4. **⚙️ Configuración** (`settings`)
   - Nombre de empresa
   - Configuración de horas
   - Días festivos
   - Integración Supabase
   - Importar/Exportar datos

---

## ✅ Ventajas

1. **Single-file deploy** - Solo necesita `index.html`
2. **Funciona offline** - PWA con localStorage
3. **Arquitectura OOP** - Código organizado en clases
4. **Responsive design** - Funciona en móvil y desktop
5. **Sistema de undo** - Permite deshacer acciones
6. **Multi-posición** - Empleado puede tener varios cargos
7. **Cálculo automático** - Horas, extras, festivos, nómina
8. **Exportación** - JSON, Excel, PDF

---

## ⚠️ Desventajas y Áreas de Mejora

1. **Archivo monolítico** - 18,000+ líneas dificultan mantenimiento
2. **Sin bundler** - No usa Webpack/Vite, todo inline
3. **CDN dependencies** - Dependencias externas (Chart.js, etc.)
4. **Sin TypeScript** - Todo es JavaScript puro
5. **Re-render completo** - Cada cambio hace `render()` global
6. **localStorage límites** - ~5MB máximo de datos
7. **Sin tests unitarios** - No hay suite de pruebas

---

## 🎯 Tips para IA/Desarrollador

### Cómo ubicar código rápidamente
```javascript
// Buscar por comentarios de sección:
// ============================================
// 🏗️ SISTEMA POO - CLASES Y OBJETOS REUTILIZABLES
// ============================================
```

### Patrón de render
```javascript
function render() {
    const root = document.getElementById('root');
    root.innerHTML = App();
    // Restaurar scroll, inicializar componentes...
}
```

### Para agregar nueva funcionalidad
1. Crear clase en la sección apropiada
2. Agregar al `state` si necesita persistencia
3. Modificar `saveToLocalStorage()` y `loadFromLocalStorage()` si aplica
4. Agregar UI en la función correspondiente (`App()`, tabs, modales)
5. Llamar `render()` después de cambios

### Para debugging
```javascript
DEBUG_MODE = true;  // Activar console.logs (línea 1712)
```

### Guardar después de cambios
```javascript
saveToLocalStorage();  // Siempre llamar después de modificar state
render();              // Re-renderizar UI
```

---

## 📁 Archivos Relacionados

| Archivo | Propósito |
|---------|-----------|
| `index.html` | Aplicación principal (~921KB) |
| `manifest.json` | Configuración PWA (referenciado pero no incluido) |
| `icon-192.png` | Ícono de la app (referenciado) |
| `backup-*.json` | Backups de datos exportados |

---

## 🔄 Flujo de Datos Típico

```
Usuario marca asistencia → toggleAttendance() → Actualiza state.attendance → saveToLocalStorage() → render() → UI actualizada
```

---

## 📝 Notas para Continuidad

- La versión actual es **6.5** (ver logs de consola al inicio)
- El estado de fecha usa **strings YYYY-MM-DD**, no objetos Date
- Los IDs usan formato: `UUID v4` (generado por `generateUUID()`) compatible con Supabase
- El `OnboardingWizard` maneja la configuración inicial o modo demo
- El `UndoManager` solo mantiene 1 acción pendiente a la vez

---

*Documento generado para facilitar el desarrollo y mantenimiento futuro de la aplicación.*
