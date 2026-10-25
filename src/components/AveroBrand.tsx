import AveroMark from './AveroMark';

/** The geometric A supplies the first letter; assistive technology reads the full name. */
export default function AveroBrand({ inverse = false, className = '' }: { inverse?: boolean; className?: string }) {
    return (
        <span role="img" aria-label="AVERO" className={`ui-brand ${inverse ? 'ui-brand-inverse' : ''} ${className}`}>
            <AveroMark decorative className="ui-brand-mark" />
            <span aria-hidden="true" className="ui-brand-wordmark">VERO</span>
        </span>
    );
}
