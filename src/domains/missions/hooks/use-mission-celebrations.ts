import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { motion } from '@/theme';
import { formatPointsSpoken } from '@/utils/number';

import type { Mission, MissionStatus } from '../types';

// A festa dura o "+N" e mais um pouco; depois a chave sai, e a célula que a
// FlashList reaproveitar para essa missão não repete o check crescendo.
const CELEBRATION_MS = motion.duration.counter + motion.duration.base;

const NONE: ReadonlyMap<string, number> = new Map();

/** Missões que concluíram juntas, vistas numa mesma volta à tela. */
interface Batch {
  id: number;
  missions: readonly Mission[];
}

function statusesOf(missions: readonly Mission[]): ReadonlyMap<string, MissionStatus> {
  return new Map(missions.map((mission) => [mission.id, mission.status]));
}

function changed(seen: ReadonlyMap<string, MissionStatus>, missions: readonly Mission[]): boolean {
  return (
    seen.size !== missions.length ||
    missions.some((mission) => seen.get(mission.id) !== mission.status)
  );
}

/**
 * Missões que passaram a concluídas com a 1g montada, cada uma com uma chave
 * que muda a cada conclusão (gatilho do check crescendo e do "+N").
 *
 * A conclusão costuma acontecer em outra tela (o "Eu vou" da agenda conclui a
 * missão de presença, e a lista busca de novo ali mesmo). Enquanto a 1g não
 * está em foco, a mudança espera: a festa acontece quando o fã volta a ela,
 * onde ele vê. A primeira carga e as missões que já chegam concluídas não
 * contam.
 *
 * O toque `missionComplete` (um por volta) e o anúncio de cada missão saem
 * daqui, da tela, e não da célula: a linha concluída pode estar fora da janela
 * que a lista desenha (fonte grande, lista rolada), e aí não há célula montada.
 */
export function useMissionCelebrations(
  missions: readonly Mission[] | undefined,
  focused: boolean,
): ReadonlyMap<string, number> {
  const [seen, setSeen] = useState<ReadonlyMap<string, MissionStatus> | null>(null);
  const [celebrations, setCelebrations] = useState(NONE);
  const [count, setCount] = useState(0);
  const [batch, setBatch] = useState<Batch | null>(null);
  const played = useRef(0);

  // Reage à lista nova no próprio render, como o `PointsToast` reage ao gatilho.
  if (missions && seen === null) {
    setSeen(statusesOf(missions));
  } else if (missions && seen && focused && changed(seen, missions)) {
    setSeen(statusesOf(missions));
    const done = missions.filter(
      (mission) =>
        mission.status === 'completed' &&
        seen.has(mission.id) &&
        seen.get(mission.id) !== 'completed',
    );
    if (done.length > 0) {
      const next = new Map(celebrations);
      done.forEach((mission, index) => next.set(mission.id, count + index + 1));
      setCount(count + done.length);
      setCelebrations(next);
      setBatch({ id: count + done.length, missions: done });
    }
  }

  // Separado do relógio da festa: se o efeito rodar de novo, o fã não ouve duas vezes.
  useEffect(() => {
    if (!batch || played.current === batch.id) return;
    played.current = batch.id;
    haptics.trigger('missionComplete');
    // Na fila, uma frase por missão. "Rendeu", e não "Mais": os pontos já
    // entraram quando o fã agiu (o "Eu vou" anunciou "Mais 15 pontos" lá).
    batch.missions.forEach((mission) =>
      AccessibilityInfo.announceForAccessibilityWithOptions(
        t('missions.completedAnnouncement', {
          title: mission.title,
          points: formatPointsSpoken(mission.rewardPoints),
        }),
        { queue: true },
      ),
    );
  }, [batch]);

  useEffect(() => {
    if (celebrations.size === 0) return;
    const timer = setTimeout(() => setCelebrations(NONE), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [celebrations]);

  return celebrations;
}
