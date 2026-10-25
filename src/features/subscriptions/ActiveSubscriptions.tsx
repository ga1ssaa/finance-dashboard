import { formatCalendarDate } from "../../utils/dates";
import type { SubscriptionSummary } from "../../api/client";
import { Pencil, Trash2 } from "lucide-react";
import type { Subscription } from "../../types/finance";
import { useSettings } from "../../hooks/useSettings";

interface ActiveSubscriptionsProps {
    subscriptions: Subscription[];
    summary: SubscriptionSummary | null;
    onEdit: (subscription: Subscription) => void;
    onDelete: (id: string | number) => void;
    onAdd: () => void;
}

export default function ActiveSubscriptions({ subscriptions, onEdit, onDelete, onAdd, summary }: ActiveSubscriptionsProps) {
    const { formatAmount } = useSettings();
    return (
        <section aria-label="Recurring subscriptions" className="ui-panel">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-4">
                <div><h3 className="text-lg font-semibold">Recurring commitments</h3>{summary && <p className="mt-1 text-sm text-secondary">{summary.active_count} active · {summary.paused_count} paused</p>}</div>
                {summary && <div className="text-right"><p className="text-xl font-semibold [overflow-wrap:anywhere]">{formatAmount(summary.monthly_cost_usd)}</p><p className="text-xs text-secondary">/ month across active subscriptions</p></div>}
            </div>
            {subscriptions.length ? <ul className="divide-y divide-subtle">
                {subscriptions.map(sub => (
                    <li key={sub.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-center gap-x-3 gap-y-1 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(100px,0.8fr)_88px]">
                        <div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{sub.serviceName}</p><span className={`mt-1 inline-block rounded-control border px-1.5 py-0.5 text-xs font-medium ${sub.status === 'active' ? 'border-accent/30 bg-accent-soft text-accent' : 'border-subtle text-secondary'}`}>{sub.status}</span><p className="mt-1 text-xs text-secondary md:hidden">Scheduled: <time dateTime={sub.nextPaymentDate}>{formatCalendarDate(sub.nextPaymentDate)}</time></p></div>
                        <p className="hidden text-xs text-secondary md:block">Scheduled<br /><time dateTime={sub.nextPaymentDate}>{formatCalendarDate(sub.nextPaymentDate)}</time></p>
                        <p className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{formatAmount(sub.amount)}</p>
                        <div className="col-span-2 flex justify-end md:col-span-1">
                            <button type="button" onClick={() => onEdit(sub)} className="ui-icon-button" aria-label={`Edit subscription: ${sub.serviceName}`} title="Edit subscription"><Pencil size={16} aria-hidden="true" /></button>
                            <button type="button" onClick={() => onDelete(sub.id)} className="ui-icon-button hover:text-red-600 dark:hover:text-red-300" aria-label={`Delete subscription: ${sub.serviceName}`} title="Delete subscription"><Trash2 size={16} aria-hidden="true" /></button>
                        </div>
                    </li>
                ))}
            </ul> : <div className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">No subscriptions match this view.</p><p className="mt-1 text-sm text-secondary">Add a service or choose another status filter.</p></div><button type="button" onClick={onAdd} className="ui-primary-action">Add Subscription</button></div>}
        </section>
    );
}
