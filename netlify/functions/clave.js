'use strict';
// POST /api/clave  { claveActual, claveNueva }   (única ruta permitida mientras deba cambiar su clave)
const { crearManejador, responder, responderError } = require('./nucleo/http');
const { dependenciasPorDefecto } = require('./nucleo/dependencias');
const { cambiarMiClave } = require('./nucleo/usuarios_servicio');

exports.crearHandler = (dependencias) =>
  crearManejador({
    permiteConCambioClave: true,
    dependencias,
    metodos: {
      POST: async ({ deps, sesion, cuerpo }) => {
        const r = await cambiarMiClave({
          almacen: deps.almacen,
          sesion,
          claveActual: cuerpo.claveActual,
          claveNueva: cuerpo.claveNueva,
        });
        return r.ok ? responder(200, { ok: true }) : responderError(r);
      },
    },
  });

exports.handler = exports.crearHandler(dependenciasPorDefecto);
