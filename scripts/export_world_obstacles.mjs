import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { City, cropZoneData } from '../src/citygen.js';

const sourceUrl = new URL('../assets/zone.json', import.meta.url);
const outputUrl = new URL('../server/world_obstacles.json', import.meta.url);
const sourceText = await readFile(sourceUrl, 'utf8');
const data = JSON.parse(sourceText);
cropZoneData(data);

const city = new City(data, { frontageStrips: true, interiorCarpet: true });
const round = (value) => Math.round(Number(value) * 100) / 100;
const obstacles = city.rings
  .map(({ bb, ring }) => [
    ...bb.map(round),
    ...ring.flatMap(([x, z]) => [round(x), round(z)]),
  ])
  .filter((entry) => entry.length >= 10
    && entry.every(Number.isFinite)
    && entry[2] > entry[0]
    && entry[3] > entry[1])
  .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));

const payload = {
  schemaVersion: 1,
  sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
  options: { frontageStrips: true, interiorCarpet: true },
  obstacles,
};

await writeFile(outputUrl, JSON.stringify(payload));
console.log(JSON.stringify({
  output: outputUrl.pathname,
  obstacleCount: obstacles.length,
  bytes: Buffer.byteLength(JSON.stringify(payload)),
  sourceSha256: payload.sourceSha256,
}));
