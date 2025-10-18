import { Server, Socket } from 'socket.io';
import fs from 'fs';
import http from 'http';
import mime from 'mime-types';
import { SerialPort } from 'serialport';
import { ClientToServerEvents, createKeyPacket, PacketType, processChunk, ServerToClientEvents } from 'serial-mjpeg-common';

const HTTP_PORT = 8080;
let clients = new Map<String, Socket>();

// setup http server
const server = http.createServer((req, res) => {
  if (req.url === '/')
    req.url = '/index.html';
  fs.readFile('../serial-mjpeg-display/dist' + req.url, (err, data) => {
    console.log(req.url);
    if (err == null) {
      const mimeType = mime.lookup(req.url) ? <string>mime.lookup(req.url) : 'text/html';
      res.statusCode = 200;
      res.setHeader('Content-Type', mimeType);
      res.setHeader('DOOMBUDS-RELAY', 0);
      res.write(data);
    } else {
      res.writeHead(404);
    }
    res.end();
  });
});

// setup Socket.io server
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents>(server, {
  cors: {
    // yeah just let em in
    origin: true,
  },
});

// set Socket.io events
io.on('connection', (client) => {
  console.log(`Client ${client.id} connected`);
  clients.set(client.id, client);
  // events
  client.on('keyState', (keyStateArray) => {
    serialPort.write(createKeyPacket(keyStateArray));
  });
  client.on('disconnect', (reason) => {
    console.log(`Client ${client.id} disconnected`);
    clients.delete(client.id);
  });
});

// start http server
server.listen(HTTP_PORT, 'localhost', () => {
  console.log(`Server running at http://localhost:${HTTP_PORT}/`);
});

// connect to earbud (hardcoded at the moment)
const serialPort = new SerialPort({ path: 'COM8', baudRate: 3000000 });
serialPort.on('data', (chunk: Buffer) => {
  const packet = processChunk(chunk);
  if (packet === null)
    return;
  switch (packet.packetType) {
    case PacketType.PACKET_LOG:
      console.log(new TextDecoder().decode(packet.packetData));
      break;
    case PacketType.PACKET_VIDEO:
      console.log(`Video Packet Size ${packet.packetData.byteLength}`);
      for (const client of clients.values()) {
        client.emit('decodedPacket', packet);
        console.log(`Emitting to client ${client.id}`);
      }
      break;
  }
})