/** Canonical USD uses eight decimal places. Display conversions never change it. */
const SCALE = 100000000n;
const INPUT_PATTERN = /^[0-9]{1,12}(?:\.[0-9]{1,8})?$/;

/** Validate a nonnegative API input and return its exact scaled integer value. */
export function units(value: string): bigint {
    if (typeof value !== 'string' || !INPUT_PATTERN.test(value)) {
        throw new Error('Use a nonnegative decimal with at most 12 integer and 8 fractional digits.');
    }
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

/** Aggregate responses may be signed and exceed the range of a single record. */
export function signedUnits(value: string): bigint {
    if (typeof value !== 'string' || !/^-?[0-9]+(?:\.[0-9]{1,8})?$/.test(value)) {
        throw new Error('Invalid decimal amount.');
    }
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
    return negative ? -result : result;
}

/** Serialize scaled values without using binary floating point. */
export function decimal(value: bigint): string {
    const magnitude = value < 0n ? -value : value;
    return `${value < 0n ? '-' : ''}${magnitude / SCALE}.${(magnitude % SCALE).toString().padStart(8, '0')}`;
}

export function normalizeMoneyInput(value: string, positive = false): string {
    const parsed = units(value);
    if (positive && parsed === 0n) throw new Error('Amount must be greater than zero.');
    return decimal(parsed);
}

/** Rates are exact positive decimal ratios, independent of API money precision. */
function rateRatio(value: string): { numerator: bigint; denominator: bigint } {
    if (typeof value !== 'string' || !/^[0-9]{1,12}(?:\.[0-9]{1,18})?$/.test(value)) {
        throw new Error('The exchange rate must be a positive plain decimal. Choose USD to enter an exact amount.');
    }
    const [whole, fraction = ''] = value.split('.');
    const numerator = BigInt(whole + fraction);
    if (numerator === 0n) throw new Error('The exchange rate must be greater than zero.');
    return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

/** Convert an edited display-currency input, rejecting any lost USD precision. */
export function toUSD(amount: string, rate: string): string {
    const ratio = rateRatio(rate);
    const numerator = units(amount) * ratio.denominator;
    if (numerator % ratio.numerator !== 0n) {
        throw new Error('This conversion needs more than 8 USD decimal places. Enter an exact amount or choose USD.');
    }
    const result = decimal(numerator / ratio.numerator);
    units(result);
    return result;
}

/** Exact edit prefill; it can need more digits than a newly entered API amount. */
export function fromUSD(amount: string, rate: string): string {
    const ratio = rateRatio(rate);
    const product = units(amount) * ratio.numerator;
    const denominator = SCALE * ratio.denominator;
    const places = denominator.toString().length - 1;
    const whole = product / denominator;
    const fractional = (product % denominator).toString().padStart(places, '0').replace(/0+$/, '');
    return fractional ? `${whole}.${fractional}` : whole.toString();
}
