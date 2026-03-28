import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const BG = 0x2a2a2a;

const viewport = document.getElementById("viewport");

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

const CAMERA_ABOVE_TARGET = 2.15;
const CAMERA_FRONT_Z_OFFSET = 6.25;

function setFrontDownwardCameraView(targetCenter) {
  controls.target.copy(targetCenter);
  camera.position.set(
    targetCenter.x,
    targetCenter.y + CAMERA_ABOVE_TARGET,
    targetCenter.z + CAMERA_FRONT_Z_OFFSET
  );
  controls.update();
}

setFrontDownwardCameraView(new THREE.Vector3(0, 0.5, 0));

const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(5, 10, 6);
scene.add(dir);

const groundGeo = new THREE.PlaneGeometry(40, 40);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x242424,
  roughness: 0.9,
  metalness: 0.05,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = false;
scene.add(ground);

const hexagonalPlateUrl = new URL("assets/HexTile.glb", import.meta.url).href;
const gameTileLabelUrl = new URL("assets/TextLabel.glb", import.meta.url).href;
const gameTileIconUrl = new URL(
  encodeURI("assets/game tile icon/TestObject.glb"),
  import.meta.url
).href;

const GAME_TILE_LABEL_CLEARANCE = 0.08;
const GAME_TILE_ICON_CLEARANCE_ABOVE_LABEL = 0.08;

const KEYFRAME_SCALE_MIN = 0.1;
const KEYFRAME_SCALE_MAX = 1;
const DEFAULT_TIMELINE_DURATION_MS = 2000;

function getTimelineDurationMs() {
  const input = document.getElementById("timeline-duration-input");
  if (!input) return DEFAULT_TIMELINE_DURATION_MS;
  const s = parseFloat(String(input.value).trim());
  if (!Number.isFinite(s) || s <= 0) return DEFAULT_TIMELINE_DURATION_MS;
  return s * 1000;
}

/** @type {number | null} */
let playTimelineRafId = null;
/** @type {number | null} */
let loopTimelineRafId = null;

/** @type {THREE.Group | null} */
let gameTileIconPivot = null;
/** @type {THREE.Group | null} */
let gameTileLabelPivot = null;
/** @type {THREE.Object3D | null} */
let gameTileLabelRoot = null;

const _labelFwdLocal = new THREE.Vector3();
const _labelCamDirXZ = new THREE.Vector3();
const _labelWorldUp = new THREE.Vector3(0, 1, 0);
const _qLabelBillboardAlign = new THREE.Quaternion();
const _qLabelBillboardYawAdjust = new THREE.Quaternion();

/** Extra yaw after aligning local +Z to camera (mesh front offset in XZ). */
const GAME_TILE_LABEL_BILLBOARD_YAW_ADJUST = -Math.PI / 2;

function updateGameTileLabelYawBillboard() {
  if (!gameTileLabelPivot || !gameTileLabelRoot) return;
  const p = gameTileLabelPivot.position;
  const c = camera.position;
  const dx = c.x - p.x;
  const dz = c.z - p.z;
  if (dx * dx + dz * dz < 1e-12) return;

  _labelCamDirXZ.set(dx, 0, dz).normalize();
  _labelFwdLocal.set(0, 0, 1);
  _labelFwdLocal.applyQuaternion(gameTileLabelRoot.quaternion);
  _qLabelBillboardAlign.setFromUnitVectors(
    _labelFwdLocal,
    _labelCamDirXZ
  );
  _qLabelBillboardYawAdjust.setFromAxisAngle(
    _labelWorldUp,
    GAME_TILE_LABEL_BILLBOARD_YAW_ADJUST
  );
  gameTileLabelPivot.quaternion
    .copy(_qLabelBillboardAlign)
    .multiply(_qLabelBillboardYawAdjust);
}

const INITIAL_KEYFRAME_ID = "kf-initial";

/** @type {{ id: string; value: number; year: string; status: string; notes: string }[]} */
let keyframes = [
  {
    id: INITIAL_KEYFRAME_ID,
    value: 1,
    year: "2026",
    status: "neutral",
    notes: "",
  },
];
/** @type {string | null} */
let selectedKeyframeId = INITIAL_KEYFRAME_ID;
/** @type {string | null} */
let editingKeyframeId = null;

const gltfLoader = new GLTFLoader();

function clampKeyframeScale(value) {
  return Math.min(KEYFRAME_SCALE_MAX, Math.max(KEYFRAME_SCALE_MIN, value));
}

function applyGameTileIconScale(value) {
  if (!gameTileIconPivot) return;
  gameTileIconPivot.scale.setScalar(clampKeyframeScale(value));
}

function parseYearToTimeline(raw) {
  const s = String(raw).trim();
  if (!s) return 0;
  const bc = s.match(/^(\d+)\s*BC\b/i);
  if (bc) return -parseInt(bc[1], 10);
  const bce = s.match(/^(\d+)\s*BCE\b/i);
  if (bce) return -parseInt(bce[1], 10);
  const lead = s.match(/^-?\d+/);
  if (lead) return parseInt(lead[0], 10);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function makeKeyframeId() {
  return `kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getKeyframeById(id) {
  return keyframes.find((k) => k.id === id);
}

function getSelectedKeyframe() {
  return getKeyframeById(selectedKeyframeId);
}

function applySelectedKeyframeScale() {
  const k = getSelectedKeyframe();
  applyGameTileIconScale(k ? k.value : 1);
}

function setTimelineAnimationProgressVisible(visible) {
  const track = document.getElementById("timeline-animation-progress");
  const fill = document.getElementById("timeline-animation-progress-fill");
  if (!track || !fill) return;
  track.hidden = !visible;
  if (!visible) {
    fill.style.width = "0%";
    track.setAttribute("aria-valuenow", "0");
  }
}

function setTimelineAnimationProgressRatio(ratio) {
  const track = document.getElementById("timeline-animation-progress");
  const fill = document.getElementById("timeline-animation-progress-fill");
  if (!track || !fill) return;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  fill.style.width = `${pct}%`;
  track.setAttribute("aria-valuenow", String(Math.round(pct)));
}

function computeTimelineScaleForElapsed(elapsed, scales, durationMs) {
  if (scales.length === 0) return 1;
  if (scales.length === 1) return scales[0];
  const segCount = scales.length - 1;
  const segDuration = durationMs / segCount;
  const segIndex = Math.min(
    Math.floor(elapsed / segDuration),
    segCount - 1
  );
  const segStart = segIndex * segDuration;
  const t = Math.min(1, Math.max(0, (elapsed - segStart) / segDuration));
  return (
    scales[segIndex] +
    (scales[segIndex + 1] - scales[segIndex]) * t
  );
}

function setTimelinePlayButtonPlaying(playing) {
  const btn = document.getElementById("timeline-play-button");
  const img = document.getElementById("timeline-play-button-icon");
  if (!btn || !img) return;
  btn.setAttribute("aria-label", playing ? "Stop" : "Play");
  img.src = new URL(
    playing ? "assets/icon/icon-stop.svg" : "assets/icon/icon-play.svg",
    import.meta.url
  ).href;
}

function stopPlayTimelineAnimation() {
  if (playTimelineRafId !== null) {
    cancelAnimationFrame(playTimelineRafId);
    playTimelineRafId = null;
    applySelectedKeyframeScale();
    setTimelinePlayButtonPlaying(false);
    setTimelineAnimationProgressVisible(false);
  }
}

function setTimelineLoopButtonPlaying(playing) {
  const btn = document.getElementById("timeline-loop-button");
  const img = document.getElementById("timeline-loop-button-icon");
  if (!btn || !img) return;
  btn.setAttribute("aria-label", playing ? "Stop" : "Loop");
  img.src = new URL(
    playing ? "assets/icon/icon-stop.svg" : "assets/icon/icon-loop.svg",
    import.meta.url
  ).href;
}

function stopLoopTimelineAnimation() {
  if (loopTimelineRafId !== null) {
    cancelAnimationFrame(loopTimelineRafId);
    loopTimelineRafId = null;
    applySelectedKeyframeScale();
    setTimelineLoopButtonPlaying(false);
    setTimelineAnimationProgressVisible(false);
  }
}

function playTimelineAnimation() {
  if (!gameTileIconPivot) return;
  stopLoopTimelineAnimation();
  stopPlayTimelineAnimation();

  const sorted = [...keyframes].sort(
    (a, b) => parseYearToTimeline(a.year) - parseYearToTimeline(b.year)
  );
  const scales = sorted.map((k) => clampKeyframeScale(k.value));

  if (scales.length === 0) {
    applyGameTileIconScale(1);
    return;
  }

  const durationMs = getTimelineDurationMs();
  const startTime = performance.now();
  setTimelinePlayButtonPlaying(true);
  setTimelineAnimationProgressVisible(true);
  setTimelineAnimationProgressRatio(0);

  function tick(now) {
    const elapsed = now - startTime;
    if (elapsed >= durationMs) {
      setTimelineAnimationProgressRatio(1);
      applyGameTileIconScale(scales[scales.length - 1]);
      playTimelineRafId = null;
      applySelectedKeyframeScale();
      setTimelinePlayButtonPlaying(false);
      setTimelineAnimationProgressVisible(false);
      return;
    }

    setTimelineAnimationProgressRatio(elapsed / durationMs);
    applyGameTileIconScale(
      computeTimelineScaleForElapsed(elapsed, scales, durationMs)
    );
    playTimelineRafId = requestAnimationFrame(tick);
  }

  playTimelineRafId = requestAnimationFrame(tick);
}

function loopTimelineAnimation() {
  if (!gameTileIconPivot) return;
  stopPlayTimelineAnimation();
  stopLoopTimelineAnimation();

  const sorted = [...keyframes].sort(
    (a, b) => parseYearToTimeline(a.year) - parseYearToTimeline(b.year)
  );
  const scales = sorted.map((k) => clampKeyframeScale(k.value));

  if (scales.length === 0) {
    applyGameTileIconScale(1);
    return;
  }

  const durationMs = getTimelineDurationMs();
  const startTime = performance.now();
  setTimelineLoopButtonPlaying(true);
  setTimelineAnimationProgressVisible(true);
  setTimelineAnimationProgressRatio(0);

  function tick(now) {
    const elapsed = (now - startTime) % durationMs;
    setTimelineAnimationProgressRatio(elapsed / durationMs);
    applyGameTileIconScale(
      computeTimelineScaleForElapsed(elapsed, scales, durationMs)
    );
    loopTimelineRafId = requestAnimationFrame(tick);
  }

  loopTimelineRafId = requestAnimationFrame(tick);
}

function onTimelinePlayButtonClick() {
  if (playTimelineRafId !== null) {
    stopPlayTimelineAnimation();
    return;
  }
  playTimelineAnimation();
}

function onTimelineLoopButtonClick() {
  if (loopTimelineRafId !== null) {
    stopLoopTimelineAnimation();
    return;
  }
  loopTimelineAnimation();
}

function renderKeyframes() {
  const track = document.getElementById("time-scrubber-track");
  if (!track) return;
  track.replaceChildren();
  if (keyframes.length === 0) return;
  const sorted = [...keyframes].sort(
    (a, b) => parseYearToTimeline(a.year) - parseYearToTimeline(b.year)
  );
  for (let i = 0; i < sorted.length; i++) {
    const kf = sorted[i];
    const yearText = String(kf.year ?? "").trim();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "timeline-keyframe-btn";
    btn.dataset.keyframeId = kf.id;
    const labelForA11y = yearText || "untitled";
    btn.setAttribute("aria-label", `Keyframe ${labelForA11y}`);
    const label = document.createElement("span");
    label.className = "timeline-keyframe-label";
    label.textContent = yearText || "—";
    btn.appendChild(label);
    track.appendChild(btn);
  }
}

gltfLoader.load(
  hexagonalPlateUrl,
  (hexGltf) => {
    const hexagonalPlate = hexGltf.scene;
    hexagonalPlate.updateMatrixWorld(true);
    const plateBox = new THREE.Box3().setFromObject(hexagonalPlate);
    const plateCenter = plateBox.getCenter(new THREE.Vector3());
    hexagonalPlate.position.set(
      -plateCenter.x,
      -plateBox.min.y,
      -plateCenter.z
    );
    hexagonalPlate.updateMatrixWorld(true);
    scene.add(hexagonalPlate);

    const placedPlateBox = new THREE.Box3().setFromObject(hexagonalPlate);
    const plateTopY = placedPlateBox.max.y;

    function loadGameTileIcon(pivotY, labelPivotForBounds) {
      gltfLoader.load(
        gameTileIconUrl,
        (iconGltf) => {
          const gameTileIcon = iconGltf.scene;
          gameTileIcon.updateMatrixWorld(true);
          const iconBox = new THREE.Box3().setFromObject(gameTileIcon);
          const bottomCx = (iconBox.min.x + iconBox.max.x) / 2;
          const bottomCy = iconBox.min.y;
          const bottomCz = (iconBox.min.z + iconBox.max.z) / 2;
          gameTileIcon.position.set(-bottomCx, -bottomCy, -bottomCz);

          gameTileIconPivot = new THREE.Group();
          gameTileIconPivot.position.set(0, pivotY, 0);
          gameTileIconPivot.add(gameTileIcon);
          scene.add(gameTileIconPivot);

          applySelectedKeyframeScale();

          const bounds = placedPlateBox.clone();
          if (labelPivotForBounds) {
            bounds.union(
              new THREE.Box3().setFromObject(labelPivotForBounds)
            );
          }
          bounds.union(new THREE.Box3().setFromObject(gameTileIconPivot));
          setFrontDownwardCameraView(bounds.getCenter(new THREE.Vector3()));
        },
        undefined,
        (err) => {
          console.error("Failed to load Game Tile Icon (TestObject.glb):", err);
          setFrontDownwardCameraView(
            placedPlateBox.getCenter(new THREE.Vector3())
          );
        }
      );
    }

    gltfLoader.load(
      gameTileLabelUrl,
      (labelGltf) => {
        const gameTileLabel = labelGltf.scene;
        gameTileLabelRoot = gameTileLabel;
        gameTileLabel.rotation.set(0, (3 * Math.PI) / 2, 0);
        gameTileLabel.updateMatrixWorld(true);
        const labelBox = new THREE.Box3().setFromObject(gameTileLabel);
        const lblBottomCx = (labelBox.min.x + labelBox.max.x) / 2;
        const lblBottomCy = labelBox.min.y;
        const lblBottomCz = (labelBox.min.z + labelBox.max.z) / 2;
        gameTileLabel.position.set(-lblBottomCx, -lblBottomCy, -lblBottomCz);

        gameTileLabelPivot = new THREE.Group();
        gameTileLabelPivot.position.set(
          0,
          plateTopY + GAME_TILE_LABEL_CLEARANCE,
          0
        );
        gameTileLabelPivot.add(gameTileLabel);
        scene.add(gameTileLabelPivot);
        updateGameTileLabelYawBillboard();

        gameTileLabelPivot.updateMatrixWorld(true);
        const labelPlacedBox = new THREE.Box3().setFromObject(
          gameTileLabelPivot
        );
        const iconPivotY =
          labelPlacedBox.max.y + GAME_TILE_ICON_CLEARANCE_ABOVE_LABEL;

        loadGameTileIcon(iconPivotY, gameTileLabelPivot);
      },
      undefined,
      (err) => {
        console.error("Failed to load Game Tile Label (TextLabel.glb):", err);
        loadGameTileIcon(plateTopY + GAME_TILE_LABEL_CLEARANCE, null);
      }
    );
  },
  undefined,
  (err) => {
    console.error("Failed to load Hexagonal Plate (HexTile.glb):", err);
  }
);

function resizeToViewport() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

resizeToViewport();
new ResizeObserver(resizeToViewport).observe(viewport);
window.addEventListener("resize", resizeToViewport);

function tick() {
  requestAnimationFrame(tick);
  controls.update();
  updateGameTileLabelYawBillboard();
  renderer.render(scene, camera);
}
tick();

const editKeyframeModal = document.getElementById("edit-keyframe-modal");
const keyframeValueInput = document.getElementById("keyframe-value-input");
const keyframeYearInput = document.getElementById("keyframe-year-input");
const keyframeStatusSelect = document.getElementById("keyframe-status-select");
const keyframeNotesInput = document.getElementById("keyframe-notes-input");
const editKeyframeSave = document.getElementById("edit-keyframe-save");
const editKeyframeDelete = document.getElementById("edit-keyframe-delete");
const editKeyframeClose = document.getElementById("edit-keyframe-close");

const addKeyframeModal = document.getElementById("add-keyframe-modal");
const addKeyframeValueInput = document.getElementById(
  "add-keyframe-value-input"
);
const addKeyframeYearInput = document.getElementById("add-keyframe-year-input");
const addKeyframeStatusSelect = document.getElementById(
  "add-keyframe-status-select"
);
const addKeyframeNotesInput = document.getElementById(
  "add-keyframe-notes-input"
);
const addKeyframeSave = document.getElementById("add-keyframe-save");
const addKeyframeClose = document.getElementById("add-keyframe-close");
const addKeyframeButton = document.getElementById("add-keyframe-button");
const timelinePlayButton = document.getElementById("timeline-play-button");
const timelineLoopButton = document.getElementById("timeline-loop-button");
const timeScrubberTrack = document.getElementById("time-scrubber-track");

function isEditKeyframeModalOpen() {
  return Boolean(editKeyframeModal && !editKeyframeModal.hidden);
}

function isAddKeyframeModalOpen() {
  return Boolean(addKeyframeModal && !addKeyframeModal.hidden);
}

function openEditKeyframeModalFor(id) {
  const k = getKeyframeById(id);
  if (!k || !editKeyframeModal || !keyframeValueInput) return;
  editingKeyframeId = id;
  keyframeValueInput.value = String(k.value);
  if (keyframeYearInput) keyframeYearInput.value = k.year;
  if (keyframeStatusSelect) keyframeStatusSelect.value = k.status;
  if (keyframeNotesInput) keyframeNotesInput.value = k.notes;
  editKeyframeModal.hidden = false;
  requestAnimationFrame(() => keyframeValueInput.focus());
}

function closeEditKeyframeModalDiscard() {
  if (!editKeyframeModal) return;
  editKeyframeModal.hidden = true;
  editingKeyframeId = null;
}

function saveEditKeyframeModal() {
  if (!editKeyframeModal || !keyframeValueInput || !editingKeyframeId) return;
  const k = getKeyframeById(editingKeyframeId);
  if (!k) return;
  const raw = parseFloat(keyframeValueInput.value);
  k.value = Number.isFinite(raw) ? clampKeyframeScale(raw) : k.value;
  keyframeValueInput.value = String(k.value);
  k.year = keyframeYearInput?.value ?? "";
  const statusRaw = keyframeStatusSelect?.value;
  k.status =
    statusRaw === "good" || statusRaw === "bad" || statusRaw === "neutral"
      ? statusRaw
      : "neutral";
  k.notes = keyframeNotesInput?.value ?? "";
  renderKeyframes();
  applySelectedKeyframeScale();
  editKeyframeModal.hidden = true;
  editingKeyframeId = null;
}

function deleteEditKeyframe() {
  if (!editKeyframeModal || !editingKeyframeId) return;
  const idToRemove = editingKeyframeId;
  const idx = keyframes.findIndex((k) => k.id === idToRemove);
  if (idx === -1) return;
  keyframes.splice(idx, 1);
  if (selectedKeyframeId === idToRemove || !getKeyframeById(selectedKeyframeId)) {
    selectedKeyframeId = keyframes[0]?.id ?? null;
  }
  renderKeyframes();
  applySelectedKeyframeScale();
  editKeyframeModal.hidden = true;
  editingKeyframeId = null;
}

function openAddKeyframeModal() {
  if (!addKeyframeModal || !addKeyframeValueInput) return;
  addKeyframeValueInput.value = "1";
  if (addKeyframeYearInput) addKeyframeYearInput.value = "2026";
  if (addKeyframeStatusSelect) addKeyframeStatusSelect.value = "neutral";
  if (addKeyframeNotesInput) addKeyframeNotesInput.value = "";
  addKeyframeModal.hidden = false;
  requestAnimationFrame(() => addKeyframeValueInput.focus());
}

function closeAddKeyframeModalDiscard() {
  if (!addKeyframeModal) return;
  addKeyframeModal.hidden = true;
}

function saveAddKeyframeModal() {
  if (!addKeyframeModal || !addKeyframeValueInput) return;
  const raw = parseFloat(addKeyframeValueInput.value);
  const value = Number.isFinite(raw) ? clampKeyframeScale(raw) : 1;
  const year = addKeyframeYearInput?.value ?? "2026";
  const statusRaw = addKeyframeStatusSelect?.value;
  const status =
    statusRaw === "good" || statusRaw === "bad" || statusRaw === "neutral"
      ? statusRaw
      : "neutral";
  const notes = addKeyframeNotesInput?.value ?? "";
  const id = makeKeyframeId();
  keyframes.push({ id, value, year, status, notes });
  selectedKeyframeId = id;
  renderKeyframes();
  applySelectedKeyframeScale();
  addKeyframeModal.hidden = true;
}

timeScrubberTrack?.addEventListener("click", (e) => {
  const btn = e.target.closest(".timeline-keyframe-btn[data-keyframe-id]");
  if (!btn) return;
  const id = btn.dataset.keyframeId;
  if (!id) return;
  selectedKeyframeId = id;
  applySelectedKeyframeScale();
  openEditKeyframeModalFor(id);
});

addKeyframeButton?.addEventListener("click", openAddKeyframeModal);
timelinePlayButton?.addEventListener("click", onTimelinePlayButtonClick);
timelineLoopButton?.addEventListener("click", onTimelineLoopButtonClick);
editKeyframeSave?.addEventListener("click", saveEditKeyframeModal);
editKeyframeDelete?.addEventListener("click", deleteEditKeyframe);
editKeyframeClose?.addEventListener("click", closeEditKeyframeModalDiscard);
addKeyframeSave?.addEventListener("click", saveAddKeyframeModal);
addKeyframeClose?.addEventListener("click", closeAddKeyframeModalDiscard);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (isAddKeyframeModalOpen()) {
    e.preventDefault();
    closeAddKeyframeModalDiscard();
    return;
  }
  if (isEditKeyframeModalOpen()) {
    e.preventDefault();
    closeEditKeyframeModalDiscard();
  }
});

renderKeyframes();
