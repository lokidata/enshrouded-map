"""fogs: the explored area imported for a character profile (private, shareable with the team)

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-10 16:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: Union[str, Sequence[str], None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "fogs",
        sa.Column("character_id", sa.Integer(), nullable=False),
        sa.Column("bits", sa.LargeBinary(), nullable=False),
        sa.Column("shared", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_fogs_character_id_characters"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("character_id", name=op.f("pk_fogs")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("fogs")
