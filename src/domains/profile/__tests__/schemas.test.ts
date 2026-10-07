import { t } from '@/i18n';
import { CITY_MAX, DISPLAY_NAME_MAX } from '@/utils/visible-line';

import { editProfileSchema } from '../schemas';

// Nome e cidade da tela "Editar perfil" com as regras do firestore.rules
// (validDisplayName e validCity): o nome é o campo do cadastro, sem cópia.

const parse = (name: string, city: string) => editProfileSchema.safeParse({ name, city });
const firstError = (name: string, city: string) => parse(name, city).error?.issues[0]?.message;

describe('nome (o campo do cadastro)', () => {
  it.each([
    ['Camila Ribeiro', 'Camila Ribeiro'],
    ['  Camila Ribeiro  ', 'Camila Ribeiro'],
    ['Camila 👩‍🎤', 'Camila 👩‍🎤'],
    ['x'.repeat(DISPLAY_NAME_MAX), 'x'.repeat(DISPLAY_NAME_MAX)],
  ])('%j passa como %j', (typed, saved) => {
    expect(parse(typed, '').data?.name).toBe(saved);
  });

  it('vazio, longo e invisível são recusados com as mensagens do cadastro', () => {
    expect(firstError('', '')).toBe(t('validation.nameRequired'));
    expect(firstError('x'.repeat(DISPLAY_NAME_MAX + 1), '')).toBe(
      t('validation.nameMax', { max: DISPLAY_NAME_MAX }),
    );
    expect(firstError('Ca​mila', '')).toBe(t('validation.nameInvalid'));
  });
});

describe('cidade (opcional, até 80)', () => {
  it('vazia (ou só espaços) vira null, que limpa o campo', () => {
    expect(parse('Camila', '').data?.city).toBeNull();
    expect(parse('Camila', '   ').data?.city).toBeNull();
  });

  it.each([
    ['Feira de Santana, BA', 'Feira de Santana, BA'],
    ['  Irará, BA ', 'Irará, BA'],
    ['⁦Salvador⁩', 'Salvador'],
    ['x'.repeat(CITY_MAX), 'x'.repeat(CITY_MAX)],
  ])('%j passa como %j', (typed, saved) => {
    expect(parse('Camila', typed).data?.city).toBe(saved);
  });

  it('80 conta unidades de UTF-16, como a regra', () => {
    expect(CITY_MAX).toBe(80);
    // 40 emoji são 80 unidades de UTF-16; 41, 82.
    expect(parse('Camila', '🎶'.repeat(40)).success).toBe(true);
    expect(firstError('Camila', '🎶'.repeat(41))).toBe(t('validation.cityMax', { max: CITY_MAX }));
  });

  it('linha quebrada e caractere invisível são recusados', () => {
    expect(firstError('Camila', 'Irará\nBA')).toBe(t('validation.cityInvalid'));
    expect(firstError('Camila', 'Ira​rá')).toBe(t('validation.cityInvalid'));
    expect(firstError('Camila', 'x'.repeat(CITY_MAX + 1))).toBe(
      t('validation.cityMax', { max: CITY_MAX }),
    );
  });
});
