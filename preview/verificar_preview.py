# -*- coding: utf-8 -*-
"""
Verificación automática del preview local con Selenium (headless).

Levanta el preview (hay que generarlo antes con `node preview/generar_preview.js`)
servido en http://localhost:8766/preview.html y ejecuta una batería de checks
sobre la app corriendo contra el simulador. NO toca la hoja real.

Uso:
    cd preview && python -m http.server 8766   (en otra consola)
    python preview/verificar_preview.py

Notas del entorno (lecciones previas):
 - Chrome headless arranca en tema OSCURO (prefers-color-scheme: dark); el tema
   por defecto de la app es 'auto', así que resuelve a oscuro en headless.
 - `.etiqueta` sale en MAYÚSCULAS por CSS: comparar por textContent real.
 - `#lista-cats .fila-cat` para no matchear las filas de presupuesto.
 - Verificar VISIBILIDAD por el display COMPUTADO, nunca por la propiedad .hidden.
 - v9: Registrar es una subvista (botón +/FAB #btn-registrar); las pestañas son
   Panel/Evolución/Historial/Ajustes. Transferencia usa el selector visual
   (#chips-transfer + tarjetas tr-origen/tr-destino). Todo se muestra en la
   moneda base (Ajustes); las cifras consolidadas se convierten al formatear.
"""
import sys, io, time
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

URL = "http://localhost:8766/preview.html?v=9"

fallos = []
def check(nombre, cond):
    print(("OK " if cond else "XX ") + nombre)
    if not cond:
        fallos.append(nombre)

def esperar_carga(d, t=8.0):
    fin = time.time() + t
    while time.time() < fin:
        oculto = d.execute_script(
            "var c=document.getElementById('cargando');"
            "return !c || getComputedStyle(c).display==='none';")
        if oculto:
            return
        time.sleep(0.15)

def ir(d, vista):
    """Navega por pestaña (Panel/Evolución/Historial/Ajustes)."""
    esperar_carga(d)
    d.execute_script("document.querySelector('.nav-btn[data-vista=\"%s\"]').click();" % vista)
    time.sleep(0.5)

def abrir_registrar(d):
    esperar_carga(d)
    d.execute_script("document.getElementById('btn-registrar').click();")
    time.sleep(0.5)

# display COMPUTADO (no la propiedad .hidden)
VISIBLE = ("var e=document.getElementById(arguments[0]);"
           "return !!e && getComputedStyle(e).display !== 'none';")

def main():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=440,900")
    opts.add_argument("--force-device-scale-factor=1")
    d = webdriver.Chrome(options=opts)
    js = d.execute_script
    try:
        d.get(URL)
        esperar_carga(d)
        time.sleep(0.4)

        # ---- Navegación v9: Panel es la vista inicial ----
        check("Nav: la vista inicial es el Panel",
              js("return document.getElementById('vista-resumen').classList.contains('activa')"))
        check("Nav: pestaña Ajustes existe",
              js("return !!document.querySelector('.nav-btn[data-vista=\"ajustes\"]')"))

        # ---- FAB (+) abre Registrar como subvista ----
        abrir_registrar(d)
        check("FAB: abre Registrar (hash #registrar)", js("return location.hash === '#registrar'"))
        check("FAB: vista-registrar activa",
              js("return document.getElementById('vista-registrar').classList.contains('activa')"))
        # Volver por el botón
        js("document.getElementById('reg-volver').click();")
        time.sleep(0.5)
        check("Registrar: 'Volver' regresa al Panel",
              js("return document.getElementById('vista-resumen').classList.contains('activa')"))

        # ---- Panel: multimoneda consolidada en la base (COP por defecto) ----
        ir(d, "resumen")
        patrimonio = d.find_element(By.ID, "txt-patrimonio").text
        check("Panel: patrimonio con valor", "$" in patrimonio)
        check("Panel: patrimonio con código de moneda (COP)", "COP" in patrimonio)

        cuentas_txt = d.find_element(By.ID, "lista-cuentas").text
        check("Panel: Wise en USD (US$)", "US$" in cuentas_txt)
        check("Panel: equivalente en base (≈)", "≈" in cuentas_txt)

        check("Panel: nota de tasas visible", js("return !document.getElementById('txt-tasas').hidden"))
        check("Panel: tasa USD listada", "USD" in d.find_element(By.ID, "txt-tasas").text)

        # Sección Deudas visible (el mock tiene deudas)
        check("Panel: sección Deudas visible (hay deudas)", d.execute_script(VISIBLE, "seccion-deudas"))

        # ---- Detalle de cuenta por hash ----
        d.get(URL + "#cuenta/Cuenta%20USD")
        time.sleep(1.2)
        check("Detalle: vista-cuenta activa",
              js("return document.getElementById('vista-cuenta').classList.contains('activa')"))
        check("Detalle: título = nombre de la cuenta",
              d.find_element(By.ID, "titulo-vista").text == "Cuenta USD")
        check("Detalle: saldo grande en USD", "US$" in d.find_element(By.ID, "cd-saldo").text)
        check("Detalle: equivalente VISIBLE (cuenta ≠ base)", d.execute_script(VISIBLE, "cd-equiv"))
        check("Detalle: gráfica de saldo (canvas con puntos)",
              js("return !!window.chartCuenta && window.chartCuenta.data.datasets[0].data.length >= 2"))
        check("Detalle: movimientos listados",
              len(d.find_element(By.ID, "cd-movs").text.strip()) > 0)

        esperar_carga(d)
        js('document.querySelector(\'#cd-rangos .chip[data-cdrango="1"]\').click();')
        time.sleep(0.4)
        check("Detalle: chip 1M activo",
              "activa" in d.find_element(By.CSS_SELECTOR, '#cd-rangos .chip[data-cdrango="1"]').get_attribute("class"))

        d.back()
        time.sleep(0.8)
        check("Detalle: atrás del navegador vuelve al Panel",
              js("return document.getElementById('vista-resumen').classList.contains('activa')"))

        # ---- Transferencia entre monedas: selector visual Origen → Destino ----
        ir(d, "historial")
        hist = d.find_element(By.ID, "lista-movs").text
        check("Historial: transferencia entre monedas muestra lo que llegó (US$)", "US$" in hist)

        abrir_registrar(d)
        js('document.querySelector(\'.btn-tipo[data-tipo="Transferencia"]\').click();')
        time.sleep(0.3)
        check("Transfer: selector visual visible", d.execute_script(VISIBLE, "bloque-transfer"))
        check("Transfer: bloque de una cuenta oculto", not d.execute_script(VISIBLE, "bloque-cuenta"))
        # Elegir origen Cuenta Ahorros (COP) en los chips del lado activo
        js("""var chips=document.querySelectorAll('#chips-transfer .chip');
               for(var i=0;i<chips.length;i++){if(chips[i].textContent.indexOf('Cuenta Ahorros')>=0){chips[i].click();break;}}""")
        time.sleep(0.3)
        # Tras elegir origen, el lado activo pasa a destino automáticamente
        check("Transfer: auto-avanza a elegir destino",
              js("return document.getElementById('tr-destino').classList.contains('activa')"))
        # Elegir destino Wise (USD) -> aparece 'llega al destino'
        js("""var chips=document.querySelectorAll('#chips-transfer .chip');
               for(var i=0;i<chips.length;i++){if(chips[i].textContent.indexOf('Cuenta USD')>=0){chips[i].click();break;}}""")
        time.sleep(0.3)
        check("Transfer: 'llega al destino' visible entre COP y USD",
              d.execute_script(VISIBLE, "bloque-valor-destino"))
        # Botón ⇄ invierte origen y destino
        antes = js("return document.getElementById('tr-origen-nombre').textContent")
        js("document.getElementById('tr-swap').click();")
        time.sleep(0.3)
        despues = js("return document.getElementById('tr-origen-nombre').textContent")
        check("Transfer: botón ⇄ invierte (%s -> %s)" % (antes, despues), antes != despues)

        # ---- Modal cuenta nueva: 12 monedas ----
        js("document.getElementById('reg-volver').click();")
        time.sleep(0.4)
        ir(d, "resumen")
        js("document.querySelector('#lista-cuentas .tarjeta-cuenta.agregar').click();")
        time.sleep(0.4)
        check("Modal cuenta nueva: 12 chips de moneda",
              js("return document.querySelectorAll('#nc-monedas .chip').length === 12"))
        js("document.getElementById('nc-cancelar').click();")
        time.sleep(0.3)

        # ---- Gráficas del Panel ----
        check("Panel: línea de patrimonio dibujada",
              js("return !!window.chartPatrimonio && window.chartPatrimonio.data.datasets[0].data.length >= 2"))
        check("Panel: título de la línea de patrimonio",
              "Patrimonio" in js("return document.getElementById('titulo-patrimonio-linea').textContent"))

        # ---- Evolución ----
        ir(d, "meses")
        time.sleep(0.6)
        check("Evolución: línea grande con puntos",
              js("return !!window.chartEvolucion && window.chartEvolucion.data.datasets[0].data.length >= 2"))
        check("Evolución: tabla con 7 columnas",
              js("return document.querySelectorAll('#tabla-meses thead th').length === 7"))
        check("Evolución: tabla con varios meses",
              js("return document.querySelectorAll('#tabla-meses tbody tr').length >= 2"))
        check("Evolución: 4 tarjetas de insight",
              js("return document.querySelectorAll('#insights .insight').length === 4"))
        check("Evolución: composición por cuenta",
              js("return !!window.chartComposicion && window.chartComposicion.data.datasets.length >= 1"))
        check("Evolución: categorías en el tiempo",
              js("return !!window.chartCatsTiempo && window.chartCatsTiempo.data.datasets.length >= 1"))

        # ---- FASE 3: Ajustes ----
        ir(d, "ajustes")
        check("Ajustes: 12 chips de moneda base",
              js("return document.querySelectorAll('#aj-base-monedas .chip').length === 12"))
        check("Ajustes: tabla de tasas (11 filas)",
              js("return document.querySelectorAll('#aj-tasas-lista .tasa-fila').length === 11"))
        check("Ajustes: badge 'sin tasa' presente (ARS)",
              js("return !!document.querySelector('#aj-tasas-lista .tf-badge.sintasa')"))
        check("Ajustes: lista de cuentas",
              js("return document.querySelectorAll('#aj-cuentas-lista .aj-item').length >= 5"))
        check("Ajustes: lista de categorías",
              js("return document.querySelectorAll('#aj-cats-lista .aj-item').length >= 5"))
        check("Ajustes: chip de tema 'auto' activo (headless = oscuro)",
              js("return document.querySelector('#aj-tema .chip[data-tema=\"auto\"]').classList.contains('activa')"))
        check("Ajustes: enlace a la hoja con href",
              js("return (document.getElementById('aj-hoja').getAttribute('href')||'').indexOf('http')===0"))

        # ---- Cambiar la moneda base a USD re-formatea todo ----
        pat_cop = js("return datos.patrimonio")  # en COP
        js("""var chips=document.querySelectorAll('#aj-base-monedas .chip');
               for(var i=0;i<chips.length;i++){if(chips[i].textContent.indexOf('USD')===0){chips[i].click();break;}}""")
        time.sleep(1.2)
        check("Ajustes: moneda base = USD", js("return datos.monedaBase === 'USD'"))
        ir(d, "resumen")
        pat_usd_txt = d.find_element(By.ID, "txt-patrimonio").text
        check("Panel: patrimonio ahora en US$", "US$" in pat_usd_txt)
        esperado_usd = round(pat_cop / 4000.0)
        # extraer el entero del texto "US$ 1.756,31USD"
        import re
        m = re.search(r"[\d.]+", pat_usd_txt.replace("US$", "").strip())
        val_usd = int(m.group(0).replace(".", "")) if m else 0
        check("Panel: conversión USD correcta (%d ~ %d)" % (val_usd, esperado_usd),
              abs(val_usd - esperado_usd) <= 1)
        # Volver a COP
        ir(d, "ajustes")
        js("""var chips=document.querySelectorAll('#aj-base-monedas .chip');
               for(var i=0;i<chips.length;i++){if(chips[i].textContent.indexOf('COP')===0){chips[i].click();break;}}""")
        time.sleep(1.2)
        check("Ajustes: vuelve a COP", js("return datos.monedaBase === 'COP'"))

        # ---- Categoría: ocultar la quita de los chips de Registrar ----
        ir(d, "ajustes")
        js("document.querySelector('#aj-cats-lista .aj-item').click();")  # primera categoría
        time.sleep(0.5)
        check("Cat editor: picker de emoji con grilla",
              js("return document.querySelectorAll('#cat-emoji-grid button').length >= 24"))
        catname = js("return document.getElementById('cat-nombre').value")
        js("document.getElementById('cat-oculta').checked = true;")
        js("document.getElementById('cat-guardar').click();")
        time.sleep(1.3)
        check("Cat: quedó en catsOcultas",
              js("return (datos.catsOcultas||[]).indexOf(%r) >= 0" % catname))
        abrir_registrar(d)
        chips_cat = js("return Array.from(document.querySelectorAll('#chips-categoria .chip')).map(function(c){return c.textContent;}).join('|')")
        check("Registrar: la categoría oculta NO está en los chips", catname not in chips_cat)

        # ---- REGRESIONES v8.1 ----
        d.get(URL + "#cuenta/Billetera")
        time.sleep(1.2)
        check("v8.1: equivalente OCULTO de verdad en cuenta = base (COP)",
              not d.execute_script(VISIBLE, "cd-equiv"))
        check("v8.1: equivalente sin texto viejo",
              js("return document.getElementById('cd-equiv').textContent === ''"))

        ir(d, "resumen")
        deudas_txt = d.find_element(By.ID, "lista-deudas").text
        check("v8.1: equivalente de deuda USD en positivo (sin '≈ $ -')",
              "US$" in deudas_txt and "≈ $ -" not in deudas_txt)

        # Barras: totales "Por mes" == "Por día" del mes en curso (conversión de monedas)
        totales = js("""
            var mesHoy = datos.hoy.substring(0,7);
            var m = datos.resumen.meses.filter(function(x){return x.mes===mesHoy;})[0];
            var dias = datosDiariosMes();
            var sumI=0,sumG=0; dias.forEach(function(d){sumI+=d.ingresos; sumG+=d.gastos;});
            return [Math.round(m.ingresos), Math.round(sumI), Math.round(m.gastos), Math.round(sumG)];
        """)
        check("v8.1: ingresos Por mes == suma Por día (%d vs %d)" % (totales[0], totales[1]),
              abs(totales[0] - totales[1]) <= 1)
        check("v8.1: gastos Por mes == suma Por día (%d vs %d)" % (totales[2], totales[3]),
              abs(totales[2] - totales[3]) <= 1)

        # ---- Capturas visuales (claro y oscuro, móvil y desktop) ----
        import os
        base = os.path.dirname(os.path.abspath(__file__))
        ir(d, "resumen"); time.sleep(0.5)
        d.save_screenshot(os.path.join(base, "cap_panel_oscuro.png"))  # headless arranca oscuro
        ir(d, "ajustes"); time.sleep(0.5)
        d.save_screenshot(os.path.join(base, "cap_ajustes_oscuro.png"))
        ir(d, "meses"); time.sleep(0.5)
        d.save_screenshot(os.path.join(base, "cap_evolucion_oscuro.png"))
        # Cambiar a claro por Ajustes → Apariencia
        ir(d, "ajustes"); time.sleep(0.3)
        js("document.querySelector('#aj-tema .chip[data-tema=\"claro\"]').click();")
        time.sleep(0.5)
        ir(d, "resumen"); time.sleep(0.5)
        d.save_screenshot(os.path.join(base, "cap_panel_claro.png"))

        d.set_window_size(1280, 900); time.sleep(0.6)
        ir(d, "resumen"); time.sleep(0.5)
        d.save_screenshot(os.path.join(base, "cap_panel_desktop.png"))
        ir(d, "meses"); time.sleep(0.5)
        d.save_screenshot(os.path.join(base, "cap_evolucion_desktop.png"))
        print("Capturas guardadas en preview/ (cap_*.png)")

    finally:
        d.quit()

    print("\n" + ("TODO OK" if not fallos else ("FALLOS: " + ", ".join(fallos))))
    sys.exit(1 if fallos else 0)

if __name__ == "__main__":
    main()
