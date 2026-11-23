"""addons: which add-on entries are enabled and who may use them

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-23 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: Union[str, Sequence[str], None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "addon_entries",
        sa.Column("entry_id", sa.String(length=20), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("entry_id", name=op.f("pk_addon_entries")),
    )
    op.create_table(
        "addon_access",
        sa.Column("entry_id", sa.String(length=20), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(length=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_addon_access_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("entry_id", "user_id", name=op.f("pk_addon_access")),
    )
    op.create_index(op.f("ix_addon_access_user_id"), "addon_access", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_addon_access_user_id"), table_name="addon_access")
    op.drop_table("addon_access")
    op.drop_table("addon_entries")
