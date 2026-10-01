/**
 * Finanzas App — Hojas Categorias y Presupuestos.
 *
 * Van juntas porque el presupuesto cuelga del nombre de la categoría: al
 * renombrarla o borrarla hay que arrastrar el cambio a Presupuestos y a las
 * categorías ocultas de Config, o quedan referencias huérfanas (ver
 * propagarCategoria_).
 */

/** Crea una categoría nueva (nombre único; icono y tipo sugerido opcionales). */
function agregarCategoria(c) {
  var lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var nombre = textoLimitado_(c && c.categoria, 60, 'El nombre de la categoría');
    if (!nombre) throw new Error('Escribe el nombre de la categoría.');

    var repetida = leerCategorias_(ss).some(function (x) {
      return x.categoria.toLowerCase() === nombre.toLowerCase();
    });
    if (repetida) throw new Error('Ya existe una categoría llamada "' + nombre + '".');

    var tipo = String(c.tipoSugerido || '');
    if (tipo && TIPOS_VALIDOS.indexOf(tipo) < 0) throw new Error('Tipo sugerido inválido: "' + tipo + '".');
    // 'i:clave' (icono del catálogo, v12) o un emoji
    var icono = textoLimitado_(c.icono, 24, 'El icono') || 'i:otros';

    var hojaCat = ss.getSheetByName('Categorias');
    escribirTextoPlano_(hojaCat.getRange(hojaCat.getLastRow() + 1, 1, 1, 3), [[nombre, tipo, icono]]);
    SpreadsheetApp.flush();
    return getDatos(true);
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
  var lock = LockService.getUserLock();
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
      ? (textoLimitado_(cambios.icono, 24, 'El icono') || 'i:otros')
      : String(filas[fila - 1][2] || '🏷️');

    escribirTextoPlano_(hoja.getRange(fila, 1, 1, 3), [[nombreNuevo, tipo, icono]]);

    // Propagar el rename a TODO lo que referencia la categoría por nombre:
    // la columna Categoria de Movimientos, su presupuesto y la lista de ocultas.
    if (nombreNuevo !== String(nombreActual)) {
      var hojaM = ss.getSheetByName('Movimientos');
      if (hojaM.getLastRow() > 1) {
        var rango = hojaM.getRange(2, 6, hojaM.getLastRow() - 1, 1);
        var vals = rango.getValues();
        var hubo = false;
        vals.forEach(function (f) {
          if (String(f[0]) === String(nombreActual)) { f[0] = nombreNuevo; hubo = true; }
        });
        if (hubo) escribirTextoPlano_(rango, vals);
      }
      propagarCategoria_(ss, nombreActual, nombreNuevo);
    }
    SpreadsheetApp.flush();
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}

/** Elimina una categoría SOLO si ningún movimiento la usa. */
function eliminarCategoria(nombre) {
  var lock = LockService.getUserLock();
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
        // Sin esto quedarían un presupuesto y una entrada en CatsOcultas
        // apuntando a una categoría que ya no existe.
        propagarCategoria_(ss, nombre, null);
        SpreadsheetApp.flush();
        return getDatos(true);
      }
    }
    throw new Error('La categoría "' + nombre + '" no existe en la hoja Categorias.');
  } finally {
    lock.releaseLock();
  }
}


// ------------------------------------------------ Presupuestos
// El tope mensual cuelga del NOMBRE de la categoría, por eso vive en este mismo
// archivo: renombrar o borrar una categoría tiene que arrastrarlo (propagarCategoria_).

/** La hoja Presupuestos, creándola con su encabezado si aún no existe. */
function hojaPresupuestos_(ss) {
  var hoja = ss.getSheetByName('Presupuestos');
  if (!hoja) {
    hoja = ss.insertSheet('Presupuestos');
    hoja.getRange(1, 1, 1, 2).setValues([['Categoria', 'TopeMensual']]);
  }
  return hoja;
}

/** Fila (1-based) del presupuesto de una categoría, o -1 si no tiene. */
function filaDePresupuesto_(hoja, categoria) {
  var filas = hoja.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) {
    if (String(filas[i][0]) === String(categoria)) return i + 1;
  }
  return -1;
}

/**
 * Referencias a una categoría FUERA de la hoja Categorias: su presupuesto y la
 * lista de ocultas (Config!CatsOcultas). Renombrar o eliminar una categoría debe
 * arrastrarlas, igual que ya se hace con la columna Categoria de Movimientos:
 * la regla del proyecto es no dejar nunca referencias viejas.
 *
 * `nombreNuevo` vacío o null = eliminar la referencia.
 */
function propagarCategoria_(ss, nombreViejo, nombreNuevo) {
  if (String(nombreViejo) === String(nombreNuevo)) return;

  // 1) Presupuestos
  var hoja = ss.getSheetByName('Presupuestos');
  if (hoja) {
    var fila = filaDePresupuesto_(hoja, nombreViejo);
    if (fila > 0) {
      if (nombreNuevo) escribirTextoPlano_(hoja.getRange(fila, 1), [[String(nombreNuevo)]]);
      else hoja.deleteRow(fila);
    }
  }

  // 2) Config!CatsOcultas (lista separada por '|')
  var claves = leerConfigClaves_(ss);
  if (!('CatsOcultas' in claves)) return;
  var lista = String(claves.CatsOcultas || '').split('|')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
  var i = lista.indexOf(String(nombreViejo));
  if (i < 0) return;
  if (nombreNuevo) lista[i] = String(nombreNuevo);
  else lista.splice(i, 1);
  escribirConfigClave_(ss.getSheetByName('Config'), 'CatsOcultas', lista.join('|'));
}

/**
 * Fija o quita el tope de gasto mensual de una categoría.
 * `tope` <= 0 (o no numérico) = quitar el presupuesto. La hoja Presupuestos
 * se crea sola la primera vez, así que las hojas existentes no se tocan.
 */
function guardarPresupuesto(categoria, tope) {
  var lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    var ss = abrirLibro_();
    var t = Number(tope);
    if (isNaN(t)) t = 0;

    // Crear o cambiar un tope exige que la categoría exista; QUITARLO no, para
    // poder limpiar presupuestos huérfanos que quedaron de un rename viejo.
    if (t > 0) {
      var cats = leerCategorias_(ss).map(function (c) { return c.categoria; });
      if (cats.indexOf(String(categoria)) < 0) {
        throw new Error('La categoría "' + categoria + '" no existe en la hoja Categorias.');
      }
    }

    var hoja = hojaPresupuestos_(ss);
    var fila = filaDePresupuesto_(hoja, categoria);
    if (!(t > 0)) {
      if (fila > 0) hoja.deleteRow(fila); // quitar (si nunca existió, no hay nada que hacer)
    } else if (fila > 0) {
      hoja.getRange(fila, 2).setValue(t);
    } else {
      escribirTextoPlano_(hoja.getRange(hoja.getLastRow() + 1, 1), [[String(categoria)]]);
      hoja.getRange(hoja.getLastRow(), 2).setValue(t);
    }
    SpreadsheetApp.flush();
    return getDatos(true);
  } finally {
    lock.releaseLock();
  }
}

