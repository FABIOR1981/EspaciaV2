'use strict';
/**
 * Arma las dependencias reales de las funciones (configuración, reglas, GitHub y Google).
 * Se crean una sola vez por instancia de la función. Si la configuración está incompleta, no se
 * guarda el fallo: la próxima petición vuelve a intentarlo (por ejemplo, tras corregir una variable).
 */

const reglas = require('../../../compartido/reglas.json');
const { cargarConfiguracion } = require('./configuracion');
const { crearAlmacenDeUsuarios } = require('./github_usuarios');
const { crearClienteGoogle, crearRepositorioDeReservas } = require('./google_calendario');

async function crearDependencias(env = process.env) {
  const config = cargarConfiguracion(env);
  const calendario = crearClienteGoogle(config.google);
  return {
    config,
    reglas,
    almacen: crearAlmacenDeUsuarios(config.github),
    repo: crearRepositorioDeReservas(calendario, config.google, {
      zonaHoraria: config.zonaHoraria,
      notificarInvitados: config.notificarInvitados,
    }),
    reloj: () => new Date(),
  };
}

let guardadas = null;

function dependenciasPorDefecto() {
  if (!guardadas) {
    guardadas = crearDependencias().catch((e) => {
      guardadas = null;
      throw e;
    });
  }
  return guardadas;
}

module.exports = { crearDependencias, dependenciasPorDefecto };
