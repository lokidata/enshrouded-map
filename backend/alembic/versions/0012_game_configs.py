"""game configs

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-10 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "game_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["teams.id"],
            name=op.f("fk_game_configs_team_id_teams"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_game_configs_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_game_configs")),
        sa.UniqueConstraint("team_id", name=op.f("uq_game_configs_team_id")),
        sa.UniqueConstraint("user_id", name=op.f("uq_game_configs_user_id")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("game_configs")
