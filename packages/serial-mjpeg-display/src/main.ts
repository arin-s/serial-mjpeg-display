import {
  serial as polyfill,
} from 'web-serial-polyfill';
import {
  MsgType,
  SerialMessageEvent,
} from './serial-worker';

import { processChunk, PacketType } from 'serial-mjpeg-common';

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
  let packet: null | { packetType: number; packetData: Uint8Array<ArrayBuffer> };
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
      packet = processChunk(event.data.array!);
      if (packet === null)
        break;
      console.log(`PACKET RECEIVED: ${packet.packetType}`);
      switch (packet.packetType) {
        case PacketType.PACKET_LOG:
          console.log(new TextDecoder().decode(packet.packetData));
          break;
        case PacketType.PACKET_VIDEO:
          paintCanvas(packet.packetData);
          break;
      }
      break;
  }
});

async function paintCanvas(frame: Uint8Array<ArrayBuffer>) {
  const blob = new Blob([frame.buffer], { type: 'image/jpeg' });
  bpsCounter += blob.size * 8;
  fpsCounter++;
  frameSizeLabel.innerText = "Frame Size: " + blob.size;
  //fb.src = URL.createObjectURL(blob);
  let imageBitmap: ImageBitmap;
  try {
    imageBitmap = await createImageBitmap(blob);
  } catch (error) {
    console.error("MALFORMED IMAGE: ", error);
    console.error(`FRAME SIZE: ${frame.length}`);
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
