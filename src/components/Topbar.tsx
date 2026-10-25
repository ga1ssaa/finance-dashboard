import type { RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, Moon, Settings, Sun } from 'lucide-react';
import AveroBrand from './AveroBrand';
import { navigationItems } from './navigation';
import { UserMenu } from './UserMenu';

interface Props {
    isDarkMode: boolean;
    toggleTheme: () => void;
    sidebarOpen: boolean;
    menuRef: RefObject<HTMLButtonElement | null>;
    onOpenNavigation: () => void;
}

export default function Topbar({ isDarkMode, toggleTheme, sidebarOpen, menuRef, onOpenNavigation }: Props) {
    const themeLabel = isDarkMode ? 'Switch to light theme' : 'Switch to dark theme';
    return (
        <header className="sticky top-0 z-30 grid h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-subtle bg-surface px-2 sm:px-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6 lg:px-6">
            <div className="flex min-w-0 items-center gap-1 sm:gap-3">
                <button
                    ref={menuRef}
                    type="button"
                    aria-label="Open navigation"
                    aria-expanded={sidebarOpen}
                    aria-controls="mobile-navigation"
                    aria-haspopup="dialog"
                    className="ui-icon-button md:hidden"
                    onClick={onOpenNavigation}
                >
                    <Menu size={20} aria-hidden="true" />
                </button>
                <NavLink to="/" end aria-label="AVERO overview" className="inline-flex min-h-11 shrink-0 items-center rounded-control">
                    <AveroBrand />
                </NavLink>
            </div>
            <nav aria-label="Topbar navigation" className="hidden items-center gap-1 lg:flex">
                {navigationItems.filter(item => item.path !== '/settings').map(({ path, label }) => (
                    <NavLink key={path} to={path} end={path === '/'} className="ui-topbar-link">{label}</NavLink>
                ))}
            </nav>
            <div className="flex shrink-0 items-center justify-end sm:gap-2">
                <span className="inline-block h-11 w-11 shrink-0">
                    <button type="button" aria-label={themeLabel} aria-pressed={isDarkMode} title={themeLabel} onClick={toggleTheme} className="ui-icon-button ui-theme-toggle">
                        {isDarkMode ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
                    </button>
                </span>
                <NavLink to="/settings" aria-label="Settings" title="Settings" className="ui-icon-button ui-settings-link">
                    <Settings size={20} aria-hidden="true" />
                </NavLink>
                <UserMenu />
            </div>
        </header>
    );
}
