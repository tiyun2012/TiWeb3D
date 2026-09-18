import type { MeshFaceRgba, MeshFaceTriangleIndexData } from '@/engine/MeshFaceGeometry';

/**
 * Filled logical-face highlight pass for asset viewports.
 *
 * The host mesh owns vertex positions. This overlay only owns a compact IBO
 * containing triangles mapped to selected/hovered logical faces.
 */
export class MeshFaceOverlay {
  private vao: WebGLVertexArrayObject | null = null;
  private ibo: WebGLBuffer | null = null;
  private data: MeshFaceTriangleIndexData | null = null;

  init(
    gl: WebGL2RenderingContext,
    positionBuffer: WebGLBuffer,
    data: MeshFaceTriangleIndexData,
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

  update(
    gl: WebGL2RenderingContext,
    data: MeshFaceTriangleIndexData,
    usage: number = gl.DYNAMIC_DRAW,
  ): void {
    if (!this.vao || !this.ibo) return;
    this.data = data;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, usage);
    gl.bindVertexArray(null);
  }

  draw(
    gl: WebGL2RenderingContext,
    lineProgram: WebGLProgram,
    mvp: Float32Array,
    color: MeshFaceRgba,
  ): void {
    if (!this.vao || !this.data || this.data.indices.length === 0) return;

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0.0);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);
    gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), color.r, color.g, color.b, color.a);

    // Highlight only the visible surface. Pull the translucent pass slightly
    // toward the camera to avoid z-fighting with the shaded mesh while keeping
    // depth testing intact so back-side faces do not bleed through.
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);

    gl.bindVertexArray(this.vao);
    gl.drawElements(
      gl.TRIANGLES,
      this.data.indices.length,
      this.data.useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );

    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
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
