// Minimal loopback OTLP/HTTP JSON capture RECEIVER for external conformance CI.
// Not an Atto implementation, an OTel SDK, or an exporter. It captures real
// requests only when separately driven by an actual guest process.
import {createServer} from 'node:http';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const MAX_BYTES = 1048576;
const MAX_REQUESTS = 1024;

export async function startReceiver({output, port = 0} = {}) {
  if (typeof output !== 'string' || !output) throw Error('output path required');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Error('invalid loopback port');
  }

  // Restrict the output file to owner-only. A local test collector can still
  // contain sensitive data if the instrumented guest violates redaction.
  const sink = await open(output, 'a', 0o600);
  let pending = Promise.resolve();
  let requests = 0;
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/traces' || req.method !== 'POST') {
      res.writeHead(404); res.end(); return;
    }
    if (req.headers['content-type'] !== 'application/json'
        || req.headers['content-encoding'] != null) {
      res.writeHead(415); res.end(); return;
    }
    if (++requests > MAX_REQUESTS) {
      res.writeHead(429); res.end(); return;
    }
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) throw Error('request exceeds 1 MiB');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed?.resourceSpans)
          || parsed.resourceSpans.length === 0) {
        throw Error('not an OTLP ExportTraceServiceRequest');
      }
      // Serialize writes. This is a separate test process and never blocks
      // an Atto actor or runs in a guest's request-processing hot path.
      const line = JSON.stringify(parsed) + '\n';
      pending = pending.then(() => sink.write(line));
      await pending;
      res.writeHead(200, {'content-type': 'application/json'});
      res.end('{}');
    } catch {
      res.writeHead(400, {'content-type': 'application/json'});
      res.end('{}');
    }
  });
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (e) {
    await sink.close();
    throw e;
  }
  let closed = false;
  return {
    address: server.address(),
    count: () => requests,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise(resolve => server.close(resolve));
      await pending;
      await sink.close();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [output, portText] = process.argv.slice(2);
  if (!output || process.argv.length > 4) {
    process.stderr.write('usage: node otlp-http-receiver.mjs <output.jsonl> [loopback-port]\n');
    process.exitCode = 2;
  } else {
    const port = portText ? Number(portText) : 4318;
    try {
      const receiver = await startReceiver({output, port});
      process.stdout.write('OTLP_LOOPBACK_READY ' + receiver.address.port + '\n');
      const close = async () => {await receiver.close(); process.exitCode = 0;};
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    } catch (e) {
      process.stderr.write(String(e.message) + '\n');
      process.exitCode = 1;
    }
  }
}
