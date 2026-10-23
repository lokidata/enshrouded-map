from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Team, TeamMember, User


def no_users(db: Session) -> bool:
    """True on a fresh database: the first account has still to be created."""
    return db.scalar(select(User.id).limit(1)) is None


def leave_team(db: Session, user_id: int) -> bool:
    """Takes the user out of their team (not committed). The owner leaving hands the team to the
    longest-standing member; the last one closes it. False when the user was in no team."""
    member = db.get(TeamMember, user_id)
    if member is None:
        return False
    team = db.get(Team, member.team_id)
    db.delete(member)
    db.flush()
    if team and team.owner_id == user_id:
        heir = db.scalar(
            select(TeamMember.user_id)
            .where(TeamMember.team_id == team.id)
            .order_by(TeamMember.joined_at, TeamMember.user_id)
        )
        if heir is None:
            db.delete(team)
        else:
            team.owner_id = heir
    return True
