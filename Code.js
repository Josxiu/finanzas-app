/**
 * Finanzas App — Backend (Google Apps Script)
 *
 * La hoja de Google Sheets ES la base de datos: no hay copias ni caché.
 * Cada función pública devuelve datos frescos leídos de la hoja.
 */

// Pega aquí el ID de TU hoja de Google (solo se usa como respaldo si el script
// corre desvinculado; ligado a la hoja, getActiveSpreadsheet() ya la resuelve).
var SPREADSHEET_ID = 'TU_ID_DE_HOJA_AQUI';
var TZ = 'America/Bogota';
var TIPOS_VALIDOS = ['Ingreso', 'Gasto', 'Transferencia', 'Pago tarjeta'];
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

/** Abre el libro: funciona vinculado a la hoja o como proyecto independiente. */
function abrirLibro_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss ? ss : SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ---------------------------------------------------------------- Web App

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

// ---------------------------------------------------------------- Utilidades

/** Convierte cualquier celda de fecha a texto 'YYYY-MM-DD' en hora de Bogotá. */
function fechaISO_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim();
  return s.substring(0, 10);
}

/**
 * Escribe una fecha 'YYYY-MM-DD' en una celda como TEXTO plano.
 * El formato '@' va ANTES del valor: si no, Sheets convierte el string en un
 * Date y volvemos a mezclar tipos en la columna (el lío que causaba filas
 * "14/07/2026 9:00:00" junto a filas ISO, peligroso para la comparación de
 * strings de calcularSaldos_).
 */
function escribirFechaTexto_(celda, iso) {
  celda.setNumberFormat('@').setValue(String(iso));
}

/** Convierte una celda numérica (o texto con formato colombiano) a Number. */
function numero_(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '0').trim().replace(/\$|\s/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56 -> 1234.56
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------- Lectura de hojas

function leerCuentas_(ss) {
  var filas = ss.getSheetByName('Cuentas').getDataRange().getValues();
  var cuentas = [];
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    if (!f[0]) continue;                       // ignora filas vacías o notas sueltas
    if (!f[1] && f[1] !== 0) continue;         // sin SaldoInicial no es una cuenta
    cuentas.push({
      cuenta: String(f[0]),
      saldoInicial: numero_(f[1]),
      fechaCorte: fechaISO_(f[2]),
      color: String(f[3] || '#1A73E8'),
      nota: String(f[4] || ''),
      // Sin celda de tipo, el signo decide (deuda = arranca en negativo)
      tipo: String(f[5] || '') || (numero_(f[1]) < 0 ? 'Deuda' : 'Activo'),
      // Sin celda de moneda (o con una desconocida), la cuenta es COP.
      // .trim(): un "USD " tecleado en la hoja caería a COP y consolidaría el
      // saldo a tasa 1 sin avisar.
      moneda: MONEDAS_VALIDAS.indexOf(String(f[6] || '').trim()) >= 0 ? String(f[6]).trim() : 'COP'
    });
  }
  return cuentas;
}

/**
 * Garantiza la columna F "Tipo" en la hoja Cuentas (Activo | Deuda).
 * La primera vez clasifica las cuentas existentes por el signo de su
 * SaldoInicial: una tarjeta de crédito (negativa) queda como Deuda.
 */
function asegurarColumnaTipo_(ss) {
  var hoja = ss.getSheetByName('Cuentas');
  if (String(hoja.getRange(1, 6).getValue()) === 'Tipo') return;
  hoja.getRange(1, 6).setValue('Tipo');
  var filas = hoja.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    if (!f[0]) continue;
    if (!f[1] && f[1] !== 0) continue; // la fila de nota del final no es una cuenta
    hoja.getRange(i + 1, 6).setValue(numero_(f[1]) < 0 ? 'Deuda' : 'Activo');
  }
  SpreadsheetApp.flush();
}

/**
 * Garantiza la columna G "Moneda" en Cuentas (COP | USD | EUR).
 * Igual que asegurarColumnaTipo_: solo escribe la primera vez, y todas las
 * cuentas existentes quedan en COP sin que nada más cambie.
 */
function asegurarColumnaMoneda_(ss) {
  var hoja = ss.getSheetByName('Cuentas');
  if (String(hoja.getRange(1, 7).getValue()) === 'Moneda') return;
  hoja.getRange(1, 7).setValue('Moneda');
  var filas = hoja.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    if (!f[0]) continue;
    if (!f[1] && f[1] !== 0) continue; // la fila de nota del final no es una cuenta
    hoja.getRange(i + 1, 7).setValue('COP');
  }
  SpreadsheetApp.flush();
}

/**
 * Garantiza la columna I "ValorDestino" en Movimientos: solo la usan las
 * transferencias entre cuentas de monedas distintas (valor que ENTRA al
 * destino, en la moneda del destino). Vacía = mismo valor que la columna H.
 */
function asegurarColumnaValorDestino_(ss) {
  var hoja = ss.getSheetByName('Movimientos');
  if (String(hoja.getRange(1, 9).getValue()) === 'ValorDestino') return;
  hoja.getRange(1, 9).setValue('ValorDestino');
  SpreadsheetApp.flush();
}

/**
 * Garantiza la hoja Config. Dos zonas:
 *   A-D: tasas de cambio  Par | TasaAuto (GOOGLEFINANCE) | TasaManual | Nota
 *   F-G: clave-valor      MonedaBase | COP   ·   CatsOcultas | a|b|c
 * Es idempotente: agrega solo las filas de moneda que falten y crea las claves
 * ausentes, sin pisar nada de lo que ya haya (tasas manuales, base elegida).
 * La TasaManual es el respaldo editable para cuando GOOGLEFINANCE da #N/A.
 */
function asegurarHojaConfig_(ss) {
  var hoja = ss.getSheetByName('Config');
  if (!hoja) {
    hoja = ss.insertSheet('Config');
    hoja.getRange(1, 1, 1, 4).setValues([['Par', 'TasaAuto', 'TasaManual', 'Nota']]);
  }
  // Filas de moneda que falten (no pisa las existentes ni sus tasas manuales)
  var filas = hoja.getDataRange().getValues();
  var pares = {};
  for (var i = 1; i < filas.length; i++) {
    var p = String(filas[i][0] || '').trim();
    if (p) pares[p] = true;
  }
  var siguiente = 2 + Object.keys(pares).length; // tras el encabezado y lo que ya está
  var agrego = false;
  CONFIG_MONEDAS.forEach(function (m) {
    if (pares[m.par]) return;
    hoja.getRange(siguiente, 1, 1, 4).setValues([[m.par, '', m.manual,
      'Tasa a COP. La manual solo se usa si la automática falla.']]);
    hoja.getRange(siguiente, 2).setFormula('=GOOGLEFINANCE("CURRENCY:' + m.par + 'COP")');
    siguiente++;
    agrego = true;
  });
  // Área clave-valor (F/G): crear las que falten sin tocar las presentes
  var claves = leerConfigClaves_(ss);
  if (!('MonedaBase' in claves)) { escribirConfigClave_(hoja, 'MonedaBase', 'COP'); agrego = true; }
  if (!('CatsOcultas' in claves)) { escribirConfigClave_(hoja, 'CatsOcultas', ''); agrego = true; }
  if (agrego) SpreadsheetApp.flush();
}

/** Lee el área clave-valor (columnas F/G) de Config: { MonedaBase, CatsOcultas }. */
function leerConfigClaves_(ss) {
  var hoja = ss.getSheetByName('Config');
  var claves = {};
  if (!hoja) return claves;
  var n = Math.min(20, hoja.getMaxRows());
  var rango = hoja.getRange(1, 6, n, 2).getValues(); // F1:G(n)
  for (var i = 0; i < rango.length; i++) {
    var k = String(rango[i][0] || '').trim();
    if (k) claves[k] = String(rango[i][1] == null ? '' : rango[i][1]);
  }
  return claves;
}

/** Escribe/actualiza una clave en el área F/G (la crea al final si no existe). */
function escribirConfigClave_(hoja, clave, valor) {
  var n = Math.min(20, hoja.getMaxRows());
  var rango = hoja.getRange(1, 6, n, 2).getValues();
  for (var i = 0; i < rango.length; i++) {
    if (String(rango[i][0]).trim() === clave) { hoja.getRange(i + 1, 7).setValue(valor); return; }
  }
  for (var j = 0; j < rango.length; j++) {
    if (!String(rango[j][0]).trim()) { hoja.getRange(j + 1, 6, 1, 2).setValues([[clave, valor]]); return; }
  }
  hoja.getRange(n + 1, 6, 1, 2).setValues([[clave, valor]]);
}

/**
 * Tasas de cambio a COP: { USD: {tasa, esManual, sinTasa}, EUR: {...} }.
 *
 * Tres casos distintos, y hay que poder diferenciarlos: la automática sirve,
 * la automática falló pero hay manual de respaldo, o NO hay ninguna. El último
 * caso es el peligroso: con tasa 0 la cuenta valdría 0 y desaparecería del
 * patrimonio en silencio, así que se marca `sinTasa` para que la UI avise.
 */
function leerTasas_(ss) {
  var tasas = {};
  var hoja = ss.getSheetByName('Config');
  if (!hoja) return tasas;
  var filas = hoja.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) {
    var par = String(filas[i][0] || '').trim();
    if (MONEDAS_VALIDAS.indexOf(par) < 0) continue;
    var auto = numero_(filas[i][1]);   // #N/A o error llega como texto -> 0
    var manual = numero_(filas[i][2]);
    if (auto > 0) tasas[par] = { tasa: auto, esManual: false, sinTasa: false };
    else if (manual > 0) tasas[par] = { tasa: manual, esManual: true, sinTasa: false };
    else tasas[par] = { tasa: 0, esManual: false, sinTasa: true };
  }
  return tasas;
}

function leerCategorias_(ss) {
  var filas = ss.getSheetByName('Categorias').getDataRange().getValues();
  var cats = [];
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    if (!f[0]) continue;
    cats.push({
      categoria: String(f[0]),
      tipoSugerido: String(f[1] || ''),
      icono: String(f[2] || '🏷️')
    });
  }
  return cats;
}

function leerMovimientos_(ss) {
  var filas = ss.getSheetByName('Movimientos').getDataRange().getValues();
  var movs = [];
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    if (f[0] === '' || f[0] === null) continue;
    movs.push({
      id: Number(f[0]),
      fecha: fechaISO_(f[1]),
      cuenta: String(f[2] || ''),
      tipo: String(f[3] || ''),
      cuentaDestino: String(f[4] || ''),
      categoria: String(f[5] || ''),
      descripcion: String(f[6] || ''),
      valor: numero_(f[7]),
      // Solo transferencias entre monedas distintas: lo que ENTRA al destino
      valorDestino: numero_(f[8])
    });
  }
  return movs;
}

/** Presupuestos: tope de gasto mensual por categoría. Sin hoja = sin presupuestos. */
function leerPresupuestos_(ss) {
  var hoja = ss.getSheetByName('Presupuestos');
  if (!hoja) return [];
  var filas = hoja.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < filas.length; i++) {
    if (!filas[i][0]) continue;
    var tope = numero_(filas[i][1]);
    if (!(tope > 0)) continue; // un tope en cero o vacío no es un presupuesto
    lista.push({ categoria: String(filas[i][0]), tope: tope });
  }
  return lista;
}

// ---------------------------------------------------------------- Lógica de saldos

/**
 * Saldo de cada cuenta = SaldoInicial + movimientos con fecha >= FechaCorte:
 *   Ingreso suma, Gasto resta.
 *   Transferencia y Pago tarjeta: restan en Cuenta y suman en CuentaDestino
 *   (la tarjeta tiene saldo negativo, así que "sumar" reduce la deuda).
 *
 * `hastaFechaExclusiva` (opcional, 'YYYY-MM-DD'): ignora los movimientos de esa
 * fecha en adelante — sirve para saber el saldo AL EMPEZAR un día/mes.
 */
function calcularSaldos_(cuentas, movimientos, hastaFechaExclusiva) {
  var porNombre = {};
  var saldos = {};
  cuentas.forEach(function (c) {
    porNombre[c.cuenta] = c;
    saldos[c.cuenta] = c.saldoInicial;
  });

  function aplica(nombreCuenta, fecha) {
    var c = porNombre[nombreCuenta];
    return c && fecha >= c.fechaCorte; // comparación de strings 'YYYY-MM-DD'
  }

  movimientos.forEach(function (m) {
    if (hastaFechaExclusiva && m.fecha >= hastaFechaExclusiva) return;
    if (m.tipo === 'Ingreso') {
      if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] += m.valor;
    } else if (m.tipo === 'Gasto') {
      if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] -= m.valor;
    } else if (m.tipo === 'Transferencia' || m.tipo === 'Pago tarjeta') {
      if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] -= m.valor;
      // Entre monedas distintas, al destino entra valorDestino (su moneda)
      if (aplica(m.cuentaDestino, m.fecha)) {
        saldos[m.cuentaDestino] += (m.valorDestino > 0 ? m.valorDestino : m.valor);
      }
    }
  });
  return saldos;
}

/** Día siguiente de 'yyyy-MM-dd' con aritmética de texto pura (sin Date). */
function siguienteDia_(iso) {
  var y = Number(iso.substring(0, 4)), m = Number(iso.substring(5, 7)), d = Number(iso.substring(8, 10));
  var dias = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dias = 29;
  d += 1;
  if (d > dias) { d = 1; m += 1; if (m > 12) { m = 1; y += 1; } }
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

/**
 * Saldo de cada cuenta al CIERRE de cada día, desde la fecha de corte más
 * antigua hasta hoy, en UNA sola pasada. En la moneda de cada cuenta.
 *
 * Alimenta la gráfica de la vista de cuenta, la línea de patrimonio del Panel
 * y los sparklines — el cliente no puede reconstruirla porque solo recibe los
 * últimos 300 movimientos. Los días anteriores al corte de una cuenta van como
 * null: de esa época no hay datos y pintar un número sería mentir.
 * Se conservan como mucho los últimos 400 días (12M de gráfica + margen).
 */
function calcularHistoria_(cuentas, movimientos, hoy) {
  var corteMin = null;
  cuentas.forEach(function (c) { if (!corteMin || c.fechaCorte < corteMin) corteMin = c.fechaCorte; });
  if (!corteMin || corteMin > hoy) return { fechas: [], porCuenta: {} };

  var movsPorDia = {};
  movimientos.forEach(function (m) {
    (movsPorDia[m.fecha] = movsPorDia[m.fecha] || []).push(m);
  });

  var porNombre = {}, saldos = {}, porCuenta = {};
  cuentas.forEach(function (c) {
    porNombre[c.cuenta] = c;
    saldos[c.cuenta] = c.saldoInicial;
    porCuenta[c.cuenta] = [];
  });
  function aplica(n, f) { var c = porNombre[n]; return c && f >= c.fechaCorte; }

  var fechas = [];
  for (var f = corteMin; f <= hoy; f = siguienteDia_(f)) {
    (movsPorDia[f] || []).forEach(function (m) {
      if (m.tipo === 'Ingreso') {
        if (aplica(m.cuenta, f)) saldos[m.cuenta] += m.valor;
      } else if (m.tipo === 'Gasto') {
        if (aplica(m.cuenta, f)) saldos[m.cuenta] -= m.valor;
      } else if (m.tipo === 'Transferencia' || m.tipo === 'Pago tarjeta') {
        if (aplica(m.cuenta, f)) saldos[m.cuenta] -= m.valor;
        if (aplica(m.cuentaDestino, f)) {
          saldos[m.cuentaDestino] += (m.valorDestino > 0 ? m.valorDestino : m.valor);
        }
      }
    });
    fechas.push(f);
    cuentas.forEach(function (c) {
      porCuenta[c.cuenta].push(f < c.fechaCorte ? null : Math.round(saldos[c.cuenta] * 100) / 100);
    });
  }

  var MAX_DIAS = 400;
  if (fechas.length > MAX_DIAS) {
    fechas = fechas.slice(-MAX_DIAS);
    cuentas.forEach(function (c) { porCuenta[c.cuenta] = porCuenta[c.cuenta].slice(-MAX_DIAS); });
  }
  return { fechas: fechas, porCuenta: porCuenta };
}

/**
 * Últimos `n` meses como strings 'yyyy-MM' terminando en `mesFinal` (incluido).
 *
 * Aritmética de texto pura, SIN new Date(año, mes, 1): construir "1 de julio a
 * medianoche" usa la zona horaria del script (la del manifiesto), y si esa zona
 * no coincide con TZ el formateo corría todo un mes hacia atrás — así fue como
 * julio desapareció de las gráficas cuando clasp dejó el manifiesto en New York.
 */
function ultimosMeses_(mesFinal, n) {
  var y = Number(mesFinal.substring(0, 4));
  var m = Number(mesFinal.substring(5, 7));
  var meses = [];
  for (var i = n - 1; i >= 0; i--) {
    var mm = m - i, yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; } // cruce de año: 2026-01 - 3 = 2025-10
    meses.push(yy + '-' + ('0' + mm).slice(-2));
  }
  return meses;
}

/**
 * Resumen para el dashboard:
 *  - mesActual: ingresos, gastos y neto del mes en curso.
 *  - meses: últimos 12 meses, cada uno con ingresos, gastos y el desglose
 *    gastosPorCategoria — con eso el cliente arma la dona y las barras de
 *    cualquier rango (este mes / 3M / 6M / 12M) sin volver al servidor.
 * Las transferencias y pagos de tarjeta NO cuentan como ingreso ni gasto.
 * `tasaPorCuenta` convierte cada valor a COP según la moneda de su cuenta:
 * el resumen (y las gráficas que lo usan) siempre es consolidado en COP.
 */
function resumenMensual_(movimientos, tasaPorCuenta) {
  var hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  var meses = ultimosMeses_(hoy, 12);
  var porMes = {};
  meses.forEach(function (m) {
    porMes[m] = { mes: m, ingresos: 0, gastos: 0, gastosPorCategoria: {} };
  });

  movimientos.forEach(function (mv) {
    var b = porMes[mv.fecha.substring(0, 7)];
    if (!b) return;
    var tasa = (tasaPorCuenta && tasaPorCuenta[mv.cuenta] !== undefined) ? tasaPorCuenta[mv.cuenta] : 1;
    if (mv.tipo === 'Ingreso') b.ingresos += mv.valor * tasa;
    if (mv.tipo === 'Gasto') {
      b.gastos += mv.valor * tasa;
      var cat = mv.categoria || 'Sin categoría';
      b.gastosPorCategoria[cat] = (b.gastosPorCategoria[cat] || 0) + mv.valor * tasa;
    }
  });

  var actual = porMes[hoy];
  return {
    mesActual: {
      mes: hoy,
      ingresos: actual.ingresos,
      gastos: actual.gastos,
      neto: actual.ingresos - actual.gastos
    },
    meses: meses.map(function (m) { return porMes[m]; })
  };
}

// ---------------------------------------------------------------- API pública

/**
 * Un solo viaje al servidor: todo lo que la app necesita para pintarse.
 */
function getDatos() {
  var ss = abrirLibro_();

  // La hoja debe interpretar fechas en la misma zona que la app: si quedó en
  // otra (el .xlsx importado venía en GMT-7), una fecha tecleada a mano en la
  // hoja podría leerse como el día anterior. Se corrige una sola vez.
  if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);
  asegurarColumnaTipo_(ss);          // columna Activo/Deuda (solo escribe la primera vez)
  asegurarColumnaMoneda_(ss);        // columna COP/USD/EUR (idem)
  asegurarColumnaValorDestino_(ss);  // columna para transferencias entre monedas
  asegurarHojaConfig_(ss);           // hoja de tasas de cambio

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
  var hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var saldosInicioMes = calcularSaldos_(cuentas, movimientos, hoy.substring(0, 7) + '-01');
  var patrimonioInicioMes = 0;
  cuentas.forEach(function (c) { patrimonioInicioMes += saldosInicioMes[c.cuenta] * c.tasa; });

  var resumen = resumenMensual_(movimientos, tasaPorCuenta);

  // Inicio de cada mes: por cuenta en su moneda (modal de mes), total en COP.
  resumen.meses.forEach(function (m) {
    var s = calcularSaldos_(cuentas, movimientos, m.mes + '-01');
    m.inicioPorCuenta = s;
    var total = 0;
    cuentas.forEach(function (c) { total += s[c.cuenta] * c.tasa; });
    m.inicio = total;
  });

  // Saldo diario por cuenta (vista de cuenta, patrimonio y sparklines)
  var historia = calcularHistoria_(cuentas, movimientos, hoy);

  // Más recientes primero; al cliente solo van los últimos 300.
  movimientos.sort(function (a, b) {
    return a.fecha === b.fecha ? b.id - a.id : (a.fecha < b.fecha ? 1 : -1);
  });

  return {
    cuentas: cuentas,
    categorias: categorias,
    movimientos: movimientos.slice(0, 300),
    resumen: resumen,
    presupuestos: leerPresupuestos_(ss),
    patrimonio: patrimonio,
    patrimonioInicioMes: patrimonioInicioMes,
    tasas: tasas,
    monedaBase: monedaBase,   // moneda en la que se VISUALIZA todo
    catsOcultas: catsOcultas, // categorías que no se ofrecen al registrar
    historia: historia,
    hojaUrl: ss.getUrl(),   // enlace directo a la hoja (Ajustes → Datos)
    hoy: hoy
  };
}

/** Valida un movimiento antes de escribirlo. Lanza Error con mensaje claro. */
function validarMovimiento_(mov, ss) {
  if (!mov) throw new Error('No llegó ningún movimiento.');

  var cuentasObj = leerCuentas_(ss);
  var cuentas = cuentasObj.map(function (c) { return c.cuenta; });
  var categorias = leerCategorias_(ss).map(function (c) { return c.categoria; });

  if (TIPOS_VALIDOS.indexOf(mov.tipo) < 0) throw new Error('Tipo inválido: "' + mov.tipo + '".');
  if (cuentas.indexOf(mov.cuenta) < 0) throw new Error('La cuenta "' + mov.cuenta + '" no existe en la hoja Cuentas.');

  var valor = Number(mov.valor);
  if (!(valor > 0)) throw new Error('El valor debe ser un número mayor que cero.');
  mov.valor = valor;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mov.fecha))) throw new Error('La fecha debe tener formato YYYY-MM-DD.');

  var esDoble = (mov.tipo === 'Transferencia' || mov.tipo === 'Pago tarjeta');
  if (esDoble) {
    if (!mov.cuentaDestino) throw new Error('Elige la cuenta destino.');
    if (cuentas.indexOf(mov.cuentaDestino) < 0) throw new Error('La cuenta destino "' + mov.cuentaDestino + '" no existe.');
    if (mov.cuentaDestino === mov.cuenta) throw new Error('Origen y destino no pueden ser la misma cuenta.');

    // Los dos tipos "dobles" tienen destino con sentido propio:
    // pagar deuda va HACIA una deuda; transferir va entre cuentas normales.
    var origen = null, destino = null;
    cuentasObj.forEach(function (c) {
      if (c.cuenta === mov.cuenta) origen = c;
      if (c.cuenta === mov.cuentaDestino) destino = c;
    });
    if (mov.tipo === 'Pago tarjeta' && destino.tipo !== 'Deuda') {
      throw new Error('El destino de "Pagar deuda" debe ser una deuda; "' + mov.cuentaDestino + '" es una cuenta normal.');
    }
    if (mov.tipo === 'Transferencia' && destino.tipo === 'Deuda') {
      throw new Error('Para pasarle plata a "' + mov.cuentaDestino + '" usa "Pagar deuda".');
    }

    // Entre monedas distintas se necesita saber cuánto ENTRA al destino:
    // no hay tasa fija que valga (el banco cobra la suya), así que se piden
    // los dos valores. Entre monedas iguales, valorDestino sobra.
    if (origen.moneda !== destino.moneda) {
      var vd = Number(mov.valorDestino);
      if (!(vd > 0)) {
        throw new Error('"' + mov.cuenta + '" está en ' + origen.moneda + ' y "' + mov.cuentaDestino +
          '" en ' + destino.moneda + ': escribe también cuánto llega en ' + destino.moneda + '.');
      }
      mov.valorDestino = vd;
    } else {
      mov.valorDestino = '';
    }

    mov.categoria = ''; // las transferencias/pagos no llevan categoría: mueven plata, no la gastan
  } else {
    mov.cuentaDestino = '';
    mov.valorDestino = '';
    if (!mov.categoria) throw new Error('Elige una categoría.');
  }
  if (mov.categoria && categorias.indexOf(mov.categoria) < 0) {
    throw new Error('La categoría "' + mov.categoria + '" no existe en la hoja Categorias.');
  }
  return mov;
}

/** Busca el número de fila (1-based) de un ID en Movimientos, o -1. */
function filaDeId_(hoja, id) {
  var ids = hoja.getRange(2, 1, Math.max(hoja.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === Number(id)) return i + 2;
  }
  return -1;
}

/**
 * Escribe una fila nueva en Movimientos. NO toma el lock ni llama a getDatos:
 * eso lo hace quien la llama (así ajustarSaldo puede reusarla dentro de su lock).
 */
function escribirMovimiento_(ss, mov) {
  mov = validarMovimiento_(mov, ss);

  var hoja = ss.getSheetByName('Movimientos');
  var maxId = 0;
  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().forEach(function (f) {
      var n = Number(f[0]);
      if (n > maxId) maxId = n;
    });
  }
  // La fecha se agrega vacía y se escribe aparte como texto (ver escribirFechaTexto_)
  hoja.appendRow([
    maxId + 1, '', mov.cuenta, mov.tipo,
    mov.cuentaDestino, mov.categoria || '', mov.descripcion || '', mov.valor,
    mov.valorDestino || ''
  ]);
  escribirFechaTexto_(hoja.getRange(hoja.getLastRow(), 2), mov.fecha);
  return maxId + 1;
}

/** Agrega un movimiento y devuelve los datos actualizados. */
function agregarMovimiento(mov) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // evita IDs duplicados si hay dos escrituras a la vez
  try {
    var ss = abrirLibro_();
    escribirMovimiento_(ss, mov);
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/** Edita el movimiento cuyo ID coincida y devuelve los datos actualizados. */
function editarMovimiento(mov) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    mov = validarMovimiento_(mov, ss);

    var hoja = ss.getSheetByName('Movimientos');
    var fila = filaDeId_(hoja, mov.id);
    if (fila < 0) throw new Error('No encontré el movimiento con ID ' + mov.id + ' (¿lo borraron en la hoja?).');

    hoja.getRange(fila, 3, 1, 7).setValues([[
      mov.cuenta, mov.tipo,
      mov.cuentaDestino, mov.categoria || '', mov.descripcion || '', mov.valor,
      mov.valorDestino || ''
    ]]);
    escribirFechaTexto_(hoja.getRange(fila, 2), mov.fecha);
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/** Borra el movimiento por ID y devuelve los datos actualizados. */
function borrarMovimiento(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var hoja = ss.getSheetByName('Movimientos');
    var fila = filaDeId_(hoja, id);
    if (fila < 0) throw new Error('No encontré el movimiento con ID ' + id + '.');
    hoja.deleteRow(fila);
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Ajuste de saldo

var CAT_AJUSTE = 'Ajuste';

/** Crea la categoría "Ajuste" en la hoja Categorias si aún no existe. */
function asegurarCategoriaAjuste_(ss) {
  var existe = leerCategorias_(ss).some(function (c) { return c.categoria === CAT_AJUSTE; });
  if (existe) return;
  ss.getSheetByName('Categorias').appendRow([CAT_AJUSTE, '', '⚖️']);
  SpreadsheetApp.flush();
}

/**
 * Cuadra una cuenta con su saldo real del banco.
 *
 * No reescribe el SaldoInicial ni toca los movimientos viejos: agrega UNA fila
 * con la diferencia, así que da igual cuántos movimientos haya y el descuadre
 * queda visible en el historial.
 *
 * El saldo se recalcula aquí, en el servidor: el que el cliente tenga en
 * pantalla puede estar viejo y produciría un ajuste equivocado.
 */
function ajustarSaldo(cuenta, saldoReal) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();

    var cuentas = leerCuentas_(ss);
    if (!cuentas.some(function (c) { return c.cuenta === cuenta; })) {
      throw new Error('La cuenta "' + cuenta + '" no existe en la hoja Cuentas.');
    }
    var real = Number(saldoReal);
    if (isNaN(real)) throw new Error('El saldo real debe ser un número.');

    var actual = calcularSaldos_(cuentas, leerMovimientos_(ss))[cuenta];
    // Redondeado a centavos: si no, la resta de flotantes escribe en la hoja
    // cosas como 5783.899999999994.
    var diferencia = Math.round((real - actual) * 100) / 100;

    // Ya está cuadrada: no ensuciamos el historial con una fila de cero.
    if (Math.abs(diferencia) < 0.01) return getDatos();

    asegurarCategoriaAjuste_(ss);
    escribirMovimiento_(ss, {
      fecha: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
      cuenta: cuenta,
      tipo: diferencia > 0 ? 'Ingreso' : 'Gasto', // Valor siempre positivo: el signo lo da el Tipo
      cuentaDestino: '',
      categoria: CAT_AJUSTE,
      descripcion: 'Ajuste de saldo (la app calculaba ' + actual.toFixed(2) + ')',
      valor: Math.abs(diferencia)
    });
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Último día del mes ANTERIOR a `mes` ('yyyy-MM') como 'yyyy-MM-dd'.
 * Aritmética pura (tabla de días + bisiesto), sin new Date(y,m,0): construir
 * fechas con la zona del script fue lo que causó el bug de julio.
 */
function ultimoDiaMesAnterior_(mes) {
  var y = Number(mes.substring(0, 4));
  var m = Number(mes.substring(5, 7)) - 1; // mes anterior
  if (m === 0) { m = 12; y -= 1; }
  var dias = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dias = 29;
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + dias).slice(-2);
}

/**
 * Cuadra el saldo con el que una cuenta EMPEZÓ un mes.
 *
 * Mismo principio que ajustarSaldo (una sola fuente de verdad: los
 * movimientos): crea UN movimiento con la diferencia, fechado el último día
 * del mes anterior, para que el inicio de ese mes — y todo lo que viene
 * después — quede cuadrado sin tocar nada más.
 */
function ajustarInicioMes(cuenta, mes, saldoRealInicio) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new Error('Mes inválido: "' + mes + '".');

    var cuentas = leerCuentas_(ss);
    var c = null;
    cuentas.forEach(function (x) { if (x.cuenta === cuenta) c = x; });
    if (!c) throw new Error('La cuenta "' + cuenta + '" no existe en la hoja Cuentas.');

    var real = Number(saldoRealInicio);
    if (isNaN(real)) throw new Error('El saldo debe ser un número.');

    // El ajuste vive en el mes anterior; si esa fecha es previa a la fecha de
    // corte no afectaría ningún saldo (esos meses YA están dentro del saldo
    // inicial de la cuenta).
    var fechaAjuste = ultimoDiaMesAnterior_(mes);
    if (fechaAjuste < c.fechaCorte) {
      throw new Error('Los meses que empiezan antes de la fecha de corte (' + c.fechaCorte +
        ') están contenidos en el saldo inicial de ' + c.cuenta +
        '; para corregirlos usa "Cambiar saldo inicial" en la tarjeta de la cuenta.');
    }

    var movimientos = leerMovimientos_(ss);
    var inicio = calcularSaldos_(cuentas, movimientos, mes + '-01')[cuenta];
    var diferencia = Math.round((real - inicio) * 100) / 100;
    if (Math.abs(diferencia) < 0.01) return getDatos(); // ya cuadrado

    asegurarCategoriaAjuste_(ss);
    escribirMovimiento_(ss, {
      fecha: fechaAjuste,
      cuenta: cuenta,
      tipo: diferencia > 0 ? 'Ingreso' : 'Gasto',
      cuentaDestino: '',
      categoria: CAT_AJUSTE,
      descripcion: 'Ajuste inicio de ' + mes + ' (la app calculaba ' + inicio.toFixed(2) + ')',
      valor: Math.abs(diferencia)
    });
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Cuentas

/** Crea una cuenta nueva: arranca HOY con el saldo que se indique. */
function agregarCuenta(c) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var nombre = String((c && c.cuenta) || '').trim();
    if (!nombre) throw new Error('Escribe el nombre de la cuenta.');

    var existentes = leerCuentas_(ss);
    var repetida = existentes.some(function (x) {
      return x.cuenta.toLowerCase() === nombre.toLowerCase();
    });
    if (repetida) throw new Error('Ya existe una cuenta llamada "' + nombre + '".');

    var saldo = Number(c.saldoInicial);
    if (isNaN(saldo)) throw new Error('El saldo inicial debe ser un número.');
    var tipo = c.tipo === 'Deuda' ? 'Deuda' : 'Activo';
    // Una deuda se guarda en negativo aunque el usuario escriba "cuánto debe"
    if (tipo === 'Deuda' && saldo > 0) saldo = -saldo;
    var color = /^#[0-9A-Fa-f]{6}$/.test(String(c.color || '')) ? c.color : '#1A73E8';
    var moneda = MONEDAS_VALIDAS.indexOf(String(c.moneda || '').trim()) >= 0 ? String(c.moneda).trim() : 'COP';
    var hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

    // Insertar DESPUÉS de la última cuenta real: al final de la hoja hay una
    // fila de nota explicativa que no debe quedar en medio.
    var hoja = ss.getSheetByName('Cuentas');
    var filas = hoja.getDataRange().getValues();
    var ultima = 1;
    for (var i = 1; i < filas.length; i++) {
      if (filas[i][0] && (filas[i][1] || filas[i][1] === 0) && filas[i][1] !== '') ultima = i + 1;
    }
    hoja.insertRowAfter(ultima);
    hoja.getRange(ultima + 1, 1, 1, 7).setValues([[nombre, saldo, '', color, String(c.nota || ''), tipo, moneda]]);
    escribirFechaTexto_(hoja.getRange(ultima + 1, 3), hoy);
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/** Elimina una cuenta SOLO si ningún movimiento la usa (si no, rompería el historial). */
function eliminarCuenta(nombre) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var enUso = leerMovimientos_(ss).some(function (m) {
      return m.cuenta === nombre || m.cuentaDestino === nombre;
    });
    if (enUso) {
      throw new Error('"' + nombre + '" tiene movimientos en el historial y no se puede eliminar sin romper los registros.');
    }
    var hoja = ss.getSheetByName('Cuentas');
    var filas = hoja.getDataRange().getValues();
    for (var i = 1; i < filas.length; i++) {
      if (String(filas[i][0]) === String(nombre)) {
        hoja.deleteRow(i + 1);
        SpreadsheetApp.flush();
        return getDatos();
      }
    }
    throw new Error('La cuenta "' + nombre + '" no existe en la hoja Cuentas.');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Categorías

/** Crea una categoría nueva (nombre único; icono y tipo sugerido opcionales). */
function agregarCategoria(c) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var nombre = String((c && c.categoria) || '').trim();
    if (!nombre) throw new Error('Escribe el nombre de la categoría.');

    var repetida = leerCategorias_(ss).some(function (x) {
      return x.categoria.toLowerCase() === nombre.toLowerCase();
    });
    if (repetida) throw new Error('Ya existe una categoría llamada "' + nombre + '".');

    var tipo = String(c.tipoSugerido || '');
    if (tipo && TIPOS_VALIDOS.indexOf(tipo) < 0) throw new Error('Tipo sugerido inválido: "' + tipo + '".');
    var icono = String(c.icono || '').trim() || '🏷️';

    ss.getSheetByName('Categorias').appendRow([nombre, tipo, icono]);
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edita una categoría (nombre, icono y/o tipo sugerido). Si se renombra y
 * está en uso, PROPAGA el nombre nuevo a todos los movimientos: el historial
 * y las gráficas siguen cuadrando porque nunca quedan referencias viejas.
 */
function editarCategoria(nombreActual, cambios) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var hoja = ss.getSheetByName('Categorias');
    var filas = hoja.getDataRange().getValues();
    var fila = -1;
    for (var i = 1; i < filas.length; i++) {
      if (String(filas[i][0]) === String(nombreActual)) { fila = i + 1; break; }
    }
    if (fila < 0) throw new Error('La categoría "' + nombreActual + '" no existe en la hoja Categorias.');

    var nombreNuevo = String((cambios && cambios.categoria) || '').trim() || String(nombreActual);
    if (nombreNuevo.toLowerCase() !== String(nombreActual).toLowerCase()) {
      var repetida = leerCategorias_(ss).some(function (x) {
        return x.categoria.toLowerCase() === nombreNuevo.toLowerCase();
      });
      if (repetida) throw new Error('Ya existe una categoría llamada "' + nombreNuevo + '".');
    }
    var tipo = cambios.tipoSugerido !== undefined ? String(cambios.tipoSugerido || '') : String(filas[fila - 1][1] || '');
    if (tipo && TIPOS_VALIDOS.indexOf(tipo) < 0) throw new Error('Tipo sugerido inválido: "' + tipo + '".');
    var icono = cambios.icono !== undefined
      ? (String(cambios.icono).trim() || '🏷️')
      : String(filas[fila - 1][2] || '🏷️');

    hoja.getRange(fila, 1, 1, 3).setValues([[nombreNuevo, tipo, icono]]);

    // Propagar el rename a la columna Categoria de Movimientos
    if (nombreNuevo !== String(nombreActual)) {
      var hojaM = ss.getSheetByName('Movimientos');
      if (hojaM.getLastRow() > 1) {
        var rango = hojaM.getRange(2, 6, hojaM.getLastRow() - 1, 1);
        var vals = rango.getValues();
        var hubo = false;
        vals.forEach(function (f) {
          if (String(f[0]) === String(nombreActual)) { f[0] = nombreNuevo; hubo = true; }
        });
        if (hubo) rango.setValues(vals);
      }
    }
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/** Elimina una categoría SOLO si ningún movimiento la usa. */
function eliminarCategoria(nombre) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var enUso = leerMovimientos_(ss).some(function (m) { return m.categoria === nombre; });
    if (enUso) {
      throw new Error('"' + nombre + '" tiene movimientos en el historial; edítalos o bórralos antes de eliminarla.');
    }
    var hoja = ss.getSheetByName('Categorias');
    var filas = hoja.getDataRange().getValues();
    for (var i = 1; i < filas.length; i++) {
      if (String(filas[i][0]) === String(nombre)) {
        hoja.deleteRow(i + 1);
        SpreadsheetApp.flush();
        return getDatos();
      }
    }
    throw new Error('La categoría "' + nombre + '" no existe en la hoja Categorias.');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Presupuestos

/**
 * Fija o quita el tope de gasto mensual de una categoría.
 * `tope` <= 0 (o no numérico) = quitar el presupuesto. La hoja Presupuestos
 * se crea sola la primera vez, así que las hojas existentes no se tocan.
 */
function guardarPresupuesto(categoria, tope) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var cats = leerCategorias_(ss).map(function (c) { return c.categoria; });
    if (cats.indexOf(String(categoria)) < 0) {
      throw new Error('La categoría "' + categoria + '" no existe en la hoja Categorias.');
    }
    var t = Number(tope);
    if (isNaN(t)) t = 0;

    var hoja = ss.getSheetByName('Presupuestos');
    if (!hoja) {
      hoja = ss.insertSheet('Presupuestos');
      hoja.getRange(1, 1, 1, 2).setValues([['Categoria', 'TopeMensual']]);
    }
    var filas = hoja.getDataRange().getValues();
    var fila = -1;
    for (var i = 1; i < filas.length; i++) {
      if (String(filas[i][0]) === String(categoria)) { fila = i + 1; break; }
    }
    if (!(t > 0)) {
      if (fila > 0) hoja.deleteRow(fila); // quitar (si nunca existió, no hay nada que hacer)
    } else if (fila > 0) {
      hoja.getRange(fila, 2).setValue(t);
    } else {
      hoja.appendRow([String(categoria), t]);
    }
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Config (Ajustes)

/**
 * Fija la moneda base (en la que se VISUALIZA todo). Solo escribe Config!F/G.
 * Si no es COP, exige que exista una tasa para poder convertir.
 */
function guardarMonedaBase(codigo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    asegurarHojaConfig_(ss);
    codigo = String(codigo || '').trim().toUpperCase();
    if (MONEDAS_VALIDAS.indexOf(codigo) < 0) throw new Error('Moneda no válida: ' + codigo);
    if (codigo !== 'COP') {
      var t = leerTasas_(ss)[codigo];
      if (!t || t.sinTasa || !(t.tasa > 0)) {
        throw new Error('No hay tasa para ' + codigo + ': pon una tasa manual antes de usarla como base.');
      }
    }
    escribirConfigClave_(ss.getSheetByName('Config'), 'MonedaBase', codigo);
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/** Actualiza la tasa MANUAL de una moneda (columna C de su fila en Config). */
function guardarTasaManual(par, valor) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    asegurarHojaConfig_(ss);
    par = String(par || '').trim().toUpperCase();
    if (MONEDAS_VALIDAS.indexOf(par) < 0 || par === 'COP') throw new Error('Par no válido: ' + par);
    var v = numero_(valor);
    if (!(v > 0)) throw new Error('La tasa manual debe ser un número mayor que cero.');
    var hoja = ss.getSheetByName('Config');
    var filas = hoja.getDataRange().getValues();
    for (var i = 1; i < filas.length; i++) {
      if (String(filas[i][0]).trim().toUpperCase() === par) {
        hoja.getRange(i + 1, 3).setValue(v); // columna C = TasaManual
        SpreadsheetApp.flush();
        return getDatos();
      }
    }
    throw new Error('No encontré la fila de ' + par + ' en Config.');
  } finally {
    lock.releaseLock();
  }
}

/** Guarda la lista de categorías ocultas (no se ofrecen al registrar). */
function guardarCatsOcultas(lista) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    asegurarHojaConfig_(ss);
    var arr = (lista && lista.length !== undefined && typeof lista !== 'string')
      ? lista : String(lista || '').split('|');
    var limpio = [];
    for (var i = 0; i < arr.length; i++) {
      var s = String(arr[i]).trim();
      if (s && limpio.indexOf(s) < 0) limpio.push(s);
    }
    escribirConfigClave_(ss.getSheetByName('Config'), 'CatsOcultas', limpio.join('|'));
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edita una cuenta: nombre, saldo inicial, color, nota y/o tipo.
 *
 * - Cambiar el SaldoInicial NO crea movimientos: reescribe el ancla de la
 *   FechaCorte y el saldo actual se recalcula solo (puede ser negativo).
 * - Renombrar PROPAGA el nombre nuevo a los movimientos (columnas Cuenta y
 *   CuentaDestino): el historial y los saldos quedan intactos.
 * Acepta también el formato viejo editarCuenta(nombre, numero) por si acaso.
 */
function editarCuenta(nombreActual, cambios) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    if (typeof cambios !== 'object' || cambios === null) cambios = { saldoInicial: cambios };

    var hoja = ss.getSheetByName('Cuentas');
    var filas = hoja.getDataRange().getValues();
    var fila = -1;
    for (var i = 1; i < filas.length; i++) {
      if (String(filas[i][0]) === String(nombreActual)) { fila = i + 1; break; }
    }
    if (fila < 0) throw new Error('La cuenta "' + nombreActual + '" no existe en la hoja Cuentas.');
    var actual = filas[fila - 1];

    var nombreNuevo = String(cambios.nombre || '').trim() || String(nombreActual);
    if (nombreNuevo.toLowerCase() !== String(nombreActual).toLowerCase()) {
      var repetida = leerCuentas_(ss).some(function (x) {
        return x.cuenta.toLowerCase() === nombreNuevo.toLowerCase();
      });
      if (repetida) throw new Error('Ya existe una cuenta llamada "' + nombreNuevo + '".');
    }
    var saldo = actual[1];
    if (cambios.saldoInicial !== undefined) {
      saldo = Number(cambios.saldoInicial);
      if (isNaN(saldo)) throw new Error('El saldo inicial debe ser un número.');
    }
    var color = cambios.color !== undefined
      ? (/^#[0-9A-Fa-f]{6}$/.test(String(cambios.color)) ? cambios.color : String(actual[3] || '#1A73E8'))
      : actual[3];
    var nota = cambios.nota !== undefined ? String(cambios.nota) : actual[4];
    var tipo = cambios.tipo !== undefined
      ? (cambios.tipo === 'Deuda' ? 'Deuda' : 'Activo')
      : (actual[5] || (numero_(actual[1]) < 0 ? 'Deuda' : 'Activo'));
    var moneda = cambios.moneda !== undefined
      ? (MONEDAS_VALIDAS.indexOf(String(cambios.moneda).trim()) >= 0 ? String(cambios.moneda).trim() : 'COP')
      : (String(actual[6] || '').trim() || 'COP');

    hoja.getRange(fila, 1).setValue(nombreNuevo);
    hoja.getRange(fila, 2).setValue(saldo);
    hoja.getRange(fila, 4, 1, 4).setValues([[color, nota, tipo, moneda]]);

    // Propagar el rename a Movimientos (columnas C = Cuenta, E = CuentaDestino)
    if (nombreNuevo !== String(nombreActual)) {
      var hojaM = ss.getSheetByName('Movimientos');
      if (hojaM.getLastRow() > 1) {
        var rango = hojaM.getRange(2, 3, hojaM.getLastRow() - 1, 3); // C, D, E
        var vals = rango.getValues();
        var hubo = false;
        vals.forEach(function (f) {
          if (String(f[0]) === String(nombreActual)) { f[0] = nombreNuevo; hubo = true; }
          if (String(f[2]) === String(nombreActual)) { f[2] = nombreNuevo; hubo = true; }
        });
        if (hubo) rango.setValues(vals);
      }
    }
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reordena las cuentas de la hoja según la lista de nombres recibida.
 * Reescribe los datos en las MISMAS filas que ya ocupan las cuentas
 * (no toca la fila de nota del final ni nada más).
 */
function reordenarCuentas(nombresEnOrden) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var hoja = ss.getSheetByName('Cuentas');
    var filas = hoja.getDataRange().getValues();

    var posiciones = [], datosPorNombre = {};
    for (var i = 1; i < filas.length; i++) {
      var f = filas[i];
      if (!f[0]) continue;
      if (!f[1] && f[1] !== 0) continue;
      posiciones.push(i + 1);
      var copia = f.slice(0, 7); // hasta la columna Moneda
      while (copia.length < 7) copia.push('');
      datosPorNombre[String(f[0])] = copia;
    }

    if (!nombresEnOrden || nombresEnOrden.length !== posiciones.length ||
        !nombresEnOrden.every(function (n) { return datosPorNombre[n]; })) {
      throw new Error('La lista de orden no coincide con las cuentas de la hoja; refresca e intenta de nuevo.');
    }

    nombresEnOrden.forEach(function (n, k) {
      hoja.getRange(posiciones[k], 1, 1, 7).setValues([datosPorNombre[n]]);
    });
    SpreadsheetApp.flush();
    return getDatos();
  } finally {
    lock.releaseLock();
  }
}
