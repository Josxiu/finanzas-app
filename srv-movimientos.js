/**
 * Finanzas App — Todo lo que escribe en la hoja Movimientos.
 *
 * Alta, edición y borrado de movimientos; los ajustes de saldo (cuadrar una
 * cuenta o el inicio de un mes), que también son movimientos; y los recurrentes,
 * que son movimientos que se crean solos una vez al mes.
 */

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

  mov.descripcion = textoLimitado_(mov.descripcion, 200, 'La descripción');

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
  // Fila nueva al final. Las columnas de texto se escriben con formato '@'
  // (escribirTextoPlano_) para que una descripción tipo "=1+1" quede literal y
  // no se convierta en fórmula. La fecha va aparte, con su propio helper.
  var fila = hoja.getLastRow() + 1;
  hoja.getRange(fila, 1).setValue(maxId + 1);
  escribirFechaTexto_(hoja.getRange(fila, 2), mov.fecha);
  escribirTextoPlano_(hoja.getRange(fila, 3, 1, 5), [[
    mov.cuenta, mov.tipo, mov.cuentaDestino, mov.categoria || '', mov.descripcion || ''
  ]]);
  hoja.getRange(fila, 8, 1, 2).setValues([[mov.valor, mov.valorDestino || '']]);
  // UID de la cola de pendientes (vacío si el movimiento se creó con conexión)
  if (mov.uid) escribirTextoPlano_(hoja.getRange(fila, 10), [[String(mov.uid)]]);
  return maxId + 1;
}

/**
 * Agrega un movimiento y devuelve los datos actualizados.
 *
 * IDEMPOTENTE si el movimiento trae `uid`: cuando la cola de pendientes
 * reintenta algo que en realidad SÍ había llegado (típico con señal mala: el
 * servidor escribe pero la respuesta se pierde), el uid ya está en la hoja y se
 * devuelve el estado tal cual en vez de duplicar el gasto.
 */
function agregarMovimiento(mov) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // evita IDs duplicados si hay dos escrituras a la vez
  try {
    var ss = abrirLibro_();
    if (mov && mov.uid) {
      asegurarColumnaUid_(ss);
      if (filaDeUid_(ss.getSheetByName('Movimientos'), mov.uid) > 0) {
        return getDatos(true); // ya estaba: no se escribe nada
      }
    }
    escribirMovimiento_(ss, mov);
    SpreadsheetApp.flush();
    return getDatos(true);
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

    // Texto con formato '@' (sin fórmulas) y números aparte, como al crear
    escribirTextoPlano_(hoja.getRange(fila, 3, 1, 5), [[
      mov.cuenta, mov.tipo, mov.cuentaDestino, mov.categoria || '', mov.descripcion || ''
    ]]);
    hoja.getRange(fila, 8, 1, 2).setValues([[mov.valor, mov.valorDestino || '']]);
    escribirFechaTexto_(hoja.getRange(fila, 2), mov.fecha);
    SpreadsheetApp.flush();
    return getDatos(true);
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
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}


// ------------------------------------------------ Ajustes de saldo
// Cuadrar una cuenta (o el inicio de un mes) no guarda un saldo nuevo: crea UN
// movimiento con la diferencia. Una sola fuente de verdad, y el descuadre queda
// visible en el historial.

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
    if (Math.abs(diferencia) < 0.01) return getDatos(true);

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
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
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
    if (Math.abs(diferencia) < 0.01) return getDatos(true); // ya cuadrado

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
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}


// ------------------------------------------------ Recurrentes
// Movimientos que se crean solos una vez al mes. Viven aquí, y no en la
// configuración, porque lo que hacen es escribir en la hoja Movimientos
// (generarRecurrentes_ llama a escribirMovimiento_).

/**
 * Hoja `Recurrentes`: lo que se repite todos los meses (arriendo, gym,
 * suscripciones). Se crea sola la primera vez.
 *   Id | Activo | Dia | Tipo | Cuenta | CuentaDestino | Categoria | Descripcion | Valor | UltimoMesGenerado
 */
function hojaRecurrentes_(ss) {
  var hoja = ss.getSheetByName('Recurrentes');
  if (!hoja) {
    hoja = ss.insertSheet('Recurrentes');
    hoja.getRange(1, 1, 1, 10).setValues([[
      'Id', 'Activo', 'Dia', 'Tipo', 'Cuenta', 'CuentaDestino',
      'Categoria', 'Descripcion', 'Valor', 'UltimoMesGenerado'
    ]]);
    SpreadsheetApp.flush();
  }
  return hoja;
}

function leerRecurrentes_(ss) {
  var hoja = ss.getSheetByName('Recurrentes');
  if (!hoja) return [];
  var filas = hoja.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < filas.length; i++) {
    var f = filas[i];
    if (!f[0] && f[0] !== 0) continue;
    lista.push({
      id: Number(f[0]),
      activo: String(f[1]).toLowerCase() !== 'no',
      dia: Math.min(28, Math.max(1, Number(f[2]) || 1)), // 28 = existe en todos los meses
      tipo: String(f[3] || 'Gasto'),
      cuenta: String(f[4] || ''),
      cuentaDestino: String(f[5] || ''),
      categoria: String(f[6] || ''),
      descripcion: String(f[7] || ''),
      valor: numero_(f[8]),
      ultimoMes: String(f[9] || '')
    });
  }
  return lista;
}

/**
 * Crea los movimientos de los recurrentes que ya tocan este mes.
 *
 * Es IDEMPOTENTE por mes: cada recurrente guarda el último mes en el que se
 * generó, así que abrir la app diez veces el mismo día no crea diez gastos.
 * Solo mira el mes en curso: no rellena meses viejos hacia atrás (si estuviste
 * sin abrir la app dos meses, no te inventa movimientos que quizá no ocurrieron).
 * Devuelve cuántos creó.
 */
function generarRecurrentes_(ss, hoy) {
  var recurrentes = leerRecurrentes_(ss);
  if (!recurrentes.length) return 0;

  var mesHoy = hoy.substring(0, 7);
  var diaHoy = Number(hoy.substring(8, 10));
  var hoja = hojaRecurrentes_(ss);
  var creados = 0;

  recurrentes.forEach(function (r, idx) {
    if (!r.activo || r.ultimoMes === mesHoy) return;
    if (diaHoy < r.dia) return;              // todavía no le toca este mes
    if (!(r.valor > 0) || !r.cuenta) return; // fila incompleta: se ignora

    try {
      escribirMovimiento_(ss, {
        fecha: mesHoy + '-' + ('0' + r.dia).slice(-2),
        cuenta: r.cuenta,
        tipo: r.tipo,
        cuentaDestino: r.cuentaDestino,
        categoria: r.categoria,
        descripcion: r.descripcion,
        valor: r.valor,
        valorDestino: ''
      });
      creados++;
      // Marcar el mes ANTES de seguir: si algo falla luego, no se duplica
      hoja.getRange(idx + 2, 10).setValue(mesHoy);
    } catch (e) {
      // Un recurrente mal configurado (cuenta borrada, categoría que ya no
      // existe...) no puede tumbar la carga de la app: se salta y se marca
      // el mes para no reintentarlo en bucle cada vez que se abre.
      hoja.getRange(idx + 2, 10).setValue(mesHoy);
    }
  });
  if (creados) SpreadsheetApp.flush();
  return creados;
}

/** Crea o actualiza un recurrente. `r.id` vacío = nuevo. */
function guardarRecurrente(r) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var hoja = hojaRecurrentes_(ss);

    if (TIPOS_VALIDOS.indexOf(r.tipo) < 0) throw new Error('Tipo inválido: "' + r.tipo + '".');
    var cuentas = leerCuentas_(ss).map(function (c) { return c.cuenta; });
    if (cuentas.indexOf(r.cuenta) < 0) throw new Error('La cuenta "' + r.cuenta + '" no existe.');
    var valor = Number(r.valor);
    if (!(valor > 0)) throw new Error('El valor debe ser mayor que cero.');
    var dia = Math.min(28, Math.max(1, Number(r.dia) || 1));
    var desc = textoLimitado_(r.descripcion, 200, 'La descripción');
    var esDoble = (r.tipo === 'Transferencia' || r.tipo === 'Pago tarjeta');
    if (esDoble && cuentas.indexOf(r.cuentaDestino) < 0) {
      throw new Error('La cuenta destino "' + r.cuentaDestino + '" no existe.');
    }

    var filas = hoja.getDataRange().getValues();
    var fila = -1, maxId = 0;
    for (var i = 1; i < filas.length; i++) {
      var id = Number(filas[i][0]);
      if (id > maxId) maxId = id;
      if (r.id && id === Number(r.id)) fila = i + 1;
    }
    var idFinal = r.id ? Number(r.id) : maxId + 1;
    // Al editar se conserva el mes ya generado (si no, se duplicaría el gasto)
    var ultimoMes = fila > 0 ? String(filas[fila - 1][9] || '') : '';
    if (fila < 0) fila = hoja.getLastRow() + 1;

    hoja.getRange(fila, 1).setValue(idFinal);
    escribirTextoPlano_(hoja.getRange(fila, 2, 1, 7), [[
      r.activo === false ? 'No' : 'Si', String(dia), r.tipo, r.cuenta,
      esDoble ? r.cuentaDestino : '', esDoble ? '' : (r.categoria || ''), desc
    ]]);
    hoja.getRange(fila, 9).setValue(valor);
    escribirTextoPlano_(hoja.getRange(fila, 10), [[ultimoMes]]);
    SpreadsheetApp.flush();
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}

/** Elimina un recurrente por id (los movimientos ya creados no se tocan). */
function eliminarRecurrente(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var hoja = hojaRecurrentes_(ss);
    var filas = hoja.getDataRange().getValues();
    for (var i = 1; i < filas.length; i++) {
      if (Number(filas[i][0]) === Number(id)) {
        hoja.deleteRow(i + 1);
        SpreadsheetApp.flush();
        return getDatos(true);
      }
    }
    throw new Error('No encontré ese movimiento recurrente.');
  } finally {
    lock.releaseLock();
  }
}

