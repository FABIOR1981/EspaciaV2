'use strict';
/**
 * Configuración de EspaciaV2: único lugar que conoce los nombres de las variables de Netlify.
 *
 * Convención: ESPACIAV2_<SERVICIO>_<DATO>. El servicio dice a qué sistema afecta:
 *   GOOGLE  -> Google Calendar        GITHUB -> repositorio con la base de datos
 *
 * Si falta alguna variable obligatoria, se indica CUÁL falta por nombre (nunca su valor)
 * y la función responde 500 (error de configuración del servidor), no 401.
 */

const OBLIGATORIAS = [
  'ESPACIAV2_MODO',
  'ESPACIAV2_SESION_SECRETO',
  'ESPACIAV2_GOOGLE_CUENTA_EMAIL',
  'ESPACIAV2_GOOGLE_CLAVE_PRIVADA',
  'ESPACIAV2_GITHUB_TOKEN',
  'ESPACIAV2_GITHUB_REPO',
  'ESPACIAV2_GITHUB_RUTA_USUARIOS',
];

const MODOS = ['produccion', 'pruebas'];
const LARGO_MINIMO_SECRETO = 32;

class ConfiguracionIncompleta extends Error {
  constructor(problemas) {
    super(`Configuración incompleta: ${problemas.join('; ')}`);
    this.name = 'ConfiguracionIncompleta';
    this.problemas = problemas;
    this.estado = 500;
  }
}

/** Acepta la clave privada de Google con \n literales y/o entre comillas (como se pega en Netlify). */
function normalizarClavePrivada(valor) {
  let clave = String(valor).trim();
  if (clave.startsWith('"') && clave.endsWith('"')) clave = clave.slice(1, -1);
  return clave.replace(/\\n/g, '\n');
}

function vacia(valor) {
  return valor === undefined || valor === null || String(valor).trim() === '';
}

/**
 * @param {object} env variables de entorno (por defecto, process.env)
 * @returns {object} configuración validada y congelada
 * @throws {ConfiguracionIncompleta}
 */
function cargarConfiguracion(env = process.env) {
  const problemas = [];

  for (const nombre of OBLIGATORIAS) {
    if (vacia(env[nombre])) problemas.push(`falta ${nombre}`);
  }

  const modo = vacia(env.ESPACIAV2_MODO) ? null : String(env.ESPACIAV2_MODO).trim();
  if (modo && !MODOS.includes(modo)) {
    problemas.push(`ESPACIAV2_MODO debe ser "produccion" o "pruebas"`);
  }

  const idCalendario =
    modo === 'pruebas' ? env.ESPACIAV2_GOOGLE_CALENDARIO_PRUEBAS_ID : env.ESPACIAV2_GOOGLE_CALENDARIO_ID;
  if (modo && MODOS.includes(modo) && vacia(idCalendario)) {
    problemas.push(
      modo === 'pruebas' ? 'falta ESPACIAV2_GOOGLE_CALENDARIO_PRUEBAS_ID' : 'falta ESPACIAV2_GOOGLE_CALENDARIO_ID'
    );
  }

  const secreto = env.ESPACIAV2_SESION_SECRETO;
  if (!vacia(secreto) && String(secreto).length < LARGO_MINIMO_SECRETO) {
    problemas.push(`ESPACIAV2_SESION_SECRETO debe tener al menos ${LARGO_MINIMO_SECRETO} caracteres`);
  }

  if (problemas.length > 0) throw new ConfiguracionIncompleta(problemas);

  return Object.freeze({
    modo,
    zonaHoraria: vacia(env.ESPACIAV2_ZONA_HORARIA) ? 'America/Montevideo' : env.ESPACIAV2_ZONA_HORARIA.trim(),
    notificarInvitados: String(env.ESPACIAV2_NOTIFICAR_INVITADOS || 'false').trim().toLowerCase() === 'true',
    sesion: Object.freeze({ secreto }),
    google: Object.freeze({
      cuentaEmail: env.ESPACIAV2_GOOGLE_CUENTA_EMAIL.trim(),
      clavePrivada: normalizarClavePrivada(env.ESPACIAV2_GOOGLE_CLAVE_PRIVADA),
      calendarioId: String(idCalendario).trim(),
    }),
    github: Object.freeze({
      token: env.ESPACIAV2_GITHUB_TOKEN.trim(),
      repo: env.ESPACIAV2_GITHUB_REPO.trim(),
      rama: vacia(env.ESPACIAV2_GITHUB_RAMA) ? 'main' : env.ESPACIAV2_GITHUB_RAMA.trim(),
      rutaUsuarios: env.ESPACIAV2_GITHUB_RUTA_USUARIOS.trim(),
    }),
  });
}

/** Respuesta HTTP para una función de Netlify cuando la configuración está incompleta. */
function respuestaDeConfiguracionIncompleta(errorConfig) {
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'Error de configuración del servidor.',
      detalle: errorConfig.problemas,
    }),
  };
}

module.exports = {
  OBLIGATORIAS,
  ConfiguracionIncompleta,
  normalizarClavePrivada,
  cargarConfiguracion,
  respuestaDeConfiguracionIncompleta,
};
