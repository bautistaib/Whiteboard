import {
  BoxGeometry, BufferGeometry, DodecahedronGeometry, Float32BufferAttribute,
  IcosahedronGeometry, OctahedronGeometry, Quaternion, TetrahedronGeometry, Vector3,
} from "three";

export interface DieFace {
  vertices: Vector3[];
  center: Vector3;
  normal: Vector3;
  right: Vector3;
  up: Vector3;
}

export interface DieShape {
  geometry: BufferGeometry;
  faces: DieFace[];
  vertices: Vector3[];
}

function makeFace(vertices: Vector3[]): DieFace {
  const center = vertices.reduce((sum, vertex) => sum.add(vertex), new Vector3()).divideScalar(vertices.length);
  const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
  if (normal.dot(center) < 0) normal.negate();
  const right = Math.abs(normal.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  right.addScaledVector(normal, -right.dot(normal)).normalize();
  const up = normal.clone().cross(right);
  vertices.sort((a, b) => {
    const da = a.clone().sub(center), db = b.clone().sub(center);
    return Math.atan2(da.dot(up), da.dot(right)) - Math.atan2(db.dot(up), db.dot(right));
  });
  return { vertices, center, normal, right, up };
}

/** Unir triángulos coplanares para que el d12 tenga 12 caras, no 36. */
function facesOf(source: BufferGeometry): DieFace[] {
  const flat = source.index ? source.toNonIndexed() : source;
  const positions = flat.getAttribute("position");
  const groups: { normal: Vector3; distance: number; vertices: Map<string, Vector3> }[] = [];
  for (let i = 0; i < positions.count; i += 3) {
    const vertices = [0, 1, 2].map((j) => new Vector3().fromBufferAttribute(positions, i + j));
    const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
    const distance = normal.dot(vertices[0]);
    let face = groups.find((f) => f.normal.dot(normal) > 0.99999 && Math.abs(f.distance - distance) < 0.00001);
    if (!face) {
      face = { normal, distance, vertices: new Map() };
      groups.push(face);
    }
    for (const vertex of vertices) face.vertices.set(vertex.toArray().map((n) => n.toFixed(5)).join(","), vertex);
  }
  if (flat !== source) flat.dispose();
  source.dispose();
  return groups.map((f) => makeFace([...f.vertices.values()]));
}

/** Trapezoedro pentagonal: diez caras de cometa planas. */
function d10Faces(): DieFace[] {
  const h = Math.tan(Math.PI / 10) ** 2;
  const ring = Array.from({ length: 10 }, (_, i) => new Vector3(Math.cos(i * Math.PI / 5), Math.sin(i * Math.PI / 5), i % 2 ? -h : h));
  return Array.from({ length: 10 }, (_, i) => makeFace([
    new Vector3(0, 0, i % 2 ? -1 : 1),
    ring[i].clone(), ring[(i + 1) % 10].clone(), ring[(i + 2) % 10].clone(),
  ]));
}

export function buildDieShape(sides: number): DieShape {
  const faces = sides === 10 ? d10Faces() : facesOf(
    sides === 4 ? new TetrahedronGeometry(1)
      : sides === 6 ? new BoxGeometry(1.45, 1.45, 1.45)
      : sides === 8 ? new OctahedronGeometry(1.12)
      : sides === 12 ? new DodecahedronGeometry(1.08)
      : sides === 20 ? new IcosahedronGeometry(1.12)
      : new BoxGeometry(1.65, 1.65, 0.5),
  );
  const columns = Math.ceil(Math.sqrt(faces.length));
  const rows = Math.ceil(faces.length / columns);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  for (const [index, face] of faces.entries()) {
    const extent = Math.max(...face.vertices.flatMap((v) => {
      const delta = v.clone().sub(face.center);
      return [Math.abs(delta.dot(face.right)), Math.abs(delta.dot(face.up))];
    })) * 1.04;
    for (let i = 1; i < face.vertices.length - 1; i++) {
      for (const vertex of [face.vertices[0], face.vertices[i], face.vertices[i + 1]]) {
        positions.push(...vertex.toArray());
        normals.push(...face.normal.toArray());
        const delta = vertex.clone().sub(face.center);
        uvs.push(
          (index % columns + 0.5 + delta.dot(face.right) / (2 * extent)) / columns,
          1 - (Math.floor(index / columns) + 0.5 - delta.dot(face.up) / (2 * extent)) / rows,
        );
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return { geometry, faces, vertices: faces.flatMap((f) => f.vertices) };
}

/** La cara elegida mira hacia arriba y su número queda derecho para la cámara. */
export function restingQuaternion(face: DieFace, twist = 0): Quaternion {
  const alignment = new Quaternion().setFromUnitVectors(face.normal, new Vector3(0, 0, 1));
  const up = face.up.clone().applyQuaternion(alignment);
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.atan2(up.x, up.y) + twist);
  return yaw.multiply(alignment);
}
