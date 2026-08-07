# Whiteboard TTRPG

Whiteboard colaborativo en tiempo real para sesiones de TTRPG por Discord. Self-hosted: corre en la PC del DM con Docker, los jugadores entran por un link. Todo persiste: campañas, escenas, tokens, dibujos y mapas.

**Esto es todo lo que necesitás si sos el DM.** No hace falta saber programar: son dos instalaciones, un `git clone` y hacer doble click en un archivo.

## Puesta en marcha (una sola vez)

### 1. Instalar Docker Desktop

Descargalo de [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) e instalalo con las opciones por defecto. Reiniciá si te lo pide.

### 2. Instalar Git

Descargalo de [git-scm.com/download/win](https://git-scm.com/download/win) e instalalo con **siguiente, siguiente, siguiente** (las opciones por defecto están bien).

### 3. Bajar el código

Abrí el menú inicio, escribí `cmd` y apretá Enter. En la ventana negra pegá:

```
cd %USERPROFILE%\Documents
git clone https://github.com/bautistaib/ttrpg-board.git
```

Esto crea la carpeta `Documentos\ttrpg-board` con todo lo necesario.

### 4. Levantar el server

Abrí la carpeta `Documentos\ttrpg-board` y hacé **doble click en `empezar.bat`**.

La primera vez tarda varios minutos (está construyendo el server dentro de Docker). Cuando termina se te abre el navegador solo en `http://localhost:8000`.

> Si te dice que Docker no está corriendo: abrí Docker Desktop, esperá a que cargue, y volvé a hacer doble click.

### 5. Crear tu campaña y compartir el link

1. En `http://localhost:8000`, ponéle nombre a la campaña y tocá **Crear campaña**.
2. La primera caja es **"Link para compartir con la mesa"**: esperá unos segundos a que diga *"Generando el link público…"* y aparece el link `https://….trycloudflare.com/j/…`. Copialo y pegalo en Discord.
3. Guardá tu **link de DM** (secreto, es tu llave de entrada — no lo compartas).
4. Cada jugador entra por el link público, escribe su nombre y listo.

> El link de DM y el link local de jugadores (`localhost:8000/…`) **solo funcionan en tu PC**. El que va por Discord es siempre el de la caja azul (o el banner azul que aparece arriba del tablero cuando entrás como DM).

## El día de la sesión

1. Abrí Docker Desktop (si no está corriendo).
2. Doble click en `empezar.bat` (tarda 2 segundos, no vuelve a construir nada).
3. El banner azul muestra el link público del día — **cambia cada vez que se reinicia el server**, así que compartilo de nuevo por Discord.

## Actualizar a una versión nueva

Doble click en `actualizar.bat`. Baja los cambios, reconstruye y reinicia el server. **Tus datos no se pierden** (viven en la carpeta `data`).

## Backup

Copiá la carpeta `data` (dentro de `Documentos\ttrpg-board`). Ahí está absolutamente todo: la base de datos y las imágenes. Para restaurar, la copiás de vuelta.

## Qué tiene

- **Campañas y escenas persistentes**: cerrar el navegador o reiniciar el server no pierde nada. El DM puede tener varias escenas y cambiar en vivo; todos los clientes siguen la escena activa.
- **Canvas en tiempo real**: mover un token o dibujar se ve al instante en los demás. Cada uno tiene su propia cámara (pan y zoom independientes). Se ven los cursores de los demás con su nombre.
- **Grilla cuadrada o hexagonal** (flat-top y pointy-top): tamaño, color, opacidad, snap-to-grid y calibración sobre el mapa (offset + tamaño de celda, con preview en vivo).
- **Medición**: click y arrastrar muestra distancia en celdas y metros (configurable, default 1,5 m/celda; en hex usa distancia hexagonal real).
- **Tokens con biblioteca**: subís la imagen una vez y queda para siempre. Personajes con **formas/variantes** (ej: druida y sus transformaciones): click derecho → *Cambiar forma* y el swap es instantáneo, conservando posición, dueño y badges.
- **Fondos/mapas**: el DM sube el mapa, calibra la grilla encima y los tokens snapean correctamente.
- **Dibujo**: lápiz, rectángulos, círculos, líneas, flechas y texto. Cualquier dibujo se puede **convertir en token** reutilizable.
- **Calidad de vida en combate**: duplicar tokens (Ctrl+D), multi-selección y movimiento en grupo, badges de estado (☠️🔥🧊…), plantillas de área (círculo/cono/línea medidas en celdas), *"seguir al DM"* (sincroniza tu cámara con la del DM), **ping** con click de la rueda (o mantener presionado en táctil), y **deshacer/rehacer por usuario** (Ctrl+Z / Ctrl+Shift+Z).

## Controles rápidos

| Acción | Cómo |
|---|---|
| Mover la cámara | **Arrastrar con click derecho**, rueda (zoom) o herramienta ✋ |
| Ping | Click de la rueda (o mantener presionado) |
| Menú de un token | Click derecho sobre el token (formas, badges, duplicar…) |
| Escribir texto | Herramienta T → click donde quieras escribir; Enter confirma, Esc cancela. Doble click en un texto lo edita |
| Borrar un objeto entero | Borrador → click sobre el objeto |
| Borrar parte de un trazo | Borrador → arrastrar sobre el trazo (como el borrador de Paint) |
| Color y grosor | Elegí cualquier herramienta de dibujo y aparece el panel de opciones |
| Multi-selección | Arrastrar un rectángulo o Shift+click |
| Duplicar token | Ctrl+D |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Shift+Z |
| Borrar selección | Supr |

## Preguntas frecuentes

**¿El link público es seguro?**
La URL es aleatoria y cambia en cada arranque, y encima lleva el token de jugador en el path. Para una mesa de amigos es suficiente. No pongas datos sensibles en el tablero.

**¿Puedo desactivar el túnel (solo red local)?**
Sí: editá `docker-compose.yml` con el Bloc de notas, descomentá las dos líneas de `environment` / `TUNNEL=off` y volvé a correr `empezar.bat`. Los jugadores tendrán que estar en tu red y entrar por tu IP local.

**¿Se perdió el link de DM?**
Abrí una terminal en la carpeta y corré:

```
docker compose exec ttrpg-board python -c "import sqlite3; print('\n'.join('http://localhost:8000/dm/' + r[0] for r in sqlite3.connect('/data/ttrpg.db').execute('select dm_token from campaigns')))"
```

**¿Cómo lo apago del todo?**
`docker compose down` en la carpeta (o el botón de stop en Docker Desktop). Los datos quedan guardados en `data`.

## Para desarrolladores

Ver [`docs/DEV.md`](docs/DEV.md) (stack, arquitectura, protocolo de sincronización, tests y desarrollo local).
