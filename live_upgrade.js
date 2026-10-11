"use strict";

// A stateful game session for the connected benchmark. The agent receives only
// observe() and act(); evaluatorTruth() is called by the scoring harness.
(() => {
  const canvas = document.getElementById("upgradeGame");
  const levels = [10, 11, 12, 16, 20, 10, null];
  const salts = {base: 0x416eb12d, development: 0x733e162b,
    adaptation: 0x198ec746, validation: 0x52d7a110, future: 0x6c8af239};
  const themes = [
    {floor: "#152b3b", wall: "#28506a", accent: "#69c9c8"},
    {floor: "#2b223d", wall: "#534368", accent: "#b394ec"},
    {floor: "#352b2a", wall: "#6c4843", accent: "#efaa74"},
    {floor: "#193332", wall: "#326258", accent: "#86d9a9"}
  ];
  let state = null;

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

  function start({split, index, scenario = "layout_mimic"}) {
    if (!Object.hasOwn(salts, split) || !Number.isInteger(index) || index < 0) {
      throw Error("Invalid session");
    }
    if (!["effect", "layout", "layout_mimic"].includes(scenario)) {
      throw Error("Invalid scenario");
    }
    const seed = (salts[split] ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    const rand = rng32(seed);
    const kinds = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    const panels = kinds.map((kind, position) => ({
      instanceId: split + "-" + index + "-instance-" + kind,
      kind,
      home: position,
      dx: Math.floor(rand() * 13) - 6,
      dy: Math.floor(rand() * 13) - 6
    }));
    state = {split, index, scenario, seed, panels, phase: 0, frameId: 1,
      ticks: 0, actions: new Set(), receipts: [], hits: 0, wrongClicks: 0};
    return {session: split + "-" + index, frame_id: state.frameId};
  }

  function frame() {
    if (!state) throw Error("Start a session first");
    const level = levels[state.phase];
    const absent = level === null;
    const panels = state.panels.filter(panel => !absent || panel.kind !== 0).map(panel => {
      const driftX = Math.round(12 * Math.sin((state.ticks + 1) * 0.72 + panel.kind * 1.7));
      const driftY = Math.round(7 * Math.cos((state.ticks + 1) * 0.53 + panel.kind));
      const overlap = state.scenario === "layout_mimic" && state.split === "future"
        && state.index % 3 === 2 && level !== null && level >= 11 && panel.home === 1 ? -38 : 0;
      const x = [20, 330, 640][panel.home] + panel.dx + driftX + overlap;
      const y = 148 + panel.dy + driftY;
      return {kind: panel.kind, id: panel.instanceId, bbox: [x, y, 280, 320]};
    });
    return {seed: state.seed, level: level ?? 20, absent, panels,
      theme: themes[state.seed % themes.length], scenario: state.scenario};
  }

  function observe() {
    const visible = frame();
    window.UpgradeLab.renderFrame(visible);
    return {frame_id: state.frameId, image: canvas.toDataURL("image/png")};
  }

  function tick() {
    if (!state) throw Error("Start a session first");
    state.ticks++;
    state.frameId++;
    return observe();
  }

  function act({action_id, frame_id, x, y}) {
    if (!state || !action_id) throw Error("Session and action_id required");
    if (state.actions.has(action_id)) {
      return {action_id, frame_id, result: "duplicate", advanced: false};
    }
    state.actions.add(action_id);
    if (frame_id !== state.frameId) {
      return {action_id, frame_id, result: "stale", advanced: false};
    }
    const selected = frame().panels.find(panel => {
      const [left, top, width, height] = panel.bbox;
      return x >= left && x < left + width && y >= top && y < top + height;
    });
    let result = "miss";
    if (selected) {
      result = selected.kind === 0 ? "success" : "wrong_panel";
      if (result === "success") {
        state.hits++;
        state.phase = Math.min(state.phase + 1, levels.length - 1);
      } else {
        state.wrongClicks++;
      }
    }
    const receipt = {action_id, frame_id, result, advanced: result === "success"};
    state.receipts.push(receipt);
    state.ticks++;
    state.frameId++;
    return receipt;
  }

  function evaluatorTruth() {
    const visible = frame();
    return {session: state.split + "-" + state.index, frame_id: state.frameId,
      level: levels[state.phase], phase: state.phase, target_present: levels[state.phase] !== null,
      panels: visible.panels.map(panel => ({
        instance_id: panel.id, kind: panel.kind, bbox: panel.bbox
      })), hits: state.hits, wrong_clicks: state.wrongClicks};
  }

  window.LiveUpgradeLab = {start, observe, tick, act, evaluatorTruth};
})();
