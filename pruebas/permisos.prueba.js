'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../netlify/functions/nucleo/permisos');

test('roles: solo usuario, gestor y admin son válidos', () => {
  assert.equal(p.esRolValido('usuario'), true);
  assert.equal(p.esRolValido('gestor'), true);
  assert.equal(p.esRolValido('admin'), true);
  assert.equal(p.esRolValido('visitante'), false);
  assert.equal(p.esRolValido(undefined), false);
});

test('administrativo: admin y gestor sí, usuario no', () => {
  assert.equal(p.esAdministrativo('admin'), true);
  assert.equal(p.esAdministrativo('gestor'), true);
  assert.equal(p.esAdministrativo('usuario'), false);
});

test('mismoUsuario: ignora mayúsculas y espacios en los bordes', () => {
  assert.equal(p.mismoUsuario('AdrianaPR', ' adrianapr '), true);
  assert.equal(p.mismoUsuario('AdrianaPR', 'OtraPersona'), false);
  assert.equal(p.mismoUsuario('AdrianaPR', undefined), false);
});

test('reservar para otro: solo admin y gestor', () => {
  assert.equal(p.puedeReservarPara('usuario', 'Ana', 'Ana'), true);
  assert.equal(p.puedeReservarPara('usuario', 'Ana', undefined), true);
  assert.equal(p.puedeReservarPara('usuario', 'Ana', 'Luis'), false);
  assert.equal(p.puedeReservarPara('gestor', 'Ana', 'Luis'), true);
  assert.equal(p.puedeReservarPara('admin', 'Ana', 'Luis'), true);
});

test('ver reservas: propias para todos, ajenas solo admin y gestor', () => {
  assert.equal(p.puedeVerTodasLasReservas('usuario'), false);
  assert.equal(p.puedeVerTodasLasReservas('gestor'), true);
  assert.equal(p.puedeVerReservasDe('usuario', 'Ana', 'ana'), true);
  assert.equal(p.puedeVerReservasDe('usuario', 'Ana', 'Luis'), false);
  assert.equal(p.puedeVerReservasDe('admin', 'Ana', 'Luis'), true);
});

test('bloquear y gestionar usuarios: solo admin y gestor', () => {
  assert.equal(p.puedeBloquear('usuario'), false);
  assert.equal(p.puedeBloquear('gestor'), true);
  assert.equal(p.puedeGestionarUsuarios('usuario'), false);
  assert.equal(p.puedeGestionarUsuarios('admin'), true);
});

test('asignar roles: el admin puede todo; el gestor solo trabaja con usuarios comunes', () => {
  assert.equal(p.puedeAsignarRol('admin', null, 'admin'), true);
  assert.equal(p.puedeAsignarRol('admin', 'usuario', 'gestor'), true);
  assert.equal(p.puedeAsignarRol('gestor', null, 'usuario'), true);
  assert.equal(p.puedeAsignarRol('gestor', 'usuario', 'usuario'), true);
  assert.equal(p.puedeAsignarRol('gestor', null, 'admin'), false);
  assert.equal(p.puedeAsignarRol('gestor', 'usuario', 'admin'), false);
  assert.equal(p.puedeAsignarRol('gestor', 'admin', 'usuario'), false);
  assert.equal(p.puedeAsignarRol('gestor', 'gestor', 'usuario'), false);
  assert.equal(p.puedeAsignarRol('usuario', null, 'usuario'), false);
  assert.equal(p.puedeAsignarRol('admin', null, 'superadmin'), false);
});
