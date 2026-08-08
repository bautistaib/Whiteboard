# Whiteboard TTRPG — Documentación de desarrollo

Documentación técnica del proyecto. Para la experiencia del DM, ver [README.md](../README.md). La fuente de verdad del scope es [`docs/SPEC-whiteboard-ttrpg.md`](./SPEC-whiteboard-ttrpg.md).

## Stack

| Pieza | Tecnología |
|---|---|
| Backend | Python 3.12, FastAPI, WebSockets nativos de Starlette |
| Persistencia | SQLite (WAL) vía SQLModel/SQLAlchemy + imágenes WebP en disco (`$DATA_DIR`) |
| Frontend | React 18 + TypeScript + Konva (react-konva), zustand, Vite |
| Deploy | Un solo contenedor Docker (multi-stage): el backend sirve el bundle estático |
| Exposición | `cloudflared` quick tunnel como subproceso del backend |

## Layout del repo

```
Whiteboard/
  Dockerfile                  multi-stage: node build de web/ → runtime python + cloudflared
  docker-compose.yml          el archivo que baja el DM
  .github/workflows/publish.yml   build+push a GHCR en tags v*
  server/
    app/
      main.py                 app factory, REST, estáticos (SPA), lifespan (DB + túnel)
      config.py               DATA_DIR, TUNNEL, PORT (env)
      db.py                   modelos SQLModel + engine WAL + repo (load_all/upsert/delete)
      state.py                estado autoritativo en memoria + dirty tracking + flush ~1 s
      ws.py                   endpoint WS, salas por campaña, dispatch de ops, snapshots
      ops.py                  validación de permisos, aplicación, generación de inversas
      undo.py                 pilas de undo/redo por usuario (solo memoria, cap 50)
      grid.py                 GridSystem: SquareGrid + HexGrid (axial, flat/pointy)
      uploads.py              validación + recompresión WebP (mapas ≤4096, tokens ≤512, 10 MB)
      tunnel.py               subproceso cloudflared, parseo de URL, reintento automático
    tests/                    pytest (75 tests)
  web/
    src/
      store.ts                zustand: snapshot de escena, presence, cámara, selección, tools
      ws.ts                   cliente WS: reconexión con backoff, cola de ops pre-snapshot
      api.ts                  REST helpers
      grid/                   GridSystem del cliente (espejo del server)
      components/Board.tsx    Stage Konva: pan/zoom, herramientas, drop desde biblioteca
      components/             capas (Background/Grid/Draw/AoE/Token/Overlay) + UI
                              (SelectionTransformer: rotación libre; objectBounds: bbox por tipo)
```

## Arquitectura

### Estado y persistencia

- El **estado autoritativo vive en memoria** en el server (`state.py`: dicts de campañas, escenas, objetos, assets, personajes).
- SQLite es **write-through con debounce (~1 s)**: cada mutación marca la fila como dirty y un loop la flushea (`asyncio.to_thread` para no bloquear el event loop). También se flushea al apagar.
- Al arrancar, `load_all()` reconstruye el estado completo desde la DB.
- Las pilas de **undo son solo memoria** (se pierden al reiniciar — decisión aceptada en el spec).
- Esquema exactamente como el spec §Modelo de datos; `data_json` guarda geometría/props por tipo de objeto.

### Sincronización

Server-autoritativo, snapshot + deltas (sin CRDT):

1. Cliente conecta a `/ws/<token>?name=&clientId=` → server resuelve `(campaña, rol)` desde el token.
2. Server envía `scene.snapshot` (escena activa: grilla, fondo, todos los objetos, usuarios, biblioteca). El DM recibe además `tunnel.url`.
3. De ahí en más, **ops**: el cliente envía `{type, opId(uuid), payload}`; el server valida permisos, aplica, persiste (dirty) y **broadcastea a toda la sala incluido el emisor** (ack implícito), con `seq` monotónico por sala.
4. **Optimistic updates solo para drags propios** (fluidez); el resto espera el broadcast.
5. Reconexión: backoff exponencial; al reconectar llega snapshot fresco que **pisa el estado local**; las ops se encolan hasta que llega el snapshot (nunca se envían antes).
6. Creates llevan uuid generado por el cliente → retries idempotentes.
7. **La escena activa se re-resuelve en cada mensaje** (`state.active_scene`), no se ata a la conexión: un `scene.switch` del DM no puede dejar conexiones operando sobre la escena vieja.
8. Cierres fatales: `4401` (token inválido) y `4409` (campaña borrada / sin escena activa) **no se reconectan**; el cliente muestra el motivo.

### Catálogo de ops

Objetos (persisten, entran al undo):

| Op | Payload | Notas |
|---|---|---|
| `token.add` | `{id, data}` | data: x, y, asset_id, character_id, active_variant_id, size_cells, name, show_name, rotation, badges |
| `token.move` | `{id, x, y}` | throttled ~30 Hz en drag; posición final garantizada al soltar |
| `token.update` | `{id, patch}` | merge sobre data |
| `token.remove` | `{id}` | |
| `token.duplicate` | `{id, newId, x, y}` | broadcast normalizado como `token.add` |
| `token.setVariant` | `{id, variantId}` | server resuelve asset_id/size_cells de la variante |
| `draw.add/update/remove` | | paths del lápiz; `update` mueve el trazo (patch x/y) |
| `shape.add/update/remove` | | rect/circle/line/arrow |
| `text.add/update/remove` | | |
| `aoe.add/update/remove` | | circle/cone/line, size_cells, rotation |
| `group.add/update/remove` | | dibujo compuesto (Fusionar selección); `update` mueve/transforma el grupo entero |
| `image.add/update/remove` | | imagen pegada en la capa de dibujos (resultado del balde de pintura); data: url, x, y, w, h |
| `batch` | `{ops: [{type, payload}, ...]}` | 1–16 sub-ops de objetos, validación atómica (todo o nada), UNA entrada de undo; se broadcastea como una sola op `batch`. Sin batches anidados |

Límite de tamaño: el server rechaza cualquier op cuyo payload JSON supere **256 KB** (`MAX_PAYLOAD_BYTES` en `ops.py`).

Escena (solo DM, no entran al undo): `scene.switch/create/rename/delete/setGrid/setBackground`. `switch` manda snapshot fresco a toda la sala; el resto manda `scene.update`. `delete` borra la escena con sus objetos; no permite borrar la escena activa ni la última. `switch`/`rename`/`delete` a una escena inexistente se rechazan con error limpio (no tumban la conexión).

Meta: `undo` / `redo`.

Efímeras (no persisten, no entran al undo): `cursor.move`, `ping`, `camera.sync` (solo DM, relay a seguidores), `heartbeat`.

### Permisos

- **DM**: todo.
- **Jugador**: dibuja, crea tokens, sube a la biblioteca. Mueve/modifica **sus** objetos; tokens ajenos solo si la escena tiene `playersMoveAny` (toggle del DM en la config de grilla). Borra solo objetos propios. No toca escenas ni la cámara de otros.
- La validación está en `ops.validate()`; el cliente además oculta/deshabilita lo prohibido, pero el server es la autoridad.

### Heurísticas para features de dibujo (leer antes de agregar herramientas)

- **Un op por trazo terminado**: no hay streaming de trazos en progreso — el cliente dibuja un preview local y manda `draw.add` recién al soltar. El requisito de sync (<200 ms) aplica al trazo completo.
- **`data_json` es verbatim**: el server guarda el JSON sin validar campos → agregar campos por trazo es gratis del lado del server; el costo real está en el render del cliente. Convención: campos opcionales **omitidos cuando tienen el valor default** (`opacity`, `dash`, `filled`, `blend`, `widths`, `spray`) → compatibilidad con escenas y clientes viejos.
- **Renderizar como nodo Konva = gratis todo lo demás**: selección, Transformer, export PNG y "convertir en token" funcionan para cualquier cosa que sea un nodo Konva registrado.
- **Tocar la geometría de `path` tiene costos ocultos**: hay que actualizar render (DrawLayer + GroupPart), `objectBounds.ts` y el borrador parcial (transform a coords locales + split en segmentos). Ejemplo: `widths` (ancho variable) se rebana por índice de punto al dividir en runs.
- **Caps de payload** (defensa ante herramientas que generan muchos datos): 256 KB por op (server), 3000 dots por trazo de spray (`MAX_SPRAY_POINTS`), 16 sub-ops por batch, 4000 puntos máx. para ancho variable.
- **Clasificación de cambios por costo**: *input-side* (procesar el puntero antes de generar puntos: estabilizador, shift-snap — no tocan nada más) < *render-side* (flags que solo cambian cómo se dibuja: `opacity`, `blend`, `dash`) < *geometry-side* (cambian el modelo de puntos: `widths`, `spray`).

### Interacciones del canvas (patrones de UX)

- **Pan**: arrastre con click derecho sobre canvas vacío (cualquier herramienta), herramienta ✋, o rueda para zoom. El menú contextual sigue siendo click derecho *sobre un objeto*.
- **Altas optimistas**: draw/shape/text/aoe/token se insertan en el store local al crear (uuid del cliente); el eco del broadcast los pisa con el mismo id → sin flash.
- **Texto**: click con la herramienta T abre un `<textarea>` inline sobre el canvas (Enter confirma, Esc cancela, blur confirma); doble click en un texto existente lo edita (`text.update`).
- **Borrador**: click simple = borrar objeto entero; arrastre = borrado parcial de trazos (los puntos del path bajo el cursor se eliminan y el path se divide en segmentos). Todo el borrado parcial se manda como **un `batch`** (remove + adds, troceado de a 16 si hay muchos segmentos) → un solo Ctrl+Z lo deshace. En trazos `spray` se borran dots individuales (sin split); en trazos con `widths` cada segmento hereda su rebanada de `widths`. `eraseFlag.ts` evita que el click posterior al arrastre borre el objeto entero por accidente. Tiene su propio tamaño (`eraserWidth`, 2–64), independiente del grosor de dibujo.
- **Modo avanzado de dibujo** (toggle 🎨 en la toolbar, `advancedMode`): habilita las herramientas **spray** (S) y **balde de pintura** (F) y secciones extra del panel: **estabilizador** (el pincel persigue al puntero con factor 1−s; input-side, no cambia el modelo), **ancho por presión/velocidad** (presión real de stylus vía PointerEvent; con mouse se simula por velocidad; guarda `widths` por punto y renderiza polígono cónico — `draw/ink.ts`), **mezcla** (`blend`: multiply/screen → `globalCompositeOperation`), **simetría** (espejo/cuádruple sobre el centro del viewport; las copias se mandan como un `batch` de `draw.add`), **tolerancia** del balde. El **balde** flood-fillea el canvas compuesto del stage (`draw/fill.ts`), sube el PNG recortado como asset (kind "map") y lo coloca como objeto `image` en la capa de dibujos. **Cuentagotas**: Alt+click con cualquier herramienta de dibujo fija el color sampleando el canvas. **Shift** restringe formas: línea/flecha a 45°, rect/circle a cuadrado/círculo perfecto.
- **Opciones de herramienta**: panel contextual (`ToolOptionsPanel`) con secciones por herramienta: color, grosor, opacidad (0.1–1), trazo sólido/punteado (`drawLineStyle`) y relleno (`shapeFill`, solo rect/circle), con preview SVG del trazo arriba. El **resaltador** (marker) es una herramienta aparte con sus propios `markerColor`/`markerWidth`/`markerOpacity`. Todos los valores se persisten en localStorage (claves `ttrpg:*`). En los datos del trazo, los campos `opacity`/`dash`/`filled` se omiten cuando tienen el valor por defecto.
- **Puntos del lápiz**: durante el trazo se descartan puntos por distancia mínima (thinning) y al soltar se simplifica el polyline con Ramer-Douglas-Peucker (`draw/simplify.ts`), así los paths persistidos quedan livianos.
- **Permisos por defecto**: `playersMoveAny` default `true` (cualquiera mueve cualquier token); el DM lo restringe desde el panel de grilla.
- **Drag en grupo**: todos los miembros de la selección streamean su posición (throttled por id), no solo el líder — el grupo se ve moverse en vivo en los demás clientes. Aplica a tokens (`token.move`, en `TokenLayer`) y a dibujos — paths/shapes/text/aoe (`<prefix>.update`, en `useObjectHandlers` con un `groupStart` compartido por capa). Los trazos del lápiz son arrastrables como cualquier objeto.
- **Selección por rectángulo y halo**: usan el bounding box del objeto (`components/objectBounds.ts`), no su origen — imprescindible para los trazos del lápiz, que guardan `x,y` en (0,0) con puntos absolutos. Así se pueden seleccionar las partes de un dibujo y, p. ej., convertirlas juntas en un token.
- **Fusionar selección**: el menú contextual de un objeto fusionable (con ≥2 fusionables seleccionados) crea un objeto `group` con `parts` ({type, data} de paths/shapes/textos, aplanando groups anidados con su traslación) en coords relativas al origen del grupo (centro del bbox combinado); borra los originales. El borrador parcial no toca groups (solo paths sueltos); el click del borrador borra el group entero.
- **Rotación y resize libres**: con un único `aoe`/`shape`/`text`/`path` seleccionado (herramienta select) aparece el Transformer de Konva (`components/SelectionTransformer.tsx`, en su propia capa porque OverlayLayer tiene `listening={false}`). Opera con `rotation` + `scaleX`/`scaleY` + `x`/`y`; como el render aplica esos mismos campos (`common` en DrawLayer, Group en AoELayer), no se "hornea" la geometría por tipo — el patch manda `{x, y, rotation, scaleX, scaleY}` throttled. Los tokens rotan de a 90° por menú contextual (no escalan: usan `size_cells`). Ojo: un path escalado/rotado hace que el borrador parcial transforme su trazo a coords locales (`mundo = (x,y) + rot·scale·punto`) con test elíptico del radio, y los segmentos resultantes heredan `scaleX/scaleY/rotation`.
- **Duplicar**: la celda destino se busca con el `GridSystem` activo (`snap`/`cellOf`), así funciona en cuadrada y hex; el set de celdas ocupadas es compartido entre los clones de un mismo batch (nunca caen dos en la misma celda).
- **Export PNG**: el botón 📷 (Toolbar) captura el `Stage` (registrado en `nodeRegistry` como `"stage"`) vía `toCanvas` y lo compone sobre el `backgroundColor` de la escena — exporta exactamente lo visible en pantalla.

### Undo por usuario

- `ops.compute_inverse()` genera la inversa **antes** de aplicar: crear→borrar, borrar→recrear con snapshot, mover→mover de vuelta, editar→`restore` con snapshot completo previo.
- Pila por `(campaign_id, client_id)`, cap 50, en `undo.py`.
- Ctrl+Z aplica la inversa como **op nueva broadcasteada** (no es rollback global).
- Conflictos (semántica deliberadamente simple): objeto ausente → se descarta esa inversa y se sigue con la anterior; otro lo modificó después → la inversa pisa (last-writer-wins). Las descartadas se loguean.
- Una op nueva vacía la pila de redo.

### Grilla (`GridSystem`)

Interfaz idéntica en server (`app/grid.py`) y cliente (`web/src/grid/`): `cellOf`, `cellCenter`, `snap`, `distance`, `cellsBetween`, y en el cliente `render` (vía GridLayer). El resto del código no sabe qué grilla hay debajo.

- **Cuadrada**: snap al centro de celda; distancia Chebyshev (diagonales = 1); línea supercover para `cellsBetween`.
- **Hexagonal**: coordenadas **axiales** con redondeo cúbico; `cellSize` = ancho visual del hex (flat: `2·size`, pointy: `√3·size`); distancia hexagonal `(|dq|+|dr|+|dq+dr|)/2`, no euclídea; línea por lerp cúbico.
- **Calibración**: `offsetX/offsetY` se aplican antes del redondeo (`cellOf` resta el offset, `cellCenter` lo suma). Es la matemática más delicada del proyecto — está cubierta por tests con casos conocidos (`tests/test_grid.py`); tocarla sin correr esos tests es mala idea.

### REST de campañas y acceso

- `POST /api/campaigns` — crea campaña. Libre para tráfico local o con `dm` (token de DM de una campaña existente) en el body.
- `GET /api/campaigns?dm=<token>` — lista con links de DM/jugador. Misma regla.
- **Regla de acceso local-vs-túnel**: `_can_manage_campaigns` permite si el request es local **o** trae token de DM válido. "Local" = sin headers `Cf-Connecting-Ip`/`Cf-Ray`: el edge de Cloudflare siempre los agrega (y pisa los del cliente) en el tráfico del túnel, así que su ausencia garantiza conexión directa (el DM en su PC, o su LAN). La IP origen no discrimina: cloudflared conecta desde 127.0.0.1 igual que un navegador local. Así la home del DM siempre funciona en su máquina aunque no tenga el token guardado, y un jugador que abra la home por el túnel recibe 403. La web además guarda el token de DM en `localStorage` (`ttrpg:dmToken`) al entrar como DM, por si el DM entra por el link público.
- `DELETE /api/campaigns/<dm_token>` — borra la campaña en cascada (escenas, objetos, personajes/variantes, assets **y sus archivos**, tokens de acceso, pilas de undo) y cierra la sala (WS `4409`). Solo con el token de DM de esa campaña.

### Uploads

`POST /api/upload/<token>?kind=token|map|other` (multipart). Límite 10 MB; Pillow valida y recomprime a WebP (q85); mapas ≤4096 px de lado, tokens ≤512 px. Filename uuid → inmutable → `Cache-Control: immutable` al servir. Un upload `kind=token` crea automáticamente personaje + variante (modelo de formas); subir con `characterId` agrega una variante a ese personaje.

### Túnel de Cloudflare

- `cloudflared` va en la imagen Docker; el backend lo lanza al arrancar (`cloudflared tunnel --url http://localhost:8000 --no-autoupdate`).
- `tunnel.py` lee stdout línea por línea y parsea `https://[a-z0-9-]+\.trycloudflare\.com`. Si el proceso muere, se relanza (backoff de 5 s); un error nunca tumba la app.
- Al DM conectado le llega `tunnel.url` con el **link de jugador completo** (`<url>/j/<player_token>`) para el banner.
- `TUNNEL=off` lo desactiva (desarrollo).

## Desarrollo local

Requisitos: Python 3.11+, Node 20+.

```powershell
# backend (puerto 8000)
cd server
python -m venv .venv
.\.venv\Scripts\pip install -e ".[dev]"
$env:TUNNEL="off"   # sin túnel en dev
.\.venv\Scripts\uvicorn app.main:app --reload

# frontend (puerto 5173, proxy /api /assets /ws → 8000)
cd web
npm install
npm run dev
```

Para probar el server sirviendo el bundle (modo producción): `npm run build` en `web/` y copiar `web/dist` → `server/web_dist/` (así lo hace el Dockerfile).

## Tests y checks

```powershell
cd server
.\.venv\Scripts\pytest            # 87 tests
npx pyright                       # type checking (config canónica en pyrightconfig.json)

cd web
npm run build                     # tsc --noEmit + vite build
```

Cobertura de tests actual:

| Área | Archivo | Qué cubre |
|---|---|---|
| Grilla | `test_grid.py` | snap/centros con y sin offset (cuadrada, hex flat y pointy), distancia Chebyshev y hexagonal (casos conocidos), `cellsBetween` (rectas, diagonales, sin duplicados, adyacencia), factory |
| Ops y permisos | `test_ops_undo.py` | apply de cada acción, idempotencia por uuid, permisos DM/jugador/propio/ajeno/`playersMoveAny`, objetos de otra escena, generación de inversas |
| Undo | `test_undo.py` | ediciones intercaladas de 2 usuarios, undo de borrado (recrear), undo de movido-y-borrado (descartar y seguir), redo, invalidación de redo, LWW, pilas por usuario |
| REST/WS | `test_api.py` | crear campaña (bootstrap libre, siguientes exigen DM), listar campañas (gate DM), borrado de campaña (cascada completa + archivos + undo + cierre de sala), resolución de tokens, WS inválido, snapshot, broadcast (incluye emisor, seq), reconexión con resync, op rechazada, undo por WS, uploads (WebP, downscale 512/4096, >10 MB, imagen inválida), **round-trip de persistencia** (flush → estado fresco idéntico) |
| Escenas | `test_ws_scenes.py` | create/rename/delete/setGrid/setBackground, switch con snapshot fresco a todos, **ops post-switch aplican sobre la escena nueva** (regresión: escena stale), switch a escena inexistente (error limpio), objetos por escena, duplicate→`token.add`, setVariant (swap de asset/tamaño) |
| Biblioteca | `test_library.py` | personaje+variante automáticos, variante en personaje existente, permisos de borrado, cascada (variantes + personaje vacío), borrado de archivo, path traversal, `/api/tunnel` solo DM |
| Túnel/flush | `test_tunnel.py` | regex de URL sobre salida real de cloudflared, falsos positivos, flush solo-dirty, add+delete en la misma ventana |

Sin tests automatizados (verificación manual con dos navegadores): latencia percibida (<200 ms), animaciones de ping, drag multi-touch, follow-DM end-to-end.

## Deploy y publicación

Modelo: **el DM clona el repo y buildea local**. No hay registry — `docker-compose.yml` usa `build: .` y todo (incluido el `npm install` del frontend) ocurre dentro del build de Docker, así que el DM solo necesita Git + Docker Desktop.

Flujo del DM:

- Primera vez: instalar Docker Desktop + Git → `git clone` → doble click en `empezar.bat` (`docker compose up -d --build`, abre el navegador).
- Cada sesión: `empezar.bat` (instantáneo, usa la imagen ya buildeada).
- Actualizar: `actualizar.bat` (`git pull` + rebuild). Los datos viven en `./data` (volumen), sobreviven rebuilds.

Publicar una versión = commitear y pushear al repo (opcionalmente tag `v*` para referencia). Si algún día se quiere volver a imágenes pre-buildeadas en GHCR: el `Dockerfile` ya parametriza `TARGETARCH` (x86_64/arm64) y basta un workflow de build+push más cambiar `build: .` por `image: ghcr.io/…` en el compose.

Los `.bat` están escritos sin tildes a propósito (cmd.exe usa codepage OEM; los acentos UTF-8 se ven rotos). Mantenerlos así.
