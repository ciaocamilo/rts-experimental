/** Mosaico de ladrillos de la barra inferior, generado en código: sin imágenes externas ni recursos que descargar. */

/** Ocho tonos de piedra alrededor del color base de la barra (#262a2e). */
export const BRICK_TONES = ["#2b3035", "#2f3439", "#272b30", "#31363b", "#292d32", "#2d3237", "#262a2e", "#30353a"] as const;

export const BRICK_TILE = { width: 192, height: 96 } as const;
const BRICK_W = 48;
const BRICK_H = 24;

/** Teselas de 192 × 96 px: cuatro hileras de ladrillos de 46 × 22 con junta de 2 px (se ve el fondo) y media hilera de desfase. */
export function brickSvg(): string {
  let rects = "";
  for (let row = 0; row < BRICK_TILE.height / BRICK_H; row++) {
    for (let col = -1; col < BRICK_TILE.width / BRICK_W + 1; col++) {
      const x = col * BRICK_W + (row % 2 === 1 ? BRICK_W / 2 : 0) + 1;
      const y = row * BRICK_H + 1;
      const tone = BRICK_TONES[(row * 5 + (col + 1) * 3 + row * col + 8) % BRICK_TONES.length]!;
      rects += `<rect x='${x}' y='${y}' width='46' height='22' rx='1' fill='${tone}'/><rect x='${x}' y='${y}' width='46' height='1' fill='#ffffff' fill-opacity='.06'/>`;
    }
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${BRICK_TILE.width}' height='${BRICK_TILE.height}'>${rects}</svg>`;
}

/** Almenas: un merlón de 26 px cada 48 px, del mismo tono que los ladrillos. */
export function crenelSvg(): string {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='14'>` +
    `<rect x='4' width='26' height='14' fill='#2b3035'/><rect x='4' width='26' height='2' fill='#5a636c'/>` +
    `<rect x='4' width='2' height='14' fill='#4a525a'/><rect x='28' width='2' height='14' fill='#14171a'/></svg>`
  );
}

/** Torre dorada del nombre del juego. */
export function towerSvg(): string {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='16' height='16'>` +
    `<path fill='#d9b45a' d='M5 21V8H3V3h4v2h2V3h6v2h2V3h4v5h-2v13z'/><path fill='#14171a' d='M10 21v-5a2 2 0 0 1 4 0v5z'/></svg>`
  );
}

export function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Publica los mosaicos como variables CSS de la barra; la hoja de estilos los usa con sus colores de reserva. */
export function applyCastleBar(root: HTMLElement): void {
  root.style.setProperty("--brick", svgUrl(brickSvg()));
  root.style.setProperty("--cren", svgUrl(crenelSvg()));
  root.style.setProperty("--tower", svgUrl(towerSvg()));
}
