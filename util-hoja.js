/**
 * Finanzas App — Utilidades de hoja.
 *
 * Lo transversal que usan todos los demás archivos: convertir celdas a fecha,
 * texto o número; escribir dejando el formato en texto plano (evita que Sheets
 * interprete "=1+1" como fórmula); localizar filas; y las columnas que la app
 * se autocrea cuando faltan. Nada de aquí sabe de saldos ni de la app.
 */

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

/**
 * Escribe TEXTO en un rango dejando la(s) celda(s) en formato texto ('@').
 *
 * Sin esto, Sheets interpreta como FÓRMULA cualquier valor que empiece por '='
 * (y por '+', '-', '@' en algunos casos): una descripción "=1+1" se guardaría
 * como 2, y un "=IMPORTXML(...)" podría sacar datos de la hoja hacia afuera
 * (inyección de fórmulas). Con el formato '@' puesto ANTES del valor, el texto
 * queda literal. Mismo patrón que escribirFechaTexto_.
 *
 * `valores` es una matriz [[...]] del tamaño del rango; los números se dejan
 * pasar tal cual (solo se fuerza formato texto en las celdas que traen string).
 */
function escribirTextoPlano_(rango, valores) {
  var filas = rango.getNumRows(), cols = rango.getNumColumns();
  for (var i = 0; i < filas; i++) {
    for (var j = 0; j < cols; j++) {
      if (typeof valores[i][j] === 'string' && valores[i][j] !== '') {
        rango.getCell(i + 1, j + 1).setNumberFormat('@');
      }
    }
  }
  rango.setValues(valores);
}

/** Recorta un texto libre a `max` caracteres (un pegado accidental no ensucia la hoja). */
function textoLimitado_(v, max, campo) {
  var s = String(v == null ? '' : v).trim();
  if (s.length > max) {
    throw new Error(campo + ' es muy largo (máximo ' + max + ' caracteres, llegaron ' + s.length + ').');
  }
  return s;
}

/**
 * Convierte una celda numérica (o texto con formato colombiano) a Number.
 *
 * Con coma, la coma es el decimal y los puntos son miles ("1.234,56" -> 1234.56).
 * Sin coma hay ambigüedad: "44.404" puede ser cuarenta y cuatro mil (punto de
 * miles) o 44,404. Se resuelve por el patrón de grupos de tres, la misma regla
 * que usa parsearMonto en el cliente — sin esto, un saldo tecleado a mano en la
 * hoja como "1.906.560" se leía como 1,906 y destrozaba el saldo de la cuenta.
 */
function numero_(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '0').trim().replace(/\$|\s/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56 -> 1234.56
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.906.560 -> 1906560
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}


/**
 * Garantiza la columna F "Tipo" en la hoja Cuentas (Activo | Deuda).
 * La primera vez clasifica las cuentas existentes por el signo de su
 * SaldoInicial: Tarjeta Nu (negativa) queda como Deuda.
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
 * Garantiza la columna J "UID" en Movimientos.
 *
 * La usa la cola de pendientes del cliente: cada registro creado sin conexión
 * lleva un identificador propio, y al reintentar el servidor puede reconocer
 * "este ya lo escribí" en vez de crear un duplicado. Las filas viejas quedan
 * con la celda vacía, que es justo lo correcto (nunca se reintentan).
 */
function asegurarColumnaUid_(ss) {
  var hoja = ss.getSheetByName('Movimientos');
  if (String(hoja.getRange(1, 10).getValue()) === 'UID') return;
  hoja.getRange(1, 10).setValue('UID');
  SpreadsheetApp.flush();
}

/** Fila (1-based) del movimiento con ese UID, o -1. '' nunca coincide. */
function filaDeUid_(hoja, uid) {
  if (!uid) return -1;
  if (hoja.getLastRow() < 2) return -1;
  var vals = hoja.getRange(2, 10, hoja.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(uid)) return i + 2;
  }
  return -1;
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

/** Busca el número de fila (1-based) de un ID en Movimientos, o -1. */
function filaDeId_(hoja, id) {
  var ids = hoja.getRange(2, 1, Math.max(hoja.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (Number(ids[i][0]) === Number(id)) return i + 2;
  }
  return -1;
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
