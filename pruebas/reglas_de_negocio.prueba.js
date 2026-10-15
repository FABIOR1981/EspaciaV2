'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../compartido/reglas.json');
const rn = require('../netlify/functions/nucleo/reglas_de_negocio');

// Referencias de calendario (2026): 14 mié, 15 jue, 16 vie, 17 sáb, 18 dom, 19 lun, 20 mar.
const AHORA = { fecha: '2026-10-15', minutos: 10 * 60 }; // jueves 10:00

const reservaBase = (cambios = {}) => ({
  rol: 'usuario',
  usuarioId: 'AdrianaPR',
  consultorio: 2,
  fecha: '2026-10-16',
  hora: '10:00',
  duracion: 60,
  ahora: AHORA,
  ...cambios,
});

const codigoDe = (resultado) => (resultado.ok ? 'OK' : resultado.codigo);

// ---------- Utilidades ----------

test('utilidades: día de la semana y fechas inválidas', () => {
  assert.equal(rn.diaDeSemana('2026-10-15'), 4);
  assert.equal(rn.diaDeSemana('2026-10-18'), 0);
  assert.equal(rn.fechaValida('2026-02-30'), false);
  assert.equal(rn.fechaValida('2026-10-15'), true);
  assert.equal(rn.horaAMinutos('08:30'), 510);
  assert.equal(rn.horaAMinutos('24:00'), null);
  assert.equal(rn.minutosAHora(510), '08:30');
});

test('ahoraLocal: 02:00 UTC es 23:00 del día anterior en Montevideo', () => {
  const r = rn.ahoraLocal('America/Montevideo', new Date('2026-10-16T02:00:00Z'));
  assert.deepEqual(r, { fecha: '2026-10-15', minutos: 23 * 60 });
});

// ---------- Reservas: validaciones de formato y de horario ----------

test('reserva válida de usuario', () => {
  const r = rn.validarNuevaReserva(reglas, reservaBase());
  assert.equal(r.ok, true);
  assert.equal(r.inicioMin, 600);
  assert.equal(r.finMin, 660);
});

test('reserva: consultorio inexistente', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ consultorio: 6 }))), 'CONSULTORIO_INVALIDO');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ consultorio: 0 }))), 'CONSULTORIO_INVALIDO');
});

test('reserva: duración no permitida', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ duracion: 45 }))), 'DURACION_INVALIDA');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ duracion: 90 }))), 'OK');
});

test('reserva: domingo no laboral', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ fecha: '2026-10-18' }))), 'DIA_NO_LABORAL');
});

test('reserva: horario de apertura y cierre', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ hora: '07:30' }))), 'FUERA_DE_HORARIO');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ hora: '22:00' }))), 'FUERA_DE_HORARIO');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ hora: '21:30', duracion: 60 }))), 'EXCEDE_CIERRE');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ hora: '21:00', duracion: 60 }))), 'OK');
});

test('reserva: el sábado cierra a las 16:00', () => {
  const sabado = { fecha: '2026-10-17' };
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ ...sabado, hora: '15:00', duracion: 60 }))), 'OK');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ ...sabado, hora: '15:30', duracion: 60 }))), 'EXCEDE_CIERRE');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ ...sabado, hora: '16:00' }))), 'FUERA_DE_HORARIO');
});

test('reserva: la hora debe caer en tramos de 30 minutos', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ hora: '10:15' }))), 'HORA_FUERA_DE_TRAMO');
});

test('reserva: admin y gestor pueden pasarse del cierre pero no de la medianoche', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'admin', hora: '21:30', duracion: 90 }))), 'OK');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'gestor', hora: '21:30', duracion: 90 }))), 'OK');
});

test('reserva: campos inválidos', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ fecha: 'mañana' }))), 'FECHA_INVALIDA');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ hora: '10' }))), 'HORA_INVALIDA');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'visitante' }))), 'ROL_INVALIDO');
});

// ---------- Reservas: a nombre de quién ----------

test('reserva: un usuario no puede reservar a nombre de otro; admin y gestor sí', () => {
  const r = rn.validarNuevaReserva(reglas, reservaBase({ paraUsuarioId: 'OtraPersona' }));
  assert.equal(r.codigo, 'NO_PUEDE_RESERVAR_PARA_OTRO');
  assert.equal(r.estado, 403);
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'gestor', paraUsuarioId: 'OtraPersona' }))), 'OK');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'admin', paraUsuarioId: 'OtraPersona' }))), 'OK');
});

test('reserva: reservar para sí mismo indicando el id con otras mayúsculas es válido', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ paraUsuarioId: 'adrianapr' }))), 'OK');
});

// ---------- Reservas: pasado y futuro ----------

test('reserva: usuario no puede agendar en fecha pasada ni en una hora que ya pasó hoy', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ fecha: '2026-10-14' }))), 'FECHA_PASADA');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ fecha: '2026-10-15', hora: '09:00' }))), 'HORA_PASADA');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ fecha: '2026-10-15', hora: '10:30' }))), 'OK');
});

test('reserva: admin puede agendar en el pasado', () => {
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'admin', fecha: '2026-10-05' }))), 'OK');
});

test('reserva: el gestor solo puede cerrar "ayer" antes de las 02:00', () => {
  const madrugada = { fecha: '2026-10-15', minutos: 60 }; // jueves 01:00
  const tarde = { fecha: '2026-10-15', minutos: 3 * 60 }; // jueves 03:00
  const ayer = { rol: 'gestor', fecha: '2026-10-14' };
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ ...ayer, ahora: madrugada }))), 'OK');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ ...ayer, ahora: tarde }))), 'FECHA_PASADA');
  assert.equal(
    codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'gestor', fecha: '2026-10-13', ahora: madrugada }))),
    'FECHA_PASADA'
  );
});

test('reserva: máximo 12 semanas hacia adelante (admin sin límite)', () => {
  // 12 semanas desde el jueves 15/10 = jueves 07/01/2027 (84 días); el 08/01 ya excede.
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ fecha: '2027-01-07' }))), 'OK');
  const r = rn.validarNuevaReserva(reglas, reservaBase({ fecha: '2027-01-08' }));
  assert.equal(r.codigo, 'MUY_ADELANTADA');
  assert.match(r.mensaje, /091 001 334/);
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'gestor', fecha: '2027-01-08' }))), 'MUY_ADELANTADA');
  assert.equal(codigoDe(rn.validarNuevaReserva(reglas, reservaBase({ rol: 'admin', fecha: '2027-03-05' }))), 'OK');
});

// ---------- Cancelaciones ----------

const cancelBase = (cambios = {}) => ({
  rol: 'usuario',
  usuarioId: 'AdrianaPR',
  duenoId: 'AdrianaPR',
  fecha: '2026-10-17',
  hora: '10:00',
  ahora: AHORA,
  ...cambios,
});

test('cancelación: el usuario necesita más de 24 horas de antelación', () => {
  // jueves 10:00 -> viernes 10:00 son exactamente 24 h: no alcanza (<=).
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase({ fecha: '2026-10-16' }))), 'FUERA_DE_PLAZO_DE_CANCELACION');
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase({ fecha: '2026-10-16', hora: '10:30' }))), 'OK');
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase())), 'OK');
});

test('cancelación: admin y gestor cancelan sin límite de antelación', () => {
  const casi = { fecha: '2026-10-15', hora: '10:30' };
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase({ ...casi, rol: 'gestor', usuarioId: 'Gestora' }))), 'OK');
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase({ ...casi, rol: 'admin', usuarioId: 'Admin' }))), 'OK');
});

test('cancelación: nadie cancela una reserva que ya pasó, ni siquiera el admin', () => {
  const pasada = { fecha: '2026-10-15', hora: '09:00' };
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase({ ...pasada, rol: 'admin', usuarioId: 'Admin' }))), 'RESERVA_PASADA');
});

test('cancelación: un usuario solo cancela las suyas', () => {
  const r = rn.validarCancelacion(reglas, cancelBase({ duenoId: 'OtraPersona' }));
  assert.equal(r.codigo, 'NO_ES_SU_RESERVA');
  assert.equal(r.estado, 403);
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase({ duenoId: 'adrianapr' }))), 'OK');
});

test('cancelación: regla opcional de los lunes (+48 h) cuando está activada', () => {
  const conRegla = { ...reglas, cancelacion: { ...reglas.cancelacion, reglaFinDeSemana: true } };
  // Lunes 19/10 10:00: desde jueves 10:00 hay 96 h; con la regla se exigen 72 h.
  assert.equal(codigoDe(rn.validarCancelacion(conRegla, cancelBase({ fecha: '2026-10-19' }))), 'OK');
  const viernesAlLunes = { ahora: { fecha: '2026-10-16', minutos: 10 * 60 }, fecha: '2026-10-19' }; // 72 h justas
  assert.equal(codigoDe(rn.validarCancelacion(conRegla, cancelBase(viernesAlLunes))), 'FUERA_DE_PLAZO_DE_CANCELACION');
  assert.equal(codigoDe(rn.validarCancelacion(reglas, cancelBase(viernesAlLunes))), 'OK'); // regla apagada
});

// ---------- Bloqueos ----------

const bloqueoBase = (cambios = {}) => ({
  rol: 'gestor',
  consultorios: [1, 2],
  fecha: '2026-10-16',
  horaInicio: '09:00',
  horaFin: '12:00',
  ahora: AHORA,
  ...cambios,
});

test('bloqueo: solo admin y gestor', () => {
  const r = rn.validarBloqueo(reglas, bloqueoBase({ rol: 'usuario' }));
  assert.equal(r.codigo, 'NO_PUEDE_BLOQUEAR');
  assert.equal(r.estado, 403);
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ rol: 'admin' }))), 'OK');
});

test('bloqueo: "todos" (0) se normaliza y reemplaza a los demás', () => {
  const r = rn.validarBloqueo(reglas, bloqueoBase({ consultorios: [0, 3] }));
  assert.deepEqual(r.consultorios, [0]);
  assert.deepEqual(rn.validarBloqueo(reglas, bloqueoBase({ consultorios: [2, 2, 3] })).consultorios, [2, 3]);
});

test('bloqueo: validación de consultorios y de rango horario', () => {
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ consultorios: [] }))), 'CONSULTORIO_INVALIDO');
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ consultorios: [7] }))), 'CONSULTORIO_INVALIDO');
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ horaInicio: '12:00', horaFin: '09:00' }))), 'RANGO_INVALIDO');
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ horaInicio: '07:00', horaFin: '09:00' }))), 'FUERA_DE_HORARIO');
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ fecha: '2026-10-18' }))), 'DIA_NO_LABORAL');
});

test('bloqueo de día completo usa el horario real de ese día', () => {
  const viernes = rn.validarBloqueo(reglas, bloqueoBase({ diaCompleto: true }));
  assert.equal(viernes.inicioMin, 8 * 60);
  assert.equal(viernes.finMin, 22 * 60);
  const sabado = rn.validarBloqueo(reglas, bloqueoBase({ diaCompleto: true, fecha: '2026-10-17' }));
  assert.equal(sabado.finMin, 16 * 60);
});

test('bloqueo: el gestor no puede bloquear en el pasado salvo "ayer" antes de las 02:00', () => {
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ fecha: '2026-10-14' }))), 'FECHA_PASADA');
  assert.equal(codigoDe(rn.validarBloqueo(reglas, bloqueoBase({ rol: 'admin', fecha: '2026-10-14' }))), 'OK');
});

// ---------- Superposición ----------

const evento = (cambios = {}) => ({ consultorio: 2, fecha: '2026-10-16', inicioMin: 600, finMin: 660, cancelada: false, ...cambios });
const pedido = (cambios = {}) => ({ consultorio: 2, fecha: '2026-10-16', inicioMin: 630, finMin: 690, ...cambios });

test('superposición: se detecta el solapamiento parcial en el mismo consultorio', () => {
  assert.equal(rn.haySuperposicion([evento()], pedido()).length, 1);
});

test('superposición: tramos contiguos no chocan', () => {
  assert.equal(rn.haySuperposicion([evento()], pedido({ inicioMin: 660, finMin: 720 })).length, 0);
  assert.equal(rn.haySuperposicion([evento()], pedido({ inicioMin: 540, finMin: 600 })).length, 0);
});

test('superposición: otro consultorio u otro día no chocan', () => {
  assert.equal(rn.haySuperposicion([evento()], pedido({ consultorio: 3 })).length, 0);
  assert.equal(rn.haySuperposicion([evento()], pedido({ fecha: '2026-10-17' })).length, 0);
});

test('superposición: las reservas canceladas no cuentan', () => {
  assert.equal(rn.haySuperposicion([evento({ cancelada: true })], pedido()).length, 0);
});

test('superposición: un bloqueo de todos (consultorio 0) choca con cualquier consultorio', () => {
  assert.equal(rn.haySuperposicion([evento({ consultorio: 0 })], pedido({ consultorio: 5 })).length, 1);
  assert.equal(rn.haySuperposicion([evento({ consultorio: 4 })], pedido({ consultorio: 0 })).length, 1);
});
