export const Theme = {
  colors: {
    background: '#15151562',      // Deep Obsidian Black
    surface: '#1f1f23ff',         // Elevated Charcoal Surface
    surfaceLight: '#FFFFFF',    // High-contrast primary focus

    primary: '#8B78FF',         // Primary Purple
    lavender: '#E2DCFF',        // Pastel Lavender
    pink: '#f99fc6ff',            // Pastel Pink
    mint: '#60cc77ff',            // Pastel Mint

    textPrimary: '#FFFFFF',     // Main headings & emphasis
    textSecondary: '#A0A0A8',   // Subtitles, captions, inactive icons
    textDark: '#121318',        // Dark text for high-contrast pastel cards

    error: '#FF5E5E',           // Soft alert red
    success: '#4CD964',         // Soft success green
    successGreen: '#4CD964',    // Success green alias
    dangerRed: '#FF5E5E',       // Danger red alias
    accentOrange: '#FF7A00',    // Vibrant SRS accent orange
    border: 'rgba(255, 255, 255, 0.08)' // Subtle structural divider borders
  },

  radii: {
    card: 28,                   // Soft friendly appearance for main cards
    widget: 20,                 // Small widgets/cards
    pill: 9999                  // Fully rounded buttons/tags
  },

  spacing: {
    padding: 20,
    gap: 16,
    gapTight: 8
  },

  layout: {
    navBarHeight: 60,
    navBarBaseBottom: 12,
    baseScrollBottomPadding: 96,
  }
};
