/**
 * Finanzas App — Qué hoja abre cada usuario.
 *
 * La web app se ejecuta COMO QUIEN LA ABRE (appsscript.json: USER_ACCESSING),
 * así que cada persona entra con su cuenta de Google y solo puede tocar las
 * hojas de SU Drive. Cada una tiene su propia hoja:
 *
 *   - El dueño (quien despliega) sigue usando la hoja a la que está vinculado
 *     el script, como siempre.
 *   - Cualquier otra persona, la primera vez, recibe una hoja nueva en su Drive
 *     con las pestañas y encabezados que la app espera.
 *
 * El ID de la hoja de cada persona se guarda en las propiedades de USUARIO del
 * script: son privadas por persona, así que nadie ve el ID de otro.
 */

var PROP_LIBRO = 'SPREADSHEET_ID';

// Una sola apertura por ejecución: abrirLibro_ se llama varias veces por
// petición y openById cuesta un viaje a Sheets.
var libroAbierto_ = null;

/** Abre la hoja de quien está usando la app (y la crea si es su primera vez). */
function abrirLibro_() {
  if (libroAbierto_) return libroAbierto_;
  var props = PropertiesService.getUserProperties();
  var id = props.getProperty(PROP_LIBRO);
  if (!id) id = asignarLibro_(props);
  try {
    libroAbierto_ = SpreadsheetApp.openById(id);
  } catch (e) {
    // NO se crea otra en silencio: un fallo pasajero de Google haría parecer
    // que se perdieron todos los datos. Mejor un error claro.
    throw new Error('No pude abrir tu hoja de finanzas (' + e.message + '). ' +
      'Si la borraste, sácala de la papelera de Drive y vuelve a intentar.');
  }
  return libroAbierto_;
}

/**
 * Primera vez de este usuario: decide su hoja y la recuerda.
 * Lock de SCRIPT (no de usuario): el resto de la app usa getUserLock, y la
 * primera carga dispara varias llamadas a la vez; sin esto podían crearse dos
 * hojas. Dentro del lock se vuelve a mirar por si otra llamada ya la asignó.
 */
function asignarLibro_(props) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var id = props.getProperty(PROP_LIBRO);
    if (id) return id;
    var ss = libroDelDueno_() || crearLibroNuevo_();
    id = ss.getId();
    props.setProperty(PROP_LIBRO, id);
    return id;
  } finally {
    lock.releaseLock();
  }
}

/**
 * La hoja del script (la del dueño), SOLO si quien abre la app es su dueño.
 * Se compara el correo además de que pueda abrirla: si algún día esa hoja se
 * compartiera con alguien, esa persona igual debe recibir su propia hoja y no
 * escribir en la del dueño.
 */
function libroDelDueno_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss && SPREADSHEET_ID && SPREADSHEET_ID !== 'TU_ID_DE_HOJA_AQUI') {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    if (!ss) return null;
    var dueno = ss.getOwner();
    var yo = Session.getActiveUser().getEmail();
    if (dueno && yo && String(dueno.getEmail()).toLowerCase() === String(yo).toLowerCase()) return ss;
  } catch (e) {
    // Sin permiso sobre la hoja del dueño (lo normal para otro usuario)
  }
  return null;
}

/**
 * RESCATE (para el dueño): si la app te mostró una hoja vacía en vez de la
 * tuya, ejecuta esta función desde el editor de Apps Script (selecciónala
 * arriba y dale a "Ejecutar"). Vuelve a apuntar TU usuario a la hoja vinculada.
 * No borra nada: la hoja vacía que se haya creado queda en tu Drive.
 */
function usarHojaVinculada() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss && SPREADSHEET_ID && SPREADSHEET_ID !== 'TU_ID_DE_HOJA_AQUI') ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss) throw new Error('Este script no está vinculado a ninguna hoja.');
  PropertiesService.getUserProperties().setProperty(PROP_LIBRO, ss.getId());
  return 'Listo: la app vuelve a usar "' + ss.getName() + '".';
}

// Categorías con las que arranca una hoja nueva (se editan desde Ajustes).
// El icono va como 'i:clave' del catálogo ICONOS_CAT (app-core.html).
var CATEGORIAS_INICIALES = [
  ['Comida', 'Gasto', 'i:comida'],
  ['Mercado', 'Gasto', 'i:mercado'],
  ['Transporte', 'Gasto', 'i:bus'],
  ['Servicios', 'Gasto', 'i:servicios'],
  ['Hogar', 'Gasto', 'i:hogar'],
  ['Salud', 'Gasto', 'i:salud'],
  ['Educación', 'Gasto', 'i:educacion'],
  ['Ocio', 'Gasto', 'i:ocio'],
  ['Compras', 'Gasto', 'i:compras'],
  ['Salario', 'Ingreso', 'i:salario'],
  ['Otros ingresos', 'Ingreso', 'i:ingresos'],
  ['Entre cuentas', 'Transferencia', 'i:transferencia']
];

/**
 * Crea en el Drive de quien abre la app una hoja con lo mínimo que la app
 * espera: Cuentas, Categorias y Movimientos con sus encabezados. Config,
 * Presupuestos y Recurrentes se crean solas la primera vez que hacen falta.
 * Las cuentas no se inventan: la persona las crea desde el Panel.
 */
function crearLibroNuevo_() {
  var ss = SpreadsheetApp.create('Finanzas App - Base de datos');
  ss.setSpreadsheetTimeZone(TZ);

  var cuentas = ss.getSheets()[0].setName('Cuentas');
  cuentas.getRange(1, 1, 1, 7).setValues([[
    'Cuenta', 'SaldoInicial', 'FechaCorte', 'Color', 'Nota', 'Tipo', 'Moneda'
  ]]);

  var cats = ss.insertSheet('Categorias');
  cats.getRange(1, 1, 1, 3).setValues([['Categoria', 'TipoSugerido', 'Icono']]);
  cats.getRange(2, 1, CATEGORIAS_INICIALES.length, 3).setValues(CATEGORIAS_INICIALES);

  var movs = ss.insertSheet('Movimientos');
  movs.getRange(1, 1, 1, 10).setValues([[
    'ID', 'Fecha', 'Cuenta', 'Tipo', 'CuentaDestino', 'Categoria',
    'Descripcion', 'Valor', 'ValorDestino', 'UID'
  ]]);

  [cuentas, cats, movs].forEach(function (h) {
    h.setFrozenRows(1);
    h.getRange(1, 1, 1, h.getLastColumn()).setFontWeight('bold');
  });
  SpreadsheetApp.flush();
  return ss;
}
