'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../compartido/reglas.json');
const g = require('../netlify/functions/nucleo/google_calendario');
const s = require('../netlify/functions/nucleo/reservas_servicio');
const { crearCalendarioSimulado } = require('./ayudas/calendario_simulado');

// Jueves 15/10/2026 10:00 (hora de Montevideo). Lunes 19, viernes 16, domingo 18.
const AHORA = { fecha: '2026-10-15', minutos: 10 * 60 };
const ANA = { id: 'AdrianaPR', nombre: 'Adriana Perla R', rol: 'usuario' };
const LUIS = { id: 'Luis', nombre: 'Luis Pérez', rol: 'usuario' };
const GESTOR = { id: 'Gestora', nombre: 'Gestora G', rol: 'gestor' };
const ADMIN = { id: 'Admin', nombre: 'Administración', rol: 'admin' };

function entorno() {
  const cal = crearCalendarioSimulado();
  const repo = g.crearRepositorioDeReservas(cal, { calendarioId: 'cal-pruebas' }, { zonaHoraria: 'America/Montevideo', notificarInvitados: false });
  return { cal, repo };
}

const reservar = (repo, sesion, entrada = {}, titular = sesion) =>
  s.crearReserva({
    reglas, repo, sesion, titular: { id: titular.id, nombre: titular.nombre },
    entrada: { consultorio: 2, fecha: '2026-10-19', hora: '10:00', duracion: 60, ...entrada },
    ahora: AHORA,
  });

const cancelar = (repo, sesion, id, ahora = AHORA) => s.cancelarReserva({ reglas, repo, sesion, id, ahora });
const bloquear = (repo, sesion, entrada = {}) =>
  s.crearBloqueo({ reglas, repo, sesion, entrada: { consultorios: [1], fecha: '2026-10-19', horaInicio: '09:00', horaFin: '12:00', ...entrada }, ahora: AHORA });

// ---------- Crear reserva ----------

test('crea una reserva válida y guarda titular y quién la hizo', async () => {
  const { repo } = entorno();
  const r = await reservar(repo, ANA);
  assert.equal(r.ok, true);
  assert.equal(r.reserva.titularId, 'AdrianaPR');
  assert.equal(r.reserva.creadaPor, 'Adriana Perla R');
  assert.equal((await repo.listarDia('2026-10-19')).length, 1);
});

test('si las reglas la rechazan, no toca el calendario', async () => {
  const { cal, repo } = entorno();
  const r = await reservar(repo, ANA, { fecha: '2026-10-18' }); // domingo
  assert.equal(r.codigo, 'DIA_NO_LABORAL');
  assert.equal(cal.llamadas.length, 0);
});

test('rechaza el horario ocupado con 409 y no crea nada más', async () => {
  const { cal, repo } = entorno();
  await reservar(repo, ANA);
  const r = await reservar(repo, LUIS, { hora: '10:30' }); // se superpone
  assert.equal(r.codigo, 'HORARIO_OCUPADO');
  assert.equal(r.estado, 409);
  assert.equal(cal.eventos.size, 1);
});

test('el mismo horario en otro consultorio está libre', async () => {
  const { repo } = entorno();
  await reservar(repo, ANA);
  assert.equal((await reservar(repo, LUIS, { consultorio: 3 })).ok, true);
});

test('un usuario no puede reservar a nombre de otro; admin y gestor sí', async () => {
  const { repo } = entorno();
  const noPuede = await reservar(repo, ANA, {}, LUIS);
  assert.equal(noPuede.codigo, 'NO_PUEDE_RESERVAR_PARA_OTRO');
  assert.equal(noPuede.estado, 403);
  const puede = await reservar(repo, GESTOR, { consultorio: 4 }, LUIS);
  assert.equal(puede.ok, true);
  assert.equal(puede.reserva.titularId, 'Luis');
  assert.equal(puede.reserva.creadaPor, 'Gestora G');
});

test('una reserva cancelada libera el horario', async () => {
  const { repo } = entorno();
  const primera = await reservar(repo, ANA);
  await cancelar(repo, ANA, primera.reserva.id);
  assert.equal((await reservar(repo, LUIS)).ok, true);
});

test('reservas simultáneas: se queda la que llegó primero y la otra se deshace', async () => {
  const { cal, repo } = entorno();
  const insertOriginal = cal.events.insert;
  cal.events.insert = async (args) => {
    // Un rival crea el mismo horario justo antes que nosotros, sin que lo veamos en la verificación inicial.
    await insertOriginal({
      requestBody: {
        summary: 'C2: Rival',
        start: { dateTime: '2026-10-19T10:00:00' },
        end: { dateTime: '2026-10-19T11:00:00' },
        extendedProperties: { private: { titularId: 'Rival', tipo: 'reserva' } },
      },
      sendUpdates: 'none',
    });
    return insertOriginal(args);
  };
  const r = await reservar(repo, ANA);
  assert.equal(r.codigo, 'HORARIO_OCUPADO');
  const dia = await repo.listarDia('2026-10-19');
  assert.equal(dia.length, 1);
  assert.equal(dia[0].titularId, 'Rival');
});

// ---------- Cancelar ----------

test('el titular cancela con antelación suficiente', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  const r = await cancelar(repo, ANA, reserva.id);
  assert.equal(r.ok, true);
  assert.equal(r.reserva.cancelada, true);
  assert.equal(r.reserva.canceladaPor, 'Adriana Perla R');
});

test('otro usuario no puede cancelar una reserva ajena', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  const r = await cancelar(repo, LUIS, reserva.id);
  assert.equal(r.codigo, 'NO_ES_SU_RESERVA');
  assert.equal(r.estado, 403);
});

test('cancelar una reserva inexistente devuelve 404', async () => {
  const { repo } = entorno();
  const r = await cancelar(repo, ANA, 'no-existe');
  assert.equal(r.codigo, 'NO_ENCONTRADA');
  assert.equal(r.estado, 404);
});

test('el usuario no puede cancelar con menos de 24 horas; admin y gestor sí', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  const dentroDelPlazo = { fecha: '2026-10-19', minutos: 9 * 60 }; // lunes 09:00, falta 1 h
  assert.equal((await cancelar(repo, ANA, reserva.id, dentroDelPlazo)).codigo, 'FUERA_DE_PLAZO_DE_CANCELACION');
  assert.equal((await cancelar(repo, GESTOR, reserva.id, dentroDelPlazo)).ok, true);
});

test('cancelar dos veces es inofensivo', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  await cancelar(repo, ANA, reserva.id);
  const otra = await cancelar(repo, ANA, reserva.id);
  assert.equal(otra.ok, true);
  assert.equal(otra.yaCancelada, true);
});

test('un usuario común no puede cancelar un bloqueo', async () => {
  const { repo } = entorno();
  const { reservas } = await bloquear(repo, GESTOR);
  assert.equal((await cancelar(repo, ANA, reservas[0].id)).estado, 403);
  assert.equal((await cancelar(repo, ADMIN, reservas[0].id)).ok, true);
});

// ---------- Bloqueos ----------

test('solo admin y gestor pueden bloquear', async () => {
  const { cal, repo } = entorno();
  const r = await bloquear(repo, ANA);
  assert.equal(r.codigo, 'NO_PUEDE_BLOQUEAR');
  assert.equal(cal.eventos.size, 0);
});

test('bloquear "todos" crea un solo evento y ese bloqueo impide reservar en cualquier consultorio', async () => {
  const { cal, repo } = entorno();
  const b = await bloquear(repo, GESTOR, { consultorios: [0] });
  assert.equal(b.ok, true);
  assert.equal(cal.eventos.size, 1);
  assert.equal((await reservar(repo, ANA, { consultorio: 3, hora: '10:00' })).codigo, 'HORARIO_OCUPADO');
  assert.equal((await reservar(repo, ANA, { consultorio: 3, hora: '12:00' })).ok, true); // después del bloqueo
});

test('bloquear varios consultorios crea un evento por cada uno', async () => {
  const { cal, repo } = entorno();
  const b = await bloquear(repo, GESTOR, { consultorios: [1, 2, 3] });
  assert.equal(b.reservas.length, 3);
  assert.equal(cal.eventos.size, 3);
});

test('si un bloqueo choca con una reserva existente, no se crea ninguno (todo o nada)', async () => {
  const { cal, repo } = entorno();
  await reservar(repo, ANA, { consultorio: 2, hora: '10:00' });
  const b = await bloquear(repo, GESTOR, { consultorios: [1, 2, 3] });
  assert.equal(b.codigo, 'HORARIO_OCUPADO');
  assert.equal(cal.eventos.size, 1);
});

test('si falla la creación a mitad de un bloqueo múltiple, se deshace lo creado', async () => {
  const { cal, repo } = entorno();
  const insertOriginal = cal.events.insert;
  let llamadas = 0;
  cal.events.insert = async (args) => {
    llamadas += 1;
    if (llamadas === 2) throw new Error('Google no disponible');
    return insertOriginal(args);
  };
  await assert.rejects(() => bloquear(repo, GESTOR, { consultorios: [1, 2, 3] }), /Google no disponible/);
  assert.equal(cal.eventos.size, 0);
});

test('el bloqueo de día completo cubre el horario real del sábado (hasta las 16:00)', async () => {
  const { repo } = entorno();
  const { reservas } = await bloquear(repo, GESTOR, { consultorios: [1], fecha: '2026-10-17', diaCompleto: true });
  assert.equal(reservas[0].inicioMin, 8 * 60);
  assert.equal(reservas[0].finMin, 16 * 60);
});

// ---------- Mover una reserva ----------

const mover = (repo, sesion, id, destino = {}, ahora = AHORA) =>
  s.moverReserva({ reglas, repo, sesion, id, destino: { consultorio: 2, fecha: '2026-10-20', hora: '10:00', duracion: 60, ...destino }, ahora });

test('mover: el titular cambia día, hora y consultorio dentro del mismo evento, con la marca "movida desde"', async () => {
  const { cal, repo } = entorno();
  const { reserva } = await reservar(repo, ANA); // lunes 19, 10:00, consultorio 2
  const r = await mover(repo, ANA, reserva.id, { fecha: '2026-10-20', hora: '15:00', consultorio: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.reserva.id, reserva.id); // el mismo evento: no hay cancelación ni una reserva nueva
  assert.deepEqual([r.reserva.fecha, r.reserva.inicioMin, r.reserva.consultorio], ['2026-10-20', 900, 3]);
  assert.equal(r.reserva.movidaDesde, '2026-10-19 C2 10:00-11:00');
  assert.equal(r.reserva.movidaPor, 'Adriana Perla R');
  assert.equal(r.reserva.cancelada, false);
  assert.equal(cal.eventos.size, 1);
  const evento = cal.eventos.get(reserva.id);
  assert.ok(evento.summary.startsWith('C3:'));
  assert.match(evento.description, /Movida desde: 2026-10-19 C2 10:00-11:00 por Adriana Perla R/);
  // El lugar anterior queda libre y el nuevo ocupado.
  assert.equal((await reservar(repo, LUIS)).ok, true);
  assert.equal((await reservar(repo, LUIS, { fecha: '2026-10-20', hora: '15:00', consultorio: 3 })).codigo, 'HORARIO_OCUPADO');
});

test('mover: si el lugar nuevo está ocupado, la reserva original queda intacta', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  await reservar(repo, LUIS, { fecha: '2026-10-20', hora: '15:00', consultorio: 3 });
  const r = await mover(repo, ANA, reserva.id, { fecha: '2026-10-20', hora: '15:30', consultorio: 3 });
  assert.equal(r.codigo, 'HORARIO_OCUPADO');
  assert.equal(r.estado, 409);
  const intacta = await repo.obtener(reserva.id);
  assert.deepEqual([intacta.fecha, intacta.inicioMin, intacta.consultorio, intacta.movidaDesde], ['2026-10-19', 600, 2, null]);
});

test('mover: se puede correr unos minutos aunque se superponga con su propio horario', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA); // 10:00 a 11:00
  const r = await mover(repo, ANA, reserva.id, { fecha: '2026-10-19', hora: '10:30' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.reserva.inicioMin, r.reserva.finMin], [630, 690]);
});

test('mover: si queda igual, se avisa', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  assert.equal((await mover(repo, ANA, reserva.id, { fecha: '2026-10-19' })).codigo, 'SIN_CAMBIOS');
});

test('mover: mismos límites que cancelar sobre el horario original (24 h para el usuario)', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA, { fecha: '2026-10-16' }); // viernes 10:00: faltan exactamente 24 h
  const r = await mover(repo, ANA, reserva.id, { fecha: '2026-10-19' });
  assert.equal(r.codigo, 'FUERA_DE_PLAZO_DE_CANCELACION');
  assert.match(r.mensaje, /mover/);
  assert.doesNotMatch(r.mensaje, /cancelar/);
  // Gestión y administración no tienen ese límite.
  assert.equal((await mover(repo, GESTOR, reserva.id, { fecha: '2026-10-19' })).ok, true);
  const otra = await reservar(repo, ANA, { fecha: '2026-10-16', consultorio: 3 });
  assert.equal((await mover(repo, ADMIN, otra.reserva.id, { fecha: '2026-10-19', consultorio: 3 })).ok, true);
});

test('mover: un usuario solo mueve las suyas; admin y gestor, cualquiera', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  const r = await mover(repo, LUIS, reserva.id, { fecha: '2026-10-20' });
  assert.equal(r.codigo, 'NO_ES_SU_RESERVA');
  assert.equal(r.estado, 403);
  assert.match(r.mensaje, /mover/);
  assert.equal((await mover(repo, GESTOR, reserva.id, { fecha: '2026-10-20' })).ok, true);
});

test('mover: nadie mueve una reserva que ya pasó, ni siquiera administración', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ADMIN, { fecha: '2026-10-10' }); // el admin sí puede crear en el pasado
  assert.equal((await mover(repo, ADMIN, reserva.id, { fecha: '2026-10-20' })).codigo, 'RESERVA_PASADA');
});

test('mover: el destino sigue las reglas de una reserva nueva (día laborable, no pasado, espacios habilitados)', async () => {
  const { repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  assert.equal((await mover(repo, ANA, reserva.id, { fecha: '2026-10-18' })).codigo, 'DIA_NO_LABORAL');
  assert.equal((await mover(repo, ANA, reserva.id, { fecha: '2026-10-14' })).codigo, 'FECHA_PASADA');
  assert.equal((await mover(repo, ANA, reserva.id, { fecha: '2027-03-01' })).codigo, 'MUY_ADELANTADA');

  const acotada = { ...ANA, espHabil: [2] };
  const noHabilitado = await mover(repo, acotada, reserva.id, { consultorio: 3 });
  assert.equal(noHabilitado.codigo, 'ESPACIO_NO_HABILITADO');
  assert.equal(noHabilitado.estado, 403);
  // Contingencia: administración la puede mover a un espacio no habilitado para esa persona.
  assert.equal((await mover(repo, ADMIN, reserva.id, { consultorio: 3 })).ok, true);
});

test('mover: no se mueven bloqueos, canceladas ni reservas inexistentes', async () => {
  const { repo } = entorno();
  const { reservas } = await bloquear(repo, GESTOR);
  assert.equal((await mover(repo, GESTOR, reservas[0].id, { fecha: '2026-10-20' })).codigo, 'NO_SE_PUEDE_MOVER_BLOQUEO');
  const { reserva } = await reservar(repo, ANA, { consultorio: 4 });
  await cancelar(repo, ANA, reserva.id);
  assert.equal((await mover(repo, ANA, reserva.id, { fecha: '2026-10-20' })).codigo, 'RESERVA_CANCELADA');
  assert.equal((await mover(repo, ANA, 'no-existe')).estado, 404);
});

test('mover: si otra persona toma el lugar casi al mismo tiempo, la reserva vuelve a su horario original', async () => {
  const { cal, repo } = entorno();
  const { reserva } = await reservar(repo, ANA);
  const parcheOriginal = cal.events.patch;
  cal.events.patch = async (args) => {
    cal.events.patch = parcheOriginal; // el rival aparece justo antes de que se guarde el movimiento; el deshacer usa el parche real
    await cal.events.insert({
      requestBody: {
        summary: 'C3: Rival',
        start: { dateTime: '2026-10-20T15:00:00' },
        end: { dateTime: '2026-10-20T16:00:00' },
        extendedProperties: { private: { titularId: 'Rival', tipo: 'reserva' } },
      },
      sendUpdates: 'none',
    });
    return parcheOriginal(args);
  };
  const r = await mover(repo, ANA, reserva.id, { fecha: '2026-10-20', hora: '15:00', consultorio: 3 });
  assert.equal(r.codigo, 'HORARIO_OCUPADO');
  const vuelta = await repo.obtener(reserva.id);
  assert.deepEqual([vuelta.fecha, vuelta.inicioMin, vuelta.consultorio], ['2026-10-19', 600, 2]);
  assert.equal(vuelta.cancelada, false);
  assert.equal((await repo.listarDia('2026-10-20')).filter((x) => x.titularId === 'Rival').length, 1);
});
