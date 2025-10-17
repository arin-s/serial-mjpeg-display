export enum PacketType {
  PACKET_LOG,
  PACKET_VIDEO,
  PACKET_SOUND,
  PACKET_NETWORK,
  PACKET_INPUT,
};

export type Packet = { packetType: PacketType; packetData: ArrayBuffer };

export interface ServerToClientEvents {
  decodedPacket: (packet: Packet) => void;
}

export interface ClientToServerEvents {
  keyState: (keyState: Map<number, boolean>) => void;
}

// Stores input chunks, average frame size = 13.5kb
const chunkBuffer = new Uint8Array(1024 * 1000); // 1000KB
// The amount of bytes in chunkBuffer
let chunkBufferOffset = 0;
// Keep track of reading index
let readIndex = 0;
// To prevent concurrent function calls
let mutex = false;
// Stores result frame
let frame: Uint8Array;

export function processChunk(inputChunk: Uint8Array): null | Packet {
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
      // Set variables for next call then return
      chunkBufferOffset = remainder.length;
      readIndex = 0;
      mutex = false;
      const slicedArray = packetData.buffer.slice(packetData.byteOffset, packetData.byteOffset + packetData.byteLength);
      return { packetType, packetData: slicedArray };
    }
  }
  chunkBufferOffset += inputChunk.length;
  readIndex = chunkBufferOffset;
  mutex = false;
  return null;
}

export function cobsEncode(data: Uint8Array): Uint8Array {
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

export function cobsDecode(data: Uint8Array): Uint8Array {
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
