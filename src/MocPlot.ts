import { Buffer } from "./interfaces/Buffer";
import { PlotOptions } from "./interfaces/Options";

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

  constructor(
    parent: HTMLElement,
    buffers: Map<string, Buffer> = new Map<string, Buffer>(),
    options?: PlotOptions
  ) {
    this.parent = parent;
    this.buffers = buffers;
    this.options = options || {};

    this.normalizeBounds = this.options.normalizeBounds ?? false;
    this.bounds = this.options.bounds ?? undefined;

    this.followTimer = null;

    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.lastMousePos = { x: 0, y: 0 };

    this.canvas = document.createElement("canvas");

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
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

    this.resizeCanvas();

    /**
     * Create function to handle resize so we can clean it up later
     */
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.render();
    });

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

    this.render();
  }

  /**
   * Start following the latest data in the buffers.
   */
  startFollowingLatest(): void {
    const followFunc = () => {
      if (this.isDragging) return;
      this.updateBoundsToLatestData();
      this.render();
    };

    if (this.followTimer) {
      clearInterval(this.followTimer);
    }

    this.followTimer = setInterval(
      followFunc,
      this.options.follow?.interval || 1000
    );

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
      this.bounds.x.max += this.options?.follow?.jumpOffsetX || 0;
    }

    this.bounds.x.max =
      latestBounds.x.max + (this.options?.follow?.jumpOffsetX || 0);

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

    for (let buffer of this.buffers.values()) {
      const data = buffer.data;
      if (!data || data.length === 0) continue;

      const xNull = buffer.null?.x || 0;
      const yNull = buffer.null?.y || 0;

      const xValues = data.map((point) => point.x);
      const yValues = data.map((point) => point.y);

      const bufferXMin = Math.min(...xValues, xNull);
      const bufferXMax = Math.max(...xValues, xNull);
      const bufferYMin = Math.min(...yValues, yNull);
      const bufferYMax = Math.max(...yValues, yNull);

      if (bufferXMin < xMin) xMin = bufferXMin;
      if (bufferXMax > xMax) xMax = bufferXMax;
      if (bufferYMin < yMin) yMin = bufferYMin;
      if (bufferYMax > yMax) yMax = bufferYMax;
    }

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
      this.drawBuffer(buffer);
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
    const bounds = {
      x: {
        min: this.bounds?.x?.min || 0,
        max: this.bounds?.x?.max || this.canvas.width,
      },
      y: {
        min: this.bounds?.y?.min || 0,
        max: this.bounds?.y?.max || this.canvas.height,
      },
    };

    const range = {
      x: bounds.x.max - bounds.x.min,
      y: bounds.y.max - bounds.y.min,
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
      x: (0 - bounds.x.min) * scale.x,
      y: this.canvas.height - (0 - bounds.y.min) * scale.y,
    };

    this.drawTicks(ctx, {
      axis: "x",
      min: bounds.x.min,
      max: bounds.x.max,
      zeroPos: zeroPosition.y,
      scale: scale.x,
      canvasSize: this.canvas.width,
      tickInterval: this.options?.axis?.tick?.interval?.x,
      tickLength: 5,
      tickLabelOffset: 8,
      textAlign: "center",
      textBaseline: "top",
      grid: this.options?.grid?.show,
    });

    this.drawTicks(ctx, {
      axis: "y",
      min: bounds.y.min,
      max: bounds.y.max,
      zeroPos: zeroPosition.x,
      scale: scale.y,
      canvasSize: this.canvas.height,
      tickInterval: this.options?.axis?.tick?.interval?.y,
      tickLength: 5,
      tickLabelOffset: 8,
      textAlign: "right",
      textBaseline: "middle",
      grid: this.options?.grid?.show,
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
  drawBuffer(buffer: Buffer): void {
    const data = buffer.data;
    const lines = buffer.lines;
    const parametrics = buffer.parametrics;
    if (!data || data.length === 0) return;

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
      for (let point of data) {
        if (point.x < bounds.x.min) bounds.x.min = point.x;
        if (point.x > bounds.x.max) bounds.x.max = point.x;
        if (point.y < bounds.y.min) bounds.y.min = point.y;
        if (point.y > bounds.y.max) bounds.y.max = point.y;
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
      x: this.canvas.width / range.x,
      y: this.canvas.height / range.y,
    };

    ctx.beginPath();
    ctx.moveTo(
      (data[0].x - nullPosition.x - bounds.x.min) * scale.x,
      this.canvas.height - (data[0].y - nullPosition.y - bounds.y.min) * scale.y
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

    if (lines && Array.isArray(lines)) {
      for (let line of lines) {
        if (typeof line.func !== "function") continue;

        ctx.beginPath();
        ctx.strokeStyle = line.color || "black";
        ctx.lineWidth = line.width || 2;

        const step = (this.options?.function?.stepScalar || 1) / scale.x;
        for (
          let x = bounds.x.min + nullPosition.x;
          x < bounds.x.max + nullPosition.x;
          x += step
        ) {
          const y = line.func(x);
          const adjusted = {
            x: x - nullPosition.x - bounds.x.min,
            y: y - nullPosition.y - bounds.y.min,
          };
          if (adjusted.x < 0 || adjusted.x > this.canvas.width) continue;
          if (adjusted.y < 0 || adjusted.y > this.canvas.height) continue;

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
            adjusted.x < bounds.x.min ||
            adjusted.x > bounds.x.max ||
            adjusted.y < bounds.y.min ||
            adjusted.y > bounds.y.max
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
    this.render();
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

    this.render();
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
    if (options.discardInterval) {
      /**
       * Clear existing interval if it exists
       */
      clearInterval(buffer.discardInterval);
    }

    /**
     * Set new interval for discarding data
     */
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

    this.render();
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
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = "grabbing";

    if (this.options?.follow?.disableOnInteraction) {
      this.stopFollowingLatest();
    }
  }

  /**
   * Handle mouse move events for dragging.
   */
  onMouseMove(event: MouseEvent): void {
    if (this.isDragging && this.bounds) {
      const delta = {
        x: event.clientX - this.dragStart.x,
        y: event.clientY - this.dragStart.y,
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

      this.render();
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

    const mousePosition = {
      x: event.clientX,
      y: event.clientY,
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

    this.render();

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
   * Reset the view to fit all the data in the buffers.
   */
  resetView(): void {
    this.bounds = this.computeBounds();
    this.resizeCanvas();
    this.render();
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

    this.render();
  }

  /**
   * Render a configuration button.
   */
  renderConfig(): void {
    this.parent.style.position = "relative";

    const configButton = document.createElement("button");
    configButton.innerText = "Config";
    configButton.style.position = "absolute";
    configButton.style.top = "8px";
    configButton.style.right = "8px";

    configButton.addEventListener("click", () => {
      console.log(this);
    });

    this.parent.appendChild(configButton);
  }
}
