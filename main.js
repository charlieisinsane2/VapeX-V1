(() => {
  const MANAGER_URL = 'https://raw.githubusercontent.com/charlieisinsane2/VapeX-V1/main/manager.json'; 


  let wsInstance = null;
  let yourEntityId = null;

  const modulesByCategory = {};

  const mouse = { left: false, right: false };
  window.addEventListener('mousedown', e => {
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) mouse.right = true;
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });


  const logs = [];
  let hudVisible = true;
  const hud = document.createElement('div');
  hud.style.position = 'fixed';
  hud.style.bottom = '5px';
  hud.style.right = '5px';
  hud.style.width = '320px';
  hud.style.maxHeight = '200px';
  hud.style.overflow = 'hidden';
  hud.style.fontFamily = 'monospace';
  hud.style.fontSize = '12px';
  hud.style.color = '#eee';
  hud.style.background = 'rgba(0,0,0,0.6)';
  hud.style.borderRadius = '8px';
  hud.style.padding = '6px 8px';
  hud.style.zIndex = 999999;
  hud.style.userSelect = 'none';
  document.body.appendChild(hud);

  function addLog(text, color = '#fff') {
    const time = Date.now();
    logs.push({ text, color, time });
    if (logs.length > 50) logs.shift();
    renderHUD();
  }
  function renderHUD() {
    if (!hudVisible) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = 'block';
    const now = Date.now();
    const visibleLogs = logs.filter(log => now - log.time < 10000);
    hud.innerHTML = visibleLogs
      .map(log => {
        const age = now - log.time;
        const opacity = 1 - age / 10000;
        return `<div style="color:${log.color};opacity:${opacity.toFixed(2)}">${log.text}</div>`;
      })
      .join('');
  }


  function readVarInt(bytes, pos) {
    let numRead = 0;
    let result = 0;
    let read;
    do {
      read = bytes[pos + numRead];
      let value = read & 0b01111111;
      result |= value << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error('VarInt too big');
    } while ((read & 0b10000000) !== 0);
    return { value: result, size: numRead };
  }
  function writeVarInt(value) {
    const bytes = [];
    do {
      let temp = value & 0x7f;
      value >>>= 7;
      if (value !== 0) temp |= 0x80;
      bytes.push(temp);
    } while (value !== 0);
    return bytes;
  }


  let playerPos = { x: 0, y: 0, z: 0, onGround: true };


  const OriginalWebSocket = window.WebSocket;
  function HookedWebSocket(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    wsInstance = ws;

    const originalSend = ws.send;
    ws.send = function(data) {

      try {
        modulesForEach(m => m.onSend && m.onSend(data));
      } catch (e) {
        addLog(`[Error] onSend: ${e.message}`, '#f88');
      }
      return originalSend.call(this, data);
    };

    ws.addEventListener('message', event => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      const id = bytes[0];
      try {

        switch (id) {
          case 0x01: { 
            const { value: eid } = readVarInt(bytes, 1);
            yourEntityId = eid;
            addLog(`[Client] Joined game as entity ${yourEntityId}`, '#6cf');
            break;
          }
          case 0x0D: { 
            if (bytes.length < 34) break;
            const dataView = new DataView(event.data);
            playerPos.x = dataView.getFloat64(1, false);
            playerPos.y = dataView.getFloat64(9, false);
            playerPos.z = dataView.getFloat64(17, false);
            playerPos.onGround = bytes[33] !== 0;
            break;
          }
        }

        // Let all modules process incoming packets
        modulesForEach(m => m.onPacket && m.onPacket(bytes, id));

      } catch (e) {
        addLog(`[Error] Packet processing failed: ${e.message}`, '#f88');
      }
    });

    return ws;
  }
  HookedWebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket = HookedWebSocket;

  // Helper: iterate all modules flat
  function modulesForEach(fn) {
    for (const cat in modulesByCategory) {
      for (const modName in modulesByCategory[cat]) {
        fn(modulesByCategory[cat][modName]);
      }
    }
  }


  async function loadModules() {
    addLog(`[Loader] Fetching manager.json from ${MANAGER_URL}`, '#6cf');
    try {
      const res = await fetch(MANAGER_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      for (const modDef of data.modules) {
        const { name, category, url } = modDef;
        addLog(`[Loader] Loading module "${name}" from ${url}`, '#6cf');

        try {

          const modCodeRes = await fetch(url);
          if (!modCodeRes.ok) throw new Error(`HTTP ${modCodeRes.status} for module ${name}`);
          const modCode = await modCodeRes.text();


          const wrapperFunc = new Function('registerModule', modCode);


          wrapperFunc(registerModule);

        } catch (e) {
          addLog(`[Loader] Failed to load module "${name}": ${e.message}`, '#f88');
        }
      }

    } catch (e) {
      addLog(`[Loader] Failed to fetch manager.json: ${e.message}`, '#f88');
    }
  }


  function registerModule(mod) {
    if (!mod.name || !mod.category) {
      addLog(`[Register] Module missing name or category`, '#f88');
      return;
    }
    if (!modulesByCategory[mod.category]) modulesByCategory[mod.category] = {};
    if (modulesByCategory[mod.category][mod.name]) {
      addLog(`[Register] Module name collision: ${mod.name}`, '#f88');
      return;
    }
    mod.enabled = false; 
    modulesByCategory[mod.category][mod.name] = mod;
    addLog(`[Register] Module "${mod.name}" registered in category "${mod.category}"`, '#6cf');


    try {
      if (mod.init) mod.init();
    } catch (e) {
      addLog(`[Register] Module "${mod.name}" init error: ${e.message}`, '#f88');
    }
  }

  let clickGUIOpen = false;
  const clickGUI = document.createElement('div');
  clickGUI.style.position = 'fixed';
  clickGUI.style.top = '40px';
  clickGUI.style.left = '40px';
  clickGUI.style.width = '350px';
  clickGUI.style.maxHeight = '70vh';
  clickGUI.style.overflowY = 'auto';
  clickGUI.style.background = 'rgba(15, 15, 15, 0.95)';
  clickGUI.style.border = '1px solid #555';
  clickGUI.style.borderRadius = '8px';
  clickGUI.style.color = '#eee';
  clickGUI.style.fontFamily = 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif';
  clickGUI.style.fontSize = '14px';
  clickGUI.style.zIndex = 9999999;
  clickGUI.style.padding = '12px';
  clickGUI.style.userSelect = 'none';
  clickGUI.style.display = 'none';
  clickGUI.style.boxShadow = '0 0 10px #00ff88';

  // Header
  const header = document.createElement('div');
  header.textContent = 'Closet Client - Vape V4 Style ClickGUI';
  header.style.fontWeight = '700';
  header.style.fontSize = '18px';
  header.style.marginBottom = '12px';
  clickGUI.appendChild(header);


  const categoriesContainer = document.createElement('div');
  clickGUI.appendChild(categoriesContainer);

  document.body.appendChild(clickGUI);

  function buildClickGUI() {
    categoriesContainer.innerHTML = '';
    for (const category in modulesByCategory) {
      const catDiv = document.createElement('div');
      catDiv.style.marginBottom = '16px';


      const catTitle = document.createElement('div');
      catTitle.textContent = category;
      catTitle.style.fontWeight = '600';
      catTitle.style.fontSize = '16px';
      catTitle.style.marginBottom = '8px';
      catTitle.style.borderBottom = '1px solid #444';
      catDiv.appendChild(catTitle);


      for (const modName in modulesByCategory[category]) {
        const mod = modulesByCategory[category][modName];
        const modDiv = document.createElement('div');
        modDiv.style.display = 'flex';
        modDiv.style.alignItems = 'center';
        modDiv.style.justifyContent = 'space-between';
        modDiv.style.marginBottom = '6px';

  
        const label = document.createElement('label');
        label.style.cursor = 'pointer';
        label.textContent = mod.name;


        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = mod.enabled;
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => {
          mod.enabled = checkbox.checked;
          addLog(`[Module] ${mod.name} toggled ${mod.enabled ? 'ON' : 'OFF'}`, '#6cf');
          if (mod.enabled && mod.onEnable) mod.onEnable();
          if (!mod.enabled && mod.onDisable) mod.onDisable();
          if (mod.name === 'AutoClicker') restartAutoClicker();
        });

        modDiv.appendChild(label);
        modDiv.appendChild(checkbox);

        catDiv.appendChild(modDiv);
      }

      categoriesContainer.appendChild(catDiv);
    }
  }


  window.addEventListener('keydown', e => {
    if (e.code === 'ShiftRight' && !e.repeat) {
      clickGUIOpen = !clickGUIOpen;
      clickGUI.style.display = clickGUIOpen ? 'block' : 'none';
      if (clickGUIOpen) buildClickGUI();
      e.preventDefault();
    }
  });


  let autoClickerInterval = null;
  function restartAutoClicker() {
    if (autoClickerInterval) clearInterval(autoClickerInterval);
    const mod = getModuleByName('AutoClicker');
    if (!mod || !mod.enabled) return;
    const cps = 10;
    const delay = 1000 / cps;
    autoClickerInterval = setInterval(() => {
      if (!wsInstance || wsInstance.readyState !== 1) return;
      if (!mouse.left && !mouse.right) return;
      try {
        const attackPacket = new Uint8Array([0x07, 0x00]);
        wsInstance.send(attackPacket.buffer);
        addLog(`[AutoClicker] Sent attack packet`, '#fc0');
      } catch {}
    }, delay);
  }

  function getModuleByName(name) {
    for (const cat in modulesByCategory) {
      if (modulesByCategory[cat][name]) return modulesByCategory[cat][name];
    }
    return null;
  }


  function isNearEdge() {
    const threshold = 0.3;
    const fracX = playerPos.x - Math.floor(playerPos.x);
    const fracZ = playerPos.z - Math.floor(playerPos.z);
    return fracX < threshold || fracX > 1 - threshold || fracZ < threshold || fracZ > 1 - threshold;
  }


  let crouching = false;


  setInterval(() => {
    modulesForEach(mod => {
      if (mod.enabled && mod.onTick) {
        try { mod.onTick(); } catch (e) { addLog(`[Error] ${mod.name} onTick: ${e.message}`, '#f88'); }
      }
    });


    const autoCrouch = getModuleByName('AutoCrouch');
    if (autoCrouch && autoCrouch.enabled && yourEntityId !== null) {
      if (isNearEdge()) {
        if (!crouching) {
          sendPlayerAction(yourEntityId, 1, false);
          crouching = true;
          addLog('[AutoCrouch] Crouch ON', '#6cf');
        }
      } else if (crouching) {
        sendPlayerAction(yourEntityId, 2, false);
        crouching = false;
        addLog('[AutoCrouch] Crouch OFF', '#6cf');
      }
    }

    renderHUD();
  }, 100);


  function sendPlayerAction(entityId, action, jumping) {
    if (!wsInstance || wsInstance.readyState !== 1) return;
    const varEntityId = writeVarInt(entityId);
    const varAction = writeVarInt(action);
    const jumpByte = jumping ? 1 : 0;
    const packetLength = 1 + varEntityId.length + varAction.length + 1;
    const packet = new Uint8Array(packetLength);
    let offset = 0;
    packet[offset++] = 0x03; 
    for (const b of varEntityId) packet[offset++] = b;
    for (const b of varAction) packet[offset++] = b;
    packet[offset++] = jumpByte;
    wsInstance.send(packet.buffer);
  }


  registerModule({
    name: 'AutoJump',
    category: 'Combat',
    enabled: false,
    onPacket(bytes, id) {
      if (id === 0x12) {
        const { value: entityId } = readVarInt(bytes, 1);
        if (entityId === yourEntityId) {

          if (playerPos.onGround) {
            sendJump();
            addLog('[AutoJump] You were hit! Jump sent.', '#f00');
          }
        }
      }
    }
  });


  function sendJump() {
    if (!wsInstance || wsInstance.readyState !== 1) return;
    const jumpPacket = new Uint8Array([0x03, 0x10]);
    wsInstance.send(jumpPacket.buffer);
  }


  loadModules().then(() => {
    addLog('[Loader] Finished loading all modules.', '#6cf');
  });


  addLog('[InjectClient] Loaded core and started loader.', '#6cf');
})();
