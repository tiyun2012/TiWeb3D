import { MeshEdgeIndexData, MeshEdgeRgba } from '@/engine/MeshEdgeGeometry';

/**
 * Reusable GPU index overlay for authored mesh polygon edges in asset viewports.
 * The position VBO remains owned by the host mesh renderer; this class only owns
 * the edge VAO/index buffer and the common draw contract.
 */
export class MeshEdgeOverlay {
  private vao: WebGLVertexArrayObject | null = null;
  private ibo: WebGLBuffer | null = null;
  private data: MeshEdgeIndexData | null = null;

  init(
    gl: WebGL2RenderingContext,
    positionBuffer: WebGLBuffer,
    data: MeshEdgeIndexData,
    usage: number = gl.DYNAMIC_DRAW,
  ): boolean {
    this.dispose(gl);

    const vao = gl.createVertexArray();
    const ibo = gl.createBuffer();
    if (!vao || !ibo) {
      if (vao) gl.deleteVertexArray(vao);
      if (ibo) gl.deleteBuffer(ibo);
      return false;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, usage);
    gl.bindVertexArray(null);

    this.vao = vao;
    this.ibo = ibo;
    this.data = data;
    return true;
  }

  update(gl: WebGL2RenderingContext, data: MeshEdgeIndexData, usage: number = gl.DYNAMIC_DRAW): void {
    if (!this.ibo || !this.vao) return;
    this.data = data;
    // ELEMENT_ARRAY_BUFFER binding belongs to the currently bound VAO in WebGL2.
    // Bind our own VAO while updating so we never replace a host mesh VAO's IBO.
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, usage);
    gl.bindVertexArray(null);
  }

  draw(
    gl: WebGL2RenderingContext,
    lineProgram: WebGLProgram,
    mvp: Float32Array,
    color: MeshEdgeRgba,
  ): void {
    if (!this.vao || !this.data || this.data.indices.length === 0) return;

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0.0);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);
    gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), color.r, color.g, color.b, color.a);

    // Overlay geometry should test against the shaded mesh but must not write
    // its own depth. Otherwise the dim topology cage can block a selected-edge
    // pass drawn at exactly the same depth.
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);

    const needsBlend = color.a < 0.999;
    if (needsBlend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.bindVertexArray(this.vao);
    gl.drawElements(
      gl.LINES,
      this.data.indices.length,
      this.data.useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );

    if (needsBlend) gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.ibo) gl.deleteBuffer(this.ibo);
    this.vao = null;
    this.ibo = null;
    this.data = null;
  }
}
