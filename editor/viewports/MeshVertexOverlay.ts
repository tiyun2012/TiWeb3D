import { MeshEdgeRgba } from '@/engine/MeshEdgeGeometry';

export const MESH_VERTEX_COLORS = {
  base: { r: 0.66, g: 0.33, b: 0.97, a: 1.0 } satisfies MeshEdgeRgba,
  selected: { r: 1.0, g: 1.0, b: 0.0, a: 1.0 } satisfies MeshEdgeRgba,
  hovered: { r: 1.0, g: 0.78, b: 0.15, a: 1.0 } satisfies MeshEdgeRgba,
} as const;

/**
 * Reusable vertex-point overlay for mesh asset viewports.
 *
 * The host owns the position VBO. This overlay only owns a VAO and a compact
 * index buffer for selected vertices. Base vertices are rendered with
 * drawArrays so the source geometry is never duplicated.
 */
export class MeshVertexOverlay {
  private vao: WebGLVertexArrayObject | null = null;
  private selectedIbo: WebGLBuffer | null = null;
  private selectedCount = 0;
  private selectedUseUint32 = false;

  init(gl: WebGL2RenderingContext, positionBuffer: WebGLBuffer): boolean {
    this.dispose(gl);

    const vao = gl.createVertexArray();
    const selectedIbo = gl.createBuffer();
    if (!vao || !selectedIbo) {
      if (vao) gl.deleteVertexArray(vao);
      if (selectedIbo) gl.deleteBuffer(selectedIbo);
      return false;
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, selectedIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(0), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);

    this.vao = vao;
    this.selectedIbo = selectedIbo;
    return true;
  }

  updateSelected(
    gl: WebGL2RenderingContext,
    vertexIds: Iterable<number>,
    vertexCount: number,
  ): void {
    if (!this.vao || !this.selectedIbo) return;

    const values: number[] = [];
    let maxIndex = 0;
    const seen = new Set<number>();
    for (const id of vertexIds) {
      if (!Number.isInteger(id) || id < 0 || id >= vertexCount || seen.has(id)) continue;
      seen.add(id);
      values.push(id);
      maxIndex = Math.max(maxIndex, id);
    }

    this.selectedUseUint32 = maxIndex > 65535 || vertexCount > 65535;
    const data = this.selectedUseUint32 ? new Uint32Array(values) : new Uint16Array(values);
    this.selectedCount = data.length;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.selectedIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }

  drawAll(
    gl: WebGL2RenderingContext,
    lineProgram: WebGLProgram,
    mvp: Float32Array,
    vertexCount: number,
    color: MeshEdgeRgba,
    pointSize: number,
  ): void {
    if (!this.vao || vertexCount <= 0) return;
    this.beginPointPass(gl, lineProgram, mvp, color, pointSize);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, vertexCount);
    this.endPointPass(gl);
  }

  drawSelected(
    gl: WebGL2RenderingContext,
    lineProgram: WebGLProgram,
    mvp: Float32Array,
    color: MeshEdgeRgba,
    pointSize: number,
  ): void {
    if (!this.vao || this.selectedCount <= 0) return;
    this.beginPointPass(gl, lineProgram, mvp, color, pointSize);
    gl.bindVertexArray(this.vao);
    gl.drawElements(
      gl.POINTS,
      this.selectedCount,
      this.selectedUseUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );
    this.endPointPass(gl);
  }

  drawHovered(
    gl: WebGL2RenderingContext,
    lineProgram: WebGLProgram,
    mvp: Float32Array,
    vertexIndex: number | null,
    vertexCount: number,
    color: MeshEdgeRgba,
    pointSize: number,
  ): void {
    if (!this.vao || vertexIndex == null || vertexIndex < 0 || vertexIndex >= vertexCount) return;
    this.beginPointPass(gl, lineProgram, mvp, color, pointSize);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, vertexIndex, 1);
    this.endPointPass(gl);
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.selectedIbo) gl.deleteBuffer(this.selectedIbo);
    this.vao = null;
    this.selectedIbo = null;
    this.selectedCount = 0;
    this.selectedUseUint32 = false;
  }

  private beginPointPass(
    gl: WebGL2RenderingContext,
    lineProgram: WebGLProgram,
    mvp: Float32Array,
    color: MeshEdgeRgba,
    pointSize: number,
  ): void {
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), pointSize);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 1);
    gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), color.r, color.g, color.b, color.a);

    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    if (color.a < 0.999) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  private endPointPass(gl: WebGL2RenderingContext): void {
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
  }
}
