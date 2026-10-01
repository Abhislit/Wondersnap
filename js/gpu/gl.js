export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  const ext = {
    colorFloat: gl.getExtension('EXT_color_buffer_float'),
    floatLinear: gl.getExtension('OES_texture_float_linear'),
  };
  if (!ext.colorFloat) {
    throw new Error('EXT_color_buffer_float is required for GPU particle simulation.');
  }

  return {
    gl,
    info: {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      transformFeedback: gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS),
    },
  };
}

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    const numbered = source
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(3, ' ')} | ${line}`)
      .join('\n');
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed (${label}):\n${log}\n\n${numbered}`);
  }
  return shader;
}

export function createProgram(gl, vertexSource, fragmentSource, label = 'program') {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}.frag`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed (${label}): ${log}`);
  }

  const uniforms = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  const attribs = {};
  const attribCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attribCount; i++) {
    const info = gl.getActiveAttrib(program, i);
    attribs[info.name] = gl.getAttribLocation(program, info.name);
  }

  return { program, uniforms, attribs, label };
}

export function createBuffer(gl, target, data, usage) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  if (typeof data === 'number') gl.bufferData(target, data, usage);
  else gl.bufferData(target, data, usage);
  return buffer;
}

export function createDataTexture(gl, width, height, data = null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0,
    gl.RGBA, gl.FLOAT, data,
  );
  return texture;
}

export function textureExtent(count) {
  const size = Math.ceil(Math.sqrt(count));
  return { width: size, height: size };
}
