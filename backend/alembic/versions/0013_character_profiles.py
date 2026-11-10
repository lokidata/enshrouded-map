"""character profiles: marks and builds belong to a character of the player

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-10 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: every player gets a first profile ("Principal") that owns what they had."""
    op.create_table(
        "characters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_characters_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_characters")),
        sa.UniqueConstraint("user_id", "name", name=op.f("uq_characters_user_id")),
    )
    op.create_index(op.f("ix_characters_user_id"), "characters", ["user_id"])
    op.create_table(
        "active_characters",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("character_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_active_characters_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_active_characters_character_id_characters"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_active_characters")),
    )
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO characters (user_id, name, created_at) "
            "SELECT id, 'Principal', CURRENT_TIMESTAMP FROM users"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO active_characters (user_id, character_id) SELECT user_id, id FROM characters"
        )
    )

    # marks: the key becomes (character, mark). A new table is copied into rather than altered: the key
    # changes, and SQLite cannot alter a key.
    op.create_table(
        "marks_v2",
        sa.Column("character_id", sa.Integer(), nullable=False),
        sa.Column("mark_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["character_id"],
            ["characters.id"],
            name=op.f("fk_marks_character_id_characters"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("character_id", "mark_id", name="pk_marks_v2"),
    )
    conn.execute(
        sa.text(
            "INSERT INTO marks_v2 (character_id, mark_id, created_at) "
            "SELECT c.id, m.mark_id, m.created_at FROM marks m JOIN characters c ON c.user_id = m.user_id"
        )
    )
    op.drop_table("marks")
    op.rename_table("marks_v2", "marks")
    if (
        conn.dialect.name == "postgresql"
    ):  # constraint names are schema-wide there: keep the usual one
        op.execute("ALTER TABLE marks RENAME CONSTRAINT pk_marks_v2 TO pk_marks")

    # builds: each belongs to the first profile of its player
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.add_column(sa.Column("character_id", sa.Integer(), nullable=True))
    conn.execute(
        sa.text(
            "UPDATE builds SET character_id = "
            "(SELECT c.id FROM characters c WHERE c.user_id = builds.user_id)"
        )
    )
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.alter_column("character_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            op.f("fk_builds_character_id_characters"),
            "characters",
            ["character_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index(op.f("ix_builds_character_id"), ["character_id"])


def downgrade() -> None:
    """Downgrade schema: marks go back to the player; only the active profile's marks are kept."""
    conn = op.get_bind()
    with op.batch_alter_table("builds", schema=None) as batch_op:
        batch_op.drop_index(op.f("ix_builds_character_id"))
        batch_op.drop_constraint(op.f("fk_builds_character_id_characters"), type_="foreignkey")
        batch_op.drop_column("character_id")
    op.create_table(
        "marks_v1",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("mark_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_marks_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "mark_id", name="pk_marks_v1"),
    )
    conn.execute(
        sa.text(
            "INSERT INTO marks_v1 (user_id, mark_id, created_at) "
            "SELECT a.user_id, m.mark_id, m.created_at FROM marks m "
            "JOIN active_characters a ON a.character_id = m.character_id"
        )
    )
    op.drop_table("marks")
    op.rename_table("marks_v1", "marks")
    if conn.dialect.name == "postgresql":
        op.execute("ALTER TABLE marks RENAME CONSTRAINT pk_marks_v1 TO pk_marks")
    op.drop_table("active_characters")
    op.drop_index(op.f("ix_characters_user_id"), table_name="characters")
    op.drop_table("characters")
