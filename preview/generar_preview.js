/**
 * Genera preview/preview.html: la app completa corriendo SIN Google.
 *
 * Une index.html + styles.html + app.html igual que lo hace Apps Script con
 * los include(), y reemplaza google.script.run por un simulador con datos de
 * EJEMPLO en memoria. No toca la hoja de cálculo real para nada.
 *
 * Uso:  node preview/generar_preview.js
 * Luego abre preview/preview.html en el navegador (doble clic basta).
 */
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(RAIZ, 'styles.html'), 'utf8');
const app = fs.readFileSync(path.join(RAIZ, 'app.html'), 'utf8');

const mock = `<script>
// ============ SIMULADOR de google.script.run (solo preview local) ============
// Datos de ejemplo en memoria: nada de esto toca la hoja real.
(function () {
  // Datos de EJEMPLO (ficticios): este mock es solo para el preview local, no
  // toca ninguna hoja real. Nombres y montos inventados a propósito.
  var cuentas = [
    { cuenta: 'Cuenta Ahorros', saldoInicial: 2000000, fechaCorte: '2026-07-01', color: '#FDDA24', nota: 'Cuenta principal', tipo: 'Activo', moneda: 'COP' },
    { cuenta: 'Billetera', saldoInicial: 250000, fechaCorte: '2026-07-01', color: '#DA0081', nota: 'Gastos diarios', tipo: 'Activo', moneda: 'COP' },
    { cuenta: 'Inversión', saldoInicial: 5000000, fechaCorte: '2026-07-01', color: '#820AD1', nota: 'Ahorro', tipo: 'Activo', moneda: 'COP' },
    { cuenta: 'Efectivo', saldoInicial: 150000, fechaCorte: '2026-07-01', color: '#34A853', nota: '', tipo: 'Activo', moneda: 'COP' },
    { cuenta: 'Cuenta USD', saldoInicial: 120, fechaCorte: '2026-07-01', color: '#12B5CB', nota: 'Dólares', tipo: 'Activo', moneda: 'USD' },
    { cuenta: 'Tarjeta Crédito', saldoInicial: -70000, fechaCorte: '2026-07-01', color: '#C5221F', nota: 'Deuda', tipo: 'Deuda', moneda: 'COP' },
    { cuenta: 'Préstamo', saldoInicial: -300000, fechaCorte: '2026-07-01', color: '#9AA0A6', nota: 'Sin afán', tipo: 'Deuda', moneda: 'COP' },
    // Deuda en otra moneda: sirve para comprobar que el equivalente en la base
    // sale en positivo igual que la línea "debes" (antes salía "≈ $ -80.000")
    { cuenta: 'Tarjeta USD', saldoInicial: -20, fechaCorte: '2026-07-01', color: '#FF6D01', nota: '', tipo: 'Deuda', moneda: 'USD' }
  ];
  // Tasas a COP (espejo de la hoja Config): EUR/CHF manuales, ARS sin tasa (avisos)
  var tasasMock = {
    USD: { tasa: 4000, esManual: false, sinTasa: false },
    EUR: { tasa: 4700, esManual: true, sinTasa: false },
    GBP: { tasa: 5400, esManual: false, sinTasa: false },
    BRL: { tasa: 800, esManual: false, sinTasa: false },
    MXN: { tasa: 240, esManual: false, sinTasa: false },
    ARS: { tasa: 0, esManual: false, sinTasa: true },
    CLP: { tasa: 4.5, esManual: false, sinTasa: false },
    PEN: { tasa: 1150, esManual: false, sinTasa: false },
    CAD: { tasa: 3100, esManual: false, sinTasa: false },
    CHF: { tasa: 4900, esManual: true, sinTasa: false },
    JPY: { tasa: 28, esManual: false, sinTasa: false }
  };
  var MONEDAS_MOCK = ['COP', 'USD', 'EUR', 'GBP', 'BRL', 'MXN', 'ARS', 'CLP', 'PEN', 'CAD', 'CHF', 'JPY'];
  var monedaBaseMock = 'COP';
  var catsOcultasMock = [];
  function tasaDeCuentaMock(c) {
    return (!c.moneda || c.moneda === 'COP') ? 1 : (tasasMock[c.moneda] ? tasasMock[c.moneda].tasa : 0);
  }
  var categorias = [
    { categoria: 'Trabajo', tipoSugerido: 'Ingreso', icono: '💻' },
    { categoria: 'Universidad', tipoSugerido: 'Gasto', icono: '🎓' },
    { categoria: 'Transporte', tipoSugerido: 'Gasto', icono: '🚌' },
    { categoria: 'Comida', tipoSugerido: 'Gasto', icono: '🍔' },
    { categoria: 'Servicios', tipoSugerido: 'Gasto', icono: '📱' },
    { categoria: 'Apuestas', tipoSugerido: 'Gasto', icono: '🎲' },
    { categoria: 'Gym', tipoSugerido: 'Gasto', icono: '💪' },
    { categoria: 'Familia', tipoSugerido: 'Transferencia', icono: '👨‍👩‍👧' },
    { categoria: 'Rendimientos', tipoSugerido: 'Ingreso', icono: '📈' },
    { categoria: 'Entre cuentas', tipoSugerido: 'Transferencia', icono: '🔁' }
  ];
  var presupuestos = [
    { categoria: 'Comida', tope: 150000 },
    { categoria: 'Transporte', tope: 40000 },
    { categoria: 'Gym', tope: 70000 }
  ];
  var movimientos = [
    { id: 1, fecha: '2026-07-14', cuenta: 'Billetera', tipo: 'Ingreso', cuentaDestino: '', categoria: 'Apuestas', descripcion: 'Reintegro', valor: 20000 },
    { id: 2, fecha: '2026-07-16', cuenta: 'Cuenta Ahorros', tipo: 'Transferencia', cuentaDestino: 'Billetera', categoria: 'Entre cuentas', descripcion: '', valor: 44404 },
    { id: 3, fecha: '2026-07-16', cuenta: 'Billetera', tipo: 'Transferencia', cuentaDestino: 'Efectivo', categoria: 'Familia', descripcion: 'Transferencia a dinero físico', valor: 190000 },
    { id: 4, fecha: '2026-06-20', cuenta: 'Cuenta Ahorros', tipo: 'Ingreso', cuentaDestino: '', categoria: 'Trabajo', descripcion: 'Pago mensual', valor: 850000 },
    { id: 5, fecha: '2026-06-22', cuenta: 'Billetera', tipo: 'Gasto', cuentaDestino: '', categoria: 'Transporte', descripcion: 'Bus', valor: 3200 },
    { id: 6, fecha: '2026-07-05', cuenta: 'Billetera', tipo: 'Gasto', cuentaDestino: '', categoria: 'Gym', descripcion: 'Mensualidad', valor: 65000 },
    { id: 7, fecha: '2026-03-10', cuenta: 'Billetera', tipo: 'Gasto', cuentaDestino: '', categoria: 'Comida', descripcion: 'Prueba marzo', valor: 120000 },
    { id: 8, fecha: '2025-12-05', cuenta: 'Cuenta Ahorros', tipo: 'Ingreso', cuentaDestino: '', categoria: 'Trabajo', descripcion: 'Prueba diciembre', valor: 500000 },
    { id: 9, fecha: '2025-12-20', cuenta: 'Cuenta Ahorros', tipo: 'Gasto', cuentaDestino: '', categoria: 'Universidad', descripcion: 'Matrícula prueba', valor: 300000 },
    // Transferencia ENTRE MONEDAS: sale COP, llega USD (valorDestino)
    { id: 10, fecha: '2026-07-10', cuenta: 'Cuenta Ahorros', tipo: 'Transferencia', cuentaDestino: 'Cuenta USD', categoria: '', descripcion: 'Compra de dólares', valor: 200000, valorDestino: 48.5 },
    { id: 11, fecha: '2026-07-12', cuenta: 'Cuenta USD', tipo: 'Ingreso', cuentaDestino: '', categoria: 'Trabajo', descripcion: 'Pago en dólares', valor: 25 }
  ];
  window.fallarProximaEscritura = false; // ponlo en true en la consola para simular un error

  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---- Espejos exactos de la lógica del backend (Code.js) ----
  function calcularSaldosMock(hastaFechaExclusiva) {
    var saldos = {}, porNombre = {};
    cuentas.forEach(function (c) { saldos[c.cuenta] = c.saldoInicial; porNombre[c.cuenta] = c; });
    function aplica(n, f) { return porNombre[n] && f >= porNombre[n].fechaCorte; }
    movimientos.forEach(function (m) {
      if (hastaFechaExclusiva && m.fecha >= hastaFechaExclusiva) return;
      if (m.tipo === 'Ingreso') { if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] += m.valor; }
      else if (m.tipo === 'Gasto') { if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] -= m.valor; }
      else { if (aplica(m.cuenta, m.fecha)) saldos[m.cuenta] -= m.valor;
             if (aplica(m.cuentaDestino, m.fecha)) saldos[m.cuentaDestino] += (m.valorDestino > 0 ? m.valorDestino : m.valor); }
    });
    return saldos;
  }

  function siguienteDiaMock(iso) {
    var y = Number(iso.substring(0, 4)), m = Number(iso.substring(5, 7)), d = Number(iso.substring(8, 10));
    var dias = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dias = 29;
    d += 1;
    if (d > dias) { d = 1; m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  // Espejo de calcularHistoria_: saldo por cuenta al cierre de cada día
  function calcularHistoriaMock(hoy) {
    var corteMin = null;
    cuentas.forEach(function (c) { if (!corteMin || c.fechaCorte < corteMin) corteMin = c.fechaCorte; });
    if (!corteMin || corteMin > hoy) return { fechas: [], porCuenta: {} };
    var movsPorDia = {};
    movimientos.forEach(function (m) { (movsPorDia[m.fecha] = movsPorDia[m.fecha] || []).push(m); });
    var porNombre = {}, saldos = {}, porCuenta = {};
    cuentas.forEach(function (c) { porNombre[c.cuenta] = c; saldos[c.cuenta] = c.saldoInicial; porCuenta[c.cuenta] = []; });
    function aplica(n, f) { var c = porNombre[n]; return c && f >= c.fechaCorte; }
    var fechas = [];
    for (var f = corteMin; f <= hoy; f = siguienteDiaMock(f)) {
      (movsPorDia[f] || []).forEach(function (m) {
        if (m.tipo === 'Ingreso') { if (aplica(m.cuenta, f)) saldos[m.cuenta] += m.valor; }
        else if (m.tipo === 'Gasto') { if (aplica(m.cuenta, f)) saldos[m.cuenta] -= m.valor; }
        else { if (aplica(m.cuenta, f)) saldos[m.cuenta] -= m.valor;
               if (aplica(m.cuentaDestino, f)) saldos[m.cuentaDestino] += (m.valorDestino > 0 ? m.valorDestino : m.valor); }
      });
      fechas.push(f);
      cuentas.forEach(function (c) {
        porCuenta[c.cuenta].push(f < c.fechaCorte ? null : Math.round(saldos[c.cuenta] * 100) / 100);
      });
    }
    var MAX = 400;
    if (fechas.length > MAX) {
      fechas = fechas.slice(-MAX);
      cuentas.forEach(function (c) { porCuenta[c.cuenta] = porCuenta[c.cuenta].slice(-MAX); });
    }
    return { fechas: fechas, porCuenta: porCuenta };
  }

  function ultimosMesesMock(mesFinal, n) {
    var y = Number(mesFinal.substring(0, 4)), m = Number(mesFinal.substring(5, 7));
    var meses = [];
    for (var i = n - 1; i >= 0; i--) {
      var mm = m - i, yy = y;
      while (mm <= 0) { mm += 12; yy -= 1; }
      meses.push(yy + '-' + ('0' + mm).slice(-2));
    }
    return meses;
  }

  function ultimoDiaMesAnteriorMock(mes) {
    var y = Number(mes.substring(0, 4)), m = Number(mes.substring(5, 7)) - 1;
    if (m === 0) { m = 12; y -= 1; }
    var dias = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) dias = 29;
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + dias).slice(-2);
  }

  function maxId() { return movimientos.reduce(function (a, m) { return Math.max(a, m.id); }, 0); }

  function getDatosMock() {
    var saldos = calcularSaldosMock();
    var pat = 0;
    var usadas = {}, catsUsadas = {};
    movimientos.forEach(function (m) {
      usadas[m.cuenta] = true;
      if (m.cuentaDestino) usadas[m.cuentaDestino] = true;
      if (m.categoria) catsUsadas[m.categoria] = true;
    });
    // Todo lo consolidado va en COP con la tasa de cada cuenta (espejo del backend)
    var tasaPorCuenta = {};
    var cts = cuentas.map(function (c) {
      var tasa = tasaDeCuentaMock(c);
      tasaPorCuenta[c.cuenta] = tasa;
      var o = Object.assign({}, c, {
        saldo: saldos[c.cuenta], enUso: !!usadas[c.cuenta],
        tasa: tasa, saldoCOP: saldos[c.cuenta] * tasa
      });
      pat += o.saldoCOP; return o;
    });
    var cats = categorias.map(function (c) {
      return Object.assign({}, c, { enUso: !!catsUsadas[c.categoria] });
    });

    var hoy = hoyISO(), mesHoy = hoy.substring(0, 7);
    var saldosInicio = calcularSaldosMock(mesHoy + '-01');
    var patInicio = 0;
    cuentas.forEach(function (c) { patInicio += saldosInicio[c.cuenta] * tasaPorCuenta[c.cuenta]; });

    var meses = ultimosMesesMock(mesHoy, 12);
    var porMes = {};
    meses.forEach(function (m) { porMes[m] = { mes: m, ingresos: 0, gastos: 0, gastosPorCategoria: {} }; });
    movimientos.forEach(function (mv) {
      var b = porMes[mv.fecha.substring(0, 7)];
      if (!b) return;
      var tasa = tasaPorCuenta[mv.cuenta] !== undefined ? tasaPorCuenta[mv.cuenta] : 1;
      if (mv.tipo === 'Ingreso') b.ingresos += mv.valor * tasa;
      if (mv.tipo === 'Gasto') {
        b.gastos += mv.valor * tasa;
        var cat = mv.categoria || 'Sin categoría';
        b.gastosPorCategoria[cat] = (b.gastosPorCategoria[cat] || 0) + mv.valor * tasa;
      }
    });
    meses.forEach(function (m) {
      var s = calcularSaldosMock(m + '-01');
      porMes[m].inicioPorCuenta = s;
      var t = 0;
      cuentas.forEach(function (c) { t += s[c.cuenta] * tasaPorCuenta[c.cuenta]; });
      porMes[m].inicio = t;
    });
    var act = porMes[mesHoy];
    var ordenados = movimientos.slice().sort(function (a, b) {
      return a.fecha === b.fecha ? b.id - a.id : (a.fecha < b.fecha ? 1 : -1);
    });
    return {
      cuentas: cts, categorias: cats, movimientos: ordenados.slice(0, 300),
      resumen: { mesActual: { mes: mesHoy, ingresos: act.ingresos, gastos: act.gastos, neto: act.ingresos - act.gastos },
                 meses: meses.map(function (m) { return porMes[m]; }) },
      presupuestos: presupuestos.map(function (p) { return Object.assign({}, p); }),
      patrimonio: pat, patrimonioInicioMes: patInicio,
      tasas: JSON.parse(JSON.stringify(tasasMock)),
      monedaBase: monedaBaseMock,
      catsOcultas: catsOcultasMock.slice(),
      historia: calcularHistoriaMock(hoy),
      hojaUrl: 'https://docs.google.com/spreadsheets/d/EJEMPLO/edit',
      hoy: hoy
    };
  }

  function asegurarCatAjuste() {
    if (!categorias.some(function (c) { return c.categoria === 'Ajuste'; })) {
      categorias.push({ categoria: 'Ajuste', tipoSugerido: '', icono: '⚖️' });
    }
  }
  function buscarCuenta(nombre) {
    return cuentas.filter(function (x) { return x.cuenta === nombre; })[0] || null;
  }

  var api = {
    getDatos: function () { return getDatosMock(); },
    guardarMonedaBase: function (codigo) {
      codigo = String(codigo || '').trim().toUpperCase();
      if (MONEDAS_MOCK.indexOf(codigo) < 0) throw new Error('Moneda no válida: ' + codigo);
      if (codigo !== 'COP') {
        var t = tasasMock[codigo];
        if (!t || t.sinTasa || !(t.tasa > 0)) throw new Error('No hay tasa para ' + codigo + ': pon una tasa manual antes de usarla como base.');
      }
      monedaBaseMock = codigo;
      return getDatosMock();
    },
    guardarTasaManual: function (par, valor) {
      par = String(par || '').trim().toUpperCase();
      if (MONEDAS_MOCK.indexOf(par) < 0 || par === 'COP') throw new Error('Par no válido: ' + par);
      var v = Number(String(valor).replace(/\./g, '').replace(',', '.'));
      if (!(v > 0)) throw new Error('La tasa manual debe ser un número mayor que cero.');
      // Si la auto estaba fallando, la manual pasa a estar en uso
      var t = tasasMock[par] || (tasasMock[par] = { tasa: 0, esManual: true, sinTasa: true });
      if (t.sinTasa || t.esManual) { t.tasa = v; t.esManual = true; t.sinTasa = false; }
      return getDatosMock();
    },
    guardarCatsOcultas: function (lista) {
      var arr = (lista && lista.length !== undefined && typeof lista !== 'string') ? lista : String(lista || '').split('|');
      catsOcultasMock = arr.map(function (s) { return String(s).trim(); }).filter(function (s) { return s; });
      return getDatosMock();
    },
    agregarMovimiento: function (mov) {
      if (window.fallarProximaEscritura) { window.fallarProximaEscritura = false; throw new Error('Error simulado del servidor'); }
      if (!(Number(mov.valor) > 0)) throw new Error('El valor debe ser un número mayor que cero.');
      var esDoble = (mov.tipo === 'Transferencia' || mov.tipo === 'Pago tarjeta');
      if (esDoble) {
        var origen = buscarCuenta(mov.cuenta);
        var destino = buscarCuenta(mov.cuentaDestino);
        if (!destino) throw new Error('La cuenta destino "' + mov.cuentaDestino + '" no existe.');
        if (mov.tipo === 'Pago tarjeta' && destino.tipo !== 'Deuda') {
          throw new Error('El destino de "Pagar deuda" debe ser una deuda; "' + mov.cuentaDestino + '" es una cuenta normal.');
        }
        if (mov.tipo === 'Transferencia' && destino.tipo === 'Deuda') {
          throw new Error('Para pasarle plata a "' + mov.cuentaDestino + '" usa "Pagar deuda".');
        }
        var vd = '';
        if (origen.moneda !== destino.moneda) {
          vd = Number(mov.valorDestino);
          if (!(vd > 0)) throw new Error('Escribe también cuánto llega en ' + destino.moneda + '.');
        }
        mov = Object.assign({}, mov, { categoria: '', valorDestino: vd });
      } else {
        mov = Object.assign({}, mov, { valorDestino: '' });
      }
      movimientos.push(Object.assign({}, mov, { id: maxId() + 1 }));
      return getDatosMock();
    },
    editarMovimiento: function (mov) {
      var i = movimientos.findIndex(function (m) { return m.id === mov.id; });
      if (i < 0) throw new Error('No encontré el movimiento con ID ' + mov.id);
      movimientos[i] = Object.assign({}, mov);
      return getDatosMock();
    },
    borrarMovimiento: function (id) {
      var i = movimientos.findIndex(function (m) { return m.id === id; });
      if (i < 0) throw new Error('No encontré el movimiento con ID ' + id);
      movimientos.splice(i, 1);
      return getDatosMock();
    },
    ajustarSaldo: function (cuenta, saldoReal) {
      var real = Number(saldoReal);
      if (isNaN(real)) throw new Error('El saldo real debe ser un número.');
      if (!buscarCuenta(cuenta)) throw new Error('La cuenta "' + cuenta + '" no existe en la hoja Cuentas.');
      var actual = calcularSaldosMock()[cuenta];
      var dif = Math.round((real - actual) * 100) / 100;
      if (Math.abs(dif) < 0.01) return getDatosMock();
      asegurarCatAjuste();
      movimientos.push({
        id: maxId() + 1, fecha: hoyISO(), cuenta: cuenta,
        tipo: dif > 0 ? 'Ingreso' : 'Gasto', cuentaDestino: '', categoria: 'Ajuste',
        descripcion: 'Ajuste de saldo (la app calculaba ' + actual.toFixed(2) + ')',
        valor: Math.abs(dif)
      });
      return getDatosMock();
    },
    ajustarInicioMes: function (cuenta, mes, saldoRealInicio) {
      var c = buscarCuenta(cuenta);
      if (!c) throw new Error('La cuenta "' + cuenta + '" no existe en la hoja Cuentas.');
      var real = Number(saldoRealInicio);
      if (isNaN(real)) throw new Error('El saldo debe ser un número.');
      var fechaAjuste = ultimoDiaMesAnteriorMock(mes);
      if (fechaAjuste < c.fechaCorte) {
        throw new Error('Los meses que empiezan antes de la fecha de corte (' + c.fechaCorte +
          ') están contenidos en el saldo inicial de ' + c.cuenta +
          '; para corregirlos usa "Cambiar saldo inicial" en la tarjeta de la cuenta.');
      }
      var inicio = calcularSaldosMock(mes + '-01')[cuenta];
      var dif = Math.round((real - inicio) * 100) / 100;
      if (Math.abs(dif) < 0.01) return getDatosMock();
      asegurarCatAjuste();
      movimientos.push({
        id: maxId() + 1, fecha: fechaAjuste, cuenta: cuenta,
        tipo: dif > 0 ? 'Ingreso' : 'Gasto', cuentaDestino: '', categoria: 'Ajuste',
        descripcion: 'Ajuste inicio de ' + mes + ' (la app calculaba ' + inicio.toFixed(2) + ')',
        valor: Math.abs(dif)
      });
      return getDatosMock();
    },
    agregarCuenta: function (c) {
      var nombre = String((c && c.cuenta) || '').trim();
      if (!nombre) throw new Error('Escribe el nombre de la cuenta.');
      if (cuentas.some(function (x) { return x.cuenta.toLowerCase() === nombre.toLowerCase(); })) {
        throw new Error('Ya existe una cuenta llamada "' + nombre + '".');
      }
      var saldo = Number(c.saldoInicial);
      if (isNaN(saldo)) throw new Error('El saldo inicial debe ser un número.');
      var tipo = c.tipo === 'Deuda' ? 'Deuda' : 'Activo';
      if (tipo === 'Deuda' && saldo > 0) saldo = -saldo;
      var moneda = MONEDAS_MOCK.indexOf(String(c.moneda || '')) >= 0 ? String(c.moneda) : 'COP';
      cuentas.push({
        cuenta: nombre, saldoInicial: saldo, fechaCorte: hoyISO(),
        color: /^#[0-9A-Fa-f]{6}$/.test(String(c.color || '')) ? c.color : '#1A73E8',
        nota: String(c.nota || ''), tipo: tipo, moneda: moneda
      });
      return getDatosMock();
    },
    editarCategoria: function (nombreActual, cambios) {
      var c = categorias.filter(function (x) { return x.categoria === nombreActual; })[0];
      if (!c) throw new Error('La categoría "' + nombreActual + '" no existe en la hoja Categorias.');
      var nombreNuevo = String((cambios && cambios.categoria) || '').trim() || nombreActual;
      if (nombreNuevo.toLowerCase() !== nombreActual.toLowerCase() &&
          categorias.some(function (x) { return x.categoria.toLowerCase() === nombreNuevo.toLowerCase(); })) {
        throw new Error('Ya existe una categoría llamada "' + nombreNuevo + '".');
      }
      if (cambios.tipoSugerido !== undefined) c.tipoSugerido = String(cambios.tipoSugerido || '');
      if (cambios.icono !== undefined) c.icono = String(cambios.icono).trim() || '🏷️';
      if (nombreNuevo !== nombreActual) {
        c.categoria = nombreNuevo;
        movimientos.forEach(function (m) { if (m.categoria === nombreActual) m.categoria = nombreNuevo; });
      }
      return getDatosMock();
    },
    guardarPresupuesto: function (categoria, tope) {
      if (!categorias.some(function (c) { return c.categoria === categoria; })) {
        throw new Error('La categoría "' + categoria + '" no existe en la hoja Categorias.');
      }
      var t = Number(tope);
      if (isNaN(t)) t = 0;
      var i = presupuestos.findIndex(function (p) { return p.categoria === categoria; });
      if (!(t > 0)) { if (i >= 0) presupuestos.splice(i, 1); }
      else if (i >= 0) presupuestos[i].tope = t;
      else presupuestos.push({ categoria: categoria, tope: t });
      return getDatosMock();
    },
    reordenarCuentas: function (nombres) {
      var actuales = cuentas.map(function (c) { return c.cuenta; });
      if (!nombres || nombres.length !== actuales.length ||
          !nombres.every(function (n) { return actuales.indexOf(n) >= 0; })) {
        throw new Error('La lista de orden no coincide con las cuentas de la hoja; refresca e intenta de nuevo.');
      }
      cuentas.sort(function (a, b) { return nombres.indexOf(a.cuenta) - nombres.indexOf(b.cuenta); });
      return getDatosMock();
    },
    eliminarCuenta: function (nombre) {
      var enUso = movimientos.some(function (m) { return m.cuenta === nombre || m.cuentaDestino === nombre; });
      if (enUso) throw new Error('"' + nombre + '" tiene movimientos en el historial y no se puede eliminar sin romper los registros.');
      var i = cuentas.findIndex(function (x) { return x.cuenta === nombre; });
      if (i < 0) throw new Error('La cuenta "' + nombre + '" no existe en la hoja Cuentas.');
      cuentas.splice(i, 1);
      return getDatosMock();
    },
    agregarCategoria: function (c) {
      var nombre = String((c && c.categoria) || '').trim();
      if (!nombre) throw new Error('Escribe el nombre de la categoría.');
      if (categorias.some(function (x) { return x.categoria.toLowerCase() === nombre.toLowerCase(); })) {
        throw new Error('Ya existe una categoría llamada "' + nombre + '".');
      }
      categorias.push({
        categoria: nombre,
        tipoSugerido: String(c.tipoSugerido || ''),
        icono: String(c.icono || '').trim() || '🏷️'
      });
      return getDatosMock();
    },
    eliminarCategoria: function (nombre) {
      if (movimientos.some(function (m) { return m.categoria === nombre; })) {
        throw new Error('"' + nombre + '" tiene movimientos en el historial; edítalos o bórralos antes de eliminarla.');
      }
      var i = categorias.findIndex(function (x) { return x.categoria === nombre; });
      if (i < 0) throw new Error('La categoría "' + nombre + '" no existe en la hoja Categorias.');
      categorias.splice(i, 1);
      return getDatosMock();
    },
    editarCuenta: function (nombreActual, cambios) {
      if (typeof cambios !== 'object' || cambios === null) cambios = { saldoInicial: cambios };
      var c = buscarCuenta(nombreActual);
      if (!c) throw new Error('La cuenta "' + nombreActual + '" no existe en la hoja Cuentas.');
      var nombreNuevo = String(cambios.nombre || '').trim() || nombreActual;
      if (nombreNuevo.toLowerCase() !== nombreActual.toLowerCase() &&
          cuentas.some(function (x) { return x.cuenta.toLowerCase() === nombreNuevo.toLowerCase(); })) {
        throw new Error('Ya existe una cuenta llamada "' + nombreNuevo + '".');
      }
      if (cambios.saldoInicial !== undefined) {
        var valor = Number(cambios.saldoInicial);
        if (isNaN(valor)) throw new Error('El saldo inicial debe ser un número.');
        c.saldoInicial = valor;
      }
      if (cambios.color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(String(cambios.color))) c.color = cambios.color;
      if (cambios.nota !== undefined) c.nota = String(cambios.nota);
      if (cambios.tipo !== undefined) c.tipo = cambios.tipo === 'Deuda' ? 'Deuda' : 'Activo';
      if (cambios.moneda !== undefined) c.moneda = MONEDAS_MOCK.indexOf(String(cambios.moneda)) >= 0 ? String(cambios.moneda) : 'COP';
      if (nombreNuevo !== nombreActual) {
        c.cuenta = nombreNuevo;
        movimientos.forEach(function (m) {
          if (m.cuenta === nombreActual) m.cuenta = nombreNuevo;
          if (m.cuentaDestino === nombreActual) m.cuentaDestino = nombreNuevo;
        });
      }
      return getDatosMock();
    }
  };

  function runner() {
    var ok = null, fail = null;
    var obj = {
      withSuccessHandler: function (f) { ok = f; return obj; },
      withFailureHandler: function (f) { fail = f; return obj; }
    };
    Object.keys(api).forEach(function (fn) {
      obj[fn] = function () {
        var args = [].slice.call(arguments);
        setTimeout(function () {
          try { var r = api[fn].apply(api, args); if (ok) ok(r); }
          catch (e) { if (fail) fail(e); }
        }, 250); // simula la latencia del servidor
      };
    });
    return obj;
  }
  window.google = { script: { run: { withSuccessHandler: function (f) { return runner().withSuccessHandler(f); } } } };
})();
</` + `script>`;

// OJO: reemplazo con FUNCIÓN, no con string. String.replace interpreta las
// secuencias $$, $&, $` y $' del texto de reemplazo como patrones especiales,
// y el código de la app tiene muchos '$' (fmtCOP, 'US$', '$'...): con un string
// llano, un "$'" se convertía en "el resto de la cadena" y rompía el preview.
html = html.replace("<?!= include('styles'); ?>", function () { return styles; });
html = html.replace("<?!= include('app'); ?>", function () { return mock + '\n' + app; });
if (html.includes('<?!=')) throw new Error('Quedó un include sin reemplazar');
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('Listo: abre en el navegador -> ' + path.join(__dirname, 'preview.html'));
