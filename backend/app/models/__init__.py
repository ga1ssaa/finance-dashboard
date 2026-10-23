"""Import all mapped entities to register the complete Alembic metadata."""

from app.models.budget_profile import BudgetProfile
from app.models.owner import Owner
from app.models.preferences import Preferences
from app.models.subscription import Subscription
from app.models.transaction import Transaction

__all__ = ["Owner", "Transaction", "Subscription", "BudgetProfile", "Preferences"]
