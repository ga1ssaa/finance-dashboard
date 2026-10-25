import { Plus } from 'lucide-react';
import type { DashboardRecord, Page, SubscriptionRecord, SubscriptionSummary, TransactionRecord } from '../api/client';
import ResourceStatus from '../components/ResourceStatus';
import ScrollReveal from '../components/ScrollReveal';
import { useBudget } from '../hooks/useBudget';
import { useResource } from '../hooks/useResource';
import { useSettings } from '../hooks/useSettings';
import type { TimeRange } from '../hooks/useTransactions';
import type { Transaction } from '../types/finance';
import type { FilterType, SortType } from '../features/transactions/TransactionFilters';
import SummaryCards from '../features/dashboard/SummaryCards';
import CashFlowChart from '../features/dashboard/CashFlowChart';
import CategoryPieChart from '../features/dashboard/CategoryPieChart';
import RecentTransactions from '../features/dashboard/RecentTransactions';
import BudgetOverview, { type OverviewBudget } from '../features/dashboard/BudgetOverview';
import SubscriptionOverview from '../features/dashboard/SubscriptionOverview';
import SmartInsights from '../features/dashboard/SmartInsights';
import { overviewInsights, PERIOD_LABELS, SCHEDULED_SUBSCRIPTIONS_PATH, type OverviewResource } from '../features/dashboard/overviewData';

export interface OverviewProps {
    dashboard: OverviewResource<DashboardRecord>;
    recent: OverviewResource<Page<TransactionRecord>>;
    transactions: Transaction[];
    timeRange: TimeRange;
    setTimeRange: (range: TimeRange) => void;
    recentFilterType: FilterType;
    setRecentFilterType: (type: FilterType) => void;
    recentSortBy: SortType;
    setRecentSortBy: (sort: SortType) => void;
    canCreate: boolean;
    onAddTransaction: () => void;
    onAddSubscription: () => void;
    onEditTransaction: (transaction: Transaction) => void;
    onDeleteTransaction: (id: string | number) => void;
}

export function OverviewContent({ budget, subscriptionSummary, scheduled, ...props }: OverviewProps & {
    budget: OverviewBudget;
    subscriptionSummary: OverviewResource<SubscriptionSummary>;
    scheduled: OverviewResource<Page<SubscriptionRecord>>;
}) {
    const { formatAmount } = useSettings();
    const summary = !props.dashboard.loading && !props.dashboard.error ? props.dashboard.data : null;
    const period = PERIOD_LABELS[props.timeRange];
    const insights = overviewInsights({
        dashboard: summary,
        budget: !budget.loading && !budget.error ? budget.data : null,
        subscriptions: !subscriptionSummary.loading && !subscriptionSummary.error ? subscriptionSummary.data : null,
        period, formatAmount,
    });
    return (
        <div className="ui-page overview-workspace">
            <section aria-labelledby="financial-summary-title">
                <div className="ui-page-header mb-4">
                    <div><h1 className="text-2xl font-bold">Overview</h1><p className="mt-1 text-xs text-secondary">Recorded finances · {period}</p></div>
                    <button type="button" disabled={!props.canCreate} onClick={props.onAddTransaction} className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover"><Plus size={18} aria-hidden="true" />Add transaction</button>
                </div>
                <div className="mb-5 flex max-w-full flex-wrap gap-1" role="group" aria-label="Transaction period">
                    {(Object.keys(PERIOD_LABELS) as TimeRange[]).map(range => <button type="button" key={range} aria-pressed={props.timeRange === range} onClick={() => props.setTimeRange(range)} className={`min-h-11 rounded-control border px-3 text-xs font-medium ${props.timeRange === range ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-secondary hover:bg-hover'}`}>{PERIOD_LABELS[range]}</button>)}
                </div>
                <h2 id="financial-summary-title" className="sr-only">Financial summary</h2>
                <ResourceStatus loading={props.dashboard.loading} error={props.dashboard.error} retry={props.dashboard.retry} />
                {summary && <SummaryCards summary={summary} />}
                {summary?.transaction_count === 0 && <p className="mt-3 text-sm text-secondary">No transactions in this period. Add your first record or choose another period.</p>}
            </section>
            <ScrollReveal>
                <section aria-labelledby="cash-flow-title" className="overview-section">
                    <div className="overview-section-heading"><div><h2 id="cash-flow-title" className="text-lg font-semibold">Cash flow</h2><p className="mt-1 text-xs text-secondary">Income versus expenses · {period}. Budget and subscriptions keep their own monthly scope.</p></div></div>
                    <ResourceStatus loading={props.dashboard.loading} error={props.dashboard.error} retry={props.dashboard.retry} />
                    {summary && <div className="grid min-w-0 gap-6 rounded-card border border-subtle bg-surface p-4 sm:p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                        {Number(summary.income_usd) > 0 || Number(summary.expenses_usd) > 0 ? <CashFlowChart summary={summary} period={period} /> : <div className="self-center py-3"><p className="font-medium">No cash flow recorded for this period.</p><p className="mt-1 text-sm text-secondary">An income and expense comparison appears when you add records.</p><button type="button" disabled={!props.canCreate} onClick={props.onAddTransaction} className="overview-text-link mt-2">Add transaction</button></div>}
                        <div className="min-w-0 border-t border-subtle pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><CategoryPieChart categories={summary.expense_by_category} /></div>
                    </div>}
                </section>
            </ScrollReveal>
            <ScrollReveal><RecentTransactions transactions={props.transactions} filterType={props.recentFilterType} setFilterType={props.setRecentFilterType} sortBy={props.recentSortBy} setSortBy={props.setRecentSortBy} loading={props.recent.loading} error={props.recent.error} retry={props.recent.retry} canEdit={props.canCreate} onAdd={props.onAddTransaction} onDeleteTransaction={props.onDeleteTransaction} onEditTransaction={props.onEditTransaction} /></ScrollReveal>
            <ScrollReveal><BudgetOverview budget={budget} /></ScrollReveal>
            <ScrollReveal><SubscriptionOverview summary={subscriptionSummary} scheduled={scheduled} onAdd={props.onAddSubscription} canCreate={props.canCreate} /></ScrollReveal>
            <ScrollReveal><SmartInsights insights={insights} /></ScrollReveal>
        </div>
    );
}

export default function OverviewPage(props: OverviewProps) {
    const budget = useBudget();
    const subscriptionSummary = useResource<SubscriptionSummary>('/subscriptions/summary');
    const scheduled = useResource<Page<SubscriptionRecord>>(SCHEDULED_SUBSCRIPTIONS_PATH);
    return <OverviewContent {...props} budget={budget} subscriptionSummary={subscriptionSummary} scheduled={scheduled} />;
}
