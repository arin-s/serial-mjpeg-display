import { Socket } from 'socket.io';
import fs from 'fs';
import http from 'http';
import mime from 'mime-types';

const PORT = 8080;

// basic http server
const server = http.createServer((req, res) => {
  if (req.url === '/')
    req.url = '/index.html';
  fs.readFile('../serial-mjpeg-display/dist' + req.url, (err, data) => {
    console.log(req.url);
    if (err == null) {
      const mimeType = mime.lookup(req.url) ? <string>mime.lookup(req.url) : 'text/html';
      res.writeHead(200, { 'Content-Type': mimeType });
      res.write(data);
    } else {
      res.writeHead(404);
    }
    res.end();
  });
});

server.listen(PORT, 'localhost', () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});