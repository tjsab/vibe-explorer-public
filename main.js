import * as THREE from 'three';

// Simple anonymous name
const names = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vivaan', 'Isha', 'Arjun', 'Meera', 'Kabir', 'Saanvi'];
const anonName = names[Math.floor(Math.random() * names.length)] + ' ' + Math.floor(Math.random() * 99);
document.getElementById('name').textContent = `You are ${anonName}`;

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 20, 60);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 8, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lights
const ambient = new THREE.AmbientLight(0x404040, 0.8);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffd89b, 1.2);
sun.position.set(10, 20, 10);
sun.castShadow = true;
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Simple central gathering space (mandapa-like)
const mandapa = new THREE.Mesh(
  new THREE.CylinderGeometry(4, 4.5, 0.3, 16),
  new THREE.MeshStandardMaterial({ color: 0xd4a574 })
);
mandapa.position.y = 0.15;
mandapa.castShadow = true;
mandapa.receiveShadow = true;
scene.add(mandapa);

// Pillars
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0xf5e6d3 })
  );
  pillar.position.set(Math.cos(angle) * 5.5, 1.5, Math.sin(angle) * 5.5);
  pillar.castShadow = true;
  scene.add(pillar);
}

// Trees / plants around the edge
function addTree(x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, 2, 6),
    new THREE.MeshStandardMaterial({ color: 0x5c4033 })
  );
  trunk.position.set(x, 1, z);
  trunk.castShadow = true;
  scene.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a7d3a, roughness: 0.8 })
  );
  foliage.position.set(x, 2.6, z);
  foliage.castShadow = true;
  scene.add(foliage);
}

for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  const radius = 18 + Math.random() * 6;
  addTree(Math.cos(angle) * radius, Math.sin(angle) * radius);
}

// Player avatar (simple)
const player = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1.2, 4, 8),
  new THREE.MeshStandardMaterial({ color: 0x6c5ce7 })
);
body.position.y = 1.2;
body.castShadow = true;
player.add(body);

const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xffdbac })
);
head.position.y = 2.2;
player.add(head);

player.position.set(0, 0, 8);
scene.add(player);

// Simple controls
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updatePlayer() {
  const speed = 0.15;
  if (keys['w'] || keys['arrowup']) player.position.z -= speed;
  if (keys['s'] || keys['arrowdown']) player.position.z += speed;
  if (keys['a'] || keys['arrowleft']) player.position.x -= speed;
  if (keys['d'] || keys['arrowright']) player.position.x += speed;

  // Soft bounds
  const dist = Math.sqrt(player.position.x ** 2 + player.position.z ** 2);
  if (dist > 25) {
    player.position.x *= 25 / dist;
    player.position.z *= 25 / dist;
  }

  // Camera follow
  camera.position.x = player.position.x;
  camera.position.z = player.position.z + 12;
  camera.lookAt(player.position.x, 1.5, player.position.z);
}

// Actions (placeholders for multiplayer later)
window.sayHello = () => {
  console.log(`${anonName} says hello`);
  // Visual feedback later
};

window.startSinging = () => {
  console.log(`${anonName} starts singing`);
};

window.dance = () => {
  console.log(`${anonName} starts dancing`);
  // Simple hop animation
  const startY = player.position.y;
  let t = 0;
  const hop = () => {
    t += 0.1;
    player.position.y = startY + Math.sin(t) * 0.4;
    if (t < Math.PI * 4) requestAnimationFrame(hop);
    else player.position.y = startY;
  };
  hop();
};

window.pray = () => {
  console.log(`${anonName} joins in prayer / Bhakti`);
};

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  renderer.render(scene, camera);
}
animate();

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

console.log(`Welcome, ${anonName}. Walk with WASD. Use the buttons to interact.`);