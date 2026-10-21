import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/geometry/pipeline';
import { presets } from '../src/geometry/presets';
import { networkToJSON, parseNetwork, toCSV, toGLB, toOBJ } from '../src/geometry/io';
import { flattenPatch, flattenToSVG } from '../src/geometry/flatten';
import { repairNetwork } from '../src/geometry/repair';
import { buildSurface } from '../src/geometry/patches';
import { square } from './helpers';

describe('import and export', () => {
  const p = presets[0];
  const out = runPipeline(p.make());

  it('round-trips network JSON and rejects malformed input', () => {
    const n = p.make();
    expect(parseNetwork(networkToJSON(n))).toEqual(n);
    expect(() => parseNetwork('{"version":2,"curves":[]}')).toThrow(/version/);
    expect(() => parseNetwork('{"version":1,"curves":[{"id":"a","points":[[0,0]]}]}')).toThrow(/triples/);
  });

  it('writes an OBJ with every vertex and triangle', () => {
    const obj = toOBJ(out.surface, out.positions);
    const lines = obj.split('\n');
    expect(lines.filter((l) => l.startsWith('v ')).length).toBe(out.positions.length);
    expect(lines.filter((l) => l.startsWith('f ')).length).toBe(out.surface.triangles.length);
    expect(lines.filter((l) => l.startsWith('g ')).length).toBe(out.surface.patches.length);
  });

  it('writes a structurally valid GLB', () => {
    const glb = toGLB(out.surface, out.positions);
    const dv = new DataView(glb.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(glb.length);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)));
    expect(json.asset.version).toBe('2.0');
    expect(json.accessors[0].count).toBe(out.positions.length);
    const binLen = dv.getUint32(20 + jsonLen, true);
    expect(binLen).toBeGreaterThanOrEqual(json.buffers[0].byteLength);
    expect(glb.length % 4).toBe(0);
  });

  it('writes CSV with quoting', () => {
    expect(toCSV([{ a: 1, b: 'x,y' }])).toBe('a,b\n1,"x,y"\n');
  });
});

describe('flattening', () => {
  it('flattens a planar patch with no distortion', () => {
    const r = repairNetwork(square());
    const s = buildSurface(r.network, r.provenance.vertexOf, 6);
    const f = flattenPatch(s.patches[0].mesh.positions, s.patches[0].mesh.triangles);
    expect(f.maxEdgeDistortion).toBeLessThan(1e-9);
    expect(f.invertedTriangles).toBe(0);
    const svg = flattenToSVG(f, 'square');
    expect(svg).toContain('<svg');
    expect(svg).toContain('inverted triangles 0');
  });

  it('flattens a curved patch with reported, bounded distortion and lower stress than projection', () => {
    const out = runPipeline(presets.find((x) => x.id === 'curved-canopy')!.make());
    const g = out.surface.globalIndex[0];
    const P = g.map((gi) => out.positions[gi]);
    const f = flattenPatch(P, out.surface.patches[0].mesh.triangles);
    expect(f.invertedTriangles).toBe(0);
    expect(f.energyHistory.at(-1)!).toBeLessThan(f.energyHistory[0]);
    expect(f.meanEdgeDistortion).toBeLessThan(0.05);
  });
});
