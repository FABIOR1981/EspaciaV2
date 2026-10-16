'use strict';
/**
 * Contraseñas de EspaciaV2.
 *
 * - Guardado: scrypt con sal aleatoria propia de cada usuario (formato "scrypt$N$r$p$sal$hash").
 * - El navegador envía la clave tal cual (por HTTPS); solo el servidor calcula el hash.
 * - Compatibilidad con Espacia: acepta el hash antiguo (SHA-256 sin sal) UNA vez; en cuanto el
 *   usuario entra bien, quien llama debe reemplazarlo por el nuevo (necesitaActualizar = true).
 * - Lógica pura: no usa red.
 */

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const PARAMETROS = { N: 16384, r: 8, p: 1, largoClave: 32, largoSal: 16 };
const LARGO_MINIMO = 8;
const LARGO_MAXIMO = 128; // evita que alguien mande claves enormes para gastar recursos
const ALFABETO_TEMPORAL = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // sin 0/O, 1/l/I

function sha256Hex(texto) {
  return crypto.createHash('sha256').update(texto, 'utf-8').digest('hex');
}

function esHashAntiguo(almacenado) {
  return typeof almacenado === 'string' && /^[0-9a-f]{64}$/i.test(almacenado);
}

function igualesEnTiempoConstante(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function generarHash(clave) {
  const sal = crypto.randomBytes(PARAMETROS.largoSal);
  const hash = await scrypt(clave, sal, PARAMETROS.largoClave, { N: PARAMETROS.N, r: PARAMETROS.r, p: PARAMETROS.p });
  return ['scrypt', PARAMETROS.N, PARAMETROS.r, PARAMETROS.p, sal.toString('base64'), hash.toString('base64')].join('$');
}

/** @returns {Promise<{ok: boolean, necesitaActualizar: boolean}>} */
async function verificarClave(clave, almacenado) {
  if (typeof clave !== 'string' || clave.length === 0 || clave.length > LARGO_MAXIMO || typeof almacenado !== 'string') {
    return { ok: false, necesitaActualizar: false };
  }

  if (esHashAntiguo(almacenado)) {
    const ok = igualesEnTiempoConstante(sha256Hex(clave), almacenado.toLowerCase());
    return { ok, necesitaActualizar: ok };
  }

  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return { ok: false, necesitaActualizar: false };
  const [, N, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = await scrypt(clave, Buffer.from(salB64, 'base64'), esperado.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  const ok = crypto.timingSafeEqual(calculado, esperado);
  const parametrosViejos = Number(N) !== PARAMETROS.N || Number(r) !== PARAMETROS.r || Number(p) !== PARAMETROS.p;
  return { ok, necesitaActualizar: ok && parametrosViejos };
}

/**
 * Hace el mismo trabajo que una verificación real. Se usa cuando el usuario no existe, para que
 * el tiempo de respuesta no revele si el usuario existe o no.
 */
async function verificacionFalsa(clave) {
  await scrypt(String(clave || ''), Buffer.alloc(PARAMETROS.largoSal), PARAMETROS.largoClave, {
    N: PARAMETROS.N,
    r: PARAMETROS.r,
    p: PARAMETROS.p,
  });
  return { ok: false, necesitaActualizar: false };
}

/** SUPUESTO (a confirmar): mínimo 8 caracteres, máximo 128, sin otras exigencias. */
function validarFortalezaClave(clave) {
  if (typeof clave !== 'string' || clave.length < LARGO_MINIMO) {
    return { ok: false, codigo: 'CLAVE_MUY_CORTA', mensaje: `La clave debe tener al menos ${LARGO_MINIMO} caracteres.` };
  }
  if (clave.length > LARGO_MAXIMO) {
    return { ok: false, codigo: 'CLAVE_MUY_LARGA', mensaje: `La clave no puede superar ${LARGO_MAXIMO} caracteres.` };
  }
  return { ok: true };
}

/** Clave temporal aleatoria (para altas y reinicios), sin caracteres que se confundan al leerlos. */
function generarClaveTemporal(largo = 12) {
  let clave = '';
  for (let i = 0; i < largo; i += 1) clave += ALFABETO_TEMPORAL[crypto.randomInt(ALFABETO_TEMPORAL.length)];
  return clave;
}

/**
 * Clave inicial simple de los usuarios comunes: su identificador + 1234567 (la misma construcción que usaba Espacia).
 * Es predecible a propósito (para personas que lo necesitan fácil), por eso VENCE (ver reglas.claveInicial) y solo
 * se usa con el perfil "usuario"; gestión y administración reciben una clave aleatoria.
 */
const SUFIJO_CLAVE_INICIAL = '1234567';
function claveInicialSimple(id) {
  return `${id}${SUFIJO_CLAVE_INICIAL}`;
}

module.exports = {
  claveInicialSimple,
  LARGO_MINIMO,
  LARGO_MAXIMO,
  sha256Hex,
  esHashAntiguo,
  generarHash,
  verificarClave,
  verificacionFalsa,
  validarFortalezaClave,
  generarClaveTemporal,
};
