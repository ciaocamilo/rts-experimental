import { describe, expect, it } from "vitest";
import { CameraRig, ZOOM_MAX, ZOOM_MIN } from "../../src/input/camera-rig";
import { toastKind } from "../../src/ui/messages";
import { clipPolygon, minimapPoint } from "../../src/ui/minimap";
import { TOAST_DEDUPE_MS, TOAST_DURATION, TOAST_MAX, ToastModel } from "../../src/ui/toasts";

describe("P6 avisos temporales (ToastModel)", () => {
  it("duran 2,5 s (info), 3,5 s (warn) y 4,5 s (error)", () => {
    expect(TOAST_DURATION).toEqual({ info: 2500, warn: 3500, error: 4500 });
    const m = new ToastModel();
    m.show("a", "info", 0);
    m.show("b", "warn", 0);
    m.show("c", "error", 0);
    m.prune(2499);
    expect(m.items).toHaveLength(3);
    m.prune(2500);
    expect(m.items.map((t) => t.text)).toEqual(["b", "c"]);
    m.prune(3500);
    expect(m.items.map((t) => t.text)).toEqual(["c"]);
    m.prune(4500);
    expect(m.items).toHaveLength(0);
  });

  it("máximo 3 a la vez: sale el más antiguo", () => {
    const m = new ToastModel();
    for (const t of ["1", "2", "3", "4"]) m.show(t, "info", 0);
    expect(TOAST_MAX).toBe(3);
    expect(m.items.map((t) => t.text)).toEqual(["2", "3", "4"]);
  });

  it("un texto idéntico en menos de 1,2 s suma contador y renueva el tiempo", () => {
    const m = new ToastModel();
    m.show("recursos insuficientes", "warn", 0);
    m.show("recursos insuficientes", "warn", 1000);
    expect(m.items).toHaveLength(1);
    expect(m.items[0]).toMatchObject({ count: 2, expires: 1000 + TOAST_DURATION.warn });
    m.show("recursos insuficientes", "warn", 1000 + TOAST_DEDUPE_MS);
    expect(m.items).toHaveLength(2);
  });

  it("los avisos fijos no vencen y se retiran con su id; no desplazan a otros si hay temporales", () => {
    const m = new ToastModel();
    m.showSticky("placement", "Colocando casa", 0);
    m.prune(1e9);
    expect(m.items).toHaveLength(1);
    m.showSticky("placement", "Colocando cuartel", 5);
    expect(m.items).toHaveLength(1);
    expect(m.items[0]!.text).toBe("Colocando cuartel");
    for (const t of ["a", "b", "c"]) m.show(t, "info", 10);
    expect(m.items.some((t) => t.id === "placement")).toBe(true);
    expect(m.items).toHaveLength(TOAST_MAX);
    m.clear("placement");
    expect(m.items.some((t) => t.id === "placement")).toBe(false);
  });

  it("tipo por texto: rechazos en ámbar, fallos en rojo, el resto neutro", () => {
    expect(toastKind("Orden rechazada: recursos insuficientes")).toBe("warn");
    expect(toastKind("Ubicación rechazada: x")).toBe("warn");
    expect(toastKind("En pausa: reanude para dar órdenes")).toBe("warn");
    expect(toastKind("Seleccione al menos un aldeano para construir")).toBe("warn");
    expect(toastKind("Error inesperado: boom")).toBe("error");
    expect(toastKind("Construcción: obra iniciada con 1 constructor")).toBe("info");
    expect(toastKind("Diagnóstico exportado")).toBe("info");
  });
});

describe("P6 miniatura y cámara", () => {
  it("convierte un punto del lienzo en celdas del mapa y lo limita", () => {
    expect(minimapPoint(128, 64, 256, 128, 128, 64)).toEqual({ x: 64, z: 32 });
    expect(minimapPoint(96, 48, 192, 96, 128, 64)).toEqual({ x: 64, z: 32 });
    expect(minimapPoint(-10, 500, 256, 128, 128, 64)).toEqual({ x: 0, z: 64 });
    expect(minimapPoint(0, 0, 0, 0, 128, 64)).toBeNull();
  });

  it("centerOn centra y respeta el límite del mapa; el zoom máximo es 4,5", () => {
    const rig = new CameraRig(128, 64);
    rig.centerOn(100, 20);
    expect(rig).toMatchObject({ x: 100, z: 20 });
    rig.centerOn(500, -3);
    expect(rig).toMatchObject({ x: 128, z: 0 });
    expect(ZOOM_MAX).toBe(4.5);
    rig.zoomBy(-1e6);
    expect(rig.zoom).toBe(ZOOM_MAX);
    rig.zoomBy(1e6);
    expect(rig.zoom).toBe(ZOOM_MIN);
  });
});

describe("P6 encuadre de cámara en la miniatura", () => {
  it("recorta un polígono que se sale del mapa y conserva el que cabe", () => {
    const inside = [
      { x: 10, z: 10 },
      { x: 20, z: 10 },
      { x: 20, z: 20 },
    ];
    expect(clipPolygon(inside, 0, 0, 128, 64)).toEqual(inside);
    const big = [
      { x: -50, z: -50 },
      { x: 200, z: -50 },
      { x: 200, z: 200 },
      { x: -50, z: 200 },
    ];
    const clipped = clipPolygon(big, 0, 0, 128, 64);
    expect(clipped.every((p) => p.x >= 0 && p.x <= 128 && p.z >= 0 && p.z <= 64)).toBe(true);
    expect(Math.max(...clipped.map((p) => p.x))).toBe(128);
    expect(clipPolygon([{ x: 300, z: 300 }, { x: 310, z: 300 }, { x: 310, z: 310 }], 0, 0, 128, 64)).toEqual([]);
  });
});