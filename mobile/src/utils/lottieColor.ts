/**
 * Utility to reliably recolor Lottie JSON shapes (strokes and fills).
 * This eliminates Android Lottie KeyPath matching bugs where unnamed Bodymovin shape groups
 * fail to respond to colorFilters.
 */

export function hexToLottieColor(hex: string): [number, number, number, number] {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  return [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3)), 1];
}

export function recolorLottieJson(source: any, hexColor: string): any {
  if (!source) return source;
  const color = hexToLottieColor(hexColor);

  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);

    const cloned: any = {};
    for (const key of Object.keys(node)) {
      if ((node.ty === 'st' || node.ty === 'fl') && key === 'c' && node.c && Array.isArray(node.c.k)) {
        cloned[key] = {
          ...node.c,
          k: color,
        };
      } else {
        cloned[key] = walk(node[key]);
      }
    }
    return cloned;
  }

  return walk(source);
}

const colorCache = new Map<string, any>();

export function getCachedRecoloredLottie(source: any, cacheKey: string, hexColor: string): any {
  const fullKey = `${cacheKey}_${hexColor}`;
  if (colorCache.has(fullKey)) {
    return colorCache.get(fullKey);
  }
  const result = recolorLottieJson(source, hexColor);
  colorCache.set(fullKey, result);
  return result;
}
