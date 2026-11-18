"""custom_markers: pins and Flame Altar zones a player places (private, shareable with the team)

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-18 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0017"
down_revision: Union[str, Sequence[str], None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "custom_markers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("character_id", sa.Integer(), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("z", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("note", sa.String(length=500), server_default="", nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("icon", sa.String(length=32), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column("shared", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_custom_markers_character_id_characters"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_custom_markers")),
    )
    op.create_index(
        op.f("ix_custom_markers_character_id"), "custom_markers", ["character_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_custom_markers_character_id"), table_name="custom_markers")
    op.drop_table("custom_markers")
