import SelectControl from "../components/SelectControl";
import { useState } from "react";
import { useResource } from "../hooks/useResource";
import { subscriptionFromApi } from "../hooks/useSubscriptions";
import type { Page, SubscriptionRecord, SubscriptionSummary } from "../api/client";
import ResourceStatus from "../components/ResourceStatus";
import ActiveSubscriptions from "../features/subscriptions/ActiveSubscriptions";
import type { Subscription } from "../types/finance";
import { Plus } from "lucide-react";

interface SubscriptionsPageProps {
  onOpenAddModal: () => void;
  onEditSubscription: (sub: Subscription) => void;
  onDeleteSubscription: (id: string | number) => void;
}

function SubscriptionsPage({onOpenAddModal, onEditSubscription, onDeleteSubscription}: SubscriptionsPageProps){
  const [offset,setOffset] = useState(0);
  const [status,setStatus] = useState('all');
  const [sort,setSort] = useState('next_payment_date:asc');
  const [field,direction] = sort.split(':');
  const query = new URLSearchParams({limit:'20',offset:String(offset),sort_by:field,sort_direction:direction});
  if(status !== 'all') query.set('status',status);
  const resource = useResource<Page<SubscriptionRecord>>(`/subscriptions?${query}`);
  const summary = useResource<SubscriptionSummary>('/subscriptions/summary');
  return (
    <div className="ui-page">
      {/* Page Header */}
      <div className="ui-page-header">
        <div>
          <h2 className="ui-page-title">
            Subscriptions
          </h2>
          <p className="ui-page-description">
            Manage your recurring payments and services
          </p>
        </div>

        {/* Add Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-accent-ink px-4 py-2.5 rounded-control transition-colors font-semibold text-sm shadow-none cursor-pointer w-fit"
          >
            <Plus size={18} />
            <span>Add Subscription</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-secondary">
        <SelectControl aria-label="Subscription status" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}} className="border-control bg-surface px-3 text-sm text-primary font-medium"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option></SelectControl>
        <SelectControl aria-label="Sort subscriptions" value={sort} onChange={e=>{setSort(e.target.value);setOffset(0);}} className="border-control bg-surface px-3 text-sm text-primary font-medium"><option value="next_payment_date:asc">Payment date: earliest</option><option value="next_payment_date:desc">Payment date: latest</option><option value="amount_usd:asc">Amount: low to high</option><option value="amount_usd:desc">Amount: high to low</option><option value="service_name:asc">Service name</option></SelectControl>
      </div>
      <ResourceStatus loading={resource.loading || summary.loading} error={resource.error || summary.error} retry={resource.retry} />
      {/* Main Content Area */}
      <div className="w-full">
        {!resource.loading && !resource.error && <ActiveSubscriptions
          subscriptions={(resource.data?.items || []).map(subscriptionFromApi)}
          summary={!summary.loading && !summary.error ? summary.data : null}
          onAdd={onOpenAddModal}
          onEdit={onEditSubscription}
          onDelete={onDeleteSubscription}
        />}
      </div>
      <div className="ui-pagination"><button disabled={offset===0 || resource.loading} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</button><span>{resource.data?.total || 0} subscriptions · Page {offset/20+1}</span><button disabled={resource.loading || !resource.data || offset+20>=resource.data.total} onClick={()=>setOffset(offset+20)}>Next</button></div>
    </div>
  );
}

export default SubscriptionsPage;