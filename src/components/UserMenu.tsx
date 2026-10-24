import { useState, useRef, useEffect } from 'react';
import { LogOut, RotateCcw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../state/authStore';
import { useResource } from '../hooks/useResource';
import type { AuthUser } from '../api/authSession';

export const UserMenu = () => {
    const auth = useAuth();
    const identity = useResource<AuthUser>('/auth/me');
    const user = identity.data || auth.user;
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    return (
        <div ref={menuRef} className="relative">
            <button onClick={() => setIsOpen(!isOpen)} aria-label="User menu" aria-expanded={isOpen} className="flex items-center justify-center w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-semibold text-sm hover:bg-blue-200 dark:hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {user?.email.charAt(0).toUpperCase() || 'U'}
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 py-2 z-50">
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider"><ShieldCheck size={14} /><span>Your account</span></div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-white mt-2 truncate">{user?.email}</p>
                        {identity.error && <p className="text-xs text-slate-500 mt-1">Account details could not be refreshed.</p>}
                    </div>
                    <button disabled title="Reset is unavailable for API-managed data. Existing browser data is left untouched." className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-400 text-left"><RotateCcw size={16} /><span>Reset unavailable</span></button>
                    <button onClick={() => { void auth.logout().catch(() => {}); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left"><LogOut size={16} /><span>Sign out</span></button>
                </div>
            )}
        </div>
    );
};
