module.exports = {
  hook: null,
  enable() {
    this.hook = function(event) {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      const id = bytes[0];

      if (id === 0x12) { // Entity Velocity
        try {
          const entityId = (() => {
            let numRead = 0;
            let result = 0;
            let read;
            do {
              read = bytes[1 + numRead];
              const value = read & 0b01111111;
              result |= value << (7 * numRead);
              numRead++;
              if (numRead > 5) throw new Error("VarInt too big");
            } while ((read & 0b10000000) !== 0);
            return result;
          })();

          if (entityId === window.yourEntityId && window.playerPos?.onGround) {
            const jumpPacket = new Uint8Array([0x03, 0x10]);
            window.wsInstance?.send(jumpPacket);
            if (window.addLog) window.addLog("[AutoJump] Jumped after hit", "#0ff");
          }
        } catch (e) {
          console.error("[AutoJump Error]", e);
        }
      }
    };

    if (window.wsInstance) {
      window.wsInstance.addEventListener("message", this.hook);
    } else {
      const _ws = window.WebSocket;
      window.WebSocket = function(...args) {
        const ws = new _ws(...args);
        ws.addEventListener("message", this.hook);
        return ws;
      };
    }

    if (window.addLog) window.addLog("[AutoJump] Enabled", "#0ff");
  },

  disable() {
    if (window.wsInstance && this.hook) {
      window.wsInstance.removeEventListener("message", this.hook);
    }
    if (window.addLog) window.addLog("[AutoJump] Disabled", "#0ff");
  }
};
