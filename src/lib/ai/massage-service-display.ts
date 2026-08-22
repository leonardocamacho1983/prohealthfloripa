const MASSAGE_SERVICE_NAMES = [
  "Drenagem linfática",
  "Shiro Abhyanga",
  "Pada Abhyanga",
  "Bastis localizados",
  "Thai / Thai Yoga",
  "Ayurvédica",
  "Miofascial",
  "Relaxante",
  "Desportiva",
  "Shirodhara",
  "Abhyanga",
  "Lomi-Lomi",
  "Shiatsu",
  "Sueca",
  "Tuiná",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Internal catalog keys stay canonical, while customer-facing copy always
 * presents a technique as a massage service instead of a detached proper name.
 */
export function qualifyMassageServiceNames(message: string): string {
  return MASSAGE_SERVICE_NAMES.reduce((text, serviceName) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(serviceName)}(?=$|[^\\p{L}\\p{N}_])`,
      "gu",
    );
    return text.replace(pattern, (match, offset: number) => {
      const prefix = text.slice(Math.max(0, offset - 12), offset);
      return /massagem\s+$/i.test(prefix) ? match : `Massagem ${match}`;
    });
  }, message);
}
