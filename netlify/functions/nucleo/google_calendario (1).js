'use strict';
/**
 * Único módulo de EspaciaV2 que habla con Google Calendar.
 *
 * - Traduce entre eventos de Google y "reservas" (el modelo de EspaciaV2).
 * - Lee también los eventos antiguos de Espacia (titular guardado como email).
 * - Recibe el cliente de Google por parámetro, por eso se prueba sin red.
 *
 * Una reserva es: { id, consultorio, fecha, inicioMin, finMin, titularId, titularNombre,
 *                   creadaPor, tipo: 'reserva' | 'bloqueo', observacion, cancelada,
 *                   canceladaPor, creadoEn }
 * consultorio 0 = todos los consultorios (bloqueo total).
 */

const { ahoraLocal, minutosAHora } = require('./reglas_de_negocio');

const COLOR_BLOQUEO = '11';
const COLOR_CANCELADA = '8';
const PREFIJO_CANCELADA = 'Cancelada - ';
const ALCANCE_CALENDARIO = 'https://www.googleapis.com/auth/calendar';

/** Crea el cliente real de Google (la librería se carga recién acá, así las pruebas no la necesitan). */
function crearClienteGoogle(configGoogle) {
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: configGoogle.cuentaEmail,
    key: configGoogle.clavePrivada,
    scopes: [ALCANCE_CALENDARIO],
  });
  return google.calendar({ version: 'v3', auth });
}

// ---------- Traducción evento de Google -> reserva ----------

function titularDesdeEvento(evento) {
  const privadas = (evento.extendedProperties && evento.extendedProperties.private) || {};
  if (privadas.titularId) return privadas.titularId;
  // Eventos de Espacia: el titular está guardado como email (nomUsu@dominio).
  const email = privadas.userEmail || ((evento.description || '').match(/Email:\s*(\S+@\S+)/i) || [])[1];
  return email ? String(email).split('@')[0] : null;
}

function nombreDesdeTitulo(tituloSinPrefijo) {
  const m = /^C\d+:\s*(.*)$/.exec(tituloSinPrefijo);
  return m ? m[1].trim() : tituloSinPrefijo.trim();
}

/**
 * @returns {object|null} la reserva, o null si el evento no es una reserva de Espacia
 *   (sin prefijo C<n>:, o de día completo).
 */
function eventoAReserva(evento, zonaHoraria) {
  if (!evento || !evento.start || !evento.start.dateTime || !evento.end || !evento.end.dateTime) return null;

  const titulo = evento.summary || '';
  const cancelada = titulo.startsWith(PREFIJO_CANCELADA);
  const sinPrefijo = cancelada ? titulo.slice(PREFIJO_CANCELADA.length) : titulo;
  const m = /^C(\d+):/.exec(sinPrefijo);
  if (!m) return null;

  const inicio = ahoraLocal(zonaHoraria, new Date(evento.start.dateTime));
  const fin = ahoraLocal(zonaHoraria, new Date(evento.end.dateTime));
  const privadas = (evento.extendedProperties && evento.extendedProperties.private) || {};
  const finMin = fin.fecha === inicio.fecha ? fin.minutos : 24 * 60;

  return {
    id: evento.id,
    consultorio: Number(m[1]),
    fecha: inicio.fecha,
    inicioMin: inicio.minutos,
    finMin,
    titularId: titularDesdeEvento(evento),
    titularNombre: nombreDesdeTitulo(sinPrefijo),
    creadaPor: privadas.creadaPor || null,
    tipo: privadas.tipo === 'bloqueo' || /^C\d+:\s*Bloqueada/i.test(sinPrefijo) ? 'bloqueo' : 'reserva',
    observacion: privadas.observacion || '',
    cancelada,
    canceladaPor: privadas.canceladaPor || null,
    creadoEn: evento.created || null,
  };
}

// ---------- Traducción reserva -> evento de Google ----------

function reservaAEvento(reserva, zonaHoraria) {
  const esBloqueo = reserva.tipo === 'bloqueo';
  const nombre = esBloqueo
    ? `Bloqueada${reserva.observacion ? `-${reserva.observacion}` : ''}`
    : reserva.titularNombre;

  const descripcion = [
    esBloqueo ? 'Horario bloqueado' : `Reserva para: ${reserva.titularNombre}`,
    `Consultorio: ${reserva.consultorio === 0 ? 'Todos' : reserva.consultorio}`,
    `Fecha: ${reserva.fecha}`,
    `Hora: ${minutosAHora(reserva.inicioMin)} a ${minutosAHora(reserva.finMin)}`,
    `Realizada por: ${reserva.creadaPor}`,
  ].join('\n');

  const evento = {
    summary: `C${reserva.consultorio}: ${nombre}`,
    description: descripcion,
    start: { dateTime: `${reserva.fecha}T${minutosAHora(reserva.inicioMin)}:00`, timeZone: zonaHoraria },
    end: { dateTime: `${reserva.fecha}T${minutosAHora(reserva.finMin)}:00`, timeZone: zonaHoraria },
    extendedProperties: {
      private: {
        espaciaV2: '1',
        tipo: reserva.tipo,
        titularId: reserva.titularId || '',
        creadaPor: reserva.creadaPor || '',
        observacion: reserva.observacion || '',
      },
    },
  };
  if (esBloqueo) evento.colorId = COLOR_BLOQUEO;
  return evento;
}

// ---------- Repositorio de reservas sobre un calendario ----------

/**
 * @param {object} calendario cliente de Google Calendar v3 (o una simulación con la misma forma)
 * @param {{calendarioId: string}} configGoogle
 * @param {{zonaHoraria: string, notificarInvitados: boolean}} opciones
 */
function crearRepositorioDeReservas(calendario, configGoogle, opciones) {
  const { zonaHoraria, notificarInvitados } = opciones;
  const calendarId = configGoogle.calendarioId;

  /**
   * Todas las reservas (activas y canceladas) entre dos días locales 'AAAA-MM-DD', ambos inclusive.
   * Recorre todas las páginas de resultados de Google.
   */
  async function listarRango(fechaDesde, fechaHasta) {
    // Ventana amplia en UTC; después se filtra por el día local. No depende de la zona horaria.
    const dia = 24 * 3600 * 1000;
    const timeMin = new Date(Date.parse(`${fechaDesde}T00:00:00Z`) - dia).toISOString();
    const timeMax = new Date(Date.parse(`${fechaHasta}T00:00:00Z`) + 2 * dia).toISOString();

    const reservas = [];
    let pageToken;
    do {
      const respuesta = await calendario.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 500,
        pageToken,
      });
      for (const evento of respuesta.data.items || []) {
        const reserva = eventoAReserva(evento, zonaHoraria);
        if (reserva && reserva.fecha >= fechaDesde && reserva.fecha <= fechaHasta) reservas.push(reserva);
      }
      pageToken = respuesta.data.nextPageToken;
    } while (pageToken);
    return reservas;
  }

  /** Todas las reservas (activas y canceladas) de un día local 'AAAA-MM-DD'. */
  function listarDia(fecha) {
    return listarRango(fecha, fecha);
  }

  async function obtener(id) {
    try {
      const respuesta = await calendario.events.get({ calendarId, eventId: id });
      return eventoAReserva(respuesta.data, zonaHoraria);
    } catch (e) {
      if (e && (e.code === 404 || e.status === 404)) return null;
      throw e;
    }
  }

  async function crear(reserva) {
    const respuesta = await calendario.events.insert({
      calendarId,
      requestBody: reservaAEvento(reserva, zonaHoraria),
      sendUpdates: notificarInvitados ? 'all' : 'none',
    });
    return eventoAReserva(respuesta.data, zonaHoraria);
  }

  /** Marca la reserva como cancelada (no la borra: se conserva para informes). */
  async function cancelar(id, canceladaPorNombre, instante = new Date()) {
    const actual = await calendario.events.get({ calendarId, eventId: id });
    const evento = actual.data;
    if ((evento.summary || '').startsWith(PREFIJO_CANCELADA)) return eventoAReserva(evento, zonaHoraria);
    const privadas = (evento.extendedProperties && evento.extendedProperties.private) || {};
    const respuesta = await calendario.events.patch({
      calendarId,
      eventId: id,
      requestBody: {
        summary: `${PREFIJO_CANCELADA}${evento.summary}`,
        colorId: COLOR_CANCELADA,
        description: `${evento.description || ''}\nCancelada por: ${canceladaPorNombre} el ${instante.toISOString()}`,
        extendedProperties: { private: { ...privadas, canceladaPor: canceladaPorNombre } },
      },
      sendUpdates: 'none',
    });
    return eventoAReserva(respuesta.data, zonaHoraria);
  }

  /** Borra un evento. Se usa solo para deshacer una creación fallida, nunca para cancelar. */
  async function eliminar(id) {
    await calendario.events.delete({ calendarId, eventId: id, sendUpdates: 'none' });
  }

  return { listarDia, listarRango, obtener, crear, cancelar, eliminar };
}

module.exports = {
  crearClienteGoogle,
  eventoAReserva,
  reservaAEvento,
  crearRepositorioDeReservas,
  PREFIJO_CANCELADA,
};
