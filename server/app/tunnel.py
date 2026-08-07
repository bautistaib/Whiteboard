"""Quick tunnel de Cloudflare: subproceso cloudflared + parseo de URL.

Lanza `cloudflared tunnel --url http://localhost:<port>`, parsea la URL
pública `https://…trycloudflare.com` de su salida y la guarda en estado.
Si el proceso muere, se relanza. `TUNNEL=off` lo desactiva por completo.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable

from . import config

log = logging.getLogger("tunnel")

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
RESTART_DELAY = 5.0


class TunnelManager:
    def __init__(self) -> None:
        self.url: str | None = None
        self._task: asyncio.Task | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._on_url: Callable[[str | None], Awaitable[None]] | None = None
        self._stopped = False

    async def start(self, on_url: Callable[[str | None], Awaitable[None]]) -> None:
        if not config.TUNNEL:
            log.info("túnel desactivado (TUNNEL=off)")
            return
        self._on_url = on_url
        self._stopped = False
        self._task = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._kill_process()

    async def _kill_process(self) -> None:
        proc = self._process
        self._process = None
        if proc is not None and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()

    async def _set_url(self, url: str | None) -> None:
        if url != self.url:
            self.url = url
            log.info("tunnel URL: %s", url)
            if self._on_url is not None:
                await self._on_url(url)

    async def _supervise(self) -> None:
        while not self._stopped:
            try:
                await self._run_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — el túnel nunca debe tirar la app
                log.exception("error lanzando cloudflared")
            await self._set_url(None)
            if not self._stopped:
                await asyncio.sleep(RESTART_DELAY)

    async def _run_once(self) -> None:
        proc = await asyncio.create_subprocess_exec(
            "cloudflared",
            "tunnel",
            "--url",
            f"http://localhost:{config.PORT}",
            "--no-autoupdate",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self._process = proc
        assert proc.stdout is not None
        while True:
            line = await proc.stdout.readline()
            if not line:
                break  # proceso terminado
            match = URL_RE.search(line.decode(errors="replace"))
            if match:
                await self._set_url(match.group(0))
        returncode = await proc.wait()
        log.warning("cloudflared terminó (code=%s); reiniciando", returncode)


tunnel_manager = TunnelManager()
