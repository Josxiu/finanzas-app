# CLAUDE.md — Finanzas App

App de finanzas personales: web app de **Google Apps Script** con los datos en una
**hoja de Google Sheets**. El usuario habla español (Colombia/Chile): responde en
español, sencillo y sin jerga técnica.

## Arquitectura

- **Servidor (Apps Script, `.js`)**: `Code.js` (doGet, `include()`, constantes como
  `SPREADSHEET_ID` y `TZ`), `srv-*.js` (datos, saldos, movimientos, cuentas,
  categorías, config, libro), `util-hoja.js`.
- **Cliente (`.html`)**: `index.html` hace `include()` de `estilos-*.html` (CSS) y
  `app-*.html` (JS). No hay bundler ni npm. Las llamadas al servidor van por
  `google.script.run`.
  - `estilos-tokens.html`: los colores van como tokens en `:root`. El tema claro es
    "Índigo claro" y el oscuro, "Noche", va en `html[data-tema="oscuro"]`. La
    fuente es Manrope.
  - `app-core.html`: helpers (formato de montos, `leerPref`/`guardarPref`, el
    catálogo de iconos `ICONOS_CAT`, la calculadora del monto `evaluarMonto`).
  - `app-arranque.html`: navegación (`irA`, `TITULOS`), y el modo PC con
    "Registro rápido" lateral (`registroLateral()`, desde 1200px).
  - `app-registrar.html`, `app-panel.html` (Inicio), `app-historial.html`
    (Movimientos), `app-evolucion.html` (Análisis), `app-cuentas.html`,
    `app-ajustes.html`. En `app-ajustes.html` están `VERSION` y `CHANGELOG`:
    súbelos en cada cambio visible.
- **Multiusuario**: `appsscript.json` tiene `executeAs: USER_ACCESSING` y
  `access: ANYONE`. Cada persona entra con su cuenta de Google. `srv-libro.js`
  guarda el ID de su hoja en UserProperties:
  - el dueño usa la hoja vinculada al script;
  - cualquier otra persona recibe una hoja nueva en su Drive (`crearLibroNuevo_`).
  - Usa `getUserLock` y `getUserCache`. El ScriptLock solo se usa al asignar la hoja.
- **Iconos de categoría**: en la hoja se guarda `i:<clave>`, que se pinta con el
  símbolo SVG `c-<clave>` del sprite de `index.html`. Los emojis viejos se
  traducen con `EMOJI_A_ICONO` y `PALABRA_A_ICONO`. Un emoji desconocido se
  muestra como 'otros'.

## Reglas importantes

- **El repo es PÚBLICO.** Nunca subas:
  - el ID real de la hoja (en el repo `SPREADSHEET_ID` queda como `'TU_ID_DE_HOJA_AQUI'`);
  - datos personales;
  - IDs de despliegue o del script;
  - credenciales (`~/.clasprc.json`);
  - el archivo `tmp-clases.js`. Ese archivo solo existe en el proyecto de Apps
    Script, NO en el repo, y debe conservarse al hacer push.
- `.claspignore` es una **lista blanca**: si agregas un archivo que deba subir a
  Apps Script, agrégalo ahí, o la app quedará incompleta sin avisar.
- `localStorage` puede estar lleno. Usa siempre `leerPref`/`guardarPref`, que
  liberan la caché `ultimosDatos` si falla. Aplica primero lo visual y guarda después.
- Los nombres de la hoja van con `textContent`, nunca con `innerHTML`.
- En SVG, `stroke="var(--x)"` no funciona como atributo: usa `el.style.stroke`.

## Probar

- `node preview/generar_preview.js` genera `preview/preview.html`, que no se sube
  al repo: es la app con un `google.script.run` simulado y datos ficticios. Se
  prueba con Playwright (`/opt/node-tools/node_modules/playwright`, Chromium en
  `/opt/pw-browsers`) en 390px (celular), 1100px y 1300px (PC con panel lateral).
- Guarda las capturas y los scripts de prueba en el scratchpad, nunca en el repo.

## Desplegar (clasp, sin el PC del usuario)

1. Inicia sesión con `clasp login --no-localhost`. Pásale la entrada por un
   `mkfifo` que mantengas abierto con un `sleep`. Dale al usuario la URL de
   Google; él pega de vuelta la URL de `localhost:8888/...`.
2. Haz `clasp pull` en una carpeta nueva del scratchpad. Así obtienes el
   `.clasp.json` (scriptId), el `tmp-clases.js` y el ID real de la hoja, que está
   en el `Code.js` remoto. Compara con lo último que subiste: si alguien cambió
   algo en el editor, respáldalo antes.
3. Arma una carpeta de despliegue:
   - copia los archivos de la lista blanca;
   - agrega `tmp-clases.js` y `.clasp.json`;
   - reemplaza `TU_ID_DE_HOJA_AQUI` por el ID real, SOLO en esa copia.
4. Ejecuta `clasp push -f` y verifica con otro `clasp pull` que todo quedó igual.
   Esto actualiza el link de **prueba (/dev)**. El usuario lo revisa en el celular.
5. Solo cuando el usuario confirme, ejecuta
   `clasp create-version "<desc>"` y luego
   `clasp update-deployment <id prod> --versionNumber N --description "<desc>"`.
   El despliegue de prod es el que tiene versión en `clasp list-deployments`; el
   que dice `@HEAD` es /dev. **Siempre el mismo despliegue**: así el link del
   usuario no cambia.
6. Crea un PR a `main`, fusiónalo y haz `git pull origin main` en la rama.
7. Termina con `clasp logout` y `rm -f ~/.clasprc.json`.

Ojo: `pkill -f "sleep 3600"` dentro del mismo comando mata al propio shell
(exit 144). No lo uses así.

## Historial de decisiones (lo que pidió el usuario)

- v12: rediseño con el estilo "Índigo claro" y un tema oscuro.
  - La navegación es Inicio / Movimientos / **+** / Análisis / Ajustes.
  - En PC hay un "Registro rápido" lateral.
  - Las cuentas y deudas se deslizan en el celular.
  - Las categorías usan iconos de línea, no emojis.
- v12.1–12.2: el **monto funciona como calculadora**. Se escribe
  `12000+8500+3000` con el teclado del celular y se guarda UN movimiento por el
  total. El usuario **no quiere** una barra de botones + − × ÷ (estorba; su
  teclado ya los trae) ni el botón "Guardar y agregar otro".
- v12.3: en el Inicio **no** debe haber botones rápidos (Gasto/Ingreso/Transferir/
  Pagar deuda): basta el + del centro. "Este mes" se muestra en 2x2: Empezó con
  · Ingresos / Gastos · Neto. El formato de barras "Entró/Salió" no le gustó.
- v12.4: en el celular, cuentas y deudas se deslizan por defecto, y cada lista
  tiene un botón "Ver todas"/"Deslizar" (se recuerda con `vista-<id lista>` en
  localStorage). Mientras se ordena, se ven todas. En PC siempre en cuadrícula.
- Pendiente: en las deudas, mostrar el "% pagado". El usuario dijo "luego lo miramos".
