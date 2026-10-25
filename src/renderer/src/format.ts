import type { Language } from '../../shared/i18n.ts';
import { evaluate } from './expression.ts';

/**
 * Parses a number typed by the user: a plain number with either decimal separator ("2.5" and "2,5",
 * because German users naturally type a comma) or a calculation such as "60/3 + 2" or "1in"
 * (see expression.ts).
 */
export function parseNumber(text: string): number | null {
  return evaluate(text);
}

export function formatNumber(value: number, language: Language, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: false }).format(value);
}

export function formatQuantity(value: number, language: Language, unit: string, maximumFractionDigits = 2): string {
  const formatted = new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: true }).format(value);
  return `${formatted} ${unit}`;
}

/** A value with `significant` digits at most, for quantities that span many orders of magnitude. */
export function formatSignificant(value: number, language: Language, unit: string, significant = 6): string {
  const formatted = new Intl.NumberFormat(language, { maximumSignificantDigits: significant, useGrouping: true }).format(value);
  return `${formatted} ${unit}`;
}

/** A mass in kg: grams below 1 kg. */
export function formatMass(kilograms: number, language: Language): string {
  return Math.abs(kilograms) < 1 ? formatQuantity(kilograms * 1000, language, 'g', 2) : formatQuantity(kilograms, language, 'kg', 3);
}
