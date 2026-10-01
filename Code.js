/**
 * Finanzas App — Backend (Google Apps Script)
 *
 * La hoja de Google Sheets ES la base de datos: no hay copias ni caché.
 * Cada función pública devuelve datos frescos leídos de la hoja.
 *
 * Este archivo es la ENTRADA: constantes globales, la web app (doGet/include) y
 * getDatos, que arma de una vez todo lo que el cliente necesita. El resto vive
 * en archivos por responsabilidad (Apps Script comparte el ámbito global, así
 * que se llaman entre sí sin importar nada):
 *
 *   util-hoja.js        celdas, fechas, números y columnas que se autocrean
 *   srv-datos.js        leer las hojas -> objetos
 *   srv-saldos.js       la aritmética (saldos, inicios de mes, historia, resumen)
 *   srv-movimientos.js  escribir movimientos, ajustes de saldo y recurrentes
 *   srv-cuentas.js      alta, edición, borrado y orden de cuentas
 *   srv-categorias.js   categorías y presupuestos
 *   srv-config.js       hoja Config: moneda base, tasas y categorías ocultas
 *   srv-libro.js        qué hoja abre cada usuario (y crearla la primera vez)
 */

// Hoja del DUEÑO (quien despliega). Vinculado a la hoja no hace falta: la
// encuentra getActiveSpreadsheet(). Los demás usuarios tienen la suya propia.
var SPREADSHEET_ID = 'TU_ID_DE_HOJA_AQUI';

var TZ = 'America/Bogota';

var TIPOS_VALIDOS = ['Ingreso', 'Gasto', 'Transferencia', 'Pago tarjeta'];

// Cuántos movimientos van al cliente de una vez. El resto se trae por páginas
// con getMasMovimientos ("Cargar más" del Historial): mandarlos todos haría el
// payload enorme cuando haya años de datos.
var PAGINA_MOVIMIENTOS = 300;

// Monedas soportadas (v9). COP es el pivote: las tasas de Config van XXX→COP.
var MONEDAS_VALIDAS = ['COP', 'USD', 'EUR', 'GBP', 'BRL', 'MXN', 'ARS', 'CLP', 'PEN', 'CAD', 'CHF', 'JPY'];

// Filas de tasa que debe tener Config (con su tasa manual de respaldo, aprox).
// La automática (GOOGLEFINANCE) manda; la manual solo se usa si aquella falla.
var CONFIG_MONEDAS = [
  { par: 'USD', manual: 4000 }, { par: 'EUR', manual: 4700 }, { par: 'GBP', manual: 5400 },
  { par: 'BRL', manual: 800 }, { par: 'MXN', manual: 240 }, { par: 'ARS', manual: 4 },
  { par: 'CLP', manual: 4.5 }, { par: 'PEN', manual: 1150 }, { par: 'CAD', manual: 3100 },
  { par: 'CHF', manual: 4900 }, { par: 'JPY', manual: 28 }
];

// abrirLibro_() vive en srv-libro.js: cada usuario tiene su propia hoja.


// ------------------------------------------------ Web App

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Mis Finanzas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Permite <?!= include('styles') ?> dentro de index.html */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}


// ------------------------------------------------ API pública: getDatos
// Una sola llamada devuelve TODO lo que el cliente necesita para pintar la app.
// Todas las funciones que escriben terminan con `return getDatos(true)`, así que
// después de cada acción la UI se repinta con el estado real de la hoja.

/**
 * La app es casi siempre lectura, así que el resultado de getDatos se puede
 * cachear en CacheService para que reabrir sea instantáneo.
 *
 * DESACTIVADO por defecto (CACHE_TTL_SEG = 0): así getDatos se comporta
 * EXACTAMENTE como antes (siempre fresco) y no cambia nada. Para activarlo,
 * pon p.ej. CACHE_TTL_SEG = 120. El trade-off: la PRIMERA apertura mostraría
 * datos de hasta esos segundos; el botón ⟳ y "volver a la app" siempre fuerzan
 * fresco (el cliente los llama con forzar=true), así que la frescura al
 * refrescar no cambia. Cada escritura invalida el caché, así que tras
 * registrar algo los datos nuevos se ven al instante.
 *
 * Si el resultado no cabe en caché (>100 KB: muchas cuentas/movimientos), se
 * omite en silencio y la app sigue funcionando igual.
 */
var CACHE_KEY_DATOS = 'finanzas:getDatos:v1';

var CACHE_TTL_SEG = 0; // 0 = desactivado (siempre fresco). p.ej. 120 para activar.

function invalidarCacheDatos_() {
  if (CACHE_TTL_SEG <= 0) return;
  try { CacheService.getUserCache().remove(CACHE_KEY_DATOS); }
  catch (e) { /* sin caché activo no hay nada que borrar */ }
}

/**
 * Un solo viaje al servidor: todo lo que la app necesita para pintarse.
 *
 * forzar=true (escrituras, botón ⟳ y "volver a la app") ignora el caché,
 * recalcula y lo re-llena. Con CACHE_TTL_SEG = 0 va siempre al cálculo fresco.
 */
function getDatos(forzar) {
  if (CACHE_TTL_SEG > 0) {
    var cache = CacheService.getUserCache();
    if (!forzar) {
      var guardado = cache.get(CACHE_KEY_DATOS);
      if (guardado) {
        try { return JSON.parse(guardado); } catch (e) { /* caché corrupto: recalcular */ }
      }
    } else {
      invalidarCacheDatos_();
    }
  }
  var datos = calcularDatos_();
  if (CACHE_TTL_SEG > 0) {
    // cache ya quedó asignada arriba (mismo guard TTL>0); var es de función.
    try { cache.put(CACHE_KEY_DATOS, JSON.stringify(datos), CACHE_TTL_SEG); }
    catch (e) { /* no cabe o error: seguir sin caché, la app funciona igual */ }
  }
  return datos;
}

/** Cálculo completo de los datos (lo que antes era el cuerpo de getDatos). */
function calcularDatos_() {
  var ss = abrirLibro_();

  // La hoja debe interpretar fechas en la misma zona que la app: si quedó en
  // otra (el .xlsx importado venía en GMT-7), una fecha tecleada a mano en la
  // hoja podría leerse como el día anterior. Se corrige una sola vez.
  if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);
  asegurarColumnaTipo_(ss);          // columna Activo/Deuda (solo escribe la primera vez)
  asegurarColumnaMoneda_(ss);        // columna COP/USD/EUR (idem)
  asegurarColumnaValorDestino_(ss);  // columna para transferencias entre monedas
  asegurarColumnaUid_(ss);           // columna para la cola de pendientes (offline)
  asegurarHojaConfig_(ss);           // hoja de tasas de cambio

  // Los movimientos que se repiten cada mes se crean al abrir la app, antes de
  // leer nada (así el resumen ya los incluye). Es idempotente por mes.
  var hoyISO = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  generarRecurrentes_(ss, hoyISO);

  var cuentas = leerCuentas_(ss);
  var categorias = leerCategorias_(ss);
  var movimientos = leerMovimientos_(ss);
  var tasas = leerTasas_(ss);
  var claves = leerConfigClaves_(ss);
  var monedaBase = MONEDAS_VALIDAS.indexOf(String(claves.MonedaBase || 'COP')) >= 0
    ? String(claves.MonedaBase) : 'COP';
  var catsOcultas = String(claves.CatsOcultas || '').split('|')
    .map(function (s) { return s.trim(); }).filter(function (s) { return s; });

  // Tasa a COP de cada cuenta según su moneda (COP = 1). Todo lo consolidado
  // (patrimonio, resumen, evolución) se muestra en COP con estas tasas.
  var tasaPorCuenta = {};
  cuentas.forEach(function (c) {
    c.tasa = c.moneda === 'COP' ? 1 : (tasas[c.moneda] ? tasas[c.moneda].tasa : 0);
    tasaPorCuenta[c.cuenta] = c.tasa;
  });

  var saldos = calcularSaldos_(cuentas, movimientos);
  var patrimonio = 0;
  cuentas.forEach(function (c) {
    c.saldo = saldos[c.cuenta];             // en la moneda de la cuenta
    c.saldoCOP = c.saldo * c.tasa;          // equivalente consolidado
    patrimonio += c.saldoCOP;
  });

  // ¿La cuenta / categoría aparece en algún movimiento? (decide si se puede eliminar)
  var usadas = {}, catsUsadas = {};
  movimientos.forEach(function (m) {
    usadas[m.cuenta] = true;
    if (m.cuentaDestino) usadas[m.cuentaDestino] = true;
    if (m.categoria) catsUsadas[m.categoria] = true;
  });
  cuentas.forEach(function (c) { c.enUso = !!usadas[c.cuenta]; });
  categorias.forEach(function (c) { c.enUso = !!catsUsadas[c.categoria]; });

  // Patrimonio con el que EMPEZÓ el mes: saldos sin los movimientos del mes.
  var hoy = hoyISO;
  var resumen = resumenMensual_(movimientos, tasaPorCuenta);

  // Inicio de cada mes (por cuenta en su moneda, modal de mes) y el patrimonio
  // con el que EMPEZÓ el mes actual, en UNA sola pasada sobre los movimientos
  // ordenados (iniciosDeMes_), en vez de 13 calcularSaldos_ que recorrían todos
  // los movimientos una y otra vez. El mes actual es el último de los 12
  // (ultimosMeses_ termina en hoy), así que su inicio ES el arranque del mes.
  var inicios = iniciosDeMes_(cuentas, movimientos,
    resumen.meses.map(function (m) { return m.mes; }));
  var patrimonioInicioMes = 0;
  resumen.meses.forEach(function (m) {
    var s = inicios[m.mes];
    m.inicioPorCuenta = s;
    var total = 0;
    cuentas.forEach(function (c) { total += s[c.cuenta] * c.tasa; });
    m.inicio = total;
  });
  patrimonioInicioMes = resumen.meses[resumen.meses.length - 1].inicio;

  // Saldo diario por cuenta (vista de cuenta, patrimonio y sparklines)
  var historia = calcularHistoria_(cuentas, movimientos, hoy);

  // Más recientes primero; al cliente solo va la primera página (el resto se
  // pide con getMasMovimientos desde el botón "Cargar más" del Historial).
  movimientos.sort(function (a, b) {
    return a.fecha === b.fecha ? b.id - a.id : (a.fecha < b.fecha ? 1 : -1);
  });

  return {
    cuentas: cuentas,
    categorias: categorias,
    movimientos: movimientos.slice(0, PAGINA_MOVIMIENTOS),
    totalMovimientos: movimientos.length, // para saber si queda algo por cargar
    resumen: resumen,
    presupuestos: leerPresupuestos_(ss),
    patrimonio: patrimonio,
    patrimonioInicioMes: patrimonioInicioMes,
    tasas: tasas,
    monedaBase: monedaBase,   // moneda en la que se VISUALIZA todo
    catsOcultas: catsOcultas, // categorías que no se ofrecen al registrar
    recurrentes: leerRecurrentes_(ss), // lo que se repite cada mes
    historia: historia,
    hojaUrl: ss.getUrl(),   // enlace directo a la hoja (Ajustes → Datos)
    // Para exportar a CSV sin pedir permisos nuevos: la propia hoja se descarga
    // desde su URL de export, aprovechando la sesión de Google del usuario.
    csvUrl: ss.getUrl().replace(/\/edit.*$/, '') +
      '/export?format=csv&gid=' + ss.getSheetByName('Movimientos').getSheetId(),
    hoy: hoy
  };
}
