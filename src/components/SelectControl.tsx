import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type Props = ComponentPropsWithRef<'select'> & { containerClassName?: string; leadingIcon?: ReactNode };

/** Native select semantics and events, with one consistently inset visual arrow. */
export default function SelectControl({ children, className = '', containerClassName = '', leadingIcon, ...props }: Props) {
    return (
        <span className={`ui-select-wrap ${containerClassName}`}>
            <select {...props} className={`ui-select ${leadingIcon ? 'ui-select-with-icon' : ''} ${className}`}>{children}</select>
            <ChevronDown size={16} aria-hidden="true" focusable="false" className="ui-select-arrow" />
            {leadingIcon && <span aria-hidden="true" className="ui-select-leading">{leadingIcon}</span>}
        </span>
    );
}
