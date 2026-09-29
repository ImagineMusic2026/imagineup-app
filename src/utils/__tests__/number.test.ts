import {
  formatCompact,
  formatNumber,
  formatPointsDelta,
  formatPointsSpoken,
  formatThousandsWorklet,
} from '../number';
import { withAlpha } from '../color';

describe('números em pt-BR', () => {
  it('usa ponto no milhar, como o saldo do protótipo', () => {
    expect(formatNumber(12480)).toBe('12.480');
    expect(formatThousandsWorklet(12480)).toBe('12.480');
    expect(formatThousandsWorklet(1234567.4)).toBe('1.234.567');
    expect(formatThousandsWorklet(-2520)).toBe('-2.520');
  });

  it.each([
    [950, '950'],
    [4812, '4,8 mil'],
    [412000, '412 mil'],
    [1_250_000, '1,3 mi'],
  ])('%i vira %s', (value, expected) => {
    expect(formatCompact(value)).toBe(expected);
  });

  it('marca ganho e gasto de pontos', () => {
    expect(formatPointsDelta(20)).toBe('+20');
    expect(formatPointsDelta(-10000)).toBe('-10.000');
  });

  it.each([
    [20, '20 pontos'],
    [1, '1 ponto'],
    [12480, '12.480 pontos'],
    [0, '0 pontos'],
  ])('%i por extenso vira "%s"', (value, expected) => {
    expect(formatPointsSpoken(value)).toBe(expected);
  });

  it('tinge cores do tema com opacidade', () => {
    expect(withAlpha('#FF2D6F', 0.12)).toBe('rgba(255, 45, 111, 0.12)');
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });
});
