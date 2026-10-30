from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.api.limiter import limiter
from app.core.config import get_settings
from app.core.logging import audit
from app.core.security import new_token, token_digest
from app.db.base import utcnow
from app.db.models import Invitation, Mark, Team, TeamMember, User
from app.db.queries import leave_team
from app.schemas.auth import InvitationOut
from app.schemas.team import (
    Member,
    MemberIn,
    NameIn,
    TeamMarks,
    TeamOut,
)

router = APIRouter(prefix="/team", tags=["team"])


def _membership(db: DbSession, user: User) -> TeamMember | None:
    return db.get(TeamMember, user.id)


def _own_team(db: DbSession, user: User) -> Team:
    """The team the user owns; 404 without a team, 403 for a plain member."""
    member = _membership(db, user)
    team = db.get(Team, member.team_id) if member else None
    if team is None:
        raise HTTPException(404, "no_team")
    if team.owner_id != user.id:
        raise HTTPException(403, "forbidden")
    return team


def _my_team(db: DbSession, user: User) -> Team:
    """The team the user belongs to (any member); 404 without one."""
    member = _membership(db, user)
    team = db.get(Team, member.team_id) if member else None
    if team is None:
        raise HTTPException(404, "no_team")
    return team


def _out(db: DbSession, team: Team, user: User) -> TeamOut:
    rows = db.execute(
        select(User.id, User.username)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team.id)
        .order_by(TeamMember.joined_at, User.id)
    )
    members = [Member(id=i, username=n) for i, n in rows]
    return TeamOut(
        id=team.id,
        name=team.name,
        owner_id=team.owner_id,
        is_owner=team.owner_id == user.id,
        members=members,
    )


@router.get("", response_model=TeamOut | None)
def get_team(user: CurrentUser, db: DbSession) -> TeamOut | None:
    member = _membership(db, user)
    team = db.get(Team, member.team_id) if member else None
    return _out(db, team, user) if team else None


@router.post("", response_model=TeamOut)
def create_team(body: NameIn, user: CurrentUser, db: DbSession) -> TeamOut:
    if _membership(db, user):
        raise HTTPException(409, "in_team")
    team = Team(name=body.name, owner_id=user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(user_id=user.id, team_id=team.id))
    try:
        db.commit()
    except IntegrityError:  # two simultaneous requests
        db.rollback()
        raise HTTPException(409, "in_team") from None
    return _out(db, team, user)


@router.patch("", response_model=TeamOut)
def rename_team(body: NameIn, user: CurrentUser, db: DbSession) -> TeamOut:
    team = _own_team(db, user)
    team.name = body.name
    db.commit()
    return _out(db, team, user)


@router.delete("")
def dissolve_team(user: CurrentUser, db: DbSession) -> dict[str, str]:
    db.delete(_own_team(db, user))  # members and invitations go with it
    db.commit()
    return {}


@router.post("/leave")
def leave(user: CurrentUser, db: DbSession) -> dict[str, str]:
    if not leave_team(db, user.id):
        raise HTTPException(404, "no_team")
    db.commit()
    return {}


@router.delete("/members/{user_id}")
def remove_member(user_id: int, user: CurrentUser, db: DbSession) -> dict[str, str]:
    """Any member can remove another one, except the owner (they dissolve or leave instead)."""
    team = _my_team(db, user)
    if user_id == user.id:
        raise HTTPException(400, "self")
    if user_id == team.owner_id:
        raise HTTPException(403, "forbidden")
    removed = db.execute(
        delete(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user_id)
    )
    if removed.rowcount != 1:  # type: ignore[attr-defined]
        raise HTTPException(404, "no_member")
    db.commit()
    return {}


@router.post("/owner", response_model=TeamOut)
def transfer_ownership(body: MemberIn, user: CurrentUser, db: DbSession) -> TeamOut:
    """The owner hands the team to another member, who becomes the owner."""
    team = _own_team(db, user)
    target = db.get(TeamMember, body.user_id)
    if body.user_id == user.id or target is None or target.team_id != team.id:
        raise HTTPException(404, "no_member")
    team.owner_id = body.user_id
    db.commit()
    return _out(db, team, user)


@router.post("/invitations", response_model=InvitationOut)
@limiter.limit(lambda: get_settings().register_rate_limit)
def create_invitation(request: Request, user: CurrentUser, db: DbSession) -> InvitationOut:
    """Account invitation (see auth) whose new account joins the team."""
    team = _my_team(db, user)
    now = utcnow()
    db.execute(delete(Invitation).where(Invitation.used_at.is_(None), Invitation.expires_at < now))
    token = new_token()
    expires = now + timedelta(minutes=get_settings().invitation_minutes)
    db.add(
        Invitation(
            token_hash=token_digest(token), created_by=user.id, expires_at=expires, team_id=team.id
        )
    )
    db.commit()
    audit.info("team_invitation_created", extra={"user_id": user.id, "team_id": team.id})
    return InvitationOut(token=token, expires_at=expires)


@router.get("/available", response_model=list[Member])
def available(user: CurrentUser, db: DbSession) -> list[Member]:
    """Players who are in no team yet: the ones the owner can add."""
    _my_team(db, user)
    rows = db.execute(
        select(User.id, User.username)
        .where(User.id.not_in(select(TeamMember.user_id)))
        .order_by(User.username_key)
    )
    return [Member(id=i, username=n) for i, n in rows]


@router.post("/members", response_model=TeamOut)
def add_member(body: MemberIn, user: CurrentUser, db: DbSession) -> TeamOut:
    team = _my_team(db, user)
    target = db.get(User, body.user_id)
    if target is None:
        raise HTTPException(404, "no_member")
    db.add(TeamMember(user_id=target.id, team_id=team.id))
    try:
        db.commit()
    except IntegrityError:  # already in a team
        db.rollback()
        raise HTTPException(409, "member_in_team") from None
    audit.info("team_member_added", extra={"user_id": target.id, "team_id": team.id})
    return _out(db, team, user)


@router.get("/marks", response_model=TeamMarks)
def team_marks(user: CurrentUser, db: DbSession) -> TeamMarks:
    """What the other members marked; the caller's own marks come from /progress."""
    member = _membership(db, user)
    marks: dict[str, list[int]] = defaultdict(list)
    if member:
        rows = db.execute(
            select(Mark.mark_id, Mark.user_id)
            .join(TeamMember, TeamMember.user_id == Mark.user_id)
            .where(TeamMember.team_id == member.team_id, Mark.user_id != user.id)
        )
        for mark_id, user_id in rows:
            marks[mark_id].append(user_id)
    return TeamMarks(marks=marks)
