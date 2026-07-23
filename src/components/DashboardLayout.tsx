import type { ReactNode } from "react";
import { LayoutDashboard, ArrowRightLeft } from "lucide-react";

interface DashboardLayoutProps {
    children: ReactNode;
};

function DashboardLayout({children}: DashboardLayoutProps){
    return(
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex transition-colors duration-200">
            {/* Sidebar */}
            <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col hidden md:flex transition-colors duration-200">
                <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700 transition-colors">
                    <h1 className="font-serif text-xl font-bold text-slate-800 dark:text-white transition-colors">
                        FinanceApp
                    </h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <a href="#" className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-lg transition-colors">
                        <LayoutDashboard size={20}/>
                        <span className="font-serif font-medium">Dashboard</span>
                    </a>

                    <a href="#" className="flex items-center gap-3 px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors">
                        <ArrowRightLeft size={20}/>
                        <span className="font-serif">Transactions</span>
                    </a>
                </nav>
            </aside>

            {/* Main Part */}
            <div className="flex-1 flex flex-col">
                <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center px-8 justify-between transition-colors duration-200">

                    <h2 className="font-serif text-xl font-medium font-semibold text-slate-800 dark:text-white transition-colors">
                        Financial Overview
                    </h2>

                    <div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center rounded-full font-bold font-serif transition-colors">
                        A
                    </div>
                </header>

                <main className="flex-1 p-8 overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}
export default DashboardLayout