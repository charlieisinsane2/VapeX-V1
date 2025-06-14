(() => {
  const OriginalWebSocket = window.WebSocket;
  let wsInstance = null;
  let yourEntityId = null;
  let playerPosition = { x: 0, y: 0, z: 0 };
  let playerOnGround = true;
  const trackedEntities = new Map(); // entityId -> {x,y,z}
  let lastHitPacket = null;
  let infiniteAuraInterval = null;

  // Utils: safer VarInt reader
  function readVarInt(buffer, offset = 0) {
    let numRead = 0;
    let result = 0;
    let byte = 0;
    do {
      if (offset + numRead >= buffer.length) throw new Error("Buffer too short for VarInt");
      byte = buffer[offset + numRead];
      result |= (byte & 0x7F) << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error("VarInt too big");
    } while ((byte & 0x80) !== 0);
    return { value: result, size: numRead };
  }

  // Utils: Write VarInt
  function writeVarInt(value) {
    const bytes = [];
    do {
      let temp = value & 0x7F;
      value >>>= 7;
      if (value !== 0) temp |= 0x80;
      bytes.push(temp);
    } while (value !== 0);
    return new Uint8Array(bytes);
  }

  // Helper to send attack packet
  function sendAttackPacket(entityId) {
    if (!wsInstance || wsInstance.readyState !== 1) return;
    const PACKET_ID = 0x1E; // Use 1.8+ Attack Entity Packet ID
    const entityIdVarInt = writeVarInt(entityId);
    const packetIdVarInt = writeVarInt(PACKET_ID);
    // Packet = PacketLength + PacketID + EntityID
    // Length = length of packetID + entityId
    const length = packetIdVarInt.length + entityIdVarInt.length;
    const lengthVarInt = writeVarInt(length);

    const buffer = new Uint8Array(lengthVarInt.length + length);
    buffer.set(lengthVarInt, 0);
    buffer.set(packetIdVarInt, lengthVarInt.length);
    buffer.set(entityIdVarInt, lengthVarInt.length + packetIdVarInt.length);

    wsInstance.send(buffer);
  }

  // Color helpers for rainbow ESP
  function hsvToRgb(h, s, v) {
    let c = v * s;
    let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let m = v - c;
    let r=0,g=0,b=0;
    if (0 <= h && h < 60) [r,g,b] = [c,x,0];
    else if (60 <= h && h < 120) [r,g,b] = [x,c,0];
    else if (120 <= h && h < 180) [r,g,b] = [0,c,x];
    else if (180 <= h && h < 240) [r,g,b] = [0,x,c];
    else if (240 <= h && h < 300) [r,g,b] = [x,0,c];
    else [r,g,b] = [c,0,x];
    return {
      r: Math.round((r+m)*255),
      g: Math.round((g+m)*255),
      b: Math.round((b+m)*255)
    };
  }

  // Modules object
  const modules = {
    LoggerHUD: {
      enabled: true,
      logs: [],
      log(msg) {
        const timestamp = new Date().toLocaleTimeString();
        this.logs.push({ msg, timestamp, time: Date.now() });
        if (this.logs.length > 15) this.logs.shift();
      },
      render(ctx) {
        ctx.save();
        ctx.font = "14px 'Minecraft', monospace";
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(10, window.innerHeight - 180, 280, 160);
        for(let i=0; i<this.logs.length; i++) {
          const entry = this.logs[i];
          const alpha = 1 - ((Date.now() - entry.time)/10000);
          if (alpha <= 0) continue;
          ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
          ctx.fillText(`[${entry.timestamp}] ${entry.msg}`, 20, window.innerHeight - 160 + i*12);
        }
        ctx.restore();
      }
    },

    AutoClicker: {
      enabled: false,
      cps: 12,
      interval: null,
      toggle() {
        this.enabled = !this.enabled;
        modules.LoggerHUD.log(`AutoClicker ${this.enabled ? 'enabled' : 'disabled'}`);
        if (this.enabled) this.start();
        else this.stop();
      },
      start() {
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => {
          if (!wsInstance || wsInstance.readyState !== 1) return;
          if (!mouseDown) return;
          sendClickPacket();
        }, 1000 / this.cps);
      },
      stop() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
      }
    },

    AutoJump: {
      enabled: false,
      toggle() {
        this.enabled = !this.enabled;
        modules.LoggerHUD.log(`AutoJump ${this.enabled ? 'enabled' : 'disabled'}`);
      },
      onPacketReceive(packetId, data) {
        if (!this.enabled) return;
        if (packetId === 0x1D) { // Player Position and Look Update (on ground flag)
          playerOnGround = !!data[data.length - 1];
        }
      },
      tryJump() {
        if (!wsInstance || wsInstance.readyState !== 1) return;
        if (!playerOnGround) return;
        sendJumpPacket();
      }
    },

    AutoCrouch: {
      enabled: false,
      toggle() {
        this.enabled = !this.enabled;
        modules.LoggerHUD.log(`AutoCrouch ${this.enabled ? 'enabled' : 'disabled'}`);
      },
      update() {
        if (!this.enabled) return;
        if (!wsInstance || wsInstance.readyState !== 1) return;
        if (nearEdge()) {
          sendCrouchPacket(true);
        } else {
          sendCrouchPacket(false);
        }
      }
    },

    BlatantVelo: {
      enabled: false,
      toggle() {
        this.enabled = !this.enabled;
        modules.LoggerHUD.log(`BlatantVelo ${this.enabled ? 'enabled' : 'disabled'}`);
      },
      onPacketReceive(packetId, data) {
        if (!this.enabled) return false;
        if (packetId === 0x1F) { // Velocity packet (entity velocity)
          const entityIdVarInt = readVarInt(data, 0);
          const entityId = entityIdVarInt.value;
          if (entityId === yourEntityId) {
            // Cancel velocity by ignoring
            return true; // intercept and do not forward to game
          }
        }
        return false;
      }
    },

    InfiniteAura: {
      enabled: false,
      toggle() {
        this.enabled = !this.enabled;
        modules.LoggerHUD.log(`InfiniteAura ${this.enabled ? 'enabled' : 'disabled'}`);
        if (!this.enabled) {
          if (infiniteAuraInterval) {
            clearInterval(infiniteAuraInterval);
            infiniteAuraInterval = null;
          }
          lastHitPacket = null;
        } else {
          if (lastHitPacket) {
            startInfiniteAuraSpam();
          }
        }
      }
    },

    ESP: {
      enabled: true,
      render(ctx) {
        if (!this.enabled) return;
        ctx.save();
        ctx.lineWidth = 2;
        let time = Date.now();
        let hueBase = (time / 20) % 360;

        trackedEntities.forEach((pos, id) => {
          if (id === yourEntityId) return;
          const screenPos = worldToScreen(pos);
          if (!screenPos) return;
          const col = hsvToRgb((hueBase + id * 40) % 360, 1, 1);
          ctx.strokeStyle = `rgb(${col.r},${col.g},${col.b})`;
          ctx.strokeRect(screenPos.x - 20, screenPos.y - 40, 40, 80);
        });

        ctx.restore();
      }
    }
  };

  // Dummy mouse state
  let mouseDown = false;
  window.addEventListener('mousedown', e => { if (e.button === 0) mouseDown = true; });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });

  // Packet sending helpers
  function sendClickPacket() {
    if (!wsInstance || wsInstance.readyState !== 1) return;
    const PACKET_ID = 0x0F; // Use left click packet ID for attack? (might differ)
    const packetIdVarInt = writeVarInt(PACKET_ID);
    const lengthVarInt = writeVarInt(packetIdVarInt.length);
    const buffer = new Uint8Array(lengthVarInt.length + packetIdVarInt.length);
    buffer.set(lengthVarInt, 0);
    buffer.set(packetIdVarInt, lengthVarInt.length);
    wsInstance.send(buffer);
  }

  function sendJumpPacket() {
    if (!wsInstance || wsInstance.readyState !== 1) return;
    const PACKET_ID = 0x1B; // Client Player Jump? Might differ by version
    const packetIdVarInt = writeVarInt(PACKET_ID);
    const lengthVarInt = writeVarInt(packetIdVarInt.length);
    const buffer = new Uint8Array(lengthVarInt.length + packetIdVarInt.length);
    buffer.set(lengthVarInt, 0);
    buffer.set(packetIdVarInt, lengthVarInt.length);
    wsInstance.send(buffer);
  }

  function sendCrouchPacket(state) {
    if (!wsInstance || wsInstance.readyState !== 1) return;
    const PACKET_ID = 0x0E; // Sneak packet? Might differ
    const packetIdVarInt = writeVarInt(PACKET_ID);
    const lengthVarInt = writeVarInt(packetIdVarInt.length + 1);
    const buffer = new Uint8Array(lengthVarInt.length + packetIdVarInt.length + 1);
    buffer.set(lengthVarInt, 0);
    buffer.set(packetIdVarInt, lengthVarInt.length);
    buffer[lengthVarInt.length + packetIdVarInt.length] = state ? 1 : 0;
    wsInstance.send(buffer);
  }

  // Helpers to convert world pos to screen (stub)
  function worldToScreen(pos) {
    // For demonstration, place entities relatively on screen (replace with real projection)
    return { x: window.innerWidth/2 + (pos.x - playerPosition.x)*20, y: window.innerHeight/2 - (pos.y - playerPosition.y)*20 };
  }

  // nearEdge check dummy
  function nearEdge() {
    // Implement real edge detection by raycasting or player pos + yaw, etc.
    return false; // stub for now
  }

  // ClickGUI basic implementation
  const ClickGUI = (() => {
    const gui = document.createElement('div');
    gui.style.position = 'fixed';
    gui.style.top = '50px';
    gui.style.left = '50px';
    gui.style.width = '320px';
    gui.style.height = '480px';
    gui.style.background = '#202020cc';
    gui.style.color = '#eee';
    gui.style.fontFamily = "'Minecraft', monospace, monospace";
    gui.style.border = '2px solid #555';
    gui.style.borderRadius = '6px';
    gui.style.zIndex = 999999;
    gui.style.userSelect = 'none';
    gui.style.padding = '10px';
    gui.style.display = 'none';
    gui.style.overflowY = 'auto';

    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    gui.addEventListener('mousedown', (e) => {
      if (e.target === gui) {
        dragging = true;
        dragOffsetX = e.clientX - gui.offsetLeft;
        dragOffsetY = e.clientY - gui.offsetTop;
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', () => dragging = false);

    window.addEventListener('mousemove', (e) => {
      if (dragging) {
        gui.style.left = (e.clientX - dragOffsetX) + 'px';
        gui.style.top = (e.clientY - dragOffsetY) + 'px';
      }
    });

    // Sections with right click to expand/collapse
    const sections = {};
    function createSection(name, modulesList) {
      const section = document.createElement('div');
      section.style.marginBottom = '12px';
      section.style.border = '1px solid #666';
      section.style.borderRadius = '4px';

      const header = document.createElement('div');
      header.textContent = name;
      header.style.background = '#333';
      header.style.padding = '6px 8px';
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      header.style.fontWeight = 'bold';
      header.style.color = '#fff';

      const container = document.createElement('div');
      container.style.display = 'none';
      container.style.padding = '6px 8px';

      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        container.style.display = container.style.display === 'none' ? 'block' : 'none';
      });

      modulesList.forEach(modName => {
        const mod = modules[modName];
        if (!mod) return;
        const toggle = document.createElement('div');
        toggle.style.margin = '4px 0';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = mod.enabled;
        checkbox.style.marginRight = '6px';

        checkbox.addEventListener('change', () => {
          if (mod.toggle) mod.toggle();
          else mod.enabled = checkbox.checked;
        });

        const label = document.createElement('label');
        label.textContent = modName;
        label.style.cursor = 'pointer';

        toggle.appendChild(checkbox);
        toggle.appendChild(label);
        container.appendChild(toggle);
      });

      section.appendChild(header);
      section.appendChild(container);
      gui.appendChild(section);
      sections[name] = { section, container };
    }

    function show() {
      gui.style.display = 'block';
    }
    function hide() {
      gui.style.display = 'none';
    }
    function toggle() {
      if (gui.style.display === 'none') show();
      else hide();
    }

    document.body.appendChild(gui);

    return { createSection, show, hide, toggle };
  })();

  // Setup GUI sections
  ClickGUI.createSection("Combat", ["AutoClicker", "InfiniteAura", "BlatantVelo"]);
  ClickGUI.createSection("Movement", ["AutoJump", "AutoCrouch"]);
  ClickGUI.createSection("Render", ["LoggerHUD", "ESP"]);

  // Hook right shift to toggle GUI
  window.addEventListener('keydown', e => {
    if (e.code === "ShiftRight") {
      e.preventDefault();
      ClickGUI.toggle();
    }
  });

  // InfiniteAura spam function
  function startInfiniteAuraSpam() {
    if (infiniteAuraInterval) clearInterval(infiniteAuraInterval);
    infiniteAuraInterval = setInterval(() => {
      if (lastHitPacket && wsInstance && wsInstance.readyState === 1) {
        try {
          wsInstance.send(lastHitPacket);
        } catch {}
      }
    }, 100);
  }

  // Intercept WebSocket
  window.WebSocket = function(url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);
    ws.addEventListener('open', () => {
      wsInstance = ws;
      modules.LoggerHUD.log("WebSocket connected.");
    });
    ws.addEventListener('close', () => {
      wsInstance = null;
      modules.LoggerHUD.log("WebSocket closed.");
      if (infiniteAuraInterval) clearInterval(infiniteAuraInterval);
      infiniteAuraInterval = null;
    });
    ws.addEventListener('message', e => {
      const data = new Uint8Array(e.data);
      try {
        const packetIdVarInt = readVarInt(data, 0);
        const packetId = packetIdVarInt.value;
        let offset = packetIdVarInt.size;

        // Example: handle spawn player entity (you should adjust based on your server)
        if (packetId === 0x01) {
          // For demonstration, store dummy entity with id and position
          trackedEntities.set(1234, { x: 100, y: 64, z: 100 });
        } else if (packetId === 0x0B) {
          // Velocity packet example for BlatantVelo
          if (modules.BlatantVelo.onPacketReceive(packetId, data)) {
            // Intercept velocity, stop default processing
            return;
          }
        } else if (packetId === 0x1D) {
          // Player position and look update, update player position & ground state
          modules.AutoJump.onPacketReceive(packetId, data);
          // Parse and update playerPosition and playerOnGround here if possible
        }

        // Pass to other modules if needed...

      } catch (err) {
        modules.LoggerHUD.log(`Packet parse error: ${err.message}`);
      }

      // Forward the message event (normally you'd manipulate here if intercepting)
      ws.dispatchEvent(new MessageEvent('message', { data: e.data }));
    });

    return ws;
  };

  // Main render loop for HUD and ESP
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = 999998;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function mainLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (modules.LoggerHUD.enabled) modules.LoggerHUD.render(ctx);
    if (modules.ESP.enabled) modules.ESP.render(ctx);

    modules.AutoCrouch.update();

    if (modules.AutoJump.enabled) modules.AutoJump.tryJump();

    requestAnimationFrame(mainLoop);
  }

  mainLoop();

  // Expose toggle functions on window for easy debugging
  window.ModClient = {
    toggleAutoClicker() { modules.AutoClicker.toggle(); },
    toggleAutoJump() { modules.AutoJump.toggle(); },
    toggleAutoCrouch() { modules.AutoCrouch.toggle(); },
    toggleInfiniteAura() { modules.InfiniteAura.toggle(); },
    toggleBlatantVelo() { modules.BlatantVelo.toggle(); },
    toggleLoggerHUD() { modules.LoggerHUD.enabled = !modules.LoggerHUD.enabled; },
    toggleESP() { modules.ESP.enabled = !modules.ESP.enabled; }
  };

  modules.LoggerHUD.log("Mod client initialized. Press Right Shift to open GUI.");
})();
