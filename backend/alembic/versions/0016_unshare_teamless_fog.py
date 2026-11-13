"""fogs: a player in no team shares nothing (the flag stayed on after leaving a team)

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-13 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema (data only)."""
    op.execute(
        sa.text(
            "UPDATE fogs SET shared = :off WHERE character_id IN ("
            "SELECT id FROM characters WHERE user_id NOT IN (SELECT user_id FROM team_members))"
        ).bindparams(off=False)
    )


def downgrade() -> None:
    """Nothing to undo: the flag cannot be restored."""
