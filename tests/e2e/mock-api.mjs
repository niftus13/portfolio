import { createServer } from "node:http";

const server = createServer((request, response) => {
  if (request.url !== "/health/ready") {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "ready", database: "connected" }));
});

server.listen(4001, "127.0.0.1");
