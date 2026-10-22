import * as THREE from "three";

export type Action = "idle" | "walk" | "dance" | "sit" | "quiet" | "sing" | "wave" | "eat";

export type PoseMsg = {
  k: "pose";
  x: number;
  z: number;
  r: number;
  a: Action;
  n: string;
  c: number;
};

export type CropSnap = { id: number; until: number };

export type Status = {
  food: number;
  singing: boolean;
  sitting: boolean;
  quiet: boolean;
  nearby: string;
};

export type WorldHooks = {
  onTalk: (name: string, line: string) => void;
  onToast: (msg: string) => void;
  onStatus: (s: Status) => void;
  onHarvest: (id: number, until: number) => void;
};

const ACTIONS: Action[] = ["idle", "walk", "dance", "sit", "quiet", "sing", "wave", "eat"];
const WALK_SPEED = 6.6;
const WORLD = 54;

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
    };
  }
}

type Rig = {
  pivot: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  notes: THREE.Group;
  chat: THREE.Sprite;
  chatUntil: number;
};

type Crop = {
  id: number;
  x: number;
  z: number;
  until: number;
  mesh: THREE.Object3D;
};

type Wanderer = {
  group: THREE.Group;
  x: number;
  z: number;
  tx: number;
  tz: number;
  speed: number;
  phase: number;
  kind: "person" | "cow" | "dog" | "hen";
  name?: string;
  lines?: string[];
  line: number;
};

type Remote = {
  id: string;
  group: THREE.Group;
  x: number;
  z: number;
  r: number;
  tx: number;
  tz: number;
  tr: number;
  action: Action;
  name: string;
};

type Collider = { x: number; z: number; r: number };

export function asAnon(raw: string, salt = ""): string {
  const clean = raw.trim().slice(0, 24);
  if (/^Anon \d{4}$/.test(clean)) return clean;
  let h = 2166136261;
  const s = `${salt}:${clean}`;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `Anon ${1000 + (Math.abs(h) % 9000)}`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintPlate(text: string, bg: string, fg: string, w = 512, h = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  g.clearRect(0, 0, w, h);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(12, 16, w - 24, h - 32, 36);
  g.fill();
  g.fillStyle = fg;
  g.font = "700 54px Nunito, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const label = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  g.fillText(label, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSprite(text: string, bg: string, fg: string, y: number): THREE.Sprite {
  const map = text ? paintPlate(text, bg, fg) : paintPlate(" ", bg, fg);
  const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.y = y;
  sprite.scale.set(text.length > 18 ? 3.4 : 2.4, 0.62, 1);
  sprite.renderOrder = 12;
  sprite.visible = text.length > 0;
  return sprite;
}

function setSprite(sprite: THREE.Sprite, text: string) {
  const prev = sprite.material.map;
  if (!text) {
    sprite.visible = false;
    return;
  }
  sprite.material.map = paintPlate(text, "rgba(36,28,22,0.82)", "#f6efe6");
  sprite.material.needsUpdate = true;
  prev?.dispose();
  sprite.visible = true;
  sprite.scale.set(Math.min(4.2, 1.3 + text.length * 0.11), 0.7, 1);
}

function softDot(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function grassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  g.fillStyle = "#4f9d42";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i += 1) {
    g.fillStyle = i % 3 === 0 ? "#3d8636" : i % 3 === 1 ? "#67b558" : "#2f6d32";
    const h = 3 + (i % 7);
    g.fillRect((i * 47) % 512, (i * 91) % 512, 2, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}

function makeAvatar(cloth: number, skin: number, name: string, showName: boolean): THREE.Group {
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  group.add(pivot);
  const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.72 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.7 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.78, 4, 8), clothMat);
  body.position.y = 0.86;
  body.castShadow = true;
  pivot.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), skinMat);
  head.position.y = 1.62;
  head.castShadow = true;
  pivot.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hairMat,
  );
  hair.position.y = 1.68;
  pivot.add(hair);
  const eyeGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.1, 0.04, 0.26);
  head.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.1, 0.04, 0.26);
  head.add(eyeR);
  const armGeo = new THREE.CapsuleGeometry(0.09, 0.42, 3, 6);
  const armL = new THREE.Mesh(armGeo, clothMat);
  armL.position.set(-0.46, 1.12, 0);
  pivot.add(armL);
  const armR = new THREE.Mesh(armGeo, clothMat);
  armR.position.set(0.46, 1.12, 0);
  pivot.add(armR);
  const notes = new THREE.Group();
  notes.position.y = 2.15;
  const noteMat = new THREE.MeshStandardMaterial({
    color: 0xffe08a,
    emissive: 0xe39b32,
    emissiveIntensity: 0.7,
    roughness: 0.45,
  });
  for (let i = 0; i < 3; i += 1) {
    notes.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), noteMat));
  }
  notes.visible = false;
  pivot.add(notes);
  if (showName && name) {
    const label = makeSprite(name, "rgba(36,28,22,0.78)", "#f6efe6", 2.35);
    group.add(label);
  }
  const chat = makeSprite("", "rgba(36,28,22,0.82)", "#f6efe6", showName ? 3.05 : 2.45);
  group.add(chat);
  const rig: Rig = { pivot, armL, armR, notes, chat, chatUntil: 0 };
  group.userData.rig = rig;
  return group;
}

function animateAvatar(group: THREE.Object3D, action: Action, elapsed: number) {
  const rig = group.userData.rig as Rig | undefined;
  if (!rig) return;
  const { pivot, armL, armR, notes } = rig;
  armL.rotation.set(0, 0, 0.18);
  armR.rotation.set(0, 0, -0.18);
  pivot.position.y = Math.sin(elapsed * 1.6 + 0.4) * 0.015;
  pivot.rotation.set(0, 0, 0);
  notes.visible = action === "sing";
  if (action === "walk") {
    const s = Math.sin(elapsed * 8);
    armL.rotation.x = s * 0.7;
    armR.rotation.x = -s * 0.7;
    pivot.position.y = Math.abs(Math.sin(elapsed * 8)) * 0.05;
  } else if (action === "dance") {
    pivot.position.y = Math.abs(Math.sin(elapsed * 10)) * 0.28;
    pivot.rotation.y = elapsed * 3.2;
    armL.rotation.z = 1.1;
    armR.rotation.z = -1.1;
    armL.rotation.x = Math.sin(elapsed * 8) * 0.4;
    armR.rotation.x = Math.cos(elapsed * 8) * 0.4;
  } else if (action === "sit" || action === "quiet") {
    pivot.position.y = -0.46;
    armL.rotation.x = action === "quiet" ? -1.15 : -0.7;
    armR.rotation.x = action === "quiet" ? -1.15 : -0.7;
    if (action === "quiet") {
      armL.rotation.z = 0.45;
      armR.rotation.z = -0.45;
    }
  } else if (action === "sing") {
    armL.rotation.x = -2.45;
    armR.rotation.x = -2.45;
    armL.rotation.z = 0.35 + Math.sin(elapsed * 3) * 0.12;
    armR.rotation.z = -0.35 - Math.sin(elapsed * 3) * 0.12;
    notes.children.forEach((note, i) => {
      note.position.set(
        Math.sin(elapsed * 2 + i) * 0.32,
        0.18 + ((elapsed * 0.45 + i * 0.33) % 1) * 0.45,
        Math.cos(elapsed * 2 + i) * 0.12,
      );
    });
  } else if (action === "wave") {
    armR.rotation.x = -2.15 + Math.sin(elapsed * 9) * 0.35;
    armR.rotation.z = -0.15;
  } else if (action === "eat") {
    armR.rotation.x = -1.45;
    pivot.rotation.x = 0.2;
  }
  if (rig.chatUntil > 0 && elapsed > rig.chatUntil) {
    rig.chat.visible = false;
    rig.chatUntil = 0;
  }
}

function showChat(group: THREE.Object3D, text: string, until: number) {
  const rig = group.userData.rig as Rig | undefined;
  if (!rig) return;
  setSprite(rig.chat, text);
  rig.chatUntil = until;
}

export function isPose(data: unknown): data is PoseMsg {
  if (!data || typeof data !== "object") return false;
  const m = data as Partial<PoseMsg>;
  return (
    m.k === "pose" &&
    typeof m.x === "number" &&
    typeof m.z === "number" &&
    typeof m.r === "number" &&
    typeof m.n === "string" &&
    typeof m.c === "number" &&
    typeof m.a === "string" &&
    ACTIONS.includes(m.a as Action) &&
    Math.abs(m.x) < 80 &&
    Math.abs(m.z) < 80
  );
}

const VILLAGERS: { name: string; color: number; skin: number; x: number; z: number; lines: string[] }[] = [
  {
    name: "Anon 1842",
    color: 0xc45c4a,
    skin: 0xf0c09a,
    x: 4.2,
    z: 3.4,
    lines: [
      "If you sing, the rest of us just walk over. That's the whole custom.",
      "Take what you need from the garden, and leave the roots.",
    ],
  },
  {
    name: "Anon 2904",
    color: 0x3d7ea6,
    skin: 0xc98a62,
    x: -5.4,
    z: 5.5,
    lines: [
      "A sprout hurries if you tend it. Harvest is the same button, closer in.",
      "Sit when you're tired. Nobody here is keeping score.",
    ],
  },
  {
    name: "Anon 3317",
    color: 0xd4a054,
    skin: 0xffd2b8,
    x: 8,
    z: -4,
    lines: [
      "The pond is for looking. The path goes around, not through.",
      "Share the basket if someone is standing near you.",
    ],
  },
  {
    name: "Anon 4520",
    color: 0x3e8f6e,
    skin: 0x8d5a3c,
    x: -3,
    z: -7,
    lines: [
      "West of the path is the garden. Eight plots, they grow back.",
      "A quiet minute at the fire counts as much as a song.",
    ],
  },
  {
    name: "Anon 5733",
    color: 0x8d4a6a,
    skin: 0xf0c09a,
    x: 2,
    z: 12,
    lines: [
      "Dance badly. It looks better when somebody else joins.",
      "Nobody here uses a real name. Be anyone kind.",
    ],
  },
  {
    name: "Anon 6408",
    color: 0xb85c38,
    skin: 0xc98a62,
    x: -12,
    z: 2,
    lines: [
      "The logs around the circle are for sitting. Stand close and press Sit.",
      "If the link is shared, other people show up as numbers, same as us.",
    ],
  },
  {
    name: "Anon 7186",
    color: 0x4a6670,
    skin: 0xffd2b8,
    x: 12,
    z: -14,
    lines: [
      "I like the far side of the pond in the afternoon. The reeds whisper.",
      "Eat before the basket gets heavy. Twelve is plenty.",
    ],
  },
  {
    name: "Anon 8621",
    color: 0x6b5b95,
    skin: 0xf0c09a,
    x: -8,
    z: 16,
    lines: [
      "The well is just for the look of it. The garden is the real work.",
      "When a song starts, come anyway. You don't have to know the words.",
    ],
  },
];

export class VillageWorld {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 240);
  private readonly timer = new THREE.Timer();
  private readonly hooks: WorldHooks;
  private readonly colliders: Collider[] = [];
  private readonly crops: Crop[] = [];
  private readonly people: Wanderer[] = [];
  private readonly critters: Wanderer[] = [];
  private readonly benches: { x: number; z: number }[] = [];
  private readonly remotes = new Map<string, Remote>();
  private readonly keys = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly camTarget = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly resolved = { x: 0, z: 0 };
  private qaKeys: Set<string> | null = null;
  private joyX = 0;
  private joyY = 0;
  private raf = 0;
  private dead = false;
  private elapsed = 0;
  private px = 0;
  private pz = 16;
  private facing = Math.PI;
  private yaw = 0;
  private speed = 0;
  private mode: "sing" | "sit" | "quiet" | null = null;
  private emote: "dance" | "wave" | "eat" | null = null;
  private emoteUntil = 0;
  private food: number;
  private greetTimer = 0;
  private nearby = "";
  private lastStatus = "";
  private aspect = 1;
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private forest: GainNode | null = null;
  private forestSources: AudioScheduledSourceNode[] = [];
  private forestReady = false;
  private heard = false;
  private songNext = 0;
  private songStep = 0;
  private fluteNext = 0;
  private forestDuck = false;
  private readonly singPhrase = [
    { f: 293.66, hold: 0.5 },
    { f: 329.63, hold: 0.5 },
    { f: 369.99, hold: 0.5 },
    { f: 440, hold: 0.78 },
    { f: 493.88, hold: 0.42 },
    { f: 440, hold: 0.42 },
    { f: 369.99, hold: 0.5 },
    { f: 329.63, hold: 0.96 },
    { f: 369.99, hold: 0.46 },
    { f: 440, hold: 0.46 },
    { f: 493.88, hold: 0.7 },
    { f: 587.33, hold: 0.46 },
    { f: 493.88, hold: 0.46 },
    { f: 440, hold: 0.5 },
    { f: 369.99, hold: 0.5 },
    { f: 293.66, hold: 1.2 },
  ];
  private readonly forestNotes = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25];
  private player: THREE.Group;
  private singingRing: THREE.Mesh;
  private fireLight: THREE.PointLight;
  private waterTime: { value: number };
  private leafTime: { value: number };
  private firePos: Float32Array;
  private flyPos: Float32Array;
  private pond = { x: 20, z: -10, r: 8.15 };
  private readonly name: string;
  private readonly color: number;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;
  private onFocusIn: () => void;
  private onClick: (e: MouseEvent) => void;
  private onResize: () => void;
  private onUnlock: () => void;
  private onVis: () => void;

  constructor(canvas: HTMLCanvasElement, hooks: WorldHooks, identity: { name: string; color: number }) {
    this.hooks = hooks;
    this.name = identity.name;
    this.color = identity.color;
    const savedFood = Number(sessionStorage.getItem("vibe-food") ?? "0");
    this.food = Number.isFinite(savedFood) ? Math.max(0, Math.min(12, Math.floor(savedFood))) : 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setClearColor(0x8ebfe0, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x8ebfe0);
    this.scene.fog = new THREE.Fog(0xc5d4c0, 58, 145);
    this.scene.add(new THREE.AmbientLight(0xfff4e8, 0.55));
    this.scene.add(new THREE.HemisphereLight(0xffe6c4, 0x3e7a3a, 0.72));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.5);
    sun.position.set(28, 42, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 8;
    sun.shadow.camera.far = 130;
    sun.shadow.camera.left = -48;
    sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 48;
    sun.shadow.camera.bottom = -48;
    sun.shadow.bias = -0.00035;
    this.scene.add(sun);

    this.waterTime = { value: 0 };
    this.leafTime = { value: 0 };
    this.firePos = new Float32Array(18 * 3);
    this.flyPos = new Float32Array(22 * 3);
    this.singingRing = new THREE.Mesh();
    this.fireLight = new THREE.PointLight();
    this.player = new THREE.Group();

    this.buildWorld();
    this.player = makeAvatar(this.color, 0xffd2b8, this.name, false);
    this.player.position.set(this.px, 0, this.pz);
    this.player.rotation.y = this.facing;
    this.scene.add(this.player);

    this.camera.position.set(0, 9, 30);
    this.scene.add(this.camera);
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    sunDisc.position.set(-9, 16, -42);
    this.camera.add(sunDisc);
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(6.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    halo.position.copy(sunDisc.position);
    this.camera.add(halo);

    this.timer.connect(document);
    this.resize();

    this.onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      this.keys.add(e.code);
    };
    this.onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.onFocusIn = () => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) this.keys.clear();
    };
    this.onClick = (e: MouseEvent) => this.pick(e);
    this.onResize = () => this.resize();
    this.onUnlock = () => this.ensureAudio();
    this.onVis = () => {
      if (document.visibilityState === "visible") void this.audio?.resume();
    };
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focusin", this.onFocusIn);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointerdown", this.onUnlock);
    window.addEventListener("keydown", this.onUnlock);
    document.addEventListener("visibilitychange", this.onVis);
    canvas.addEventListener("click", this.onClick);

    if (import.meta.env.DEV || new URLSearchParams(location.search).has("qa")) {
      window.__controlsTest = {
        getYaw: () => this.yaw,
        getSpeed: () => this.speed,
        setKeys: (codes: string[]) => {
          this.qaKeys = codes.length ? new Set(codes) : null;
          if (!codes.length) this.keys.clear();
        },
      };
    }

    void document.fonts?.ready.then(() => {
      if (this.dead) return;
      this.people.forEach((p) => {
        const label = p.group.children.find((c) => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
        if (label && p.name) setSprite(label, p.name);
      });
    });

    this.emitStatus();
    this.hooks.onToast("The garden is west. Tap once and the trees keep a quiet flute.");
    const loop = () => {
      if (this.dead) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.forestSources.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.audio?.close().catch(() => undefined);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("focusin", this.onFocusIn);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointerdown", this.onUnlock);
    window.removeEventListener("keydown", this.onUnlock);
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    if (window.__controlsTest) delete window.__controlsTest;
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        const mapped = m as THREE.Material & { map?: THREE.Texture | null };
        mapped.map?.dispose();
        m.dispose();
      }
    });
    this.renderer.dispose();
  }

  setJoy(x: number, y: number) {
    this.joyX = x;
    this.joyY = y;
  }

  getPose(): PoseMsg {
    return {
      k: "pose",
      x: this.px,
      z: this.pz,
      r: this.facing,
      a: this.currentAction(this.speed > 0.2),
      n: this.name,
      c: this.color,
    };
  }

  getCropSnapshot(): CropSnap[] {
    const now = Date.now();
    return this.crops.filter((c) => c.until > now).map((c) => ({ id: c.id, until: c.until }));
  }

  applyHarvest(id: number, until: number) {
    if (!Number.isFinite(id) || !Number.isFinite(until)) return;
    const crop = this.crops[id];
    if (!crop) return;
    crop.until = until;
  }

  applySnapshot(crops: CropSnap[]) {
    if (!Array.isArray(crops)) return;
    for (const row of crops) {
      if (!row || typeof row.id !== "number" || typeof row.until !== "number") continue;
      this.applyHarvest(row.id, row.until);
    }
  }

  upsertRemote(id: string, pose: PoseMsg) {
    let remote = this.remotes.get(id);
    const shown = asAnon(pose.n, id);
    if (!remote) {
      const group = makeAvatar(pose.c, 0xffd2b8, shown, true);
      group.position.set(pose.x, 0, pose.z);
      this.scene.add(group);
      remote = {
        id,
        group,
        x: pose.x,
        z: pose.z,
        r: pose.r,
        tx: pose.x,
        tz: pose.z,
        tr: pose.r,
        action: pose.a,
        name: shown,
      };
      this.remotes.set(id, remote);
      this.hooks.onToast(`${remote.name} stepped into the meadow.`);
    }
    remote.tx = pose.x;
    remote.tz = pose.z;
    remote.tr = pose.r;
    remote.action = pose.a;
    if (remote.name !== shown) {
      remote.name = shown;
      const label = remote.group.children.find((c) => c instanceof THREE.Sprite && c !== (remote.group.userData.rig as Rig).chat);
      if (label instanceof THREE.Sprite) setSprite(label, remote.name);
    }
  }

  setRemoteChat(id: string, text: string) {
    const remote = this.remotes.get(id);
    if (!remote) return;
    showChat(remote.group, text.slice(0, 80), this.elapsed + 4.8);
  }

  pulseHello(id: string) {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.action = "wave";
  }

  retainRemotes(ids: Set<string>) {
    for (const [id, remote] of this.remotes) {
      if (ids.has(id)) continue;
      this.scene.remove(remote.group);
      this.remotes.delete(id);
    }
  }

  nearestRemote(maxDist: number): { id: string; name: string } | null {
    let best: { id: string; name: string; d: number } | null = null;
    for (const remote of this.remotes.values()) {
      const d = Math.hypot(remote.x - this.px, remote.z - this.pz);
      if (d <= maxDist && (!best || d < best.d)) best = { id: remote.id, name: remote.name, d };
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  say(text: string) {
    showChat(this.player, text.slice(0, 80), this.elapsed + 4.8);
  }

  receiveFood(fromName: string) {
    this.food = Math.min(12, this.food + 1);
    this.persistFood();
    this.hooks.onToast(`${fromName} shares something from the garden.`);
    this.emitStatus();
  }

  doWave() {
    this.emote = "wave";
    this.emoteUntil = this.elapsed + 1.6;
    this.greetTimer = 8;
    this.hooks.onToast("You wave across the meadow.");
  }

  doSing() {
    this.ensureAudio();
    this.mode = this.mode === "sing" ? null : "sing";
    this.hooks.onToast(this.mode === "sing" ? "A small tune, if you want it." : "The song rests. The trees keep going.");
    this.emitStatus();
  }

  doDance() {
    this.emote = "dance";
    this.emoteUntil = this.elapsed + 2.6;
    this.hooks.onToast("You dance. Badly is allowed.");
  }

  doQuiet() {
    this.mode = this.mode === "quiet" ? null : "quiet";
    if (this.mode === "quiet") {
      const d = Math.hypot(this.px, this.pz);
      if (d > 0.4 && d < 16) this.facing = Math.atan2(-this.px, -this.pz);
    }
    this.hooks.onToast(this.mode === "quiet" ? "A quiet minute." : "You look up again.");
    this.emitStatus();
  }

  doSit() {
    if (this.mode === "sit") {
      this.mode = null;
      this.hooks.onToast("You stand.");
      this.emitStatus();
      return;
    }
    this.mode = "sit";
    let best: { x: number; z: number; d: number } | null = null;
    for (const bench of this.benches) {
      const d = Math.hypot(bench.x - this.px, bench.z - this.pz);
      if (d < 4.2 && (!best || d < best.d)) best = { ...bench, d };
    }
    if (best) {
      this.px = best.x;
      this.pz = best.z;
      this.facing = Math.atan2(-best.x, -best.z);
      this.player.position.set(this.px, 0, this.pz);
    }
    this.hooks.onToast(best ? "You sit on a log." : "You sit where you are.");
    this.emitStatus();
  }

  doEat() {
    if (this.food <= 0) {
      this.hooks.onToast("The basket is empty. The garden is west of the path.");
      return;
    }
    this.food -= 1;
    this.persistFood();
    this.emote = "eat";
    this.emoteUntil = this.elapsed + 1.3;
    this.hooks.onToast("You eat. It's simple, and enough.");
    this.emitStatus();
  }

  tryOffer(): { id: string; name: string } | null {
    if (this.food <= 0) {
      this.hooks.onToast("Nothing to share yet. Pick something first.");
      return null;
    }
    const near = this.nearestRemote(4.4);
    if (!near) {
      this.hooks.onToast("Stand close to someone if you want to share.");
      return null;
    }
    this.food -= 1;
    this.persistFood();
    this.emote = "wave";
    this.emoteUntil = this.elapsed + 1.2;
    this.hooks.onToast(`You offer food to ${near.name}.`);
    this.emitStatus();
    return near;
  }

  doHarvest() {
    const now = Date.now();
    let picked = 0;
    let tended = 0;
    for (const crop of this.crops) {
      if (Math.hypot(crop.x - this.px, crop.z - this.pz) > 4.1) continue;
      if (crop.until <= now) {
        crop.until = now + 20000;
        this.food = Math.min(12, this.food + 1);
        picked += 1;
        this.hooks.onHarvest(crop.id, crop.until);
      } else {
        crop.until = Math.max(now + 1500, crop.until - 8000);
        tended += 1;
        this.hooks.onHarvest(crop.id, crop.until);
      }
    }
    this.persistFood();
    if (picked) this.hooks.onToast(picked === 1 ? "You pick from the garden." : `You pick ${picked} from the garden.`);
    else if (tended) this.hooks.onToast(tended === 1 ? "You tend a sprout." : `You tend ${tended} sprouts.`);
    else this.hooks.onToast("Nothing in reach. The plots are west of the path.");
    this.emitStatus();
  }

  private persistFood() {
    sessionStorage.setItem("vibe-food", String(this.food));
  }

  private ensureAudio() {
    if (this.audio) {
      if (this.audio.state === "suspended") void this.audio.resume();
      this.startForest();
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    this.audio = ctx;
    this.master = master;
    if (ctx.state === "suspended") void ctx.resume();
    this.startForest();
    if (!this.heard) {
      this.heard = true;
      this.hooks.onToast("A quiet flute moves through the trees.");
    }
  }

  private startForest() {
    if (!this.audio || !this.master || this.forestReady) return;
    this.forestReady = true;
    const ctx = this.audio;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2.6);
    bus.connect(this.master);
    this.forest = bus;

    const seconds = 4;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = brown * 0.986 + white * 0.014;
      data[i] = brown * 7;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 160;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 640;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    const wind = ctx.createGain();
    wind.gain.value = 0.2;
    noise.connect(hp);
    hp.connect(lp);
    lp.connect(wind);
    wind.connect(bus);
    noise.start();
    lfo.start();
    this.forestSources.push(noise, lfo);
    this.fluteNext = ctx.currentTime + 1.4;
  }

  private playFlute(when: number, freq: number, dur: number, peak: number, dest: AudioNode) {
    const ctx = this.audio;
    if (!ctx || dur <= 0.05) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, when);
    const harm = ctx.createOscillator();
    harm.type = "triangle";
    harm.frequency.setValueAtTime(freq * 2, when);
    const g = ctx.createGain();
    const gh = ctx.createGain();
    const end = when + dur;
    const loud = Math.max(peak, 0.0002);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(loud, when + Math.min(0.11, dur * 0.28));
    g.gain.exponentialRampToValueAtTime(Math.max(loud * 0.42, 0.0002), when + dur * 0.58);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    gh.gain.setValueAtTime(0.0001, when);
    gh.gain.exponentialRampToValueAtTime(Math.max(loud * 0.07, 0.0002), when + 0.07);
    gh.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.62);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, when);
    vg.gain.linearRampToValueAtTime(freq * 0.0055, when + 0.22);
    vib.connect(vg);
    vg.connect(osc.frequency);
    osc.connect(g);
    g.connect(dest);
    harm.connect(gh);
    gh.connect(dest);
    const stop = end + 0.04;
    vib.start(when);
    vib.stop(stop);
    osc.start(when);
    osc.stop(stop);
    harm.start(when);
    harm.stop(stop);
  }

  private updateForest() {
    if (!this.audio || !this.forest) return;
    const t = this.audio.currentTime;
    if (this.fluteNext < t) this.fluteNext = t + 0.3;
    let guard = 0;
    while (this.fluteNext < t + 0.5 && guard < 2) {
      const freq = this.forestNotes[Math.floor(Math.random() * this.forestNotes.length)];
      const dur = 1.8 + Math.random() * 1.6;
      this.playFlute(this.fluteNext, freq, dur, 0.07 + Math.random() * 0.03, this.forest);
      if (Math.random() < 0.4) {
        const next = this.forestNotes[Math.floor(Math.random() * this.forestNotes.length)];
        this.playFlute(this.fluteNext + 0.7, next, dur * 0.75, 0.035, this.forest);
      }
      this.fluteNext += 3.4 + Math.random() * 4.4;
      guard += 1;
    }
  }

  private updateSong(singing: boolean) {
    if (!this.audio || !this.master) {
      this.songNext = 0;
      return;
    }
    if (!singing) {
      this.songNext = 0;
      if (this.forestDuck && this.forest) {
        this.forestDuck = false;
        this.forest.gain.setTargetAtTime(1, this.audio.currentTime, 0.45);
      }
      return;
    }
    if (this.audio.state === "suspended") void this.audio.resume();
    if (!this.forestDuck && this.forest) {
      this.forestDuck = true;
      this.forest.gain.setTargetAtTime(0.32, this.audio.currentTime, 0.25);
    }
    const t = this.audio.currentTime;
    if (this.songNext < t) this.songNext = t + 0.06;
    let guard = 0;
    while (this.songNext < t + 0.7 && guard < 8) {
      const note = this.singPhrase[this.songStep % this.singPhrase.length];
      this.songStep += 1;
      this.playFlute(this.songNext, note.f, Math.max(0.2, note.hold * 0.92), 0.16, this.master);
      this.songNext += note.hold;
      guard += 1;
    }
  }

  private currentAction(moving: boolean): Action {
    if (this.emote && this.elapsed < this.emoteUntil) return this.emote;
    this.emote = null;
    if (this.mode === "sing") return "sing";
    if (this.mode === "quiet") return "quiet";
    if (this.mode === "sit") return "sit";
    return moving ? "walk" : "idle";
  }

  private emitStatus() {
    const status: Status = {
      food: this.food,
      singing: this.mode === "sing",
      sitting: this.mode === "sit",
      quiet: this.mode === "quiet",
      nearby: this.nearby,
    };
    const key = JSON.stringify(status);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.hooks.onStatus(status);
  }

  private resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.aspect = w / Math.max(1, h);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private pick(e: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots: THREE.Object3D[] = [
      ...this.crops.map((c) => c.mesh),
      ...this.people.map((p) => p.group),
    ];
    const hits = this.raycaster.intersectObjects(roots, true);
    if (!hits.length) return;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.kind) obj = obj.parent;
    if (!obj) return;
    if (obj.userData.kind === "crop") {
      const crop = this.crops[obj.userData.id as number];
      if (!crop) return;
      if (Math.hypot(crop.x - this.px, crop.z - this.pz) > 7) {
        this.hooks.onToast("Walk closer to the plot.");
        return;
      }
      this.doHarvest();
      return;
    }
    if (obj.userData.kind === "npc") {
      const person = this.people.find((p) => p.group === obj);
      if (!person || !person.name || !person.lines) return;
      if (Math.hypot(person.x - this.px, person.z - this.pz) > 9) {
        this.hooks.onToast(`Walk closer to ${person.name}.`);
        return;
      }
      const line = person.lines[person.line % person.lines.length];
      person.line += 1;
      this.hooks.onTalk(person.name, line);
    }
  }

  private resolve(x: number, z: number, radius: number) {
    for (let n = 0; n < 2; n += 1) {
      for (const c of this.colliders) {
        const dx = x - c.x;
        const dz = z - c.z;
        const min = radius + c.r;
        const d = Math.hypot(dx, dz);
        if (d < min) {
          if (d < 0.0001) {
            x += min;
          } else {
            const push = (min - d) / d;
            x += dx * push;
            z += dz * push;
          }
        }
      }
      const pdx = x - this.pond.x;
      const pdz = z - this.pond.z;
      const pd = Math.hypot(pdx, pdz);
      const minP = this.pond.r + radius;
      if (pd < minP && pd > 0.0001) {
        const push = (minP - pd) / pd;
        x += pdx * push;
        z += pdz * push;
      }
    }
    this.resolved.x = Math.max(-WORLD, Math.min(WORLD, x));
    this.resolved.z = Math.max(-WORLD, Math.min(WORLD, z));
  }

  private anyoneSinging() {
    if (this.mode === "sing") return true;
    for (const remote of this.remotes.values()) if (remote.action === "sing") return true;
    return false;
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.elapsed += dt;
    this.waterTime.value = this.elapsed;
    this.leafTime.value = this.elapsed;

    const keys = this.qaKeys ?? this.keys;
    let ix = this.joyX;
    let iz = -this.joyY;
    if (keys.has("KeyW") || keys.has("ArrowUp")) iz -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) iz += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
    const mag = Math.hypot(ix, iz);
    const movingInput = mag > 0.08;
    if (movingInput && (this.mode === "sit" || this.mode === "quiet")) {
      this.mode = null;
      this.emitStatus();
    }
    if (movingInput && (this.emote === "dance" || this.emote === "eat")) this.emote = null;
    if (movingInput) {
      const clamped = Math.min(mag, 1);
      const nx = ix / mag;
      const nz = iz / mag;
      const nx1 = this.px + nx * WALK_SPEED * clamped * dt;
      const nz1 = this.pz + nz * WALK_SPEED * clamped * dt;
      this.resolve(nx1, nz1, 0.45);
      this.px = this.resolved.x;
      this.pz = this.resolved.z;
      this.facing = Math.atan2(nx, nz);
      this.speed = WALK_SPEED * clamped;
    } else {
      this.speed = 0;
    }
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    this.yaw = Math.atan2(-fx, -fz);

    const action = this.currentAction(movingInput);
    this.player.position.set(this.px, 0, this.pz);
    this.player.rotation.y = this.facing;
    animateAvatar(this.player, action, this.elapsed);

    const gather = this.anyoneSinging();
    this.singingRing.visible = gather;
    if (gather) this.singingRing.rotation.z += dt * 0.35;
    this.updateForest();
    this.updateSong(this.mode === "sing");
    this.fireLight.intensity = 14 + Math.sin(this.elapsed * 7) * 3;

    this.stepPeople(dt, gather);
    this.stepCritters(dt);
    this.stepRemotes(dt);
    this.stepFire();
    this.stepFlies();
    this.syncCrops();
    this.refreshNearby();

    const dist = this.aspect < 0.9 ? 15.5 : 12.2;
    const height = this.aspect < 0.9 ? 10.2 : 7.4;
    this.camTarget.set(this.px, height, this.pz + dist);
    const k = 1 - Math.exp(-dt * 4);
    this.camera.position.lerp(this.camTarget, k);
    this.look.set(this.px, 1.25, this.pz);
    this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
    this.greetTimer = Math.max(0, this.greetTimer - dt);
  }

  private refreshNearby() {
    const now = Date.now();
    let mature = 0;
    let sprouts = 0;
    for (const crop of this.crops) {
      if (Math.hypot(crop.x - this.px, crop.z - this.pz) > 4.1) continue;
      if (crop.until <= now) mature += 1;
      else sprouts += 1;
    }
    let next = "";
    if (mature) next = mature === 1 ? "A plot is ready to pick." : `${mature} plots are ready.`;
    else if (sprouts) next = "Tend a sprout to hurry it.";
    else if (this.nearestRemote(4.4)) next = "Close enough to share food.";
    else if (this.food > 0) next = `Basket ${this.food}. The garden is to the west.`;
    if (next !== this.nearby) {
      this.nearby = next;
      this.emitStatus();
    }
  }

  private syncCrops() {
    const now = Date.now();
    for (const crop of this.crops) {
      const growing = crop.until > now;
      const s = growing ? 0.22 : 1;
      crop.mesh.scale.setScalar(s);
    }
  }

  private stepPeople(dt: number, gather: boolean) {
    this.people.forEach((p, index) => {
      let tx = p.tx;
      let tz = p.tz;
      if (gather) {
        const ang = (index / this.people.length) * Math.PI * 2;
        tx = Math.cos(ang) * 8.3;
        tz = Math.sin(ang) * 8.3;
      }
      let dx = tx - p.x;
      let dz = tz - p.z;
      const len = Math.hypot(dx, dz);
      let moving = false;
      if (!gather && len < 0.8) {
        p.tx = p.x + (Math.random() - 0.5) * 14;
        p.tz = p.z + (Math.random() - 0.5) * 14;
        p.tx = Math.max(-40, Math.min(40, p.tx));
        p.tz = Math.max(-40, Math.min(40, p.tz));
      } else if (len > 0.45) {
        dx /= len;
        dz /= len;
        const sp = (gather ? p.speed * 1.8 : p.speed) * dt;
        p.x += dx * sp;
        p.z += dz * sp;
        p.group.rotation.y = Math.atan2(dx, dz);
        moving = true;
      } else if (gather) {
        p.group.rotation.y = Math.atan2(-p.x, -p.z);
      }
      p.group.position.set(p.x, 0, p.z);
      const pose: Action = gather && len < 1.2 ? "sing" : moving ? "walk" : "idle";
      animateAvatar(p.group, pose, this.elapsed + p.phase);
    });
  }

  private stepCritters(dt: number) {
    for (const a of this.critters) {
      if (a.kind === "dog" && this.greetTimer > 0) {
        a.tx = this.px + 0.8;
        a.tz = this.pz + 0.8;
      }
      let dx = a.tx - a.x;
      let dz = a.tz - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.7) {
        const home = a.kind === "hen" ? 6 : a.kind === "dog" ? 18 : 10;
        a.tx = a.x + (Math.random() - 0.5) * home;
        a.tz = a.z + (Math.random() - 0.5) * home;
        if (a.kind === "hen") {
          a.tx = Math.max(-36, Math.min(-16, a.tx));
          a.tz = Math.max(-16, Math.min(2, a.tz));
        } else {
          a.tx = Math.max(-48, Math.min(48, a.tx));
          a.tz = Math.max(-48, Math.min(48, a.tz));
        }
      } else {
        dx /= len;
        dz /= len;
        const step = a.speed * dt;
        let nx = a.x + dx * step;
        let nz = a.z + dz * step;
        const pdx = nx - this.pond.x;
        const pdz = nz - this.pond.z;
        if (Math.hypot(pdx, pdz) < this.pond.r + 0.4) {
          a.tx = a.x - dx * 4;
          a.tz = a.z - dz * 4;
        } else {
          a.x = nx;
          a.z = nz;
          a.group.rotation.y = Math.atan2(dx, dz);
        }
      }
      a.group.position.set(a.x, 0, a.z);
      if (a.kind === "hen") {
        a.group.rotation.x = Math.sin(this.elapsed * 7 + a.phase) > 0.65 ? 0.45 : 0;
      } else if (a.kind === "dog") {
        a.group.position.y = Math.abs(Math.sin(this.elapsed * 10 + a.phase)) * 0.05;
      }
    }
  }

  private stepRemotes(dt: number) {
    const k = 1 - Math.exp(-dt * 8);
    for (const remote of this.remotes.values()) {
      remote.x += (remote.tx - remote.x) * k;
      remote.z += (remote.tz - remote.z) * k;
      let d = remote.tr - remote.r;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      remote.r += d * k;
      remote.group.position.set(remote.x, 0, remote.z);
      remote.group.rotation.y = remote.r;
      animateAvatar(remote.group, remote.action, this.elapsed);
    }
  }

  private stepFire() {
    const pos = this.firePos;
    for (let i = 0; i < 18; i += 1) {
      let y = pos[i * 3 + 1] + 0.02 + (i % 5) * 0.004;
      if (y > 1.8) {
        pos[i * 3] = (Math.random() - 0.5) * 0.45;
        pos[i * 3 + 1] = 0.25;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.45;
      } else {
        pos[i * 3 + 1] = y;
      }
    }
    const points = this.scene.getObjectByName("fire") as THREE.Points | undefined;
    if (points) {
      (points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private stepFlies() {
    const pos = this.flyPos;
    for (let i = 0; i < 22; i += 1) {
      const s = this.elapsed * 0.35 + i;
      pos[i * 3] += Math.sin(s) * 0.01;
      pos[i * 3 + 1] = 1.2 + (Math.sin(s * 1.7) * 0.5 + 0.5) * 2.2;
      pos[i * 3 + 2] += Math.cos(s * 0.8) * 0.01;
    }
    const points = this.scene.getObjectByName("flies") as THREE.Points | undefined;
    if (points) {
      (points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private addCollider(x: number, z: number, r: number) {
    this.colliders.push({ x, z, r });
  }

  private buildWorld() {
    const rng = mulberry32(7);
    const grass = grassTexture();
    const groundMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.96 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const pathMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 1 });
    pathMat.polygonOffset = true;
    pathMat.polygonOffsetFactor = -1;
    const addPath = (x: number, z: number, w: number, l: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l), pathMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.025, z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    addPath(0, -2, 3.6, 44);
    addPath(2, 2, 36, 3.2);
    addPath(-22, -6, 16, 3);
    addPath(14, -4, 3.1, 16);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcbb59a, roughness: 0.82 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(6.7, 7.1, 0.28, 36), stoneMat);
    pad.position.y = 0.12;
    pad.receiveShadow = true;
    this.scene.add(pad);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(7.15, 0.22, 8, 40), stoneMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.28;
    this.scene.add(rim);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd56a,
      emissive: 0xe39b32,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    });
    this.singingRing = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.1, 8, 48), ringMat);
    this.singingRing.rotation.x = Math.PI / 2;
    this.singingRing.position.y = 0.18;
    this.singingRing.visible = false;
    this.scene.add(this.singingRing);

    const logMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.9 });
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + 0.35;
      const x = Math.cos(a) * 8.5;
      const z = Math.sin(a) * 8.5;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.7, 8), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = a;
      log.position.set(x, 0.32, z);
      log.castShadow = true;
      this.scene.add(log);
      this.benches.push({ x, z });
    }

    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3024, roughness: 0.9 });
    for (let i = 0; i < 3; i += 1) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.1, 6), wood);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i * Math.PI) / 3;
      log.position.y = 0.28;
      this.scene.add(log);
    }
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xff7a2a,
      emissive: 0xff5a1a,
      emissiveIntensity: 1.5,
      roughness: 1,
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 7), flameMat);
    flame.position.y = 0.7;
    this.scene.add(flame);
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.45, 6),
      new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd56a, emissiveIntensity: 1.2 }),
    );
    inner.position.y = 0.78;
    this.scene.add(inner);
    this.fireLight = new THREE.PointLight(0xff8a3a, 16, 18, 2);
    this.fireLight.position.set(0, 1.1, 0);
    this.scene.add(this.fireLight);

    for (let i = 0; i < 18; i += 1) {
      this.firePos[i * 3] = (Math.random() - 0.5) * 0.4;
      this.firePos[i * 3 + 1] = Math.random() * 1.2;
      this.firePos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    const fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute("position", new THREE.BufferAttribute(this.firePos, 3));
    const firePts = new THREE.Points(
      fireGeo,
      new THREE.PointsMaterial({
        color: 0xffb15a,
        size: 0.28,
        map: softDot(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.9,
      }),
    );
    firePts.name = "fire";
    this.scene.add(firePts);

    this.addPond();
    this.addHuts();
    this.addWell();
    this.addMarket();
    this.addFarm();
    this.addScatter(rng);
    this.addPeople();
    this.addCritters();
    this.addFlies();
  }

  private addPond() {
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.waterTime,
        uShallow: { value: new THREE.Color(0x6ec4d4) },
        uDeep: { value: new THREE.Color(0x1f6f86) },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = sin(position.x * 1.4 + uTime * 1.3) * 0.07 + cos(position.y * 1.2 + uTime) * 0.05;
          p.z += w;
          vWave = w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          float fres = smoothstep(0.1, 0.95, length(vUv - 0.5) * 2.0);
          vec3 col = mix(uShallow, uDeep, fres) + vWave;
          gl_FragColor = vec4(col, 0.9);
        }
      `,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(8, 40), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(this.pond.x, 0.06, this.pond.z);
    this.scene.add(water);
    const shore = new THREE.Mesh(
      new THREE.RingGeometry(8.05, 10.1, 40),
      new THREE.MeshStandardMaterial({ color: 0xe6d2a8, roughness: 1 }),
    );
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(this.pond.x, 0.03, this.pond.z);
    shore.receiveShadow = true;
    this.scene.add(shore);

    const reedMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.8 });
    const reedGeo = new THREE.ConeGeometry(0.08, 1.1, 5);
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 16);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < 18 && n < 16; i += 1) {
      const a = (i / 18) * Math.PI * 2;
      if (Math.cos(a) > 0.35 && Math.sin(a) < 0.2) continue;
      dummy.position.set(this.pond.x + Math.cos(a) * 8.5, 0.55, this.pond.z + Math.sin(a) * 8.5);
      dummy.scale.setScalar(0.8 + (i % 3) * 0.15);
      dummy.updateMatrix();
      reeds.setMatrixAt(n, dummy.matrix);
      n += 1;
    }
    reeds.count = n;
    this.scene.add(reeds);

    const lilyMat = new THREE.MeshStandardMaterial({ color: 0x3e8f4a, roughness: 0.7 });
    const bloomMat = new THREE.MeshStandardMaterial({ color: 0xf2b6c6, roughness: 0.5 });
    const pads: [number, number][] = [
      [17.2, -8.2],
      [21.5, -7.4],
      [23.2, -11.5],
      [18.4, -12.2],
      [22.4, -9.2],
    ];
    pads.forEach(([x, z], i) => {
      const padMesh = new THREE.Mesh(new THREE.CircleGeometry(0.48, 10), lilyMat);
      padMesh.rotation.x = -Math.PI / 2;
      padMesh.position.set(x, 0.1, z);
      this.scene.add(padMesh);
      if (i % 2 === 0) {
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), bloomMat);
        bloom.position.set(x, 0.2, z);
        this.scene.add(bloom);
      }
    });

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.95 });
    [
      [12.2, -6],
      [26.5, -14],
      [14.5, -14.5],
    ].forEach(([x, z], i) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55 + i * 0.1, 0), rockMat);
      rock.position.set(x, 0.28, z);
      rock.scale.y = 0.6;
      rock.castShadow = true;
      this.scene.add(rock);
      this.addCollider(x, z, 0.7);
    });
  }

  private addHuts() {
    const spots: [number, number, number][] = [
      [-16, 12, 0xe7d3b4],
      [15, 15, 0xf0ddc4],
      [-10, -22, 0xe4c8a4],
      [26, -16, 0xedd7b8],
    ];
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a4b2f, roughness: 0.86 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5c3b2e, roughness: 0.8 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xffe0a0,
      emissive: 0xffc46b,
      emissiveIntensity: 0.8,
    });
    spots.forEach(([x, z, color]) => {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(4.4, 2.3, 3.8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
      );
      wall.position.set(x, 1.2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.5, 1.8, 4), roofMat);
      roof.position.set(x, 3.05, z);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      this.scene.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.08), doorMat);
      door.position.set(x, 0.7, z + 1.92);
      this.scene.add(door);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), glowMat);
      win.position.set(x + 1.15, 1.4, z + 1.91);
      this.scene.add(win);
      this.addCollider(x, z, 2.5);
    });

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.8 });
    const clothColors = [0xf2efe9, 0xc45c4a, 0x3d7ea6];
    [-1, 1].forEach((side) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), poleMat);
      pole.position.set(-16 + side * 1.6, 1.1, 15.2);
      this.scene.add(pole);
    });
    const line = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.03), poleMat);
    line.position.set(-16, 2.05, 15.2);
    this.scene.add(line);
    clothColors.forEach((color, i) => {
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.55),
        new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }),
      );
      cloth.position.set(-17.1 + i * 1.05, 1.7, 15.2);
      this.scene.add(cloth);
    });
  }

  private addWell() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xb7ab9c, roughness: 0.9 });
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.9, 12), stone);
    well.position.set(-6, 0.45, 18);
    well.castShadow = true;
    this.scene.add(well);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 16),
      new THREE.MeshStandardMaterial({ color: 0x3d8ea3, roughness: 0.2, metalness: 0.15 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(-6, 0.92, 18);
    this.scene.add(water);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.85 });
    [-0.9, 0.9].forEach((dx) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.5, 6), wood);
      post.position.set(-6 + dx, 1.6, 18);
      this.scene.add(post);
    });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x8a4b2f }));
    cap.position.set(-6, 2.5, 18);
    cap.rotation.y = Math.PI / 4;
    this.scene.add(cap);
    this.addCollider(-6, 18, 1.35);
  }

  private addMarket() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4632, roughness: 0.85 });
    const posts: [number, number][] = [
      [16.2, 6.2],
      [19.4, 6.2],
      [16.2, 8.8],
      [19.4, 8.8],
    ];
    posts.forEach(([x, z]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.1, 0.18), wood);
      post.position.set(x, 1.05, z);
      post.castShadow = true;
      this.scene.add(post);
    });
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.12, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xc45c4a, roughness: 0.7 }),
    );
    awning.position.set(17.8, 2.15, 7.5);
    awning.castShadow = true;
    this.scene.add(awning);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xa9744a, roughness: 0.85 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.7), crateMat);
    crate.position.set(17.2, 0.3, 7.2);
    crate.castShadow = true;
    this.scene.add(crate);
    const fruitMat = new THREE.MeshStandardMaterial({ color: 0xd3543c, roughness: 0.55 });
    for (let i = 0; i < 4; i += 1) {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), fruitMat);
      fruit.position.set(17.05 + (i % 2) * 0.28, 0.68, 7.05 + Math.floor(i / 2) * 0.26);
      this.scene.add(fruit);
    }
    this.addCollider(17.8, 7.5, 1.9);
  }

  private addFarm() {
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x6b4634, roughness: 1 });
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8d6b45, roughness: 0.9 });
    const greens = new THREE.MeshStandardMaterial({ color: 0x3f8f45, roughness: 0.75 });
    const tomato = new THREE.MeshStandardMaterial({ color: 0xd3543c, roughness: 0.45 });
    const wheat = new THREE.MeshStandardMaterial({ color: 0xe2b656, roughness: 0.7 });
    const stem = new THREE.MeshStandardMaterial({ color: 0x3d6b32, roughness: 0.8 });
    const petal = new THREE.MeshStandardMaterial({ color: 0xee8cab, roughness: 0.5 });
    const yolk = new THREE.MeshStandardMaterial({ color: 0xffd56a, roughness: 0.45 });
    const kinds = [greens, tomato, wheat, petal];
    let id = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const x = -33 + col * 3.1;
        const z = -14 + row * 3.1;
        const soil = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 2.2), soilMat);
        soil.position.set(x, 0.06, z);
        soil.receiveShadow = true;
        this.scene.add(soil);
        const group = new THREE.Group();
        const kind = (row + col) % 4;
        if (kind === 0) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 6), kinds[0]);
          cone.position.y = 0.62;
          cone.castShadow = true;
          group.add(cone);
        } else if (kind === 1) {
          const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.45, 5), stem);
          stalk.position.y = 0.32;
          group.add(stalk);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), kinds[1]);
          ball.position.y = 0.62;
          ball.castShadow = true;
          group.add(ball);
        } else if (kind === 2) {
          for (let s = 0; s < 3; s += 1) {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.9, 5), kinds[2]);
            ear.position.set((s - 1) * 0.18, 0.55, 0);
            group.add(ear);
          }
        } else {
          const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 5), stem);
          stalk.position.y = 0.32;
          group.add(stalk);
          const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), kinds[3]);
          bloom.position.y = 0.66;
          group.add(bloom);
          const center = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), yolk);
          center.position.set(0, 0.72, 0.12);
          group.add(center);
        }
        group.position.set(x, 0, z);
        group.userData.kind = "crop";
        group.userData.id = id;
        this.scene.add(group);
        this.crops.push({ id, x, z, until: 0, mesh: group });
        id += 1;
      }
    }

    const x0 = -35.2;
    const x1 = -23.6;
    const z0 = -16.2;
    const z1 = -2.6;
    const rail = (x: number, z: number, w: number, l: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, l), fenceMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
    };
    rail((x0 + x1) / 2, z0, x1 - x0, 0.08, 0.45);
    rail((x0 + x1) / 2, z0, x1 - x0, 0.08, 0.85);
    rail((x0 + x1) / 2, z1, x1 - x0, 0.08, 0.45);
    rail((x0 + x1) / 2, z1, x1 - x0, 0.08, 0.85);
    rail(x0, (z0 + z1) / 2, 0.08, z1 - z0, 0.45);
    rail(x0, (z0 + z1) / 2, 0.08, z1 - z0, 0.85);
    rail(x1, (z0 + z1) / 2, 0.08, z1 - z0, 0.45);
    rail(x1, (z0 + z1) / 2, 0.08, z1 - z0, 0.85);
    const postGeo = new THREE.CylinderGeometry(0.08, 0.09, 1.15, 6);
    for (let i = 0; i <= 4; i += 1) {
      for (const x of [x0, x1]) {
        const post = new THREE.Mesh(postGeo, fenceMat);
        post.position.set(x, 0.55, z0 + ((z1 - z0) * i) / 4);
        this.scene.add(post);
      }
    }
  }

  private blocked(x: number, z: number) {
    if (x * x + z * z < 16 * 16) return true;
    if (Math.hypot(x - 20, z + 10) < 13) return true;
    if (x > -38 && x < -16 && z > -18 && z < 4) return true;
    if (Math.hypot(x + 16, z - 12) < 6) return true;
    if (Math.hypot(x - 15, z - 15) < 6) return true;
    if (Math.hypot(x + 10, z + 22) < 6) return true;
    if (Math.hypot(x - 26, z + 16) < 6) return true;
    if (Math.abs(x) < 3.2 && z > -24 && z < 20) return true;
    if (Math.abs(z - 2) < 2.6 && x > -20 && x < 22) return true;
    if (Math.hypot(x - 17.8, z - 7.5) < 4) return true;
    if (Math.hypot(x + 6, z - 18) < 3) return true;
    return false;
  }

  private addScatter(rng: () => number) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d38, roughness: 0.82 });
    const leafTime = this.leafTime;
    leafMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = leafTime;
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "uniform float uTime;\nvoid main() {")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           transformed.x += sin(uTime * 1.2 + position.y * 2.0) * 0.05;
           transformed.z += cos(uTime + position.x) * 0.035;`,
        );
    };
    const spots: { x: number; z: number; s: number; fruit: boolean }[] = [
      { x: 22, z: 17, s: 1.05, fruit: true },
      { x: 25.5, z: 20, s: 0.9, fruit: true },
      { x: 19, z: 20.5, s: 1.15, fruit: true },
      { x: 27, z: 15, s: 0.85, fruit: true },
      { x: 23, z: 23, s: 1, fruit: true },
      { x: 17.5, z: 16, s: 0.8, fruit: true },
    ];
    let guard = 0;
    while (spots.length < 62 && guard < 800) {
      guard += 1;
      const ang = rng() * Math.PI * 2;
      const rad = 28 + rng() * 24;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      if (this.blocked(x, z)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3.1)) continue;
      spots.push({ x, z, s: 0.75 + rng() * 0.7, fruit: false });
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.3, 6), trunkMat, spots.length);
    const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1.45, 8, 6), leafMat, spots.length);
    const fruit = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xd3543c, roughness: 0.5 }),
      18,
    );
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let fruitN = 0;
    spots.forEach((s, i) => {
      dummy.position.set(s.x, 1.15 * s.s, s.z);
      dummy.scale.setScalar(s.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 2.7 * s.s, s.z);
      dummy.scale.setScalar(s.s * (0.9 + (i % 5) * 0.04));
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      color.set(i % 2 === 0 ? 0x2f7d38 : 0x3e9444);
      leaves.setColorAt(i, color);
      if (Math.hypot(s.x, s.z) < 27) this.addCollider(s.x, s.z, 0.55 * s.s);
      if (s.fruit) {
        for (let f = 0; f < 3 && fruitN < 18; f += 1) {
          dummy.position.set(s.x + (f - 1) * 0.35, 2.5 * s.s, s.z + 0.3);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          fruit.setMatrixAt(fruitN, dummy.matrix);
          fruitN += 1;
        }
      }
    });
    trunks.castShadow = false;
    leaves.instanceColor!.needsUpdate = true;
    fruit.count = fruitN;
    this.scene.add(trunks, leaves, fruit);

    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3c, roughness: 0.9 });
    const bushes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 6, 5), bushMat, 36);
    let b = 0;
    let tries = 0;
    while (b < 36 && tries < 400) {
      tries += 1;
      const x = (rng() - 0.5) * 90;
      const z = (rng() - 0.5) * 90;
      if (this.blocked(x, z) && rng() > 0.35) continue;
      if (Math.hypot(x, z) < 8) continue;
      dummy.position.set(x, 0.35, z);
      dummy.scale.setScalar(0.7 + rng() * 0.7);
      dummy.rotation.set(0, rng() * 3, 0);
      dummy.updateMatrix();
      bushes.setMatrixAt(b, dummy.matrix);
      b += 1;
    }
    bushes.count = b;
    this.scene.add(bushes);

    const flowerColors = [0xf2b6c6, 0xffd56a, 0xf4f0ea, 0xee8cab];
    const flowers = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.12, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }),
      80,
    );
    for (let i = 0; i < 80; i += 1) {
      const ang = rng() * Math.PI * 2;
      const rad = 9 + rng() * 40;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      dummy.position.set(x, 0.16, z);
      dummy.scale.setScalar(0.7 + rng());
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      color.set(flowerColors[i % flowerColors.length]);
      flowers.setColorAt(i, color);
    }
    flowers.instanceColor!.needsUpdate = true;
    this.scene.add(flowers);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a9186, roughness: 1 });
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.35, 0), rockMat, 16);
    for (let i = 0; i < 16; i += 1) {
      const ang = rng() * Math.PI * 2;
      const rad = 12 + rng() * 30;
      dummy.position.set(Math.cos(ang) * rad, 0.16, Math.sin(ang) * rad);
      dummy.scale.set(0.6 + rng() * 0.8, 0.4, 0.6 + rng() * 0.8);
      dummy.rotation.set(0, rng() * 3, 0);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(rocks);
  }

  private addPeople() {
    VILLAGERS.forEach((v) => {
      const group = makeAvatar(v.color, v.skin, v.name, true);
      group.position.set(v.x, 0, v.z);
      group.userData.kind = "npc";
      this.scene.add(group);
      this.people.push({
        group,
        x: v.x,
        z: v.z,
        tx: v.x + 2,
        tz: v.z + 2,
        speed: 1.35,
        phase: Math.random() * 4,
        kind: "person",
        name: v.name,
        lines: v.lines,
        line: 0,
      });
    });
  }

  private addCritters() {
    const add = (kind: Wanderer["kind"], x: number, z: number, color: number, speed: number) => {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
      if (kind === "hen") {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat);
        body.scale.set(1.2, 0.9, 1.4);
        body.position.y = 0.28;
        body.castShadow = true;
        group.add(body);
        const beak = new THREE.Mesh(
          new THREE.ConeGeometry(0.06, 0.14, 4),
          new THREE.MeshStandardMaterial({ color: 0xe39b32 }),
        );
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.3, 0.26);
        group.add(beak);
      } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(kind === "dog" ? 0.45 : 0.85, kind === "dog" ? 0.32 : 0.5, kind === "dog" ? 0.8 : 1.3), mat);
        body.position.y = kind === "dog" ? 0.36 : 0.55;
        body.castShadow = true;
        group.add(body);
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(kind === "dog" ? 0.24 : 0.36, kind === "dog" ? 0.22 : 0.32, kind === "dog" ? 0.28 : 0.4),
          mat,
        );
        head.position.set(0, kind === "dog" ? 0.5 : 0.78, kind === "dog" ? 0.42 : 0.7);
        group.add(head);
      }
      group.position.set(x, 0, z);
      this.scene.add(group);
      this.critters.push({
        group,
        x,
        z,
        tx: x + 1,
        tz: z + 1,
        speed,
        phase: Math.random() * 5,
        kind,
        line: 0,
      });
    };
    add("cow", 10, 20, 0x8d6e63, 0.9);
    add("cow", -4, 22, 0xa1887f, 0.75);
    add("dog", 3, 8, 0xc4a574, 2.1);
    add("hen", -28, -4, 0xf4efe6, 1.3);
    add("hen", -24, -12, 0xd9a441, 1.4);
    add("hen", -30, -9, 0xf2efe9, 1.2);
  }

  private addFlies() {
    for (let i = 0; i < 22; i += 1) {
      const ang = (i / 22) * Math.PI * 2;
      const rad = 6 + (i % 5) * 3;
      this.flyPos[i * 3] = Math.cos(ang) * rad;
      this.flyPos[i * 3 + 1] = 1.4;
      this.flyPos[i * 3 + 2] = Math.sin(ang) * rad;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.flyPos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xfff1c4,
        size: 0.12,
        map: softDot(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.85,
      }),
    );
    pts.name = "flies";
    this.scene.add(pts);
  }
}
