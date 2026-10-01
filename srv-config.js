/**
 * Finanzas App — Hoja Config.
 *
 * Dos zonas en la misma hoja:
 *   A-D  tasas de cambio   Par | TasaAuto (GOOGLEFINANCE) | TasaManual | Nota
 *   F-G  clave-valor       MonedaBase | CatsOcultas
 * Todo lo de aquí es idempotente: agrega lo que falte sin pisar lo que ya haya.
 */

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

/**
 * Fija la moneda base (en la que se VISUALIZA todo). Solo escribe Config!F/G.
 * Si no es COP, exige que exista una tasa para poder convertir.
 */
function guardarMonedaBase(codigo) {
  var lock = LockService.getUserLock();
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
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}

/** Actualiza la tasa MANUAL de una moneda (columna C de su fila en Config). */
function guardarTasaManual(par, valor) {
  var lock = LockService.getUserLock();
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
        return getDatos(true);
      }
    }
    throw new Error('No encontré la fila de ' + par + ' en Config.');
  } finally {
    lock.releaseLock();
  }
}

/** Guarda la lista de categorías ocultas (no se ofrecen al registrar). */
function guardarCatsOcultas(lista) {
  var lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    asegurarHojaConfig_(ss);
    var arr = (lista && lista.length !== undefined && typeof lista !== 'string')
      ? lista : String(lista || '').split('|');
    // Solo se guardan categorías que existen: así la lista no acumula nombres
    // fantasma de categorías renombradas o eliminadas.
    var existentes = leerCategorias_(ss).map(function (c) { return c.categoria; });
    var limpio = [];
    for (var i = 0; i < arr.length; i++) {
      var s = String(arr[i]).trim();
      if (s && existentes.indexOf(s) >= 0 && limpio.indexOf(s) < 0) limpio.push(s);
    }
    escribirConfigClave_(ss.getSheetByName('Config'), 'CatsOcultas', limpio.join('|'));
    SpreadsheetApp.flush();
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}
