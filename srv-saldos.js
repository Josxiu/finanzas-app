/**
 * Finanzas App — La aritmética.
 *
 * El corazón de la app: saldo por cuenta, con cuánto empezó cada mes, la
 * historia diaria y el resumen mensual. Son funciones PURAS (reciben cuentas y
 * movimientos, devuelven números), y por eso son las que cubren los tests de
 * preview/test_logica.js. Si algo de aquí se rompe, los saldos salen mal.
 */

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

/**
 * Saldo de cada cuenta al INICIO de cada mes pedido, en UNA sola pasada.
 *
 * Reemplaza a llamar calcularSaldos_ una vez por mes (13 recorridos completos
 * de los movimientos): aquí se ordenan los movimientos por fecha y se avanza
 * un puntero aplicándolos una única vez. El saldo al inicio de un mes M es el
 * saldo corrido justo antes del primer movimiento con fecha >= 'M-01' — que es
 * EXACTAMENTE lo que devuelve calcularSaldos_(cuentas, movimientos, 'M-01'),
 * porque ambos aplican solo movimientos con fecha < corte y >= fechaCorte.
 *
 * Devuelve un mapa { 'yyyy-MM': { cuenta: saldo } } (en la moneda de cada cuenta).
 */
function iniciosDeMes_(cuentas, movimientos, meses) {
  var porNombre = {}, saldos = {};
  cuentas.forEach(function (c) { porNombre[c.cuenta] = c; saldos[c.cuenta] = c.saldoInicial; });
  function aplica(n, f) { var c = porNombre[n]; return c && f >= c.fechaCorte; }
  function aplicarUno(m) {
    if (m.tipo === 'Ingreso') {
      if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] += m.valor;
    } else if (m.tipo === 'Gasto') {
      if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] -= m.valor;
    } else if (m.tipo === 'Transferencia' || m.tipo === 'Pago tarjeta') {
      if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] -= m.valor;
      if (aplica(m.cuentaDestino, m.fecha)) {
        saldos[m.cuentaDestino] += (m.valorDestino > 0 ? m.valorDestino : m.valor);
      }
    }
  }

  // Copia ordenada por fecha ascendente (no muta el array del llamador, que
  // calcularDatos_ ordena después de forma descendente para el historial).
  var ordenados = movimientos.slice().sort(function (a, b) {
    return a.fecha === b.fecha ? a.id - b.id : (a.fecha < b.fecha ? -1 : 1);
  });

  // Fronteras 'yyyy-MM-01' únicas y ordenadas; el inicio de cada mes es el
  // snapshot del saldo corrido tras aplicar los movimientos < su frontera.
  var fronteras = meses.map(function (m) { return m + '-01'; })
    .sort()
    .filter(function (f, i, arr) { return i === 0 || f !== arr[i - 1]; });

  var resultado = {}, ptr = 0;
  fronteras.forEach(function (frontera) {
    while (ptr < ordenados.length && ordenados[ptr].fecha < frontera) {
      aplicarUno(ordenados[ptr]);
      ptr++;
    }
    var snap = {};
    cuentas.forEach(function (c) { snap[c.cuenta] = saldos[c.cuenta]; });
    resultado[frontera.substring(0, 7)] = snap;
  });
  return resultado;
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


