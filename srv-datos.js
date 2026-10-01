/**
 * Finanzas App — Lectura de las hojas.
 *
 * Convierte cada hoja en objetos planos para el resto del backend. Solo LEE:
 * ninguna función de aquí escribe en el libro.
 */

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
      // Se normaliza a hex al leer: el color se usa en innerHTML (sparkline) y
      // en setProperty; un valor tecleado a mano en la hoja no debe inyectar.
      color: /^#[0-9A-Fa-f]{6}$/.test(String(f[3] || '').trim()) ? String(f[3]).trim() : '#1A73E8',
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


/**
 * Trae un tramo más del historial (el botón "Cargar más").
 *
 * Devuelve SOLO los movimientos pedidos, no todo el estado: así traer páginas
 * viejas es barato. El orden es el mismo de getDatos (recientes primero).
 */
function getMasMovimientos(desde, cuantos) {
  var ss = abrirLibro_();
  var movimientos = leerMovimientos_(ss);
  movimientos.sort(function (a, b) {
    return a.fecha === b.fecha ? b.id - a.id : (a.fecha < b.fecha ? 1 : -1);
  });
  var ini = Math.max(0, Number(desde) || 0);
  var n = Math.min(Number(cuantos) || PAGINA_MOVIMIENTOS, 500); // techo por si acaso
  return {
    movimientos: movimientos.slice(ini, ini + n),
    total: movimientos.length
  };
}
