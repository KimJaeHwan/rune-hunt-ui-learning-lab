// Render the real browser game in headless Chrome and export its benchmark.
// No image labels or model predictions are drawn into the screenshot.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawn} from "node:child_process";
import {pathToFileURL} from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const workspace = process.platform === "win32" && here.startsWith("/")
  ? decodeURIComponent(here.slice(1)) : decodeURIComponent(here);
const args = process.argv.slice(2);
const value = (key, fallback) => {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index + 1];
};
const chromePath = value("--chrome", process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const datasetPath = path.resolve(value("--dataset", path.join(workspace, "data", "upgrade-dataset.json")));
const previewPath = path.resolve(value("--preview", path.join(workspace, "data", "upgrade-preview.png")));
const seedOffset = Number(value("--seed-offset", "0"));
const studyMode = args.includes("--study");
await fs.mkdir(path.dirname(datasetPath), {recursive: true});
await fs.mkdir(path.dirname(previewPath), {recursive: true});
if (!Number.isInteger(seedOffset) || seedOffset < 0 || seedOffset > 0xffffffff) {
  throw new Error("--seed-offset must be an unsigned 32-bit integer");
}
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const number = server.address().port;
    server.close(() => resolve(number));
  });
});
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "rune-upgrade-chrome-"));
const pageUrl = pathToFileURL(path.join(workspace, "upgrade.html")).href;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking",
  "--remote-debugging-port=" + port,
  "--user-data-dir=" + profile, pageUrl
], {stdio: "ignore", windowsHide: true});
let socket;
let nextId = 1;
const pending = new Map();
async function waitForPage() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chrome.exitCode !== null) throw new Error("Chrome exited before the page opened");
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      const tabs = await response.json();
      const page = tabs.find(tab => tab.type === "page" && tab.url.includes("upgrade.html"));
      if (page) return page;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Chrome DevTools page was not available");
}
async function connect(url) {
  socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, {once: true});
    socket.addEventListener("error", reject, {once: true});
  });
  socket.addEventListener("message", event => {
    const packet = JSON.parse(event.data);
    const entry = pending.get(packet.id);
    if (!entry) return;
    pending.delete(packet.id);
    if (packet.error) entry.reject(new Error(JSON.stringify(packet.error)));
    else entry.resolve(packet.result);
  });
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params}));
  });
}
async function evaluate(expression) {
  const packet = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true});
  if (packet.exceptionDetails) throw new Error(packet.exceptionDetails.text);
  return packet.result.value;
}
try {
  const page = await waitForPage();
  await connect(page.webSocketDebuggerUrl);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(window.UpgradeLab)")) break;
    if (attempt === 99) throw new Error("UpgradeLab did not initialize");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const smoke = await evaluate("(function() {" +
    "const canvas=document.getElementById('upgradeGame');" +
    "function click(kind) { const seed=Number(document.getElementById('upgradeSeed').textContent);" +
    "const level=Number(document.getElementById('upgradeLevel').textContent);" +
    "const panel=window.UpgradeLab.makeFrame(seed,level).panels.find(p=>kind===0?p.kind===0:p.kind!==0);" +
    "const box=canvas.getBoundingClientRect(); const b=panel.bbox;" +
    "canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:box.left+(b[0]+b[2]/2)*box.width/960," +
    "clientY:box.top+(b[1]+b[3]/2)*box.height/576})); }" +
    "click(1); if(Number(document.getElementById('upgradeLevel').textContent)!==1 ||" +
    "Number(document.getElementById('upgradeMisses').textContent)!==1) throw Error('Wrong-click check failed');" +
    "for(let i=0;i<10;i++) click(0);" +
    "if(Number(document.getElementById('upgradeLevel').textContent)!==11) throw Error('Upgrade sequence failed');" +
    "for(const variant of ['layout','layout_mimic']) {" +
    "const select=document.getElementById('upgradeScenario'); select.value=variant;" +
    "select.dispatchEvent(new Event('change',{bubbles:true}));" +
    "for(let i=0;i<10;i++) click(0);" +
    "if(Number(document.getElementById('upgradeLevel').textContent)!==11) throw Error('Variant gameplay failed: '+variant);}" +
    "return 'wrong-click and all level 1-to-11 scenario gameplay passed';})()");
  process.stdout.write("Gameplay smoke: " + smoke + "\n");
  await evaluate("window.UpgradeLab.setSeedOffset(" + seedOffset + ")");
  const manifest = JSON.parse(await evaluate("JSON.stringify(window.UpgradeLab." + (studyMode ? "studyManifest" : "manifest") + "())"));
  const samples = [];
  for (const split of ["train", "val", "test"]) {
    for (let sessionIndex = 0; sessionIndex < manifest.plan[split].sessions; sessionIndex++) {
      const stepCount = manifest.plan[split].levels.length + 1;
      for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
        const expression = "JSON.stringify(window.UpgradeLab." + (studyMode ? "captureStudy" : "capture") + "(" +
          JSON.stringify(split) + "," + sessionIndex + "," + stepIndex + "))";
        const sample = JSON.parse(await evaluate(expression));
        if (!sample.image.startsWith("data:image/png;base64,")) throw new Error("Invalid Canvas PNG");
        samples.push(sample);
        if (split === "test" && sample.level === 11 && sample.step === 1 &&
            (sessionIndex === 0 || (studyMode && (sessionIndex === 8 || sessionIndex === 16)))) {
          const suffix = studyMode && sessionIndex !== 0 ? "-" + sample.scenario : "";
          const destination = suffix
            ? path.join(path.dirname(previewPath), path.parse(previewPath).name + suffix + path.extname(previewPath))
            : previewPath;
          await fs.writeFile(destination, Buffer.from(sample.image.split(",")[1], "base64"));
        }
      }
      process.stdout.write(split + " session " + (sessionIndex + 1) + " / " + manifest.plan[split].sessions + "\n");
    }
  }
  const payload = {...manifest, createdAt: new Date().toISOString(), samples};
  await fs.writeFile(datasetPath, JSON.stringify(payload));
  process.stdout.write("Saved " + samples.length + " browser-rendered screens: " + datasetPath + "\n");
  process.stdout.write("11-level preview: " + previewPath + "\n");
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send("Browser.close"); } catch {}
    socket.close();
  }
  if (chrome.exitCode === null) chrome.kill();
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (path.resolve(profile).startsWith(tempRoot) && path.basename(profile).startsWith("rune-upgrade-chrome-")) {
    await fs.rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 250}).catch(() => {});
  }
}
