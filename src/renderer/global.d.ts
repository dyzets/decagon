import type { PolygonBridge } from "../shared/ipc";

declare global {
  interface Window {
    polygon: PolygonBridge;
  }
}

export {};
