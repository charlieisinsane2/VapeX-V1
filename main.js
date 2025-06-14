(async () => {
  const OriginalWebSocket = window.WebSocket;
  window.wsInstance = null;
  window.yourEntityId = null;
  window.playerPos = { x: 0, y: 0, z: 0, onGround: false };


  function HookedWebSocket(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    window.wsInstance = ws;

    const send = ws.send;
    ws.send = function (...args) {
      return send.apply(ws, args);
    };

    ws.addEventListener("message", (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes[0] === 0x01) {
        const { value: eid } = readVarInt(bytes, 1);
        window.yourEntityId = eid;
        window.addLog?.(`[Client] Entity ID: ${eid}`, "#0ff");
      }
      if (bytes[0] === 0x0D) {
        const dv = new DataView(event.data);
        window.playerPos.x = dv.getFloat64(1);
        window.playerPos.y = dv.getFloat64(9);
        window.playerPos.z = dv.getFloat64(17);
        window.playerPos.onGround = bytes[33] !== 0;
      }
    });

    return ws;
  }
  HookedWebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket = HookedWebSocket;

  function readVarInt(bytes, pos) {
    let numRead = 0, result = 0, read;
    do {
      read = bytes[pos + numRead];
      const value = read & 0b01111111;
      result |= value << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error("VarInt too big");
    } while ((read & 0b10000000) !== 0);
    return { value: result, size: numRead };
  }


  const manager = await fetch("https://yourdomain.com/manager.json").then(r => r.json());


  const modules = {};
  const enabled = {};


  const logs = [];
  const hud = document.createElement('div');
  Object.assign(hud.style, {
    position: 'fixed', bottom: '5px', right: '5px', width: '300px', maxHeight: '200px',
    overflow: 'hidden', fontFamily: 'monospace', fontSize: '12px', color: '#eee',
    background: 'rgba(0,0,0,0.5)', borderRadius: '8px', padding: '5px', zIndex: 99999
  });
  document.body.appendChild(hud);

  window.addLog = (text, color = "#fff") => {
    logs.push({ text, color, time: Date.now() });
    if (logs.length > 50) logs.shift();
  };
  setInterval(() => {
    const now = Date.now();
    hud.innerHTML = logs
      .filter(log => now - log.time < 10000)
      .map(log => `<div style="color:${log.color};opacity:${1 - (now - log.time) / 10000}">${log.text}</div>`)
      .join("");
  }, 1000);


  const gui = document.createElement("div");
  gui.style.position = "fixed";
  gui.style.top = "50px";
  gui.style.left = "50px";
  gui.style.background = "rgba(0,0,0,0.7)";
  gui.style.border = "1px solid #444";
  gui.style.padding = "10px";
  gui.style.borderRadius = "8px";
  gui.style.zIndex = 99999;
  gui.style.userSelect = "none";
  gui.style.fontFamily = "monospace";
  gui.innerHTML = `<h3 style="margin:0 0 10px 0;color:white;">Closet Client</h3>`;
  document.body.appendChild(gui);


  for (const category of manager.categories) {
    const catDiv = document.createElement("div");
    catDiv.innerHTML = `<h4 style="color:#ccc;">${category.name}</h4>`;
    gui.appendChild(catDiv);
    for (const mod of category.modules) {
      const modBtn = document.createElement("button");
      modBtn.textContent = mod.name;
      modBtn.style.display = "block";
      modBtn.style.marginBottom = "4px";
      modBtn.style.width = "100%";
      modBtn.style.background = "#222";
      modBtn.style.color = "#fff";
      modBtn.style.border = "none";
      modBtn.style.padding = "5px";
      modBtn.style.borderRadius = "4px";
      let loaded = false;

      modBtn.onclick = async () => {
        if (!loaded) {
          const raw = await fetch(mod.url).then(r => r.text());
          modules[mod.name] = eval(raw);
          loaded = true;
        }
        if (enabled[mod.name]) {
          modules[mod.name].disable?.();
          enabled[mod.name] = false;
          modBtn.style.background = "#222";
          window.addLog(`[Module] ${mod.name} disabled`, "#f66");
        } else {
          modules[mod.name].enable?.();
          enabled[mod.name] = true;
          modBtn.style.background = "#0a0";
          window.addLog(`[Module] ${mod.name} enabled`, "#6f6");
        }
      };

      catDiv.appendChild(modBtn);
    }
  }

})();
