from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import delete, select

from app.api.deps import Admin, CurrentUser, DbSession
from app.core.addon_registry import AddonRegistry
from app.core.addons import Entry
from app.db.models import AddonAccess, AddonEntryRow, User
from app.schemas.addons import (
    AccessIn,
    AccessOut,
    AddonAdminOut,
    AddonOut,
    EnabledIn,
    Level,
    MeOut,
)

router = APIRouter(prefix="/addons", tags=["addons"])


def _registry(request: Request) -> AddonRegistry:
    reg: AddonRegistry = request.app.state.addons
    return reg


def _known(request: Request, entry_id: str) -> Entry:
    e = _registry(request).entry(entry_id)
    if e is None:
        raise HTTPException(404, "unknown_addon")
    return e


def _enabled(db: DbSession, entry_id: str) -> bool:
    row = db.get(AddonEntryRow, entry_id)
    return bool(row and row.enabled)


def _level(db: DbSession, user: User, entry_id: str) -> Level | None:
    """The caller's level on an enabled entry; the administrator is implicitly `action`."""
    if not _enabled(db, entry_id):
        return None
    if user.first_account:
        return "action"
    row = db.get(AddonAccess, (entry_id, user.id))
    return row.level if row else None  # type: ignore[return-value]


@router.get("", response_model=list[AddonOut])
def list_addons(request: Request, user: CurrentUser, db: DbSession) -> list[AddonOut]:
    out: list[AddonOut] = []
    for e in _registry(request).entries():
        level = _level(db, user, e.id)
        if level:
            out.append(
                AddonOut(
                    id=e.id,
                    key=e.key,
                    name=e.name,
                    element=e.element,
                    capabilities=list(e.capabilities),
                    script=e.script,
                    styles=e.styles,
                    level=level,
                )
            )
    return out


@router.get("/admin", response_model=list[AddonAdminOut])
def list_admin(request: Request, admin: Admin, db: DbSession) -> list[AddonAdminOut]:
    return [_admin_out(e, _enabled(db, e.id)) for e in _registry(request).entries()]


def _admin_out(e: Entry, enabled: bool) -> AddonAdminOut:
    return AddonAdminOut(
        id=e.id,
        key=e.key,
        name=e.name,
        description=e.description,
        capabilities=list(e.capabilities),
        version=e.version,
        enabled=enabled,
    )


@router.put("/{entry_id}", response_model=AddonAdminOut)
def set_enabled(
    request: Request, entry_id: str, body: EnabledIn, admin: Admin, db: DbSession
) -> AddonAdminOut:
    e = _known(request, entry_id)
    row = db.get(AddonEntryRow, entry_id)
    if row is None:
        db.add(AddonEntryRow(entry_id=entry_id, enabled=body.enabled))
    else:
        row.enabled = body.enabled
    db.commit()
    return _admin_out(e, body.enabled)


@router.get("/{entry_id}/access", response_model=list[AccessOut])
def list_access(request: Request, entry_id: str, admin: Admin, db: DbSession) -> list[AccessOut]:
    _known(request, entry_id)
    levels = dict(
        db.execute(
            select(AddonAccess.user_id, AddonAccess.level).where(AddonAccess.entry_id == entry_id)
        ).all()
    )
    users = db.scalars(select(User).where(User.id != admin.id).order_by(User.id))
    return [
        AccessOut(user_id=u.id, username=u.username, level=levels.get(u.id))  # type: ignore[arg-type]
        for u in users
    ]


@router.put("/{entry_id}/access/{user_id}", status_code=204)
def set_access(
    request: Request, entry_id: str, user_id: int, body: AccessIn, admin: Admin, db: DbSession
) -> None:
    _known(request, entry_id)
    if user_id == admin.id:
        raise HTTPException(400, "administrator_is_implicit")
    if db.get(User, user_id) is None:
        raise HTTPException(404, "unknown_user")
    row = db.get(AddonAccess, (entry_id, user_id))
    if body.level is None:
        db.execute(
            delete(AddonAccess).where(
                AddonAccess.entry_id == entry_id, AddonAccess.user_id == user_id
            )
        )
    elif row is None:
        db.add(AddonAccess(entry_id=entry_id, user_id=user_id, level=body.level))
    else:
        row.level = body.level
    db.commit()


@router.get("/{entry_id}/me", response_model=MeOut)
def me(request: Request, entry_id: str, user: CurrentUser, db: DbSession) -> MeOut:
    # 403 for unknown, disabled or unauthorised alike: an add-on cannot probe what exists.
    level = _level(db, user, entry_id) if _registry(request).entry(entry_id) else None
    if level is None:
        raise HTTPException(403, "forbidden")
    return MeOut(
        user_key=f"{user.id}:{user.created_at.isoformat()}",  # stable across SQLite id reuse
        username=user.username,
        is_admin=bool(user.first_account),
        level=level,
    )
