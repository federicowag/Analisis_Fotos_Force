"""
Extrae de Chess ERP todo lo que necesita el simulador de pedidos y lo deja en
un JSON compacto por distribuidora (salida/<dist>.json).

Solo lectura: login de formulario del front web y GET a /web/api/...

Que baja, por distribuidora:
  - clientes activos (id, nombre, fantasia, domicilio, lista de precios, IVA, IIBB)
  - las listas de precios que usan esos clientes, en su vigencia actual
  - acciones comerciales vigentes con escalas y beneficios
  - combos vigentes con su composicion
  - grupos de productos (incluidos los definidos por marca / calibre / sabor /
    unidad de negocio / articulo, que Chess no devuelve resueltos)
  - grupos de clientes con sus miembros
  - tasas de percepcion de IVA / IIBB y los RI excluidos de la de IVA, tomados de
    los pedidos recientes

No se exportan costos, margenes, CUIT, telefonos ni mails.

Credenciales por variables de entorno (o un .env al lado del script):
    CHESS_WEB_USER, CHESS_WEB_PASSWORD
    opcionales por distribuidora: CHESS_WEB_USER_LIFA, CHESS_WEB_PASSWORD_LIFA, ...

Uso:
    python extraer.py                     # todas las distribuidoras
    python extraer.py --solo lifa
    python extraer.py --salida /tmp/datos
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv es opcional si las variables ya estan en el entorno
    load_dotenv = None

BASE = Path(__file__).parent

DISTRIBUIDORAS = {
    "lifa": {"nombre": "LIFA", "url": "https://lifa.chesserp.com/AR461"},
    "delorenzi": {"nombre": "DELORENZI", "url": "https://delorenzi.chesserp.com/AR462"},
}

ARG = timezone(timedelta(hours=-3))
RE_ID_GRUPO = re.compile(r"^\s*(\d+)\s*-")


class Chess:
    def __init__(self, base_url, usuario, password):
        self.base = base_url.rstrip("/")
        self.usuario = usuario
        self.password = password
        self.s = requests.Session()
        self.logueado = False

    def login(self):
        r = self.s.post(f"{self.base}/static/auth/j_spring_security_check",
                        data={"j_username": self.usuario, "j_password": self.password},
                        headers={"Accept": "application/json, text/plain, */*"}, timeout=30)
        if r.status_code != 200:
            sys.exit(f"Login rechazado ({r.status_code}) en {self.base}")
        if self.s.get(f"{self.base}/web/api/sesion/getSessionInfo", timeout=30).status_code == 403:
            sys.exit(f"{self.usuario} no tiene acceso al front web de {self.base} (403)")
        self.logueado = True

    def get(self, endpoint, **params):
        if not self.logueado:
            self.login()
        for intento in range(3):
            try:
                r = self.s.get(f"{self.base}/web/api/{endpoint}", params=params,
                               headers={"Accept": "application/json"}, timeout=180)
                if r.status_code in (401, 403) and intento == 0:
                    self.login()
                    continue
                r.raise_for_status()
                return r.json()
            except requests.RequestException:
                if intento == 2:
                    raise
                time.sleep(2 * (intento + 1))


def lista(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def id_int(v):
    try:
        return int(v) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def ref(fila):
    """Referencia compacta de un requerimiento/beneficio: 'G<id>' grupo de producto,
    'A<codart>' articulo suelto."""
    tipo = fila.get("idformaagrupar") or ""
    i = id_int(fila.get("idagrupacion"))
    if i is None:
        return None
    return f"G{i}" if tipo == "GP" else f"A{i}" if tipo == "" else None


def bajar_acciones(chess, ids_gc, ids_gp):
    filas = lista(chess.get("promociones/listadoPromociones", plVigente="true").get("ePromosActipro"))
    acciones = []
    for a in filas:
        cod = a["codpromo"]
        ds = chess.get("promociones/obtenerPromo", picodpromo=cod, piidactipro=1).get("dsPromos", {})
        cab = (lista(ds.get("ePromos")) or [{}])[0]
        if cab.get("anulado"):
            continue
        gc = id_int(cab.get("idgrupoclientes"))
        gcc = id_int(a.get("idgrupoclientescia"))
        ids_gc.update(g for g in (gc, gcc) if g)
        req = [r for r in (ref(x) for x in lista(ds.get("eProreq"))) if r]
        escalas = []
        for e in lista(ds.get("eCantreq")):
            ben = [[r, float(b.get("bonif") or 0)] for b in lista(e.get("eProrega"))
                   if (r := ref(b))]
            escalas.append([float(e.get("cantreq") or 0), ben])
        escalas.sort(key=lambda x: x[0])
        for r in req + [b[0] for e in escalas for b in e[1]]:
            if r[0] == "G":
                ids_gp.add(int(r[1:]))
        acciones.append({
            "c": cod,
            "d": (cab.get("descpromo") or a.get("descpromo") or "").strip(),
            "ini": cab.get("fechaini"),
            "fin": cab.get("fechacie"),
            "org": [o.strip() for o in str(cab.get("origenes") or "").split(",") if o.strip()],
            "gc": gc,
            "gcc": gcc,
            "tipo": cab.get("dstipoaccion") or "",
            "lim": cab.get("limitebultos") or 0,
            "req": req,
            "esc": escalas,
        })
    return acciones


def bajar_combos(chess, ids_gc):
    filas = lista(chess.get("articulos/obtenerDatosCombos", plAnulados="false",
                            plFinalizados="false").get("eArticulos"))
    combos = []
    for c in filas:
        cod = c["codart"]
        det = chess.get("articulos/obtenerCombo", piCombo=cod)
        comp = lista(det.get("dsArticulos", {}).get("eCombos"))
        gc, gcc = (int(m.group(1)) if m else None for m in (
            RE_ID_GRUPO.match(str(c.get("dsgrupocliente") or "")),
            RE_ID_GRUPO.match(str(c.get("dsgrupoclientecia") or ""))))
        ids_gc.update(g for g in (gc, gcc) if g)
        combos.append({
            "c": cod,
            "d": (c.get("descrip") or "").strip(),
            "gc": gc,
            "gcc": gcc,
            "desde": c.get("vigenciadesde"),
            "hasta": c.get("vigenciahasta"),
            "comp": [[x.get("codart"), (x.get("dsart") or "").strip(), x.get("cant") or 0,
                      x.get("resto") or 0, x.get("bonificacion") or 0] for x in comp],
        })
    return combos


def atributos_por_forma(chess, forma, cache):
    """{codart: descripcion del atributo} para una forma de agrupar (MARCA, CALIBRE...)."""
    if forma not in cache:
        filas = lista(chess.get("articulos/obtenerAtributosArt ", pcFormAgrArt=forma,
                                piGrupoProduc=0, plSinAg="false").get("eArticulosGrupo"))
        cache[forma] = {f["codart"]: (f.get("atributo1") or "").strip().upper() for f in filas}
    return cache[forma]


def resolver_por_reglas(chess, reglas, codarts, cache):
    """Chess no devuelve los miembros de los grupos definidos por atributos.
    Mismas formas = OR, formas distintas = AND, negado = excluye."""
    por_forma = {}
    for r in reglas:
        por_forma.setdefault(r.get("idformaagrupar") or "", []).append(r)
    miembros, aproximado = set(codarts), False
    for forma, rs in por_forma.items():
        if forma and not any(atributos_por_forma(chess, forma, cache).values()):
            # la forma no esta cargada en esta instancia (p.ej. UNIDAD DE NEGOCIO): se ignora
            aproximado = True
            continue
        if forma == "":
            si = {id_int(r["idagrupacion"]) for r in rs if not r.get("negado")}
            no = {id_int(r["idagrupacion"]) for r in rs if r.get("negado")}
        else:
            attr = atributos_por_forma(chess, forma, cache)
            def match(rr):
                ds = (rr.get("dsagrupacion") or "").strip().upper()
                return {c for c, v in attr.items() if v and v == ds}
            si = set().union(*[match(r) for r in rs if not r.get("negado")]) if any(
                not r.get("negado") for r in rs) else set(codarts)
            no = set().union(*[match(r) for r in rs if r.get("negado")]) if any(
                r.get("negado") for r in rs) else set()
        miembros &= (si - no)
    return miembros, aproximado


def resolver_grupos_productos(chess, ids, codarts):
    grupos, sin_resolver, aproximados, cache = {}, [], [], {}
    for gid in sorted(ids):
        d = chess.get("gruposProductos/obtenerGrupoProducto", piGrup=gid)
        cab = (lista(d.get("dsGruposProductos", {}).get("eGruposProductos")) or [{}])[0]
        miembros = {x.get("codart") for x in lista(d.get("eArticulosGrupo"))}
        reglas = lista(cab.get("eRlArticulosGrupos"))
        if not miembros and reglas:
            miembros, aprox = resolver_por_reglas(chess, reglas, codarts, cache)
            if aprox:
                aproximados.append(gid)
        if not miembros:
            # sin articulos en las listas de precios de la distribuidora
            sin_resolver.append(gid)
        grupos[str(gid)] = {"d": (cab.get("dsgrupoproductos") or "").strip(),
                            "a": sorted(m for m in miembros if m)}
    return grupos, sin_resolver, aproximados


def resolver_grupos_clientes(chess, ids):
    grupos = {}
    for gid in sorted(ids):
        d = chess.get("gruposClientes/obtenerGrupoClientes", piGrup=gid)
        cab = (lista(d.get("dsGruposClientes", {}).get("eGruposClientes")) or [{}])[0]
        grupos[str(gid)] = {"d": (cab.get("dsgrupoclientes") or "").strip(),
                            "c": sorted({x.get("idcliente") for x in lista(d.get("eClientesGrupo"))
                                         if x.get("idcliente") is not None})}
    return grupos


def bajar_listas(chess, ids_listas, hoy):
    vig = lista(chess.get("precios/obtenerVigenciasListas", plVigente="true",
                          pdFechaDesde="", pdFechaHasta="").get("eListaPrecios"))
    listas, articulos = {}, {}
    for lid in sorted(ids_listas):
        cands = [v for v in vig if v.get("listaspre") == lid and not v.get("anulada")
                 and (v.get("fecvigenciadesde") or "")[:10] <= hoy
                 and (not v.get("fecvigenciahasta") or v["fecvigenciahasta"][:10] > hoy)]
        if not cands:
            print(f"      lista {lid}: sin vigencia actual", file=sys.stderr)
            continue
        v = max(cands, key=lambda x: x["fecvigenciadesde"])
        filas = lista(chess.get("precios/obtenerListaPrecios", piLis=lid, piVig=v["idvigencia"],
                                plPre="false", pcFag="").get("dsPrecios", {}).get("ePrecios"))
        precios = {}
        for f in filas:
            # las filas con 'anulado' son articulos dados de baja
            if f.get("anulado") is not None or not f.get("precio"):
                continue
            bon = float(f.get("bonificacion") or 0)
            neto = f["precio"] * (1 - bon / 100)
            iva = f.get("iva1", 0) / neto if neto and f.get("iva1") else 0.21
            iva = min((0.0, 0.105, 0.21, 0.27), key=lambda t: abs(t - iva))  # redondeo de centavos
            precios[f["codart"]] = [round(f["precio"], 2), bon, round(f.get("interfij") or 0, 2), iva]
            articulos[f["codart"]] = [(f.get("descrip") or "").strip(), f.get("resto") or 1]
        listas[str(lid)] = {"titulo": (v.get("titulis") or "").strip(),
                            "desde": v.get("fecvigenciadesde"), "hasta": v.get("fecvigenciahasta"),
                            "p": precios}
    return listas, articulos


PERC_IVA = 0.03          # percepcion de IVA a responsables inscriptos
PERC_IVA_MIN_NETO = 100000  # Chess no la aplica en pedidos de menor neto (observado en pedidos reales)
PERC_IIBB = 0.03         # percepcion de IIBB sobre neto + internos, a clientes no exentos


def percepciones(chess):
    """Tasas de percepcion y RI excluidos de la de IVA, aprendidos de los pedidos
    recientes de Chess: un RI con pedidos por encima del minimo que nunca tuvo
    percepcion de IVA se toma como excluido (certificado de exclusion)."""
    filas = lista(chess.get("pedidos/listadoPedidos", piSkip=0, piTop=1000, pcFil="", pcOrd="",
                            pcusr=chess.usuario).get("dsCarga", {}).get("eCarga"))
    visto = {}
    for r in filas:
        if r.get("tipoiva") != "RI" or (r.get("netogra") or 0) < PERC_IVA_MIN_NETO:
            continue
        visto.setdefault(r["idcliente"], []).append(bool(r.get("iva2")))
    return {
        "iva": PERC_IVA,
        "iva_min_neto": PERC_IVA_MIN_NETO,
        "iibb": PERC_IIBB,
        "iva_excluidos": sorted(c for c, v in visto.items() if not any(v)),
        "pedidos_analizados": len(filas),
    }


def extraer(clave, conf, usuario, password):
    chess = Chess(conf["url"], usuario, password)
    hoy = datetime.now(ARG).date().isoformat()
    t0 = time.time()
    print(f"[{conf['nombre']}] clientes...")
    cli = lista(chess.get("clientes/obtener", anulado="false",
                          fields="idcliente,nomcli,fantacli,domicli,codlipre,tipoiva,exenbru,anulado")
                .get("dsCli", {}).get("eClientesBE"))
    clientes = [[c["idcliente"], (c.get("nomcli") or "").strip(), (c.get("fantacli") or "").strip(),
                 (c.get("domicli") or "").strip(), c.get("codlipre") or 0, c.get("tipoiva") or "",
                 bool(c.get("exenbru"))] for c in cli if not c.get("anulado")]
    print(f"[{conf['nombre']}] listas de precios...")
    listas, articulos = bajar_listas(chess, {c[4] for c in clientes if c[4]}, hoy)
    ids_gc, ids_gp = set(), set()
    print(f"[{conf['nombre']}] acciones...")
    acciones = bajar_acciones(chess, ids_gc, ids_gp)
    print(f"[{conf['nombre']}] combos...")
    combos = bajar_combos(chess, ids_gc)
    print(f"[{conf['nombre']}] {len(ids_gp)} grupos de producto...")
    todos = {int(c) for l in listas.values() for c in l["p"]}
    gp, sin_resolver, aproximados = resolver_grupos_productos(chess, ids_gp, todos)
    print(f"[{conf['nombre']}] {len(ids_gc)} grupos de clientes...")
    gc = resolver_grupos_clientes(chess, ids_gc)
    print(f"[{conf['nombre']}] percepciones...")
    perc = percepciones(chess)
    return {
        "dist": clave,
        "nombre": conf["nombre"],
        "generado": datetime.now(ARG).isoformat(timespec="minutes"),
        "clientes": clientes,
        "listas": listas,
        "articulos": articulos,
        "acciones": acciones,
        "combos": combos,
        "gp": gp,
        "gc": gc,
        "percepciones": perc,
        "avisos": {"gp_sin_articulos": sin_resolver, "gp_aproximados": aproximados},
        "segundos": round(time.time() - t0),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--solo", choices=sorted(DISTRIBUIDORAS), action="append")
    ap.add_argument("--salida", default=str(BASE / "salida"))
    args = ap.parse_args()
    if load_dotenv:
        load_dotenv(BASE / ".env")
    out = Path(args.salida)
    out.mkdir(parents=True, exist_ok=True)
    for clave in args.solo or DISTRIBUIDORAS:
        conf = DISTRIBUIDORAS[clave]
        u = os.getenv(f"CHESS_WEB_USER_{clave.upper()}") or os.getenv("CHESS_WEB_USER")
        p = os.getenv(f"CHESS_WEB_PASSWORD_{clave.upper()}") or os.getenv("CHESS_WEB_PASSWORD")
        if not (u and p):
            sys.exit("Faltan CHESS_WEB_USER / CHESS_WEB_PASSWORD en el entorno")
        data = extraer(clave, conf, u, p)
        destino = out / f"{clave}.json"
        destino.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        print(f"OK {conf['nombre']}: {len(data['clientes'])} clientes, {len(data['listas'])} listas, "
              f"{len(data['acciones'])} acciones, {len(data['combos'])} combos, "
              f"{len(data['avisos']['gp_sin_articulos'])} grupos sin articulos en lista, "
              f"{len(data['avisos']['gp_aproximados'])} aproximados -> {destino} "
              f"({destino.stat().st_size // 1024} KB, {data['segundos']} s)")


if __name__ == "__main__":
    main()
