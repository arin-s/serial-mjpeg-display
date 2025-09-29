import {
  serial as polyfill,
} from 'web-serial-polyfill';
import {
  MsgType,
  SerialMessageEvent,
} from './serial-worker';

import { testFunc } from 'serial-mjpeg-common';
testFunc();

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
let keyLabel = document.getElementById('keyLabel') as HTMLInputElement;
let keys: Map<number, boolean> = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  // Setup elements and listeners
  displayCanvas = document.getElementById('canvas') as HTMLCanvasElement;
  displayCanvas.addEventListener('keydown', processInput);
  displayCanvas.addEventListener('keyup', processInput)
  connectButton = document.getElementById('connect') as HTMLButtonElement;
  baudRateSelector = document.getElementById('baudrate') as HTMLSelectElement;
  polyfillCheckbox = document.getElementById('polyfill_checkbox') as HTMLInputElement;
  keyLabel = document.getElementById('keyLabel') as HTMLInputElement;
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
    const serial = polyfillCheckbox.checked ? polyfill : navigator.serial;
    const ports = await serial.getPorts();
    for (const port of ports)
      await port.forget();
    try {
      await serial.requestPort({});
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
    case MsgType.SERIAL_RX:
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
      const decoded = cobsDecode(frame);
      const packetType = decoded[0];
      const packetData = decoded.slice(1, decoded.length + 2);
      console.log(packetType);
      if(packetType === 1)
        paintCanvas(packetData);
      if(packetType === 0) {
        const text = new TextDecoder().decode(packetData);
        console.log(text);
      }
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
  let imageBitmap: ImageBitmap;
  try {
    imageBitmap = await createImageBitmap(blob);
  } catch (error) {
    console.error("MALFORMED IMAGE: ", error);
    return;
  }
  ctx?.drawImage(imageBitmap, 0, 0, displayCanvas.clientWidth, displayCanvas.clientHeight);
  imageBitmap.close();
  //sendKeyPress();
}

function processInput(event: KeyboardEvent) {
  event.preventDefault();
  let pressed: boolean = event.type == "keydown";
  let code = event.keyCode;
  if (code >= 'A'.charCodeAt(0) && code <= 'Z'.charCodeAt(0))
    code += 32;
  keys.set(code, pressed);
  // Create frame to be sent
  let keyStateFrame: string = "[doom,";
  let mask = 1 << 7;
  for (let keyPair of keys) {
    let encodedKey = keyPair[0];
    if(keyPair[1])
      encodedKey |= mask;
    else
      encodedKey &= ~mask;
    keyStateFrame += String.fromCharCode(encodedKey);
  }
  keyStateFrame += "]";
  let x: string = "";
  for (let char of keyStateFrame)
    x += char.charCodeAt(0) + " ";
  x += ` length:${keyStateFrame.length}`;
  keyLabel.textContent = x;
  let frame = new Uint8Array(keyStateFrame.length);
  for (let i = 0; i < frame.length; i++)
    frame[i] = keyStateFrame.charCodeAt(i);
  serialWorker.postMessage({msg: MsgType.SERIAL_TX, array: frame});
}

function cobsEncode(data: Uint8Array): Uint8Array {
  // Largest possible size for result buffer
  let buf = new Uint8Array(1 + Math.ceil(data.length * 255 / 254));
  let dataIndex = 0;
  let bufIndex = 1; // Set to 1 to leave room for the header byte
  let linkIndex = 0; // Keeps track of the last link location
  let linkOffset = 1; // Offset of the next link relative to the previous one
  while (dataIndex < data.length) {
    // Zero byte or max link size reached
    if (data[dataIndex] === 0 || linkOffset === 255) {
      buf[linkIndex] = linkOffset;
      linkIndex = bufIndex;
      linkOffset = 0;
      if (data[dataIndex] === 0)
        dataIndex++;
    }
    // Non-zero data byte
    else if (data[dataIndex] !== 0) {
      buf[bufIndex] = data[dataIndex];
      dataIndex++;
    }
    bufIndex++;
    linkOffset++;
  }
  buf[linkIndex] = linkOffset;
  return buf;
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
