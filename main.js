(async () => {
  const managerUrl = "https://yourdomain.com/manager.json"; // replace with your link

  const categories = {};
  const loadedModules = {};

  // Load JSON and fetch modules
  const manager = await (await fetch(managerUrl)).json();

  for (const [category, mods] of Object.entries(manager)) {
    categories[category] = mods.map(mod => mod.name);
    for (const mod of mods) {
      try {
        const code = await (await fetch(mod.url)).text();
        const moduleFn = new Function("module", "exports", code);
        const module = { exports: {} };
        moduleFn(module, module.exports);
        loadedModules[mod.name] = module.exports;
        if (mod.enabled && typeof module.exports.enable === "function") {
          module.exports.enable();
        }
      } catch (e) {
        console.error(`[Module Load] ${mod.name} failed:`, e);
      }
    }
  }

  // Add GUI
  const gui = document.createElement("div");
  gui.style.position = "fixed";
  gui.style.top = "30px";
  gui.style.right = "30px";
  gui.style.padding = "10px";
  gui.style.background = "rgba(0,0,0,0.6)";
  gui.style.borderRadius = "10px";
  gui.style.fontFamily = "sans-serif";
  gui.style.color = "#fff";
  gui.style.zIndex = 999999;

  for (const [category, mods] of Object.entries(categories)) {
    const catDiv = document.createElement("div");
    const catTitle = document.createElement("div");
    catTitle.textContent = category;
    catTitle.style.fontWeight = "bold";
    catTitle.style.marginBottom = "5px";
    catDiv.appendChild(catTitle);

    for (const modName of mods) {
      const modDiv = document.createElement("div");
      const btn = document.createElement("button");
      btn.textContent = `[${modName}] OFF`;
      btn.style.marginBottom = "5px";
      btn.style.cursor = "pointer";
      btn.style.background = "#222";
      btn.style.color = "#fff";
      btn.style.border = "1px solid #444";
      btn.style.borderRadius = "5px";
      btn.style.padding = "3px 6px";

      let on = false;
      btn.onclick = () => {
        on = !on;
        btn.textContent = `[${modName}] ${on ? "ON" : "OFF"}`;
        const mod = loadedModules[modName];
        if (mod) {
          if (on && typeof mod.enable === "function") mod.enable();
          if (!on && typeof mod.disable === "function") mod.disable();
        }
      };
      modDiv.appendChild(btn);
      catDiv.appendChild(modDiv);
    }
    catDiv.style.marginBottom = "10px";
    gui.appendChild(catDiv);
  }

  document.body.appendChild(gui);
})();
