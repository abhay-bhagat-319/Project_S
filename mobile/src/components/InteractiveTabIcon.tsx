import React, { useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { getCachedRecoloredLottie } from '../utils/lottieColor';

interface InteractiveTabIconProps {
  source: any;
  cacheKey: string;
  isActive: boolean;
  size?: number;
  activeColor?: string;
  inactiveColor?: string;
  speed?: number;
  triggerNonce?: number;
}

export const InteractiveTabIcon: React.FC<InteractiveTabIconProps> = ({
  source,
  cacheKey,
  isActive,
  size = 26,
  activeColor = '#FFFFFF',
  inactiveColor = '#FFFFFF',
  speed = 1.0,
  triggerNonce = 0,
}) => {
  const lottieRef = useRef<LottieView>(null);
  const wasActiveRef = useRef<boolean>(isActive);
  const lastNonceRef = useRef<number>(triggerNonce);

  const currentColor = isActive ? activeColor : inactiveColor;

  // Pre-recolored vector JSON prevents Android Lottie KeyPath matching bugs
  const recoloredSource = useMemo(() => {
    return getCachedRecoloredLottie(source, cacheKey, currentColor);
  }, [source, cacheKey, currentColor]);

  useEffect(() => {
    if (isActive) {
      // If transitioned to active OR triggerNonce changed while active
      if (!wasActiveRef.current || triggerNonce !== lastNonceRef.current) {
        lottieRef.current?.reset();
        lottieRef.current?.play();
      }
    } else {
      // Reset to initial resting glyph when inactive
      lottieRef.current?.reset();
    }

    wasActiveRef.current = isActive;
    lastNonceRef.current = triggerNonce;
  }, [isActive, triggerNonce, recoloredSource]);

  return (
    <View style={[styles.container, { width: size, height: size }]} pointerEvents="none">
      <LottieView
        ref={lottieRef}
        key={`${cacheKey}_${currentColor}`}
        source={recoloredSource}
        loop={false}
        autoPlay={false}
        speed={speed}
        style={{ width: size, height: size }}
        colorFilters={[
          {
            keypath: '**',
            color: currentColor,
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default InteractiveTabIcon;
