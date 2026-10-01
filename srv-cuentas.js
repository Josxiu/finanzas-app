/**
 * Finanzas App — Hoja Cuentas.
 *
 * Alta, edición, borrado y orden. Regla del proyecto: renombrar una cuenta
 * PROPAGA el nombre nuevo a todo el historial, y una cuenta con movimientos no
 * se puede borrar.
 */

/** Crea una cuenta nueva: arranca HOY con el saldo que se indique. */
function agregarCuenta(c) {
  var lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var nombre = textoLimitado_(c && c.cuenta, 60, 'El nombre de la cuenta');
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
    // Nombre y nota como texto plano: un "=" al inicio no debe volverse fórmula
    escribirTextoPlano_(hoja.getRange(ultima + 1, 1), [[nombre]]);
    hoja.getRange(ultima + 1, 2).setValue(saldo);
    escribirTextoPlano_(hoja.getRange(ultima + 1, 4, 1, 4),
      [[color, textoLimitado_(c.nota, 120, 'La nota'), tipo, moneda]]);
    escribirFechaTexto_(hoja.getRange(ultima + 1, 3), hoy);
    SpreadsheetApp.flush();
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}

/** Elimina una cuenta SOLO si ningún movimiento la usa (si no, rompería el historial). */
function eliminarCuenta(nombre) {
  var lock = LockService.getUserLock();
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
        return getDatos(true);
      }
    }
    throw new Error('La cuenta "' + nombre + '" no existe en la hoja Cuentas.');
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
  var lock = LockService.getUserLock();
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
    var nota = cambios.nota !== undefined ? textoLimitado_(cambios.nota, 120, 'La nota') : actual[4];
    var tipo = cambios.tipo !== undefined
      ? (cambios.tipo === 'Deuda' ? 'Deuda' : 'Activo')
      : (actual[5] || (numero_(actual[1]) < 0 ? 'Deuda' : 'Activo'));
    var moneda = cambios.moneda !== undefined
      ? (MONEDAS_VALIDAS.indexOf(String(cambios.moneda).trim()) >= 0 ? String(cambios.moneda).trim() : 'COP')
      : (String(actual[6] || '').trim() || 'COP');

    escribirTextoPlano_(hoja.getRange(fila, 1), [[nombreNuevo]]);
    hoja.getRange(fila, 2).setValue(saldo);
    escribirTextoPlano_(hoja.getRange(fila, 4, 1, 4), [[color, nota, tipo, moneda]]);

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
        if (hubo) escribirTextoPlano_(rango, vals);
      }
    }
    SpreadsheetApp.flush();
    return getDatos(true);
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
  var lock = LockService.getUserLock();
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
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}
