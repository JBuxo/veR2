#!/usr/bin/env node
import { createWriteStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createClient } from "./config.js";
import { main } from "./main.js";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const toNode = (body: ReadableStream<Uint8Array>) => Readable.fromWeb(body as NodeReadableStream<Uint8Array>);

process.exitCode = await main(process.argv.slice(2), {
  stdout: (line) => void process.stdout.write(`${line}\n`),
  stderr: (line) => void process.stderr.write(`${line}\n`),
  env: process.env,
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: (path, body) => pipeline(toNode(body), createWriteStream(path)),
  writeStdout: (body) => pipeline(toNode(body), process.stdout, { end: false }),
  client: createClient,
});
