'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../netlify/functions/nucleo/contrasenas');

test('el hash tiene sal propia: la misma clave da hashes distintos y ambos verifican', async () => {
  const h1 = await c.generarHash('MiClave-2026');
  const h2 = await c.generarHash('MiClave-2026');
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$16384\$8\$1\$/);
  assert.equal((await c.verificarClave('MiClave-2026', h1)).ok, true);
  assert.equal((await c.verificarClave('MiClave-2026', h2)).ok, true);
});

test('una clave incorrecta no verifica', async () => {
  const h = await c.generarHash('MiClave-2026');
  assert.equal((await c.verificarClave('miclave-2026', h)).ok, false);
  assert.equal((await c.verificarClave('', h)).ok, false);
});

test('el hash nuevo no necesita actualizarse', async () => {
  const h = await c.generarHash('MiClave-2026');
  assert.equal((await c.verificarClave('MiClave-2026', h)).necesitaActualizar, false);
});

test('compatibilidad con Espacia: acepta el SHA-256 antiguo y pide reemplazarlo', async () => {
  const antiguo = c.sha256Hex('AdrianaPR1234567');
  assert.equal(c.esHashAntiguo(antiguo), true);
  const bien = await c.verificarClave('AdrianaPR1234567', antiguo);
  assert.deepEqual(bien, { ok: true, necesitaActualizar: true });
  const mal = await c.verificarClave('otra', antiguo);
  assert.deepEqual(mal, { ok: false, necesitaActualizar: false });
});

test('entradas inválidas o formatos desconocidos se rechazan sin lanzar error', async () => {
  assert.equal((await c.verificarClave('x', undefined)).ok, false);
  assert.equal((await c.verificarClave(undefined, 'scrypt$1$2')).ok, false);
  assert.equal((await c.verificarClave('x', 'basura')).ok, false);
  assert.equal((await c.verificarClave('x'.repeat(200), await c.generarHash('abc12345'))).ok, false);
});

test('verificación falsa (usuario inexistente) siempre da no, sin errores', async () => {
  assert.deepEqual(await c.verificacionFalsa('lo-que-sea'), { ok: false, necesitaActualizar: false });
});

test('fortaleza: mínimo 8 y máximo 128 caracteres', () => {
  assert.equal(c.validarFortalezaClave('corta').codigo, 'CLAVE_MUY_CORTA');
  assert.equal(c.validarFortalezaClave('x'.repeat(129)).codigo, 'CLAVE_MUY_LARGA');
  assert.equal(c.validarFortalezaClave('suficiente1').ok, true);
  assert.equal(c.validarFortalezaClave(undefined).ok, false);
});

test('clave temporal: largo pedido, solo caracteres no ambiguos y distinta cada vez', () => {
  const a = c.generarClaveTemporal();
  const b = c.generarClaveTemporal();
  assert.equal(a.length, 12);
  assert.match(a, /^[A-HJ-NP-Za-km-z2-9]+$/);
  assert.notEqual(a, b);
  assert.equal(c.generarClaveTemporal(20).length, 20);
});
