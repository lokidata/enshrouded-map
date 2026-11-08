"""gems set in the weapon slots

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-10 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.add_column(sa.Column("gems", sa.JSON(), nullable=True))
    op.execute(sa.text("UPDATE builds SET gems = '{}'"))
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.alter_column("gems", existing_type=sa.JSON(), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.drop_column("gems")
