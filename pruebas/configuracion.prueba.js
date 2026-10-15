'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../netlify/functions/nucleo/configuracion');

const SECRETO = 'x'.repeat(40);

const envBase = (cambios = {}) => ({
  ESPACIAV2_MODO: 'pruebas',
  ESPACIAV2_SESION_SECRETO: SECRETO,
  ESPACIAV2_GOOGLE_CUENTA_EMAIL: 'cuenta@proyecto.iam.gserviceaccount.com',
  ESPACIAV2_GOOGLE_CLAVE_PRIVADA: '"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n"',
  ESPACIAV2_GOOGLE_CALENDARIO_ID: 'real@group.calendar.google.com',
  ESPACIAV2_GOOGLE_CALENDARIO_PRUEBAS_ID: 'pruebas@group.calendar.google.com',
  ESPACIAV2_GITHUB_TOKEN: 'token-de-ejemplo',
  ESPACIAV2_GITHUB_REPO: 'FABIOR1981/bd',
  ESPACIAV2_GITHUB_RUTA_USUARIOS: 'espaciaV2/usuarios.json',
  ...cambios,
});

test('configuración completa: se arma con valores por defecto razonables', () => {
  const cfg = c.cargarConfiguracion(envBase());
  assert.equal(cfg.modo, 'pruebas');
  assert.equal(cfg.zonaHoraria, 'America/Montevideo');
  assert.equal(cfg.notificarInvitados, false);
  assert.equal(cfg.github.rama, 'main');
  assert.equal(cfg.github.repo, 'FABIOR1981/bd');
});

test('configuración: el modo decide qué calendario se usa', () => {
  assert.equal(c.cargarConfiguracion(envBase({ ESPACIAV2_MODO: 'pruebas' })).google.calendarioId, 'pruebas@group.calendar.google.com');
  assert.equal(c.cargarConfiguracion(envBase({ ESPACIAV2_MODO: 'produccion' })).google.calendarioId, 'real@group.calendar.google.com');
});

test('configuración: la clave privada se normaliza (comillas y \\n literales)', () => {
  const cfg = c.cargarConfiguracion(envBase());
  assert.equal(cfg.google.clavePrivada, '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n');
});

test('configuración: indica por nombre cada variable que falta', () => {
  const env = envBase();
  delete env.ESPACIAV2_GITHUB_TOKEN;
  delete env.ESPACIAV2_SESION_SECRETO;
  try {
    c.cargarConfiguracion(env);
    assert.fail('debía lanzar ConfiguracionIncompleta');
  } catch (e) {
    assert.ok(e instanceof c.ConfiguracionIncompleta);
    assert.equal(e.estado, 500);
    assert.ok(e.problemas.includes('falta ESPACIAV2_GITHUB_TOKEN'));
    assert.ok(e.problemas.includes('falta ESPACIAV2_SESION_SECRETO'));
  }
});

test('configuración: el modo debe indicarse explícitamente y ser válido', () => {
  const sinModo = envBase();
  delete sinModo.ESPACIAV2_MODO;
  assert.throws(() => c.cargarConfiguracion(sinModo), /falta ESPACIAV2_MODO/);
  assert.throws(() => c.cargarConfiguracion(envBase({ ESPACIAV2_MODO: 'desarrollo' })), /produccion" o "pruebas/);
});

test('configuración: en modo pruebas exige el calendario de pruebas', () => {
  const env = envBase();
  delete env.ESPACIAV2_GOOGLE_CALENDARIO_PRUEBAS_ID;
  assert.throws(() => c.cargarConfiguracion(env), /falta ESPACIAV2_GOOGLE_CALENDARIO_PRUEBAS_ID/);
});

test('configuración: el secreto de sesión no tiene valor por defecto y exige largo mínimo', () => {
  assert.throws(() => c.cargarConfiguracion(envBase({ ESPACIAV2_SESION_SECRETO: 'corto' })), /al menos 32 caracteres/);
});

test('configuración: el mensaje de error nunca incluye los valores', () => {
  try {
    c.cargarConfiguracion(envBase({ ESPACIAV2_SESION_SECRETO: 'corto', ESPACIAV2_GITHUB_TOKEN: '' }));
    assert.fail('debía lanzar');
  } catch (e) {
    assert.ok(!e.message.includes('token-de-ejemplo'));
    assert.ok(!e.message.includes('corto'));
  }
});

test('respuesta HTTP de configuración incompleta es 500 con el detalle por nombre', () => {
  const err = new c.ConfiguracionIncompleta(['falta ESPACIAV2_GITHUB_TOKEN']);
  const r = c.respuestaDeConfiguracionIncompleta(err);
  assert.equal(r.statusCode, 500);
  assert.deepEqual(JSON.parse(r.body).detalle, ['falta ESPACIAV2_GITHUB_TOKEN']);
});
