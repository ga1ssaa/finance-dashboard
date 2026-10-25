import type { BudgetRecord, DashboardRecord, SubscriptionSummary } from '../../api/client';
import { signedUnits } from '../../utils/money';

export const PERIOD_LABELS = { all: 'All time', today: 'Today', week: 'Week', month: 'Month' } as const;
export const SCHEDULED_SUBSCRIPTIONS_PATH = '/subscriptions?status=active&sort_by=next_payment_date&sort_direction=asc&limit=3&offset=0';

/** Same manual 50/30/20 allocations used on the existing Budget page. */
export function budgetRows(monthlyIncome: number, spentData: { needs: number; wants: number; savings: number }) {
    return ([['needs', 'Needs', 0.5], ['wants', 'Wants', 0.3], ['savings', 'Savings', 0.2]] as const).map(([key, label, share]) => {
        const limit = monthlyIncome * share;
        const amount = spentData[key];
        const percent = limit > 0 ? amount / limit * 100 : null;
        return { key, label, share, limit, amount, percent };
    });
}

export interface OverviewInsight { id: string; title: string; message: string; href: string; action: string }

/** Observations use complete aggregates/manual inputs, never the paginated transaction preview. */
export function overviewInsights({ dashboard, budget, subscriptions, period, formatAmount }: {
    dashboard: DashboardRecord | null;
    budget: BudgetRecord | null;
    subscriptions: SubscriptionSummary | null;
    period: string;
    formatAmount: (value: string | number) => string;
}): OverviewInsight[] {
    const observations: OverviewInsight[] = [];
    if (dashboard && dashboard.transaction_count > 0) {
        const negative = signedUnits(dashboard.balance_usd) < 0n;
        observations.push({
            id: 'recorded-flow', title: negative ? 'Expenses exceed income' : 'Recorded cash flow',
            message: `${period}: income ${formatAmount(dashboard.income_usd)} and expenses ${formatAmount(dashboard.expenses_usd)} across ${dashboard.transaction_count} recorded transaction${dashboard.transaction_count === 1 ? '' : 's'}.`,
            href: '/transactions', action: 'Review transactions',
        });
    }
    if (budget && Number(budget.monthly_income_usd) > 0) {
        const rows = budgetRows(Number(budget.monthly_income_usd), { needs: Number(budget.needs_spent_usd), wants: Number(budget.wants_spent_usd), savings: Number(budget.savings_usd) });
        const spending = rows.filter(row => row.key !== 'savings');
        const warning = spending.find(row => row.percent! >= 100) || spending.find(row => row.percent! >= 80);
        const savings = rows[2];
        observations.push({
            id: 'manual-plan', title: warning ? `${warning.label} allocation` : 'Manual savings target',
            message: warning
                ? `Manually entered ${warning.label.toLowerCase()} spending is ${formatAmount(warning.amount)} of a ${formatAmount(warning.limit)} allocation (${warning.percent!.toFixed(1)}%).`
                : `Manually entered savings are ${formatAmount(savings.amount)} against the ${formatAmount(savings.limit)} allocation. These entries are independent of transactions.`,
            href: '/budget', action: 'Review budget',
        });
    }
    if (subscriptions && subscriptions.active_count > 0) {
        observations.push({
            id: 'recurring-commitment', title: 'Monthly recurring commitment',
            message: `${formatAmount(subscriptions.monthly_cost_usd)} per month across ${subscriptions.active_count} active subscription${subscriptions.active_count === 1 ? '' : 's'}. This does not create or deduct transactions.`,
            href: '/subscriptions', action: 'Review subscriptions',
        });
    }
    return observations;
}

export interface OverviewResource<T> { data: T | null; loading: boolean; error: string; retry: () => void }
