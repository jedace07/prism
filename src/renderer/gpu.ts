// SPDX-License-Identifier: Apache-2.0
const shader = `
struct Transform {
  view: vec2f, size: vec2f, pan: vec2f, flip: vec2f,
  scale: f32, angle: f32, padding: vec2f,
};
@group(0) @binding(0) var<uniform> transform: Transform;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var imageTexture: texture_2d<f32>;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Vertex {
  var vertices = array<vec2f, 4>(vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5), vec2f(0.5, 0.5));
  let point = vertices[index];
  let scaled = point * transform.size * transform.scale;
  let c = cos(transform.angle); let s = sin(transform.angle);
  let rotated = vec2f(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y) + transform.pan;
  var result: Vertex;
  result.position = vec4f(rotated.x / transform.view.x * 2.0, -rotated.y / transform.view.y * 2.0, 0.0, 1.0);
  result.uv = point * transform.flip + vec2f(0.5);
  return result;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  let color = textureSample(imageTexture, imageSampler, input.uv);
  // Canvas composition expects premultiplied alpha; source textures are straight alpha.
  return vec4f(color.rgb * color.a, color.a);
}`;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software rasterizer|software adapter|microsoft basic render/i;
export interface GPUOptions {
  allowSoftware?: boolean; readback?: boolean;
  onChange?: (gpu: GPUCanvas) => void; onError?: (error: Error) => void;
}
export class GPUCanvas {
  width = 0; height = 0; scale = 1; pan = { x: 0, y: 0 }; rotation = 0;
  flip: [number, number] = [1, 1]; fitMode = true; nearest = false;
  viewWidth = 1; viewHeight = 1; lost = false;
  readonly renderer: string;
  readonly vendor: string;
  readonly software: boolean;
  readonly maxTextureSize: number;
  private readonly context: GPUCanvasContext;
  private readonly uniformBuffer: GPUBuffer;
  private readonly samplers: [GPUSampler, GPUSampler];
  private readonly observer: ResizeObserver;
  private texture: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private scheduled: number | null = null;
  private disposed = false;
  private readonly onChange: (gpu: GPUCanvas) => void;
  private readonly onError: (error: Error) => void;

  static async create(canvas: HTMLCanvasElement, options: GPUOptions = {}): Promise<GPUCanvas> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable in this Electron build or display session. Update your GPU driver and restart Prism.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available. Update your GPU driver. On Linux, drivers outside Chromium’s supported set may require --experimental-webgpu.');
    const info = adapter.info;
    const software = info.isFallbackAdapter || SOFTWARE.test(`${info.vendor} ${info.architecture} ${info.device} ${info.description}`);
    if (software && !options.allowSoftware) throw new Error('WebGPU selected a software adapter. Hardware rendering is required; use --allow-software-rendering only for an explicit fallback.');
    const maxTextureSize = Math.min(16384, adapter.limits.maxTextureDimension2D);
    const device = await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: maxTextureSize } });
    try {
      const format = navigator.gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({ label: 'Prism image shaders', code: shader });
      const messages = await module.getCompilationInfo();
      const errors = messages.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(`WebGPU shader compilation failed: ${errors.map(error => error.message).join('; ')}`);
      const pipeline = await device.createRenderPipelineAsync({
        label: 'Prism image pipeline', layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-strip' }
      });
      return new GPUCanvas(canvas, device, pipeline, format, info, software, options);
    } catch (error) { device.destroy(); throw error; }
  }

  private constructor(
    readonly canvas: HTMLCanvasElement, private readonly device: GPUDevice,
    private readonly pipeline: GPURenderPipeline, private readonly format: GPUTextureFormat,
    info: GPUAdapterInfo, software: boolean, private readonly options: GPUOptions
  ) {
    this.onChange = options.onChange || (() => {}); this.onError = options.onError || (() => {});
    this.renderer = info.description || [info.vendor, info.architecture, info.device].filter(Boolean).join(' ') || 'WebGPU adapter';
    this.vendor = info.vendor; this.software = software; this.maxTextureSize = device.limits.maxTextureDimension2D;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create the WebGPU canvas.');
    this.context = context;
    context.configure({ device, format, alphaMode: 'premultiplied', colorSpace: 'srgb', usage: GPUTextureUsage.RENDER_ATTACHMENT | (options.readback ? GPUTextureUsage.COPY_SRC : 0) });
    this.uniformBuffer = device.createBuffer({ label: 'Prism transforms', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.samplers = [device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' })];
    device.lost.then(info => this.fail(new Error(`The WebGPU device was lost (${info.reason}). ${info.message} Restart Prism to restore rendering.`)));
    device.addEventListener('uncapturederror', event => { event.preventDefault(); this.fail(new Error(`WebGPU error: ${event.error.message}`)); });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); const rect = canvas.getBoundingClientRect();
      this.zoom(Math.exp(-event.deltaY * (event.deltaMode === 1 ? .045 : .002)), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    }, { passive: false });
    let drag: { x: number; y: number; pan: { x: number; y: number } } | null = null;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 1) return;
      drag = { x: event.clientX, y: event.clientY, pan: { ...this.pan } }; canvas.setPointerCapture(event.pointerId); canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      this.fitMode = false; this.pan = { x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y }; this.requestDraw();
    });
    const endDrag = () => { drag = null; canvas.classList.remove('grabbing'); };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('dblclick', () => this.fitMode ? this.actualSize() : this.fit());
  }
  private fail(error: Error): void {
    if (this.disposed || this.lost) return;
    this.lost = true;
    if (this.scheduled !== null) cancelAnimationFrame(this.scheduled);
    this.scheduled = null; this.onError(error);
  }
  resize(): void {
    if (this.lost || this.disposed) return;
    const rect = this.canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    this.viewWidth = Math.max(1, rect.width); this.viewHeight = Math.max(1, rect.height);
    this.canvas.width = Math.max(1, Math.min(this.maxTextureSize, Math.round(rect.width * dpr)));
    this.canvas.height = Math.max(1, Math.min(this.maxTextureSize, Math.round(rect.height * dpr)));
    if (this.fitMode) this.fit(); else this.requestDraw();
  }
  async setBitmap(bitmap: ImageBitmap, displayWidth = bitmap.width, displayHeight = bitmap.height, reset = true): Promise<void> {
    this.device.pushErrorScope('validation'); this.device.pushErrorScope('out-of-memory');
    let thrown: unknown;
    try { this.upload(bitmap, bitmap.width, bitmap.height); } catch (error) { thrown = error; }
    // Pop both scopes before awaiting so concurrent preview requests cannot mix scopes.
    const errors = await Promise.all([this.device.popErrorScope(), this.device.popErrorScope()]);
    if (thrown) throw thrown;
    const error = errors.find(Boolean);
    if (error) throw new Error(`WebGPU could not upload the preview: ${error.message}`);
    this.width = displayWidth; this.height = displayHeight;
    if (reset) { this.rotation = 0; this.flip = [1, 1]; this.fit(); } else this.requestDraw();
  }
  setFrame(frame: VideoFrame): void {
    this.upload(frame, frame.displayWidth, frame.displayHeight); this.requestDraw();
  }
  private upload(source: ImageBitmap | VideoFrame, width: number, height: number): void {
    if (this.lost || this.disposed) throw new Error('WebGPU device unavailable. Restart Prism.');
    if (width < 1 || height < 1 || width > this.maxTextureSize || height > this.maxTextureSize || width * height > 32000000) throw new Error('Image exceeds the WebGPU texture or preview memory limit.');
    if (!this.texture || width !== this.texture.width || height !== this.texture.height) {
      const previous = this.texture;
      this.texture = this.device.createTexture({ label: 'Prism image', size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.updateBindings(); previous?.destroy();
    }
    this.device.queue.copyExternalImageToTexture({ source, flipY: false }, { texture: this.texture, premultipliedAlpha: false, colorSpace: 'srgb' }, [width, height]);
  }
  private updateBindings(): void {
    this.bindGroup = this.texture ? this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.samplers[this.nearest ? 1 : 0] },
        { binding: 2, resource: this.texture.createView() }
      ]
    }) : null;
  }
  clear(): void { this.width = 0; this.height = 0; this.texture?.destroy(); this.texture = null; this.bindGroup = null; this.requestDraw(); }
  fit(): void {
    this.fitMode = true; this.pan = { x: 0, y: 0 };
    const odd = Math.abs(this.rotation % 2) === 1;
    this.scale = Math.min((this.viewWidth - 72) / (odd ? this.height : this.width), (this.viewHeight - 72) / (odd ? this.width : this.height), 1) || 1;
    this.scale = Math.max(.0001, this.scale); this.requestDraw();
  }
  actualSize(): void { this.fitMode = false; this.scale = 1; this.pan = { x: 0, y: 0 }; this.requestDraw(); }
  zoom(factor: number, x = 0, y = 0): void {
    if (!this.width) return;
    this.fitMode = false;
    const next = Math.min(64, Math.max(.0001, this.scale * factor)); const ratio = next / this.scale;
    this.pan = { x: x - (x - this.pan.x) * ratio, y: y - (y - this.pan.y) * ratio }; this.scale = next; this.requestDraw();
  }
  rotate(direction = 1): void { this.rotation = (this.rotation + direction + 4) % 4; if (this.fitMode) this.fit(); else this.requestDraw(); }
  flipHorizontal(): void { this.flip[0] *= -1; this.requestDraw(); }
  setNearest(enabled: boolean): void { this.nearest = enabled; this.updateBindings(); this.requestDraw(); }
  requestDraw(): void {
    if (this.lost || this.disposed || this.scheduled !== null) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = null;
      try { this.draw(); } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  private encode(encoder: GPUCommandEncoder, target: GPUTexture): void {
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([this.viewWidth, this.viewHeight, this.width, this.height, this.pan.x, this.pan.y, ...this.flip, this.scale, this.rotation * Math.PI / 2, 0, 0]));
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    if (this.width && this.bindGroup) { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bindGroup); pass.draw(4); }
    pass.end();
  }
  draw(): void {
    if (this.lost || this.disposed) return;
    const encoder = this.device.createCommandEncoder(); this.encode(encoder, this.context.getCurrentTexture());
    this.device.queue.submit([encoder.finish()]); this.onChange(this);
  }
  /** CI only: copy an actual rendered texel to a mapped buffer. Coordinates are centered, Y up. */
  async readPixel(x: number, y: number): Promise<number[]> {
    if (!this.options.readback || this.lost) throw new Error('WebGPU readback is only available during a live smoke test.');
    const sx = this.canvas.width / this.viewWidth, sy = this.canvas.height / this.viewHeight;
    const px = Math.floor(this.canvas.width / 2 + x * sx), py = Math.floor(this.canvas.height / 2 - y * sy);
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) throw new Error('Readback point is outside the canvas.');
    const buffer = this.device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder(), target = this.context.getCurrentTexture();
      this.encode(encoder, target);
      encoder.copyTextureToBuffer({ texture: target, origin: [px, py] }, { buffer, bytesPerRow: 256 }, [1, 1]);
      this.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
      const pixel = Array.from(new Uint8Array(buffer.getMappedRange()).subarray(0, 4));
      if (this.format.startsWith('bgra')) [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
      return pixel;
    } finally { if (buffer.mapState === 'mapped') buffer.unmap(); buffer.destroy(); }
  }
  loseDeviceForTest(): void { if (this.options.readback) this.device.destroy(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.observer.disconnect();
    if (this.scheduled !== null) cancelAnimationFrame(this.scheduled);
    this.texture?.destroy(); this.uniformBuffer.destroy(); this.context.unconfigure(); this.device.destroy();
  }
}
