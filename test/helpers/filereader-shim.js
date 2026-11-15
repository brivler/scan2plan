/** Minimal FileReader for running three.js GLTFExporter in Node. */
if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend && this.onloadend(); });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend && this.onloadend();
      });
    }
  };
}
