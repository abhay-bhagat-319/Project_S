# Lottie Vector Micro-Animations and Custom SVG Iconography

We implement dynamic tab navigation and header sync feedback using vector Lottie micro-animations and custom SVG components instead of raster GIFs or static system icon fonts.

## Context

The bottom navigation bar and header sync indicator previously relied on static Ionicons (`@expo/vector-icons`) and standard React Native `ActivityIndicator`. We evaluated using animated GIFs for tab transitions and progress indicators, but found that GIFs introduce severe 1-bit alpha haloing artifacts on AMOLED dark backgrounds, lack resolution scaling, cannot be dynamically tinted to match app theme states, and lack frame-level playback control in React Native.

Furthermore, student portal sync cycles can run silently in the background, requiring a clear, engaging visual cue in the header without distracting persistent looping in the navigation bar.

## Decision

1. **Lottie Vector Micro-Animations for Navigation**: Adopt `lottie-react-native` for the 5-tab floating navigation bar (`profile`, `attendance`, `book_courses`, `globe`, `settings`). Animations are one-shot (`loop={false}`), triggering on tab switch and resetting to resting frame 0 on blur. Re-tapping an already active tab replays the micro-interaction.
2. **Dynamic Stroke Inversion for Dark Mode**: Apply Lottie `colorFilters` to dynamically invert raw black strokes (`rgb(0,0,0)`) to white (`#FFFFFF`) / accent colors for active tabs and muted gray (`#8E8E93`) for inactive tabs.
3. **Loop-Cycled Header Sync Indicator**: Replace the top-right `ActivityIndicator` with `loading_spinner.json`. On each loop completion, the indicator cycles through the application palette (`Primary Blue` ➔ `Cyan` ➔ `Emerald Green` ➔ `Lavender Purple` ➔ repeat).
4. **Custom SVG Vector for Updates**: Implement `download-v2.svg` as a reusable React Native SVG component for the Settings update check row, dynamically tinted with `success` when a new release is available or `textSecondary` when up to date.
5. **Retain Standard External Link Icons**: Preserve existing Ionicons `open-outline` across external web links to avoid unnecessary churn across modal dialogs.
