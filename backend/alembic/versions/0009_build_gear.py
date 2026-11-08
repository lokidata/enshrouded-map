"""build level, flame and gear

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-09 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.add_column(sa.Column("level", sa.Integer(), server_default="1", nullable=False))
        batch_op.add_column(sa.Column("flame", sa.Integer(), server_default="0", nullable=False))
        # no server default on JSON (MySQL cannot): old rows are filled below
        batch_op.add_column(sa.Column("gear", sa.JSON(), nullable=True))
    op.execute(sa.text("UPDATE builds SET gear = '{}'"))
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.alter_column("gear", existing_type=sa.JSON(), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.drop_column("gear")
        batch_op.drop_column("flame")
        batch_op.drop_column("level")
