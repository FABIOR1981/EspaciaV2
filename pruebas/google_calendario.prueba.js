'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../netlify/functions/nucleo/google_calendario');
const { crearCalendarioSimulado } = require('./ayudas/calendario_simulado');

const ZONA = 'America/Montevideo';
const CFG = { calendarioId: 'cal-pruebas' };

const nuevoRepo = (notificarInvitados = false) => {
  const cal = crearCalendarioSimulado();
  return { cal, repo: g.crearRepositorioDeReservas(cal, CFG, { zonaHoraria: ZONA, notificarInvitados }) };
};

const reservaBase = (cambios = {}) => ({
  consultorio: 2,
  fecha: '2026-10-16',
  inicioMin: 600,
  finMin: 660,
  titularId: 'AdrianaPR',
  titularNombre: 'Adriana Perla R',
  creadaPor: 'Adriana Perla R',
  tipo: 'reserva',
  observacion: '',
  ...cambios,
});

// ---------- Traducción de eventos ----------

test('lee un evento antiguo de Espacia: el titular sale del email', () => {
  const r = g.eventoAReserva(
    {
      id: 'a1',
      summary: 'C2: Adriana Perla R',
      description: 'Reserva para: Adriana Perla R\nEmail: adrianapr@espacia.com.uy',
      extendedProperties: { private: { userEmail: 'AdrianaPR@espacia.com.uy' } },
      start: { dateTime: '2026-10-16T10:00:00-03:00' },
      end: { dateTime: '2026-10-16T11:30:00-03:00' },
    },
    ZONA
  );
  assert.equal(r.titularId, 'AdrianaPR');
  assert.equal(r.titularNombre, 'Adriana Perla R');
  assert.equal(r.consultorio, 2);
  assert.equal(r.fecha, '2026-10-16');
  assert.equal(r.inicioMin, 600);
  assert.equal(r.finMin, 690);
  assert.equal(r.tipo, 'reserva');
  assert.equal(r.cancelada, false);
});

test('lee el email desde la descripción si no hay propiedad privada (formato más antiguo)', () => {
  const r = g.eventoAReserva(
    {
      id: 'a2',
      summary: 'C1: Luis',
      description: 'Email: luis@espacia.com.uy',
      start: { dateTime: '2026-10-16T09:00:00-03:00' },
      end: { dateTime: '2026-10-16T10:00:00-03:00' },
    },
    ZONA
  );
  assert.equal(r.titularId, 'luis');
});

test('reconoce reservas canceladas y bloqueos del formato de Espacia', () => {
  const cancelada = g.eventoAReserva(
    { id: 'c', summary: 'Cancelada - C3: Luis', start: { dateTime: '2026-10-16T09:00:00-03:00' }, end: { dateTime: '2026-10-16T10:00:00-03:00' } },
    ZONA
  );
  assert.equal(cancelada.cancelada, true);
  assert.equal(cancelada.consultorio, 3);
  const bloqueo = g.eventoAReserva(
    { id: 'b', summary: 'C0: Bloqueada-Limpieza', start: { dateTime: '2026-10-16T09:00:00-03:00' }, end: { dateTime: '2026-10-16T10:00:00-03:00' } },
    ZONA
  );
  assert.equal(bloqueo.tipo, 'bloqueo');
  assert.equal(bloqueo.consultorio, 0);
});

test('ignora eventos que no son reservas (sin prefijo o de día completo)', () => {
  assert.equal(g.eventoAReserva({ id: 'x', summary: 'Reunión', start: { dateTime: '2026-10-16T09:00:00-03:00' }, end: { dateTime: '2026-10-16T10:00:00-03:00' } }, ZONA), null);
  assert.equal(g.eventoAReserva({ id: 'y', summary: 'C1: Feriado', start: { date: '2026-10-16' }, end: { date: '2026-10-17' } }, ZONA), null);
});

test('el día se calcula en la zona local: 23:00 de Montevideo es el día siguiente en UTC', () => {
  const r = g.eventoAReserva(
    { id: 'z', summary: 'C1: Luis', start: { dateTime: '2026-10-17T02:00:00Z' }, end: { dateTime: '2026-10-17T03:00:00Z' } },
    ZONA
  );
  assert.equal(r.fecha, '2026-10-16');
  assert.equal(r.inicioMin, 23 * 60);
});

// ---------- Repositorio ----------

test('crear y listar el día: ida y vuelta sin pérdida de datos', async () => {
  const { repo } = nuevoRepo();
  const creada = await repo.crear(reservaBase());
  assert.equal(creada.titularId, 'AdrianaPR');
  const dia = await repo.listarDia('2026-10-16');
  assert.equal(dia.length, 1);
  assert.deepEqual(
    { c: dia[0].consultorio, i: dia[0].inicioMin, f: dia[0].finMin, t: dia[0].titularNombre, p: dia[0].creadaPor },
    { c: 2, i: 600, f: 660, t: 'Adriana Perla R', p: 'Adriana Perla R' }
  );
});

test('listarDia devuelve solo los eventos del día local pedido', async () => {
  const { repo } = nuevoRepo();
  await repo.crear(reservaBase({ fecha: '2026-10-15' }));
  await repo.crear(reservaBase({ fecha: '2026-10-16' }));
  await repo.crear(reservaBase({ fecha: '2026-10-17' }));
  const dia = await repo.listarDia('2026-10-16');
  assert.equal(dia.length, 1);
  assert.equal(dia[0].fecha, '2026-10-16');
});

test('crear: no notifica a invitados salvo que esté activado', async () => {
  const sin = nuevoRepo(false);
  await sin.repo.crear(reservaBase());
  assert.equal(sin.cal.llamadas[0].sendUpdates, 'none');
  const con = nuevoRepo(true);
  await con.repo.crear(reservaBase());
  assert.equal(con.cal.llamadas[0].sendUpdates, 'all');
});

test('un bloqueo se guarda con color rojo y su observación', async () => {
  const { cal, repo } = nuevoRepo();
  const b = await repo.crear(reservaBase({ consultorio: 0, tipo: 'bloqueo', titularNombre: 'Bloqueada', observacion: 'Limpieza' }));
  const evento = [...cal.eventos.values()][0];
  assert.equal(evento.summary, 'C0: Bloqueada-Limpieza');
  assert.equal(evento.colorId, '11');
  assert.equal(b.tipo, 'bloqueo');
  assert.equal(b.observacion, 'Limpieza');
});

test('cancelar: no borra, renombra, pone color gris y registra quién canceló', async () => {
  const { cal, repo } = nuevoRepo();
  const creada = await repo.crear(reservaBase());
  const cancelada = await repo.cancelar(creada.id, 'Administración', new Date('2026-10-15T15:00:00Z'));
  assert.equal(cal.eventos.size, 1);
  assert.equal(cancelada.cancelada, true);
  assert.equal(cancelada.canceladaPor, 'Administración');
  const evento = cal.eventos.get(creada.id);
  assert.ok(evento.summary.startsWith('Cancelada - C2:'));
  assert.equal(evento.colorId, '8');
  assert.match(evento.description, /Cancelada por: Administración/);
});

test('cancelar dos veces no duplica el prefijo', async () => {
  const { cal, repo } = nuevoRepo();
  const creada = await repo.crear(reservaBase());
  await repo.cancelar(creada.id, 'Ana');
  await repo.cancelar(creada.id, 'Ana');
  assert.equal(cal.eventos.get(creada.id).summary.match(/Cancelada - /g).length, 1);
});

test('obtener: devuelve null si no existe; eliminar borra el evento', async () => {
  const { cal, repo } = nuevoRepo();
  assert.equal(await repo.obtener('no-existe'), null);
  const creada = await repo.crear(reservaBase());
  await repo.eliminar(creada.id);
  assert.equal(cal.eventos.size, 0);
});

test('listarRango: devuelve las reservas de varios días y recorre todas las páginas de Google', async () => {
  const { cal, repo } = nuevoRepo();
  await repo.crear(reservaBase({ fecha: '2026-10-16' }));
  await repo.crear(reservaBase({ fecha: '2026-10-19', consultorio: 3 }));
  await repo.crear(reservaBase({ fecha: '2026-11-30', consultorio: 4 })); // fuera del rango

  // Google entrega los resultados en dos páginas.
  const listaOriginal = cal.events.list;
  cal.events.list = async (args) => {
    const todos = (await listaOriginal(args)).data.items;
    if (!args.pageToken) return { data: { items: todos.slice(0, 1), nextPageToken: 'pagina2' } };
    return { data: { items: todos.slice(1) } };
  };

  const rango = await repo.listarRango('2026-10-15', '2026-10-31');
  assert.deepEqual(rango.map((r) => r.fecha).sort(), ['2026-10-16', '2026-10-19']);
});

test('reemplazar: cambia el horario dentro del mismo evento y deja la marca de dónde venía', async () => {
  const { cal, repo } = nuevoRepo();
  const creada = await repo.crear(reservaBase());
  const movida = await repo.reemplazar(creada.id, { ...creada, fecha: '2026-10-19', consultorio: 4, inicioMin: 900, finMin: 990, movidaDesde: '2026-10-16 C2 10:00-11:00', movidaPor: 'Gestora G' });
  assert.equal(movida.id, creada.id);
  assert.equal(cal.eventos.size, 1);
  assert.deepEqual([movida.fecha, movida.consultorio, movida.inicioMin, movida.finMin], ['2026-10-19', 4, 900, 990]);
  assert.equal(movida.movidaDesde, '2026-10-16 C2 10:00-11:00');
  assert.equal(movida.movidaPor, 'Gestora G');
  assert.equal(movida.titularId, 'AdrianaPR'); // se conserva a nombre de quién está
  assert.equal(movida.creadaPor, 'Adriana Perla R');
});
