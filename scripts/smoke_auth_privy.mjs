// Smoke: verificacion de access tokens de Privy.
//
// Se genera un par de claves ES256 de verdad, se firman tokens y se comprueba
// que el verificador acepta el bueno y RECHAZA todos los ataques clasicos:
// firma de otra clave, `alg: none`, HS256 con la clave publica como secreto,
// audiencia ajena, emisor ajeno y token expirado.
//
// No hace falta ninguna credencial real para correr esto.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as jose from '../server/node_modules/jose/dist/webapi/index.js';

const require = createRequire(import.meta.url);
const { verifyPrivyToken, isConfigured } = require('../server/auth_privy.js');

const APP_ID = 'cmtestappid000000000000000';
const OTHER_APP = 'cmotherapp000000000000000';

const { publicKey, privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
const spki = await jose.exportSPKI(publicKey);
const evil = await jose.generateKeyPair('ES256', { extractable: true });

const sign = (claims, key = privateKey, alg = 'ES256') =>
  new jose.SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

const V = (token, over = {}) =>
  verifyPrivyToken(token, { appId: APP_ID, verificationKey: spki, ...over });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' ' + detail : ''));
  if (!ok) failures++;
};

// 1. Token legitimo: aceptado, y devuelve el DID del usuario.
{
  const t = await sign({ iss: 'privy.io', aud: APP_ID, sub: 'did:privy:abc123', sid: 'sess1' });
  const r = await V(t);
  check('token valido aceptado', r.ok === true, r.error || '');
  check('devuelve el DID (identidad estable)', r.subject === 'did:privy:abc123', r.subject || '');
}

// 2. Firmado con OTRA clave -> rechazado.
{
  const t = await sign({ iss: 'privy.io', aud: APP_ID, sub: 'did:privy:evil' }, evil.privateKey);
  const r = await V(t);
  check('firma de otra clave RECHAZADA', r.ok === false, r.error);
}

// 3. `alg: none` (token sin firma) -> rechazado.
{
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: 'privy.io', aud: APP_ID, sub: 'did:privy:evil',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const r = await V(`${header}.${body}.`);
  check('alg:none RECHAZADO', r.ok === false, r.error);
}

// 4. Confusion de algoritmo: HS256 usando la clave PUBLICA como secreto.
{
  const secret = new TextEncoder().encode(spki);
  const t = await new jose.SignJWT({ iss: 'privy.io', aud: APP_ID, sub: 'did:privy:evil' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
  const r = await V(t);
  check('confusion HS256 con la clave publica RECHAZADA', r.ok === false, r.error);
}

// 5. Audiencia de otra app -> rechazado (un token de aiSuited no entra al juego).
{
  const t = await sign({ iss: 'privy.io', aud: OTHER_APP, sub: 'did:privy:abc123' });
  const r = await V(t);
  check('token de OTRA app RECHAZADO', r.ok === false, r.error);
}

// 6. Emisor ajeno -> rechazado.
{
  const t = await sign({ iss: 'evil.example', aud: APP_ID, sub: 'did:privy:abc123' });
  const r = await V(t);
  check('emisor ajeno RECHAZADO', r.ok === false, r.error);
}

// 7. Token expirado -> rechazado (la tolerancia de reloj es de 30s, no de horas).
{
  const past = Math.floor(Date.now() / 1000) - 7200;
  const t = await new jose.SignJWT({ iss: 'privy.io', aud: APP_ID, sub: 'did:privy:abc123' })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt(past)
    .setExpirationTime(past + 3600)   // expiro hace una hora
    .sign(privateKey);
  const r = await V(t);
  check('token expirado RECHAZADO', r.ok === false, r.error);
}

// 8. Basura y tamanos absurdos -> rechazados sin lanzar.
{
  for (const bad of ['', 'x', 'a.b.c', null, undefined, 123, 'z'.repeat(9000)]) {
    const r = await V(bad);
    if (r.ok !== false) { check(`basura rechazada (${String(bad).slice(0, 12)})`, false); break; }
  }
  check('basura y tamanos absurdos rechazados sin lanzar', true);
}

// 9. FALLA CERRADO: sin configuracion, ningun token pasa.
{
  const t = await sign({ iss: 'privy.io', aud: APP_ID, sub: 'did:privy:abc123' });
  const r = await verifyPrivyToken(t, { appId: '', verificationKey: '' });
  check('sin configurar, TODO token se rechaza (falla cerrado)', r.ok === false, r.error);
  check('isConfigured() refleja el entorno', typeof isConfigured() === 'boolean');
}

// 10. Camino JWKS (el que usa produccion): las claves se leen de un endpoint y
//     Privy las ROTA. Se sirve un JWKS local para no depender de la red.
{
  const http = await import('node:http');
  const jwk = await jose.exportJWK(publicKey);
  jwk.alg = 'ES256'; jwk.use = 'sig'; jwk.kid = 'kid-actual';
  const evilJwk = await jose.exportJWK(evil.publicKey);
  evilJwk.alg = 'ES256'; evilJwk.use = 'sig'; evilJwk.kid = 'kid-viejo';

  // el endpoint publica DOS claves, como el real: una vieja y la actual
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [evilJwk, jwk] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/jwks.json`;

  const good = await new jose.SignJWT({ sub: 'did:privy:jwks' })
    .setProtectedHeader({ alg: 'ES256', kid: 'kid-actual' })
    .setIssuer('privy.io').setAudience(APP_ID)
    .setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const r1 = await verifyPrivyToken(good, { appId: APP_ID, jwksUrl: url });
  check('JWKS: token firmado con una clave publicada -> aceptado', r1.ok === true, r1.error || '');
  check('JWKS: devuelve el DID', r1.subject === 'did:privy:jwks');

  // firmado con una clave que NO esta en el JWKS
  const stranger = await jose.generateKeyPair('ES256', { extractable: true });
  const bad = await new jose.SignJWT({ sub: 'did:privy:evil' })
    .setProtectedHeader({ alg: 'ES256', kid: 'kid-actual' })
    .setIssuer('privy.io').setAudience(APP_ID)
    .setIssuedAt().setExpirationTime('1h').sign(stranger.privateKey);
  const r2 = await verifyPrivyToken(bad, { appId: APP_ID, jwksUrl: url });
  check('JWKS: clave ajena RECHAZADA', r2.ok === false, r2.error);

  server.close();
}

console.log(failures === 0 ? 'ALL PASS (con JWKS)' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
