'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const gh = require('../netlify/functions/nucleo/github_usuarios');
const { crearGitHubSimulado } = require('./ayudas/github_simulado');

const CFG = { token: 'TOKEN-SECRETO-123', repo: 'FABIOR1981/bd', rama: 'main', rutaUsuarios: 'espaciaV2/usuarios.json' };
const ana = { id: 'Ana', nombre: 'Ana', rol: 'usuario', activo: true };
const luis = { id: 'Luis', nombre: 'Luis', rol: 'usuario', activo: true };

test('leer: decodifica el archivo y devuelve el sha', async () => {
  const { fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  const r = await gh.leerUsuarios(CFG, { fetchFn: fetchSimulado });
  assert.deepEqual(r.usuarios, [ana]);
  assert.equal(r.sha, 'sha-1');
});

test('leer: la petición lleva el token, la rama y la ruta correctas', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  await gh.leerUsuarios(CFG, { fetchFn: fetchSimulado });
  const p = estado.peticiones[0];
  assert.match(p.url, /repos\/FABIOR1981\/bd\/contents\/espaciaV2\/usuarios\.json\?ref=main$/);
  assert.equal(p.opciones.headers.Authorization, 'Bearer TOKEN-SECRETO-123');
});

test('leer: si el archivo no existe todavía, devuelve una lista vacía y sha nulo', async () => {
  const { fetchSimulado } = crearGitHubSimulado({ existe: false });
  assert.deepEqual(await gh.leerUsuarios(CFG, { fetchFn: fetchSimulado }), { usuarios: [], sha: null });
});

test('leer: un error de GitHub no revela el token', async () => {
  const fallo = async () => ({ status: 401, ok: false, json: async () => ({}) });
  await assert.rejects(
    () => gh.leerUsuarios(CFG, { fetchFn: fallo }),
    (e) => e instanceof gh.ErrorGitHub && e.estado === 401 && !e.message.includes('TOKEN-SECRETO-123')
  );
});

test('leer: un archivo con formato inesperado se rechaza', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado();
  estado.contenido = { cualquier: 'cosa' };
  await assert.rejects(() => gh.leerUsuarios(CFG, { fetchFn: fetchSimulado }), /formato esperado/);
});

test('guardar: envía mensaje, rama, sha y contenido en base64', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  await gh.guardarUsuarios(CFG, [ana, luis], 'sha-1', 'Alta de Luis', { fetchFn: fetchSimulado });
  const put = estado.peticiones.find((p) => p.metodo === 'PUT');
  const cuerpo = JSON.parse(put.opciones.body);
  assert.equal(cuerpo.message, 'Alta de Luis');
  assert.equal(cuerpo.branch, 'main');
  assert.equal(cuerpo.sha, 'sha-1');
  assert.deepEqual(estado.contenido, { version: 1, usuarios: [ana, luis] });
});

test('guardar: con un sha viejo GitHub rechaza y se informa como conflicto', async () => {
  const { fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  await assert.rejects(
    () => gh.guardarUsuarios(CFG, [ana, luis], 'sha-viejo', 'x', { fetchFn: fetchSimulado }),
    (e) => e instanceof gh.ConflictoDeEscritura
  );
});

test('actualizarUsuarios: aplica el cambio y guarda', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  await gh.actualizarUsuarios(CFG, (lista) => [...lista, luis], 'Alta de Luis', { fetchFn: fetchSimulado });
  assert.deepEqual(estado.contenido.usuarios, [ana, luis]);
});

test('actualizarUsuarios: si otra persona guardó en el medio, reintenta sin perder su cambio', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  const otra = { id: 'Otra', nombre: 'Otra', rol: 'usuario', activo: true };
  estado.antesDelPut = (e) => {
    e.contenido = { version: 1, usuarios: [ana, otra] }; // alguien más guardó primero
    e.version += 1;
  };
  await gh.actualizarUsuarios(CFG, (lista) => [...lista, luis], 'Alta de Luis', { fetchFn: fetchSimulado });
  assert.deepEqual(estado.contenido.usuarios.map((u) => u.id), ['Ana', 'Otra', 'Luis']);
});

test('actualizarUsuarios: si el cambio lanza un error, no se guarda nada', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  await assert.rejects(
    () => gh.actualizarUsuarios(CFG, () => { throw new Error('Usuario repetido'); }, 'x', { fetchFn: fetchSimulado }),
    /Usuario repetido/
  );
  assert.equal(estado.peticiones.filter((p) => p.metodo === 'PUT').length, 0);
});

test('actualizarUsuarios: se rinde tras varios conflictos seguidos', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  const original = fetchSimulado;
  const siempreConflicto = async (url, op = {}) => {
    if (op.method === 'PUT') { estado.version += 1; } // el archivo cambia antes de cada escritura
    return original(url, op);
  };
  await assert.rejects(
    () => gh.actualizarUsuarios(CFG, (l) => l, 'x', { fetchFn: siempreConflicto, intentos: 3 }),
    (e) => e instanceof gh.ConflictoDeEscritura
  );
});

test('almacén sobre GitHub: leer y actualizar con la forma que usa el servicio de usuarios', async () => {
  const { estado, fetchSimulado } = crearGitHubSimulado({ usuarios: [ana] });
  const almacen = gh.crearAlmacenDeUsuarios(CFG, { fetchFn: fetchSimulado });
  assert.deepEqual(await almacen.leer(), [ana]);
  await almacen.actualizar((lista) => [...lista, luis], 'Alta de Luis');
  assert.deepEqual(estado.contenido.usuarios, [ana, luis]);
});
