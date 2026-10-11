"use strict";

// The browser renderer is shared by the playable challenge and the benchmark.
// Labels are exported for scoring; renderFrame never draws the target identity.
const canvas = document.getElementById("upgradeGame");
const ctx = canvas.getContext("2d", {alpha: false});
const $ = id => document.getElementById(id);
const PROPOSALS = [20, 330, 640].map((x, slot) => ({slot, bbox: [x - 10, 135, 300, 350]}));
const PLAN = {
  train: {sessions: 8, levels: [1, 3, 6, 9, 10]},
  val: {sessions: 4, levels: [2, 5, 8, 10]},
  test: {sessions: 8, levels: [10, 11, 12, 16, 20]}
};
const STUDY_SCENARIOS = ["effect", "layout", "layout_mimic"];
const STUDY_TEST_LEVELS = [10, 11, 11, 11, 11, 11, 11, 11, 11, 12, 16, 20, 10];
const SPLIT_SALT = {train: 0x41b5c287, val: 0x2e159c73, test: 0x735ca821};
let datasetSeedOffset = 0;
const THEMES = [
  {floor: "#152b3b", wall: "#28506a", accent: "#69c9c8"},
  {floor: "#2b223d", wall: "#534368", accent: "#b394ec"},
  {floor: "#352b2a", wall: "#6c4843", accent: "#efaa74"},
  {floor: "#193332", wall: "#326258", accent: "#86d9a9"}
];

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(list, rng) {
  const values = [...list];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
function rect(x, y, w, h, radius = 0) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}
function poly(x, y, count, radius, offset = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const angle = offset + 2 * Math.PI * i / count;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function makeFrame(seed, level, absent = false) {
  const rand = rng32((seed ^ Math.imul(level + 1, 0x9e3779b1) ^ (absent ? 0x4ae91b6d : 0)) >>> 0);
  const kinds = shuffle(absent ? [1, 2, 3] : [0, 1, 2], rand);
  const panels = kinds.map((kind, slot) => {
    const x = [20, 330, 640][slot] + Math.floor(rand() * 15) - 7;
    const y = 148 + Math.floor(rand() * 13) - 6;
    return {slot, kind, id: kind === 0 ? "trait-upgrade" : "distractor-" + kind, bbox: [x, y, 280, 320]};
  });
  return {seed, level, absent, panels, theme: THEMES[seed % THEMES.length]};
}
function drawBackdrop(frame) {
  const {seed, level, theme} = frame;
  ctx.fillStyle = "#0e1725";
  ctx.fillRect(0, 0, 960, 576);
  const glow = ctx.createRadialGradient(500, 270, 35, 500, 270, 600);
  glow.addColorStop(0, theme.wall);
  glow.addColorStop(1, theme.floor);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 64, 960, 512);
  const rand = rng32(seed ^ 0x5ac7d912);
  for (let i = 0; i < 54; i++) {
    const x = Math.floor(rand() * 960), y = 68 + Math.floor(rand() * 508);
    ctx.fillStyle = i % 4 === 0 ? "#b8d9de18" : "#8cb5bb10";
    ctx.fillRect(x, y, 2 + Math.floor(rand() * 11), 1 + Math.floor(rand() * 4));
  }
  ctx.fillStyle = "#102137";
  ctx.fillRect(0, 0, 960, 69);
  ctx.fillStyle = "#f4d39f";
  ctx.font = "bold 18px Malgun Gothic, sans-serif";
  ctx.fillText("RUNE HUNT  /  TRAIT CHAMBER", 32, 30);
  ctx.fillStyle = "#a2bad0";
  ctx.font = "12px Malgun Gothic, sans-serif";
  ctx.fillText("Find the same window after its appearance changes.", 33, 50);
  ctx.fillStyle = theme.accent;
  ctx.font = "bold 14px Malgun Gothic, sans-serif";
  ctx.fillText("LV. " + String(level).padStart(2, "0"), 858, 39);
  ctx.fillStyle = "#bfd1df";
  ctx.font = "12px Malgun Gothic, sans-serif";
  ctx.fillText("세 개의 창 중 같은 특성 강화 창을 다시 찾으세요", 33, 110);
  ctx.strokeStyle = "#83a3b035";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, 122); ctx.lineTo(928, 122); ctx.stroke();
}
function drawEmblem(kind, cx, cy) {
  ctx.save();
  ctx.fillStyle = "#eecb91";
  ctx.strokeStyle = "#f5d9a9";
  ctx.lineWidth = 2.5;
  if (kind === 0) {
    poly(cx, cy, 4, 15, Math.PI / 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#223a4b"; poly(cx, cy, 4, 7, Math.PI / 4); ctx.fill();
    ctx.fillStyle = "#eecb91";
    ctx.fillRect(cx - 27, cy - 2, 6, 4); ctx.fillRect(cx + 21, cy - 2, 6, 4);
  } else if (kind === 1) {
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 2 * Math.PI); ctx.fill();
  } else if (kind === 2) {
    poly(cx, cy + 2, 3, 16); ctx.fill();
    ctx.fillStyle = "#223a4b"; poly(cx, cy + 3, 3, 7); ctx.fill();
  } else {
    poly(cx, cy, 6, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 9, cy + 4); ctx.lineTo(cx + 9, cy - 4); ctx.stroke();
  }
  ctx.restore();
}
function drawPanel(panel, frame) {
  const [x, y, w, h] = panel.bbox;
  const {kind} = panel;
  const rand = rng32((frame.seed ^ Math.imul(kind + 1, 0x85ebca6b) ^ Math.imul(frame.level, 0xc2b2ae35)) >>> 0);
  const mimic = frame.scenario === "layout_mimic" && frame.level >= 11 && kind === 1;
  const ornate = kind === 0 || mimic ? frame.level >= 11 : rand() < 0.42;
  ctx.save();
  ctx.shadowColor = "#000b";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#142537"; rect(x, y, w, h, 13); ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "#b18b64"; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = "#64788a"; ctx.lineWidth = 1;
  rect(x + 6, y + 6, w - 12, h - 12, 9); ctx.stroke();
  ctx.fillStyle = "#20384a"; rect(x + 9, y + 9, w - 18, 52, 7); ctx.fill();
  ctx.strokeStyle = "#a88a6d"; ctx.beginPath(); ctx.moveTo(x + 11, y + 62); ctx.lineTo(x + w - 11, y + 62); ctx.stroke();
  drawEmblem(kind, x + 31, y + 35);
  ctx.fillStyle = "#e9d9bb"; ctx.font = "bold 16px Malgun Gothic, sans-serif";
  ctx.fillText("특성 강화", x + 61, y + 39);
  ctx.fillStyle = "#99b0bf"; ctx.font = "bold 12px Malgun Gothic, sans-serif";
  ctx.fillText("×", x + w - 29, y + 36);
  // The small frame marks are stable across all twenty levels.
  ctx.strokeStyle = kind === 0 ? "#eecb91" : "#b4a493";
  ctx.lineWidth = 2.5;
  if (kind === 0) {
    for (const yy of [y + 96, y + h - 71]) {
      ctx.beginPath(); ctx.moveTo(x + 8, yy); ctx.lineTo(x + 22, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w - 22, yy); ctx.lineTo(x + w - 8, yy); ctx.stroke();
    }
  } else if (kind === 1) {
    ctx.beginPath(); ctx.arc(x + w / 2, y + h - 15, 5, 0, 2 * Math.PI); ctx.stroke();
  } else if (kind === 2) {
    ctx.beginPath(); ctx.moveTo(x + 13, y + h - 13); ctx.lineTo(x + 29, y + h - 13); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(x + w - 29, y + h - 13); ctx.lineTo(x + w - 13, y + h - 13); ctx.stroke();
  }
  ctx.fillStyle = "#101d2c"; rect(x + 18, y + 74, w - 36, 190, 9); ctx.fill();
  ctx.strokeStyle = "#496078"; ctx.lineWidth = 1; ctx.stroke();
  if (ornate) {
    const aura = ctx.createRadialGradient(x + w / 2, y + 161, 8, x + w / 2, y + 161, 111);
    aura.addColorStop(0, "#fff0ba");
    aura.addColorStop(0.25, "#d49c83");
    aura.addColorStop(0.7, "#694976");
    aura.addColorStop(1, "#1c2841");
    ctx.fillStyle = aura; rect(x + 22, y + 78, w - 44, 182, 7); ctx.fill();
    for (let i = 0; i < 18; i++) {
      const angle = i * Math.PI / 9 + rand() * 0.09;
      const cx = x + w / 2, cy = y + 164;
      ctx.strokeStyle = i % 2 ? "#f7dca170" : "#d3a9ed88";
      ctx.lineWidth = 2 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * 39, cy + Math.sin(angle) * 39);
      ctx.lineTo(cx + Math.cos(angle) * (80 + rand() * 25), cy + Math.sin(angle) * (80 + rand() * 25));
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = "#1a3043"; rect(x + 22, y + 78, w - 44, 182, 7); ctx.fill();
    ctx.strokeStyle = "#416374"; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(x + w / 2, y + 164, 37 + i * 16, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  ctx.fillStyle = ornate ? "#ffe7a9" : "#d9c9a1";
  ctx.font = ornate ? "bold 64px Segoe UI Symbol, sans-serif" : "bold 48px Segoe UI Symbol, sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = ornate ? "#fff0ab" : "transparent";
  ctx.shadowBlur = ornate ? 22 : 0;
  ctx.fillText("✦", x + w / 2, y + 183);
  ctx.shadowBlur = 0;
  ctx.fillStyle = ornate ? "#fff0d4" : "#aac1d0";
  ctx.font = "bold 12px Malgun Gothic, sans-serif";
  ctx.fillText("Lv. " + String(frame.level).padStart(2, "0"), x + w / 2, y + 238);
  ctx.textAlign = "left";
  ctx.fillStyle = "#7f9aab"; rect(x + 33, y + 277, w - 66, 11, 5); ctx.fill();
  ctx.fillStyle = ornate ? "#eeb976" : "#78b4af";
  rect(x + 33, y + 277, (w - 66) * Math.min(frame.level / 20, 1), 11, 5); ctx.fill();
  ctx.fillStyle = "#94a9ba";
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 45 + i * 55, y + 299, 26, 3);
  // Study variant: children move, while the parent frame and emblem remain.
  if (frame.scenario?.startsWith("layout") && frame.level >= 11 && (kind === 0 || mimic)) {
    ctx.fillStyle = "#101d2c"; rect(x + 18, y + 74, w - 36, 216, 9); ctx.fill();
    ctx.strokeStyle = "#496078"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#513d62"; rect(x + 27, y + 88, 91, 113, 8); ctx.fill();
    ctx.fillStyle = "#2a4054"; rect(x + 128, y + 88, 125, 48, 7); ctx.fill();
    ctx.fillStyle = "#283d50"; rect(x + 128, y + 146, 125, 55, 7); ctx.fill();
    ctx.fillStyle = "#ffe7a9"; ctx.font = "bold 55px Segoe UI Symbol, sans-serif";
    ctx.textAlign = "center"; ctx.fillText("✦", x + 72, y + 169);
    ctx.fillStyle = "#f5dfbd"; ctx.font = "bold 13px Malgun Gothic, sans-serif";
    ctx.fillText("Lv. " + String(frame.level).padStart(2, "0"), x + 190, y + 118);
    ctx.fillStyle = "#ae83c5"; rect(x + 141, y + 164, 98, 14, 6); ctx.fill();
    ctx.fillStyle = "#50667a"; rect(x + 27, y + 216, 226, 55, 7); ctx.fill();
    ctx.fillStyle = "#eeb976"; rect(x + 36, y + 228, 207 * Math.min(frame.level / 20, 1), 11, 5); ctx.fill();
    ctx.textAlign = "left";
  }
  ctx.restore();
}
function renderFrame(frame) {
  drawBackdrop(frame);
  frame.panels.forEach(panel => drawPanel(panel, frame));
}
function sessionSeed(split, index) {
  return (SPLIT_SALT[split] ^ Math.imul(index + 1, 0x9e3779b1) ^ datasetSeedOffset) >>> 0;
}
function stepsFor(split) {
  const levels = PLAN[split].levels;
  return levels.map((level, index) => ({level, index, absent: false}))
    .concat([{level: split === "test" ? 20 : 10, index: levels.length, absent: true}]);
}
function capture(split, sessionIndex, stepIndex) {
  if (!PLAN[split] || sessionIndex < 0 || sessionIndex >= PLAN[split].sessions) throw new Error("Invalid session");
  const step = stepsFor(split)[stepIndex];
  if (!step) throw new Error("Invalid step");
  const seed = sessionSeed(split, sessionIndex);
  const frame = makeFrame(seed, step.level, step.absent);
  renderFrame(frame);
  return {
    split, session: split + "-" + String(sessionIndex + 1).padStart(2, "0"),
    step: stepIndex, level: step.level, target_present: !step.absent,
    image: canvas.toDataURL("image/png"),
    panels: frame.panels.map(panel => ({slot: panel.slot, id: panel.id, bbox: panel.bbox}))
  };
}
function manifest() {
  return {
    format: "rune-hunt-upgrade-v1",
    canvas: {width: 960, height: 576},
    proposals: PROPOSALS,
    plan: PLAN,
    seed_offset: datasetSeedOffset,
    notes: "Fixed three-slot proposals; labels are for scoring only. Independent session seeds. Test levels >=11 withheld from train and val."
  };
}
function studyManifest() {
  return {
    ...manifest(), study: "verified-online-structure-v1",
    plan: {...PLAN, test: {sessions: 8 * STUDY_SCENARIOS.length, levels: STUDY_TEST_LEVELS}},
    scenarios: STUDY_SCENARIOS,
    notes: "Train/val: original effect, levels <=10. Test: effect, moved children, moved children plus lookalike distractor. Child boxes and feedback are scoring-only labels."
  };
}
function captureStudy(split, sessionIndex, stepIndex) {
  const study = studyManifest();
  if (!study.plan[split] || sessionIndex < 0 || sessionIndex >= study.plan[split].sessions) throw Error("Invalid study session");
  const studyLevels = study.plan[split].levels;
  const step = studyLevels[stepIndex] === undefined
    ? (stepIndex === studyLevels.length ? {level: split === "test" ? 10 : 10, index: stepIndex, absent: true} : null)
    : {level: studyLevels[stepIndex], index: stepIndex, absent: false};
  if (!step) throw Error("Invalid study step");
  const scenarioIndex = split === "test" ? Math.floor(sessionIndex / 8) : 0;
  const scenario = STUDY_SCENARIOS[scenarioIndex];
  const localIndex = split === "test" ? sessionIndex % 8 : sessionIndex;
  // Pair scenarios by session: backdrop, slots and renderer jitter are identical.
  // Only the requested visual intervention differs across the three conditions.
  const seed = sessionSeed(split, localIndex);
  const renderSeed = split === "test" && stepIndex > 0
    ? (seed ^ Math.imul(stepIndex, 0x45d9f3b)) >>> 0 : seed;
  const frame = makeFrame(renderSeed, step.level, step.absent);
  frame.theme = THEMES[seed % THEMES.length];
  frame.scenario = scenario;
  renderFrame(frame);
  const shifted = scenario.startsWith("layout") && step.level >= 11;
  return {
    split, session: split + "-" + (split === "test" ? scenario + "-" : "") + String(localIndex + 1).padStart(2, "0"),
    step: stepIndex, level: step.level, scenario, target_present: !step.absent,
    phase: split === "test" ? (stepIndex === 0 ? "before" : stepIndex <= 8 ? "level11_burst" : stepIndex === 12 ? "old_revisit" : "future") : "base",
    image: canvas.toDataURL("image/png"),
    panels: frame.panels.map(panel => {
      const [x, y] = panel.bbox;
      const variant = shifted && (panel.kind === 0 || (scenario === "layout_mimic" && panel.kind === 1));
      const children = variant
        ? [{role: "emblem", bbox: [x + 15, y + 19, 32, 32]}, {role: "effect", bbox: [x + 27, y + 88, 91, 113]},
           {role: "level", bbox: [x + 128, y + 88, 125, 48]}, {role: "progress", bbox: [x + 27, y + 216, 226, 55]}]
        : [{role: "emblem", bbox: [x + 15, y + 19, 32, 32]}, {role: "effect", bbox: [x + 22, y + 78, 236, 182]},
           {role: "level", bbox: [x + 75, y + 219, 130, 28]}, {role: "progress", bbox: [x + 33, y + 277, 214, 11]}];
      return {slot: panel.slot, id: panel.id, bbox: panel.bbox, children,
              action_feedback: panel.kind === 0 ? "success" : "failure"};
    })
  };
}
let gameSeed = Math.floor(Math.random() * 9000000) + 1000000;
let gameScenario = "effect";
let level = 1, hits = 0, misses = 0;
function updateInteractive() {
  $("upgradeSeed").textContent = gameSeed;
  $("upgradeLevel").textContent = level;
  $("upgradeHits").textContent = hits;
  $("upgradeMisses").textContent = misses;
  $("levelProgress").style.width = Math.round(level / 20 * 100) + "%";
  const frame = makeFrame(gameSeed, level);
  frame.scenario = gameScenario;
  renderFrame(frame);
}
canvas.addEventListener("click", event => {
  const box = canvas.getBoundingClientRect();
  const x = (event.clientX - box.left) * canvas.width / box.width;
  const y = (event.clientY - box.top) * canvas.height / box.height;
  const selected = makeFrame(gameSeed, level).panels.find(panel => {
    const [left, top, width, height] = panel.bbox;
    return x >= left && x < left + width && y >= top && y < top + height;
  });
  if (!selected) return;
  if (selected.kind === 0) {
    hits++;
    if (level < 20) level++;
    $("upgradeMessage").textContent = level === 11 ? "11레벨! 내부 이펙트가 바뀌었습니다. 같은 창을 다시 찾으세요." : "같은 강화 창을 찾았습니다.";
    $("upgradeMessage").className = "message good";
  } else {
    misses++;
    $("upgradeMessage").textContent = "다른 창입니다. 바깥 표식을 다시 비교해 보세요.";
    $("upgradeMessage").className = "message bad";
  }
  updateInteractive();
});
$("upgradeRestart").addEventListener("click", () => {
  gameSeed = Math.floor(Math.random() * 9000000) + 1000000;
  level = 1; hits = 0; misses = 0;
  $("upgradeMessage").textContent = "새 세션입니다. 같은 강화 창을 찾아보세요.";
  $("upgradeMessage").className = "message";
  updateInteractive();
});
$("upgradeScenario").addEventListener("change", event => {
  if (!STUDY_SCENARIOS.includes(event.target.value)) return;
  gameScenario = event.target.value;
  gameSeed = Math.floor(Math.random() * 9000000) + 1000000;
  level = 1; hits = 0; misses = 0;
  $("upgradeMessage").textContent = "새 조건의 강화 세션입니다. 11레벨까지 진행해 보세요.";
  $("upgradeMessage").className = "message";
  $("upgradeScenarioHelp").textContent = "현재 조건: " + event.target.selectedOptions[0].textContent;
  updateInteractive();
});
async function exportDataset() {
  const button = $("upgradeExport"), status = $("upgradeExportStatus");
  button.disabled = true;
  const samples = [];
  const total = Object.keys(PLAN).reduce((n, split) => n + PLAN[split].sessions * stepsFor(split).length, 0);
  try {
    for (const split of ["train", "val", "test"]) {
      for (let sessionIndex = 0; sessionIndex < PLAN[split].sessions; sessionIndex++) {
        for (let stepIndex = 0; stepIndex < stepsFor(split).length; stepIndex++) {
          samples.push(capture(split, sessionIndex, stepIndex));
          status.textContent = samples.length + " / " + total + "개 화면 생성 중…";
          if (samples.length % 3 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
    const payload = {...manifest(), createdAt: new Date().toISOString(), samples};
    const blob = new Blob([JSON.stringify(payload)], {type: "application/json"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "rune-hunt-upgrade-dataset.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    status.textContent = total + "개 화면을 저장했습니다.";
  } catch (error) {
    status.textContent = "저장 실패: " + error.message;
    console.error(error);
  } finally {
    button.disabled = false;
    updateInteractive();
  }
}
$("upgradeExport").addEventListener("click", exportDataset);
window.UpgradeLab = {
  makeFrame, renderFrame, capture, manifest, captureStudy, studyManifest, stepsFor, sessionSeed, exportDataset,
  setSeedOffset: value => { datasetSeedOffset = value >>> 0; }
};
updateInteractive();
