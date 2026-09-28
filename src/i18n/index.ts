import translations from './translations.json';

type Translations = typeof translations;

/** Caminhos com ponto até cada texto: "auth.errors.network". */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<Translations>;

export type TranslationParams = Record<string, string | number>;

function lookup(key: string): string | undefined {
  let node: unknown = translations;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Todo texto visível e todo `accessibilityLabel` passa por aqui. O app é só
 * pt-BR; o arquivo único mantém a porta aberta para outro idioma sem caçar
 * strings no JSX.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = lookup(key);
  if (template === undefined) {
    if (__DEV__) console.warn(`[i18n] chave sem texto: ${key}`);
    return key;
  }
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
