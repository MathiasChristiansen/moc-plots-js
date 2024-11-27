export interface PlotOptions {
  normalizeBounds: boolean;
  bounds?: {
    x: { min: number; max: number };
    y: { min: number; max: number };
    fixedWindowSize?: number;
  };
  axis: Partial<{
    color: string;
    width: number;
    font: string;
    tick: {
      interval: { x?: number; y?: number };
      width: number;
    };
  }>;
  grid: Partial<{ show: boolean; color: string }>;
  follow: {
    enabledDefault: boolean;
    interval: number;
    jumpOffsetX: number;
    adjustY: "auto" | "manual";
    disableOnInteraction: boolean;
  };
  function: { stepScalar: number };
  config: { enabled?: boolean };
  localBufferOption: Record<
    string,
    {
      visible: boolean;
    }
  >;
  // render: {
  //   mode: "auto" | "manual";
  // };
}
