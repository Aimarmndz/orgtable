import { describe, it, expect, vi } from "vitest";
import { createReconnectRefresher } from "@/app/lib/realtime/reconnect";

// Regresión: tras un corte del EventSource, los cambios hechos mientras tanto no
// llegaban nunca porque el servidor no reenvía eventos. Ahora cada reapertura refresca.
describe("createReconnectRefresher", () => {
  it("no refresca en la primera apertura", () => {
    const onReconnect = vi.fn();
    const onOpen = createReconnectRefresher(onReconnect);
    onOpen();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("refresca en cada reapertura posterior", () => {
    const onReconnect = vi.fn();
    const onOpen = createReconnectRefresher(onReconnect);
    onOpen();
    onOpen();
    onOpen();
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("cada EventSource lleva su propio estado", () => {
    const a = vi.fn();
    const b = vi.fn();
    const onOpenA = createReconnectRefresher(a);
    const onOpenB = createReconnectRefresher(b);
    onOpenA();
    onOpenA();
    onOpenB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});
