"""build upgrades of the worn pieces

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-09 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.add_column(sa.Column("upgrades", sa.JSON(), nullable=True))
    op.execute(sa.text("UPDATE builds SET upgrades = '{}'"))
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.alter_column("upgrades", existing_type=sa.JSON(), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.drop_column("upgrades")
