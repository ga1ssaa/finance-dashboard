import { useState } from "react";
import { useResource } from "../hooks/useResource";
import { subscriptionFromApi } from "../hooks/useSubscriptions";
import type { Page, SubscriptionRecord, SubscriptionSummary } from "../api/client";
import ResourceStatus from "../components/ResourceStatus";
import ActiveSubscriptions from "../features/subscriptions/ActiveSubscriptions";
import type { Subscription } from "../types/finance";
import { Plus, Moon, Sun } from "lucide-react";

interface SubscriptionsPageProps {
  onOpenAddModal: () => void;
  onEditSubscription: (sub: Subscription) => void;
  onDeleteSubscription: (id: string | number) => void;
  isDarkMode?: boolean;
  toggleTheme?: () => void;
}

function SubscriptionsPage({onOpenAddModal, onEditSubscription, onDeleteSubscription, isDarkMode, toggleTheme}: SubscriptionsPageProps){
  const [offset,setOffset] = useState(0);
  const [status,setStatus] = useState('all');
  const [sort,setSort] = useState('next_payment_date:asc');
  const [field,direction] = sort.split(':');
  const query = new URLSearchParams({limit:'20',offset:String(offset),sort_by:field,sort_direction:direction});
  if(status !== 'all') query.set('status',status);
  const resource = useResource<Page<SubscriptionRecord>>(`/subscriptions?${query}`);
  const summary = useResource<SubscriptionSummary>('/subscriptions/summary');
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-serif font-bold text-2xl text-slate-800 dark:text-white transition-colors">
            Subscriptions
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm transition-colors">
            Manage your recurring payments and services
          </p>
        </div>

        {/* Theme Toggle and Add Button */}
        <div className="flex items-center gap-3">
          {toggleTheme && (
            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm cursor-pointer"
              title="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          )}

          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-colors font-bold text-sm shadow-sm cursor-pointer w-fit"
          >
            <Plus size={18} />
            <span>Add Subscription</span>
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-slate-700 dark:text-slate-200">
        <select aria-label="Subscription status" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}} className="p-2 rounded-lg dark:bg-slate-800"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option></select>
        <select aria-label="Sort subscriptions" value={sort} onChange={e=>{setSort(e.target.value);setOffset(0);}} className="p-2 rounded-lg dark:bg-slate-800"><option value="next_payment_date:asc">Payment date: earliest</option><option value="next_payment_date:desc">Payment date: latest</option><option value="amount_usd:asc">Amount: low to high</option><option value="amount_usd:desc">Amount: high to low</option><option value="service_name:asc">Service name</option></select>
      </div>
      <ResourceStatus loading={resource.loading || summary.loading} error={resource.error || summary.error} retry={resource.retry} />
      {/* Main Content Area */}
      <div className="w-full">
        <ActiveSubscriptions
          subscriptions={(resource.data?.items || []).map(subscriptionFromApi)}
          summary={summary.data}
          onEdit={onEditSubscription}
          onDelete={onDeleteSubscription}
        />
      </div>
      <div className="flex justify-between text-sm text-slate-600 dark:text-slate-300"><button disabled={offset===0 || resource.loading} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</button><span>{resource.data?.total || 0} subscriptions · Page {offset/20+1}</span><button disabled={resource.loading || !resource.data || offset+20>=resource.data.total} onClick={()=>setOffset(offset+20)}>Next</button></div>
    </div>
  );
}

export default SubscriptionsPage;