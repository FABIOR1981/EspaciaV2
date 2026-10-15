'use strict';
/**
 * Único módulo de EspaciaV2 que habla con GitHub (la base de datos de usuarios).
 *
 * Formato del archivo de usuarios:  { "version": 1, "usuarios": [ { id, nombre, rol, ... } ] }
 *
 * Seguridad contra pisadas: GitHub exige el "sha" de la versión que se está reemplazando.
 * Si otra persona guardó mientras tanto, GitHub rechaza la escritura (conflicto) y
 * actualizarUsuarios vuelve a leer y a aplicar el cambio. Nunca se pierde una modificación ajena.
 *
 * Los errores no incluyen jamás el token.
 */

const URL_BASE = 'https://api.github.com';

class ErrorGitHub extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.name = 'ErrorGitHub';
    this.estado = estado;
  }
}

class ConflictoDeEscritura extends ErrorGitHub {
  constructor() {
    super('El archivo de usuarios cambió mientras se guardaba.', 409);
    this.name = 'ConflictoDeEscritura';
  }
}

function encabezados(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'espaciav2',
    'Content-Type': 'application/json',
  };
}

function urlDelArchivo(cfg) {
  const ruta = cfg.rutaUsuarios.split('/').map(encodeURIComponent).join('/');
  return `${URL_BASE}/repos/${cfg.repo}/contents/${ruta}`;
}

/** @returns {Promise<{usuarios: object[], sha: string|null}>} sha null si el archivo todavía no existe */
async function leerUsuarios(cfg, { fetchFn = fetch } = {}) {
  const respuesta = await fetchFn(`${urlDelArchivo(cfg)}?ref=${encodeURIComponent(cfg.rama)}`, {
    headers: encabezados(cfg.token),
  });
  if (respuesta.status === 404) return { usuarios: [], sha: null };
  if (!respuesta.ok) throw new ErrorGitHub(`GitHub respondió ${respuesta.status} al leer los usuarios.`, respuesta.status);

  const datos = await respuesta.json();
  const texto = Buffer.from(datos.content || '', 'base64').toString('utf-8');
  let contenido;
  try {
    contenido = JSON.parse(texto);
  } catch {
    throw new ErrorGitHub('El archivo de usuarios no tiene un JSON válido.', 500);
  }
  if (!contenido || !Array.isArray(contenido.usuarios)) {
    throw new ErrorGitHub('El archivo de usuarios no tiene el formato esperado.', 500);
  }
  return { usuarios: contenido.usuarios, sha: datos.sha };
}

async function guardarUsuarios(cfg, usuarios, sha, mensaje, { fetchFn = fetch } = {}) {
  const cuerpo = {
    message: mensaje,
    content: Buffer.from(JSON.stringify({ version: 1, usuarios }, null, 2), 'utf-8').toString('base64'),
    branch: cfg.rama,
  };
  if (sha) cuerpo.sha = sha;

  const respuesta = await fetchFn(urlDelArchivo(cfg), {
    method: 'PUT',
    headers: encabezados(cfg.token),
    body: JSON.stringify(cuerpo),
  });
  if (respuesta.status === 409 || respuesta.status === 422) throw new ConflictoDeEscritura();
  if (!respuesta.ok) throw new ErrorGitHub(`GitHub respondió ${respuesta.status} al guardar los usuarios.`, respuesta.status);
  const datos = await respuesta.json();
  return { sha: datos.content && datos.content.sha };
}

/**
 * Lee, aplica el cambio y guarda; si hubo conflicto, repite con los datos más recientes.
 * @param {(usuarios: object[]) => object[]} cambiar recibe la lista actual y devuelve la lista nueva
 *   (puede lanzar un error para abortar sin guardar).
 */
async function actualizarUsuarios(cfg, cambiar, mensaje, { fetchFn = fetch, intentos = 3 } = {}) {
  for (let intento = 1; intento <= intentos; intento += 1) {
    const { usuarios, sha } = await leerUsuarios(cfg, { fetchFn });
    const nuevos = cambiar(usuarios);
    try {
      await guardarUsuarios(cfg, nuevos, sha, mensaje, { fetchFn });
      return nuevos;
    } catch (e) {
      if (!(e instanceof ConflictoDeEscritura) || intento === intentos) throw e;
    }
  }
  throw new ConflictoDeEscritura();
}

/**
 * Almacén de usuarios con la forma que usa usuarios_servicio.js:
 *   leer() -> usuarios,   actualizar(cambiar, mensaje) -> usuarios nuevos
 */
function crearAlmacenDeUsuarios(cfg, opciones = {}) {
  return {
    leer: async () => (await leerUsuarios(cfg, opciones)).usuarios,
    actualizar: (cambiar, mensaje) => actualizarUsuarios(cfg, cambiar, mensaje, opciones),
  };
}

module.exports = {
  ErrorGitHub,
  ConflictoDeEscritura,
  leerUsuarios,
  guardarUsuarios,
  actualizarUsuarios,
  crearAlmacenDeUsuarios,
};
