import type { MeshEdgeRgba } from '@/engine/MeshEdgeGeometry';

/** Dynamic GL_LINES overlay used for face/vertex normal visualization. */
export class MeshNormalOverlay {
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private vertexCount = 0;

  init(gl: WebGL2RenderingContext): boolean {
    this.dispose(gl);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      return false;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.vbo = vbo;
    return true;
  }

  update(gl: WebGL2RenderingContext, lineVertices: Float32Array): void {
    if (!this.vbo) return;
    this.vertexCount = Math.floor(lineVertices.length / 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, lineVertices, gl.DYNAMIC_DRAW);
  }

  draw(gl: WebGL2RenderingContext, lineProgram: WebGLProgram, mvp: Float32Array, color: MeshEdgeRgba): void {
    if (!this.vao || this.vertexCount === 0) return;
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0.0);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);
    gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), color.r, color.g, color.b, color.a);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    if (color.a < 0.999) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
    if (color.a < 0.999) gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    this.vao = null;
    this.vbo = null;
    this.vertexCount = 0;
  }
}
