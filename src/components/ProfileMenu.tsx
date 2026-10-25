import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, LogOut, Settings, Trash2 } from 'lucide-react';
import type { AuthUser } from '../api/authSession';
import { prepareAvatar, readAvatar, removeAvatar, saveAvatar } from '../utils/avatar';

interface Props {
    user: AuthUser;
    logout: () => Promise<void>;
    identityError: boolean;
}

export default function ProfileMenu({ user, logout, identityError }: Props) {
    const [photo, setPhoto] = useState(() => {
        try { return { src: readAvatar(user.id), error: '', notice: '' }; }
        catch { return { src: null as string | null, error: 'Profile photo storage is unavailable in this browser.', notice: '' }; }
    });
    const [isOpen, setIsOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const firstFocus = useRef<'first' | 'last'>('first');
    const generation = useRef(0);
    const mounted = useRef(true);
    const id = useId();
    const closeMenu = useCallback((restoreFocus = false) => {
        setIsOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; generation.current += 1; };
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)');
        if (items?.length) items[firstFocus.current === 'last' ? items.length - 1 : 0].focus();
        const outside = (event: Event) => {
            if (!containerRef.current?.contains(event.target as Node)) closeMenu();
        };
        const escape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
            document.removeEventListener('keydown', escape);
        };
    }, [isOpen, closeMenu]);

    const upload = async (file: File) => {
        const current = ++generation.current;
        const active = () => mounted.current && generation.current === current;
        setBusy(true);
        setPhoto(previous => ({ ...previous, error: '', notice: '' }));
        try {
            const src = await prepareAvatar(file);
            if (!active()) return;
            saveAvatar(user.id, src);
            setPhoto({ src, error: '', notice: 'Profile photo saved on this browser.' });
        } catch (error) {
            if (active()) setPhoto(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Unable to update your profile photo.', notice: '' }));
        } finally {
            if (active()) setBusy(false);
        }
    };
    const remove = () => {
        try {
            removeAvatar(user.id);
            setPhoto({ src: null, error: '', notice: 'Profile photo removed from this browser.' });
            menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        } catch (error) {
            setPhoto(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Unable to remove your profile photo.', notice: '' }));
        }
    };
    const openMenu = (position: 'first' | 'last' = 'first') => {
        firstFocus.current = position;
        setIsOpen(true);
    };
    const menuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Tab') { closeMenu(true); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
        if (!items.length) return;
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
    };
    const avatar = (size: string) => (
        <span className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-accent font-medium`}>
            {photo.src ? <img src={photo.src} alt="" className="h-full w-full object-cover" onError={() => setPhoto(previous => ({ ...previous, src: null, error: 'The saved photo could not be displayed. Please choose another image.', notice: '' }))} />
                : user.email.charAt(0).toUpperCase() || 'U'}
        </span>
    );

    return (
        <div ref={containerRef} className="relative">
            <button
                ref={triggerRef}
                id={`${id}-trigger`}
                type="button"
                aria-label="User menu"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={`${id}-menu`}
                className="ui-icon-button"
                onClick={() => { if (isOpen) closeMenu(); else openMenu(); }}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault(); openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
                    }
                }}
            >
                {avatar('h-9 w-9')}
            </button>
            <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Choose profile photo"
                className="hidden"
                onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) { openMenu(); void upload(file); }
                }}
            />
            {/* Keep feedback mounted so updates are announced after the file picker closes. */}
            <div className={isOpen ? 'absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-card border border-subtle bg-surface shadow-overlay' : 'sr-only'}>
                {isOpen && (
                    <div className="flex items-center gap-3 border-b border-subtle px-4 py-3">
                        {avatar('h-11 w-11')}
                        <div className="min-w-0">
                            <p className="break-all text-sm font-medium text-primary">{user.email}</p>
                            {identityError && <p className="mt-1 text-xs text-secondary">Account details could not be refreshed.</p>}
                        </div>
                    </div>
                )}
                <div role="alert" className={photo.error && isOpen ? 'px-4 py-2 text-xs text-red-600 dark:text-red-300' : 'sr-only'}>{photo.error}</div>
                <div role="status" className={(busy || photo.notice) && isOpen ? 'px-4 py-2 text-xs text-secondary' : 'sr-only'}>{busy ? 'Preparing profile photo…' : photo.notice}</div>
                {isOpen && (
                    <div ref={menuRef} id={`${id}-menu`} role="menu" aria-labelledby={`${id}-trigger`} aria-busy={busy} onKeyDown={menuKeyDown} className="py-1">
                        <button type="button" role="menuitem" tabIndex={-1} disabled={busy} className="ui-profile-item" onClick={() => { closeMenu(true); fileRef.current?.click(); }}>
                            <ImagePlus size={16} aria-hidden="true" /><span>Change profile photo</span>
                        </button>
                        <button type="button" role="menuitem" tabIndex={-1} disabled={busy || !photo.src} className="ui-profile-item" onClick={remove}>
                            <Trash2 size={16} aria-hidden="true" /><span>Remove profile photo</span>
                        </button>
                        <Link to="/settings" role="menuitem" tabIndex={-1} className="ui-profile-item" onClick={() => closeMenu(true)}>
                            <Settings size={16} aria-hidden="true" /><span>Settings</span>
                        </Link>
                        <button type="button" role="menuitem" tabIndex={-1} className="ui-profile-item" onClick={() => {
                            generation.current += 1;
                            closeMenu(true);
                            void logout().catch(() => {});
                        }}>
                            <LogOut size={16} aria-hidden="true" /><span>Log out</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
