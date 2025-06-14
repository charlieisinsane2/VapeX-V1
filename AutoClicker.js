module.exports = {
  interval: null,
  enable() {
    this.interval = setInterval(() => {
      const attackPacket = new Uint8Array([0x07, 0x00]);
      if (window.wsInstance?.readyState === 1) {
        window.wsInstance.send(attackPacket);
        if (window.addLog) window.addLog("[AutoClicker] Attack", "#fc0");
      }
    }, 100);
  },
  disable() {
    clearInterval(this.interval);
    this.interval = null;
  }
};
