"""add token_usage model

Revision ID: 793cb0175239
Revises: cbaf12977b82
Create Date: 2026-05-27 15:47:00.273968

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '793cb0175239'
down_revision = 'cbaf12977b82'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('token_usage',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('model_name', sa.String(length=100), nullable=False),
    sa.Column('input_tokens', sa.Integer(), nullable=True),
    sa.Column('output_tokens', sa.Integer(), nullable=True),
    sa.Column('total_tokens', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('token_usage', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_token_usage_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_token_usage_user_id'), ['user_id'], unique=False)

def downgrade():
    with op.batch_alter_table('token_usage', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_token_usage_user_id'))
        batch_op.drop_index(batch_op.f('ix_token_usage_created_at'))
    op.drop_table('token_usage')
