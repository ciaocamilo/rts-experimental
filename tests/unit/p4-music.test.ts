import { describe, expect, it } from "vitest";
import { BAR_SECONDS, CHORDS, DORIAN_PITCH_CLASSES, MELODIES, MUSIC_SAMPLE_RATE, SECTIONS, TOTAL_BARS, buildScore, parseBar, renderMusic } from "../../src/audio/music";

const peak = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("partitura", () => {
  it("tiene 60 compases de 6/8 a 72 por negra con puntillo", () => {
    expect(SECTIONS.reduce((n, s) => n + s.bars, 0)).toBe(TOTAL_BARS);
    expect(BAR_SECONDS).toBeCloseTo(5 / 3, 6);
    expect(buildScore().bars).toBe(60);
  });

  it("solo usa notas del modo dórico en re", () => {
    const { notes } = buildScore();
    expect(notes.length).toBeGreaterThan(300);
    for (const n of notes) expect(DORIAN_PITCH_CLASSES, `${n.track} ${n.midi}`).toContain(n.midi % 12);
    for (const chord of Object.values(CHORDS)) for (const midi of chord) expect(DORIAN_PITCH_CLASSES).toContain(midi % 12);
  });

  it("las melodías son compases válidos de seis corcheas", () => {
    for (const melody of Object.values(MELODIES)) {
      expect(melody).toHaveLength(8);
      for (const bar of melody) {
        const notes = parseBar(bar);
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) expect(n.start + n.length).toBeLessThanOrEqual(6);
      }
    }
  });

  it("ningún compás melódico se repite idéntico más de cuatro veces seguidas", () => {
    const bars: string[] = [];
    for (const s of SECTIONS) {
      for (let b = 0; b < s.bars; b++) {
        const lute = s.lute && s.lute !== "arp" ? s.lute[b % 8] : "";
        bars.push(`${s.flute ? s.flute[b % 8] : ""}|${lute}|${s.prog[b % s.prog.length]}`);
      }
    }
    let run = 1;
    for (let i = 1; i < bars.length; i++) {
      run = bars[i] === bars[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(4);
    }
  });

  it("los golpes de tamboril caen dentro de la pieza", () => {
    const { hits } = buildScore();
    expect(hits.length).toBeGreaterThan(50);
    for (const h of hits) {
      expect(h.at).toBeGreaterThanOrEqual(0);
      expect(h.at).toBeLessThan(TOTAL_BARS * BAR_SECONDS);
    }
  });
});

describe("síntesis de la música", () => {
  it("un fragmento es determinista, finito y no satura", () => {
    const a = renderMusic(7, 6);
    const b = renderMusic(7, 6);
    expect(a.left).toEqual(b.left);
    expect(a.right).toEqual(b.right);
    expect(a.left.every(Number.isFinite)).toBe(true);
    expect(a.right.every(Number.isFinite)).toBe(true);
    expect(peak(a.left)).toBeLessThanOrEqual(0.98);
    expect(peak(a.left)).toBeGreaterThan(0.3);
    expect(a.left.length).toBe(a.right.length);
  }, 30_000);

  it("la pieza completa dura 100 s, es estéreo y se genera en tiempo razonable", () => {
    const started = performance.now();
    const track = renderMusic(7);
    const elapsed = performance.now() - started;
    expect(track.sampleRate).toBe(MUSIC_SAMPLE_RATE);
    expect(track.left.length / track.sampleRate).toBeGreaterThan(TOTAL_BARS * BAR_SECONDS - 1);
    expect(track.left.length / track.sampleRate).toBeLessThan(TOTAL_BARS * BAR_SECONDS + 1);
    expect(track.left.every(Number.isFinite)).toBe(true);
    expect(peak(track.left)).toBeLessThanOrEqual(0.98);
    expect(track.left).not.toEqual(track.right);
    // La entrada y la salida del bucle enlazan sin salto.
    const jump = Math.abs(track.left[0]! - track.left[track.left.length - 1]!);
    expect(jump).toBeLessThan(0.05);
    console.info(`música completa: ${elapsed.toFixed(0)} ms, ${((track.left.byteLength * 2) / 1048576).toFixed(1)} MB`);
    expect(elapsed).toBeLessThan(15000);
  }, 60000);
});
