/** Import/export: network JSON, OBJ, binary glTF (GLB), metrics JSON/CSV. */
import type { CurveNetwork, CurveSegment, Vec3 } from './types';
import type { WeldedSurface } from './patches';

export function networkToJSON(net: CurveNetwork): string {
  return JSON.stringify(net, null, 2);
}

/** Parse and validate a CurveWeave network JSON document. Throws with a readable message. */
export function parseNetwork(text: string): CurveNetwork {
  const raw = JSON.parse(text) as Partial<CurveNetwork>;
  if (raw.version !== 1) throw new Error('unsupported or missing "version" (expected 1)');
  if (!Array.isArray(raw.curves)) throw new Error('"curves" must be an array');
  const ids = new Set<string>();
  const curves: CurveSegment[] = raw.curves.map((c, i) => {
    if (typeof c.id !== 'string' || !c.id) throw new Error(`curve ${i}: missing id`);
    if (ids.has(c.id)) throw new Error(`duplicate curve id ${c.id}`);
    ids.add(c.id);
    if (!Array.isArray(c.points) || c.points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((x) => typeof x !== 'number')))
      throw new Error(`curve ${c.id}: points must be [x, y, z] number triples`);
    const feature = c.feature === 'sharp' || c.feature === 'smooth' ? c.feature : 'unspecified';
    return { ...c, sourceId: typeof c.sourceId === 'string' ? c.sourceId : c.id, points: c.points as Vec3[], feature };
  });
  const patches = Array.isArray(raw.patches) ? raw.patches : [];
  for (const p of patches)
    if (typeof p.id !== 'string' || !Array.isArray(p.sides)) throw new Error('patches need an id and a sides array');
  const k = raw.constraints ?? { keepOpen: [], keepSeparate: [], planarPatches: [] };
  return {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : 'Imported network',
    curves,
    patches,
    constraints: {
      keepOpen: Array.isArray(k.keepOpen) ? k.keepOpen : [],
      keepSeparate: Array.isArray(k.keepSeparate) ? k.keepSeparate : [],
      planarPatches: Array.isArray(k.planarPatches) ? k.planarPatches : [],
    },
  };
}

/** Wavefront OBJ of the welded surface, one group per patch. */
export function toOBJ(s: WeldedSurface, positions: Vec3[], name = 'curveweave'): string {
  const lines = [`# CurveWeave export: ${name}`, `# ${positions.length} vertices, ${s.triangles.length} triangles`];
  for (const p of positions) lines.push(`v ${p[0]} ${p[1]} ${p[2]}`);
  let current = -1;
  s.triangles.forEach((t, i) => {
    if (s.trianglePatch[i] !== current) {
      current = s.trianglePatch[i];
      lines.push(`g ${s.patches[current].id}`);
    }
    lines.push(`f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`);
  });
  return lines.join('\n') + '\n';
}

/**
 * Minimal binary glTF 2.0: one mesh, one primitive per patch, sharing a
 * POSITION accessor; uint32 indices. Written by hand so it works in Node and
 * the browser without DOM APIs.
 */
export function toGLB(s: WeldedSurface, positions: Vec3[]): Uint8Array {
  const pos = new Float32Array(positions.flat());
  const min = [0, 1, 2].map((d) => Math.min(...positions.map((p) => p[d])));
  const max = [0, 1, 2].map((d) => Math.max(...positions.map((p) => p[d])));
  const perPatch: number[][] = s.patches.map(() => []);
  s.triangles.forEach((t, i) => perPatch[s.trianglePatch[i]].push(...t));
  const indexArrays = perPatch.map((a) => new Uint32Array(a));
  const bufferViews: object[] = [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }];
  const accessors: object[] = [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3', min, max }];
  let offset = pos.byteLength;
  const primitives = indexArrays.map((ia, i) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: ia.byteLength, target: 34963 });
    accessors.push({ bufferView: i + 1, componentType: 5125, count: ia.length, type: 'SCALAR' });
    offset += ia.byteLength;
    return { attributes: { POSITION: 0 }, indices: i + 1, mode: 4 };
  });
  const binLength = offset;
  const gltf = {
    asset: { version: '2.0', generator: 'CurveWeave' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'surface' }],
    meshes: [{ name: 'surface', primitives }],
    buffers: [{ byteLength: binLength }],
    bufferViews,
    accessors,
  };
  const enc = new TextEncoder();
  let json = enc.encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const jsonChunk = new Uint8Array(json.length + jsonPad).fill(0x20);
  jsonChunk.set(json);
  json = jsonChunk;
  const binPad = (4 - (binLength % 4)) % 4;
  const bin = new Uint8Array(binLength + binPad);
  bin.set(new Uint8Array(pos.buffer), 0);
  let o = pos.byteLength;
  for (const ia of indexArrays) {
    bin.set(new Uint8Array(ia.buffer), o);
    o += ia.byteLength;
  }
  const total = 12 + 8 + json.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(json, 20);
  dv.setUint32(20 + json.length, bin.length, true);
  dv.setUint32(24 + json.length, 0x004e4942, true); // 'BIN\0'
  out.set(bin, 28 + json.length);
  return out;
}

/** Flatten a nested metrics object into "a.b.c" -> value rows. */
export function flattenMetrics(obj: unknown, prefix = ''): [string, string | number | boolean][] {
  if (obj === null || obj === undefined) return [[prefix, '']];
  if (typeof obj !== 'object') return [[prefix, obj as string | number | boolean]];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => flattenMetrics(v, `${prefix}[${i}]`));
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flattenMetrics(v, prefix ? `${prefix}.${k}` : k),
  );
}

export function toCSV(rows: Record<string, string | number | boolean>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
