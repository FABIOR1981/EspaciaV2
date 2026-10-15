'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../compartido/reglas.json');
const c = require('../netlify/functions/nucleo/contrasenas');
const u = require('../netlify/functions/nucleo/usuarios_servicio');
const { crearAlmacenEnMemoria } = require('./ayudas/almacen_en_memoria');

const ADMIN = { id: 'Admin', nombre: 'Administración', rol: 'admin' };
const GESTOR = { id: 'Gestora', nombre: 'Gestora G', rol: 'gestor' };
const ANA_SESION = { id: 'AdrianaPR', nombre: 'Adriana Perla R', rol: 'usuario' };

async function datos() {
  const base = (id, nombre, rol, clave, extra = {}) => ({ id, nombre, rol, consPref: [1, 2, 3, 4, 5], activo: true, requiereCambioPass: false, ...extra, _clave: clave });
  const crudos = [
    base('Admin', 'Administración', 'admin', 'ClaveAdmin1'),
    base('OtroAdmin', 'Otro Admin', 'admin', 'ClaveOtro1'),
    base('Gestora', 'Gestora G', 'gestor', 'ClaveGestora1'),
    base('AdrianaPR', 'Adriana Perla R', 'usuario', 'ClaveAdriana1'),
    base('Luis', 'Luis Pérez', 'usuario', 'ClaveLuis1'),
    base('Baja', 'Usuario de Baja', 'usuario', 'ClaveBaja1', { activo: false }),
  ];
  const usuarios = [];
  for (const { _clave, ...resto } of crudos) usuarios.push({ ...resto, contrasena: await c.generarHash(_clave) });
  return usuarios;
}
const nuevoAlmacen = async () => crearAlmacenEnMemoria(await datos());
const porId = (almacen, id) => almacen.estado().find((x) => x.id === id);

// ---------- Ingreso ----------

test('ingresa con la clave correcta y devuelve la sesión sin el hash', async () => {
  const almacen = await nuevoAlmacen();
  const r = await u.autenticar({ almacen, id: 'AdrianaPR', clave: 'ClaveAdriana1' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sesion, ANA_SESION);
  assert.equal(r.requiereCambioPass, false);
  assert.ok(!JSON.stringify(r).includes('scrypt'));
});

test('el identificador no distingue mayúsculas', async () => {
  const almacen = await nuevoAlmacen();
  assert.equal((await u.autenticar({ almacen, id: 'adrianapr', clave: 'ClaveAdriana1' })).ok, true);
});

test('clave incorrecta, usuario inexistente y usuario inactivo dan exactamente la misma respuesta', async () => {
  const almacen = await nuevoAlmacen();
  const malaClave = await u.autenticar({ almacen, id: 'AdrianaPR', clave: 'incorrecta' });
  const noExiste = await u.autenticar({ almacen, id: 'Fantasma', clave: 'ClaveAdriana1' });
  const inactivo = await u.autenticar({ almacen, id: 'Baja', clave: 'ClaveBaja1' });
  assert.deepEqual(noExiste, malaClave);
  assert.deepEqual(inactivo, malaClave);
  assert.equal(malaClave.estado, 401);
  assert.equal(malaClave.codigo, 'CREDENCIALES_INVALIDAS');
});

test('entradas vacías o de tipo incorrecto no lanzan errores', async () => {
  const almacen = await nuevoAlmacen();
  for (const entrada of [{}, { id: 'Luis' }, { id: 5, clave: 'x' }, { id: ' ', clave: 'x' }]) {
    assert.equal((await u.autenticar({ almacen, ...entrada })).codigo, 'CREDENCIALES_INVALIDAS');
  }
});

test('con el hash antiguo de Espacia ingresa y se reemplaza por uno con sal', async () => {
  const almacen = crearAlmacenEnMemoria([
    { id: 'Vieja', nombre: 'Clave Vieja', rol: 'usuario', consPref: [1], activo: true, requiereCambioPass: true, contrasena: c.sha256Hex('Vieja1234567') },
  ]);
  const r = await u.autenticar({ almacen, id: 'Vieja', clave: 'Vieja1234567' });
  assert.equal(r.ok, true);
  assert.equal(r.requiereCambioPass, true);
  assert.match(porId(almacen, 'Vieja').contrasena, /^scrypt\$/);
  assert.equal((await u.autenticar({ almacen, id: 'Vieja', clave: 'Vieja1234567' })).ok, true); // sigue funcionando
});

test('si falla el reemplazo del hash antiguo, igual se permite el ingreso', async () => {
  const almacen = crearAlmacenEnMemoria([
    { id: 'Vieja', nombre: 'Clave Vieja', rol: 'usuario', consPref: [1], activo: true, requiereCambioPass: false, contrasena: c.sha256Hex('ClaveVieja9') },
  ]);
  almacen.actualizar = async () => { throw new Error('GitHub caído'); };
  assert.equal((await u.autenticar({ almacen, id: 'Vieja', clave: 'ClaveVieja9' })).ok, true);
});

test('validar sesión: toma el rol actual del archivo y rechaza usuarios dados de baja', async () => {
  const almacen = await nuevoAlmacen();
  const rolViejoEnToken = { id: 'Luis', nombre: 'Luis Pérez', rol: 'admin' }; // el token decía admin, pero es usuario
  const r = await u.validarSesionContraUsuarios({ almacen, sesion: rolViejoEnToken });
  assert.equal(r.sesion.rol, 'usuario');
  const baja = await u.validarSesionContraUsuarios({ almacen, sesion: { id: 'Baja', nombre: 'x', rol: 'usuario' } });
  assert.equal(baja.codigo, 'SESION_INVALIDA');
  assert.equal((await u.validarSesionContraUsuarios({ almacen, sesion: { id: 'Nadie', nombre: 'x', rol: 'admin' } })).estado, 401);
});

// ---------- Listar ----------

test('listar: admin y gestor ven la lista sin hashes; un usuario no', async () => {
  const almacen = await nuevoAlmacen();
  const r = await u.listarUsuarios({ almacen, sesion: GESTOR });
  assert.equal(r.usuarios.length, 6);
  assert.ok(r.usuarios.every((x) => x.contrasena === undefined));
  assert.equal((await u.listarUsuarios({ almacen, sesion: ADMIN })).ok, true);
  assert.equal((await u.listarUsuarios({ almacen, sesion: ANA_SESION })).estado, 403);
});

// ---------- Alta ----------

test('el admin crea un usuario con clave temporal, que debe cambiar en el primer ingreso', async () => {
  const almacen = await nuevoAlmacen();
  const r = await u.crearUsuario({ reglas, almacen, sesion: ADMIN, datos: { id: 'NuevoUsu', nombre: 'Nuevo Usuario', rol: 'usuario' } });
  assert.equal(r.ok, true);
  assert.equal(r.usuario.activo, true);
  assert.equal(r.usuario.requiereCambioPass, true);
  assert.deepEqual(r.usuario.consPref, [1, 2, 3, 4, 5]);
  assert.equal(r.usuario.contrasena, undefined);
  assert.equal(r.claveTemporal.length, 12);
  const guardado = porId(almacen, 'NuevoUsu');
  assert.match(guardado.contrasena, /^scrypt\$/);
  assert.ok(!JSON.stringify(guardado).includes(r.claveTemporal));
  assert.equal((await u.autenticar({ almacen, id: 'NuevoUsu', clave: r.claveTemporal })).requiereCambioPass, true);
});

test('alta: valida identificador, nombre, rol y preferencias', async () => {
  const almacen = await nuevoAlmacen();
  const alta = (datos) => u.crearUsuario({ reglas, almacen, sesion: ADMIN, datos });
  assert.equal((await alta({ id: 'ab', nombre: 'X', rol: 'usuario' })).codigo, 'ID_INVALIDO');
  assert.equal((await alta({ id: 'con espacio', nombre: 'X', rol: 'usuario' })).codigo, 'ID_INVALIDO');
  assert.equal((await alta({ id: 'Valido1', nombre: '  ', rol: 'usuario' })).codigo, 'NOMBRE_INVALIDO');
  assert.equal((await alta({ id: 'Valido1', nombre: 'X', rol: 'visitante' })).codigo, 'ROL_INVALIDO');
  assert.equal((await alta({ id: 'Valido1', nombre: 'X', rol: 'usuario', consPref: [9] })).codigo, 'PREFERENCIAS_INVALIDAS');
  assert.equal(almacen.estado().length, 6);
});

test('alta: no se puede repetir un identificador (sin distinguir mayúsculas)', async () => {
  const almacen = await nuevoAlmacen();
  const r = await u.crearUsuario({ reglas, almacen, sesion: ADMIN, datos: { id: 'adrianapr', nombre: 'Otra', rol: 'usuario' } });
  assert.equal(r.codigo, 'USUARIO_REPETIDO');
  assert.equal(r.estado, 409);
});

test('alta: el usuario común no puede; el gestor solo crea usuarios comunes', async () => {
  const almacen = await nuevoAlmacen();
  const alta = (sesion, rol) => u.crearUsuario({ reglas, almacen, sesion, datos: { id: `Nuevo${rol}`, nombre: 'N', rol } });
  assert.equal((await alta(ANA_SESION, 'usuario')).estado, 403);
  assert.equal((await alta(GESTOR, 'usuario')).ok, true);
  assert.equal((await alta(GESTOR, 'gestor')).codigo, 'NO_PUEDE_ASIGNAR_ROL');
  assert.equal((await alta(GESTOR, 'admin')).codigo, 'NO_PUEDE_ASIGNAR_ROL');
  assert.equal((await alta(ADMIN, 'admin')).ok, true);
});

// ---------- Edición ----------

test('el admin edita nombre, rol, preferencias y estado; los campos ajenos se ignoran', async () => {
  const almacen = await nuevoAlmacen();
  const hashAntes = porId(almacen, 'Luis').contrasena;
  const r = await u.editarUsuario({
    reglas, almacen, sesion: ADMIN, id: 'Luis',
    cambios: { nombre: 'Luis P.', rol: 'gestor', consPref: [3, 1], activo: false, contrasena: 'hackeada', requiereCambioPass: true },
  });
  assert.equal(r.ok, true);
  const guardado = porId(almacen, 'Luis');
  assert.deepEqual({ n: guardado.nombre, r: guardado.rol, c: guardado.consPref, a: guardado.activo }, { n: 'Luis P.', r: 'gestor', c: [1, 3], a: false });
  assert.equal(guardado.contrasena, hashAntes);
  assert.equal(guardado.requiereCambioPass, false);
});

test('el gestor edita usuarios comunes pero no sube roles ni toca gestores o administradores', async () => {
  const almacen = await nuevoAlmacen();
  const edita = (id, cambios) => u.editarUsuario({ reglas, almacen, sesion: GESTOR, id, cambios });
  assert.equal((await edita('Luis', { nombre: 'Luis Nuevo' })).ok, true);
  assert.equal((await edita('Luis', { rol: 'admin' })).codigo, 'NO_PUEDE_ASIGNAR_ROL');
  assert.equal((await edita('Admin', { nombre: 'Hackeado' })).codigo, 'NO_PUEDE_ASIGNAR_ROL');
  assert.equal((await edita('Gestora', { activo: false })).codigo, 'NO_PUEDE_ASIGNAR_ROL');
  assert.equal(porId(almacen, 'Admin').nombre, 'Administración');
});

test('nadie puede desactivarse ni cambiarse el rol a sí mismo', async () => {
  const almacen = await nuevoAlmacen();
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'Admin', cambios: { activo: false } })).codigo, 'NO_PUEDE_MODIFICARSE_A_SI_MISMO');
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'admin', cambios: { rol: 'usuario' } })).codigo, 'NO_PUEDE_MODIFICARSE_A_SI_MISMO');
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'Admin', cambios: { nombre: 'Admin Nuevo' } })).ok, true);
});

test('editar: usuario inexistente, usuario común y datos inválidos', async () => {
  const almacen = await nuevoAlmacen();
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'Nadie', cambios: { nombre: 'X' } })).estado, 404);
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ANA_SESION, id: 'Luis', cambios: { nombre: 'X' } })).estado, 403);
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'Luis', cambios: { rol: 'jefe' } })).codigo, 'ROL_INVALIDO');
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'Luis', cambios: { activo: 'si' } })).codigo, 'ACTIVO_INVALIDO');
  assert.equal((await u.editarUsuario({ reglas, almacen, sesion: ADMIN, id: 'Luis', cambios: { consPref: [] } })).codigo, 'PREFERENCIAS_INVALIDAS');
});

// ---------- Reiniciar clave ----------

test('reiniciar clave: genera una temporal, obliga a cambiarla y la anterior deja de servir', async () => {
  const almacen = await nuevoAlmacen();
  const r = await u.reiniciarClave({ almacen, sesion: GESTOR, id: 'Luis' });
  assert.equal(r.ok, true);
  assert.equal(porId(almacen, 'Luis').requiereCambioPass, true);
  assert.equal((await u.autenticar({ almacen, id: 'Luis', clave: 'ClaveLuis1' })).ok, false);
  assert.equal((await u.autenticar({ almacen, id: 'Luis', clave: r.claveTemporal })).ok, true);
});

test('reiniciar clave: el gestor no puede con administradores; el usuario común no puede con nadie', async () => {
  const almacen = await nuevoAlmacen();
  assert.equal((await u.reiniciarClave({ almacen, sesion: GESTOR, id: 'Admin' })).codigo, 'NO_PUEDE_ASIGNAR_ROL');
  assert.equal((await u.reiniciarClave({ almacen, sesion: ANA_SESION, id: 'Luis' })).estado, 403);
  assert.equal((await u.reiniciarClave({ almacen, sesion: ADMIN, id: 'Nadie' })).estado, 404);
  assert.equal((await u.reiniciarClave({ almacen, sesion: ADMIN, id: 'OtroAdmin' })).ok, true);
});

// ---------- Cambiar mi clave ----------

test('cambiar mi clave: con la actual correcta se guarda la nueva y se quita la obligación de cambiarla', async () => {
  const almacen = await nuevoAlmacen();
  const { claveTemporal } = await u.reiniciarClave({ almacen, sesion: ADMIN, id: 'Luis' });
  const r = await u.cambiarMiClave({ almacen, sesion: { id: 'Luis', nombre: 'Luis Pérez', rol: 'usuario' }, claveActual: claveTemporal, claveNueva: 'MiNuevaClave9' });
  assert.equal(r.ok, true);
  assert.equal(porId(almacen, 'Luis').requiereCambioPass, false);
  assert.equal((await u.autenticar({ almacen, id: 'Luis', clave: 'MiNuevaClave9' })).ok, true);
  assert.equal((await u.autenticar({ almacen, id: 'Luis', clave: claveTemporal })).ok, false);
});

test('cambiar mi clave: rechaza clave actual incorrecta, clave corta y clave repetida', async () => {
  const almacen = await nuevoAlmacen();
  const cambia = (claveActual, claveNueva) => u.cambiarMiClave({ almacen, sesion: ANA_SESION, claveActual, claveNueva });
  const incorrecta = await cambia('no-es', 'NuevaClave99');
  assert.equal(incorrecta.codigo, 'CLAVE_ACTUAL_INCORRECTA');
  assert.equal(incorrecta.estado, 401);
  assert.equal((await cambia('ClaveAdriana1', 'corta')).codigo, 'CLAVE_MUY_CORTA');
  assert.equal((await cambia('ClaveAdriana1', 'ClaveAdriana1')).codigo, 'CLAVE_IGUAL_A_LA_ACTUAL');
});

test('cambiar mi clave: un usuario dado de baja no puede', async () => {
  const almacen = await nuevoAlmacen();
  const r = await u.cambiarMiClave({ almacen, sesion: { id: 'Baja', nombre: 'x', rol: 'usuario' }, claveActual: 'ClaveBaja1', claveNueva: 'NuevaClave99' });
  assert.equal(r.codigo, 'SESION_INVALIDA');
});

test('cambiar mi clave: si la clave cambió mientras tanto, no se pisa', async () => {
  const almacen = await nuevoAlmacen();
  const original = almacen.actualizar;
  almacen.actualizar = async (cambiar, mensaje) => {
    // Alguien reinicia la clave justo antes de que se guarde el cambio.
    await u.reiniciarClave({ almacen: { leer: almacen.leer, actualizar: original }, sesion: ADMIN, id: 'AdrianaPR' });
    return original(cambiar, mensaje);
  };
  const r = await u.cambiarMiClave({ almacen, sesion: ANA_SESION, claveActual: 'ClaveAdriana1', claveNueva: 'NuevaClave99' });
  assert.equal(r.codigo, 'CAMBIO_CONCURRENTE');
  assert.equal(r.estado, 409);
});
