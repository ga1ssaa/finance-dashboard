import type { ReactNode } from "react";
import { LayoutDashboard, ArrowRightLeft } from "lucide-react";

interface DashboardLayoutProps {
    children: ReactNode;
};

function DashboardLayout({children}: DashboardLayoutProps){
    return(
        <div className="min-h-screen bg-slate-50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col hidden md:flex">
                <div className="h-16 flex items-center px-6 border-b border-slate-200">
                    <h1 className="font-serif text-xl font-bold text-slate-800">
                        FinanceApp
                    </h1>
                </div>
                <nav className="flex-1 p-4 space-y-2">
                    <a href="#" className="flex items-center gap-3 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg transition-colors">
                        <LayoutDashboard size={20}/>
                        <span className="font-serif font-medium">Dashboard</span>
                    </a>

                    <a href="#" className="flex items-center gap-3 px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">
                        <ArrowRightLeft size={20}/>
                        <span className="font-serif">Transactions</span>
                    </a>
                </nav>
            </aside>

            {/* Main Part */}
            <div className="flex-1 flex flex-col">
                <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 justify-between">
                    <h2 className="font-serif text-xl font-medium font-semibold text-slate-800">
                        Financial Overview
                    </h2>
                    <div className="w-9 h-9 bg-blue-100 text-blue-600 flex items-center justify-center rounded-full font-bold font-serif">
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