module.exports = {
  hud: null,
  logs: [],
  interval: null,
  enable() {
    if (this.hud) return;

    this.hud = document.createElement("div");
    Object.assign(this.hud.style, {
      position: "fixed",
      bottom: "10px",
      right: "10px",
      width: "300px",
      maxHeight: "200px",
      overflow: "hidden",
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#eee",
      background: "rgba(0,0,0,0.5)",
      borderRadius: "8px",
      padding: "5px",
      zIndex: 99999
    });

    document.body.appendChild(this.hud);
    window.addLog = (text, color = "#fff") => {
      this.logs.push({ text, color, time: Date.now() });
      if (this.logs.length > 50) this.logs.shift();
    };

    this.interval = setInterval(() => {
      const now = Date.now();
      this.hud.innerHTML = this.logs
        .filter(l => now - l.time < 10000)
        .map(l => `<div style="color:${l.color};opacity:${1 - (now - l.time) / 10000}">${l.text}</div>`)
        .join('');
    }, 1000);
  },
  disable() {
    if (this.hud) {
      document.body.removeChild(this.hud);
      this.hud = null;
    }
    clearInterval(this.interval);
    this.interval = null;
  }
};
