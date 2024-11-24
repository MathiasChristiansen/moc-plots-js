export interface AxesParams {
  axis: "x" | "y";
  min: number;
  max: number;
  zeroPos: number;
  scale: number;
  canvasSize: number;
  tickInterval?: number;
  tickLength?: number;
  tickLabelOffset?: number;
  textAlign?: "center" | "right" | "left";
  textBaseline?: "top" | "middle" | "bottom";
  grid?: boolean;
}
