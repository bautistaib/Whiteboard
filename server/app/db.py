"""Capa de persistencia: SQLModel sobre SQLite en modo WAL.

La capa es deliberadamente delgada: el estado autoritativo vive en memoria
(`state.py`); esto es write-through persistence con flush debounced.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy import event
from sqlmodel import Field, Session, SQLModel, create_engine, select

from . import config


class Campaign(SQLModel, table=True):
    __tablename__: Any = "campaigns"

    id: str = Field(primary_key=True)
    name: str
    dm_token: str = Field(index=True, unique=True)
    player_token: str = Field(index=True, unique=True)
    created_at: float


class Scene(SQLModel, table=True):
    __tablename__: Any = "scenes"

    id: str = Field(primary_key=True)
    campaign_id: str = Field(index=True)
    name: str
    background_asset_id: str | None = None
    grid_config_json: str = "{}"
    is_active: bool = False
    sort_order: int = 0


class Asset(SQLModel, table=True):
    __tablename__: Any = "assets"

    id: str = Field(primary_key=True)
    campaign_id: str = Field(index=True)
    filename: str
    kind: str  # token | map | other
    uploaded_by: str = ""
    created_at: float = 0.0


class Character(SQLModel, table=True):
    __tablename__: Any = "characters"

    id: str = Field(primary_key=True)
    campaign_id: str = Field(index=True)
    name: str


class CharacterVariant(SQLModel, table=True):
    __tablename__: Any = "character_variants"

    id: str = Field(primary_key=True)
    character_id: str = Field(index=True)
    asset_id: str
    label: str = ""
    size_cells: int = 1
    sort_order: int = 0


class SceneObject(SQLModel, table=True):
    __tablename__: Any = "objects"

    id: str = Field(primary_key=True)
    scene_id: str = Field(index=True)
    type: str  # token | path | shape | text | aoe
    z_index: int = 0
    owner: str = ""
    data_json: str = "{}"
    updated_at: float = 0.0


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        config.ensure_dirs()
        _engine = create_engine(
            f"sqlite:///{config.DB_PATH}",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(_engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):  # type: ignore[no-untyped-def]
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        SQLModel.metadata.create_all(_engine)
    return _engine


def reset_engine_for_tests(db_path) -> None:
    """Reapunta el engine a un archivo temporal (solo tests)."""
    global _engine
    _engine = None
    config.DATA_DIR = db_path.parent
    config.DB_PATH = db_path
    config.ASSETS_DIR = db_path.parent / "assets"
    config.SETTINGS_PATH = db_path.parent / "settings.json"
    get_engine()


@dataclass
class DBDump:
    campaigns: list[Campaign]
    scenes: list[Scene]
    assets: list[Asset]
    characters: list[Character]
    character_variants: list[CharacterVariant]
    objects: list[SceneObject]


def load_all() -> DBDump:
    """Carga completa al arrancar: el estado en memoria se reconstruye de acá."""
    with Session(get_engine()) as session:
        return DBDump(
            campaigns=list(session.exec(select(Campaign)).all()),
            scenes=list(session.exec(select(Scene)).all()),
            assets=list(session.exec(select(Asset)).all()),
            characters=list(session.exec(select(Character)).all()),
            character_variants=list(session.exec(select(CharacterVariant)).all()),
            objects=list(session.exec(select(SceneObject)).all()),
        )


def upsert_many(rows: Iterable[SQLModel]) -> None:
    """Flush write-through de objetos modificados."""
    rows = list(rows)
    if not rows:
        return
    with Session(get_engine()) as session:
        for row in rows:
            session.merge(row)
        session.commit()


def delete_many(rows: Iterable[SQLModel]) -> None:
    """DELETE por statement: funciona aunque la fila nunca se haya flusheado."""
    with Session(get_engine()) as session:
        for row in rows:
            cls = row.__class__
            session.exec(sa_delete(cls).where(cls.id == row.id))  # type: ignore[attr-defined]
        session.commit()
