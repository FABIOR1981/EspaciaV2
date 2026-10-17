'use strict';
// POST /api/ingresar  { usuario, clave }  ->  { token, sesion, espHabil, requiereCambioPass, venceEnSegundos }
const { crearManejador, responder, responderError } = require('./nucleo/http');
const { dependenciasPorDefecto } = require('./nucleo/dependencias');
const { autenticar } = require('./nucleo/usuarios_servicio');
const { crearToken, duracionDeSesion } = require('./nucleo/sesion');

exports.crearHandler = (dependencias) =>
  crearManejador({
    publico: true,
    dependencias,
    metodos: {
      POST: async ({ deps, cuerpo, instante, ahora }) => {
        const r = await autenticar({ reglas: deps.reglas, almacen: deps.almacen, id: cuerpo.usuario, clave: cuerpo.clave, ahora });
        if (!r.ok) return responderError(r);
        const duracionSegundos = duracionDeSesion(deps.reglas, r.sesion.rol);
        const token = crearToken(r.sesion, deps.config.sesion.secreto, {
          duracionSegundos,
          ahoraSegundos: Math.floor(instante.getTime() / 1000),
        });
        return responder(200, {
          token,
          sesion: r.sesion,
          espHabil: r.espHabil,
          requiereCambioPass: r.requiereCambioPass,
          venceEnSegundos: duracionSegundos,
        });
      },
    },
  });

exports.handler = exports.crearHandler(dependenciasPorDefecto);
