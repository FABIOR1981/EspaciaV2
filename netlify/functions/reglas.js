'use strict';
// GET /api/reglas  (público): horarios, días, duraciones y plazos. El navegador las usa solo para mostrar mejor;
// el servidor las hace cumplir igual.
const { crearManejador, responder } = require('./nucleo/http');
const { dependenciasPorDefecto } = require('./nucleo/dependencias');

exports.crearHandler = (dependencias) =>
  crearManejador({
    publico: true,
    dependencias,
    metodos: {
      GET: async ({ deps }) => responder(200, deps.reglas, { 'Cache-Control': 'public, max-age=300' }),
    },
  });

exports.handler = exports.crearHandler(dependenciasPorDefecto);
