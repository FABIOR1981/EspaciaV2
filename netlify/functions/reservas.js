'use strict';
/**
 * /api/reservas
 *   GET    ?fecha=AAAA-MM-DD                      grilla del día (los usuarios ven "Ocupado" en lo ajeno)
 *   GET    ?desde=...&hasta=...[&usuario=Id]       mis reservas (admin y gestor pueden pedir las de otra persona)
 *   GET    ?desde=...&hasta=...&todas=1             todas las reservas (solo admin y gestor)
 *   POST   { consultorio, fecha, hora, duracion, paraUsuario? }   crear
 *   PATCH  ?id=... { consultorio, fecha, hora, duracion }   mover (mismas reglas que cancelar sobre el horario original)
 *   DELETE ?id=...                                 cancelar
 */
const { crearManejador, responder, responderError } = require('./nucleo/http');
const { dependenciasPorDefecto } = require('./nucleo/dependencias');
const { crearReserva, cancelarReserva, moverReserva } = require('./nucleo/reservas_servicio');
const { listarDiaParaSesion, listarReservasDe, listarTodasLasReservas, reservaParaSesion } = require('./nucleo/vistas_reservas');
const { puedeReservarPara, mismoUsuario } = require('./nucleo/permisos');

const falta = (mensaje) => responderError({ estado: 400, codigo: 'PARAMETROS_INVALIDOS', mensaje });

exports.crearHandler = (dependencias) =>
  crearManejador({
    dependencias,
    metodos: {
      GET: async ({ deps, sesion, params }) => {
        let r;
        if (params.fecha) {
          r = await listarDiaParaSesion({ repo: deps.repo, sesion, fecha: params.fecha, incluirCanceladas: params.canceladas === '1' });
        } else if (params.desde && params.hasta && params.todas === '1') {
          r = await listarTodasLasReservas({ repo: deps.repo, sesion, desde: params.desde, hasta: params.hasta });
        } else if (params.desde && params.hasta) {
          r = await listarReservasDe({ repo: deps.repo, sesion, usuarioId: params.usuario, desde: params.desde, hasta: params.hasta });
        } else {
          return falta('Indique "fecha" o bien "desde" y "hasta".');
        }
        return r.ok ? responder(200, { reservas: r.reservas }) : responderError(r);
      },

      POST: async ({ deps, sesion, ahora, cuerpo }) => {
        let titular = { id: sesion.id, nombre: sesion.nombre };
        if (cuerpo.paraUsuario && !mismoUsuario(cuerpo.paraUsuario, sesion.id)) {
          if (!puedeReservarPara(sesion.rol, sesion.id, cuerpo.paraUsuario)) {
            return responderError({ estado: 403, codigo: 'NO_PUEDE_RESERVAR_PARA_OTRO', mensaje: 'Solo puede reservar a su nombre.' });
          }
          const usuarios = await deps.almacen.leer();
          const otro = usuarios.find((u) => mismoUsuario(u.id, cuerpo.paraUsuario) && u.activo);
          if (!otro) return responderError({ estado: 404, codigo: 'USUARIO_NO_ENCONTRADO', mensaje: 'El usuario indicado no existe o está inactivo.' });
          titular = { id: otro.id, nombre: otro.nombre };
        }
        const r = await crearReserva({
          reglas: deps.reglas,
          repo: deps.repo,
          sesion,
          titular,
          entrada: { consultorio: cuerpo.consultorio, fecha: cuerpo.fecha, hora: cuerpo.hora, duracion: cuerpo.duracion },
          ahora,
        });
        return r.ok ? responder(201, { reserva: reservaParaSesion(r.reserva, sesion) }) : responderError(r);
      },

      PATCH: async ({ deps, sesion, ahora, params, cuerpo }) => {
        if (!params.id) return falta('Indique el "id" de la reserva.');
        const r = await moverReserva({
          reglas: deps.reglas,
          repo: deps.repo,
          sesion,
          id: params.id,
          destino: { consultorio: cuerpo.consultorio, fecha: cuerpo.fecha, hora: cuerpo.hora, duracion: cuerpo.duracion },
          ahora,
        });
        return r.ok ? responder(200, { reserva: reservaParaSesion(r.reserva, sesion) }) : responderError(r);
      },

      DELETE: async ({ deps, sesion, ahora, instante, params }) => {
        if (!params.id) return falta('Indique el "id" de la reserva.');
        const r = await cancelarReserva({ reglas: deps.reglas, repo: deps.repo, sesion, id: params.id, ahora, instante });
        return r.ok ? responder(200, { reserva: reservaParaSesion(r.reserva, sesion), yaCancelada: Boolean(r.yaCancelada) }) : responderError(r);
      },
    },
  });

exports.handler = exports.crearHandler(dependenciasPorDefecto);
