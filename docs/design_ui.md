# Design System & UI Guidelines

## 1. Overview
This document outlines the design system based on the provided dark-mode interface. The visual style is characterized by a deep charcoal background contrasted with vibrant, soft pastel accents (purple, pink, mint, and lavender). It employs heavy border radii for cards and buttons, creating a friendly, modern, and highly legible aesthetic.

## 2. Color Palette

### 2.1 Backgrounds & Surfaces
*   **App Background:** `#1A1C23` (Deep Charcoal/Black) - Used for the main app canvas.
*   **Surface / Card (Dark):** `#2A2B32` (Lighter Charcoal) - Used for elevated containers, inactive tabs, and the floating navigation bar.
*   **Surface / Card (Light):** `#FFFFFF` - Used occasionally for high-contrast, primary focus cards.

### 2.2 Accent Colors
Used for active states, progress indicators, and pastel card backgrounds.
*   **Primary Purple:** `#8B78FF` - Used for primary buttons, active states, progress bar fills, and the floating nav active indicator.
*   **Pastel Lavender:** `#E2DCFF` - Used for secondary cards and progress bar backgrounds.
*   **Pastel Pink:** `#FFD6E8` - Used for course cards and lesson indicators.
*   **Pastel Mint:** `#D0F0E4` - Used for alternate course cards.

### 2.3 Typography & Icons
*   **Primary Text:** `#FFFFFF` (White) - Main headings and high-emphasis body text.
*   **Secondary Text:** `#A0A0A8` (Muted Grey) - Subtitles, timestamps, inactive icons, and minor details.
*   **Dark Text (on pastel cards):** `#1A1C23` - Used when text is placed on light/pastel backgrounds to maintain contrast.

---

## 3. Gradients & Textures
*   **Progress Rings:** The circular progress indicators use a multi-color segmented track or a subtle gradient spanning the pastel palette (Mint -> Purple -> Pink).
*   **Bar Charts:** Uses dark, translucent fills with subtle pattern overlays (e.g., diagonal stripes or dots) for inactive states, while the active state uses the solid **Primary Purple**.
*   **Card Graphics:** Cards contain subtle, tonal watermark-style graphics (e.g., abstract leaves or book outlines) in the background to add depth without cluttering.

---

## 4. Typography
*   **Font Family:** A clean, geometric Sans-Serif (e.g., *Poppins*, *SF Pro Rounded*, or *Inter*).
*   **Hierarchy:**
    *   **H1 (App Title):** ~24px - 28px, Medium/Semi-bold, White.
    *   **H2 (Section Headers):** ~18px - 20px, Medium, White.
    *   **Body (Primary):** ~14px - 16px, Regular, White or Dark (depending on background).
    *   **Caption/Small:** ~12px, Regular, Muted Grey.

---

## 5. UI Components & Geometry

### 5.1 Corner Radii
*   **Large Cards:** `28px` to `32px` - Gives a soft, friendly appearance to main content blocks.
*   **Small Widgets:** `20px` to `24px`.
*   **Buttons / Tags / Nav Items:** `50px` (Fully rounded/Pill shape).

### 5.2 Navigation
*   **Floating Bottom Nav:** Placed as a floating pill-shaped container (`#2A2B32` background) with heavy padding.
*   **Active Tab:** Circular background using **Primary Purple** (`#8B78FF`) with a white icon.
*   **Inactive Tab:** Muted Grey icons with no background.

### 5.3 Buttons & Interactive Elements
*   **Primary Action Button:** Fully rounded, `Primary Purple` background, white icon/text.
*   **Secondary/Action Tags (e.g., 'Today', 'Learning plan'):** Fully rounded. Active state is Purple; Inactive state is Dark Surface (`#2A2B32`) with white text.
*   **Icon Buttons (e.g., Search, Notifications):** Circular (`50%` radius), Dark Surface background, white icon.

### 5.4 Layout & Spacing
*   **Screen Padding:** `20px` to `24px` on the left and right margins.
*   **Gap between elements:** `16px` for standard flow, `8px` for tightly coupled items (like icon + text).

## 6. CSS / Tailwind Quick Reference (Conceptual)
```css
:root {
  --bg-main: #1A1C23;
  --surface-dark: #2A2B32;
  --color-purple: #8B78FF;
  --color-lavender: #E2DCFF;
  --color-pink: #FFD6E8;
  --color-mint: #D0F0E4;
  --text-primary: #FFFFFF;
  --text-secondary: #A0A0A8;
  
  --radius-card: 28px;
  --radius-pill: 9999px;
}
```
