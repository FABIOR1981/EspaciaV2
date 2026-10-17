'use strict';
/**
 * Reglas de negocio de EspaciaV2.
 *
 * Lógica pura: no usa red, ni reloj, ni Google, ni GitHub.
 * El "ahora" siempre llega como parámetro: { fecha: 'AAAA-MM-DD', minutos: 0..1439 } en hora local
 * (se obtiene con ahoraLocal). Así las reglas se pueden probar sin depender de la hora real.
 *
 * Las fechas son texto 'AAAA-MM-DD' y las horas 'HH:MM'. Todo el cálculo se hace sobre esos textos,
 * por lo que no depende de la zona horaria del servidor.
 *
 * Cada validación devuelve { ok: true, ... } o { ok: false, codigo, mensaje, estado }.
 */

const { esRolValido, esAdministrativo, mismoUsuario } = require('./permisos');

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTOS_POR_DIA = 1440;

// ---------- Utilidades de fecha y hora ----------

function fechaValida(fecha) {
  if (typeof fecha !== 'string' || !REGEX_FECHA.test(fecha)) return false;
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

function diasDesdeEpoca(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
}

function sumarDias(fecha, cantidad) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + cantidad)).toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado (calculado sobre el texto, sin zona horaria). */
function diaDeSemana(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

function horaAMinutos(hora) {
  const m = typeof hora === 'string' ? REGEX_HORA.exec(hora) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minutosAHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** Fecha y minutos locales de un instante, en la zona horaria dada. */
function ahoraLocal(zonaHoraria, instante = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

function minutosAbsolutos(fecha, minutos) {
  return diasDesdeEpoca(fecha) * MINUTOS_POR_DIA + minutos;
}

// ---------- Resultados ----------

function error(codigo, mensaje, estado = 400) {
  return { ok: false, codigo, mensaje, estado };
}

// ---------- Horario del día ----------

/** Devuelve { inicio, fin } en minutos para esa fecha, o null si no es día laborable. */
function horarioDelDia(reglas, fecha) {
  const dia = diaDeSemana(fecha);
  if (!reglas.diasLaborales.includes(dia)) return null;
  const especial = reglas.horariosEspeciales && reglas.horariosEspeciales[String(dia)];
  const h = especial || reglas.horario;
  return { inicio: horaAMinutos(h.inicio), fin: horaAMinutos(h.fin) };
}

// ---------- Fecha permitida según el rol (común a reservas y bloqueos) ----------

function validarFechaPermitida(reglas, rol, fecha, inicioMin, ahora) {
  const diferenciaDias = diasDesdeEpoca(fecha) - diasDesdeEpoca(ahora.fecha);

  if (diferenciaDias < 0) {
    if (rol === 'admin') return { ok: true };
    const limiteGestor = horaAMinutos(reglas.reserva.gestorPuedeCerrarAyerHasta);
    if (rol === 'gestor' && diferenciaDias === -1 && ahora.minutos < limiteGestor) return { ok: true };
    return error('FECHA_PASADA', 'No se puede agendar en una fecha pasada.', 400);
  }

  if (diferenciaDias === 0 && rol === 'usuario' && inicioMin < ahora.minutos) {
    return error('HORA_PASADA', 'No se puede agendar en un horario que ya pasó.', 400);
  }

  if (rol !== 'admin' && diferenciaDias > reglas.reserva.maxSemanasAdelante * 7) {
    const tel = reglas.contacto && reglas.contacto.telefonoSecretaria;
    const contacto = tel ? ` Comuníquese con la secretaría al ${tel}.` : ' Comuníquese con la secretaría.';
    return error(
      'MUY_ADELANTADA',
      `Solo se puede agendar hasta ${reglas.reserva.maxSemanasAdelante} semanas hacia adelante.${contacto}`,
      400
    );
  }

  return { ok: true };
}

// ---------- Reservas ----------

/**
 * @param {object} reglas contenido de compartido/reglas.json
 * @param {object} datos { rol, usuarioId, paraUsuarioId?, consultorio, fecha, hora, duracion, ahora, espHabil? }
 */
function validarNuevaReserva(reglas, datos) {
  const { rol, usuarioId, paraUsuarioId, consultorio, fecha, hora, duracion, ahora, espHabil } = datos;

  if (!esRolValido(rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  if (!fechaValida(fecha)) return error('FECHA_INVALIDA', 'La fecha no es válida.');

  const inicio = horaAMinutos(hora);
  if (inicio === null) return error('HORA_INVALIDA', 'La hora no es válida.');

  if (!Number.isInteger(consultorio) || consultorio < 1 || consultorio > reglas.espacios.cantidad) {
    return error('CONSULTORIO_INVALIDO', 'El consultorio indicado no existe.');
  }
  if (!reglas.duracionesMinutos.includes(duracion)) {
    return error('DURACION_INVALIDA', 'La duración indicada no está permitida.');
  }
  // Un usuario común solo reserva en sus espacios habilitados; administración y gestión pueden hacerlo en cualquiera
  // (por ejemplo, ante una contingencia).
  if (!esAdministrativo(rol) && Array.isArray(espHabil) && !espHabil.includes(consultorio)) {
    return error('ESPACIO_NO_HABILITADO', 'Ese consultorio no está habilitado para tu usuario.', 403);
  }

  if (paraUsuarioId && !mismoUsuario(usuarioId, paraUsuarioId) && !esAdministrativo(rol)) {
    return error('NO_PUEDE_RESERVAR_PARA_OTRO', 'Solo puede reservar a su nombre.', 403);
  }

  const horario = horarioDelDia(reglas, fecha);
  if (!horario) return error('DIA_NO_LABORAL', 'Ese día no hay atención.');

  if (inicio % reglas.tramoMinutos !== 0) {
    return error('HORA_FUERA_DE_TRAMO', `La hora debe comenzar en tramos de ${reglas.tramoMinutos} minutos.`);
  }
  if (inicio < horario.inicio || inicio >= horario.fin) {
    return error('FUERA_DE_HORARIO', 'La hora está fuera del horario de atención.');
  }

  const fin = inicio + duracion;
  // SUPUESTO (a confirmar): admin y gestor pueden pasarse del cierre, pero nunca más allá de la medianoche.
  if (!esAdministrativo(rol) && fin > horario.fin) {
    return error('EXCEDE_CIERRE', 'La reserva termina después del horario de cierre.');
  }
  if (fin > MINUTOS_POR_DIA) {
    return error('EXCEDE_DIA', 'La reserva no puede terminar después de la medianoche.');
  }

  const fechaPermitida = validarFechaPermitida(reglas, rol, fecha, inicio, ahora);
  if (!fechaPermitida.ok) return fechaPermitida;

  return { ok: true, consultorio, fecha, inicioMin: inicio, finMin: fin };
}

// ---------- Cancelaciones ----------

/**
 * @param {object} datos { rol, usuarioId, duenoId, fecha, hora, ahora }
 *   duenoId = id del usuario titular de la reserva; fecha/hora = inicio de la reserva.
 */
function validarCancelacion(reglas, datos) {
  const { rol, usuarioId, duenoId, fecha, hora, ahora } = datos;

  if (!esRolValido(rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  if (!fechaValida(fecha) || horaAMinutos(hora) === null) {
    return error('RESERVA_INVALIDA', 'La reserva no tiene fecha u hora válidas.');
  }

  if (!esAdministrativo(rol) && !mismoUsuario(usuarioId, duenoId)) {
    return error('NO_ES_SU_RESERVA', 'Solo puede cancelar sus propias reservas.', 403);
  }

  const horasHastaInicio =
    (minutosAbsolutos(fecha, horaAMinutos(hora)) - minutosAbsolutos(ahora.fecha, ahora.minutos)) / 60;

  if (horasHastaInicio < 0) {
    return error('RESERVA_PASADA', 'No se puede cancelar una reserva que ya pasó.');
  }

  if (!esAdministrativo(rol)) {
    const { horasAntelacion, reglaFinDeSemana, horasExtraLunes } = reglas.cancelacion;
    const esLunes = diaDeSemana(fecha) === 1;
    const horasRequeridas = horasAntelacion + (reglaFinDeSemana && esLunes ? horasExtraLunes : 0);
    if (horasHastaInicio <= horasRequeridas) {
      return error(
        'FUERA_DE_PLAZO_DE_CANCELACION',
        `Solo se puede cancelar con más de ${horasRequeridas} horas de antelación.`
      );
    }
  }

  return { ok: true };
}

// ---------- Mover una reserva ----------

/**
 * Mover = soltar el horario original y tomar uno nuevo. Mismas reglas que una cancelación sobre el horario ORIGINAL
 * (usuario: solo las suyas y con más de 24 h de antelación; admin y gestor: cualquiera, pero no una que ya pasó) y
 * mismas reglas que una reserva nueva sobre el DESTINO, para quien la pide.
 * @param {object} datos { rol, usuarioId, duenoId, original: {consultorio, fecha, inicioMin, finMin},
 *                         destino: {consultorio, fecha, hora, duracion}, ahora, espHabil? }
 */
function validarMovimiento(reglas, datos) {
  const { rol, usuarioId, duenoId, original, destino, ahora, espHabil } = datos;

  const cancelacion = validarCancelacion(reglas, { rol, usuarioId, duenoId, fecha: original.fecha, hora: minutosAHora(original.inicioMin), ahora });
  if (!cancelacion.ok) return { ...cancelacion, mensaje: cancelacion.mensaje.replace('cancelar', 'mover') };

  const nueva = validarNuevaReserva(reglas, {
    rol, usuarioId, paraUsuarioId: duenoId, consultorio: destino.consultorio, fecha: destino.fecha, hora: destino.hora, duracion: destino.duracion, ahora, espHabil,
  });
  if (!nueva.ok) return nueva;

  const igual = original.consultorio === nueva.consultorio && original.fecha === nueva.fecha && original.inicioMin === nueva.inicioMin && original.finMin === nueva.finMin;
  if (igual) return error('SIN_CAMBIOS', 'La reserva ya está en ese horario.');
  return nueva;
}

// ---------- Bloqueos ----------

/**
 * @param {object} datos { rol, consultorios: number[], fecha, horaInicio?, horaFin?, diaCompleto?, ahora }
 *   consultorio 0 = todos los consultorios.
 * SUPUESTO (a confirmar): "día completo" usa el horario real de ese día (sábados hasta las 16:00),
 * en vez del 08:00 a 21:00 fijo de Espacia.
 */
function validarBloqueo(reglas, datos) {
  const { rol, consultorios, fecha, horaInicio, horaFin, diaCompleto, ahora } = datos;

  if (!esRolValido(rol)) return error('ROL_INVALIDO', 'Rol no reconocido.', 403);
  if (!esAdministrativo(rol)) return error('NO_PUEDE_BLOQUEAR', 'No tiene permiso para bloquear horarios.', 403);
  if (!fechaValida(fecha)) return error('FECHA_INVALIDA', 'La fecha no es válida.');

  const horario = horarioDelDia(reglas, fecha);
  if (!horario) return error('DIA_NO_LABORAL', 'Ese día no hay atención.');

  if (!Array.isArray(consultorios) || consultorios.length === 0) {
    return error('CONSULTORIO_INVALIDO', 'Debe indicar al menos un consultorio.');
  }
  const validos = consultorios.every(
    (c) => Number.isInteger(c) && c >= 0 && c <= reglas.espacios.cantidad
  );
  if (!validos) return error('CONSULTORIO_INVALIDO', 'Algún consultorio indicado no existe.');
  const normalizados = consultorios.includes(0) ? [0] : [...new Set(consultorios)];

  let inicio = horario.inicio;
  let fin = horario.fin;
  if (!diaCompleto) {
    inicio = horaAMinutos(horaInicio);
    fin = horaAMinutos(horaFin);
    if (inicio === null || fin === null) return error('HORA_INVALIDA', 'El rango horario no es válido.');
    if (inicio >= fin) return error('RANGO_INVALIDO', 'La hora de inicio debe ser anterior a la de fin.');
    if (inicio < horario.inicio || fin > horario.fin) {
      return error('FUERA_DE_HORARIO', 'El rango está fuera del horario de atención.');
    }
  }

  const fechaPermitida = validarFechaPermitida(reglas, rol, fecha, inicio, ahora);
  if (!fechaPermitida.ok) return fechaPermitida;

  return { ok: true, consultorios: normalizados, fecha, inicioMin: inicio, finMin: fin };
}

// ---------- Superposición con eventos existentes ----------

/**
 * Devuelve los eventos que chocan con el horario pedido.
 * evento = { consultorio: number, fecha, inicioMin, finMin, cancelada: boolean }
 * Las reservas canceladas no cuentan.
 * SUPUESTO (a confirmar): un bloqueo de "todos" (consultorio 0) choca con cualquier consultorio,
 * y pedir "todos" choca con cualquier evento del día.
 */
function haySuperposicion(eventos, { consultorio, fecha, inicioMin, finMin }) {
  return eventos.filter((e) => {
    if (e.cancelada || e.fecha !== fecha) return false;
    const mismoEspacio = e.consultorio === consultorio || e.consultorio === 0 || consultorio === 0;
    return mismoEspacio && e.inicioMin < finMin && inicioMin < e.finMin;
  });
}

module.exports = {
  fechaValida,
  sumarDias,
  diaDeSemana,
  horaAMinutos,
  minutosAHora,
  ahoraLocal,
  horarioDelDia,
  validarNuevaReserva,
  validarCancelacion,
  validarMovimiento,
  validarBloqueo,
  haySuperposicion,
};
