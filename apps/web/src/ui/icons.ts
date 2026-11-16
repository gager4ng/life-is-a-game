import type { WeatherKind } from "@liag/engine";

/** Weather icons drawn as inline SVG (code, not image files). */
export function weatherIcon(kind: WeatherKind, night: boolean): string {
  const sun = night
    ? `<path d="M15 4a8 8 0 1 0 7 11A7 7 0 0 1 15 4z" fill="#f6e7a1"/>`
    : `<circle cx="12" cy="12" r="5" fill="#ffc531"/><g stroke="#ffc531" stroke-width="2" stroke-linecap="round">${[
        0, 45, 90, 135, 180, 225, 270, 315,
      ]
        .map((a) => {
          const r = (a * Math.PI) / 180;
          const x1 = 12 + Math.cos(r) * 7.5;
          const y1 = 12 + Math.sin(r) * 7.5;
          const x2 = 12 + Math.cos(r) * 10;
          const y2 = 12 + Math.sin(r) * 10;
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
        })
        .join("")}</g>`;
  const cloud = (c: string): string =>
    `<path d="M7 17h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 7 17z" fill="${c}"/>`;
  const drops = (n: number): string =>
    Array.from(
      { length: n },
      (_, i) =>
        `<line x1="${8 + i * 3.5}" y1="19" x2="${6.5 + i * 3.5}" y2="23" stroke="#7fc8ff" stroke-width="1.8" stroke-linecap="round"/>`,
    ).join("");
  let body: string;
  switch (kind) {
    case "rain":
      body = cloud("#cfd8e3") + drops(3);
      break;
    case "heavy_rain":
      body =
        cloud("#8e9bab") +
        drops(4) +
        `<path d="M13 18l-2 3h2l-1 3" stroke="#ffe066" stroke-width="1.5" fill="none"/>`;
      break;
    case "harmattan":
      body = `<g opacity="0.75">${sun}</g><g stroke="#e8d3a6" stroke-width="2" stroke-linecap="round"><line x1="3" y1="16" x2="21" y2="16"/><line x1="5" y1="20" x2="19" y2="20"/></g>`;
      break;
    default:
      body = sun;
  }
  return `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">${body}</svg>`;
}
