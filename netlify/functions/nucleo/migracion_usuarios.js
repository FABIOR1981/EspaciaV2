'use strict';
/**
 * Migración de usuarios de Espacia (objeto con claves "PROF-38") al formato de EspaciaV2
 * ({ version: 1, usuarios: [...] }). Lógica pura: recibe datos y devuelve datos.
 *
 * - El identificador pasa a ser el `nomUsu` (se conserva tal cual, con sus mayúsculas).
 * - Se descartan email, tipdocu y documento.
 * - La contraseña antigua (SHA-256) se conserva: el login de V2 la acepta una sola vez y la
 *   reemplaza por un hash con sal.
 * - requiereCambioPass queda en true si ya lo estaba O si la clave sigue siendo la inicial
 *   (nomUsu + "1234567"), que cualquiera puede deducir.
 */

const { sha256Hex } = require('./contrasenas');
const { ROLES } = require('./permisos');

const CLAVE_INICIAL_ANTIGUA = '1234567';

class ErrorDeMigracion extends Error {
  constructor(problemas) {
    super(`No se puede migrar: ${problemas.join('; ')}`);
    this.name = 'ErrorDeMigracion';
    this.problemas = problemas;
  }
}

function migrarUsuarios(usuariosAntiguos, { cantidadConsultorios }) {
  const registros = Array.isArray(usuariosAntiguos) ? usuariosAntiguos : Object.values(usuariosAntiguos || {});
  const problemas = [];
  const vistos = new Set();
  const usuarios = [];
  let conClaveInicial = 0;

  for (const u of registros) {
    const id = String(u.nomUsu || '').trim();
    if (!id) {
      problemas.push('hay un usuario sin nomUsu');
      continue;
    }
    if (vistos.has(id.toLowerCase())) {
      problemas.push(`el usuario "${id}" está repetido`);
      continue;
    }
    vistos.add(id.toLowerCase());

    if (!ROLES.includes(u.rol)) problemas.push(`el usuario "${id}" tiene un rol desconocido`);
    if (typeof u.contrasena !== 'string' || u.contrasena.length === 0) problemas.push(`el usuario "${id}" no tiene contraseña`);
    const consPref = Array.isArray(u.consPref) ? u.consPref.filter((c) => Number.isInteger(c) && c >= 1 && c <= cantidadConsultorios) : [];

    const tieneClaveInicial = u.contrasena === sha256Hex(`${id}${CLAVE_INICIAL_ANTIGUA}`);
    if (tieneClaveInicial && u.activo !== false) conClaveInicial += 1;

    usuarios.push({
      id,
      nombre: String(u.nombre || id).trim(),
      rol: u.rol,
      consPref,
      activo: u.activo !== false,
      requiereCambioPass: Boolean(u.requiereCambioPass) || tieneClaveInicial,
      contrasena: u.contrasena,
    });
  }

  if (problemas.length > 0) throw new ErrorDeMigracion(problemas);

  usuarios.sort((a, b) => a.id.localeCompare(b.id, 'es', { sensitivity: 'base' }));
  return {
    contenido: { version: 1, usuarios },
    resumen: {
      total: usuarios.length,
      activos: usuarios.filter((u) => u.activo).length,
      porRol: Object.fromEntries(ROLES.map((r) => [r, usuarios.filter((u) => u.rol === r).length])),
      activosConClaveInicial: conClaveInicial,
    },
  };
}

module.exports = { ErrorDeMigracion, migrarUsuarios };
