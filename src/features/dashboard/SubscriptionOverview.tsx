import { Link } from 'react-router-dom';
import type { Page, SubscriptionRecord, SubscriptionSummary } from '../../api/client';
import { useSettings } from '../../hooks/useSettings';
import { formatCalendarDate, localDate } from '../../utils/dates';
import ResourceStatus from '../../components/ResourceStatus';
import type { OverviewResource } from './overviewData';

export default function SubscriptionOverview({ summary, scheduled, onAdd, canCreate }: {
    summary: OverviewResource<SubscriptionSummary>;
    scheduled: OverviewResource<Page<SubscriptionRecord>>;
    onAdd: () => void;
    canCreate: boolean;
}) {
    const { formatAmount } = useSettings();
    const today = localDate();
    const ready = !summary.loading && !summary.error && summary.data;
    return (
        <section aria-labelledby="subscription-overview-title" className="overview-section">
            <div className="overview-section-heading">
                <div><h2 id="subscription-overview-title" className="text-lg font-semibold">Subscriptions</h2><p className="mt-1 text-xs text-secondary">Recurring commitments and manually maintained payment dates</p></div>
                <Link to="/subscriptions" className="overview-text-link">View subscriptions</Link>
            </div>
            <div className="ui-panel grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-6">
                <div className="min-w-0">
                    <ResourceStatus loading={summary.loading} error={summary.error} retry={summary.retry} />
                    {ready && <><p className="text-sm text-secondary">{ready.active_count} active · {ready.paused_count} paused</p><p className="mt-2 text-2xl font-semibold text-primary [overflow-wrap:anywhere]">{formatAmount(ready.monthly_cost_usd)}<span className="ml-2 text-xs font-normal text-secondary">/ month</span></p><p className="mt-2 text-xs text-secondary">Monthly commitment across all active subscriptions</p></>}
                </div>
                <div className="min-w-0 border-t border-subtle pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                    <ResourceStatus loading={scheduled.loading} error={scheduled.error} retry={scheduled.retry} />
                    {!scheduled.loading && !scheduled.error && scheduled.data && (scheduled.data.items.length ? (
                        <>
                            <h3 className="mb-2 text-sm font-medium">Next scheduled dates</h3>
                            <ul className="divide-y divide-subtle">
                                {scheduled.data.items.slice(0, 3).map(item => (
                                    <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                                        <div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{item.service_name}</p><p className="mt-1 text-xs text-secondary"><time dateTime={item.next_payment_date}>{formatCalendarDate(item.next_payment_date)}</time>{item.next_payment_date < today ? ' · Scheduled date passed' : ' · Upcoming scheduled date'}</p></div>
                                        <p className="min-w-0 text-right text-sm font-medium [overflow-wrap:anywhere]">{formatAmount(item.amount_usd)}</p>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-2 text-xs text-secondary">Earliest active records by stored date. Scheduled dates do not confirm payments.</p>
                        </>
                    ) : <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{ready && ready.active_count === 0 ? 'No active subscriptions.' : 'No scheduled dates to show.'}</p><p className="mt-1 text-sm text-secondary">Track recurring costs and scheduled dates.</p></div><button type="button" disabled={!canCreate} onClick={onAdd} className="ui-primary-action">Add subscription</button></div>)}
                </div>
            </div>
        </section>
    );
}
