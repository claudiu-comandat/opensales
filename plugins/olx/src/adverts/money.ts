import type { Money, OlxPrice } from './types.js';

/** Subunități per unitate majoră (ex. bani/leu, cenți/euro). */
const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Convertește un `Money` OpenSales (amountMinor bigint) la `value` OLX (unitate
 * majoră, number). OLX cere valoarea în unități majore pe câmpul `price.value`.
 * Currency e normalizat în uppercase (cerut de OLX pentru salary; aplicat uniform).
 */
export function moneyToOlxValue(money: Money): { value: number; currency: string } {
  return {
    value: Number(money.amountMinor) / MINOR_UNITS_PER_MAJOR,
    currency: money.currency.toUpperCase(),
  };
}

/**
 * Convertește un preț OLX (unitate majoră) înapoi în `Money` (amountMinor bigint).
 * Rotunjește la cel mai apropiat întreg de subunități pentru a evita erorile de float.
 */
export function olxPriceToMoney(price: Pick<OlxPrice, 'value' | 'currency'>): Money {
  const amountMinor = BigInt(Math.round(price.value * MINOR_UNITS_PER_MAJOR));
  return { amountMinor, currency: price.currency.toUpperCase() };
}
