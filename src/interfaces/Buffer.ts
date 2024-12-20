export interface Buffer {
  data: Array<{ x: number; y: number }>;
  smooth?: boolean;
  color?: string;
  label?: string;
  type?: "line" | "scatter" | "bar" | "area";
  visible?: boolean;
  line?: { width?: number };
  lines?: BufferLine[];
  points: BufferPoint[];
  parametrics?: BufferParametricFunction[];
  point?: { size?: number; shape?: "circle" | "square" };
  area?: { fillOpacity?: number; gradient?: { start?: string; end?: string } };
  bar?: { width?: number; widthFactor?: number; gap?: number };
  stack?: string;
  axis?: string;
  scale?: string;
  tooltip?: {
    enabled?: boolean;
    formatter?: (point: { x: number; y: number }) => string;
  };
  legend?: {
    enabled?: boolean;
    position?: "top" | "bottom" | "left" | "right";
  };
  title?: { text?: string; style?: object };
  subtitle?: { text?: string; style?: object };
  unit?: { text?: string; style?: object };
  maxDataLength?: number;
  axisPlacement?: ("left" | "right" | "top" | "bottom")[];
  axisVisible?: boolean;
  axisColor?: string;
  axisWidth?: number;
  tickCount?: number;
  tickLength?: number;
  tickLabelOffset?: number;
  discardOptions?:
    | any
    | {
        interval?: number;
        useAnimationFrame?: boolean; // TODO: Implement this, so we can use requestAnimationFrame instead of setInterval
      };
  discardInterval?: NodeJS.Timeout | undefined;
  null?: { x?: number; y?: number };
}

export interface BufferLine {
  func: (x: number) => number;
  color?: string;
  width?: number;
  label?: string;
  stepScalar?: number;
}

export interface BufferParametricFunction {
  func: (t: number) => { x: number; y: number };
  color?: string;
  width?: number;
  tMin?: number;
  tMax?: number;
  steps?: number;
  label?: string;
}

export interface BufferPoint {
  x: number;
  y: number;
  color?: string;
  size?: number;
  shape?: "circle" | "square";
  label?: string;
  labelOffset: { x?: number; y?: number };
}
