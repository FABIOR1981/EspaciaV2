'use strict';
/**
 * Qué puede ver cada persona de las reservas (privacidad).
 *
 * - admin y gestor: ven todo el detalle (titular, quién la hizo, observación del bloqueo).
 * - usuario común: ve sus propias reservas completas; las de otras personas y los bloqueos
 *   aparecen solo como "Ocupado", sin nombre, sin observación y sin identificador.
 * - Las reservas canceladas no aparecen en la grilla; solo admin y gestor pueden pedirlas (informes).
 *
 * Es lo único que debe usarse para devolver reservas al navegador.
 */

const { esAdministrativo, mismoUsuario, puedeVerReservasDe, esRolValido } = require('./permisos');
const { fechaValida } = require('./reglas_de_negocio');

const DIAS_MAXIMOS_DE_RANGO = 366;

function error(codigo, mensaje, estado = 400) {
  return { ok: false, codigo, mensaje, estado };
}

/** Datos mínimos de una reserva ajena: lo justo para pintar "Ocupado" en la grilla. */
function vistaOcupado(reserva) {
  return {
    consultorio: reserva.consultorio,
    fecha: reserva.fecha,
    inicioMin: reserva.inicioMin,
    finMin: reserva.finMin,
    ocupado: true,
  };
}

function vistaCompleta(reserva) {
  return {
    id: reserva.id,
    consultorio: reserva.consultorio,
    fecha: reserva.fecha,
    inicioMin: reserva.inicioMin,
    finMin: reserva.finMin,
    tipo: reserva.tipo,
    titularId: reserva.titularId,
    titularNombre: reserva.titularNombre,
    creadaPor: reserva.creadaPor,
    observacion: reserva.observacion,
    cancelada: reserva.cancelada,
    canceladaPor: reserva.canceladaPor,
    movidaDesde: reserva.movidaDesde,
    movidaPor: reserva.movidaPor,
    ocupado: false,
  };
}

function vistaPropia(reserva) {
  return {
    id: reserva.id,
    consultorio: reserva.consultorio,
    fecha: reserva.fecha,
    inicioMin: reserva.inicioMin,
    finMin: reserva.finMin,
    tipo: 'reserva',
    titularId: reserva.titularId,
    titularNombre: reserva.titularNombre,
    cancelada: reserva.cancelada,
    movidaDesde: reserva.movidaDesde,
    ocupado: false,
    propia: true,
  };
}

/** Transforma una reserva en lo que `sesion` tiene permitido ver. */
function reservaParaSesion(reserva, sesion) {
  if (esAdministrativo(sesion.rol)) return vistaCompleta(reserva);
  if (reserva.tipo === 'reserva' && mismoUsuario(reserva.titularId, sesion.id)) return vistaPropia(reserva);
  return vistaOcupado(reserva);
}

function reservasParaSesion(reservas, sesion, { incluirCanceladas = false } = {}) {
  const mostrarCanceladas = incluirCanceladas && esAdministrativo(sesion.rol);
  return reservas.filter((r) => mostrarCanceladas || !r.cancelada).map((r) => reservaParaSesion(r, sesion));
}

/** Grilla de un día para quien la pide. */
async function listarDiaParaSesion({ repo, sesion, fecha, incluirCanceladas = false }) {
  if (!esRolValido(sesion.rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  if (!fechaValida(fecha)) return error('FECHA_INVALIDA', 'La fecha no es válida.');
  let reservas = await repo.listarDia(fecha);
  // Un usuario común no ve los consultorios que no tiene habilitados (tampoco como "Ocupado"). Sí ve los bloqueos de
  // "todos" y sus propias reservas, aunque administración o gestión se las hayan hecho en otro consultorio.
  if (!esAdministrativo(sesion.rol) && Array.isArray(sesion.espHabil)) {
    reservas = reservas.filter(
      (r) => r.consultorio === 0 || sesion.espHabil.includes(r.consultorio) || (r.tipo === 'reserva' && mismoUsuario(r.titularId, sesion.id))
    );
  }
  return { ok: true, reservas: reservasParaSesion(reservas, sesion, { incluirCanceladas }) };
}

/**
 * "Mis reservas" (o las de otra persona, solo admin y gestor) entre dos fechas.
 * Devuelve únicamente reservas (no bloqueos) activas.
 */
async function listarReservasDe({ repo, sesion, usuarioId, desde, hasta }) {
  if (!esRolValido(sesion.rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  const objetivo = usuarioId || sesion.id;
  if (!puedeVerReservasDe(sesion.rol, sesion.id, objetivo)) {
    return error('NO_PUEDE_VER_RESERVAS_AJENAS', 'No tiene permiso para ver las reservas de otra persona.', 403);
  }
  if (!fechaValida(desde) || !fechaValida(hasta)) return error('FECHA_INVALIDA', 'Las fechas no son válidas.');
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000;
  if (dias < 0) return error('RANGO_INVALIDO', 'La fecha inicial debe ser anterior a la final.');
  if (dias > DIAS_MAXIMOS_DE_RANGO) return error('RANGO_DEMASIADO_GRANDE', 'El rango pedido es demasiado largo.');

  const reservas = (await repo.listarRango(desde, hasta)).filter(
    (r) => r.tipo === 'reserva' && !r.cancelada && mismoUsuario(r.titularId, objetivo)
  );
  return { ok: true, reservas: reservas.map((r) => reservaParaSesion(r, sesion)) };
}

/**
 * Bloqueos vigentes entre dos fechas (solo admin y gestor), ordenados por fecha y hora.
 */
async function listarBloqueos({ repo, sesion, desde, hasta }) {
  if (!esRolValido(sesion.rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  if (!esAdministrativo(sesion.rol)) return error('NO_PUEDE_BLOQUEAR', 'No tiene permiso para ver los bloqueos.', 403);
  if (!fechaValida(desde) || !fechaValida(hasta)) return error('FECHA_INVALIDA', 'Las fechas no son válidas.');
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000;
  if (dias < 0) return error('RANGO_INVALIDO', 'La fecha inicial debe ser anterior a la final.');
  if (dias > DIAS_MAXIMOS_DE_RANGO) return error('RANGO_DEMASIADO_GRANDE', 'El rango pedido es demasiado largo.');

  const bloqueos = (await repo.listarRango(desde, hasta))
    .filter((r) => r.tipo === 'bloqueo' && !r.cancelada)
    .sort((a, b) => (a.fecha === b.fecha ? a.inicioMin - b.inicioMin || a.consultorio - b.consultorio : a.fecha < b.fecha ? -1 : 1));
  return { ok: true, reservas: bloqueos.map((r) => vistaCompleta(r)) };
}

/**
 * TODAS las reservas activas entre dos fechas (solo admin y gestor), ordenadas por fecha, hora y consultorio.
 * No incluye bloqueos ni canceladas.
 */
async function listarTodasLasReservas({ repo, sesion, desde, hasta }) {
  if (!esRolValido(sesion.rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  if (!esAdministrativo(sesion.rol)) {
    return error('NO_PUEDE_VER_RESERVAS_AJENAS', 'No tiene permiso para ver las reservas de otras personas.', 403);
  }
  if (!fechaValida(desde) || !fechaValida(hasta)) return error('FECHA_INVALIDA', 'Las fechas no son válidas.');
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000;
  if (dias < 0) return error('RANGO_INVALIDO', 'La fecha inicial debe ser anterior a la final.');
  if (dias > DIAS_MAXIMOS_DE_RANGO) return error('RANGO_DEMASIADO_GRANDE', 'El rango pedido es demasiado largo.');

  const reservas = (await repo.listarRango(desde, hasta))
    .filter((r) => r.tipo === 'reserva' && !r.cancelada)
    .sort((a, b) => (a.fecha === b.fecha ? a.inicioMin - b.inicioMin || a.consultorio - b.consultorio : a.fecha < b.fecha ? -1 : 1));
  return { ok: true, reservas: reservas.map((r) => vistaCompleta(r)) };
}

module.exports = {
  reservaParaSesion,
  reservasParaSesion,
  listarDiaParaSesion,
  listarReservasDe,
  listarBloqueos,
  listarTodasLasReservas,
};
