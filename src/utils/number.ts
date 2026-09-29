import { t } from '@/i18n';

const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "12.480" */
export function formatNumber(value: number): string {
  return integerFormatter.format(value);
}

/**
 * "412 mil", "4,8 mil", "1,2 mi". Feito à mão porque a notação compacta do
 * Intl no Hermes não é confiável entre versões.
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const withUnit = (divisor: number, unit: string): string => {
    const scaled = abs / divisor;
    const digits = scaled < 10 ? 1 : 0;
    const rounded = Number(scaled.toFixed(digits));
    return `${sign}${rounded.toLocaleString('pt-BR', { maximumFractionDigits: digits })} ${unit}`;
  };
  if (abs >= 1_000_000_000) return withUnit(1_000_000_000, 'bi');
  if (abs >= 1_000_000) return withUnit(1_000_000, 'mi');
  if (abs >= 1_000) return withUnit(1_000, 'mil');
  return formatNumber(value);
}

/** "+20", "-1.000". Ganho e gasto de pontos. */
export function formatPointsDelta(value: number): string {
  const formatted = formatNumber(Math.abs(value));
  return value < 0 ? `-${formatted}` : `+${formatted}`;
}

/** "20 pontos", "1 ponto": pontos por extenso, para frases e para o leitor de tela. */
export function formatPointsSpoken(value: number): string {
  if (Math.abs(value) === 1) return t('points.spokenOne', { points: formatNumber(value) });
  return t('points.spoken', { points: formatNumber(value) });
}

/**
 * Separador de milhar para contadores animados. Worklet não tem Intl, então o
 * "." é colocado à mão.
 */
export function formatThousandsWorklet(value: number): string {
  'worklet';
  const rounded = Math.round(value);
  const digits = Math.abs(rounded).toString();
  let result = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += '.';
    result += digits[i];
  }
  return rounded < 0 ? `-${result}` : result;
}
