(() => {
  const OriginalWebSocket = window.WebSocket;
  let wsInstance = null;
  let yourEntityId = null;
  const modules = {};
  const categoryElements = {};
  let gui, header, categoriesContainer;
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let playerPos = { x: 0, y: 0, z: 0, onGround: true };

  function loadCSS(url) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('CSS load failed: ' + url));
      document.head.appendChild(link);
    });
  }

  async function loadManager(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load manager.json: ${resp.statusText}`);
    return await resp.json();
  }

  function createGUI() {
    gui = document.createElement('div');
    gui.id = 'vape-clickgui';
    header = document.createElement('div');
    header.id = 'vape-clickgui-header';
    header.textContent = 'Vape V4 Client';
    gui.appendChild(header);
    categoriesContainer = document.createElement('div');
    categoriesContainer.id = 'vape-categories';
    gui.appendChild(categoriesContainer);
    document.body.appendChild(gui);
    header.addEventListener('mousedown', e => {
      dragging = true;
      const rect = gui.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      gui.style.left = (e.clientX - dragOffsetX) + 'px';
      gui.style.top = (e.clientY - dragOffsetY) + 'px';
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && gui.style.display === 'block') {
        gui.style.display = 'none';
      }
    });
  }

  function createCategories(categories) {
    categoriesContainer.innerHTML = '';
    for (const cat of categories) {
      const catDiv = document.createElement('div');
      catDiv.className = 'category';
      catDiv.dataset.name = cat.name;
      const title = document.createElement('div');
      title.className = 'category-title';
      title.textContent = cat.name;
      catDiv.appendChild(title);
      const modList = document.createElement('div');
      modList.className = 'module-list';
      catDiv.appendChild(modList);
      title.addEventListener('contextmenu', e => {
        e.preventDefault();
        catDiv.classList.toggle('expanded');
      });
      categoriesContainer.appendChild(catDiv);
      categoryElements[cat.name] = modList;
    }
  }

  function addModule(categoryName, modInfo, modInstance) {
    modules[modInfo.name] = modInstance;
    const container = categoryElements[categoryName];
    if (!container) return;
    const modDiv = document.createElement('div');
    modDiv.className = 'module';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'module-name';
    nameSpan.textContent = modInfo.name;
    modDiv.appendChild(nameSpan);
    const toggle = document.createElement('div');
    toggle.className = 'toggle-switch' + (modInstance.enabled ? ' enabled' : '');
    modDiv.appendChild(toggle);
    toggle.addEventListener('click', () => {
      modInstance.enabled = !modInstance.enabled;
      if (modInstance.onToggle) modInstance.onToggle(modInstance.enabled);
      toggle.classList.toggle('enabled', modInstance.enabled);
    });
    container.appendChild(modDiv);
  }

  window.addEventListener('keydown', e => {
    if (e.key === 'Shift' && e.code === 'ShiftRight') {
      gui.style.display = gui.style.display === 'block' ? 'none' : 'block';
      e.preventDefault();
    }
  });

  function HookedWebSocket(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    wsInstance = ws;
    const originalSend = ws.send;
    ws.send = function (data) {
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
          case 0x12: {
            const { value: entityId } = readVarInt(bytes, 1);
            if (entityId === yourEntityId && modules.AutoJump?.enabled && isPlayerOnGround()) {
              addLog(`[Combat] You were hit! AutoJump triggered`, '#f00');
              modules.AutoJump.sendJump();
            }
            break;
          }
        }
      } catch (e) {
        addLog(`[Error] Packet processing failed: ${e.message}`, '#f88');
      }
    });
    return ws;
  }
  HookedWebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket = HookedWebSocket;

  function readVarInt(buffer, offset) {
    let numRead = 0;
    let result = 0;
    let read;
    do {
      if (offset + numRead >= buffer.length) throw new Error('No more bytes reading varint');
      read = buffer[offset + numRead];
      const value = read & 0b01111111;
      result |= value << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error('VarInt too big');
    } while ((read & 0b10000000) !== 0);
    return { value: result, size: numRead };
  }

  function addLog(text, color) {
    if (!logContainer) createLogHUD();
    const entry = document.createElement('div');
    entry.textContent = text;
    entry.style.color = color || '#fff';
    entry.style.fontFamily = "'Minecraftia', monospace";
    entry.style.fontSize = '12px';
    entry.style.marginBottom = '2px';
    logContainer.appendChild(entry);
    setTimeout(() => entry.remove(), 10000);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  let logContainer;
  function createLogHUD() {
    logContainer = document.createElement('div');
    logContainer.style.position = 'fixed';
    logContainer.style.bottom = '5px';
    logContainer.style.right = '5px';
    logContainer.style.width = '300px';
    logContainer.style.maxHeight = '200px';
    logContainer.style.overflowY = 'auto';
    logContainer.style.background = 'rgba(0, 0, 0, 0.6)';
    logContainer.style.padding = '8px';
    logContainer.style.borderRadius = '4px';
    logContainer.style.fontFamily = "'Minecraftia', monospace";
    logContainer.style.fontSize = '12px';
    logContainer.style.zIndex = 10000000;
    document.body.appendChild(logContainer);
  }

  function renderHUD() {

  }

  function isPlayerOnGround() {
    return playerPos.onGround;
  }

  async function main() {
  try {
        await loadCSS('https://raw.githubusercontent.com/charlieisinsane2/VapeX-V1/main/vape-clickgui.css');
        const manager = await loadManager('https://raw.githubusercontent.com/charlieisinsane2/VapeX-V1/main/manager.json');

      createGUI();
      createCategories(manager.categories);
      for (const category of manager.categories) {
        for (const modInfo of category.modules) {
          try {
            const modModule = await import(modInfo.url + '?cache=' + Date.now());
            const modInstance = modModule.default || modModule;
            addModule(category.name, modInfo, modInstance);
          } catch (e) {
            addLog(`[Error] Failed to load module ${modInfo.name}: ${e.message}`, '#f88');
          }
        }
      }
      gui.style.display = 'block';
      addLog('[Client] Loaded Vape V4 ClickGUI and modules', '#6cf');
      setInterval(renderHUD, 1000);
    } catch (e) {
      console.error(e);
      alert('Failed to load client: ' + e.message);
    }
  }

  main();
})();
