'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../netlify/functions/nucleo/google_calendario');
const v = require('../netlify/functions/nucleo/vistas_reservas');
const { crearCalendarioSimulado } = require('./ayudas/calendario_simulado');

const ANA = { id: 'AdrianaPR', nombre: 'Adriana Perla R', rol: 'usuario' };
const LUIS = { id: 'Luis', nombre: 'Luis Pérez', rol: 'usuario' };
const GESTOR = { id: 'Gestora', nombre: 'Gestora G', rol: 'gestor' };
const ADMIN = { id: 'Admin', nombre: 'Administración', rol: 'admin' };

const reserva = (cambios = {}) => ({
  consultorio: 2, fecha: '2026-10-19', inicioMin: 600, finMin: 660,
  titularId: 'Luis', titularNombre: 'Luis Pérez', creadaPor: 'Luis Pérez',
  tipo: 'reserva', observacion: '', ...cambios,
});

async function repoConDatos() {
  const cal = crearCalendarioSimulado();
  const repo = g.crearRepositorioDeReservas(cal, { calendarioId: 'c' }, { zonaHoraria: 'America/Montevideo', notificarInvitados: false });
  await repo.crear(reserva({ titularId: 'AdrianaPR', titularNombre: 'Adriana Perla R', creadaPor: 'Gestora G', consultorio: 1 })); // de Ana, creada por la gestora
  await repo.crear(reserva({ consultorio: 2 })); // de Luis
  await repo.crear(reserva({ consultorio: 3, tipo: 'bloqueo', titularId: 'Gestora', titularNombre: 'Bloqueada', creadaPor: 'Gestora G', observacion: 'Mantenimiento' }));
  const cancelada = await repo.crear(reserva({ consultorio: 4, inicioMin: 720, finMin: 780 }));
  await repo.cancelar(cancelada.id, 'Luis Pérez');
  return repo;
}

const texto = (x) => JSON.stringify(x);

test('un usuario ve su propia reserva completa y las ajenas solo como "Ocupado"', async () => {
  const repo = await repoConDatos();
  const r = await v.listarDiaParaSesion({ repo, sesion: ANA, fecha: '2026-10-19' });
  assert.equal(r.ok, true);
  const propia = r.reservas.find((x) => x.consultorio === 1);
  assert.equal(propia.propia, true);
  assert.equal(propia.titularNombre, 'Adriana Perla R');
  assert.ok(propia.id);
  const ajena = r.reservas.find((x) => x.consultorio === 2);
  assert.deepEqual(Object.keys(ajena).sort(), ['consultorio', 'fecha', 'finMin', 'inicioMin', 'ocupado']);
  assert.equal(ajena.ocupado, true);
});

test('un usuario no recibe nombres, ids ni observaciones de otras personas ni de bloqueos', async () => {
  const repo = await repoConDatos();
  const r = await v.listarDiaParaSesion({ repo, sesion: LUIS, fecha: '2026-10-19' });
  const delOtro = r.reservas.filter((x) => x.consultorio === 1 || x.consultorio === 3);
  assert.equal(delOtro.length, 2);
  const crudo = texto(delOtro);
  for (const secreto of ['Adriana', 'AdrianaPR', 'Mantenimiento', 'Gestora', 'Bloqueada']) {
    assert.ok(!crudo.includes(secreto), `se filtró "${secreto}"`);
  }
  assert.ok(delOtro.every((x) => x.id === undefined && x.ocupado === true));
});

test('la persona que hizo una reserva a nombre de otro, si es usuario común, no ve datos ajenos', async () => {
  const repo = await repoConDatos();
  // La reserva de Ana fue creada por la gestora; Ana no ve "creadaPor".
  const r = await v.listarDiaParaSesion({ repo, sesion: ANA, fecha: '2026-10-19' });
  const propia = r.reservas.find((x) => x.consultorio === 1);
  assert.equal(propia.creadaPor, undefined);
});

test('gestor y admin ven el detalle completo, incluidos bloqueos y observaciones', async () => {
  const repo = await repoConDatos();
  for (const sesion of [GESTOR, ADMIN]) {
    const r = await v.listarDiaParaSesion({ repo, sesion, fecha: '2026-10-19' });
    const bloqueo = r.reservas.find((x) => x.consultorio === 3);
    assert.equal(bloqueo.tipo, 'bloqueo');
    assert.equal(bloqueo.observacion, 'Mantenimiento');
    assert.equal(r.reservas.find((x) => x.consultorio === 2).titularNombre, 'Luis Pérez');
  }
});

test('las canceladas no aparecen en la grilla; solo admin y gestor pueden pedirlas', async () => {
  const repo = await repoConDatos();
  const normal = await v.listarDiaParaSesion({ repo, sesion: ADMIN, fecha: '2026-10-19' });
  assert.equal(normal.reservas.length, 3);
  const conCanceladas = await v.listarDiaParaSesion({ repo, sesion: ADMIN, fecha: '2026-10-19', incluirCanceladas: true });
  assert.equal(conCanceladas.reservas.length, 4);
  const usuarioIntenta = await v.listarDiaParaSesion({ repo, sesion: LUIS, fecha: '2026-10-19', incluirCanceladas: true });
  assert.equal(usuarioIntenta.reservas.length, 3);
  assert.ok(usuarioIntenta.reservas.every((x) => !x.cancelada));
});

test('fecha o rol inválidos se rechazan', async () => {
  const repo = await repoConDatos();
  assert.equal((await v.listarDiaParaSesion({ repo, sesion: ANA, fecha: 'ayer' })).codigo, 'FECHA_INVALIDA');
  assert.equal((await v.listarDiaParaSesion({ repo, sesion: { ...ANA, rol: 'visitante' }, fecha: '2026-10-19' })).estado, 403);
});

// ---------- Mis reservas ----------

test('"mis reservas" devuelve solo las propias y activas', async () => {
  const repo = await repoConDatos();
  const r = await v.listarReservasDe({ repo, sesion: LUIS, desde: '2026-10-15', hasta: '2026-10-31' });
  assert.equal(r.ok, true);
  assert.equal(r.reservas.length, 1); // la de C4 está cancelada y el bloqueo no es suyo
  assert.equal(r.reservas[0].consultorio, 2);
});

test('un usuario no puede pedir las reservas de otra persona; admin y gestor sí', async () => {
  const repo = await repoConDatos();
  const pide = { repo, usuarioId: 'AdrianaPR', desde: '2026-10-15', hasta: '2026-10-31' };
  const negado = await v.listarReservasDe({ ...pide, sesion: LUIS });
  assert.equal(negado.codigo, 'NO_PUEDE_VER_RESERVAS_AJENAS');
  assert.equal(negado.estado, 403);
  const permitido = await v.listarReservasDe({ ...pide, sesion: GESTOR });
  assert.equal(permitido.reservas.length, 1);
  assert.equal(permitido.reservas[0].titularId, 'AdrianaPR');
});

test('"mis reservas": valida el rango de fechas', async () => {
  const repo = await repoConDatos();
  const base = { repo, sesion: ANA };
  assert.equal((await v.listarReservasDe({ ...base, desde: '2026-10-31', hasta: '2026-10-15' })).codigo, 'RANGO_INVALIDO');
  assert.equal((await v.listarReservasDe({ ...base, desde: '2026-01-01', hasta: '2027-12-31' })).codigo, 'RANGO_DEMASIADO_GRANDE');
  assert.equal((await v.listarReservasDe({ ...base, desde: 'x', hasta: '2026-10-31' })).codigo, 'FECHA_INVALIDA');
});

// ---------- Bloqueos vigentes ----------

test('listar bloqueos: admin y gestor ven los vigentes con su motivo; las reservas y los bloqueos cancelados no aparecen', async () => {
  const repo = await repoConDatos();
  const r = await v.listarBloqueos({ repo, sesion: GESTOR, desde: '2026-10-15', hasta: '2026-10-31' });
  assert.equal(r.ok, true);
  assert.equal(r.reservas.length, 1);
  assert.equal(r.reservas[0].observacion, 'Mantenimiento');
  assert.equal(r.reservas[0].tipo, 'bloqueo');
  const cancelado = await repo.crear(reserva({ consultorio: 5, tipo: 'bloqueo', titularId: 'Gestora', titularNombre: 'Bloqueada', creadaPor: 'Gestora G', observacion: 'Viejo' }));
  await repo.cancelar(cancelado.id, 'Gestora G');
  assert.equal((await v.listarBloqueos({ repo, sesion: ADMIN, desde: '2026-10-15', hasta: '2026-10-31' })).reservas.length, 1);
});

test('listar bloqueos: un usuario común no puede, y se validan las fechas', async () => {
  const repo = await repoConDatos();
  const negado = await v.listarBloqueos({ repo, sesion: LUIS, desde: '2026-10-15', hasta: '2026-10-31' });
  assert.equal(negado.codigo, 'NO_PUEDE_BLOQUEAR');
  assert.equal(negado.estado, 403);
  assert.equal((await v.listarBloqueos({ repo, sesion: ADMIN, desde: 'x', hasta: '2026-10-31' })).codigo, 'FECHA_INVALIDA');
  assert.equal((await v.listarBloqueos({ repo, sesion: ADMIN, desde: '2026-10-31', hasta: '2026-10-15' })).codigo, 'RANGO_INVALIDO');
  assert.equal((await v.listarBloqueos({ repo, sesion: ADMIN, desde: '2026-01-01', hasta: '2027-12-31' })).codigo, 'RANGO_DEMASIADO_GRANDE');
});
