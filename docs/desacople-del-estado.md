# Cómo limpiamos el "corazón" de la app — explicado simple

> Para quien no es técnico o está aprendiendo. Cuenta **qué problema tenía la app, qué arreglamos hasta ahora y qué falta**, sin jerga. Al final hay un glosario.

## En una frase

La app tenía un **único objeto gigante** del que colgaba *todo* (asistencia, nómina, préstamos, clima…). Tocar una cosa hacía que la app **repintara la pantalla entera** y arrastraba riesgos por todos lados. Estamos separando ese nudo en partes ordenadas, **sin romper nada** y dejando alarmas que avisan si algo se rompe.

---

## La analogía 🏗️

Imaginá la obra de una constructora (que es justo lo que gestiona esta app):

- **Antes:** había **un solo tablero central** donde estaban enchufados todos los cables — el de asistencia, el de pagos, el de préstamos. Si un albañil movía un cable, **se apagaban y prendían las luces de toda la obra**. Y nadie tenía un plano de qué cable hacía qué.
- **Lo que hacemos:** vamos separando los cables por sector, ponemos **interruptores propios** en cada área, y dejamos un **plano** (los tests) para que el próximo que llegue entienda todo. Si alguien conecta mal un cable, **suena una alarma** antes de que apague la obra.

---

## El problema que encontramos

| Síntoma | Qué significaba en simple |
|---|---|
| **Todo conectado a un solo objeto** | Cualquier cambio podía afectar a cualquier parte, sin avisar |
| **Repintado total de pantalla** | Cada acción del usuario hacía trabajar al navegador de más → la app se siente lenta |
| **Lógica escondida** | Una "caja" genérica sabía secretos de la asistencia → difícil de entender y peligroso de tocar |
| **Sin red de pruebas en lo crítico** | La parte más delicada (asistencia y estadísticas) no tenía tests → cambiarla era a ciegas |

---

## Cómo lo resolvimos (la estrategia)

Tres ideas, en orden:

1. **Primero la red, después el cambio.** Antes de tocar nada, escribimos *tests* que "fotografían" cómo funciona hoy. Si un cambio altera el comportamiento, el test **falla y avisa**.
2. **Cerramos la canilla de deuda nueva.** Pusimos un control automático que corre **antes de cada guardado de cambios** (commit): si alguien intenta meter el problema viejo otra vez, **lo bloquea**.
3. **Limpiamos de a un cuarto por vez.** Nada de "cambiar todo de una". Cada área se migra sola, se prueba, y recién ahí se pasa a la siguiente.

---

## Lo que YA logramos

| Área limpiada | Qué hicimos (simple) | Beneficio para el usuario |
|---|---|---|
| 🛡️ **Red de seguridad** | Tests que fotografían el comportamiento actual | Cambios sin miedo: si algo se rompe, se detecta **antes** de llegar a los usuarios |
| 🚧 **Cerco anti-deuda** | Control automático en cada commit | El problema viejo **no puede volver a colarse** sin querer |
| 👷 **Empleados, Puestos, Perfil** | Agrupamos cambios para repintar **una sola vez** | Pantallas más ágiles, código más ordenado |
| 💸 **Préstamos** | Igual, **sin tocar nada de plata** (montos, pagos) | Más ágil y seguro; lo financiero quedó intacto y probado |
| 📤 **Exportar / 🌤️ Clima** | Mismos arreglos en sus pantallas | Menos trabajo del navegador al abrir menús/paneles |

**Resultado medible hasta hoy:** la "deuda" técnica bajó de **555 a 452 puntos**, con **1.222 pruebas automáticas en verde** y **8 redes de seguridad nuevas**. Cero cambios en la lógica del negocio. Todo en una rama aparte, lista para revisar.

> ℹ️ *Deuda* acá = cantidad de lugares que tocan ese objeto gigante de forma riesgosa. Menos = mejor.

---

## El próximo reto: Fase 4

Es la **cirugía de fondo**: sacarle a esa "caja central" el conocimiento de la asistencia y dárselo a su dueño natural. Es lo que de verdad **desata el nudo**.

### Cómo leer la tabla
- **Beneficio** (3 puntos): `●●●` alto · `●●○` medio · `●○○` bajo · `○○○` no aplica.
- **Dificultad (color):** 🟢 baja · 🟡 media · 🟠 alta · 🔴 muy alta.

| # | Paso | Qué problema resuelve | ⚡ Velocidad | 🛡️ Resiliencia | 🧩 Desacople | Dificultad |
|---|---|---|:---:|:---:|:---:|---|
| **0** | Reforzar la red de seguridad | Lo más delicado no tenía pruebas propias | `○○○` | `●●●` | `○○○` | 🟡 Medio |
| **1** | Sacar la lógica a la luz | Reglas escondidas dentro de la "caja" | `○○○` | `●●○` | `●●○` | 🟢 Bajo |
| **2** | Que el módulo se cuide solo | Dependencia oculta de la "caja" central | `●○○` | `●●●` | `●●○` | 🟡 Medio-bajo |
| **3** | Un solo camino para los datos | 39 lugares tocan la asistencia por su cuenta | `●○○` | `●●○` | `●●●` | 🔴 Muy alto |
| **4** | Vaciar la "caja" central | El nudo que afecta a toda la app ("acción a distancia") | `●●○` | `●●○` | `●●●` | 🟠 Alto |
| **5** | Destrabar la optimización | Hoy no se puede acelerar el marcado de asistencia | `●●●` | `●○○` | `●○○` | 🟠 Medio-alto |

### Beneficios esperados, en palabras

| Paso | Lo que se gana, en concreto |
|---|---|
| **0** | Poder operar sin miedo: la red atrapa errores antes de que se publiquen. |
| **1** | Código que cualquiera entiende y puede reutilizar (ya no está escondido). |
| **2** | Los datos quedan **siempre consistentes**, aunque se optimice el dibujado. |
| **3** | Un **único camino seguro** para crear/editar/borrar asistencia → menos bugs. |
| **4** | **Desacople real**: la "caja" deja de saber de asistencia → tocar una parte ya no arriesga el resto. |
| **5** | **Más velocidad** al marcar asistencia: la pantalla se repinta una vez en lugar de muchas. |

> ⚠️ **Sobre los segundos exactos de velocidad:** hoy cada acción repinta toda la pantalla; reducir eso se *siente* más ágil, pero el número exacto (ej. "0,8 s menos") recién se puede afirmar **midiendo con herramientas de perfilado** después del cambio. Preferimos no inventar cifras.

### El principio que lo hace seguro 🪂

> En **ningún momento** la app se queda sin su "motor de coherencia". Primero instalamos el motor nuevo **en paralelo** al viejo, migramos todo hacia él, y **recién cuando está probado** sacamos el viejo. Así, una cirugía de alto riesgo se convierte en pasos chicos, reversibles y siempre en verde.

---

## Glosario para aprendices

| Término | En simple |
|---|---|
| **Estado / "la caja central"** | El objeto donde la app guarda todos sus datos en memoria mientras la usás. |
| **Repintar (render)** | Volver a dibujar la pantalla. Hacerlo de más = app lenta. |
| **Acoplamiento** | Qué tan enganchadas están las partes entre sí. Mucho enganche = cambiar una rompe otra. |
| **Desacople** | Lo contrario: separar las partes para que sean independientes. El objetivo. |
| **Acción a distancia** | Un efecto lejano e inesperado: tocás A y se altera C sin que sea obvio. |
| **Test / prueba automática** | Un mini-programa que verifica que algo funciona. Si se rompe, avisa. |
| **Caracterización** | Test que "fotografía" cómo funciona hoy, para que un cambio no lo altere sin avisar. |
| **Deuda técnica** | Atajos del pasado que hoy hacen el código más difícil de mantener. |
| **Commit** | Un "punto de guardado" del trabajo, con su descripción. |
| **Rama (branch) / PR** | Trabajar en una copia aparte y luego pedir fusionarla a la versión principal, con revisión. |
| **Coherencia de datos** | Que los números derivados (estadísticas, índices) siempre coincidan con los datos reales. |
