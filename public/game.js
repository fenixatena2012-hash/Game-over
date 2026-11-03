import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const TYPES = {
  grass: { color: 0x69a94f, label: 'Grama', icon: '🟩' },
  dirt: { color: 0x8b6041, label: 'Terra', icon: '🟫' },
  stone: { color: 0x858b8b, label: 'Pedra', icon: '⬜' },
  wood: { color: 0x80532f, label: 'Madeira', icon: '🪵' },
  leaves: { color: 0x3f8449, label: 'Folhas', icon: '🌿' }
};
const KEY = 'playspace-wildlands-save-v1';

export async function initGame({ mount, socket, user, onToast }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bc8d0);
  scene.fog = new THREE.Fog(0x9bc8d0, 24, 68);
  const camera = new THREE.PerspectiveCamera(68, 1, .1, 120);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = false;
  mount.appendChild(renderer.domElement);
  const hemi = new THREE.HemisphereLight(0xe4f5ff, 0x536342, 2.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffedc4, 2.2); sun.position.set(-15, 25, 10); scene.add(sun);
  const world = new THREE.Group(); scene.add(world);
  const blockGeo = new THREE.BoxGeometry(1,1,1);
  const materials = Object.fromEntries(Object.entries(TYPES).map(([k,v]) => [k, new THREE.MeshLambertMaterial({color:v.color})]));
  const blocks = new Map();
  const blockKey = (x,y,z) => `${x},${y},${z}`;
  const inventory = { grass: 0, dirt: 0, stone: 0, wood: 0, leaves: 0 };
  let selected = 'dirt';
  let mineTarget = null, mineStart = 0, yaw = 0, pitch = .25, velocityY = 0, grounded = false;
  let chatFocused = false, inventoryOpen = false, lastNet = 0, lastFrame = performance.now();
  const player = new THREE.Group(); scene.add(player);
  const bodyMat = new THREE.MeshLambertMaterial({color:0x4b7bba});
  const skinMat = new THREE.MeshLambertMaterial({color:0xe0b58c});
  const body = new THREE.Mesh(new THREE.BoxGeometry(.65,.85,.38), bodyMat); body.position.y=1.05; player.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.48,.48,.48), skinMat); head.position.y=1.72; player.add(head);
  for (const x of [-.19,.19]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.22,.65,.25), new THREE.MeshLambertMaterial({color:0x344c6a})); leg.position.set(x,.33,0); player.add(leg); }
  const remotePlayers = new Map();
  const terrainHeight = (x,z) => Math.floor(1.2 + Math.sin(x*.23)*1.2 + Math.cos(z*.19)*1.0 + Math.sin((x+z)*.12)*.8);
  function addBlock(b, sync=false) {
    const key = blockKey(b.x,b.y,b.z);
    if (blocks.has(key)) return;
    const mesh = new THREE.Mesh(blockGeo, materials[b.type] || materials.dirt);
    mesh.position.set(b.x+.5,b.y+.5,b.z+.5); mesh.userData.block = b;
    world.add(mesh); blocks.set(key, mesh);
    if (sync) socket.emit('block:change', { action:'place', block:b });
  }
  function removeBlock(b, sync=false) {
    const key = blockKey(b.x,b.y,b.z), mesh = blocks.get(key);
    if (!mesh) return;
    world.remove(mesh); blocks.delete(key);
    if (sync) socket.emit('block:change', { action:'remove', block:b });
  }
  function tree(x,z) {
    const h = terrainHeight(x,z);
    for (let y=0;y<3;y++) addBlock({x,y:h+y,z,type:'wood'});
    for (let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++) for(let dy=2;dy<=4;dy++) {
      if (Math.abs(dx)+Math.abs(dz)+(dy===4?1:0)<5 && !(dx===0&&dz===0&&dy<3)) addBlock({x:x+dx,y:h+dy,z:z+dz,type:'leaves'});
    }
  }
  for(let x=-20;x<=20;x++) for(let z=-20;z<=20;z++) {
    const h=terrainHeight(x,z);
    for(let y=-2;y<=h;y++) addBlock({x,y,z,type:y===h?'grass':y>h-3?'dirt':'stone'});
  }
  for (const [x,z] of [[-7,-5],[-11,8],[7,4],[12,-8],[2,13],[-15,-10]]) tree(x,z);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(15,12), new THREE.MeshLambertMaterial({color:0x398fa6,transparent:true,opacity:.72}));
  water.rotation.x=-Math.PI/2; water.position.set(10,.1,10); scene.add(water);
  player.position.set(0, terrainHeight(0,0)+1.02, 0);
  camera.position.set(0, player.position.y+3, 6);

  function resize() {
    const w=mount.clientWidth||innerWidth,h=mount.clientHeight||innerHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }
  new ResizeObserver(resize).observe(mount); resize();

  function hasBlock(x,y,z) { return blocks.has(blockKey(Math.floor(x),Math.floor(y),Math.floor(z))); }
  function collides(px,py,pz) {
    const r=.28, minY=py, maxY=py+1.9;
    for(let x=Math.floor(px-r);x<=Math.floor(px+r);x++)
      for(let z=Math.floor(pz-r);z<=Math.floor(pz+r);z++)
        for(let y=Math.floor(minY);y<=Math.floor(maxY);y++) if(hasBlock(x,y,z)) return true;
    return false;
  }
  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code) && !chatFocused) e.preventDefault();
    keys.add(e.code);
    if(/^Digit[1-5]$/.test(e.code)) selectSlot(Number(e.code.slice(-1))-1);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  const pointers = new Map();
  let leftPointer=null,rightPointer=null,lastLook=null,moveVector={x:0,z:0};
  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.target.closest?.('button')) return;
    renderer.domElement.setPointerCapture(e.pointerId);
    const rect=renderer.domElement.getBoundingClientRect(), localX=e.clientX-rect.left;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
    if (e.pointerType==='touch') {
      if(localX<rect.width*.48 && leftPointer===null) leftPointer=e.pointerId;
      else if(rightPointer===null) {rightPointer=e.pointerId;lastLook={x:e.clientX,y:e.clientY};}
    } else { rightPointer=e.pointerId; lastLook={x:e.clientX,y:e.clientY}; }
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if(!pointers.has(e.pointerId)) return;
    const p=pointers.get(e.pointerId); p.x=e.clientX;p.y=e.clientY;
    if(e.pointerId===leftPointer) {
      const dx=(e.clientX-p.startX)/42,dz=(e.clientY-p.startY)/42;
      const len=Math.max(1,Math.hypot(dx,dz)); moveVector={x:dx/len*Math.min(1,len),z:dz/len*Math.min(1,len)};
    }
    if(e.pointerId===rightPointer && lastLook) {
      const dx=e.clientX-lastLook.x,dy=e.clientY-lastLook.y;
      yaw-=dx*.006; pitch=Math.max(-.35,Math.min(1.0,pitch+dy*.004));
      lastLook={x:e.clientX,y:e.clientY};
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if(e.pointerId===leftPointer){leftPointer=null;moveVector={x:0,z:0};}
    if(e.pointerId===rightPointer){rightPointer=null;lastLook=null;}
  }
  renderer.domElement.addEventListener('pointerup',endPointer);
  renderer.domElement.addEventListener('pointercancel',endPointer);
  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
  renderer.domElement.addEventListener('mousedown',e=>{if(e.button===0 && !('ontouchstart' in window)) mine(); if(e.button===2) build();});
  renderer.domElement.addEventListener('wheel',e=>{pitch=Math.max(-.35,Math.min(1,pitch+e.deltaY*.0005));},{passive:true});

  function targetBlock() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0,0),camera);
    const hits=ray.intersectObjects(world.children,false);
    return hits.length && hits[0].distance<6 ? {block:hits[0].object.userData.block,normal:hits[0].face.normal.clone()} : null;
  }
  function mine() {
    const hit=targetBlock(); if(!hit){onToast('Aponte para um bloco próximo.');return;}
    const b=hit.block; removeBlock(b,true);
    inventory[b.type]=(inventory[b.type]||0)+1; updateInventory();
    onToast(`${TYPES[b.type].label} coletada.`);
  }
  function build() {
    const hit=targetBlock(); if(!hit){onToast('Aponte para uma face de bloco.');return;}
    if((inventory[selected]||0)<1){onToast(`Você não tem ${TYPES[selected].label.toLowerCase()}.`);return;}
    const b=hit.block, n=hit.normal;
    const next={x:b.x+Math.round(n.x),y:b.y+Math.round(n.y),z:b.z+Math.round(n.z),type:selected};
    if(blocks.has(blockKey(next.x,next.y,next.z)) || (Math.abs(next.x-player.position.x)<.8 && Math.abs(next.z-player.position.z)<.8 && next.y<player.position.y+2)) {onToast('Não há espaço para construir.');return;}
    addBlock(next,true); inventory[selected]--; updateInventory();
  }
  function selectSlot(i) {
    const order=['dirt','grass','stone','wood','leaves']; selected=order[i]||'dirt';
    document.querySelectorAll('.hotbar button').forEach((b,j)=>b.classList.toggle('active',j===i));
  }
  function updateInventory() {
    const hotbar=document.getElementById('hotbar');
    hotbar.innerHTML=['dirt','grass','stone','wood','leaves'].map((k,i)=>`<button class="${selected===k?'active':''}" data-slot="${i}" title="${TYPES[k].label}">${TYPES[k].icon}<small>${inventory[k]||0}</small></button>`).join('');
    hotbar.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>selectSlot(Number(b.dataset.slot))));
    document.getElementById('inventoryGrid').innerHTML=Object.entries(TYPES).map(([k,v])=>`<div class="inventory-item">${v.icon} ${v.label}<b>${inventory[k]||0}</b></div>`).join('');
  }
  function toggleInventory(force) {
    inventoryOpen=typeof force==='boolean'?force:!inventoryOpen;
    document.getElementById('inventoryModal').classList.toggle('hidden',!inventoryOpen);
  }
  updateInventory();
  function save() {
    try {
      localStorage.setItem(KEY,JSON.stringify({inventory,blocks:Array.from(blocks.values()).map(m=>m.userData.block),position:player.position.toArray(),savedAt:new Date().toISOString()}));
      onToast('Progresso salvo neste navegador.');
    } catch { onToast('Não foi possível salvar neste navegador.'); }
  }
  try {
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved) {
      if(saved.inventory) Object.assign(inventory,saved.inventory);
      if(Array.isArray(saved.blocks)) {
        // O mundo sincronizado recebe primeiro o estado do servidor; blocos locais são restaurados como cópia visual.
        for(const b of saved.blocks) if(b && TYPES[b.type] && Number.isInteger(b.x)) addBlock(b);
      }
      if(Array.isArray(saved.position) && saved.position.length===3) player.position.fromArray(saved.position);
      updateInventory();
    }
  } catch {}
  function sendChat(message){socket.emit('chat:send',{message});}
  function addChat(data) {
    const el=document.getElementById('chatMessages'), line=document.createElement('div');
    line.className='chat-line';
    const name=document.createElement('b'); name.textContent=data.username+': ';
    const msg=document.createElement('span'); msg.textContent=data.message;
    line.append(name,msg); el.append(line); el.scrollTop=el.scrollHeight;
  }
  function updatePlayers(list) {
    const el=document.getElementById('playersList'); el.innerHTML='';
    list.forEach(p=>{const span=document.createElement('span');span.textContent=`${p.avatar||'🧭'} ${p.username}`;el.append(span);});
    document.getElementById('playerCount').textContent=String(list.length);
  }
  socket.on('connect',()=>{document.getElementById('connectionState').textContent='Conectado';socket.emit('world:join',{room:'wildlands-public'});});
  socket.on('disconnect',()=>{document.getElementById('connectionState').textContent='Reconectando...';});
  socket.on('world:state',data=>{
    for(const b of data.blocks||[]) if(TYPES[b.type]) addBlock(b);
    for(const p of data.players||[]) if(p.id!==socket.id) createRemote(p);
    updatePlayers(data.players||[]);
    onToast('Você entrou em Wildlands.');
  });
  function createRemote(p) {
    if(remotePlayers.has(p.id)) return;
    const group=new THREE.Group(), mat=new THREE.MeshLambertMaterial({color:0xc7f36b});
    const torso=new THREE.Mesh(new THREE.BoxGeometry(.6,.9,.38),mat);torso.position.y=1.05;group.add(torso);
    const h=new THREE.Mesh(new THREE.BoxGeometry(.45,.45,.45),skinMat);h.position.y=1.72;group.add(h);
    scene.add(group);remotePlayers.set(p.id,{group,data:p});
  }
  socket.on('player:joined',p=>{createRemote(p);addChat({username:'Sistema',message:`${p.username} entrou no mundo.`});});
  socket.on('player:moved',p=>{const r=remotePlayers.get(p.id);if(r){r.data=p;r.group.position.set(p.x,p.y,p.z);r.group.rotation.y=p.rotation;}});
  socket.on('player:left',p=>{const r=remotePlayers.get(p.id);if(r){scene.remove(r.group);remotePlayers.delete(p.id);}updatePlayers([...remotePlayers.values()].map(x=>x.data));});
  socket.on('block:changed',data=>{if(data.action==='place')addBlock(data.block);else removeBlock(data.block);});
  socket.on('chat:message',addChat);
  socket.on('server:error',d=>onToast(d.message||'Erro do servidor.'));
  function frame(now) {
    requestAnimationFrame(frame);
    const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
    const forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)-moveVector.z;
    const side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+moveVector.x;
    const len=Math.hypot(forward,side)||1, speed=(keys.has('ShiftLeft')?7:4.2);
    const dx=(Math.sin(yaw)*forward+Math.cos(yaw)*side)/len*speed*dt;
    const dz=(Math.cos(yaw)*forward-Math.sin(yaw)*side)/len*speed*dt;
    if(!inventoryOpen && !chatFocused) {
      if(!collides(player.position.x+dx,player.position.y,player.position.z)) player.position.x+=dx;
      if(!collides(player.position.x,player.position.y,player.position.z+dz)) player.position.z+=dz;
      const ground=terrainHeight(Math.round(player.position.x),Math.round(player.position.z))+.02;
      if((keys.has('Space')||jumpTouch) && grounded){velocityY=7.3;grounded=false;}
      velocityY-=19*dt;
      player.position.y+=velocityY*dt;
      if(player.position.y<=ground){player.position.y=ground;velocityY=0;grounded=true;}
      if(collides(player.position.x,player.position.y,player.position.z)){player.position.y+=.08;velocityY=0;}
    }
    player.rotation.y=yaw;
    const target=new THREE.Vector3(player.position.x,player.position.y+1.3,player.position.z);
    const offset=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch)*5,2.1+Math.sin(pitch)*5,Math.cos(yaw)*Math.cos(pitch)*5);
    camera.position.lerp(target.clone().add(offset),1-Math.pow(.001,dt));camera.lookAt(target);
    for(const r of remotePlayers.values()) r.group.position.lerp(new THREE.Vector3(r.data.x,r.data.y,r.data.z),.25);
    if(now-lastNet>80){lastNet=now;socket.emit('player:move',{x:player.position.x,y:player.position.y,z:player.position.z,rotation:yaw});}
    renderer.render(scene,camera);
  }
  let jumpTouch=false;
  document.querySelectorAll('.touch-controls button').forEach(btn=>{
    const action=btn.dataset.action;
    btn.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(action==='jump')jumpTouch=true;if(action==='mine')mine();if(action==='build')build();if(action==='inventory')toggleInventory();});
    btn.addEventListener('pointerup',()=>{if(action==='jump')jumpTouch=false;});
    btn.addEventListener('pointercancel',()=>{if(action==='jump')jumpTouch=false;});
  });
  function setChatFocused(v){chatFocused=v;}
  requestAnimationFrame(frame);
  return {save,toggleInventory,sendChat,setChatFocused};
}
