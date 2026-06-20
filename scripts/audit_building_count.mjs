// Assert default City generation keeps OSM building count (no procedural explosion).
import { readFileSync } from 'fs';
import { City } from '../src/citygen.js';

const raw = JSON.parse(readFileSync('./assets/zone.json', 'utf8'));
const osm = raw.buildings.length;

const clone = JSON.parse(JSON.stringify(raw));
const cityDefault = new City(clone);
const afterDefault = cityDefault.data.buildings.length;

const cloneProc = JSON.parse(JSON.stringify(raw));
const cityProc = new City(cloneProc, { frontageStrips: true, interiorCarpet: true });
const afterProc = cityProc.data.buildings.length;

console.log('OSM buildings in zone.json:', osm);
console.log('After City() default:', afterDefault);
console.log('After City(procedural on):', afterProc);

let ok = true;
if (afterDefault !== osm) {
  console.error('FAIL: default city should keep OSM count');
  ok = false;
}
if (afterProc <= osm) {
  console.error('FAIL: procedural opt-in should add filler');
  ok = false;
}
if (!ok) process.exit(1);
console.log('PASS: building count audit');