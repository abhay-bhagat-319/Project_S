/**
 * Utilities for cleaning and parsing raw HTML strings from Shiksha portal
 * into structured text arrays and strings.
 */

export const HtmlParser = {
  /**
   * Strips HTML tags and decodes common HTML entities
   */
  stripHtml(html: string | null | undefined): string {
    if (!html) return '';
    return html
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\r\n|\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  },

  /**
   * Extracts list items from <li>, <ol>, or <ul> tags into an array of clean strings.
   * If no list tags exist, splits on newlines or returns a single item.
   */
  parseListItems(html: string | null | undefined): string[] {
    if (!html) return [];
    
    // Check if HTML contains <li> tags
    const liMatches = html.match(/<li[^>]*>(.*?)<\/li>/gis);
    if (liMatches && liMatches.length > 0) {
      return liMatches
        .map((item) => this.stripHtml(item))
        .filter((item) => item.length > 0);
    }

    // Fallback: check if text has numbered items like "1. Item\n2. Item"
    const cleaned = this.stripHtml(html);
    if (!cleaned) return [];

    const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      return lines.map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
    }

    return [cleaned];
  }
};
