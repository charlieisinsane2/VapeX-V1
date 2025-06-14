const BlatantVelo = {
  name: 'BlatantVelo',
  enabled: false,
  _originalWebSocket: null,
  _hooked: false,
  onToggle(enabled) {
    if (enabled) {
      this.hook();
    } else {
      this.unhook();
    }
  },
  hook() {
    if (this._hooked) return;
    this._hooked = true;
    this._originalWebSocket = window.WebSocket;
    const that = this;
    window.WebSocket = function(url, protocols) {
      const ws = protocols ? new that._originalWebSocket(url, protocols) : new that._originalWebSocket(url);
      ws.addEventListener('message', e => {
        if (!that.enabled) return;
        if (!(e.data instanceof ArrayBuffer)) return;
        const data = new Uint8Array(e.data);
        const packetId = data[0];
        if (packetId === 0x1C) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
      }, true);
      return ws;
    };
    window.WebSocket.prototype = this._originalWebSocket.prototype;
  },
  unhook() {
    if (!this._hooked) return;
    this._hooked = false;
    if (this._originalWebSocket) {
      window.WebSocket = this._originalWebSocket;
      this._originalWebSocket = null;
    }
  }
};

export default BlatantVelo;
