import net from "node:net";

import { parseHeaders, sendResponse } from "./handlers.js";

const server = net.createServer((socket) => {
  let buf = "";
  socket.on("data", (chunk) => {
    buf += chunk.toString("latin1");

    const headerEndIndex = buf.indexOf("\r\n\r\n");

    if (headerEndIndex === -1) {
      return;
    }

    const headersPart = buf.slice(0, headerEndIndex);
    const request = parseHeaders(headersPart);

    const contentLength = parseInt(request.headers["content-length"] || "0");

    const bodyStartIndex = headerEndIndex + 4;
    const bodyEndIndex = bodyStartIndex + contentLength;

    if (buf.length - bodyStartIndex < contentLength) {
      return;
    }

    if (request.method === "GET" && request.path === "/") {
      const body = "Hello, World!";
      const headers = {
        "Content-Type": "text/plain",
        "Content-Length": Buffer.byteLength(body),
      };
      sendResponse(socket, 200, "OK", headers, body);
    } else if (request.method === "GET" && request.path === "/headers") {
      const body = JSON.stringify(request.headers);
      const headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      };
      sendResponse(socket, 200, "OK", headers, body);
    } else {
      const body = "Not Found";
      const headers = {
        "Content-Type": "text/plain",
        "Content-Length": Buffer.byteLength(body),
      };
      sendResponse(socket, 404, "Not Found", headers, body);
    }
  });
});

server.listen(3000, () => console.log("listening on 3000"));
