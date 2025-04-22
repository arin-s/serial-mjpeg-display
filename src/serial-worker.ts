/// <reference lib="webworker"/>

import {
  serial as polyfill,
  SerialPort as SerialPortPolyfill,
} from 'web-serial-polyfill';

const workerCtx = self as DedicatedWorkerGlobalScope;
export const serialBufferSize = 1024; // 1kB

export interface SerialMessageEvent {
  msg: MsgType;
  startParams?: { usePolyfill: boolean; baudRate: number };
  array?: Uint8Array;
}

let serial: Serial | typeof polyfill;
let port: SerialPort | SerialPortPolyfill | undefined;
let reader: ReadableStreamBYOBReader | ReadableStreamDefaultReader;
let usePolyfill: boolean;
let baudRate: number;

export enum MsgType {
  CONNECT = 1,
  CONNECTED,
  CONNECT_FAILED,
  DISCONNECT,
  DISCONNECTED,
  SERIAL_CHUNK,
}

addEventListener('message', async (event: MessageEvent<SerialMessageEvent>) => {
  console.log(event.data);
  if (event.data.msg) {
    switch (event.data.msg) {
      case MsgType.CONNECT:
        if (!event.data.startParams) {
          console.error('Start parameters not found!');
          sendMessage({ msg: MsgType.CONNECT_FAILED });
          return;
        }
        usePolyfill = event.data.startParams.usePolyfill;
        baudRate = event.data.startParams.baudRate;
        connect();
        break;
      case MsgType.DISCONNECT:
        // TODO: clean up here
        break;
    }
  }
});

async function connect() {
  const options: SerialOptions = {
    baudRate: baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    flowControl: 'none',
    bufferSize: serialBufferSize,
  };
  serial = usePolyfill ? polyfill : navigator.serial;
  console.log(serial);
  try {
    const ports = await serial.getPorts();
    console.log(ports);
    port = ports[0];
  }
  catch (e) {
    if (e instanceof Error)
      console.error(`ERROR ${e.name}: ${e.message}`);
    sendMessage({ msg: MsgType.CONNECT_FAILED });
    return;
  }
  if (!port) {
    console.warn('A port was not selected');
    return;
  }
  try {
    await port.open(options);
  }
  catch (e) {
    console.error(e);
    if (e instanceof Error)
      console.error(`ERROR: ${e.message}`);
    sendMessage({ msg: MsgType.CONNECT_FAILED });
    return;
  }
  sendMessage({ msg: MsgType.CONNECTED });
  // Outer loop
  console.log('Port opened, obtaining stream');
  while (port.readable) {
    try {
      reader = port.readable.getReader({ mode: 'byob' });
      console.log('Obtained BYOB reader');
    }
    catch (e) {
      console.warn(e);
      console.warn('Failed to get BYOBReader, falling back to DefaultReader');
      try {
        reader = port.readable.getReader();
      }
      catch {
        console.error('Failed to get DefaultReader, aborting');
        // workerCtx.postMessage(MsgType.CONNECT_FAILED);
        // return;
        break;
      }
    }
    try {
      let buffer: ArrayBuffer | undefined;
      let value: Uint8Array | undefined;
      let done: boolean;
      while (true) {
        // Read from reader
        if (reader instanceof ReadableStreamBYOBReader) {
          // not efficient since we're not reusing buffers, hindsight 20/20
          if (!buffer || buffer.byteLength === 0)
            buffer = new ArrayBuffer(serialBufferSize);
          ({ value, done } = await reader.read(new Uint8Array(buffer, 0, serialBufferSize)));
          if (!value?.buffer)
            throw new Error('Failed to extract buffer from reader result!');
          buffer = value?.buffer;
        }
        else {
          ({ value, done } = await reader.read());
        }
        if (done) {
          console.log('Stream cancelled');
          break;
        }
        // Send data to main thread
        if (value) {
          sendMessage({ msg: MsgType.SERIAL_CHUNK, array: value }, value.buffer);
        }
      }
    }
    catch (e) {
      console.error(e);
    }
    finally {
      if (reader)
        reader.releaseLock();
    }
  }
  if (port)
    await port.close();
  sendMessage({ msg: MsgType.DISCONNECTED });
}

/*
// These events are not supported by the polyfill.
// https://github.com/google/web-serial-polyfill/issues/20
if (!usePolyfill) {
  navigator.serial.addEventListener('connect', (event) => {
    const portOption = addNewPort(event.target as SerialPort);
    if (autoconnectCheckbox.checked) {
      portOption.selected = true;
      connectToPort();
    }
  });
  navigator.serial.addEventListener('disconnect', (event) => {
    const portOption = findPortOption(event.target as SerialPort);
    if (portOption) {
      portOption.remove();
    }
  });
}
*/

function sendMessage(args: SerialMessageEvent, transfer?: Transferable) {
  if (!transfer)
    workerCtx.postMessage(args);
  else
    workerCtx.postMessage(args, [transfer]);
}
