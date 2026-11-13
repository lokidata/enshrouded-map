from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import ActiveCharacter, Character, Fog, Team, TeamMember, User


def no_users(db: Session) -> bool:
    """True on a fresh database: the first account has still to be created."""
    return db.scalar(select(User.id).limit(1)) is None


def unshare_fog(db: Session, user_id: int) -> None:
    """Stops showing the explored area of every profile of the player (not committed). Sharing is a
    choice made for one team: it does not follow the player to another one."""
    mine = select(Character.id).where(Character.user_id == user_id)
    db.execute(update(Fog).where(Fog.character_id.in_(mine)).values(shared=False))


def leave_team(db: Session, user_id: int) -> bool:
    """Takes the user out of their team (not committed). The owner leaving hands the team to the
    longest-standing member; the last one closes it. False when the user was in no team."""
    member = db.get(TeamMember, user_id)
    if member is None:
        return False
    team = db.get(Team, member.team_id)
    db.delete(member)
    unshare_fog(db, user_id)
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


DEFAULT_CHARACTER = "Principal"


def active_character(db: Session, user: User) -> Character:
    """The profile the player follows; every player has one, the first is made on demand."""
    active = db.get(ActiveCharacter, user.id)
    character = db.get(Character, active.character_id) if active else None
    if character is not None:
        return character
    # The first requests after a login arrive together and each would make the first profile: the
    # one that loses the race hits a unique constraint, rolls back and finds the winner's profile.
    for attempt in range(3):
        try:
            character = db.scalar(
                select(Character)
                .where(Character.user_id == user.id)
                .order_by(Character.id)
                .limit(1)
            )
            if character is None:
                character = Character(user_id=user.id, name=DEFAULT_CHARACTER)
                db.add(character)
                db.flush()
            db.merge(ActiveCharacter(user_id=user.id, character_id=character.id))
            db.commit()
            return character
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise
    raise AssertionError("unreachable")
