'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../netlify/functions/nucleo/contrasenas');
const m = require('../netlify/functions/nucleo/migracion_usuarios');

const antiguo = (nomUsu, extra = {}) => ({
  nombre: `Nombre ${nomUsu}`,
  nomUsu,
  email: `${nomUsu.toLowerCase()}@espacia.com.uy`,
  tipdocu: 'PROF',
  documento: '38',
  rol: 'usuario',
  consPref: [2, 3],
  activo: true,
  requiereCambioPass: false,
  contrasena: c.sha256Hex(`${nomUsu}ClavePropia9`),
  ...extra,
});

const OPC = { cantidadConsultorios: 5 };

test('convierte el formato de Espacia: id = nomUsu y descarta email, tipdocu y documento', () => {
  const { contenido } = m.migrarUsuarios({ 'PROF-38': antiguo('AdrianaPR') }, OPC);
  assert.equal(contenido.version, 1);
  assert.deepEqual(contenido.usuarios[0], {
    id: 'AdrianaPR',
    nombre: 'Nombre AdrianaPR',
    rol: 'usuario',
    espHabil: [2, 3],
    activo: true,
    requiereCambioPass: false,
    contrasena: c.sha256Hex('AdrianaPRClavePropia9'),
  });
  for (const campo of ['email', 'tipdocu', 'documento', 'nomUsu']) assert.equal(campo in contenido.usuarios[0], false);
});

test('conserva el hash antiguo para que el login lo reemplace al primer ingreso', async () => {
  const { contenido } = m.migrarUsuarios({ a: antiguo('Luis') }, OPC);
  assert.equal((await c.verificarClave('LuisClavePropia9', contenido.usuarios[0].contrasena)).necesitaActualizar, true);
});

test('quien sigue con la clave inicial (nomUsu + 1234567) queda obligado a cambiarla', () => {
  const { contenido, resumen } = m.migrarUsuarios(
    {
      a: antiguo('Inicial', { contrasena: c.sha256Hex('Inicial1234567') }),
      b: antiguo('Propia'),
      c: antiguo('Marcada', { requiereCambioPass: true }),
      d: antiguo('BajaInicial', { activo: false, contrasena: c.sha256Hex('BajaInicial1234567') }),
    },
    OPC
  );
  const por = Object.fromEntries(contenido.usuarios.map((x) => [x.id, x.requiereCambioPass]));
  assert.deepEqual(por, { BajaInicial: true, Inicial: true, Marcada: true, Propia: false });
  assert.equal(resumen.activosConClaveInicial, 1); // la cuenta inactiva no cuenta
});

test('filtra espacios fuera de rango, ordena por id y arma el resumen', () => {
  const { contenido, resumen } = m.migrarUsuarios(
    { a: antiguo('Zeta', { consPref: [1, 9, 2] }), b: antiguo('Alfa', { rol: 'admin' }), c: antiguo('Beta', { activo: false }) },
    OPC
  );
  assert.deepEqual(contenido.usuarios.map((x) => x.id), ['Alfa', 'Beta', 'Zeta']);
  assert.deepEqual(contenido.usuarios.find((x) => x.id === 'Zeta').espHabil, [1, 2]);
  assert.deepEqual(resumen, { total: 3, activos: 2, porRol: { usuario: 2, gestor: 0, admin: 1 }, activosConClaveInicial: 0 });
});

test('se niega a migrar datos dudosos: repetidos, roles desconocidos o sin contraseña', () => {
  assert.throws(() => m.migrarUsuarios({ a: antiguo('Luis'), b: antiguo('luis') }, OPC), /repetido/);
  assert.throws(() => m.migrarUsuarios({ a: antiguo('Luis', { rol: 'jefe' }) }, OPC), /rol desconocido/);
  assert.throws(() => m.migrarUsuarios({ a: antiguo('Luis', { contrasena: '' }) }, OPC), /no tiene contraseña/);
  assert.throws(() => m.migrarUsuarios({ a: antiguo('') }, OPC), /sin nomUsu/);
});

test('acepta también una lista en lugar de un objeto', () => {
  assert.equal(m.migrarUsuarios([antiguo('Luis')], OPC).resumen.total, 1);
});
