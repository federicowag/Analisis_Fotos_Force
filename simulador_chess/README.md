# Simulador de pedidos (Chess ERP)

Página para que los promotores armen un pedido de prueba para un cliente de LIFA o
DELORENZI y vean el precio final con las acciones comerciales que le aplican.

```
Chess (lifa AR461 / delorenzi AR462)
   │  GET /web/api/...  (solo lectura, usuario web)
   ▼
extraer.py  ──►  pagina/data/lifa.json, pagina/data/delorenzi.json
                        │
                        ▼
              pagina/index.html (publicada como Artifact en claude.ai)
```

La página no habla con Chess: lee los JSON que se publican con ella. Una tarea
programada corre `extraer.py` todas las mañanas y vuelve a publicar la página con
los datos nuevos.

## Qué baja `extraer.py`

Por distribuidora, en un JSON de ~450 KB:

| Clave | Contenido |
|---|---|
| `clientes` | `[id, razón social, fantasía, domicilio, lista, IVA, exento IIBB]` de los clientes activos |
| `listas` | Las listas de precios que usan esos clientes, en su vigencia actual. Por artículo: `[precio, bonif. de lista %, internos, alícuota IVA]` |
| `articulos` | `codart → [descripción, unidades por bulto]` |
| `acciones` | Acciones vigentes: grupos de clientes (local y compañía), orígenes, requerimiento y escalas con sus beneficios |
| `combos` | Combos vigentes con composición y grupos de clientes |
| `gp` / `gc` | Grupos de productos y de clientes con sus miembros ya resueltos |

No exporta costos, márgenes, CUIT, teléfonos ni mails.

Los grupos de productos definidos por atributo (marca, calibre, sabor…) Chess no los
devuelve resueltos: el script los arma con `articulos/obtenerAtributosArt`. Las formas
que no están cargadas en la instancia (hoy `UNIDAD DE NEGOCIO`) se ignoran y el grupo
queda listado en `avisos.gp_aproximados`.

## Cómo calcula la página

- Una acción aplica si está vigente hoy, si incluye el **canal** elegido (Preventa,
  BEES, …) en sus orígenes, y si el cliente está en el grupo local **y** en el de compañía.
- La escala se elige por la suma de bultos del pedido en el grupo de requerimiento
  (unidades sueltas cuentan como fracción de bulto).
- Todas las acciones de estas instancias tienen `bonifica = SUMA`: los % se suman.
- Precio final por bulto = precio × (1 − bonif. lista) × (1 − Σ %) × (1 + IVA) + internos.
  Sin acciones, la fórmula reproduce exactamente el `prefin` de Chess.
- No incluye percepción de IIBB ni límites de bultos por cliente.

## Correrlo a mano

```bash
pip install requests python-dotenv
export CHESS_WEB_USER=...        # usuario web de Chess
export CHESS_WEB_PASSWORD=...
python simulador_chess/extraer.py --salida simulador_chess/pagina/data
```

Para probar la página local: `cd simulador_chess/pagina && python -m http.server`
(la página espera el esqueleto `<html><body>` que agrega claude.ai; en local el
navegador lo completa solo).

Si una distribuidora usa otro usuario: `CHESS_WEB_USER_DELORENZI` /
`CHESS_WEB_PASSWORD_DELORENZI`.

## Actualización diaria

La tarea programada de claude.ai:
1. hace checkout de esta rama,
2. corre `extraer.py --salida simulador_chess/pagina/data`,
3. republica el Artifact con `pagina/index.html` y los dos JSON.

Las credenciales se leen de las variables de entorno del entorno cloud
(`CHESS_WEB_USER`, `CHESS_WEB_PASSWORD`). Nunca van en el repo ni en el prompt de la tarea.
`pagina/data/` y `.env` están en `.gitignore` porque tienen datos de clientes.
