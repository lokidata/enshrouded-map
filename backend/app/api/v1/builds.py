from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.models import Build
from app.schemas.builds import BuildIn, BuildOut

router = APIRouter(prefix="/builds", tags=["builds"])


def _own(db: DbSession, user: CurrentUser, build_id: int) -> Build:
    build = db.scalar(select(Build).where(Build.id == build_id, Build.user_id == user.id))
    if build is None:
        raise HTTPException(404, "build_not_found")  # also for someone else's build
    return build


def _out(build: Build) -> BuildOut:
    return BuildOut(
        id=build.id,
        name=build.name,
        nodes=build.nodes,
        level=build.level,
        flame=build.flame,
        gear=build.gear,
        upgrades=build.upgrades,
        gems=build.gems or {},
        updated_at=build.updated_at,
    )


@router.get("", response_model=list[BuildOut])
def list_builds(user: CurrentUser, db: DbSession) -> list[BuildOut]:
    rows = db.scalars(
        select(Build)
        .where(Build.user_id == user.id)
        .order_by(Build.updated_at.desc(), Build.id.desc())
    )
    return [_out(b) for b in rows]


@router.post("", response_model=BuildOut)
def create_build(body: BuildIn, user: CurrentUser, db: DbSession) -> BuildOut:
    count = db.scalar(select(func.count()).select_from(Build).where(Build.user_id == user.id))
    if (count or 0) >= get_settings().max_builds:
        raise HTTPException(409, "too_many_builds")
    build = Build(user_id=user.id, **body.model_dump())
    db.add(build)
    db.commit()
    return _out(build)


@router.put("/{build_id}", response_model=BuildOut)
def update_build(build_id: int, body: BuildIn, user: CurrentUser, db: DbSession) -> BuildOut:
    build = _own(db, user, build_id)
    for field, value in body.model_dump().items():
        setattr(build, field, value)
    db.commit()
    return _out(build)


@router.delete("/{build_id}")
def delete_build(build_id: int, user: CurrentUser, db: DbSession) -> dict[str, str]:
    db.delete(_own(db, user, build_id))
    db.commit()
    return {}
