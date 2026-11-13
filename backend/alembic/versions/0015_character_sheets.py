"""character sheets: the Character screen of a profile, kept on the server

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-13 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: Union[str, Sequence[str], None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "character_sheets",
        sa.Column("character_id", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_character_sheets_character_id_characters"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("character_id", name=op.f("pk_character_sheets")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("character_sheets")
