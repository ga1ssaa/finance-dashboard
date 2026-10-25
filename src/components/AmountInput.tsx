import type { ComponentPropsWithRef } from 'react';

type Props = Omit<ComponentPropsWithRef<'input'>, 'type'> & { symbol: string; currency: string };

/** One bordered flex control shares the symbol/input line box, height and focus outline. */
export default function AmountInput({ symbol, currency, className = '', ...props }: Props) {
    return (
        <div className="ui-amount-input" data-invalid={props['aria-invalid'] || undefined}>
            <span aria-hidden="true" className="ui-amount-symbol">{symbol}</span>
            <input {...props} type="text" inputMode="decimal" aria-label={props['aria-label'] || `Amount (${currency})`} className={`ui-amount-field ${className}`} />
        </div>
    );
}
