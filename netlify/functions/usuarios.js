'use strict';
/**
 * /api/usuarios   (admin y gestor)
 *   GET                                  lista (sin contraseñas)
 *   POST   { id, nombre, rol, espHabil? }       alta; devuelve la clave temporal UNA sola vez
 *   POST   ?id=...&accion=reiniciar-clave        reinicia la clave; devuelve la temporal UNA sola vez
 *   PATCH  ?id=...  { nombre?, rol?, espHabil?, activo? }
 */
const { crearManejador, responder, responderError } = require('./nucleo/http');
const { dependenciasPorDefecto } = require('./nucleo/dependencias');
const servicio = require('./nucleo/usuarios_servicio');

exports.crearHandler = (dependencias) =>
  crearManejador({
    dependencias,
    metodos: {
      GET: async ({ deps, sesion, ahora }) => {
        const r = await servicio.listarUsuarios({ reglas: deps.reglas, almacen: deps.almacen, sesion, ahora });
        return r.ok ? responder(200, { usuarios: r.usuarios }) : responderError(r);
      },

      POST: async ({ deps, sesion, params, cuerpo, ahora }) => {
        if (params.accion === 'reiniciar-clave') {
          if (!params.id) return responderError({ estado: 400, codigo: 'PARAMETROS_INVALIDOS', mensaje: 'Indique el "id" del usuario.' });
          const r = await servicio.reiniciarClave({ reglas: deps.reglas, almacen: deps.almacen, sesion, id: params.id, ahora });
          return r.ok ? responder(200, { claveTemporal: r.claveTemporal, venceEl: r.venceEl }) : responderError(r);
        }
        const r = await servicio.crearUsuario({
          reglas: deps.reglas,
          almacen: deps.almacen,
          sesion,
          datos: { id: cuerpo.id, nombre: cuerpo.nombre, rol: cuerpo.rol, espHabil: cuerpo.espHabil },
          ahora,
        });
        return r.ok ? responder(201, { usuario: r.usuario, claveTemporal: r.claveTemporal, venceEl: r.venceEl }) : responderError(r);
      },

      PATCH: async ({ deps, sesion, params, cuerpo, ahora }) => {
        if (!params.id) return responderError({ estado: 400, codigo: 'PARAMETROS_INVALIDOS', mensaje: 'Indique el "id" del usuario.' });
        const r = await servicio.editarUsuario({ reglas: deps.reglas, almacen: deps.almacen, sesion, id: params.id, cambios: cuerpo, ahora });
        return r.ok ? responder(200, { usuario: r.usuario }) : responderError(r);
      },
    },
  });

exports.handler = exports.crearHandler(dependenciasPorDefecto);
