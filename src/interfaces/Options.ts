export interface PlotOptions {
  normalizeBounds?: boolean;
  bounds?: {
    x: { min: number; max: number };
    y: { min: number; max: number };
    fixedWindowSize?: number;
  };
  axis?: {
    color?: string;
    width?: number;
    font?: string;
    tick?: {
      interval?: { x?: number; y?: number };
      width?: number;
    };
  };
  grid?: { show?: boolean; color?: string };
  follow?: {
    enabledDefault?: boolean;
    interval?: number;
    jumpOffsetX?: number;
    adjustY?: "auto" | "manual";
    disableOnInteraction?: boolean;
  };
  function?: { stepScalar?: number };
  config?: { enabled?: boolean };
  // render: {
  //   mode: "auto" | "manual";
  // };
}
