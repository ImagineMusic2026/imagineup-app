import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { User } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { mediaUrl } from '@/config/server';
import { useImageFade } from '@/components/remote-image';
import { Text } from '@/components/text';
import {
  avatarFallbacks,
  borderWidths,
  colors,
  fonts,
  gradients,
  layout,
  type AvatarSize,
} from '@/theme';
import { pickStable } from '@/utils/pick-stable';
import { initialsOf } from '@/utils/text';

/**
 * - `brand`: gradiente rosa para lima (header da 1b);
 * - `points`: lima sólido (1º do pódio);
 * - `self`: rosa, o próprio fã no pódio.
 */
export type AvatarRing = 'none' | 'brand' | 'points' | 'self';

export interface AvatarProps {
  /** As iniciais saem daqui. Sem nome, fica o ícone de pessoa. */
  name: string | null | undefined;
  /** Uid ou id do artista: escolhe a cor de fundo sem foto, a mesma em toda tela. */
  id: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  ring?: AvatarRing;
  /** Fundo sem foto fora da paleta, como o do card "Você" sobre rosa (1f). */
  fallbackColor?: string;
  style?: StyleProp<ViewStyle>;
}

const INITIALS_LINE_HEIGHT = 1.2;

// Pilha da 1l: cada círculo ganha uma borda da cor do fundo e entra sobre o anterior.
const STACK_BORDER = borderWidths.strong;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

function Ring({ ring, size, children }: { ring: AvatarRing; size: number; children: ReactNode }) {
  const frame = [styles.center, { width: size, height: size, borderRadius: size / 2 }];
  if (ring === 'brand') {
    const { colors: stops, locations, start, end } = gradients.brandRing;
    return (
      <LinearGradient colors={stops} locations={locations} start={start} end={end} style={frame}>
        {children}
      </LinearGradient>
    );
  }
  const color = ring === 'points' ? colors.points : colors.accent;
  return <View style={[frame, { backgroundColor: color }]}>{children}</View>;
}

/**
 * Foto do fã ou do artista, ou as iniciais sobre uma cor estável pelo id. É uma
 * imagem: fica oculta do leitor de tela, e quem a põe num pressável dá o rótulo
 * a ele (o nome costuma estar ao lado, em texto).
 */
export function Avatar({
  name,
  id,
  photoUrl,
  size = 'md',
  ring = 'none',
  fallbackColor,
  style,
}: AvatarProps) {
  const fade = useImageFade();
  const { size: outer, initials: initialsSize } = layout.avatar[size];
  const inner = ring === 'none' ? outer : outer - layout.avatarRing[ring] * 2;
  const initials = name ? initialsOf(name) : '';
  // Com os emuladores, a URL do Storage troca para o host que o aparelho alcança.
  const photo = photoUrl ? mediaUrl(photoUrl) : null;

  const face = (
    <View
      style={[
        styles.center,
        styles.face,
        {
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: fallbackColor ?? pickStable(id, avatarFallbacks),
        },
      ]}
    >
      {initials ? (
        // Parte da imagem: o círculo não cresce com a fonte do sistema.
        <Text
          variant="button"
          maxFontSizeMultiplier={1}
          style={[
            styles.initials,
            { fontSize: initialsSize, lineHeight: Math.round(initialsSize * INITIALS_LINE_HEIGHT) },
          ]}
        >
          {initials}
        </Text>
      ) : (
        <Icon icon={User} size={Math.round(inner / 2)} color={colors.textSecondary} />
      )}
      {photo ? (
        <Image
          source={{ uri: photo }}
          recyclingKey={photo}
          contentFit="cover"
          transition={fade}
          accessible={false}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );

  return (
    <View {...hiddenFromReader} style={style}>
      {ring === 'none' ? (
        face
      ) : (
        <Ring ring={ring} size={outer}>
          {face}
        </Ring>
      )}
    </View>
  );
}

export interface AvatarPerson {
  id: string;
  name: string | null;
  photoUrl?: string | null;
}

export interface AvatarStackProps {
  people: readonly AvatarPerson[];
  size?: AvatarSize;
  style?: StyleProp<ViewStyle>;
}

/**
 * Avatares sobrepostos ("+18 artistas" da 1l). O da direita fica por cima pela
 * ordem de desenho. Decorativa: o pressável em volta diz quantos são.
 */
export function AvatarStack({ people, size = 'xs', style }: AvatarStackProps) {
  const diameter = layout.avatar[size].size + STACK_BORDER * 2;
  return (
    <View {...hiddenFromReader} style={[styles.stack, style]}>
      {people.map((person, index) => (
        <View
          key={person.id}
          style={[
            styles.center,
            styles.stackItem,
            { width: diameter, height: diameter, borderRadius: diameter / 2 },
            index > 0 && styles.stackOverlap,
          ]}
        >
          <Avatar name={person.name} id={person.id} photoUrl={person.photoUrl} size={size} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    overflow: 'hidden',
  },
  initials: {
    fontFamily: fonts.soraExtraBold,
    textAlign: 'center',
    includeFontPadding: false,
  },
  stack: {
    flexDirection: 'row',
  },
  stackItem: {
    borderWidth: STACK_BORDER,
    borderColor: colors.background,
    backgroundColor: colors.background,
  },
  stackOverlap: {
    marginLeft: -layout.avatarStackOverlap,
  },
});
