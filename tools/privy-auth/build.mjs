// Pre-bundlea el modulo de login (Privy) a UN asset estatico.
//
// El juego no tiene bundler a proposito. En vez de meterle Vite y React por una
// pantalla de login, bundleamos SOLO este modulo y commiteamos el resultado como
// si fuera una libreria vendorizada mas.
//
//   npm --prefix tools/privy-auth install
//   node tools/privy-auth/build.mjs
//
// Salida: assets/js/privy-auth.js  (ESM, listo para <script type="module">)
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outfile = path.join(repo, 'assets', 'js', 'privy-auth.js');

fs.mkdirSync(path.dirname(outfile), { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(here, 'src', 'privy-auth.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // el SDK trae ramas de node; el navegador no las necesita
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  outfile,
  metafile: true,
});

const bytes = fs.statSync(outfile).size;
console.log(`ok  ${path.relative(repo, outfile)}  ${(bytes / 1024).toFixed(1)} KB`);

// El asset se sirve sin bundler: no puede quedar ninguna referencia a builtins de
// node ni a `require`, o revienta en el navegador.
const code = fs.readFileSync(outfile, 'utf8');
const forbidden = [/\brequire\s*\(/, /\bmodule\.exports\b/, /\bprocess\.version\b/];
const hits = forbidden.filter((re) => re.test(code));
if (hits.length) {
  console.error('FALLA: el bundle referencia cosas de node:', hits.map(String).join(', '));
  process.exit(1);
}
console.log('ok  sin require()/module.exports/process.version');
