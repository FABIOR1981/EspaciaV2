'use strict';
/**
 * Sesión de EspaciaV2: token firmado (HS256) con vencimiento.
 * Solo usa la librería estándar de Node (sin dependencias). Lógica pura: sin red.
 *
 * - Solo se acepta el algoritmo HS256 (se rechaza "none" y cualquier otro).
 * - La firma se compara en tiempo constante.
 * - El "ahora" se pasa por parámetro para poder probar el vencimiento.
 *
 * Contenido del token: { sub: id, nombre, rol, iat, exp }.
 */

const crypto = require('node:crypto');

const ENCABEZADO = { alg: 'HS256', typ: 'JWT' };

function aBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function firmar(texto, secreto) {
  return crypto.createHmac('sha256', secreto).update(texto).digest();
}

/** Convierte "4h", "30m" o "90s" en segundos. */
function duracionASegundos(texto) {
  const m = /^(\d+)\s*([smh])$/.exec(String(texto).trim());
  if (!m) throw new Error(`Duración de sesión no válida: ${texto}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}

function duracionDeSesion(reglas, rol) {
  const admin = rol === 'admin' || rol === 'gestor';
  return duracionASegundos(admin ? reglas.sesion.duracionAdministrativo : reglas.sesion.duracionUsuario);
}

/**
 * @param {{id: string, nombre: string, rol: string}} sesion
 * @param {string} secreto
 * @param {{duracionSegundos: number, ahoraSegundos?: number}} opciones
 */
function crearToken(sesion, secreto, { duracionSegundos, ahoraSegundos = Math.floor(Date.now() / 1000) }) {
  const cuerpo = { sub: sesion.id, nombre: sesion.nombre, rol: sesion.rol, iat: ahoraSegundos, exp: ahoraSegundos + duracionSegundos };
  const texto = `${aBase64Url(JSON.stringify(ENCABEZADO))}.${aBase64Url(JSON.stringify(cuerpo))}`;
  return `${texto}.${aBase64Url(firmar(texto, secreto))}`;
}

/** @returns {{ok: true, sesion: {id, nombre, rol}} | {ok: false, codigo: string, estado: 401}} */
function verificarToken(token, secreto, { ahoraSegundos = Math.floor(Date.now() / 1000) } = {}) {
  const invalido = { ok: false, codigo: 'TOKEN_INVALIDO', estado: 401 };
  if (typeof token !== 'string') return invalido;
  const partes = token.split('.');
  if (partes.length !== 3) return invalido;

  let encabezado;
  let cuerpo;
  try {
    encabezado = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf-8'));
    cuerpo = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf-8'));
  } catch {
    return invalido;
  }
  if (!encabezado || encabezado.alg !== 'HS256') return invalido;

  const esperada = firmar(`${partes[0]}.${partes[1]}`, secreto);
  const recibida = Buffer.from(partes[2], 'base64url');
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return invalido;

  if (!cuerpo || typeof cuerpo.exp !== 'number' || !cuerpo.sub || !cuerpo.rol) return invalido;
  if (ahoraSegundos >= cuerpo.exp) return { ok: false, codigo: 'TOKEN_VENCIDO', estado: 401 };

  return { ok: true, sesion: { id: cuerpo.sub, nombre: cuerpo.nombre, rol: cuerpo.rol } };
}

/** Extrae el token del encabezado "Authorization: Bearer <token>" (sin distinguir mayúsculas en el nombre). */
function extraerToken(encabezados = {}) {
  const clave = Object.keys(encabezados).find((k) => k.toLowerCase() === 'authorization');
  const valor = clave ? String(encabezados[clave]) : '';
  const m = /^Bearer\s+(\S+)$/i.exec(valor.trim());
  return m ? m[1] : null;
}

module.exports = { duracionASegundos, duracionDeSesion, crearToken, verificarToken, extraerToken };
