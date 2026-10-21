/**
 * Utilities for cleaning and parsing raw HTML strings from Shiksha portal
 * into structured text arrays and strings.
 */

export const HtmlParser = {
  /**
   * Strips HTML tags and decodes common HTML entities while preserving structural line breaks.
   */
  stripHtml(html: string | null | undefined): string {
    if (!html) return '';
    return html
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n\n')
      .replace(/<(p|div|tr|h[1-6])[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;nbsp;?/gi, ' ')
      .replace(/&nbsp;?/gi, ' ')
      .replace(/&#xA0;|&#160;|\u00A0/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&ndash;|&#8211;/gi, '–')
      .replace(/&mdash;|&#8212;/gi, '—')
      .replace(/\r\n|\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  },

  /**
   * Extracts list items from <li>, <ol>, <ul>, or numbered/bulleted/newline-separated text
   * into an array of clean strings.
   */
  parseListItems(input: string | string[] | null | undefined): string[] {
    if (!input) return [];
    const raw = Array.isArray(input) ? input.join('\n') : String(input);
    if (!raw.trim()) return [];

    // Decode HTML block tags into newlines first
    const cleaned = this.stripHtml(raw);
    if (!cleaned) return [];

    // Split by newline first
    let lines = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // If only 1 line, check if it contains inline numbered or bulleted points
    if (lines.length === 1) {
      const single = lines[0];
      const numberedMatches = single
        .split(/(?:^|\s+)(?=(?:\d+[\.\)]|\([a-z0-9]+\)|[•\-\*])\s+)/i)
        .map((s) => s.trim())
        .filter(Boolean);
      if (numberedMatches.length > 1) {
        lines = numberedMatches;
      }
    }

    return lines;
  }
};
