import { useEffect, useRef, type ReactNode } from 'react';

/** Visible by default; sections not yet meaningfully visible opt into one non-blocking reveal. */
export default function ScrollReveal({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof window.IntersectionObserver !== 'function' || typeof window.matchMedia !== 'function') return;
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const bounds = element.getBoundingClientRect();
        const visibleHeight = Math.min(bounds.top + bounds.height, window.innerHeight) - Math.max(bounds.top, 0);
        if (motion.matches || (bounds.height > 0 && visibleHeight / bounds.height >= 0.15)) return;
        let observer: IntersectionObserver | undefined;
        let revealed = false;
        const show = (animate: boolean) => {
            if (revealed) { if (!animate) delete element.dataset.reveal; return; }
            revealed = true;
            if (animate) element.dataset.reveal = 'shown';
            else delete element.dataset.reveal;
            observer?.disconnect();
        };
        const interact = () => show(false);
        const reduceMotion = () => { if (motion.matches) show(false); };
        try {
            observer = new window.IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting && (
                    entry.intersectionRatio >= 0.15
                    // A very tall section in a short viewport may never reach 15%.
                    || entry.boundingClientRect.height * 0.15 > (entry.rootBounds?.height ?? window.innerHeight)
                ))) show(true);
            }, { threshold: 0.15, rootMargin: '0px' });
            element.dataset.reveal = 'pending';
            observer.observe(element);
            element.addEventListener('focusin', interact);
            element.addEventListener('pointerdown', interact);
            motion.addEventListener?.('change', reduceMotion);
        } catch {
            delete element.dataset.reveal;
            observer?.disconnect();
        }
        return () => {
            revealed = true;
            observer?.disconnect();
            element.removeEventListener('focusin', interact);
            element.removeEventListener('pointerdown', interact);
            motion.removeEventListener?.('change', reduceMotion);
            delete element.dataset.reveal;
        };
    }, []);
    return <div ref={ref} className="overview-reveal">{children}</div>;
}
