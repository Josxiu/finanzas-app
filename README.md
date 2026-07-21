# Finanzas App — Google Sheets + Apps Script

App web de finanzas personales sobre Google Sheets + Apps Script. La base de
datos es **tu propia hoja de Google**: lo que escribas en la hoja aparece en la
app al refrescar, y viceversa. Cada quien la despliega contra su propia hoja
(ver abajo); este repo no incluye datos reales — el preview usa datos ficticios.

## Archivos

| Archivo | Qué es |
|---|---|
| `Code.js` | Backend (en el editor de Apps Script se llama `Code.gs`) |
| `index.html` | Estructura de la página |
| `styles.html` | CSS (se inserta con `<?!= include('styles') ?>`) |
| `app.html` | JavaScript del cliente |
| `appsscript.json` | Manifiesto: timezone Bogotá, web app "Solo yo" |
| `desplegar.ps1` | Sube todo con clasp (login + create + push) |
| `preview/generar_preview.js` | Genera una versión de prueba local (ver "Probar localmente") |

## Opción A — Desplegar con clasp (recomendada)

1. Activa la API (una sola vez): https://script.google.com/home/usersettings → **Google Apps Script API: Activada**.
2. En PowerShell, dentro de esta carpeta:
   ```powershell
  powershell -ExecutionPolicy Bypass -File .\desplegar.ps1
   ```
   La primera vez abre el navegador para `clasp login` (inicia sesión con tu cuenta de Google).
3. Primera implementación (una sola vez):
   - `clasp open-script` para abrir el editor.
   - **Implementar > Nueva implementación >** ⚙ **Aplicación web**.
   - *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Solo yo** → **Implementar**.
   - Autoriza los permisos (ver "Problemas comunes").
   - Copia la **URL que termina en `/exec`**: esa es tu app.

### Actualizar cuando cambie el código
```powershell
powershell -ExecutionPolicy Bypass -File .\desplegar.ps1     # (o directamente: clasp push -f)
```
Luego en el editor: **Implementar > Administrar implementaciones > ✏ (editar) > Versión: Nueva versión > Implementar**.
La URL `/exec` no cambia.

## Opción B — Sin clasp (pegar a mano)

1. Abre la hoja → **Extensiones > Apps Script**.
2. Pega el contenido de `Code.js` en `Código.gs`.
3. **➕ > HTML** tres veces: crea `index`, `styles` y `app`, y pega el contenido de cada archivo (el editor les agrega `.html` solo).
4. ⚙ **Configuración del proyecto** → marca *Mostrar el archivo de manifiesto appsscript.json* → pega el contenido de `appsscript.json`.
5. Guarda todo (Ctrl+S) y sigue desde "Primera implementación" de la opción A.

## Usarla en el celular como app

1. Abre la URL `/exec` en Chrome (logueado con tu cuenta de Google).
2. Menú ⋮ → **Agregar a pantalla de inicio** → Agregar.
3. Queda un ícono 💰 "Mis Finanzas" que abre a pantalla completa.

## Problemas comunes

- **"This app isn't verified" / "Google no verificó esta app"** al autorizar:
  **Configuración avanzada → Ir a Finanzas App (no seguro)**. Es tu propio script,
  es seguro; Google lo dice porque no pasó por revisión comercial.
- **PowerShell dice que `desplegar.ps1` no está firmado**: ejecuta el script con
  `powershell -ExecutionPolicy Bypass -File .\desplegar.ps1` desde la carpeta
  `finanzas-app`.
- **La primera carga pide muchos permisos**: solo pide acceso a tus hojas de
  cálculo. Se autoriza una vez.
- **clasp login falla con "User has not enabled the Apps Script API"**:
  actívala en https://script.google.com/home/usersettings y reintenta.
- **La app muestra datos viejos**: botón ⟳ arriba a la derecha, o sal y vuelve
  a entrar (recarga sola al volver).
- **Cambié el código pero la app sigue igual**: te faltó crear **Nueva versión**
  en Administrar implementaciones (el `/exec` sirve la última versión implementada,
  no el último push).
- **Escribí en la hoja directamente**: perfecto, es la idea. Solo respeta las
  columnas y pon el `Valor` siempre positivo; el signo lo da el `Tipo`.
- **"ReferenceError: require is not defined" al abrir la app** (pasó una vez):
  `clasp push` subió también `preview/generar_preview.js`, que es un script de
  Node y no corre en Apps Script. Lo evita el `.claspignore` (lista blanca de
  los 5 archivos que sí van); si vuelve a pasar, revisa que ese archivo exista
  y que `clasp show-file-status` solo liste Code.js, los 3 html y el manifiesto.
- **La gráfica de barras salió vacía / faltaba el mes actual** (pasó en julio
  2026): `clasp create` había pisado `appsscript.json` con zona horaria
  New York y el cálculo de meses se corría uno hacia atrás. Ya está doblemente
  arreglado (manifiesto restaurado + el cálculo ya no depende de la zona), y
  `desplegar.ps1` ahora se niega a subir si el manifiesto no dice
  `America/Bogota`. Si sospechas de esto: en el editor de Apps Script →
  Configuración del proyecto → el manifiesto debe decir
  `"timeZone": "America/Bogota"`.

## Cómo calcula los saldos

`Saldo = SaldoInicial + movimientos con Fecha >= FechaCorte (2026-07-01)`

- Ingreso suma / Gasto resta en `Cuenta`.
- Transferencia y Pago tarjeta: restan en `Cuenta` y suman en `CuentaDestino`
  (una tarjeta de crédito es negativa: pagarle acerca la deuda a 0). Si las dos cuentas
  usan monedas distintas, al destino le entra la columna `ValorDestino` (lo que
  el banco te acredita en la otra moneda); si son iguales, entra el mismo valor.
- Patrimonio = suma de todos los saldos convertidos a COP (la tarjeta entra
  negativa).
- Los movimientos anteriores a la FechaCorte no tocan el saldo (ya están
  incluidos en el SaldoInicial); igual quedan en el historial.

## Cuadrar una cuenta ("Ajustar saldo")

Si el saldo que muestra la app no coincide con el del banco, es que falta
registrar algo (rendimientos de una cuenta, varios gastos que se pasaron, un
monto mal tecleado). Para cuadrarla:

**📊 Panel → toca la tarjeta de la cuenta → escribe el saldo real → Crear ajuste.**

- El campo arranca con el saldo que la app calcula; solo hay que corregirlo.
- Antes de confirmar te dice exactamente qué movimiento va a crear.
- Crea **una fila** con la diferencia (Ingreso si falta plata, Gasto si sobra),
  categoría `Ajuste`, con fecha de hoy. No toca el `SaldoInicial` ni los
  movimientos viejos, así que funciona igual con 3 o con 3.000 movimientos, y
  el descuadre queda visible en el historial.
- Si ya está cuadrada, no escribe nada.
- En una tarjeta de crédito el saldo va en **negativo** (−63.226 = debes 63.226).
- La categoría `Ajuste` se agrega sola a la hoja `Categorias` la primera vez.

**Ojo:** si el descuadre viene de un monto mal escrito, es mejor corregir ese
movimiento en el Historial que crear un ajuste — así el dato queda bien de raíz.

### Cambiar el saldo inicial (mismo modal, sección "✏️ Editar cuenta…")

El **saldo inicial** es el punto de partida de la FechaCorte (2026-07-01).
Cámbialo solo si ese número estaba mal escrito desde el principio; el saldo
actual se recalcula al guardar y **no** crea ningún movimiento. Para el día a
día usa "Crear ajuste", que sí deja rastro en el historial. Acepta negativos
(la tarjeta de crédito). Pide confirmación mostrando el antes y el después.

## Panel: rango de gráficas y "Empezó con"

- La tarjeta **Este mes** muestra 4 datos: **Empezó con** (el patrimonio con el
  que arrancó el mes, calculado sin los movimientos del mes), Ingresos, Gastos
  y Neto. Ojo: los movimientos anteriores a la FechaCorte cuentan en
  Ingresos/Gastos del resumen pero no mueven saldos (ya están dentro del saldo
  inicial), así que Neto y (Patrimonio − Empezó con) pueden diferir ese mes.
- Ingresos y Gastos llevan un **chip de % vs el mes pasado**. Verde = el
  cambio es bueno, rojo = malo (ingresar más es verde, gastar más es rojo).
- Debajo va la **proyección de fin de mes**: el ritmo de gasto diario que
  llevas y en cuánto cerraría el mes a ese paso.
- Botones **Este mes / 3M / 6M / 12M** encima de las gráficas: cambian a la vez
  la gráfica de categorías (gastos del rango) y la de barras (esos meses). La
  elección se recuerda en el navegador.

### Vistas de las gráficas (estilo Whisper Money)

Cada gráfica tiene sus propios chips de vista (también se recuerdan):

- **Gastos por categoría** — `🍩 Dona` o `📊 Lista`: la lista muestra cada
  categoría con barra proporcional, monto y % del total (más legible en el
  celular cuando hay muchas categorías). La dona lleva el **total del rango en
  el centro** y el tooltip dice monto y %.
- **Tocar una categoría** (porción de la dona o fila de la lista) salta al
  **Historial ya filtrado** por esa categoría (y por el mes, si el rango es
  "Este mes").
- **Barras** — `I vs G` (ingresos y gastos lado a lado) o `Neto` (una barra por
  período, verde/roja). Los colores salen del tema (menos saturados en oscuro)
  y las etiquetas del eje van compactas (`44k`, `1,5M`).
- **📅 Por mes / Por día**: un botón interruptor. En `Por día` se grafica el
  mes en curso día a día (del 1 a hoy). Los chips de rango siguen mandando
  sobre la gráfica de categorías.

Encima de estas dos gráficas va la **línea de patrimonio**: cómo cambia tu
dinero en el tiempo (punto por día en "Este mes", punto por mes en 3M/6M/12M),
con degradado bajo la curva y un tooltip que dice fecha, valor y cuánto subió o
bajó respecto al punto anterior.

## Presupuestos por categoría (📊 Panel)

- Tarjeta **Presupuestos del mes**: cada categoría con tope muestra una barra
  de progreso del gasto del mes en curso — verde si vas bien, ámbar desde el
  80% del tope, roja si te pasaste. Los más apretados salen arriba y tocar
  uno abre sus movimientos del mes en el Historial.
- Se editan con **✏️ Editar**: eliges la categoría, escribes el tope y listo
  (si ya tenía, se precarga para corregirlo; guardar en 0 o el 🗑 lo quitan).
- Viven en la hoja **`Presupuestos`** (Categoria, TopeMensual), que la app
  crea sola la primera vez. También puedes editarla a mano, como todo.

## Atajos y detalles

- **Registrar recuerda tu última cuenta** usada y la deja preseleccionada.
- **Escape** cierra el modal que esté abierto (en PC).
- En la gráfica de **Evolución**, el tooltip dice cuánto subió o bajó el
  patrimonio respecto al punto anterior.

## Pestaña 📜 Historial

- Filtros por mes, cuenta, tipo y categoría, más un **buscador de texto** que
  no distingue mayúsculas ni tildes ("fisico" encuentra "físico") y busca en
  descripción, categoría y cuentas.
- Cuando hay algún filtro o búsqueda activa aparece el **resumen de lo
  filtrado**: cuántos movimientos son y cuánto suman (+ingresos, −gastos y
  neto). Las transferencias y pagos se listan pero no suman: mueven plata,
  no la gastan.

## Cuentas y Deudas (pestaña 📊 Panel)

- Cada cuenta tiene un **Tipo** (columna F de la hoja `Cuentas`, la crea y
  clasifica la app sola): `Activo` (cuenta de ahorros, billetera...) o `Deuda`
  (una tarjeta de crédito, un préstamo...). El Panel las muestra en secciones separadas;
  las deudas se ven **en positivo** ("debes $X") aunque en la hoja vivan en
  negativo. La tarjeta de patrimonio muestra el desglose Cuentas · Deudas.
- **💳 Pagar deuda** (antes "Pago TC"; en la hoja el valor sigue siendo
  `Pago tarjeta`): sale de una cuenta normal y va hacia una deuda; la baja
  hacia cero. La app no deja transferir hacia una deuda ni "pagar" hacia una
  cuenta normal — cada cosa por su camino.
- Las **transferencias y pagos no llevan categoría** (mueven plata, no la
  gastan): el formulario ya ni la muestra.
- **↕ Ordenar**: reacomoda las tarjetas (flechas en el celular, arrastrar en
  PC); el orden se guarda en la hoja.
- **Editar una cuenta**: toca su tarjeta → detalle → "✏️ Editar cuenta": nombre,
  color, nota, **moneda** y saldo inicial. Si cambias el nombre, se actualiza
  solo en TODO el historial (por eso renombrar es seguro). Las categorías igual:
  botón "✏️ Editar" junto a "Categoría" en Registrar → cada fila se edita en
  línea; renombrar también propaga al historial.
- Cada tarjeta lleva un **sparkline** de los últimos 30 días (mini-tendencia en
  el color de la cuenta) y un **›** para abrir su detalle.

## Detalle de una cuenta

Toca una tarjeta del Panel para abrir su subvista (el botón **atrás** del
navegador la cierra; el enlace lleva un `#cuenta/Nombre`):

- Encabezado con su color, saldo grande (y el equivalente en COP si es una
  cuenta en otra moneda), nota.
- **Gráfica del saldo día a día** con rangos 1M/3M/6M/12M.
- Ingresos y gastos del mes en esa cuenta y sus últimos movimientos (tócalos
  para editarlos).
- Acciones: **➕ Registrar aquí** (con la cuenta ya elegida), **⚖️ Conciliar
  saldo** (escribe el saldo real del banco → crea el ajuste de un clic) y
  **✏️ Editar cuenta**.

## Multimoneda (COP · USD · EUR)

- Cada cuenta tiene una **Moneda** (columna G de `Cuentas`, la crea la app;
  las existentes quedan en `COP`). Se elige al crear o editar la cuenta.
- Todo lo **consolidado** (patrimonio, panel, evolución) se muestra en **COP**.
  En una cuenta que no sea COP, la tarjeta muestra el saldo en su moneda y,
  debajo, el equivalente en COP y la tasa usada.
- Los movimientos de una cuenta se registran en **su** moneda. En una
  transferencia entre monedas distintas se piden **dos** valores: lo que sale y
  lo que llega (como te lo muestre el banco).
- Las **tasas** viven en la hoja `Config` (`=GOOGLEFINANCE("CURRENCY:USDCOP")`
  y EURCOP). Si Google devuelve `#N/A`, la app usa la **tasa manual** de
  respaldo de esa hoja y lo avisa con "tasa manual". Puedes editar la manual a
  mano cuando quieras.

## Pestaña 📈 Evolución

- **Línea de patrimonio** grande, con sus propios rangos (punto por día en
  "Este mes", por mes en 3M/6M/12M); degradado y tooltip con el cambio vs el
  punto anterior.
- **Tarjetas de insight**: mejor y peor mes (por neto), gasto promedio de los
  últimos 3 meses y tasa de ahorro del mes ((ingresos − gastos) / ingresos).
- **Tabla mes a mes**: inicio, ingresos, gastos, neto, fin y % de cambio.
  Ingresos/gastos/neto se conocen siempre; inicio/fin/% solo desde el corte
  (antes no hay saldos fiables, van con "—").
- **Composición del patrimonio**: barras apiladas por cuenta (hoy vs hace 3 y 6
  meses).
- **Gasto por categoría en el tiempo**: líneas de las categorías top.
- **Detalle por mes**: la lista de siempre; el inicio de cada mes NO se guarda,
  se calcula a partir de los movimientos, así que cada mes nuevo aparece solo y
  nunca se descuadra.
- **Ajustar el inicio de un mes**: toca el mes → verás con cuánto empezó cada
  cuenta, con un botón según el caso:
  - Meses **posteriores** a la fecha de corte → "⚖️ Ajustar": crea un
    movimiento con la diferencia **fechado el último día del mes anterior**
    (categoría Ajuste, visible en el historial). Una sola fuente de verdad.
  - El mes **de la fecha de corte** (julio 2026) → "✏️ Saldo inicial": el
    inicio de ese mes ES el saldo inicial de la cuenta, así que se edita
    directo (sin crear movimientos; el saldo actual se recalcula).
  - Meses **anteriores** al corte → "—": la app no tiene saldos de esa época
    (están contenidos en el saldo inicial); solo se ven sus ingresos/gastos.

## Agregar y eliminar cuentas

- **Agregar**: 📊 Resumen → tarjeta "➕ Agregar cuenta". Nombre, saldo actual
  (negativo si es deuda), color y nota. La cuenta arranca HOY con ese saldo
  (su FechaCorte es la fecha de creación). La app escribe la fila en la hoja
  `Cuentas` por ti.
- **Eliminar**: solo cuentas SIN movimientos (tarjeta de la cuenta → "Cambiar
  saldo inicial…" → 🗑 Eliminar). Una cuenta con movimientos no se puede
  borrar porque rompería el historial; el botón ni siquiera aparece.

## Categorías

En ➕ Registrar, al final de los chips de categoría está **"➕ Editar"**:
agrega categorías nuevas (emoji opcional + en qué tipo de movimiento se
sugieren primero) o elimina las que no uses. Igual que las cuentas, **solo se
pueden eliminar las que no tienen movimientos** en el historial — las demás
aparecen marcadas "en uso".

## Modo oscuro

Arranca según el tema del sistema (celular o PC) y el botón 🌙/☀️ del
encabezado lo fuerza; la elección se recuerda en el navegador.

## Probar localmente antes de subir

```powershell
node preview/generar_preview.js
```

Genera `preview/preview.html`: ábrelo con doble clic. Es la app completa
corriendo contra un **simulador** con datos de ejemplo en memoria — puedes
registrar, ajustar, borrar y romper lo que quieras: **no toca tu hoja real**.
Al recargar la página, los datos de ejemplo vuelven a empezar. Cuando algo se
vea bien ahí, lo subes con `desplegar.ps1` + Nueva versión.

## Vista de PC

Desde 900px de ancho la app cambia sola: menú lateral izquierdo, formulario en
dos columnas, cuentas en una fila y las gráficas lado a lado. En el celular no
cambia nada.
