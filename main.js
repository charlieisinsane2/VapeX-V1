(() => {
  const OriginalWebSocket = window.WebSocket;
  let wsInstance = null;
  let yourEntityId = null;
  let playerPos = { x: 0, y: 0, z: 0, onGround: false };

  const modules = {
    autoJump: { enabled: true },
    velocity: { enabled: true },
    aimbot: { enabled: true },
    blink: { enabled: false, queue: [] },
    fakeLag: { enabled: false, queue: [] },
    arraylist: { enabled: true },
  };

  // Input state
  const keys = {};
  const mouse = { left: false, right: false };

  window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === "=") toggleLogger();
    if (e.key === "Shift") toggleClickGUI();
  });
  window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false;
  });
  window.addEventListener("mousedown", e => {
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) mouse.right = true;
  });
  window.addEventListener("mouseup", e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });

  function readVarInt(bytes, pos) {
    let numRead = 0, result = 0, read;
    do {
      read = bytes[pos + numRead];
      let value = read & 0b01111111;
      result |= value << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error("VarInt too big");
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

  // HUD Logger
  const logs = [];
  const hud = document.createElement('div');
  hud.style = `position:fixed;bottom:5px;right:5px;width:280px;max-height:150px;
    overflow:hidden;font-family:monospace;font-size:12px;color:#eee;
    background:rgba(0,0,0,0.5);border-radius:6px;padding:6px;z-index:999999;
    pointer-events:none;user-select:none`;
  document.body.appendChild(hud);

  function log(text, color = "#fff") {
    logs.push({ text, color, time: Date.now() });
    if (logs.length > 40) logs.shift();
    renderHUD();
  }

  function renderHUD() {
    const now = Date.now();
    hud.innerHTML = logs
      .filter(l => now - l.time < 10000)
      .map(l => {
        const age = now - l.time;
        const opacity = 1 - age / 10000;
        return `<div style="color:${l.color};opacity:${opacity.toFixed(2)}">${l.text}</div>`;
      }).join("");
  }

  setInterval(renderHUD, 1000);
    const entityMap = new Map();
  let lastHurtTime = 0;

  function parseEntityTeleport(dv, offset) {
    const entityId = dv.getInt32(offset);
    const x = dv.getInt32(offset + 4) / 32;
    const y = dv.getInt32(offset + 8) / 32;
    const z = dv.getInt32(offset + 12) / 32;
    const yaw = dv.getUint8(offset + 16);
    const pitch = dv.getUint8(offset + 17);
    const onGround = dv.getUint8(offset + 18) !== 0;

    entityMap.set(entityId, { x, y, z, yaw, pitch, onGround });
    if (entityId === yourEntityId) {
      playerPos = { x, y, z, onGround };
    }
  }

  function parseEntityRelativeMove(dv, offset) {
    const entityId = dv.getInt32(offset);
    const dx = dv.getInt16(offset + 4) / 32;
    const dy = dv.getInt16(offset + 6) / 32;
    const dz = dv.getInt16(offset + 8) / 32;
    const onGround = dv.getUint8(offset + 10) !== 0;

    const entity = entityMap.get(entityId);
    if (entity) {
      entity.x += dx;
      entity.y += dy;
      entity.z += dz;
      entity.onGround = onGround;
      entityMap.set(entityId, entity);
    }
    if (entityId === yourEntityId) {
      playerPos.y += dy;
      playerPos.onGround = onGround;
    }
  }

  function handlePacket(packet) {
    const dv = new DataView(packet);
    let offset = 0;
    try {
      const { value: id, size } = readVarInt(new Uint8Array(packet), offset);
      offset += size;

      if (id === 0x32) { // Entity Teleport
        parseEntityTeleport(dv, offset);
      } else if (id === 0x25) { // Relative Move
        parseEntityRelativeMove(dv, offset);
      } else if (id === 0x46) { // Entity Velocity
        const entityId = dv.getInt32(offset);
        if (modules.velocity.enabled && entityId === yourEntityId) {
          log("Velocity canceled", "#ff4444");
          return null; // Cancel velocity packet
        }
      } else if (id === 0x29) { // Entity Status (hurt animation)
        const entityId = dv.getInt32(offset);
        if (entityId === yourEntityId) {
          lastHurtTime = Date.now();
          log("Got hit!", "#ff8888");
        }
      }

      return packet;
    } catch (e) {
      console.warn("Packet parse failed:", e);
      return packet;
    }
  }

  function autoJumpInject() {
    if (!modules.autoJump.enabled) return;
    const now = Date.now();
    if (now - lastHurtTime < 200 && playerPos.onGround) {
      const jumpPacket = new Uint8Array(writeVarInt(0x1b)); // Client jump packet (if custom)
      wsInstance.send(jumpPacket);
      log("AutoJump!", "#88f");
      lastHurtTime = 0;
    }
  }

  setInterval(autoJumpInject, 100);
  let currentTarget = null;
  let lastHealth = 20;
  let animHealth = 20;

  function getNearestEntity() {
    let closest = null;
    let minDist = Infinity;

    entityMap.forEach((entity, id) => {
      if (id === yourEntityId) return;
      const dx = entity.x - playerPos.x;
      const dy = entity.y - playerPos.y;
      const dz = entity.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 6 && dist < minDist) {
        closest = { id, ...entity };
        minDist = dist;
      }
    });

    return closest;
  }

  function smoothLookAt(target) {
    const dx = target.x - playerPos.x;
    const dy = (target.y + 1.5) - (playerPos.y + 1.62); // Eye heights
    const dz = target.z - playerPos.z;

    const yaw = -Math.atan2(dx, dz) * 180 / Math.PI;
    const pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;

    // Packet injection: look smoothly
    if (modules.aimbot.enabled && wsInstance && yourEntityId) {
      const buf = [];
      buf.push(...writeVarInt(0x0E)); // Player Look packet
      buf.push(...writeFloat(yaw));
      buf.push(...writeFloat(pitch));
      buf.push(1); // onGround
      wsInstance.send(new Uint8Array(buf));
    }
  }

  function updateAimbot() {
    if (!modules.aimbot.enabled) return;
    const target = getNearestEntity();
    if (target) {
      currentTarget = target;
      smoothLookAt(target);
    }
  }

  setInterval(updateAimbot, 50);

  // === HUD Rendering (canvas-based) ===
  const hudCanvas = document.createElement("canvas");
  hudCanvas.style.position = "fixed";
  hudCanvas.style.bottom = "10px";
  hudCanvas.style.left = "10px";
  hudCanvas.width = 200;
  hudCanvas.height = 40;
  hudCanvas.style.zIndex = "1000";
  document.body.appendChild(hudCanvas);
  const hudCtx = hudCanvas.getContext("2d");

  function drawHUD() {
    hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

    if (currentTarget) {
      const targetHealth = 20; // Optional: read from packet or simulate
      if (animHealth > targetHealth) animHealth -= 0.2;
      else if (animHealth < targetHealth) animHealth += 0.1;

      hudCtx.fillStyle = "#222";
      hudCtx.fillRect(0, 0, 200, 20);
      hudCtx.fillStyle = "red";
      hudCtx.fillRect(0, 0, (animHealth / 20) * 200, 20);
      hudCtx.fillStyle = "#fff";
      hudCtx.font = "14px monospace";
      hudCtx.fillText("Target: " + currentTarget.id, 10, 35);
    }
  }

  setInterval(drawHUD, 1000 / 20);
// === ClickGUI ===
  let showClickGUI = false;
  const guiCanvas = document.createElement("canvas");
  guiCanvas.width = innerWidth;
  guiCanvas.height = innerHeight;
  guiCanvas.style.position = "fixed";
  guiCanvas.style.left = "0";
  guiCanvas.style.top = "0";
  guiCanvas.style.zIndex = "999";
  guiCanvas.style.pointerEvents = "none";
  document.body.appendChild(guiCanvas);
  const guiCtx = guiCanvas.getContext("2d");

  let dragging = null;
  let offsetX = 0, offsetY = 0;
  const modulePositions = {
    aimbot: { x: 50, y: 100 },
    autoClicker: { x: 50, y: 140 },
    scaffold: { x: 50, y: 180 },
    fakeLag: { x: 50, y: 220 },
    blink: { x: 50, y: 260 },
    arraylist: { x: 50, y: 300 },
  };

  function drawClickGUI() {
    guiCtx.clearRect(0, 0, guiCanvas.width, guiCanvas.height);
    if (!showClickGUI) return;

    Object.keys(modules).forEach(name => {
      const mod = modules[name];
      const pos = modulePositions[name];
      guiCtx.fillStyle = mod.enabled ? "#00cc00" : "#333";
      guiCtx.fillRect(pos.x, pos.y, 120, 30);
      guiCtx.fillStyle = "#fff";
      guiCtx.font = "bold 14px monospace";
      guiCtx.fillText(name, pos.x + 5, pos.y + 20);
    });
  }

  setInterval(drawClickGUI, 1000 / 30);

  window.addEventListener("keydown", e => {
    if (e.key === "Shift") showClickGUI = !showClickGUI;
  });

  guiCanvas.addEventListener("mousedown", e => {
    if (!showClickGUI) return;
    Object.entries(modulePositions).forEach(([name, pos]) => {
      if (
        e.clientX >= pos.x &&
        e.clientX <= pos.x + 120 &&
        e.clientY >= pos.y &&
        e.clientY <= pos.y + 30
      ) {
        dragging = name;
        offsetX = e.clientX - pos.x;
        offsetY = e.clientY - pos.y;
      }
    });
  });

  guiCanvas.addEventListener("mouseup", () => dragging = null);
  guiCanvas.addEventListener("mousemove", e => {
    if (dragging) {
      modulePositions[dragging].x = e.clientX - offsetX;
      modulePositions[dragging].y = e.clientY - offsetY;
    }
  });

  guiCanvas.addEventListener("click", e => {
    if (!showClickGUI) return;
    Object.entries(modulePositions).forEach(([name, pos]) => {
      if (
        e.clientX >= pos.x &&
        e.clientX <= pos.x + 120 &&
        e.clientY >= pos.y &&
        e.clientY <= pos.y + 30
      ) {
        modules[name].enabled = !modules[name].enabled;
      }
    });
  });
  // === Logger chat & command parser ===
  let loggerOpen = false;
  const logs = [];
  const maxLogs = 30;

  const loggerInput = document.createElement("input");
  loggerInput.type = "text";
  loggerInput.style.position = "fixed";
  loggerInput.style.bottom = "0";
  loggerInput.style.left = "0";
  loggerInput.style.width = "100%";
  loggerInput.style.backgroundColor = "rgba(0,0,0,0.8)";
  loggerInput.style.color = "#0f0";
  loggerInput.style.border = "none";
  loggerInput.style.font = "16px monospace";
  loggerInput.style.zIndex = "1000";
  loggerInput.style.display = "none";
  document.body.appendChild(loggerInput);

  const loggerDiv = document.createElement("div");
  loggerDiv.style.position = "fixed";
  loggerDiv.style.bottom = "25px";
  loggerDiv.style.left = "0";
  loggerDiv.style.width = "100%";
  loggerDiv.style.maxHeight = "200px";
  loggerDiv.style.overflowY = "auto";
  loggerDiv.style.backgroundColor = "rgba(0,0,0,0.6)";
  loggerDiv.style.color = "#0f0";
  loggerDiv.style.font = "14px monospace";
  loggerDiv.style.padding = "5px";
  loggerDiv.style.zIndex = "999";
  loggerDiv.style.display = "none";
  document.body.appendChild(loggerDiv);

  function addLog(text) {
    const time = new Date().toLocaleTimeString();
    logs.push(`[${time}] ${text}`);
    if (logs.length > maxLogs) logs.shift();
    if (loggerOpen) updateLogger();
  }

  function updateLogger() {
    loggerDiv.innerHTML = logs.map(l => `<div>${l}</div>`).join("");
  }

  function toggleLogger() {
    loggerOpen = !loggerOpen;
    loggerInput.style.display = loggerOpen ? "block" : "none";
    loggerDiv.style.display = loggerOpen ? "block" : "none";
    if (loggerOpen) loggerInput.focus();
  }

  window.addEventListener("keydown", e => {
    if (e.key === "=" && !loggerOpen) {
      toggleLogger();
      e.preventDefault();
    } else if (e.key === "Enter" && loggerOpen) {
      const cmd = loggerInput.value.trim();
      if (cmd.length > 0) {
        addLog(`> ${cmd}`);
        parseCommand(cmd);
      }
      loggerInput.value = "";
      toggleLogger();
      e.preventDefault();
    }
  });

  // === Command parser ===
  const keybinds = {};

  function parseCommand(input) {
    const parts = input.split(" ");
    const cmd = parts[0].toLowerCase();

    if (cmd === "/bind") {
      if (parts.length < 3) {
        addLog("Usage: /bind <module> <key>");
        return;
      }
      const modName = parts[1].toLowerCase();
      const key = parts[2].toLowerCase();
      if (!modules[modName]) {
        addLog(`No such module: ${modName}`);
        return;
      }
      keybinds[key] = modName;
      addLog(`Bound ${modName} to key ${key.toUpperCase()}`);
    } else if (cmd === "/toggle") {
      if (parts.length < 2) {
        addLog("Usage: /toggle <module>");
        return;
      }
      const modName = parts[1].toLowerCase();
      if (!modules[modName]) {
        addLog(`No such module: ${modName}`);
        return;
      }
      modules[modName].enabled = !modules[modName].enabled;
      addLog(`${modName} is now ${modules[modName].enabled ? "enabled" : "disabled"}`);
    } else {
      addLog("Unknown command");
    }
  }

  // === Keybind handler ===
  window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (keybinds[k]) {
      const modName = keybinds[k];
      if (modules[modName]) {
        modules[modName].enabled = !modules[modName].enabled;
        addLog(`Toggled ${modName} via keybind`);
      }
    }
  });

  // Add helpful startup logs
  addLog("VapeX V1 Loaded. Use '=' to open logger chat.");
  addLog("Bind modules with: /bind <module> <key>");
  addLog("Toggle modules with: /toggle <module>");
