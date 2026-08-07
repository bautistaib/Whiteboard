# Whiteboard TTRPG — guía para agentes

Whiteboard colaborativo en tiempo real para sesiones de TTRPG, self-hosted vía Docker. Spec autoritativa (scope y decisiones de diseño): `docs/SPEC-whiteboard-ttrpg.md` (español). Documentación técnica completa: `docs/DEV.md`. Instrucciones para el DM: `README.md`.

## Layout

- `server/` — FastAPI + SQLModel/SQLite (WAL). Estado autoritativo **en memoria**; la DB es write-through con flush debounced (~1 s). Undo server-side por usuario (pilas en memoria con inversas, cap 50, no persisten).
- `web/` — React + TS + react-konva + zustand + Vite. Sync: snapshot al conectar + ops; optimistic solo en drags propios.
- `Dockerfile` raíz — multi-stage (build de `web/` → runtime python + `cloudflared`). Un solo contenedor.
- Copy de UI y docs de usuario en **español**.

## Comandos

```powershell
# tests backend
cd server; .\.venv\Scripts\pytest          # 75 tests

# type checking Python (config canónica en server/pyrightconfig.json — no aflojarla,
# no usar type: ignore salvo pedido explícito)
cd server; npx pyright

# frontend
cd web; npm run build                       # tsc --noEmit + vite build
```

## Reglas del proyecto

- **GridSystem** es una abstracción con interfaz idéntica en server (`server/app/grid.py`) y cliente (`web/src/grid/`): `snap/cellOf/cellCenter/distance/cellsBetween`. Hex usa coordenadas axiales (flat-top y pointy-top); distancia hexagonal, no euclídea. La calibración (offset + redondeo axial) es la matemática más delicada: `server/tests/test_grid.py` primero, UI después.
- Ops efímeras (`cursor.move`, `ping`, `camera.sync`) nunca persisten ni entran al undo.
- Capas fijas: fondo → grilla → dibujos → AoE → tokens.
- Uploads: 10 MB máx, recompresión a WebP (mapas ≤4096 px, tokens ≤512 px), servidos inmutables.
- No agregar cuentas/auth real: el acceso es token-en-URL (`/dm/<token>`, `/j/<token>`), rol embebido en el token.
- No persistir las pilas de undo (decisión del spec).
- Esquema de tablas exactamente como `docs/SPEC-whiteboard-ttrpg.md` §Modelo de datos.
