import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CurveNetwork, FeatureType, Vec3 } from '../geometry/types';
import { parseEndpointKey } from '../geometry/types';
import type { PipelineOutput } from '../geometry/pipeline';
import { renderNormals } from '../geometry/mesh';
import { boundingBox, endpointPosition } from '../geometry/network';
import { degrees } from '../geometry/validate';
import type { Selection } from './state';

export interface ViewOptions {
  showInput: boolean;
  showCurves: boolean;
  showSurface: boolean;
  showWireframe: boolean;
  showJunctions: boolean;
  showCandidates: boolean;
  faired: boolean;
  colorBy: 'patch' | 'uniform';
}

export const featureColor: Record<FeatureType, string> = {
  sharp: '#ff6b4a',
  smooth: '#3fb6ff',
  unspecified: '#d7dde6',
};

function PatchMesh({
  positions,
  normals,
  triangles,
  color,
  wireframe,
  selected,
  onSelect,
}: {
  positions: Vec3[];
  normals: Vec3[];
  triangles: [number, number, number][];
  color: string;
  wireframe: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals.flat(), 3));
    g.setIndex(triangles.flat());
    return g;
  }, [positions, normals, triangles]);
  return (
    <group>
      <mesh
        geometry={geom}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <meshStandardMaterial
          color={selected ? '#ffd166' : color}
          side={THREE.DoubleSide}
          roughness={0.65}
          metalness={0.05}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {wireframe && (
        <mesh geometry={geom}>
          <meshBasicMaterial color="#0b1020" wireframe transparent opacity={0.25} />
        </mesh>
      )}
    </group>
  );
}

export function Viewport({
  input,
  out,
  view,
  selection,
  onSelect,
}: {
  input: CurveNetwork;
  out: PipelineOutput;
  view: ViewOptions;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const bb = useMemo(() => boundingBox(input.curves), [input]);
  const center: Vec3 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.min[2]];
  const diag = bb.diagonal || 1;
  const positions = view.faired ? out.positions : out.initialPositions;
  const normals = useMemo(() => renderNormals(out.surface, positions), [out.surface, positions]);
  const deg = useMemo(() => degrees(out.repair.graph), [out.repair.graph]);
  const selectedSource = selection?.kind === 'curve' ? selection.sourceId : null;
  const selectedCandidate = selection?.kind === 'candidate' ? out.repair.candidates.find((c) => c.id === selection.id) : undefined;
  const inputPos = (key: string) => {
    const e = parseEndpointKey(key);
    const c = input.curves.find((x) => x.id === e.curveId);
    return c ? endpointPosition(c, e.end) : undefined;
  };
  const r = diag * 0.006;

  return (
    <Canvas
      camera={{ position: [diag * 1.05, diag * 0.75, diag * 1.2], fov: 40, near: diag / 1000, far: diag * 20 }}
      onPointerMissed={() => onSelect(null)}
      data-testid="viewport"
    >
      <color attach="background" args={['#0e1424']} />
      <hemisphereLight args={['#dfe9ff', '#2a2f3a', 0.9]} />
      <directionalLight position={[diag, diag * 2, diag]} intensity={1.4} />
      <OrbitControls makeDefault target={[0, (bb.max[2] - bb.min[2]) / 2, 0]} />
      <gridHelper args={[diag * 2, 20, '#33415c', '#1f2940']} />
      {/* Network is z-up; rotate into three.js y-up. */}
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <group position={[-center[0], -center[1], -center[2]]}>
          {view.showSurface &&
            out.surface.patches.map((p, pi) => {
              const g = out.surface.globalIndex[pi];
              const hue = (pi * 0.618) % 1;
              const color = view.colorBy === 'patch' ? `hsl(${Math.round(hue * 360)}, 35%, 62%)` : '#b9c3d3';
              return (
                <PatchMesh
                  key={p.id}
                  positions={g.map((gi) => positions[gi])}
                  normals={normals[pi]}
                  triangles={p.mesh.triangles}
                  color={color}
                  wireframe={view.showWireframe}
                  selected={selection?.kind === 'patch' && selection.id === p.id}
                  onSelect={() => onSelect({ kind: 'patch', id: p.id })}
                />
              );
            })}
          {view.showInput &&
            input.curves.map((c) => (
              <Line key={`in-${c.id}`} points={c.points} color="#7c8597" lineWidth={1} dashed dashSize={diag / 150} gapSize={diag / 150} />
            ))}
          {view.showCurves &&
            out.repair.network.curves.map((c) => (
              <Line
                key={c.id}
                points={c.points}
                color={selectedSource === c.sourceId ? '#ffd166' : featureColor[c.feature]}
                lineWidth={selectedSource === c.sourceId ? 4 : 2.2}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: 'curve', sourceId: c.sourceId });
                }}
              />
            ))}
          {view.showJunctions &&
            out.repair.graph.vertices.map((v) => {
              const d = deg.get(v.id) ?? 0;
              return (
                <mesh key={v.id} position={v.position}>
                  <sphereGeometry args={[d === 1 ? r * 1.2 : r, 12, 8]} />
                  <meshBasicMaterial color={d === 1 ? '#ff4d6d' : d >= 3 ? '#ffd166' : '#9be564'} />
                </mesh>
              );
            })}
          {view.showCandidates &&
            out.repair.candidates
              .filter((c) => c.status !== 'merged' || c === selectedCandidate)
              .map((c) => {
                const a = inputPos(c.a);
                const b = inputPos(c.b);
                if (!a || !b) return null;
                const sel = c === selectedCandidate;
                return (
                  <group key={c.id}>
                    <Line
                      points={[a, b]}
                      color={sel ? '#ffd166' : c.status === 'suggested' ? '#ffa94d' : '#ff4d6d'}
                      lineWidth={sel ? 4 : 2.5}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: 'candidate', id: c.id });
                      }}
                    />
                    {[a, b].map((p, i) => (
                      <mesh key={i} position={p}>
                        <sphereGeometry args={[r * 0.8, 10, 6]} />
                        <meshBasicMaterial color={c.status === 'suggested' ? '#ffa94d' : '#ff4d6d'} />
                      </mesh>
                    ))}
                  </group>
                );
              })}
        </group>
      </group>
    </Canvas>
  );
}
