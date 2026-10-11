"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });
const BOARD = { x: 36, y: 91, cols: 10, rows: 7, tile: 64 };
const COLORS = [
  { floor: "#1f3040", alt: "#25394b", wall: "#3e5869", edge: "#667d86", glow: "#7fd5ca", name: "침수된 기록실" },
  { floor: "#2d263f", alt: "#392d4c", wall: "#5b4a71", edge: "#8c719c", glow: "#daa6f3", name: "자수정 도서관" },
  { floor: "#3a2e2b", alt: "#463630", wall: "#78574c", edge: "#af7760", glow: "#f1ba7e", name: "황혼의 보관실" },
  { floor: "#21383a", alt: "#294247", wall: "#466b6b", edge: "#76a9a0", glow: "#8cd8ba", name: "이끼 정원" }
];
const TARGETS = [
  { id: "sun", name: "태양 룬", glyph: "✦", color: "#ffc86a", hint: "빛나는 여섯 갈래 중심을 찾아보세요" },
  { id: "moon", name: "초승 룬", glyph: "☾", color: "#c8d8ff", hint: "안쪽이 파인 은빛 초승달이에요" },
  { id: "spark", name: "번개 룬", glyph: "ϟ", color: "#9fe6da", hint: "접힌 선이 아래로 뻗은 번개예요" },
  { id: "drop", name: "물방울 룬", glyph: "◆", color: "#91c7ff", hint: "뾰족한 꼭대기와 둥근 밑부분을 보세요" }
];
const $ = id => document.getElementById(id);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(values, rng) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function cells() {
  const out = [];
  for (let row = 0; row < BOARD.rows; row++) for (let col = 0; col < BOARD.cols; col++) {
    if ((row === 3 && col < 3) || (row === 3 && col === 9)) continue;
    out.push({ col, row });
  }
  return out;
}
function center(col, row) {
  return { x: BOARD.x + (col + .5) * BOARD.tile, y: BOARD.y + (row + .5) * BOARD.tile };
}
function makeScene(seed, room, phase = 0) {
  const rng = mulberry32((seed ^ Math.imul(room + 1, 0x9e3779b1) ^ Math.imul(phase + 1, 0x85ebca6b)) >>> 0);
  const palette = COLORS[(room + Math.floor(seed % 4)) % COLORS.length];
  const slots = shuffle(cells(), rng);
  const objects = [];
  const ids = TARGETS.map(x => x.id).concat(["falseSun", "falseMoon", "falseSpark", "falseDrop"]);
  for (let i = 0; i < ids.length; i++) {
    const { col, row } = slots[i];
    const c = center(col, row);
    const state = Math.floor(rng() * 3);
    const visible = !(phase === 2 && i === (room + 1) % 4);
    objects.push({ id: ids[i], col, row, x: c.x, y: c.y, state, visible, occluded: i === (room + phase + 2) % 8, collected: false, bbox: [c.x - 21, c.y - 21, 42, 42] });
  }
  const props = slots.slice(8, 15).map((slot, i) => ({ ...slot, kind: i % 3 }));
  return { seed, room, phase, palette, objects, props, player: { col: 1, row: 3 }, targetIndex: 0, mistakes: 0 };
}

function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function polygon(cx, cy, n, outer, inner, angle = 0) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = angle + i * Math.PI / n;
    const radius = i % 2 ? inner : outer;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
function drawRune(obj, time, transparent = false) {
  if (!obj.visible || obj.collected) return;
  const { x, y, state, id } = obj;
  const isFalse = id.startsWith("false");
  const base = id.replace("false", "").toLowerCase();
  const pulse = 1 + (state === 2 ? .07 * Math.sin(time / 240 + x) : 0);
  const familyColor = ({ sun: "#ffd27c", moon: "#dbe3ff", spark: "#a8f0df", drop: "#9ed6ff" })[base];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  if (!transparent) {
    ctx.shadowColor = familyColor;
    ctx.shadowBlur = state === 1 ? 18 : 7;
    ctx.fillStyle = "#344057";
    ctx.strokeStyle = "#d7b887";
    ctx.lineWidth = 2.7;
    polygon(0, 0, 6, 22, 18, Math.PI / 6);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    polygon(0, 0, 6, 16.5, 14, Math.PI / 6);
    ctx.fillStyle = "#192a3d";
    ctx.fill();
  }
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const tint = familyColor;
  ctx.fillStyle = tint;
  ctx.strokeStyle = tint;
  if (base === "sun") {
    polygon(0, 0, isFalse ? 5 : 6, 13, 6, -Math.PI / 2);
    ctx.fill();
    ctx.beginPath();ctx.arc(0, 0, isFalse ? 1.7 : 3, 0, Math.PI * 2);
    ctx.fillStyle = "#254050";ctx.fill();
  } else if (base === "moon") {
    ctx.beginPath();ctx.arc(-1, 0, 12, .42, 5.86);ctx.lineTo(2, -9);ctx.quadraticCurveTo(isFalse ? 0 : -7, 0, 3, 10);ctx.closePath();ctx.fill();
    if (isFalse) {ctx.beginPath();ctx.arc(8, -8, 2, 0, Math.PI * 2);ctx.fill();}
  } else if (base === "spark") {
    ctx.beginPath();ctx.moveTo(3, -14);ctx.lineTo(-7, 1);ctx.lineTo(1, 1);ctx.lineTo(isFalse ? -2 : -3, 14);ctx.lineTo(11, -3);ctx.lineTo(3, -3);ctx.closePath();ctx.fill();
    if (isFalse) {ctx.fillStyle="#192a3d";ctx.fillRect(-2,-1,4,5);}
  } else {
    ctx.beginPath();ctx.moveTo(0,-14);ctx.bezierCurveTo(8,-4,11,0,10,5);ctx.bezierCurveTo(8,15,-8,15,-10,5);ctx.bezierCurveTo(-11,0,-7,-5,0,-14);ctx.fill();
    if (isFalse) {ctx.strokeStyle="#192a3d";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-5,4);ctx.lineTo(5,4);ctx.stroke();}
  }
  if (state === 2 && !isFalse) {
    ctx.strokeStyle = "#fff3d1";ctx.globalAlpha=.55;ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

function render(scene, time = 0, benchmark = false) {
  const p = scene.palette;
  ctx.fillStyle = "#101a28";ctx.fillRect(0, 0, 960, 576);
  ctx.fillStyle = "#122035";ctx.fillRect(0, 0, 960, 70);
  ctx.fillStyle = "#f2d5a9";ctx.font = "bold 16px Malgun Gothic, sans-serif";
  ctx.fillText("RUNE HUNT", 34, 31);
  ctx.fillStyle = "#8caac4";ctx.font = "11px Malgun Gothic, sans-serif";
  ctx.fillText("AN OBJECT RECOGNITION FIELD TEST", 35, 49);
  ctx.fillStyle = "#cad7e8";ctx.font = "bold 14px Malgun Gothic, sans-serif";
  ctx.fillText(p.name, 404, 32);
  ctx.font = "11px Malgun Gothic, sans-serif";
  ctx.fillStyle = "#8caac4";ctx.fillText(`ROOM ${scene.room + 1}   •   ${benchmark ? "BENCHMARK" : "EXPLORE"}`, 404, 51);
  ctx.fillStyle = "#f2d5a9";ctx.font = "bold 12px Malgun Gothic, sans-serif";
  ctx.fillText("THE RELIC LEDGER", 733, 117);
  ctx.fillStyle = "#8aa2b9";ctx.font = "12px Malgun Gothic, sans-serif";
  ctx.fillText("Find the true forms.", 733, 142);
  for (let row = 0; row < BOARD.rows; row++) for (let col = 0; col < BOARD.cols; col++) {
    const { x, y } = center(col, row);
    ctx.fillStyle = (row + col) % 2 ? p.floor : p.alt;
    ctx.fillRect(x - 32, y - 32, 64, 64);
    ctx.strokeStyle = "#ffffff0a";ctx.lineWidth=1;ctx.strokeRect(x - 31.5, y - 31.5, 63, 63);
    if ((row * 17 + col * 7 + scene.seed) % 11 === 0) {
      ctx.strokeStyle="#ffffff12";ctx.beginPath();ctx.moveTo(x-20,y+18);ctx.lineTo(x+7,y+18);ctx.lineTo(x+15,y+13);ctx.stroke();
    }
  }
  ctx.strokeStyle = p.wall;ctx.lineWidth=12;ctx.strokeRect(BOARD.x-4, BOARD.y-4, BOARD.cols*64+8, BOARD.rows*64+8);
  ctx.strokeStyle = p.edge;ctx.lineWidth=2;ctx.strokeRect(BOARD.x-4, BOARD.y-4, BOARD.cols*64+8, BOARD.rows*64+8);
  const door = center(9,3);ctx.fillStyle="#294e56";ctx.fillRect(door.x+15,door.y-29,22,58);ctx.fillStyle=p.glow;ctx.fillRect(door.x+17,door.y-23,3,46);
  for (const prop of scene.props) {
    const {x,y}=center(prop.col,prop.row);
    ctx.fillStyle=prop.kind===0?"#5a6772":prop.kind===1?"#475b60":"#554e60";
    roundedRect(x-15,y-11,30,22,4);ctx.fill();
    ctx.strokeStyle="#95a4a366";ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-8,y+2);ctx.lineTo(x+7,y-3);ctx.stroke();
  }
  scene.objects.forEach(obj => drawRune(obj,time));
  scene.objects.filter(obj=>obj.occluded && obj.visible && !obj.collected).forEach(obj=>{
    ctx.fillStyle = "#4b5962e8";roundedRect(obj.x-22,obj.y+8,44,11,3);ctx.fill();
    ctx.strokeStyle="#8795a077";ctx.lineWidth=1;ctx.stroke();
  });
  if (!benchmark) {
    const pp=center(scene.player.col,scene.player.row);
    ctx.fillStyle="#0007";ctx.beginPath();ctx.ellipse(pp.x,pp.y+17,15,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#ecba82";ctx.beginPath();ctx.arc(pp.x,pp.y-7,10,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#71aec5";roundedRect(pp.x-11,pp.y+2,22,18,6);ctx.fill();
    ctx.fillStyle="#324b62";ctx.fillRect(pp.x-9,pp.y+18,6,6);ctx.fillRect(pp.x+3,pp.y+18,6,6);
  }
  for (let i=0;i<TARGETS.length;i++) {
    const t=TARGETS[i];const yy=187+i*70;
    ctx.fillStyle=i===scene.targetIndex && !benchmark?"#2b4358":"#1a2a3c";roundedRect(721,yy-29,202,54,9);ctx.fill();
    ctx.fillStyle=t.color;ctx.font="bold 28px Segoe UI Symbol, Malgun Gothic, sans-serif";ctx.fillText(t.glyph,736,yy+5);
    ctx.fillStyle="#d8e5f3";ctx.font="bold 12px Malgun Gothic, sans-serif";ctx.fillText(t.name,779,yy-1);
    ctx.fillStyle="#8096ab";ctx.font="10px Malgun Gothic, sans-serif";ctx.fillText(["SUN","MOON","SPARK","DROP"][i],779,yy+14);
  }
  ctx.fillStyle="#91a9bb";ctx.font="11px Malgun Gothic, sans-serif";
  ctx.fillText(benchmark?"Fixed grid • unknown positions":"Move near a rune, then press Space",727,530);
}

let gameSeed = Math.floor(Math.random() * 9000000) + 1000000;
let scene = makeScene(gameSeed, 0, 0);
let room = 0;
let score = 0;
let mistakes = 0;

function updateUI() {
  $("seedValue").textContent=gameSeed;
  $("roomStat").textContent=`${Math.min(room+1,3)} / 3`;
  $("scoreStat").textContent=`${score} / 12`;
  $("mistakeStat").textContent=mistakes;
  const target=TARGETS[Math.min(scene.targetIndex,3)];
  $("targetGlyph").textContent=scene.targetIndex>=4?"✓":target.glyph;
  $("targetGlyph").style.color=scene.targetIndex>=4?"#83dfb7":target.color;
  $("targetName").textContent=scene.targetIndex>=4?"방 완료":target.name;
  $("targetHint").textContent=scene.targetIndex>=4?"다음 방으로 이동하세요":target.hint;
  $("progressDots").innerHTML=TARGETS.map((_,i)=>`<i class="${i<scene.targetIndex?"on":""}"></i>`).join("");
  $("nextRoomBtn").disabled=scene.targetIndex<4;
  $("nextRoomBtn").textContent=room===2?"새 게임 시작 ↻":"다음 방으로 이동 →";
}
function setMessage(text, tone="") { const e=$("message");e.textContent=text;e.className=`message ${tone}`; }
function restart(newSeed=false) {
  if(newSeed){gameSeed=Math.floor(Math.random()*9000000)+1000000;room=0;score=0;mistakes=0;}
  scene=makeScene(gameSeed,room,0);updateUI();setMessage("진짜 룬을 찾아 가까이 이동해 Space를 누르세요.");
}
function move(dx,dy) {
  scene.player.col=Math.max(0,Math.min(BOARD.cols-1,scene.player.col+dx));
  scene.player.row=Math.max(0,Math.min(BOARD.rows-1,scene.player.row+dy));
  if(scene.targetIndex===4&&scene.player.col===9&&scene.player.row===3) nextRoom();
}
function collect() {
  const nearby=scene.objects.filter(obj=>obj.visible&&!obj.collected&&Math.abs(obj.col-scene.player.col)<=1&&Math.abs(obj.row-scene.player.row)<=1);
  if(!nearby.length){setMessage("이 주변에는 수집할 룬이 없어요.");return;}
  nearby.sort((a,b)=>(Math.abs(a.col-scene.player.col)+Math.abs(a.row-scene.player.row))-(Math.abs(b.col-scene.player.col)+Math.abs(b.row-scene.player.row)));
  const obj=nearby[0];const current=TARGETS[scene.targetIndex];
  if(current&&obj.id===current.id){obj.collected=true;scene.targetIndex++;score++;setMessage(scene.targetIndex===4?"이 방의 룬을 모두 찾았습니다. 다음 방으로 이동하세요!":`${current.name} 수집 성공!`,"good");}
  else{mistakes++;setMessage("비슷하게 생겼지만 목표 룬이 아니에요. 중심 모양을 살펴보세요.","bad");}
  updateUI();
}
function nextRoom(){if(scene.targetIndex<4)return;if(room>=2){restart(true);return;}room++;scene=makeScene(gameSeed,room,0);updateUI();setMessage(`새로운 방: ${scene.palette.name}. 룬의 위치와 배경이 달라졌습니다.`);}
document.addEventListener("keydown",event=>{
  const key=event.key.toLowerCase();
  if(["arrowup","arrowdown","arrowleft","arrowright"," "].includes(key))event.preventDefault();
  if(key==="arrowup"||key==="w")move(0,-1);
  else if(key==="arrowdown"||key==="s")move(0,1);
  else if(key==="arrowleft"||key==="a")move(-1,0);
  else if(key==="arrowright"||key==="d")move(1,0);
  else if(key===" ")collect();
  else if(key==="r")restart();
});
$("newGameBtn").addEventListener("click",()=>restart(true));
$("nextRoomBtn").addEventListener("click",nextRoom);
function animate(t){render(scene,t);requestAnimationFrame(animate);}requestAnimationFrame(animate);updateUI();

async function exportDataset() {
  const button=$("exportBtn");button.disabled=true;
  const status=$("exportStatus");status.textContent="화면을 생성하고 있습니다…";
  const samples=[];
  const splits=[["train",6],["val",3],["test",6]];
  let count=0;
  try {
    for(const [split,sessionCount] of splits) for(let s=0;s<sessionCount;s++) {
      const session=`${split}-${String(s+1).padStart(2,"0")}`;
      const baseSeed=(0x5192ab3d ^ Math.imul(s+1,0x9e3779b1) ^ (split==="train"?0x1a2b3c4d:split==="val"?0x55aa33cc:0x8833bb99))>>>0;
      for(let phase=0;phase<3;phase++) {
        const testScene=makeScene(baseSeed,s%4,phase);
        render(testScene,0,true);
        const image=canvas.toDataURL("image/png");
        samples.push({session,split,phase,room:testScene.room,theme:testScene.palette.name,image,objects:testScene.objects.filter(o=>o.visible).map(o=>({id:o.id,bbox:o.bbox,state:o.state,occluded:o.occluded}))});
        count++;status.textContent=`${count} / 45개 화면 생성 중…`;
        if(count%3===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    const payload={format:"rune-hunt-dataset-v1",createdAt:new Date().toISOString(),canvas:{width:960,height:576},board:BOARD,targets:TARGETS.map(({id,name})=>({id,name})),samples};
    const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
    const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="rune-hunt-dataset.json";document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(link.href),5000);
    status.textContent="45개 화면을 저장했습니다. README의 명령으로 비교하세요.";
  } catch(error) {status.textContent=`저장 실패: ${error.message}`;console.error(error);}
  finally{button.disabled=false;}
}
$("exportBtn").addEventListener("click",exportDataset);
window.RuneHuntLab={makeScene,render,exportDataset,getScene:()=>scene};
