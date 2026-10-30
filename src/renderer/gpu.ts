// SPDX-License-Identifier: Apache-2.0
const vertexSource = `#version 300 es
in vec2 a_position;
uniform vec2 u_view;
uniform vec2 u_size;
uniform vec2 u_pan;
uniform vec2 u_flip;
uniform float u_scale;
uniform float u_angle;
out vec2 v_uv;
void main() {
  vec2 p = a_position * u_size * u_scale;
  float c = cos(u_angle), s = sin(u_angle);
  p = mat2(c, s, -s, c) * p;
  p += u_pan;
  gl_Position = vec4(p.x / u_view.x * 2.0, -p.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = a_position * u_flip + 0.5;
}`;
const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_uv;
out vec4 color;
void main() { color = texture(u_image, v_uv); }`;
const SOFTWARE =
  /swiftshader|llvmpipe|softpipe|software rasterizer|software adapter|microsoft basic render/i;

export interface GPUOptions {
  allowSoftware?: boolean;
  onChange?: (gpu: GPUCanvas) => void;
  onError?: (error: Error) => void;
}
export class GPUCanvas {
  canvas: HTMLCanvasElement;
  onChange: (gpu: GPUCanvas) => void;
  onError: (error: Error) => void;
  gl: WebGL2RenderingContext;
  renderer: string;
  vendor: string;
  software: boolean;
  maxTextureSize: number;
  program: WebGLProgram;
  texture: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation | null>;
  observer: ResizeObserver;
  width = 0;
  height = 0;
  scale = 1;
  pan = { x: 0, y: 0 };
  rotation = 0;
  flip: [number, number] = [1, 1];
  fitMode = true;
  nearest = false;
  viewWidth = 1;
  viewHeight = 1;
  lost = false;
  scheduled: number | null = null;
  constructor(
    canvas: HTMLCanvasElement,
    { allowSoftware = false, onChange = () => {}, onError = () => {} }: GPUOptions = {},
  ) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.onError = onError;
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.pan = { x: 0, y: 0 };
    this.rotation = 0;
    this.flip = [1, 1];
    this.fitMode = true;
    this.nearest = false;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: !allowSoftware,
    });
    if (!gl) {
      throw new Error(
        'Hardware WebGL2 is unavailable. Check your GPU driver and display session, then restart Prism. Use --allow-software-rendering only if you explicitly want a software fallback.',
      );
    }
    this.gl = gl;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    this.vendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    this.software = SOFTWARE.test(`${this.renderer} ${this.vendor}`);
    if (this.software && !allowSoftware) {
      throw new Error(
        `A software renderer was detected (${this.renderer}). Hardware GPU rendering is required. Check the GPU driver or explicitly launch with --allow-software-rendering.`,
      );
    }
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) {
        throw new Error('GPU shader allocation failed.');
      }
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'GPU shader compilation failed.');
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
      throw new Error('GPU program allocation failed.');
    }
    this.program = program;
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program) || 'GPU program linking failed.');
    }
    gl.useProgram(this.program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = Object.fromEntries(
      ['view', 'size', 'pan', 'flip', 'scale', 'angle', 'image'].map((name) => [
        name,
        gl.getUniformLocation(this.program, `u_${name}`),
      ]),
    );
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('GPU texture allocation failed.');
    }
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.setNearest(false);
    gl.uniform1i(this.uniforms.image, 0);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      this.onError(new Error('The GPU context was lost. Restart Prism to restore rendering.'));
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.zoom(
          Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.045 : 0.002)),
          event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2,
        );
      },
      { passive: false },
    );
    let drag: { x: number; y: number; pan: { x: number; y: number } } | null = null;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 1) {
        return;
      }
      drag = { x: event.clientX, y: event.clientY, pan: { ...this.pan } };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) {
        return;
      }
      this.fitMode = false;
      this.pan = { x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y };
      this.requestDraw();
    });
    const endDrag = () => {
      drag = null;
      canvas.classList.remove('grabbing');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('dblclick', () => (this.fitMode ? this.actualSize() : this.fit()));
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.viewWidth = Math.max(1, rect.width);
    this.viewHeight = Math.max(1, rect.height);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (this.fitMode) {
      this.fit();
    } else {
      this.requestDraw();
    }
  }
  setBitmap(
    bitmap: ImageBitmap,
    displayWidth = bitmap.width,
    displayHeight = bitmap.height,
    reset = true,
  ) {
    const { width, height } = bitmap;
    if (this.lost) {
      throw new Error('GPU context lost. Restart Prism.');
    }
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error('Image is larger than the GPU texture limit.');
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    if (gl.getError() !== gl.NO_ERROR) {
      throw new Error('The GPU could not allocate this image texture.');
    }
    this.width = displayWidth;
    this.height = displayHeight;
    if (reset) {
      this.rotation = 0;
      this.flip = [1, 1];
      this.fit();
    } else {
      this.requestDraw();
    }
  }
  setFrame(frame: VideoFrame) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    this.requestDraw();
  }
  clear() {
    this.width = 0;
    this.height = 0;
    this.requestDraw();
  }
  fit() {
    this.fitMode = true;
    this.pan = { x: 0, y: 0 };
    const odd = Math.abs(this.rotation % 2) === 1;
    this.scale =
      Math.min(
        (this.viewWidth - 72) / (odd ? this.height : this.width),
        (this.viewHeight - 72) / (odd ? this.width : this.height),
        1,
      ) || 1;
    this.scale = Math.max(0.0001, this.scale);
    this.requestDraw();
  }
  actualSize() {
    this.fitMode = false;
    this.scale = 1;
    this.pan = { x: 0, y: 0 };
    this.requestDraw();
  }
  zoom(factor: number, x = 0, y = 0) {
    if (!this.width) {
      return;
    }
    this.fitMode = false;
    const next = Math.min(64, Math.max(0.0001, this.scale * factor));
    const ratio = next / this.scale;
    this.pan = { x: x - (x - this.pan.x) * ratio, y: y - (y - this.pan.y) * ratio };
    this.scale = next;
    this.requestDraw();
  }
  rotate(direction = 1) {
    this.rotation = (this.rotation + direction + 4) % 4;
    if (this.fitMode) {
      this.fit();
    } else {
      this.requestDraw();
    }
  }
  flipHorizontal() {
    this.flip[0] *= -1;
    this.requestDraw();
  }
  setNearest(enabled: boolean) {
    this.nearest = enabled;
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, enabled ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, enabled ? gl.NEAREST : gl.LINEAR);
    this.requestDraw();
  }
  requestDraw() {
    if (this.scheduled) {
      return;
    }
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = null;
      this.draw();
    });
  }
  draw() {
    if (this.lost) {
      return;
    }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.width) {
      return;
    }
    gl.useProgram(this.program);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform2f(this.uniforms.view, this.viewWidth || 1, this.viewHeight || 1);
    gl.uniform2f(this.uniforms.size, this.width, this.height);
    gl.uniform2f(this.uniforms.pan, this.pan.x, this.pan.y);
    gl.uniform2f(this.uniforms.flip, ...this.flip);
    gl.uniform1f(this.uniforms.scale, this.scale);
    gl.uniform1f(this.uniforms.angle, (this.rotation * Math.PI) / 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.onChange(this);
  }
}
