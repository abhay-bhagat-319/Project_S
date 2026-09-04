export const Theme = {
  colors: {
    background: '#1A1C23',      // Deep Charcoal/Black
    surface: '#2A2B32',         // Lighter Charcoal
    surfaceLight: '#FFFFFF',    // High-contrast primary focus
    
    primary: '#8B78FF',         // Primary Purple
    lavender: '#E2DCFF',        // Pastel Lavender
    pink: '#FFD6E8',            // Pastel Pink
    mint: '#D0F0E4',            // Pastel Mint
    
    textPrimary: '#FFFFFF',     // Main headings & emphasis
    textSecondary: '#A0A0A8',   // Subtitles, captions, inactive icons
    textDark: '#1A1C23',        // Dark text for high-contrast pastel cards
    
    error: '#FF5E5E',           // Soft alert red
    success: '#4CD964',         // Soft success green
    border: '#3A3B43'           // Subtle divider borders
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
