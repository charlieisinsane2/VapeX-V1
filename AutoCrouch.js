module.exports = {
  interval: null,
  crouching: false,
  enable() {
    this.interval = setInterval(() => {
      if (!window.wsInstance || !window.yourEntityId) return;
      const frac = (v) => v - Math.floor(v);
      const edge = (f) => f < 0.3 || f > 0.7;
      const nearEdge = edge(frac(window.playerPos.x)) || edge(frac(window.playerPos.z));
      const send = (a) => {
        const id = window.yourEntityId;
        const write = (v) => {
          const b = [];
          do {
            let t = v & 0x7f;
            v >>>= 7;
            if (v) t |= 0x80;
            b.push(t);
          } while (v);
          return b;
        };
        const pkt = new Uint8Array([0x03, ...write(id), ...write(a), 0]);
        window.wsInstance.send(pkt.buffer);
      };

      if (nearEdge && !this.crouching) {
        send(1);
        this.crouching = true;
        window.addLog?.("[AutoCrouch] Crouch ON", "#0ff");
      } else if (!nearEdge && this.crouching) {
        send(2);
        this.crouching = false;
        window.addLog?.("[AutoCrouch] Crouch OFF", "#0ff");
      }
    }, 100);
  },
  disable() {
    clearInterval(this.interval);
    this.crouching = false;
    window.addLog?.("[AutoCrouch] Disabled", "#0ff");
  }
};
