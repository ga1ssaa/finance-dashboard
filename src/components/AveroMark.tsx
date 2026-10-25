interface Props {
    className?: string;
    label?: string;
    decorative?: boolean;
}

/** Three separated angular facets form an A with a floating crossbar. */
export default function AveroMark({ className = 'h-7 w-7 text-accent', label = 'AVERO', decorative = false }: Props) {
    return (
        <svg viewBox="0 0 32 32" fill="none" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} focusable="false" className={className}>
            <path fill="currentColor" d="M2 28 13 5h6L8 28H2Z" />
            <path fill="currentColor" d="m20.5 8 9.5 20h-6.5l-6-13 3-7Z" />
            <path fill="currentColor" d="M14 19h4l2 4h-8l2-4Z" />
        </svg>
    );
}
