import {
  MsgType,
  SerialMessageEvent,
} from './serial-worker';

const serialWorker = new Worker(new URL('serial-worker.ts', import.meta.url), { type: 'module' });

let displayCanvas: HTMLCanvasElement;
let connectButton: HTMLButtonElement;
let baudRateSelector: HTMLSelectElement;
let polyfillCheckbox: HTMLInputElement;
let connected = false;
let ctx: CanvasRenderingContext2D;
let bpsCounter = 0;
let fpsCounter = 0;
let frameSizeLabel: HTMLLabelElement;
let fb: HTMLImageElement;

document.addEventListener('DOMContentLoaded', async () => {
  // Setup elements and listeners
  displayCanvas = document.getElementById('canvas') as HTMLCanvasElement;
  connectButton = document.getElementById('connect') as HTMLButtonElement;
  baudRateSelector = document.getElementById('baudrate') as HTMLSelectElement;
  polyfillCheckbox = document.getElementById('polyfill_checkbox') as HTMLInputElement;
  let bpsLabel = document.getElementById('bpsLabel') as HTMLLabelElement;
  let fpsLabel = document.getElementById('fpsLabel') as HTMLLabelElement;
  frameSizeLabel = document.getElementById('frameSizeLabel') as HTMLLabelElement;
  //fb = document.getElementById('fb') as HTMLImageElement;
  // paintButton.addEventListener('click', bufferToCanvas);
  connectButton.addEventListener('click', toggleConnect);
  ctx = displayCanvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  window.setInterval(() => {
    bpsLabel.innerText = 'Bits/Sec: ' + bpsCounter.toString();
    bpsCounter = 0;
    fpsLabel.innerText = 'FPS: ' + fpsCounter.toString();
    fpsCounter = 0;
  }, 1000);

  /* document.getElementById('FTDI')?.addEventListener("click", async () => {
    let FTDI = await window.navigator.usb.requestDevice({filters:[{vendorId:0x0403, productId:0x6011}]});
    let FTDIPort = new SerialPortPolyfill(FTDI);
    addNewPort(FTDIPort);
    console.log(FTDIPort); */
});

async function toggleConnect() {
  if (connected) {
    connectButton.textContent = 'Disconnecting...';
    connectButton.disabled = false;
    serialWorker.postMessage(MsgType.DISCONNECT);
  }
  else {
    const ports = await navigator.serial.getPorts();
    for (const port of ports)
      await port.forget();
    try {
      await navigator.serial.requestPort();
    }
    catch (e) {
      console.error(e);
      return;
    }
    connectButton.textContent = 'Connecting...';
    connectButton.disabled = true;
    baudRateSelector.disabled = true;
    serialWorker.postMessage({ msg: MsgType.CONNECT,
      startParams: { baudRate: Number.parseInt(baudRateSelector.value),
        usePolyfill: polyfillCheckbox.checked } });
  }
}

function markDisconnected(): void {
  connected = true;
  connectButton.textContent = 'Connect';
  connectButton.disabled = false;
  baudRateSelector.disabled = false;
}

serialWorker.addEventListener('message', async (event: MessageEvent<SerialMessageEvent>) => {
  //console.log(`RECEIVED EVENT: ${event.data.msg}`);
  switch (event.data.msg) {
    case MsgType.CONNECT_FAILED:
      console.log('Stream fail received');
      markDisconnected();
      break;
    case MsgType.DISCONNECTED:
      markDisconnected();
      break;
    case MsgType.CONNECTED:
      connected = true;
      console.log('CONNECTED');
      connectButton.textContent = 'Disconnect';
      connectButton.disabled = false;
      break;
    case MsgType.SERIAL_CHUNK:
      processChunk(event.data.array!);
      break;
  }
});

// Stores input chunks, average frame size = 13.5kb
const chunkBuffer = new Uint8Array(1024 * 100); // 100KB
// The amount of bytes in chunkBuffer
let chunkBufferOffset = 0;
// Keep track of reading index
let readIndex = 0;
// To prevent concurrent function calls
let mutex = false;
// Stores result frame
let frame: Uint8Array;

async function processChunk(inputChunk: Uint8Array) {
  if (mutex) {
    console.error('inputChunk dropped');
    return;
  }
  mutex = true;
  // Append inputChunk to chunkBuffer
  chunkBuffer.set(inputChunk, chunkBufferOffset);
  // Main loop
  for (let i = readIndex; i < inputChunk.length + chunkBufferOffset; i++) {
    // find end of packet marker
    if (chunkBuffer[i] === 0) {
      frame = chunkBuffer.slice(0, i + 1);
      const remainder = chunkBuffer.slice(i + 1, chunkBufferOffset + inputChunk.length);
      chunkBuffer.set(remainder, 0);
      paintCanvas(cobsDecode(frame));
      // Set variables for next call then return
      chunkBufferOffset = remainder.length;
      readIndex = 0;
      mutex = false;
      return;
    }
  }
  chunkBufferOffset += inputChunk.length;
  readIndex = chunkBufferOffset;
  mutex = false;
}

async function paintCanvas(frame: Uint8Array) {
  const blob = new Blob([frame], { type: 'image/jpeg' });
  bpsCounter += blob.size * 8;
  fpsCounter++;
  frameSizeLabel.innerText = "Frame Size: " + blob.size;
  //fb.src = URL.createObjectURL(blob);
  const imageBitmap = await createImageBitmap(blob);
  ctx?.drawImage(imageBitmap, 0, 0, displayCanvas.clientWidth, displayCanvas.clientHeight);
  imageBitmap.close();
}
function cobsDecode(data: Uint8Array): Uint8Array {
  let buf = new Uint8Array(data.length);
  let dataIndex = 1;
  let bufIndex = 0;
  let linkOffset = data[0];
  let linkIndex = 0;
  while (dataIndex < data.length) {
    // Link byte
    if (linkIndex + linkOffset === dataIndex) {
      // Reached the end, break
      if (data[dataIndex] === 0)
        break;
      // Encoded zero, write
      if (linkOffset !== 255)
      {
        buf[bufIndex] = 0;
        bufIndex++;
      }
      linkIndex = dataIndex;
      linkOffset = data[dataIndex];
    }
    // Non-link byte
    else {
      buf[bufIndex] = data[dataIndex];
      bufIndex++;
    }
    dataIndex++;
  }
  return buf.subarray(0, bufIndex);
}
