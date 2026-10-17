'use strict';
/**
 * Google Calendar simulado en memoria, con la misma forma que usa google_calendario.js.
 * Solo para pruebas. Interpreta las horas locales como America/Montevideo (UTC-3).
 */
function crearCalendarioSimulado() {
  const eventos = new Map();
  const llamadas = [];
  let contador = 0;
  let segundos = 0;

  const aISO = (momento) => `${momento.dateTime}-03:00`;

  const events = {
    async list({ timeMin, timeMax }) {
      const items = [...eventos.values()].filter(
        (e) => Date.parse(e.start.dateTime) < Date.parse(timeMax) && Date.parse(e.end.dateTime) > Date.parse(timeMin)
      );
      return { data: { items: structuredClone(items) } };
    },
    async get({ eventId }) {
      if (!eventos.has(eventId)) throw Object.assign(new Error('No encontrado'), { code: 404 });
      return { data: structuredClone(eventos.get(eventId)) };
    },
    async insert({ requestBody, sendUpdates }) {
      llamadas.push({ tipo: 'insert', sendUpdates });
      contador += 1;
      const evento = structuredClone(requestBody);
      evento.id = `ev${String(contador).padStart(3, '0')}`;
      evento.start = { dateTime: aISO(requestBody.start) };
      evento.end = { dateTime: aISO(requestBody.end) };
      evento.created = new Date(Date.UTC(2026, 9, 15, 12, 0, segundos)).toISOString();
      evento.updated = evento.created;
      segundos += 1;
      eventos.set(evento.id, evento);
      return { data: structuredClone(evento) };
    },
    async patch({ eventId, requestBody }) {
      llamadas.push({ tipo: 'patch' });
      const evento = eventos.get(eventId);
      const cambios = structuredClone(requestBody);
      if (cambios.start) cambios.start = { dateTime: aISO(cambios.start) };
      if (cambios.end) cambios.end = { dateTime: aISO(cambios.end) };
      Object.assign(evento, cambios);
      evento.updated = new Date(Date.UTC(2026, 9, 15, 12, 0, segundos)).toISOString();
      segundos += 1;
      return { data: structuredClone(evento) };
    },
    async delete({ eventId }) {
      llamadas.push({ tipo: 'delete' });
      eventos.delete(eventId);
    },
  };

  return { eventos, llamadas, events };
}

module.exports = { crearCalendarioSimulado };
