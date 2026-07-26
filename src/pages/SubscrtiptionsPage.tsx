import ActiveSubscriptions from "../features/dashboard/ActiveSubscriptions";
import type { Subscription } from "../types/finance";
import { Plus, Moon, Sun } from "lucide-react";

interface SubscriptionsPageProps {
    subscriptions: Subscription[];
    onOpenAddModal: () => void;
    isDarkMode?: boolean;
    toggleTheme?: () => void;
};

function SubscriptionsPage({subscriptions, onOpenAddModal, isDarkMode, toggleTheme}: SubscriptionsPageProps){
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

      {/* Main Content Area */}
      <div className="w-full">
        <ActiveSubscriptions subscriptions={subscriptions} />
      </div>
    </div>
  );
}
export default SubscriptionsPage;