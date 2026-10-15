'use strict';
// POST /api/bloqueos  { consultorios: [0|1..5], fecha, horaInicio?, horaFin?, diaCompleto?, observacion? }  (admin y gestor)
// Para deshacer un bloqueo se usa DELETE /api/reservas?id=...
const { crearManejador, responder, responderError } = require('./nucleo/http');
const { dependenciasPorDefecto } = require('./nucleo/dependencias');
const { crearBloqueo } = require('./nucleo/reservas_servicio');
const { reservaParaSesion } = require('./nucleo/vistas_reservas');

exports.crearHandler = (dependencias) =>
  crearManejador({
    dependencias,
    metodos: {
      POST: async ({ deps, sesion, ahora, cuerpo }) => {
        const r = await crearBloqueo({
          reglas: deps.reglas,
          repo: deps.repo,
          sesion,
          entrada: {
            consultorios: cuerpo.consultorios,
            fecha: cuerpo.fecha,
            horaInicio: cuerpo.horaInicio,
            horaFin: cuerpo.horaFin,
            diaCompleto: cuerpo.diaCompleto === true,
            observacion: typeof cuerpo.observacion === 'string' ? cuerpo.observacion.trim().slice(0, 100) : '',
          },
          ahora,
        });
        return r.ok ? responder(201, { reservas: r.reservas.map((x) => reservaParaSesion(x, sesion)) }) : responderError(r);
      },
    },
  });

exports.handler = exports.crearHandler(dependenciasPorDefecto);
