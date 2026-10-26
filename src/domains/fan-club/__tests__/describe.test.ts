import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';

import { FAN_CLUB_INVALID_FIELDS, FAN_CLUB_REFUSALS } from '../consts';
import {
  fanClubErrorText,
  POST_REJECT_REASON_TEXTS,
  POST_STATUS_TEXTS,
  REJECT_REASON_TEXTS,
  UNAVAILABLE_TEXTS,
} from '../describe';

// As frases do fã-clube por código (34.9): a recusa no campo ou no topo, e os
// textos fixos dos motivos e dos status.

const invalid = (details: object) =>
  new ApiError('validation', 'x', 400, 'fan_club_invalid', { ...details });
const refused = (details: object) =>
  new ApiError('validation', 'x', 409, 'fan_club_refused', { ...details });

/** A frase pronta, como a tela mostra. */
const text = (error: unknown) => {
  const found = fanClubErrorText(error);
  return found && { field: found.field, text: t(found.key, found.params) };
};

describe('fanClubErrorText', () => {
  it('o campo fora do formato aparece no campo dele', () => {
    expect(text(invalid({ field: 'name', reason: 'format' }))).toEqual({
      field: 'name',
      text: 'O nome precisa ter de 3 a 40 caracteres.',
    });
    expect(text(invalid({ field: 'whatsapp', reason: 'format' }))).toEqual({
      field: 'whatsapp',
      text: 'Confira o número: o DDD e o celular, com o 9 na frente.',
    });
    // A miniatura recusada vai para o campo da foto: a tela tem um só.
    expect(text(invalid({ field: 'thumb', reason: 'format', problem: 'dimensions' }))).toEqual({
      field: 'photo',
      text: 'Não deu para usar esta foto. Escolha outra e tente de novo.',
    });
  });

  it('o "oficial" no nome e o texto barrado pelo filtro têm frase própria', () => {
    expect(text(invalid({ field: 'name', reason: 'official' }))).toEqual({
      field: 'name',
      text: 'O nome não pode ter a palavra oficial. Só a equipe oficializa um fã-clube, com o selo.',
    });
    expect(text(invalid({ field: 'pitch', reason: 'not_allowed' }))).toEqual({
      field: 'pitch',
      text: 'Conforme os Termos de uso do ImagineUP, este texto não pode ser usado.',
    });
  });

  it('a recusa de negócio aparece no topo; o cooldown com a data do servidor', () => {
    expect(text(refused({ reason: 'follow_limit' }))).toEqual({
      field: null,
      text: 'Você já segue 50 fã-clubes. Deixe de seguir algum para seguir este.',
    });
    expect(
      text(refused({ reason: 'cooldown', canReapplyAt: new Date(2026, 10, 18, 12).toISOString() })),
    ).toEqual({ field: null, text: 'Você pode enviar de novo a partir de 18/11/2026.' });
    expect(text(refused({ reason: 'cooldown' }))).toEqual({
      field: null,
      text: 'Você pode enviar de novo daqui a alguns dias.',
    });
  });

  it('os dois 404 têm a frase da página e da publicação', () => {
    expect(text(new ApiError('notFound', 'x', 404, 'fan_club_not_found'))).toEqual({
      field: null,
      text: 'Este fã-clube não está disponível.',
    });
    expect(text(new ApiError('notFound', 'x', 404, 'fan_club_post_not_found'))).toEqual({
      field: null,
      text: 'Esta publicação não está mais disponível.',
    });
  });

  it('o resto fica para o actionRefusal da ação: null', () => {
    expect(fanClubErrorText(refused({ reason: 'motivo_novo' }))).toBeNull();
    expect(fanClubErrorText(invalid({ field: 'campo_novo', reason: 'format' }))).toBeNull();
    expect(fanClubErrorText(new ApiError('forbidden', 'x', 403, 'account_suspended'))).toBeNull();
    expect(fanClubErrorText(new ApiError('network', 'x'))).toBeNull();
    expect(fanClubErrorText(new Error('x'))).toBeNull();
  });

  it('cada motivo e cada campo do servidor têm frase, sem texto faltando', () => {
    for (const reason of FAN_CLUB_REFUSALS) {
      const found = fanClubErrorText(refused({ reason, canReapplyAt: '2026-11-18T15:00:00.000Z' }));
      expect(found).not.toBeNull();
      expect(t(found!.key, found!.params)).not.toBe(found!.key);
    }
    for (const field of FAN_CLUB_INVALID_FIELDS) {
      const found = fanClubErrorText(invalid({ field, reason: 'format' }));
      expect(found?.field).toBe(field === 'thumb' ? 'photo' : field);
      expect(t(found!.key)).not.toBe(found!.key);
    }
  });
});

describe('os textos fixos por código', () => {
  it.each([
    ['o motivo da candidatura recusada', REJECT_REASON_TEXTS],
    ['o status da publicação', POST_STATUS_TEXTS],
    ['o motivo da publicação recusada', POST_REJECT_REASON_TEXTS],
    ['o fã-clube indisponível', UNAVAILABLE_TEXTS],
  ])('%s: todo código tem o texto', (_name, table) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const key of Object.values(table)) expect(t(key)).not.toBe(key);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('os status da Pill de "Minhas publicações"', () => {
    expect(Object.values(POST_STATUS_TEXTS).map((key) => t(key))).toEqual([
      'Em análise',
      'No ar',
      'Recusada',
      'Retirada',
      'Oculta pela equipe',
      'Tirada do ar',
    ]);
  });
});
