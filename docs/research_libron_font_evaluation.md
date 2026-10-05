# Font Evaluation: Libron Serif for Project_S Mobile App

**Evaluation Target:** [nicoverbruggen/libron](https://github.com/nicoverbruggen/libron)  
**Target Application:** Project_S Android Mobile Companion (Academic Portal, Attendance & Grades Dashboard)  
**Date:** October 2026  
**Verdict:** ❌ **Not Recommended for Global / All UI Text** (Acceptable only for long-form reading / syllabi if desired)

---

## 1. Overview of Libron

**Libron** is an Open Font License (OFL) book-serif typeface created by Nico Verbruggen as a tuned fork of *Readerly*.

### Key Characteristics:
- **Genre:** Transitional Book Serif (optimized for e-ink devices, Kindle/Kobo, and long-form e-reading).
- **Design Intent:** Continuous reading of multi-page literary and long-form prose with low eye fatigue.
- **Modifications:** Altered and reduced serifs, adjusted letter proportions, and uniform kerning texture for paragraph reading.

---

## 2. Typographic & UX Evaluation for Project_S

| Evaluation Axis | Project_S Requirement | Libron Characteristic | Assessment |
| :--- | :--- | :--- | :--- |
| **Micro-UI & Small Badges (10px–12px)** | Crisp legibility in chips, version badges (`ARM64`), status tags | Fine serifs and stroke contrast create visual noise at <13px | ❌ Poor |
| **Tabular Figures & Numbers** | Instant scanning of CPI/SPI (`8.72`), percentages (`85%`), timestamps | Literary serif numerals designed for prose, not tabular scanning | ❌ Sub-optimal |
| **Alphanumeric Course Codes** | Compact readability (`MTH101`, `PHY302`, `BIO401`) | Serif terminals reduce letter-shape discrimination in all-caps | ❌ Degraded |
| **Visual Aesthetics & Theme** | Modern obsidian glassmorphism (`#0B0F17`, `#6366F1`, neon accents) | Classic literary / editorial / novel aesthetic | ⚠️ Mismatched |
| **Long-form Reading** | Course descriptions, syllabus PDFs, release changelogs | High-comfort paragraph texture with reduced glare | ✅ Excellent |

---

## 3. Why Applying Libron to "All Text" Causes Friction

### 1. The Micro-Scale Legibility Trap
In mobile UI design (especially dark mode dashboards), text elements frequently render at small sizes:
- Navigation tab labels: `10px–11px`
- Attendance percentage pills: `11px–12px`
- System status banners and download indicators: `12px`

Serif typefaces have bracketed terminals, thin hairlines, and varied stroke contrast. On high-DPI mobile screens at small font sizes, these serifs blur into adjacent strokes or disappear against glowing background gradients, causing eye strain.

### 2. Tabular Data & Grade Sheets
Project_S is an information-dense academic dashboard. Students open the app to quickly check:
- Is my attendance above 75%?
- What grade did I get in CS301?
- What classroom is my next lecture in?

Sans-serif typefaces (like **Inter**, **Plus Jakarta Sans**, **Outfit**, or Android system **Roboto**) have uniform stroke widths, large x-heights, open apertures, and tabular number spacing, which allow the human eye to scan figures in milliseconds. Serif typefaces slow down rapid horizontal scanning of tables and cards.

### 3. Design Identity Mismatch
Project_S is designed with a sleek, glowing dark aesthetic (indigo accents, glassmorphic blur cards, animated pills). A literary e-reader serif gives the impression of an e-book reader, medium article, or traditional university press website rather than a fast, modern student app.

---

## 4. Recommendations

1. **For Global UI Text (Buttons, Tabs, Badges, Metrics, Headers):**  
   **Keep Sans-Serif** (e.g. System Default / Inter / Plus Jakarta Sans / Outfit). This guarantees maximum legibility and speed.

2. **If You Want to Incorporate Libron Selectively:**  
   Libron can be used as an *accent typeface* strictly in:
   - The **Syllabus / Course Description Reader**
   - The **Full Academic Reports & Transcripts** reading view
   - Long changelog / release notes paragraphs

---

## 5. Primary References
- **Libron Repository:** [github.com/nicoverbruggen/libron](https://github.com/nicoverbruggen/libron)
- **Readerly Typeface:** [github.com/nicoverbruggen/readerly](https://github.com/nicoverbruggen/readerly)
- **Google Material Design 3 Typography Guidelines:** Large x-heights and sans-serif legibility on mobile UI.
