import React, { useState, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { Theme } from '../Theme';
import { getCachedRecoloredLottie } from '../utils/lottieColor';

interface SyncProgressIndicatorProps {
  size?: number;
}

const rawSpinnerJson = require('../../assets/lottie/loading_spinner.json');

const PALETTE = [
  Theme.colors.primary,  // Primary Purple (#8B78FF)
  '#06B6D4',             // Cyan (#06B6D4)
  Theme.colors.success,  // Emerald Green (#4CD964)
  Theme.colors.lavender, // Pastel Lavender (#E2DCFF)
];

export const SyncProgressIndicator: React.FC<SyncProgressIndicatorProps> = ({
  size = 28,
}) => {
  const [colorIndex, setColorIndex] = useState(0);

  const currentColor = PALETTE[colorIndex];

  // Pre-recolored vector JSON guarantees vibrant color rendering on Android & iOS
  const recoloredSource = useMemo(() => {
    return getCachedRecoloredLottie(rawSpinnerJson, 'spinner', currentColor);
  }, [currentColor]);

  const handleAnimationLoop = () => {
    setColorIndex((prev) => (prev + 1) % PALETTE.length);
  };

  return (
    <View style={[styles.container, { width: size, height: size }]} pointerEvents="none">
      <LottieView
        key={`spinner_${colorIndex}`}
        source={recoloredSource}
        autoPlay
        loop
        onAnimationLoop={handleAnimationLoop}
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

export default SyncProgressIndicator;
