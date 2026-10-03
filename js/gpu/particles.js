import { createProgram, createDataTexture, textureExtent } from './gl.js';
import { SIM_VERT, SIM_FRAG, DRAW_VERT, DRAW_FRAG, BACKGROUND_FRAG } from './shaders.js';

const FLOATS_PER_TEXEL = 4;

export class ParticleSystem {
  constructor(gl, count) {
    this.gl = gl;
    this.count = count;
    const extent = textureExtent(count);
    this.texWidth = extent.width;
    this.texHeight = extent.height;
    this.texels = this.texWidth * this.texHeight;

    this.sim = createProgram(gl, SIM_VERT, SIM_FRAG, 'sim');
    this.drawProgram = createProgram(gl, DRAW_VERT, DRAW_FRAG, 'draw');
    this.background = createProgram(gl, SIM_VERT, BACKGROUND_FRAG, 'background');

    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(this.sim.attribs.aUv);
    gl.vertexAttribPointer(this.sim.attribs.aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.emptyVao = gl.createVertexArray();

    const zero = new Float32Array(this.texels * FLOATS_PER_TEXEL);
    this.texPosA = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texPosB = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texVelA = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texVelB = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texTargetA = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texTargetB = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texGroup = createDataTexture(gl, this.texWidth, this.texHeight);
    this.texColor = createDataTexture(gl, this.texWidth, this.texHeight);

    this.fbos = [this.makeFbo(), this.makeFbo()];
    this.front = 0;
    this.zeroScratch = zero;

    this.targetA = new Float32Array(this.texels * FLOATS_PER_TEXEL);
    this.targetB = new Float32Array(this.texels * FLOATS_PER_TEXEL);
    this.groups = new Float32Array(this.texels * FLOATS_PER_TEXEL);
    this.colors = new Float32Array(this.texels * FLOATS_PER_TEXEL);

    this.viewProj = new Float32Array(16);
  }

  makeFbo() {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const attachments = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1];
    gl.drawBuffers(attachments);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, pos: null, vel: null };
  }

  bindFbo(slot, posTex, velTex) {
    const gl = this.gl;
    const { fbo } = this.fbos[slot];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, posTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Particle FBO incomplete: 0x${status.toString(16)}`);
    }
  }

  uploadTargets() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texTargetA);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight,
      gl.RGBA, gl.FLOAT, this.targetA,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.texTargetB);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight,
      gl.RGBA, gl.FLOAT, this.targetB,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.texGroup);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight,
      gl.RGBA, gl.FLOAT, this.groups,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.texColor);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight,
      gl.RGBA, gl.FLOAT, this.colors,
    );
  }

  seedFromSphere(radius = 3.2) {
    const gl = this.gl;
    const pos = new Float32Array(this.texels * FLOATS_PER_TEXEL);
    const vel = new Float32Array(this.texels * FLOATS_PER_TEXEL);
    for (let i = 0; i < this.texels; i++) {
      const o = i * FLOATS_PER_TEXEL;
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = radius * (0.55 + 0.45 * Math.random());
      const s = Math.sqrt(1 - u * u);
      pos[o] = r * s * Math.cos(theta);
      pos[o + 1] = r * s * Math.sin(theta);
      pos[o + 2] = r * u;
      pos[o + 3] = 1.0;
      vel[o] = (Math.random() - 0.5) * 0.2;
      vel[o + 1] = (Math.random() - 0.5) * 0.2;
      vel[o + 2] = (Math.random() - 0.5) * 0.2;
      vel[o + 3] = Math.random();
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texPosA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, pos);
    gl.bindTexture(gl.TEXTURE_2D, this.texVelA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, vel);
    gl.bindTexture(gl.TEXTURE_2D, this.texPosB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, pos);
    gl.bindTexture(gl.TEXTURE_2D, this.texVelB);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, vel);
  }

  copyTargetsToCurrent() {
    this.targetA.set(this.targetB);
    this.uploadTargets();
  }

  currentPosTexture() {
    return this.front === 0 ? this.texPosA : this.texPosB;
  }

  bindTexture(unit, texture, location) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  step(state) {
    const gl = this.gl;
    const back = 1 - this.front;
    const frontTex = this.currentPosTexture();
    const frontVel = this.front === 0 ? this.texVelA : this.texVelB;
    const backPos = back === 0 ? this.texPosA : this.texPosB;
    const backVel = back === 0 ? this.texVelA : this.texVelB;

    this.bindFbo(back, backPos, backVel);
    gl.viewport(0, 0, this.texWidth, this.texHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(this.sim.program);
    gl.bindVertexArray(this.quad);

    const u = this.sim.uniforms;
    this.bindTexture(0, frontTex, u.uPos);
    this.bindTexture(1, frontVel, u.uVel);
    this.bindTexture(2, this.texTargetA, u.uTargetA);
    this.bindTexture(3, this.texTargetB, u.uTargetB);
    this.bindTexture(4, this.texGroup, u.uGroup);

    gl.uniform1f(u.uDt, state.dt);
    gl.uniform1f(u.uTime, state.time);
    gl.uniform1f(u.uAssemble, state.assemble);
    gl.uniform1f(u.uMorph, state.morph);
    gl.uniform1f(u.uTurbulence, state.turbulence);
    gl.uniform1f(u.uExplode, state.explode);
    gl.uniform1f(u.uHighlightGroup, state.highlightGroup);
    gl.uniform1f(u.uHighlight, state.highlight);
    gl.uniform1f(u.uGrabGroup, state.grabGroup);
    gl.uniform3fv(u.uGrabVector, state.grabVector);
    gl.uniform1f(u.uGrab, state.grab);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);
    gl.bindVertexArray(null);
    this.front = back;
  }

  renderBackground(width, height, top, bottom) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.background.program);
    gl.bindVertexArray(this.quad);
    gl.uniform3fv(this.background.uniforms.uTop, top);
    gl.uniform3fv(this.background.uniforms.uBottom, bottom);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  draw(state) {
    const gl = this.gl;
    const u = this.drawProgram.uniforms;
    gl.useProgram(this.drawProgram.program);
    gl.bindVertexArray(this.emptyVao);

    this.bindTexture(0, this.currentPosTexture(), u.uPos);
    this.bindTexture(1, this.texColor, u.uColor);

    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniform1f(u.uPointScale, state.pointScale);
    gl.uniform1f(u.uTexSize, this.texWidth);
    gl.uniform1f(u.uEnergyFloor, state.energyFloor);
    gl.uniform1f(u.uSizeBoost, state.sizeBoost);
    gl.uniform1f(u.uExposure, state.exposure);
    gl.uniform1f(u.uMaxPointSize, state.maxPointSize);
    gl.uniform1f(u.uCoreExp, state.coreExp);
    gl.uniform1f(u.uHaloExp, state.haloExp);
    gl.uniform1f(u.uHaloWeight, state.haloWeight);
    gl.uniform1f(u.uHotBoost, state.hotBoost);
    gl.uniform1f(u.uCutaway, state.cutaway ? 1 : 0);
    gl.uniform3fv(u.uCutPlaneN, state.cutPlaneN);
    gl.uniform1f(u.uCutPlaneD, state.cutPlaneD);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
