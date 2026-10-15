'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const reglas = require('../compartido/reglas.json');
const s = require('../netlify/functions/nucleo/sesion');

const SECRETO = 'un-secreto-largo-de-prueba-0123456789abcdef';
const ANA = { id: 'AdrianaPR', nombre: 'Adriana Perla R', rol: 'usuario' };
const AHORA = 1_800_000_000;

test('un token recién creado se verifica y devuelve la sesión', () => {
  const token = s.crearToken(ANA, SECRETO, { duracionSegundos: 3600, ahoraSegundos: AHORA });
  assert.deepEqual(s.verificarToken(token, SECRETO, { ahoraSegundos: AHORA + 10 }), { ok: true, sesion: ANA });
});

test('vence exactamente a la hora indicada', () => {
  const token = s.crearToken(ANA, SECRETO, { duracionSegundos: 3600, ahoraSegundos: AHORA });
  assert.equal(s.verificarToken(token, SECRETO, { ahoraSegundos: AHORA + 3599 }).ok, true);
  const vencido = s.verificarToken(token, SECRETO, { ahoraSegundos: AHORA + 3600 });
  assert.equal(vencido.codigo, 'TOKEN_VENCIDO');
  assert.equal(vencido.estado, 401);
});

test('con otro secreto no se acepta', () => {
  const token = s.crearToken(ANA, SECRETO, { duracionSegundos: 3600, ahoraSegundos: AHORA });
  assert.equal(s.verificarToken(token, 'otro-secreto-distinto-0123456789abcdef', { ahoraSegundos: AHORA }).codigo, 'TOKEN_INVALIDO');
});

test('si se altera el contenido (por ejemplo el rol), la firma deja de coincidir', () => {
  const token = s.crearToken(ANA, SECRETO, { duracionSegundos: 3600, ahoraSegundos: AHORA });
  const [enc, cuerpo, firma] = token.split('.');
  const alterado = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  alterado.rol = 'admin';
  const falso = `${enc}.${Buffer.from(JSON.stringify(alterado)).toString('base64url')}.${firma}`;
  assert.equal(s.verificarToken(falso, SECRETO, { ahoraSegundos: AHORA }).codigo, 'TOKEN_INVALIDO');
});

test('se rechaza un token sin firma con algoritmo "none"', () => {
  const enc = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify({ sub: 'Admin', rol: 'admin', exp: AHORA + 1000 })).toString('base64url');
  assert.equal(s.verificarToken(`${enc}.${cuerpo}.`, SECRETO, { ahoraSegundos: AHORA }).codigo, 'TOKEN_INVALIDO');
  assert.equal(s.verificarToken(`${enc}.${cuerpo}`, SECRETO, { ahoraSegundos: AHORA }).codigo, 'TOKEN_INVALIDO');
});

test('se rechaza un token firmado con otro algoritmo aunque la firma sea válida', () => {
  const enc = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify({ sub: 'Admin', rol: 'admin', exp: AHORA + 1000 })).toString('base64url');
  const firma = crypto.createHmac('sha512', SECRETO).update(`${enc}.${cuerpo}`).digest('base64url');
  assert.equal(s.verificarToken(`${enc}.${cuerpo}.${firma}`, SECRETO, { ahoraSegundos: AHORA }).codigo, 'TOKEN_INVALIDO');
});

test('basura, vacío y tipos incorrectos no lanzan errores', () => {
  for (const x of [undefined, null, '', 'a.b', 'a.b.c', 'x'.repeat(50), 123]) {
    assert.equal(s.verificarToken(x, SECRETO).ok, false);
  }
});

test('duración de sesión según el rol (usuario 4 h, admin y gestor 12 h)', () => {
  assert.equal(s.duracionDeSesion(reglas, 'usuario'), 4 * 3600);
  assert.equal(s.duracionDeSesion(reglas, 'gestor'), 12 * 3600);
  assert.equal(s.duracionDeSesion(reglas, 'admin'), 12 * 3600);
  assert.equal(s.duracionASegundos('30m'), 1800);
  assert.throws(() => s.duracionASegundos('mucho'), /no válida/);
});

test('extraerToken: lee Authorization Bearer sin distinguir mayúsculas del nombre', () => {
  assert.equal(s.extraerToken({ authorization: 'Bearer abc.def.ghi' }), 'abc.def.ghi');
  assert.equal(s.extraerToken({ Authorization: 'bearer abc' }), 'abc');
  assert.equal(s.extraerToken({ Authorization: 'Basic abc' }), null);
  assert.equal(s.extraerToken({}), null);
  assert.equal(s.extraerToken(), null);
});
