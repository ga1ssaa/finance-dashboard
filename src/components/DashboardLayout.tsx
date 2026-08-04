import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, ArrowRightLeft, CreditCard, Target, Settings, Menu, X} from "lucide-react";
import { UserMenu } from "./UserMenu";

interface DashboardLayoutProps {
  children: ReactNode;
}

const navItems = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/transactions", label: "Transactions", icon: ArrowRightLeft },
    { path: "/subscriptions", label: "Subscriptions", icon: CreditCard },
    { path: "/budget", label: "Budget and Goals", icon: Target },
    { path: "/settings", label: "Settings", icon: Settings },
];

function DashboardLayout({ children }: DashboardLayoutProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex transition-colors duration-200">

            {/* Overlay (Mobile) */}
            {sidebarOpen && (
                <div
                className="fixed inset-0 bg-black/40 z-40 md:hidden"
                onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 z-50h-screen w-64 flex flex-col bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 transform transition-transform duration-300
                ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
                md:translate-x-0 md:static md:flex
                `}
            >
                {/* Close Button (Mobile) */}
                <button
                    className="absolute top-5 right-5 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                >
                    <X size={24} />
                </button>

                {/* Logo */}
                <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700">
                    <h1 className="font-serif text-xl font-bold text-slate-800 dark:text-white">
                        FinanceApp
                    </h1>
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-2">
                {navItems.map((item) => {
                    const Icon = item.icon;

                    return (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-2 rounded-lg transition-colors font-serif ${
                            isActive
                            ? "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        }`
                        }
                    >
                        <Icon size={20} />
                        <span>{item.label}</span>
                    </NavLink>
                    );
                })}
                </nav>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col">

                {/* Header */}
                <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 md:px-8">

                <div className="flex items-center gap-3">

                    <button
                        className="md:hidden"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <Menu size={24} />
                    </button>

                    <h2 className="font-serif text-xl font-semibold text-slate-800 dark:text-white">
                        Financial Overview
                    </h2>

                </div>

                    <UserMenu />
                </header>

                {/* Content */}
                <main className="flex-1 overflow-auto p-4 md:p-8">
                    {children}
                </main>

            </div>
        </div>
    );
}

    export default DashboardLayout;