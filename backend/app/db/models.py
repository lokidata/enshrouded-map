from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32))
    username_key: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    # True on the first account only, NULL on the others: the unique constraint lets one setup win.
    first_account: Mapped[bool | None] = mapped_column(Boolean, unique=True, default=None)


class AuthSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)  # SHA-256 hex
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class Mark(Base):
    __tablename__ = "marks"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    mark_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # "category:x:z"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Invitation(Base):
    """Single-use link sent by a registered user so that someone else can create an account."""

    __tablename__ = "invitations"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)  # SHA-256 hex
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    used_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    # Set when the owner sends it from the team screen: the new account joins that team.
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), default=None
    )


class PasswordReset(Base):
    """Single-use link the first account generates for someone who lost their password."""

    __tablename__ = "password_resets"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)  # SHA-256 hex
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TeamMember(Base):
    """One team per player: the user id is the primary key."""

    __tablename__ = "team_members"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Passkey(Base):
    """A WebAuthn credential of a player: signs them in without a password."""

    __tablename__ = "passkeys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    credential_id: Mapped[str] = mapped_column(String(512), unique=True)  # base64url
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
