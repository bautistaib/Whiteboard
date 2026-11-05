import {
  AmbientLight, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Euler, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import type { DiceRoll } from "../dice";
import { planMotion, sampleMotion, visualDice, type VisualDie } from "./animation";
import { buildDieShape, restingQuaternion, type DieShape } from "./geometry";

const COLORS = ["#8dc5ff", "#e4b2ff", "#ffd38c", "#89e5cb", "#ffabc3"];
const CELL_SIZE = 128;

function faceLabels(die: VisualDie, shape: DieShape): string[] {
  return shape.faces.map((face, i) => {
    if (die.kind === "tens") return String(i * 10).padStart(2, "0");
    if (die.kind === "units") return String(i);
    if (die.kind === "custom") return face.normal.z > 0.9 ? `${die.value}` : "";
    return String(i + 1);
  });
}

function numberTexture(die: VisualDie, shape: DieShape): CanvasTexture {
  const columns = Math.ceil(Math.sqrt(shape.faces.length));
  const rows = Math.ceil(shape.faces.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * CELL_SIZE;
  canvas.height = rows * CELL_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear la textura de los dados.");
  ctx.fillStyle = "#f4f7ff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101a30";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  faceLabels(die, shape).forEach((label, i) => {
    const x = (i % columns + 0.5) * CELL_SIZE;
    const y = (Math.floor(i / columns) + 0.5) * CELL_SIZE;
    ctx.font = `700 ${die.sides === 10 ? 38 : 44}px system-ui, sans-serif`;
    ctx.fillText(label, x, y, 80);
    if (label === "6" || label === "9") ctx.fillRect(x - 9, y + 22, 18, 2);
    if (die.kind === "custom" && label) {
      ctx.font = "600 15px system-ui, sans-serif";
      ctx.fillText(`d${die.sides}`, x, y - 36);
    }
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear la sombra de los dados.");
  const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.7)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

export interface DiceScene {
  render: (elapsed: number) => void;
  dispose: () => void;
}

/** WebGL solo representa la tirada recibida: no calcula ni cambia resultados. */
export function createDiceScene(host: HTMLElement, roll: DiceRoll, onContextLost: () => void): DiceScene {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  const camera = new OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -12, 24);
  camera.lookAt(0, 0, 0);
  scene.add(new AmbientLight(0xffffff, 2.1));
  const light = new DirectionalLight(0xffefd8, 3.2);
  light.position.set(-6, -5, 12);
  scene.add(light);
  const rim = new DirectionalLight(0x86b7ff, 1.5);
  rim.position.set(5, 4, 6);
  scene.add(rim);

  const dice = visualDice(roll);
  const shapes = new Map<number, DieShape>();
  const edges = new Map<number, EdgesGeometry>();
  const textures = new Map<string, CanvasTexture>();
  const shadowMap = shadowTexture();
  const shadowGeometry = new PlaneGeometry(2.8, 2.8);
  const edgeMaterial = new LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3 });
  const animated = dice.map((die, index) => {
    const shapeKey = die.kind === "custom" ? 0 : die.sides;
    let shape = shapes.get(shapeKey);
    if (!shape) {
      shape = buildDieShape(shapeKey);
      shapes.set(shapeKey, shape);
      edges.set(shapeKey, new EdgesGeometry(shape.geometry, 1));
    }
    const textureKey = `${die.kind}:${die.kind === "custom" ? `${die.sides}:${die.value}` : die.sides}`;
    let texture = textures.get(textureKey);
    if (!texture) {
      texture = numberTexture(die, shape);
      textures.set(textureKey, texture);
    }
    const color = new Color(COLORS[die.termIndex % COLORS.length]);
    const material = new MeshStandardMaterial({ map: texture, color, roughness: 0.32, metalness: 0.16 });
    const group = new Group();
    group.add(new Mesh(shape.geometry, material));
    group.add(new LineSegments(edges.get(shapeKey), edgeMaterial));
    scene.add(group);
    const shadowMaterial = new MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false });
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.position.z = 0.005;
    scene.add(shadow);
    const faceIndex = die.kind === "custom" ? shape.faces.findIndex((f) => f.normal.z > 0.9)
      : die.kind === "standard" ? die.value - 1 : die.value;
    const motion = planMotion(roll.id, index, dice.length);
    return {
      group, shadow, material, shadowMaterial, color, shape, motion, die,
      resting: restingQuaternion(shape.faces[faceIndex], motion.twist),
    };
  });

  const resize = () => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const columns = Math.ceil(Math.sqrt(dice.length * 1.8));
    const rows = Math.ceil(dice.length / columns);
    const worldHeight = Math.max(6.5, rows * 2.5 + 1.5, (columns * 2.5 + 2) / aspect);
    camera.left = -worldHeight * aspect / 2;
    camera.right = worldHeight * aspect / 2;
    camera.top = worldHeight / 2;
    camera.bottom = -worldHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  let disposed = false;
  const onLost = (event: Event) => {
    event.preventDefault();
    if (!disposed) onContextLost();
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  const vertex = new Vector3();
  const spin = new Euler();
  const discardedColor = new Color("#707986");

  return {
    render(elapsed) {
      for (const item of animated) {
        const pose = sampleMotion(item.motion, elapsed);
        item.group.quaternion.copy(item.resting);
        spin.set(...pose.spin);
        item.group.rotateX(spin.x);
        item.group.rotateY(spin.y);
        item.group.rotateZ(spin.z);
        let bottom = Infinity;
        for (const point of item.shape.vertices) {
          bottom = Math.min(bottom, vertex.copy(point).applyQuaternion(item.group.quaternion).z);
        }
        item.group.position.set(pose.x, pose.y, -bottom + pose.height + 0.025);
        item.shadow.position.set(pose.x, pose.y, 0.005);
        item.shadow.scale.setScalar(1 + pose.height * 0.2);
        item.shadowMaterial.opacity = 0.65 / (1 + pose.height);
        item.material.color.copy(item.color);
        if (pose.settled && !item.die.kept) item.material.color.lerp(discardedColor, 0.8);
      }
      renderer.render(scene, camera);
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      for (const item of animated) {
        item.material.dispose();
        item.shadowMaterial.dispose();
      }
      for (const shape of shapes.values()) shape.geometry.dispose();
      for (const edge of edges.values()) edge.dispose();
      for (const texture of textures.values()) texture.dispose();
      edgeMaterial.dispose();
      shadowGeometry.dispose();
      shadowMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
