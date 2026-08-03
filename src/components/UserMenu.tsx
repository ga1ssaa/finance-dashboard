import React, { useState, useRef, useEffect } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";

export const UserMenu: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if(menuRef.current && !menuRef.current.contains(event.target as Node)) {
            setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleResetData = () => {
        if (window.confirm("Are you sure you want to reset all demo data to default values?")){
            localStorage.clear();
            window.location.reload();
        }        
    };
    
    return(
        <div>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-sans font-semibold text-sm hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
                aria-label="User menu"
            >
            A
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Demo Account</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-white mt-1">
                            Admin User
                            </p>
                        <p className="text-xs text-slate-400 dark:text-slate-400 truncate">
                        demo@finance-dashboard.io
                        </p>
                    </div>
                    <div className="pt-1">
                        <button
                            onClick={handleResetData}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-red-600 dark:hover:text-red-400 transition-colors text-left"
                        >
                        <RotateCcw className="w-4 h-4" />
                            <span>Reset demo data</span>
                            </button>
                        </div>
                    </div>
                    )}
                </div>
        );
    };
