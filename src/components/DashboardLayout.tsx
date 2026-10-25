import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import Topbar from './Topbar';
import { navigationItems } from './navigation';

interface DashboardLayoutProps {
    children: ReactNode;
    isDarkMode: boolean;
    toggleTheme: () => void;
}

function DesktopNavigation() {
    const [dismissedTooltip, setDismissedTooltip] = useState<string | null>(null);
    return (
        <nav aria-label="Sidebar navigation" className="flex flex-col items-center gap-1 py-3">
            {navigationItems.map(({ path, label, icon: Icon }) => (
                <NavLink
                    key={path}
                    to={path}
                    end={path === '/'}
                    aria-label={label}
                    className="group ui-sidebar-link"
                    onFocus={() => setDismissedTooltip(null)}
                    onMouseEnter={() => setDismissedTooltip(null)}
                    onKeyDown={event => {
                        if (event.key === 'Escape') setDismissedTooltip(path);
                    }}
                >
                    <Icon size={20} aria-hidden="true" />
                    <span role="tooltip" hidden={dismissedTooltip === path} className="pointer-events-none invisible absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2 whitespace-nowrap rounded-control border border-subtle bg-surface px-3 py-2 text-xs font-medium text-primary opacity-0 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100">
                        {label}
                    </span>
                </NavLink>
            ))}
        </nav>
    );
}

function MobileNavigation({ onNavigate }: { onNavigate: () => void }) {
    return (
        <nav aria-label="Mobile navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
            {navigationItems.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} to={path} end={path === '/'} onClick={onNavigate} className="ui-nav-link">
                    <Icon size={20} aria-hidden="true" /><span>{label}</span>
                </NavLink>
            ))}
        </nav>
    );
}

function DashboardLayout({ children, isDarkMode, toggleTheme }: DashboardLayoutProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const drawerRef = useRef<HTMLDialogElement>(null);
    const menuRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const desktop = window.matchMedia('(min-width: 768px)');
        const closeOnDesktop = () => {
            if (desktop.matches) drawerRef.current?.close();
        };
        desktop.addEventListener('change', closeOnDesktop);
        return () => desktop.removeEventListener('change', closeOnDesktop);
    }, []);

    useEffect(() => {
        if (!sidebarOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previousOverflow; };
    }, [sidebarOpen]);

    const closeDrawer = () => drawerRef.current?.close();
    const restoreMenuFocus = () => {
        setSidebarOpen(false);
        if (!window.matchMedia('(min-width: 768px)').matches) menuRef.current?.focus();
    };

    return (
        <div className="min-h-screen bg-canvas text-primary">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-surface focus:p-3">
                Skip to content
            </a>
            <Topbar isDarkMode={isDarkMode} toggleTheme={toggleTheme} sidebarOpen={sidebarOpen} menuRef={menuRef} onOpenNavigation={() => {
                drawerRef.current?.showModal();
                setSidebarOpen(true);
            }} />
            <div className="flex min-w-0">
                <aside aria-label="Sidebar" className="ui-sidebar sticky top-[72px] hidden h-[calc(100dvh-72px)] w-[72px] shrink-0 flex-col items-center border-r border-subtle bg-surface md:flex">
                    <DesktopNavigation />
                </aside>
                <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8">
                    {children}
                </main>
            </div>

            {/* Native dialogs contain focus, isolate the background and close on Escape. */}
            <dialog
                ref={drawerRef}
                id="mobile-navigation"
                aria-label="Main navigation drawer"
                onClose={restoreMenuFocus}
                onKeyDown={event => {
                    if (event.key !== 'Tab') return;
                    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
                    const first = items[0], last = items[items.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault(); last?.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault(); first?.focus();
                    }
                }}
                onClick={event => {
                    if (event.target !== event.currentTarget) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDrawer();
                }}
                className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,calc(100%-3rem))] max-w-none flex-col border-0 border-r border-subtle bg-surface p-0 text-primary shadow-overlay backdrop:bg-ink/40 open:flex md:hidden"
            >
                <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-subtle px-4">
                    <span className="text-lg font-semibold">Navigation</span>
                    <button type="button" aria-label="Close navigation" onClick={closeDrawer} className="ui-icon-button">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <MobileNavigation onNavigate={closeDrawer} />
            </dialog>
        </div>
    );
}

export default DashboardLayout;
