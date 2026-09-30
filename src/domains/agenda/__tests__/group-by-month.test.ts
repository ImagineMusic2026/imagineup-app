import {
  buildAgendaItems,
  groupByMonth,
  groupUpcomingByMonth,
  monthInView,
  monthTargetIndex,
  type AgendaListItem,
} from '../group-by-month';
import type { AgendaEvent } from '../types';

// Relógio fixo, no fuso do Jest: 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

function show(id: string, startsAt: Date): AgendaEvent {
  return {
    id,
    title: id,
    artists: [{ id: 'nenho', name: 'Nenho' }],
    city: 'Aracaju',
    state: 'SE',
    startsAt: startsAt.toISOString(),
    imageUrl: null,
    invitePointsPerSignup: 10,
  };
}

const ids = (events: readonly AgendaEvent[]) => events.map((event) => event.id);

const OCT_3 = show('praia', new Date(2026, 9, 3, 22));
const OCT_21 = show('irara', new Date(2026, 9, 21, 22));
const OCT_28 = show('derramar', new Date(2026, 9, 28, 21));
const NOV_12 = show('vaqueiro', new Date(2026, 10, 12, 20));
const DEC_2 = show('vaquejada', new Date(2026, 11, 2, 22));

describe('groupByMonth', () => {
  it('o destaque fica fora da lista, e cada mês junta os seus shows em ordem de data', () => {
    const { featured, months, chips } = groupByMonth(
      [NOV_12, OCT_28, OCT_21, DEC_2, OCT_3],
      NOW,
      OCT_21,
    );
    expect(featured?.id).toBe('irara');
    expect(months.map((month) => [month.key, month.label, ids(month.events)])).toEqual([
      ['2026-10', 'Outubro', ['praia', 'derramar']],
      ['2026-11', 'Novembro', ['vaqueiro']],
      ['2026-12', 'Dezembro', ['vaquejada']],
    ]);
    expect(chips).toEqual([
      { key: '2026-10', label: 'Outubro' },
      { key: '2026-11', label: 'Novembro' },
      { key: '2026-12', label: 'Dezembro' },
    ]);
  });

  it.each([
    ['ontem', new Date(2026, 8, 28, 22), false],
    ['hoje de manhã, já passado da hora', new Date(2026, 8, 29, 9), true],
    ['hoje à noite', new Date(2026, 8, 29, 22), true],
    ['amanhã', new Date(2026, 8, 30, 22), true],
  ])('show de %s: fica na agenda? %s', (_when, startsAt, kept) => {
    const { featured } = groupByMonth([show('um', startsAt)], NOW);
    expect(featured !== null).toBe(kept);
  });

  it('show passado some, e o destaque passado dá lugar ao próximo show', () => {
    const past = show('passado', new Date(2026, 8, 1, 22));
    const { featured, months } = groupByMonth([past, OCT_3, OCT_28], NOW, past);
    expect(featured?.id).toBe('praia');
    expect(months.flatMap((month) => ids(month.events))).toEqual(['derramar']);
  });

  it('sem show marcado no painel, o destaque é o próximo show', () => {
    const { featured } = groupByMonth([OCT_28, OCT_21, OCT_3], NOW, null);
    expect(featured?.id).toBe('praia');
  });

  it('o destaque que a API manda fora das páginas carregadas também vale, e não se repete', () => {
    const { featured, months } = groupByMonth([OCT_3, OCT_28], NOW, OCT_21);
    expect(featured?.id).toBe('irara');
    expect(months.flatMap((month) => ids(month.events))).toEqual(['praia', 'derramar']);
    const inTheList = groupByMonth([OCT_3, OCT_21, OCT_28], NOW, OCT_21);
    expect(inTheList.months.flatMap((month) => ids(month.events))).toEqual(['praia', 'derramar']);
  });

  it('o mês que só tem o destaque ganha chip, mas não sobrelinha', () => {
    const { months, chips } = groupByMonth([OCT_21, NOV_12], NOW, OCT_21);
    expect(chips.map((chip) => chip.key)).toEqual(['2026-10', '2026-11']);
    expect(months.map((month) => month.key)).toEqual(['2026-11']);
  });

  it('páginas que repetem um show não o mostram duas vezes', () => {
    const { months } = groupByMonth([OCT_3, OCT_28, OCT_28, OCT_21], NOW, OCT_21);
    expect(months.flatMap((month) => ids(month.events))).toEqual(['praia', 'derramar']);
  });

  it('data inválida some em vez de quebrar a tela', () => {
    const broken = { ...OCT_3, id: 'sem-data', startsAt: 'amanhã' };
    expect(groupByMonth([broken], NOW).featured).toBeNull();
  });

  it('sem shows, nada de destaque, meses ou chips', () => {
    expect(groupByMonth([], NOW)).toEqual({ featured: null, months: [], chips: [] });
  });
});

describe('itens da lista', () => {
  const sections = groupByMonth([OCT_3, OCT_21, OCT_28, NOV_12, DEC_2], NOW, OCT_21);
  const items = buildAgendaItems(sections);

  it('chips, destaque e cada mês com a sobrelinha antes das linhas', () => {
    expect(items.map((item) => item.key)).toEqual([
      'chips',
      'featured-irara',
      'month-2026-10',
      'event-praia',
      'event-derramar',
      'month-2026-11',
      'event-vaqueiro',
      'month-2026-12',
      'event-vaquejada',
    ]);
  });

  it('sem shows, a lista fica vazia (sem chips soltos)', () => {
    expect(buildAgendaItems(groupByMonth([], NOW))).toEqual([]);
  });

  it.each([
    ['o mês do destaque rola até o destaque', '2026-10', 'featured-irara'],
    ['os outros, até a sobrelinha deles', '2026-11', 'month-2026-11'],
    ['o último mês também', '2026-12', 'month-2026-12'],
  ])('%s', (_case, month, key) => {
    expect(items[monthTargetIndex(items, month)]?.key).toBe(key);
  });

  it('mês sem nada na lista não rola', () => {
    expect(monthTargetIndex(items, '2027-01')).toBe(-1);
  });
});

describe('mês em vista', () => {
  const items = buildAgendaItems(groupByMonth([OCT_3, OCT_21, OCT_28, NOV_12, DEC_2], NOW, OCT_21));
  const at = (index: number, isViewable = true) => ({
    item: items[index] as AgendaListItem,
    index,
    isViewable,
  });

  it('é o mês do primeiro item à vista', () => {
    expect(monthInView([at(6), at(5), at(7)])).toBe('2026-11');
  });

  it('a linha de chips grudada não conta', () => {
    expect(monthInView([at(0), at(1), at(2)])).toBe('2026-10');
  });

  it('item que saiu da vista não conta', () => {
    expect(monthInView([at(4, false), at(7)])).toBe('2026-12');
  });

  it('só os chips à vista: nenhum mês, e o chip fica como está', () => {
    expect(monthInView([at(0)])).toBeNull();
    expect(monthInView([])).toBeNull();
  });
});

// 5 de outubro: o próximo sábado ainda é de outubro, e o destaque (dia 21 do
// mês seguinte, como nas fixtures) já é de novembro. O topo é outubro.
describe('destaque de um mês depois do primeiro', () => {
  const NOW_OCT = new Date(2026, 9, 5, 20, 0);
  const PRAIA = show('praia', new Date(2026, 9, 10, 22));
  const IRARA = show('irara', new Date(2026, 10, 21, 22));
  const DERRAMAR = show('derramar', new Date(2026, 10, 28, 21));
  const VAQUEIRO = show('vaqueiro', new Date(2026, 11, 12, 20));
  const sections = groupByMonth([PRAIA, IRARA, DERRAMAR, VAQUEIRO], NOW_OCT, IRARA);
  const items = buildAgendaItems(sections);
  const at = (key: string) => {
    const index = items.findIndex((item) => item.key === key);
    return { item: items[index] as AgendaListItem, index, isViewable: true };
  };

  it('os chips começam pelo mês do topo, e o destaque fica com ele', () => {
    expect(sections.chips.map((chip) => chip.label)).toEqual(['Outubro', 'Novembro', 'Dezembro']);
    expect(items.map((item) => item.key)).toEqual([
      'chips',
      'featured-irara',
      'month-2026-10',
      'event-praia',
      'month-2026-11',
      'event-derramar',
      'month-2026-12',
      'event-vaqueiro',
    ]);
  });

  it.each([
    ['no topo', ['chips', 'featured-irara', 'month-2026-10', 'event-praia'], '2026-10'],
    ['com só o destaque à vista', ['featured-irara'], '2026-10'],
    ['na sobrelinha de novembro', ['month-2026-11', 'event-derramar'], '2026-11'],
    ['em dezembro', ['event-vaqueiro'], '2026-12'],
  ])('o mês em vista %s', (_where, keys, month) => {
    expect(monthInView(keys.map(at))).toBe(month);
  });

  it.each([
    ['outubro rola até o topo', '2026-10', 'featured-irara'],
    ['novembro, o mês do destaque, até a sobrelinha dele', '2026-11', 'month-2026-11'],
    ['dezembro, até a sobrelinha dele', '2026-12', 'month-2026-12'],
  ])('%s', (_case, month, key) => {
    expect(items[monthTargetIndex(items, month)]?.key).toBe(key);
  });

  it('o mês que só tem o destaque, depois do primeiro, fica sem chip', () => {
    const alone = groupByMonth([PRAIA, IRARA, VAQUEIRO], NOW_OCT, IRARA);
    expect(alone.chips.map((chip) => chip.key)).toEqual(['2026-10', '2026-12']);
    expect(alone.months.map((month) => month.key)).toEqual(['2026-10', '2026-12']);
  });

  it('o destaque antes de todas as linhas, num mês sem outra, abre os chips', () => {
    const early = groupByMonth([IRARA, VAQUEIRO], NOW_OCT, IRARA);
    expect(early.chips.map((chip) => chip.key)).toEqual(['2026-11', '2026-12']);
  });
});

describe('shows de uma central por mês (aba Agenda da 1d)', () => {
  it('sem destaque: todo show entra no seu mês, em ordem, e o que passou some', () => {
    const months = groupUpcomingByMonth(
      [
        show('dezembro', new Date(2026, 11, 2, 22)),
        show('passado', new Date(2026, 8, 1, 22)),
        show('outubro-2', new Date(2026, 9, 28, 21)),
        show('outubro-1', new Date(2026, 9, 21, 22)),
      ],
      NOW,
    );
    expect(months.map((month) => [month.label, ids(month.events)])).toEqual([
      ['Outubro', ['outubro-1', 'outubro-2']],
      ['Dezembro', ['dezembro']],
    ]);
  });

  it('páginas que se repetem não repetem o show', () => {
    const repeated = show('outubro-1', new Date(2026, 9, 21, 22));
    expect(groupUpcomingByMonth([repeated, repeated], NOW)[0]?.events).toHaveLength(1);
  });
});
