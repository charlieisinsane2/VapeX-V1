module.exports = {
  enable() {
    document.querySelector("div").style.display = "block";
    window.addLog?.("[LoggerHUD] ON", "#ccc");
  },
  disable() {
    document.querySelector("div").style.display = "none";
    window.addLog?.("[LoggerHUD] OFF", "#ccc");
  }
};
