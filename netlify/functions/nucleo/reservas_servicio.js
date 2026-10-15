'use strict';
/**
 * Casos de uso de EspaciaV2: crear reserva, cancelar reserva y crear bloqueos.
 *
 * Une las reglas de negocio con un "repositorio" de reservas (en producción es el de
 * google_calendario.js; en las pruebas, uno en memoria). Este archivo no habla con Google
 * ni con GitHub: recibe el repositorio por parámetro.
 *
 * sesion = { id, nombre, rol }  (viene del token de sesión ya verificado)
 * Todas las funciones devuelven { ok: true, ... } o { ok: false, codigo, mensaje, estado }.
 */

const {
  validarNuevaReserva,
  validarCancelacion,
  validarBloqueo,
  haySuperposicion,
  minutosAHora,
} = require('./reglas_de_negocio');
const { esAdministrativo } = require('./permisos');

function horarioOcupado() {
  return { ok: false, codigo: 'HORARIO_OCUPADO', mensaje: 'El horario ya está ocupado.', estado: 409 };
}

/** Desempate determinista: quién fue creado primero (por fecha de creación y, si empatan, por id). */
function llegoAntes(a, b) {
  if (a.creadoEn && b.creadoEn && a.creadoEn !== b.creadoEn) return a.creadoEn < b.creadoEn;
  return String(a.id) < String(b.id);
}

/**
 * Después de crear, vuelve a mirar el día: si otra persona reservó lo mismo casi al mismo tiempo,
 * se queda la que llegó primero y la otra se deshace. Evita reservas dobles por simultaneidad.
 * @returns {Promise<boolean>} true si la reserva se mantiene
 */
async function confirmarSinCarrera(repo, creada) {
  const otros = (await repo.listarDia(creada.fecha)).filter((e) => e.id !== creada.id);
  const anteriores = haySuperposicion(otros, creada).filter((otro) => llegoAntes(otro, creada));
  if (anteriores.length === 0) return true;
  await repo.eliminar(creada.id);
  return false;
}

async function crearReserva({ reglas, repo, sesion, titular, entrada, ahora }) {
  const validacion = validarNuevaReserva(reglas, {
    rol: sesion.rol,
    usuarioId: sesion.id,
    paraUsuarioId: titular.id,
    consultorio: entrada.consultorio,
    fecha: entrada.fecha,
    hora: entrada.hora,
    duracion: entrada.duracion,
    ahora,
  });
  if (!validacion.ok) return validacion;

  const existentes = await repo.listarDia(validacion.fecha);
  if (haySuperposicion(existentes, validacion).length > 0) return horarioOcupado();

  const creada = await repo.crear({
    consultorio: validacion.consultorio,
    fecha: validacion.fecha,
    inicioMin: validacion.inicioMin,
    finMin: validacion.finMin,
    titularId: titular.id,
    titularNombre: titular.nombre,
    creadaPor: sesion.nombre,
    tipo: 'reserva',
    observacion: '',
  });

  if (!(await confirmarSinCarrera(repo, creada))) return horarioOcupado();
  return { ok: true, reserva: creada };
}

async function cancelarReserva({ reglas, repo, sesion, id, ahora, instante = new Date() }) {
  const reserva = await repo.obtener(id);
  if (!reserva) return { ok: false, codigo: 'NO_ENCONTRADA', mensaje: 'La reserva no existe.', estado: 404 };

  if (reserva.tipo === 'bloqueo' && !esAdministrativo(sesion.rol)) {
    return { ok: false, codigo: 'NO_ES_SU_RESERVA', mensaje: 'No puede cancelar un bloqueo.', estado: 403 };
  }

  const validacion = validarCancelacion(reglas, {
    rol: sesion.rol,
    usuarioId: sesion.id,
    duenoId: reserva.titularId,
    fecha: reserva.fecha,
    hora: minutosAHora(reserva.inicioMin),
    ahora,
  });
  if (!validacion.ok) return validacion;

  if (reserva.cancelada) return { ok: true, reserva, yaCancelada: true };
  const cancelada = await repo.cancelar(id, sesion.nombre, instante);
  return { ok: true, reserva: cancelada };
}

/**
 * Crea uno o varios bloqueos de forma "todo o nada": si alguno choca o falla, no queda ninguno.
 */
async function crearBloqueo({ reglas, repo, sesion, entrada, ahora }) {
  const validacion = validarBloqueo(reglas, {
    rol: sesion.rol,
    consultorios: entrada.consultorios,
    fecha: entrada.fecha,
    horaInicio: entrada.horaInicio,
    horaFin: entrada.horaFin,
    diaCompleto: entrada.diaCompleto,
    ahora,
  });
  if (!validacion.ok) return validacion;

  const existentes = await repo.listarDia(validacion.fecha);
  for (const consultorio of validacion.consultorios) {
    const pedido = { consultorio, fecha: validacion.fecha, inicioMin: validacion.inicioMin, finMin: validacion.finMin };
    if (haySuperposicion(existentes, pedido).length > 0) return horarioOcupado();
  }

  const creados = [];
  const deshacer = async () => {
    for (const c of creados) await repo.eliminar(c.id);
  };

  try {
    for (const consultorio of validacion.consultorios) {
      const creado = await repo.crear({
        consultorio,
        fecha: validacion.fecha,
        inicioMin: validacion.inicioMin,
        finMin: validacion.finMin,
        titularId: sesion.id,
        titularNombre: 'Bloqueada',
        creadaPor: sesion.nombre,
        tipo: 'bloqueo',
        observacion: entrada.observacion || '',
      });
      creados.push(creado);
      if (!(await confirmarSinCarrera(repo, creado))) {
        creados.pop(); // confirmarSinCarrera ya eliminó este
        await deshacer();
        return horarioOcupado();
      }
    }
  } catch (e) {
    await deshacer();
    throw e;
  }

  return { ok: true, reservas: creados };
}

module.exports = { crearReserva, cancelarReserva, crearBloqueo };
