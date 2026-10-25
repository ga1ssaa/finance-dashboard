/** Canonical USD uses eight decimal places. Display conversions never change it. */
const SCALE = 100000000n;
const MAX_UNITS = 99999999999999999999n;
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

export function validateExchangeRate(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Exchange rate unavailable. Choose USD or retry loading rates.');
    const text = String(value);
    rateRatio(text);
    return text;
}

/** Bounded plain decimals also cover exact foreign-currency edit prefills. */
function parts(value: string) {
    const match = typeof value === 'string' && /^(-?)([0-9]{1,30})(?:\.([0-9]{1,64}))?$/.exec(value);
    if (!match) throw new Error('Use a plain decimal amount, without signs, separators or exponent notation.');
    return { coefficient: BigInt(match[2] + (match[3] || '')) * (match[1] ? -1n : 1n), places: (match[3] || '').length };
}

/** Integer-only nearest rounding; exact midpoint quotients go to the even integer. */
function halfEven(numerator: bigint, denominator: bigint): bigint {
    const quotient = numerator / denominator, remainder = numerator % denominator;
    return quotient + (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n) ? 1n : 0n);
}

export function sameDecimalAmount(left: string, right: string): boolean {
    try {
        const a = parts(left), b = parts(right);
        return a.coefficient * 10n ** BigInt(b.places) === b.coefficient * 10n ** BigInt(a.places);
    } catch { return false; }
}

/** Shared USD boundary: strict by default; transactions opt into nearest/ties-to-even at 8 places. */
export function toUSD(amount: string, rate: string, rounding: 'exact' | 'half-even' = 'exact'): string {
    const ratio = rateRatio(rate);
    if (rounding === 'half-even') {
        const input = parts(amount);
        if (amount.startsWith('-')) throw new Error('Amount must be nonnegative.');
        const numerator = input.coefficient * SCALE * ratio.denominator;
        const denominator = 10n ** BigInt(input.places) * ratio.numerator;
        if (numerator > MAX_UNITS * denominator) throw new Error('Converted amount exceeds the USD database limit (999999999999.99999999).');
        return decimal(halfEven(numerator, denominator));
    }
    const numerator = units(amount) * ratio.denominator;
    if (numerator % ratio.numerator !== 0n) {
        throw new Error('This conversion needs more than 8 USD decimal places. Enter an exact amount or choose USD.');
    }
    const result = decimal(numerator / ratio.numerator);
    units(result);
    return result;
}

/** Exact display conversion, including signed full-set aggregates; never persisted. */
export function displayFromUSD(amount: string | number, rate: string): string {
    let text = String(amount);
    // Legacy chart/manual-budget presenters sometimes supply Number values in exponent notation.
    // Expand their digits as text; never multiply monetary Number values by an exchange rate.
    const exponent = typeof amount === 'number' && /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text);
    if (exponent) {
        const digits = exponent[2] + (exponent[3] || '');
        const position = exponent[2].length + Number(exponent[4]);
        if (position < -64 || position > 30) throw new Error('Display amount outside supported range.');
        text = exponent[1] + (position <= 0 ? `0.${'0'.repeat(-position)}${digits}` : position >= digits.length ? digits.padEnd(position, '0') : `${digits.slice(0, position)}.${digits.slice(position)}`);
    }
    const input = parts(text), ratio = rateRatio(rate);
    const product = input.coefficient * ratio.numerator;
    const negative = product < 0n, magnitude = negative ? -product : product;
    const places = input.places + ratio.denominator.toString().length - 1;
    const scale = 10n ** BigInt(places);
    const fraction = (magnitude % scale).toString().padStart(places, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${magnitude / scale}${fraction ? `.${fraction}` : ''}`;
}

/** Preserve the existing ru-RU presentation and half-up display rounding, without Number arithmetic. */
export function formatDisplayDecimal(value: string, digits: number): string {
    const input = parts(value), negative = input.coefficient < 0n;
    const magnitude = negative ? -input.coefficient : input.coefficient;
    const denominator = 10n ** BigInt(input.places), scale = 10n ** BigInt(digits);
    const numerator = magnitude * scale;
    const rounded = numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n);
    return `${negative ? '-' : ''}${(rounded / scale).toLocaleString('ru-RU')}${digits ? `,${(rounded % scale).toString().padStart(digits, '0')}` : ''}`;
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
