'use strict';
/**
 * Capa HTTP común de las funciones de EspaciaV2.
 *
 * Cada petición protegida pasa por el mismo recorrido:
 *   1. método permitido  2. token firmado y vigente  3. el usuario sigue activo en el archivo de usuarios
 *   (se usa el ROL ACTUAL del archivo, no el del token: una baja o un cambio de rol rigen de inmediato)
 *   4. si debe cambiar su clave, solo puede usar la ruta de cambio de clave  5. cuerpo JSON acotado.
 *
 * Los errores inesperados se registran en el log del servidor y al navegador solo llega un mensaje genérico.
 */

const { extraerToken, verificarToken } = require('./sesion');
const { validarSesionContraUsuarios } = require('./usuarios_servicio');
const { ahoraLocal } = require('./reglas_de_negocio');
const { ConfiguracionIncompleta, respuestaDeConfiguracionIncompleta } = require('./configuracion');

const LIMITE_CUERPO_BYTES = 20000;

function responder(estado, cuerpo, extra = {}) {
  return {
    statusCode: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
    body: JSON.stringify(cuerpo),
  };
}

function responderError({ estado = 400, codigo, mensaje }) {
  return responder(estado, { error: { codigo, mensaje } });
}

function leerCuerpoJson(event) {
  const crudo = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf-8') : event.body || '';
  if (Buffer.byteLength(crudo, 'utf-8') > LIMITE_CUERPO_BYTES) {
    return { ok: false, error: { estado: 413, codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: 'La petición es demasiado grande.' } };
  }
  if (!crudo.trim()) return { ok: true, datos: {} };
  try {
    const datos = JSON.parse(crudo);
    if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('no es un objeto');
    return { ok: true, datos };
  } catch {
    return { ok: false, error: { estado: 400, codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo de la petición no es un JSON válido.' } };
  }
}

function responderErrorInterno(e) {
  if (e instanceof ConfiguracionIncompleta) {
    console.error(`Configuración incompleta: ${e.problemas.join('; ')}`);
    // El detalle (solo nombres de variables, nunca valores) se muestra únicamente en modo pruebas.
    if (process.env.ESPACIAV2_MODO === 'pruebas') return respuestaDeConfiguracionIncompleta(e);
  } else {
    console.error(`Error interno (${e && e.name}): ${e && e.message}`);
    // En modo pruebas se muestra el motivo para poder corregir la configuración; en producción, nunca.
    if (process.env.ESPACIAV2_MODO === 'pruebas') {
      return responder(500, {
        error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado.' },
        detalle: [`${e && e.name}: ${e && e.message}`],
      });
    }
  }
  return responderError({ estado: 500, codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado. Intente de nuevo más tarde.' });
}

/**
 * @param {object} opciones
 * @param {Record<string, Function>} opciones.metodos acciones por método HTTP
 * @param {boolean} [opciones.publico] no exige sesión (ingreso y reglas)
 * @param {boolean} [opciones.permiteConCambioClave] sigue funcionando aunque deba cambiar su clave
 * @param {() => Promise<object>} opciones.dependencias { config, reglas, almacen, repo, reloj }
 */
function crearManejador({ metodos, publico = false, permiteConCambioClave = false, dependencias }) {
  return async function manejador(event) {
    try {
      const metodo = String(event.httpMethod || '').toUpperCase();
      const accion = metodos[metodo];
      if (!accion) {
        return responder(405, { error: { codigo: 'METODO_NO_PERMITIDO', mensaje: 'Método no permitido.' } }, { Allow: Object.keys(metodos).join(', ') });
      }

      const deps = await dependencias();
      const instante = deps.reloj();
      const ahora = ahoraLocal(deps.config.zonaHoraria, instante);

      let sesion = null;
      if (!publico) {
        const token = extraerToken(event.headers);
        const verificado = verificarToken(token, deps.config.sesion.secreto, { ahoraSegundos: Math.floor(instante.getTime() / 1000) });
        if (!verificado.ok) {
          const vencido = verificado.codigo === 'TOKEN_VENCIDO';
          return responderError({
            estado: 401,
            codigo: verificado.codigo,
            mensaje: vencido ? 'La sesión venció. Vuelva a ingresar.' : 'Debe iniciar sesión.',
          });
        }
        const vigente = await validarSesionContraUsuarios({ almacen: deps.almacen, sesion: verificado.sesion });
        if (!vigente.ok) return responderError(vigente);
        if (vigente.requiereCambioPass && !permiteConCambioClave) {
          return responderError({ estado: 403, codigo: 'DEBE_CAMBIAR_CLAVE', mensaje: 'Debe cambiar su clave antes de continuar.' });
        }
        sesion = vigente.sesion;
      }

      let cuerpo = {};
      if (metodo !== 'GET' && metodo !== 'DELETE') {
        const lectura = leerCuerpoJson(event);
        if (!lectura.ok) return responderError(lectura.error);
        cuerpo = lectura.datos;
      }

      return await accion({ event, deps, sesion, ahora, instante, params: event.queryStringParameters || {}, cuerpo });
    } catch (e) {
      return responderErrorInterno(e);
    }
  };
}

module.exports = { responder, responderError, crearManejador, LIMITE_CUERPO_BYTES };
