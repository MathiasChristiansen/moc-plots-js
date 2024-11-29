import { Buffer, BufferPoint } from "./interfaces/Buffer";
import { PlotOptions } from "./interfaces/Options";

/**
 * TODO: Add cleanup, so a destroy function can be called to remove event listeners and clear intervals
 *       The destructor should also remove the canvas from the parent element.
 * TODO: Add support for multiple y-axes
 */

export class MocPlot {
  parent: HTMLElement; // HTML element that contains the plot (usually a <div>)
  buffers: Map<string, Buffer>; // Buffers to plot
  options: PlotOptions; // Plot options and configuration
  canvas: HTMLCanvasElement; // Canvas for rendering the plot
  ctx: CanvasRenderingContext2D | undefined; // Canvas rendering context
  bounds?: PlotOptions["bounds"]; // Bounds for the plot
  normalizeBounds: boolean; // Whether to normalize bounds based on the data
  followTimer: NodeJS.Timeout | null; // Timer for following the latest data
  isDragging: boolean; // Indicates if the user is currently dragging
  dragStart: { x: number; y: number }; // Start position of a drag event
  lastMousePos: { x: number; y: number }; // Last mouse position during drag
  onFollowStartFunc?: () => void; // Callback for when following starts
  onFollowStopFunc?: () => void; // Callback for when following stops

  renderMode: "auto" | "manual" = "auto";

  renderDispatch: { [key: string]: () => void } = {
    auto: () => this.render(),
    manual: () => {},
  };

  constructor(
    parent: HTMLElement,
    buffers: Map<string, Buffer> = new Map<string, Buffer>(),
    options: Partial<PlotOptions> = {}
  ) {
    this.parent = parent;
    this.buffers = buffers;
    // this.options = options || ({} as any);
    this.options = {
      follow: {
        enabledDefault: false,
        interval: 1000,
        jumpOffsetX: 0,
        adjustY: "manual",
        disableOnInteraction: false,
      },
      axis: {
        color: "black",
        width: 2,
        font: "12px Arial",
        tick: {
          interval: {
            x: undefined,
            y: undefined,
          },
          width: 2,
        },
      },
      config: {
        enabled: true,
      },
      function: {
        stepScalar: 1,
      },
      grid: {
        show: true,
        color: "#e0e0e0",
      },
      localBufferOption: {},
      normalizeBounds: false,
      ...options,
    };

    /**
     * Defaults
     */
    /**
     * Render options
     */
    // this.options.render = this.options.render ?? {};
    // this.options.render.mode = this.options.render?.mode ?? "auto";

    this.normalizeBounds = this.options.normalizeBounds;
    this.bounds = this.options.bounds;

    this.followTimer = null;

    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.lastMousePos = { x: 0, y: 0 };

    this.canvas = document.createElement("canvas");

    this.canvas.style.userSelect = "none";

    this.init();
  }

  /**
   * Initialize the plot (canvas, event listeners, etc.).
   */
  init(): void {
    /**
     * Canvas styles
     */
    this.canvas.style.cursor = "grab";

    this.parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

    this.resizeCanvas();

    /**
     * Create function to handle resize so we can clean it up later
     */
    const debounceResize = this.debounce(() => {
      this.resizeCanvas();
      // this.renderDispatch[this.renderMode]();
      if (this.renderMode === "auto") {
        this.render();
      }
    }, 100);
    window.addEventListener(
      "resize",
      debounceResize as (this: Window, ev: UIEvent) => any
    );

    /**
     * Mouse event listeners
     */
    this.canvas.addEventListener("mousedown", (event) =>
      this.onMouseDown(event)
    );
    this.canvas.addEventListener("mousemove", (event) =>
      this.onMouseMove(event)
    );
    this.canvas.addEventListener("mouseup", (event) => this.onMouseUp(event));
    this.canvas.addEventListener("mouseleave", (event) =>
      this.onMouseLeave(event)
    );
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event));

    /**
     * Touch event listeners
     */
    this.canvas.addEventListener("touchstart", (event) =>
      this.onTouchStart(event)
    );
    this.canvas.addEventListener("touchmove", (event) =>
      this.onTouchMove(event)
    );
    this.canvas.addEventListener("touchend", (event) => this.onTouchEnd(event));
    this.canvas.addEventListener("touchcancel", (event) =>
      this.onTouchEnd(event)
    );

    /**
     * Handle bounds
     */
    if (
      this.bounds &&
      (this.bounds.x.min === undefined ||
        this.bounds.x.max === undefined ||
        this.bounds.y.min === undefined ||
        this.bounds.y.max === undefined)
    ) {
      const bounds = this.computeBounds();
      if (this.bounds.x.min === undefined) this.bounds.x.min = bounds.x.min;
      if (this.bounds.x.max === undefined) this.bounds.x.max = bounds.x.max;
      if (this.bounds.y.min === undefined) this.bounds.y.min = bounds.y.min;
      if (this.bounds.y.max === undefined) this.bounds.y.max = bounds.y.max;
    } else {
      this.bounds = {
        x: { min: 0, max: this.canvas.width },
        y: { min: 0, max: this.canvas.height },
      };
    }

    /**
     * Set discard options for buffers with maxDataLength
     */
    for (let [key, buffer] of this.buffers.entries()) {
      if (buffer.maxDataLength) {
        this.setBufferDiscardOptions(key, buffer.discardOptions);
      }
    }

    if (this.options.follow?.enabledDefault) {
      this.startFollowingLatest();
    }

    if (this.options?.config?.enabled !== false) {
      this.renderConfig();
    }

    // this.render();
    // this.renderDispatch[this.renderMode]();
    if (this.renderMode === "auto") {
      this.render();
    }
  }

  /**
   * Start following the latest data in the buffers.
   */
  startFollowingLatest(): void {
    const followFunc = () => {
      if (this.isDragging) return;
      this.updateBoundsToLatestData();
      // this.render();
      // this.renderDispatch[this.renderMode]();
      if (this.renderMode === "auto") {
        this.render();
      }
    };

    if (this.followTimer) {
      clearInterval(this.followTimer);
    }

    this.followTimer = setInterval(followFunc, this.options.follow?.interval);

    if (this.onFollowStartFunc) {
      this.onFollowStartFunc();
    }
  }

  /**
   * Stop following the latest data.
   */
  stopFollowingLatest(): void {
    if (this.followTimer) {
      clearInterval(this.followTimer);
      this.followTimer = null;
    }

    if (this.onFollowStopFunc) {
      this.onFollowStopFunc();
    }
  }

  /**
   * Update the plot bounds to the latest data.
   */
  updateBoundsToLatestData(): void {
    const latestBounds = this.computeBounds();

    if (!this.bounds) {
      this.bounds = latestBounds;
      this.bounds.x.max += this.options.follow.jumpOffsetX;
    }

    this.bounds.x.max = latestBounds.x.max + this.options?.follow?.jumpOffsetX;

    if (this.options?.bounds?.fixedWindowSize) {
      const windowSize = this.options.bounds.fixedWindowSize;
      this.bounds.x.min = this.bounds.x.max - windowSize;
    }

    if (this.options.follow?.adjustY === "auto") {
      this.bounds.y.min = latestBounds.y.min;
      this.bounds.y.max = latestBounds.y.max;
    }

    this.resizeCanvas();
  }

  /**
   * Compute the bounds (min/max) of all the data in the buffers.
   */
  computeBounds(): {
    x: { min: number; max: number };
    y: { min: number; max: number };
  } {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    for (let [key, buffer] of this.buffers.entries()) {
      const data = buffer.data;
      if (
        !data ||
        data.length === 0 ||
        buffer.visible === false ||
        this.options?.localBufferOption?.[key]?.visible === false
      )
        continue;

      const xNull = buffer.null?.x || 0;
      const yNull = buffer.null?.y || 0;

      const xValues = data.map((point) => point.x - xNull);
      const yValues = data.map((point) => point.y - yNull);

      // const bufferXMin = Math.min(...xValues, xNull);
      // const bufferXMax = Math.max(...xValues, xNull);
      // const bufferYMin = Math.min(...yValues, yNull);
      // const bufferYMax = Math.max(...yValues, yNull);
      const bufferXMin = Math.min(...xValues);
      const bufferXMax = Math.max(...xValues);
      const bufferYMin = Math.min(...yValues);
      const bufferYMax = Math.max(...yValues);

      if (bufferXMin < xMin) xMin = bufferXMin;
      if (bufferXMax > xMax) xMax = bufferXMax;
      if (bufferYMin < yMin) yMin = bufferYMin;
      if (bufferYMax > yMax) yMax = bufferYMax;
    }

    // if (this.normalizeBounds) {
    //   return {
    //     x: { min: xMin, max: xMax },
    //     y: { min: yMin, max: yMax },
    //   };
    // }

    return {
      x: { min: xMin, max: xMax },
      y: { min: yMin, max: yMax },
    };
  }

  /**
   * Render the plot.
   */
  render(): void {
    this.ctx?.clearRect(0, 0, this.canvas!.width, this.canvas!.height);

    this.renderAxes();

    for (let [key, buffer] of this.buffers.entries()) {
      this.drawBuffer(key, buffer);
    }
  }

  /**
   * Render the axes on the plot.
   */
  renderAxes(): void {
    const ctx = this.ctx as CanvasRenderingContext2D;
    ctx.save();

    ctx.strokeStyle = this.options?.axis?.color || "black";
    ctx.lineWidth = this.options?.axis?.width || 2;
    ctx.font = this.options?.axis?.font ?? "12px Arial";
    ctx.fillStyle = this.options?.axis?.color ?? "black";

    // const xMin = this.bounds?.x?.min ?? 0;
    // const yMin = this.bounds?.y?.min ?? 0;
    // const xMax = this.bounds?.x?.max ?? this.canvas.width;
    // const yMax = this.bounds?.y?.max ?? this.canvas.height;
    // this.bounds = this.normalizeBounds ? this.computeBounds() : this.bounds!;
    if (!this.bounds || this.normalizeBounds)
      this.bounds = this.computeBounds();

    const range = {
      x: this.bounds.x.max - this.bounds.x.min,
      y: this.bounds.y.max - this.bounds.y.min,
    };

    if (range.x === 0 || range.y === 0) {
      ctx.restore();
      return;
    }

    const scale = {
      x: this.canvas.width / range.x,
      y: this.canvas.height / range.y,
    };

    let zeroPosition = {
      x: (0 - this.bounds.x.min) * scale.x,
      y: this.canvas.height - (0 - this.bounds.y.min) * scale.y,
    };

    this.drawTicks(ctx, {
      axis: "x",
      min: this.bounds.x.min,
      max: this.bounds.x.max,
      zeroPos: zeroPosition.y,
      scale: scale.x,
      canvasSize: this.canvas.width,
      tickInterval: this.options?.axis?.tick?.interval?.x,
      tickLength: 5,
      tickLabelOffset: 8,
      textAlign: "center",
      textBaseline: "top",
      grid: this.options?.grid?.show !== false,
    });

    this.drawTicks(ctx, {
      axis: "y",
      min: this.bounds.y.min,
      max: this.bounds.y.max,
      zeroPos: zeroPosition.x,
      scale: scale.y,
      canvasSize: this.canvas.height,
      tickInterval: this.options?.axis?.tick?.interval?.y,
      tickLength: 5,
      tickLabelOffset: 8,
      textAlign: "right",
      textBaseline: "middle",
      grid: this.options?.grid?.show !== false,
    });

    ctx.strokeStyle = this.options?.axis?.color ?? "#333";
    ctx.lineWidth = this.options?.axis?.width ?? 2;
    ctx.font = this.options?.axis?.font ?? "12px Arial";
    ctx.fillStyle = this.options?.axis?.color ?? "#333";

    // Draw x-axis if within canvas bounds
    if (zeroPosition.y >= 0 && zeroPosition.y <= this.canvas.height) {
      ctx.beginPath();
      ctx.moveTo(0, zeroPosition.y);
      ctx.lineTo(this.canvas.width, zeroPosition.y);
      ctx.stroke();
    }

    // Draw y-axis if within canvas bounds
    if (zeroPosition.x >= 0 && zeroPosition.x <= this.canvas.width) {
      ctx.beginPath();
      ctx.moveTo(zeroPosition.x, 0);
      ctx.lineTo(zeroPosition.x, this.canvas.height);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw ticks on the axes.
   */
  drawTicks(ctx: CanvasRenderingContext2D, params: any): void {
    const {
      axis,
      min,
      max,
      zeroPos,
      scale,
      canvasSize,
      tickInterval,
      tickLength,
      tickLabelOffset,
      textAlign,
      textBaseline,
      grid,
    } = params;

    const range = max - min;
    const interval = tickInterval ?? this.calculateTickInterval(min, max);
    const startTick = Math.ceil(min / interval) * interval;
    const endTick = Math.floor(max / interval) * interval;

    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;

    for (let value = startTick; value <= endTick; value += interval) {
      const pos = (value - min) * scale;
      let canvasPosition, tickStart, tickEnd, labelPosition;

      if (axis === "x") {
        canvasPosition = pos;
        tickStart = zeroPos - tickLength;
        tickEnd = zeroPos + tickLength;
        labelPosition = zeroPos + tickLabelOffset;

        // Draw grid line
        if (grid) {
          ctx.strokeStyle = this.options?.grid?.color || "#e0e0e0";
          ctx.fillStyle = this.options?.grid?.color || "#e0e0e0";
          ctx.beginPath();
          ctx.moveTo(canvasPosition, 0);
          ctx.lineTo(canvasPosition, this.canvas.height);
          ctx.stroke();
        }

        // Reset stroke style for ticks
        ctx.strokeStyle = this.options?.axis?.color || "#333";
        ctx.fillStyle = this.options?.axis?.color || "#333";

        // Draw tick
        ctx.beginPath();
        ctx.lineWidth = this.options?.axis?.tick?.width ?? 2;
        ctx.moveTo(canvasPosition, tickStart);
        ctx.lineTo(canvasPosition, tickEnd);
        ctx.stroke();

        // Reset line width

        ctx.lineWidth = this.options?.axis?.width ?? 1;

        // Draw label
        ctx.fillStyle = this.options?.axis?.color || "#333";
        ctx.fillText(value.toFixed(2), canvasPosition, labelPosition);
      } else if (axis === "y") {
        canvasPosition = this.canvas.height - pos;
        tickStart = zeroPos - tickLength;
        tickEnd = zeroPos + tickLength;
        labelPosition = zeroPos - tickLabelOffset;

        // Draw grid line
        if (grid) {
          ctx.strokeStyle = this.options?.grid?.color || "#e0e0e0";
          ctx.fillStyle = this.options?.grid?.color || "#e0e0e0";
          ctx.beginPath();
          ctx.moveTo(0, canvasPosition);
          ctx.lineTo(this.canvas.width, canvasPosition);
          ctx.stroke();
        }

        // Reset stroke style for ticks
        ctx.strokeStyle = this.options?.axis?.color || "#333";
        ctx.fillStyle = this.options?.axis?.color || "#333";

        // Draw tick
        ctx.beginPath();
        ctx.lineWidth = this.options?.axis?.tick?.width ?? 2;
        ctx.moveTo(tickStart, canvasPosition);
        ctx.lineTo(tickEnd, canvasPosition);
        ctx.stroke();

        // Reset line width
        ctx.lineWidth = this.options?.axis?.width ?? 1;

        // Draw label
        ctx.fillStyle = this.options?.axis?.color || "#333";
        ctx.fillText(value.toFixed(2), labelPosition, canvasPosition);
      }
    }
  }

  /**
   * Calculate the tick interval for the axes.
   */
  calculateTickInterval(min: number, max: number): number {
    const range = max - min;
    const roughTickCount = 10;
    const roughTickSize = range / roughTickCount;

    const orderOfMagnitude = Math.pow(
      10,
      Math.floor(Math.log10(roughTickSize))
    );
    const possibleTickSizes = [1, 2, 5, 10];

    let tickSize = possibleTickSizes[0] * orderOfMagnitude;
    for (let size of possibleTickSizes) {
      const currentTickSize = size * orderOfMagnitude;
      if (roughTickSize < currentTickSize) {
        tickSize = currentTickSize;
        break;
      }
    }

    return tickSize;
  }

  /**
   * Draw a specific buffer on the plot.
   */
  drawBuffer(key: string, buffer: Buffer): void {
    if (
      buffer.visible === false ||
      this.options?.localBufferOption?.[key]?.visible === false
    )
      return;
    const data = buffer.data ?? [];
    const lines = buffer.lines ?? [];
    const points: BufferPoint[] = buffer.points ?? [];
    const parametrics = buffer.parametrics ?? [];

    const ctx = this.ctx as CanvasRenderingContext2D;
    ctx.save();

    ctx.strokeStyle = buffer.color || "black";
    ctx.fillStyle = buffer.color || "black";
    ctx.lineWidth = buffer.line?.width || 2;

    const nullPosition = {
      x: buffer.null?.x ?? 0,
      y: buffer.null?.y ?? 0,
    };

    let bounds = {
      x: {
        min: this.bounds?.x.min ?? 0,
        max: this.bounds?.x.max ?? this.canvas.width,
      },
      y: {
        min: this.bounds?.y.min ?? 0,
        max: this.bounds?.y.max ?? this.canvas.height,
      },
    };
    if (this.normalizeBounds) {
      // TODO: Create new axis rendering function for normalized bounds
      for (let point of data) {
        if (point.x < bounds.x.min + nullPosition.x)
          bounds.x.min = point.x - nullPosition.x;
        if (point.x > bounds.x.max + nullPosition.x)
          bounds.x.max = point.x - nullPosition.x;
        if (point.y < bounds.y.min + nullPosition.y) bounds.y.min = point.y;
        if (point.y > bounds.y.max + nullPosition.y) bounds.y.max = point.y;
      }
    }

    const range = {
      x: bounds.x.max - bounds.x.min,
      y: bounds.y.max - bounds.y.min,
    };

    if (range.x === 0 || range.y === 0) {
      ctx.restore();
      return;
    }

    const scale = {
      x: 1,
      y: 1,
    };

    if (range.x !== Infinity || range.y !== Infinity) {
      // scale = {
      //   x: this.canvas.width / range.x,
      //   y: this.canvas.height / range.y,
      // }
      scale.x = this.canvas.width / range.x;
      scale.y = this.canvas.height / range.y;
    }

    if (data.length > 0) {
      ctx.beginPath();
      ctx.moveTo(
        (data[0].x - nullPosition.x - bounds.x.min) * scale.x,
        this.canvas.height -
          (data[0].y - nullPosition.y - bounds.y.min) * scale.y
      );

      if (buffer.type === "scatter") {
        for (let point of data) {
          ctx.beginPath();
          ctx.arc(
            (point.x - nullPosition.x - bounds.x.min) * scale.x,
            this.canvas.height -
              (point.y - nullPosition.y - bounds.y.min) * scale.y,
            buffer.point?.size ?? 2,
            0,
            2 * Math.PI * scale.x
          );
          ctx.fill();
        }
      } else if (buffer.type === "area") {
        // let adjustedData = [];
        let xValues = [];
        let yValues = [];
        const zeroPositionY = this.canvas.height - (0 - bounds.y.min) * scale.y;
        xValues.push((data[0].x - nullPosition.x - bounds.x.min) * scale.x);
        yValues.push((data[0].y - nullPosition.y - bounds.y.min) * scale.y);
        ctx.moveTo(xValues[0], zeroPositionY);
        for (let i = 0; i < data.length; i++) {
          xValues.push((data[i].x - nullPosition.x - bounds.x.min) * scale.x);
          yValues.push(
            this.canvas.height -
              (data[i].y - nullPosition.y - bounds.y.min) * scale.y
          );
          ctx.lineTo(
            (data[i].x - nullPosition.x - bounds.x.min) * scale.x,
            this.canvas.height -
              (data[i].y - nullPosition.y - bounds.y.min) * scale.y
          );
        }

        // adjustedData.forEach((point, index) => {
        //   ctx.lineTo(point.x, point.y);
        // });

        ctx.lineTo(xValues[xValues.length - 1], zeroPositionY);

        const gradient = ctx.createLinearGradient(
          0,
          Math.min(...yValues),
          0,
          Math.max(...yValues)
        );
        gradient.addColorStop(
          0,
          buffer.area?.gradient?.start ?? "rgba(0, 0, 255, 0.5)"
        );
        gradient.addColorStop(
          1,
          buffer.area?.gradient?.end ?? "rgba(0, 0, 255, 0)"
        );

        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        // ctx.moveTo(xValues[0], zeroPositionY * scale.y);
        ctx.moveTo(xValues[0], yValues[4]);

        for (let i = 2; i < xValues.length; i++) {
          ctx.lineTo(xValues[i], yValues[i]);
        }

        ctx.strokeStyle = buffer.color || "black";
        ctx.lineWidth = buffer.line?.width || 2;
        ctx.stroke();
      } else {
        for (let i = 1; i < data.length; i++) {
          ctx.lineTo(
            (data[i].x - nullPosition.x - bounds.x.min) * scale.x,
            this.canvas.height -
              (data[i].y - nullPosition.y - bounds.y.min) * scale.y
          );
        }
        ctx.stroke();
      }
    }

    if (lines && Array.isArray(lines)) {
      for (let line of lines) {
        if (typeof line.func !== "function") continue;

        ctx.beginPath();
        ctx.strokeStyle = line.color || "black";
        ctx.lineWidth = line.width || 2;

        const step = (line?.stepScalar ?? 1) / scale.x;
        for (
          let x = bounds.x.min + nullPosition.x;
          x < bounds.x.max + nullPosition.x;
          x += step
        ) {
          const y = line.func(x);
          const adjusted = {
            x: x - nullPosition.x,
            y: y - nullPosition.y,
          };
          if (
            adjusted.x < bounds.x.min - scale.x ||
            adjusted.x > bounds.x.max + scale.x
          )
            continue;
          if (
            adjusted.y < bounds.y.min - scale.y ||
            adjusted.y > bounds.y.max + scale.y
          )
            continue;

          const canvasPosition = {
            x: (adjusted.x - bounds.x.min) * scale.x,
            y: this.canvas.height - (adjusted.y - bounds.y.min) * scale.y,
          };

          if (x === bounds.x.min + nullPosition.x) {
            ctx.moveTo(canvasPosition.x, canvasPosition.y);
          } else {
            ctx.lineTo(canvasPosition.x, canvasPosition.y);
          }
        }
        ctx.stroke();
      }
    }

    /**
     * Draw points
     */
    if (points && Array.isArray(points)) {
      for (let point of points) {
        if (typeof point.x !== "number" || typeof point.y !== "number")
          continue;

        ctx.beginPath();
        ctx.fillStyle = point.color || "black";
        ctx.arc(
          (point.x - nullPosition.x - bounds.x.min) * scale.x,
          this.canvas.height -
            (point.y - nullPosition.y - bounds.y.min) * scale.y,
          point.size || 2,
          0,
          2 * Math.PI
        );
        ctx.fill();

        if (point.label) {
          ctx.font = "12px Arial";
          ctx.fillStyle = point.color || "black";
          ctx.fillText(
            point.label,
            (point.x - nullPosition.x - bounds.x.min) * scale.x +
              (point?.labelOffset?.x ?? 5),
            this.canvas.height -
              (point.y - nullPosition.y - bounds.y.min) * scale.y +
              (point?.labelOffset?.y ?? -5)
          );
        }
      }
    }

    if (parametrics && Array.isArray(parametrics)) {
      for (let parametric of parametrics) {
        if (typeof parametric.func !== "function") continue;

        ctx.beginPath();
        ctx.strokeStyle = parametric.color || "black";
        ctx.lineWidth = parametric.width || 2;

        const tMin = parametric.tMin ?? 0;
        const tMax = parametric.tMax ?? 10;
        const steps = parametric.steps ?? 1000;
        const dt = (tMax - tMin) / steps;

        let firstPoint = true;
        for (let t = tMin; t <= tMax; t += dt) {
          const point = parametric.func(t);
          if (
            !point ||
            typeof point.x !== "number" ||
            typeof point.y !== "number"
          ) {
            continue;
          }

          const adjusted = {
            x: point.x - nullPosition.x,
            y: point.y - nullPosition.y,
          };

          if (
            adjusted.x < bounds.x.min - scale.x ||
            adjusted.x > bounds.x.max + scale.x ||
            adjusted.y < bounds.y.min - scale.y ||
            adjusted.y > bounds.y.max + scale.y
          ) {
            continue;
          }

          const canvasPosition = {
            x: (adjusted.x - bounds.x.min) * scale.x,
            y: this.canvas.height - (adjusted.y - bounds.y.min) * scale.y,
          };

          if (firstPoint) {
            ctx.moveTo(canvasPosition.x, canvasPosition.y);
            firstPoint = false;
          } else {
            ctx.lineTo(canvasPosition.x, canvasPosition.y);
          }
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Update the properties of a specific buffer.
   */
  updateBuffer(
    key: string,
    buffer: Partial<Buffer> | ((buffer: Buffer) => Partial<Buffer>)
  ): void {
    const originalBuffer = this.buffers.get(key);

    if (!originalBuffer) {
      console.error(`Buffer with key ${key} does not exist.`);
      return;
    }

    /**
     * If buffer is a function, call it with the original buffer and expect a partial buffer to be returned.
     */
    if (buffer instanceof Function) {
      buffer = buffer(originalBuffer);
    }

    this.buffers.set(key, { ...originalBuffer, ...buffer });
    if (buffer?.discardOptions) {
      this.setBufferDiscardOptions(key, this.buffers.get(key)?.discardOptions);
    }
    // this.render();
    // this.renderDispatch[this.renderMode]();
    if (this.renderMode === "auto") {
      this.render();
    }
  }

  /**
   * Update plot options dynamically.
   */
  update(options: Partial<PlotOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
    this.normalizeBounds = this.options.normalizeBounds ?? false;
    this.bounds = {
      ...(this.bounds ?? {}),
      ...(this.options.bounds ?? {}),
    } as any;

    // this.render();
    // this.renderDispatch[this.renderMode]();
    if (this.renderMode === "auto") {
      this.render();
    }
  }

  /**
   * Set discard options for a specific buffer.
   */
  setBufferDiscardOptions(key: string, options: any): void {
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    this.buffers.set(key, {
      ...buffer,
      discardOptions: {
        ...buffer.discardOptions,
        ...options,
      },
    });
    if (buffer?.discardInterval) {
      /**
       * Clear existing interval if it exists
       */
      clearInterval(buffer?.discardInterval);
    }

    /**
     * Set new interval for discarding data
     */
    if (buffer?.maxDataLength) {
      buffer.discardInterval = setInterval(() => {
        let buffer = this.buffers.get(key);
        if (!buffer || !buffer.maxDataLength) return;
        if (buffer?.data?.length > buffer?.maxDataLength) {
          this.buffers.set(key, {
            ...buffer,
            data: buffer.data.slice(buffer.data.length - buffer.maxDataLength),
          });
        }
      }, buffer.discardOptions?.interval ?? 1000);
    }
    // this.render();
    // this.renderDispatch[this.renderMode]();
    if (this.renderMode === "auto") {
      this.render();
    }
  }

  /**
   * Resize the canvas when the parent container size changes.
   */
  resizeCanvas(): void {
    const parentWidth = this.parent.clientWidth;
    const parentHeight = this.parent.clientHeight;

    this.canvas.width = parentWidth;
    this.canvas.height = parentHeight;

    if (!this.bounds) return;

    const range = {
      x: this.bounds.x.max - this.bounds.x.min,
      y: this.bounds.y.max - this.bounds.y.min,
    };
    const canvasAspectRatio = parentWidth / parentHeight;
    const dataAspectRatio = range.x / range.y;

    if (canvasAspectRatio > dataAspectRatio) {
      const newRange = {
        x: range.y * canvasAspectRatio,
        y: range.y,
      };
      const center = {
        x: (this.bounds.x.min + this.bounds.x.max) / 2,
        y: (this.bounds.y.min + this.bounds.y.max) / 2,
      };
      this.bounds.x.min = center.x - newRange.x / 2;
      this.bounds.x.max = center.x + newRange.x / 2;
    } else {
      const newRange = {
        x: range.x,
        y: range.x / canvasAspectRatio,
      };
      const center = {
        x: (this.bounds.x.min + this.bounds.x.max) / 2,
        y: (this.bounds.y.min + this.bounds.y.max) / 2,
      };
      this.bounds.y.min = center.y - newRange.y / 2;
      this.bounds.y.max = center.y + newRange.y / 2;
    }
  }

  /**
   * Iterate over all buffers and apply a callback.
   */
  iterateBuffers(callback: (key: string, buffer: Buffer) => void): void {
    for (let [key, buffer] of this.buffers.entries()) {
      callback(key, buffer);
    }
  }

  /**
   * Handle mouse down events for dragging.
   */
  onMouseDown(event: MouseEvent): void {
    this.isDragging = true;
    // this.dragStart = { x: event.clientX, y: event.clientY };
    this.lastMousePos = { x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = "grabbing";

    if (this.options?.follow?.disableOnInteraction) {
      this.stopFollowingLatest();
    }
  }

  /**
   * Handle mouse move events for dragging.
   */
  onMouseMove(event: MouseEvent): void {
    if (!this.bounds) this.bounds = this.computeBounds();
    if (this.isDragging) {
      const delta = {
        x: event.clientX - this.lastMousePos.x,
        y: event.clientY - this.lastMousePos.y,
      };

      const range = {
        x: this.bounds.x.max - this.bounds.x.min,
        y: this.bounds.y.max - this.bounds.y.min,
      };

      const deltaData = {
        x: (-delta.x * range.x) / this.canvas.width,
        y: (delta.y * range.y) / this.canvas.height,
      };

      this.bounds.x.min += deltaData.x;
      this.bounds.x.max += deltaData.x;
      this.bounds.y.min += deltaData.y;
      this.bounds.y.max += deltaData.y;

      this.lastMousePos = { x: event.clientX, y: event.clientY };

      // this.render();
      // this.renderDispatch[this.renderMode]();
      if (this.renderMode === "auto") {
        this.render();
      }
    }
  }

  /**
   * Handle mouse up events for dragging.
   */
  onMouseUp(event: MouseEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = "grab";

    if (this.options?.follow?.disableOnInteraction) {
      this.startFollowingLatest();
    }
  }

  /**
   * Handle mouse wheel events for zooming.
   */
  onWheel(event: WheelEvent): void {
    if (!this.bounds) return;

    const zoomFactor = 0.1;
    const delta = event.deltaY > 0 ? 1 : -1;

    const factor = delta > 0 ? 1 + zoomFactor : 1 - zoomFactor;

    const range = {
      x: this.bounds.x.max - this.bounds.x.min,
      y: this.bounds.y.max - this.bounds.y.min,
    };

    const boundingRect = this.canvas.getBoundingClientRect();

    const mousePosition = {
      x: event.clientX - boundingRect.left,
      y: event.clientY - boundingRect.top,
    };

    const dataPosition = {
      x: this.bounds.x.min + (mousePosition.x / this.canvas.width) * range.x,
      y:
        this.bounds.y.min +
        (1 - mousePosition.y / this.canvas.height) * range.y,
    };

    this.bounds.x.min =
      dataPosition.x - (dataPosition.x - this.bounds.x.min) * factor;
    this.bounds.x.max =
      dataPosition.x + (this.bounds.x.max - dataPosition.x) * factor;
    this.bounds.y.min =
      dataPosition.y - (dataPosition.y - this.bounds.y.min) * factor;
    this.bounds.y.max =
      dataPosition.y + (this.bounds.y.max - dataPosition.y) * factor;

    // this.render();
    // this.renderDispatch[this.renderMode]();
    if (this.renderMode === "auto") {
      this.render();
    }

    if (this.options?.follow?.disableOnInteraction) {
      this.stopFollowingLatest();
    }
  }

  /**
   * Handle mouse leave events.
   */
  onMouseLeave(event: MouseEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = "grab";
  }

  /**
   * Handle touch start events for dragging.
   */
  onTouchStart(event: TouchEvent): void {
    this.isDragging = true;
    this.lastMousePos = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
    this.canvas.style.cursor = "grabbing";

    if (this.options?.follow?.disableOnInteraction) {
      this.stopFollowingLatest();
    }
  }

  /**
   * Handle touch move events for dragging.
   */
  onTouchMove(event: TouchEvent): void {
    event.preventDefault();
    if (!this.bounds) this.bounds = this.computeBounds();
    if (this.isDragging) {
      const delta = {
        x: event.touches[0].clientX - this.lastMousePos.x,
        y: event.touches[0].clientY - this.lastMousePos.y,
      };

      const range = {
        x: this.bounds.x.max - this.bounds.x.min,
        y: this.bounds.y.max - this.bounds.y.min,
      };

      const deltaData = {
        x: (-delta.x * range.x) / this.canvas.width,
        y: (delta.y * range.y) / this.canvas.height,
      };

      this.bounds.x.min += deltaData.x;
      this.bounds.x.max += deltaData.x;
      this.bounds.y.min += deltaData.y;
      this.bounds.y.max += deltaData.y;

      this.lastMousePos = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };

      // this.render();
      // this.renderDispatch[this.renderMode]();
      if (this.renderMode === "auto") {
        this.render();
      }
    }
  }

  /**
   * Handle touch end events for dragging.
   */
  onTouchEnd(event: TouchEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = "grab";

    if (this.options?.follow?.disableOnInteraction) {
      this.startFollowingLatest();
    }
  }

  /**
   * Handle touch cancel events.
   */
  onTouchCancel(event: TouchEvent): void {
    this.isDragging = false;
    this.canvas.style.cursor = "grab";

    if (this.options?.follow?.disableOnInteraction) {
      this.startFollowingLatest();
    }
  }

  /**
   * Reset the view to fit all the data in the buffers.
   */
  resetView(): void {
    this.bounds = this.computeBounds();
    this.resizeCanvas();
    this.render();
    // this.renderDispatch[this.options.render.mode]();
    if (this.renderMode === "auto") {
      this.render();
    }
  }

  /**
   * Register a callback for when following starts.
   */
  onFollowStart(callback: () => void): void {
    this.onFollowStartFunc = callback;
  }

  /**
   * Register a callback for when following stops.
   */
  onFollowStop(callback: () => void): void {
    this.onFollowStopFunc = callback;
  }

  /**
   * Adjust the plot to fit all the data in the buffers.
   */
  fitToView(): void {
    this.bounds = this.computeBounds();

    const range = {
      x: this.bounds.x.max - this.bounds.x.min,
      y: this.bounds.y.max - this.bounds.y.min,
    };

    const canvasAspectRatio = this.canvas.width / this.canvas.height;
    const dataAspectRatio = range.x / range.y;

    if (canvasAspectRatio > dataAspectRatio) {
      const newRange = {
        x: range.y * canvasAspectRatio,
        y: range.y,
      };
      const center = {
        x: (this.bounds.x.min + this.bounds.x.max) / 2,
        y: (this.bounds.y.min + this.bounds.y.max) / 2,
      };
      this.bounds.x.min = center.x - newRange.x / 2;
      this.bounds.x.max = center.x + newRange.x / 2;
    } else {
      const newRange = {
        x: range.x,
        y: range.x / canvasAspectRatio,
      };
      const center = {
        x: (this.bounds.x.min + this.bounds.x.max) / 2,
        y: (this.bounds.y.min + this.bounds.y.max) / 2,
      };
      this.bounds.y.min = center.y - newRange.y / 2;
      this.bounds.y.max = center.y + newRange.y / 2;
    }
  }

  /**
   * Focus the plot on a specific point in a buffer.
   */
  focusOnPoint(
    bufferKey: string,
    pointIndex: number = -1,
    options?: { zoomFactor?: number }
  ): void {
    const buffer = this.buffers.get(bufferKey);

    if (!buffer || !buffer.data || buffer.data.length === 0) {
      console.warn(`Buffer with key ${bufferKey} does not exist or is empty.`);
      return;
    }

    const data = buffer.data;
    const targetIndex = pointIndex === -1 ? data.length - 1 : pointIndex;

    if (targetIndex < 0 || targetIndex >= data.length) {
      console.warn(`Point index ${targetIndex} is out of bounds.`);
      return;
    }

    const targetPoint = data[targetIndex];

    if (
      !targetPoint ||
      typeof targetPoint.x !== "number" ||
      typeof targetPoint.y !== "number"
    ) {
      console.warn(`Invalid point at index ${targetIndex}.`);
      return;
    }

    const nullPosition = {
      x: buffer.null?.x ?? 0,
      y: buffer.null?.y ?? 0,
    };

    const focusPoint = {
      x: targetPoint.x - nullPosition.x,
      y: targetPoint.y - nullPosition.y,
    };

    if (!this.bounds) this.bounds = this.computeBounds();

    const range = {
      x: this.bounds.x.max - this.bounds.x.min,
      y: this.bounds.y.max - this.bounds.y.min,
    };

    const zoomFactor = options?.zoomFactor ?? 1;

    const newRange = {
      x: range.x * zoomFactor,
      y: range.y * zoomFactor,
    };

    this.bounds.x.min = focusPoint.x - newRange.x / 2;
    this.bounds.x.max = focusPoint.x + newRange.x / 2;
    this.bounds.y.min = focusPoint.y - newRange.y / 2;
    this.bounds.y.max = focusPoint.y + newRange.y / 2;

    // this.render();
    // this.renderDispatch[this.renderMode]();
    if (this.renderMode === "auto") {
      this.render();
    }
  }

  /**
   * Render a configuration button.
   */
  renderConfig(): void {
    /**
     * This is temporary, we'll create a separate component for this.
     */
    this.parent.style.position = "relative";

    const configButton = document.createElement("button");
    configButton.innerText = "Config";
    configButton.style.position = "absolute";
    configButton.style.top = "8px";
    configButton.style.right = "8px";

    this.parent.appendChild(configButton);

    configButton.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.style.animationDuration = "0.3s";
      overlay.style.opacity = "0";
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "100vw";
      overlay.style.height = "100vh";
      overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
      overlay.style.zIndex = "1000";
      overlay.style.display = "flex";
      overlay.style.justifyContent = "center";
      overlay.style.alignItems = "center";

      const configPanel = document.createElement("div");
      configPanel.style.position = "relative";
      configPanel.style.backgroundColor = "white";
      configPanel.style.padding = "16px";
      configPanel.style.borderRadius = "2px";
      configPanel.style.boxShadow = "0 0 10px rgba(0, 0, 0, 0.2)";
      configPanel.style.maxWidth = "400px";
      configPanel.style.width = "100%";
      configPanel.style.maxHeight = "80vh";
      configPanel.style.height = "100%";
      configPanel.style.overflow = "auto";

      // Normalize bounds
      const normalizeBoundsConfig = document.createElement("div");
      const normalizeBoundsLabel = document.createElement("label");
      normalizeBoundsLabel.innerText = "Normalize Bounds";
      normalizeBoundsConfig.appendChild(normalizeBoundsLabel);
      const normalizeBoundsCheckbox = document.createElement("input");
      normalizeBoundsCheckbox.type = "checkbox";
      normalizeBoundsCheckbox.checked = this.normalizeBounds;
      normalizeBoundsCheckbox.addEventListener("change", () => {
        this.update({ normalizeBounds: normalizeBoundsCheckbox.checked });
      });

      normalizeBoundsConfig.appendChild(normalizeBoundsCheckbox);

      const axisConfig = document.createElement("div");
      const axisLabel = document.createElement("label");
      axisLabel.innerText = "Axis Color";
      axisConfig.appendChild(axisLabel);
      const axisColor = document.createElement("input");
      axisColor.type = "color";
      axisColor.value = this.options?.axis?.color ?? "#333";

      axisColor.addEventListener("input", () => {
        this.update({ axis: { color: axisColor.value } });
      });
      axisConfig.appendChild(axisColor);

      const gridConfig = document.createElement("div");
      const gridLabel = document.createElement("label");
      gridLabel.innerText = "Grid Color";
      gridConfig.appendChild(gridLabel);
      const gridColor = document.createElement("input");
      gridColor.type = "color";
      gridColor.value = this.options?.grid?.color ?? "#e0e0e0";
      gridColor.addEventListener("input", () => {
        this.update({ grid: { color: gridColor.value } });
      });
      gridConfig.appendChild(gridColor);

      const closeButton = document.createElement("button");
      closeButton.innerText = "Close";
      closeButton.style.position = "absolute";
      closeButton.style.top = "8px";
      closeButton.style.right = "8px";
      closeButton.style.padding = "8px";
      closeButton.style.border = "none";
      closeButton.style.borderRadius = "2px";
      closeButton.style.backgroundColor = "#f0f0f0";
      closeButton.style.cursor = "pointer";

      closeButton.addEventListener("click", () => {
        overlay.remove();
      });

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.remove();
      });

      /**
       * Loop over buffers and create config options for each
       */
      this.iterateBuffers((key, buffer) => {
        const bufferConfig = document.createElement("div");
        bufferConfig.style.marginTop = "16px";
        bufferConfig.style.marginBottom = "16px";
        bufferConfig.style.paddingTop = "16px";
        bufferConfig.style.paddingBottom = "16px";
        bufferConfig.style.border = "1px solid #f0f0f0";

        const bufferLabel = document.createElement("label");
        bufferLabel.innerText = key;
        bufferConfig.appendChild(bufferLabel);

        const bufferColor = document.createElement("input");
        bufferColor.type = "color";
        bufferColor.value = buffer.color || "#333";
        bufferColor.addEventListener("input", () => {
          this.updateBuffer(key, { color: bufferColor.value });
        });
        bufferConfig.appendChild(bufferColor);

        const bufferVisible = document.createElement("input");
        bufferVisible.type = "checkbox";
        bufferVisible.checked = buffer.visible !== false;
        bufferVisible.addEventListener("change", () => {
          this.updateBuffer(key, { visible: bufferVisible.checked });
        });
        bufferConfig.appendChild(bufferVisible);

        const localBufferVisible = document.createElement("input");
        localBufferVisible.type = "checkbox";
        localBufferVisible.checked =
          this.options?.localBufferOption?.[key]?.visible !== false;
        localBufferVisible.addEventListener("change", () => {
          this.update({
            localBufferOption: {
              ...this.options.localBufferOption,
              [key]: { visible: localBufferVisible.checked },
            },
          });
        });
        bufferConfig.appendChild(localBufferVisible);

        const bufferVisibleLabel = document.createElement("label");
        bufferVisibleLabel.innerText = "Visible";
        bufferConfig.appendChild(bufferVisibleLabel);

        configPanel.appendChild(bufferConfig);
      });

      /**
       * Append elements to the overlay
       */
      overlay.appendChild(configPanel);
      configPanel.appendChild(closeButton);
      configPanel.appendChild(normalizeBoundsConfig);
      configPanel.appendChild(axisConfig);
      configPanel.appendChild(gridConfig);

      document.body.appendChild(overlay);

      overlay.style.opacity = "1";
    });
  }

  setRenderMode(mode: "auto" | "manual"): void {
    if (!["auto", "manual"].includes(mode)) {
      console.error(
        `Invalid render mode (${mode}). Must be 'auto' or 'manual'.`
      );
      return;
    }
    this.renderMode = mode;
  }

  private debounce(fn: Function, delay: number): Function {
    let timeout: any;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  public getMousePlotPosition(event: MouseEvent): {
    x: number;
    y: number;
    scale: { x: number; y: number };
    plotOffsets: Record<string, { x: number; y: number }>;
  } {
    const plotOffsets: any = {};

    for (let [key, buffer] of this.buffers.entries()) {
      plotOffsets[key] = {
        x: buffer.null?.x ?? 0,
        y: buffer.null?.y ?? 0,
      };
    }
    if (!this.bounds) this.bounds = this.computeBounds();

    const range = {
      x: this.bounds.x.max - this.bounds.x.min,
      y: this.bounds.y.max - this.bounds.y.min,
    };

    const scale = {
      x: this.canvas.width / range.x,
      y: this.canvas.height / range.y,
    };

    const nullPosition = {
      x: this.bounds.x.min,
      y: this.bounds.y.min,
    };

    const boundingRect = this.canvas.getBoundingClientRect();

    const mousePosition = {
      x: event.clientX - boundingRect.left,
      y: event.clientY - boundingRect.top,
    };

    return {
      x: nullPosition.x + (mousePosition.x / this.canvas.width) * range.x,
      y: nullPosition.y + (1 - mousePosition.y / this.canvas.height) * range.y,
      scale,
      plotOffsets,
    };
  }
}
