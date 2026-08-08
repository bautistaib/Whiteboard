# Whiteboard TTRPG — Especificación (MVP)

## Objetivo

Whiteboard colaborativo en tiempo real para sesiones de TTRPG por Discord, self-hosted por el DM vía Docker. Reemplaza whiteboards gratuitos efímeros: todo persiste, hay grilla para combate, tokens reutilizables y mapas de fondo. **No es un clon de Roll20**: es un whiteboard libre con superpoderes, no un motor de reglas.

## Roles

- **DM (host):** crea campañas y escenas, edita todo, mueve cualquier objeto, gestiona la biblioteca de assets.
- **Jugador (3–6 por sesión):** dibuja, mueve tokens (los propios siempre; opcionalmente cualquiera — configurable por el DM), sube imágenes a la biblioteca.

## Features del MVP

### 1. Campañas y escenas persistentes
- Una **campaña** agrupa escenas y una biblioteca de assets.
- Una **escena** = un canvas: fondo, config de grilla, tokens, dibujos.
- Todo se guarda automáticamente en el server. Cerrar el navegador o reiniciar el server no pierde nada.
- El DM puede cambiar de escena en vivo; todos los clientes siguen a la escena activa.

### 2. Canvas colaborativo en tiempo real
- Sincronización por WebSocket: mover un token o dibujar se ve en <200 ms en los demás clientes.
- Pan y zoom independientes por cliente (cada uno mira donde quiere).
- Cursores de los demás visibles con nombre (útil para "miren acá").

### 3. Grilla y combate
- Tipo de grilla por escena: **cuadrada o hexagonal** (hex en ambas orientaciones: flat-top y pointy-top).
- Config: tamaño de celda en px, color, opacidad, on/off.
- **Snap-to-grid** para tokens (toggle global por escena): centro de celda en cuadrada, centro de hex en hexagonal.
- **Herramienta de medición:** click y arrastrar muestra distancia en celdas y en metros (metros por celda configurable, default 1.5 m). En hex, la distancia se calcula como distancia hexagonal (coordenadas axiales), no euclídea.
- Implementación: abstracción `GridSystem` con interfaz común (`snap(point)`, `distance(a, b)`, `render()`), dos implementaciones. La cuadrada se hace primero; la hex entra por la misma interfaz sin tocar el resto del código.

### 4. Tokens
- Biblioteca de assets **por campaña**: se sube la imagen del personaje una vez y queda para siempre.
- Arrastrar desde la biblioteca al canvas crea un token.
- Token: imagen, nombre visible (toggle), tamaño en celdas (1x1, 2x2, etc.), dueño.
- Rotar, redimensionar, eliminar.
- **Personajes con formas (variantes):** varios assets pueden agruparse como un mismo personaje (caso: druida con transformaciones). Cada variante tiene label y tamaño en celdas propio. El token referencia al personaje + su forma activa; click derecho → "cambiar forma" abre una mini-galería y el swap es instantáneo, conservando posición, dueño y badges (el tamaño se adapta al de la variante). En la biblioteca, el personaje aparece como un solo item expandible.

### 5. Fondos / mapas
- Subir imagen como fondo de escena (solo DM).
- **Calibración de grilla:** el DM ajusta offset y tamaño de celda hasta que la grilla coincida con el mapa (sliders + preview en vivo).
- El fondo queda en su propia capa, no seleccionable por jugadores.

### 6. Dibujo
- Lápiz a mano alzada (color, grosor), formas (rectángulo, círculo, línea, flecha), texto.
- Borrador y selección/eliminación de objetos propios (el DM borra cualquiera).
- Capas fijas, de abajo hacia arriba: **fondo → grilla → dibujos → tokens**.
- Los dibujos persisten con la escena (los que dibujan su personaje pueden guardarlo como asset: "convertir dibujo en token").

### 7. Acceso (lo más simple posible)
- Sin cuentas ni passwords.
- El DM crea la campaña y obtiene dos links: **link de DM** (secreto, rol admin) y **link de jugadores** (para compartir por Discord).
- Al entrar por primera vez, cada uno escribe su nombre; se guarda en localStorage del navegador.
- El rol viene embebido en el token del link. Suficiente para un grupo de amigos; no es un modelo de amenaza serio.

### 8. Calidad de vida en combate
- **Duplicar token** (Ctrl+D / botón): clona el token seleccionado en la celda contigua. Esencial para hordas de enemigos.
- **Multi-select y mover en grupo:** selección por rectángulo o Shift+click; el grupo se mueve junto respetando snap.
- **Badges de estado:** marcadores chicos (color + emoji) apilables sobre un token — veneno, caído, invisible. Sin semántica de reglas, es puro visual.
- **Plantillas de área de efecto:** círculo, cono y línea medidos en celdas, con relleno semitransparente. Se colocan, rotan y eliminan como cualquier objeto.
- **"Seguir al DM" (toggle por cliente):** sincroniza tu cámara con la del DM hasta que lo apagues o hagas pan manual.
- **Ping (click de rueda del mouse):** genera un ping animado en ese punto, visible para todos por ~3 s, con el color/nombre de quien lo hizo. Efímero: no persiste ni entra en el undo. Fallback táctil/sin rueda: mantener presionado.
- **Undo por usuario (Ctrl+Z):** deshace la última acción *propia*, sin importar qué hicieron los demás en el medio. Ctrl+Shift+Z rehace. Detalle de diseño:
  - El server mantiene una pila de undo **por usuario** (cap ~50): cada operación aplicada guarda su inversa (crear→borrar, borrar→recrear con snapshot, mover→mover de vuelta, editar→props anteriores).
  - Ctrl+Z aplica la inversa como una operación nueva que se broadcastea a todos (no es rollback de estado global).
  - Best-effort ante conflictos: si el objeto ya no existe (otro lo borró), ese item se descarta y se deshace el anterior; si otro lo modificó después, la inversa pisa con last-writer-wins. Semántica simple y predecible, sin transformación de operaciones.

## Fuera del MVP (backlog v2)

- Fog of war (revelado progresivo por el DM) — **confirmado para v2**
- Auras: radio configurable alrededor de un token (antorcha, aura), se mueve con él
- Marcador de turno: highlight de "le toca a este" que el DM pasa a mano (no es tracker de iniciativa)
- Notas adhesivas con visibilidad (visible/oculta para jugadores) — embrión de la capa oculta del DM
- Export de escena a PNG (para el recap post-sesión en Discord)
- Tracker de iniciativa
- Export/import de campaña (un .zip con el SQLite + assets)
- Capa oculta del DM (preparar cosas sin que se vean)
- Integración con el bot de Discord existente

**No-goals permanentes:** fichas de personaje, motor de reglas, dados, chat, audio/video (todo eso ya lo resuelve Discord o queda fuera de alcance).

## Arquitectura

### Stack
- **Backend:** Python 3.12, FastAPI, WebSockets nativos de Starlette.
- **Persistencia:** SQLite (WAL mode) + imágenes en disco bajo `/data`. Cero servicios externos.
- **Frontend:** React + TypeScript + Konva (react-konva) para el canvas. Vite como bundler.
- **Un solo contenedor:** el backend sirve el frontend buildeado como estáticos. Menos piezas = menos debugging para el DM.

### Modelo de sincronización
- **Estado autoritativo en el servidor.** Los clientes emiten eventos (`token.move`, `draw.add`, `scene.switch`, …); el server valida, aplica al estado en memoria, persiste y hace broadcast a la sala.
- **Optimistic updates** solo para el drag propio (fluidez); el resto espera confirmación del server.
- Al conectar o reconectar, el cliente recibe un **snapshot completo** de la escena activa y de ahí en más aplica deltas. Nada de CRDTs: para <10 usuarios con server autoritativo es complejidad innecesaria.
- Throttle de eventos de drag (~30 Hz) con posición final garantizada al soltar.

### Modelo de datos (SQLite)
```
campaigns(id, name, dm_token, player_token, created_at)
scenes(id, campaign_id, name, background_asset_id, grid_config_json, is_active, sort_order)
assets(id, campaign_id, filename, kind[token|map|other], uploaded_by, created_at)
characters(id, campaign_id, name)
character_variants(id, character_id, asset_id, label, size_cells, sort_order)
objects(id, scene_id, type[token|path|shape|text|aoe|group], z_index, owner, data_json, updated_at)
```
- Un token con formas guarda `character_id` + `active_variant_id` en su `data_json`.
- Un `group` es un dibujo compuesto: su `data_json` guarda `parts` (lista de {type, data} de paths/shapes/textos con coords relativas al origen del grupo). Se crea con "Fusionar selección".
- Las pilas de undo viven solo en memoria (se pierden al reiniciar el server — aceptable).
- `data_json` guarda geometría y props específicas por tipo. Flexible y suficiente a esta escala.
- Persistencia write-through con debounce (~1 s) desde el estado en memoria.

### Uploads
- Límite 10 MB por imagen; recompresión server-side a WebP (mapas máx. 4096 px de lado, tokens máx. 512 px).
- Servidas con cache headers agresivos (son inmutables).

## Deploy (experiencia del DM)

Publicar la imagen en GHCR (`ghcr.io/<user>/ttrpg-board`). El DM **nunca buildea**: Bauti buildea y pushea, el DM solo baja.

Instrucciones completas para el DM (van en el README):
1. Instalar Docker Desktop (link).
2. Descargar `docker-compose.yml` (un archivo, un servicio, volumen `./data`, `restart: unless-stopped`).
3. `docker compose up -d`
4. Abrir `http://localhost:8000`, crear campaña, compartir el link de jugadores.
5. Actualizar: `docker compose pull && docker compose up -d`
6. Backup: copiar la carpeta `data`.

### Exposición a internet: Cloudflare quick tunnel (decidido)
El server corre en la PC del DM; los jugadores acceden por un **quick tunnel de Cloudflare** (gratis, sin cuenta, URL `*.trycloudflare.com` que cambia en cada arranque — aceptado).

**Integrado en la imagen para que el DM no corra nada extra:**
- El binario `cloudflared` va incluido en la imagen Docker.
- Al arrancar, el backend lanza `cloudflared tunnel --url http://localhost:8000` como subproceso, parsea la URL pública de su salida (línea con `https://….trycloudflare.com`) y la guarda en estado.
- La UI local del DM (`http://localhost:8000`) muestra un banner: **"Link para compartir con la mesa: https://….trycloudflare.com/j/<player_token>"** con botón de copiar. El DM lo pega en Discord y listo.
- Si el túnel se cae, el backend lo relanza y la UI actualiza el link (los jugadores tendrían que reabrir — aceptable).
- Variable de entorno `TUNNEL=off` para desactivarlo (desarrollo local).

Caveats asumidos: quick tunnels no tienen SLA (para una mesa de amigos, irrelevante) y la URL rotativa hace de password de facto junto con el token de jugador en el path.

## Criterios de aceptación del MVP

1. El DM levanta el server con las instrucciones del README sin intervención de Bauti.
2. 5 clientes simultáneos mueven tokens sin lag perceptible ni desync.
3. Reiniciar el contenedor a mitad de sesión: al reconectar, todo está exactamente igual.
4. Un jugador sube la imagen de su personaje una vez y la reutiliza en la sesión siguiente sin re-subirla.
5. El DM sube un mapa, calibra la grilla y los tokens snapean correctamente sobre él.
6. Un jugador que dibuja su personaje lo convierte en token y lo reutiliza después.

## Orden de implementación sugerido (para Cursor)

1. Esqueleto: FastAPI + SQLite + servir frontend estático + Dockerfile.
2. Campañas/escenas + links de acceso por token.
3. Canvas Konva con pan/zoom + sync WS de un tipo de objeto (shapes).
4. Grilla cuadrada + snap + medición, detrás de la abstracción `GridSystem`.
5. Assets: upload, biblioteca, tokens desde biblioteca, personajes con formas.
6. Fondos + calibración de grilla.
7. Dibujo a mano alzada + texto + dibujo→token.
8. Grilla hexagonal (segunda implementación de `GridSystem`: snap, distancia axial, render, calibración).
9. QoL de combate: duplicar, multi-select, badges, plantillas de AoE, "seguir al DM", ping.
10. Undo/redo por usuario (pilas server-side con inversas).
11. Robustez: reconexión, throttle, persistencia con debounce, límites de upload.
12. Integración de cloudflared: subproceso, parseo de URL, banner con link copiable en la UI del DM.
13. Compose + README para el DM + publicación en GHCR.
