'use strict';
/**
 * Permisos por rol de EspaciaV2.
 * Lógica pura: sin red, sin reloj, sin Google ni GitHub.
 * Los roles son: usuario, gestor, admin.
 */

const ROLES = ['usuario', 'gestor', 'admin'];

function esRolValido(rol) {
  return ROLES.includes(rol);
}

/** admin y gestor son "administrativos": pueden operar sobre reservas de otras personas. */
function esAdministrativo(rol) {
  return rol === 'admin' || rol === 'gestor';
}

/** Compara identificadores de usuario sin distinguir mayúsculas ni espacios en los bordes. */
function mismoUsuario(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function puedeReservarPara(rol, usuarioId, paraUsuarioId) {
  if (!esRolValido(rol)) return false;
  if (!paraUsuarioId || mismoUsuario(usuarioId, paraUsuarioId)) return true;
  return esAdministrativo(rol);
}

function puedeVerTodasLasReservas(rol) {
  return esAdministrativo(rol);
}

function puedeVerReservasDe(rol, usuarioId, otroUsuarioId) {
  if (!esRolValido(rol)) return false;
  return mismoUsuario(usuarioId, otroUsuarioId) || esAdministrativo(rol);
}

function puedeBloquear(rol) {
  return esAdministrativo(rol);
}

function puedeGestionarUsuarios(rol) {
  return esAdministrativo(rol);
}

/**
 * Quién puede crear o cambiar el rol de otro usuario.
 * SUPUESTO (a confirmar): el admin puede todo; el gestor solo trabaja con usuarios comunes
 * y no puede crear ni modificar gestores ni administradores.
 * @param {string} rolActor rol de quien hace el cambio
 * @param {string|null} rolActualObjetivo rol actual del usuario afectado (null si es un alta)
 * @param {string} rolNuevo rol que quedaría
 */
function puedeAsignarRol(rolActor, rolActualObjetivo, rolNuevo) {
  if (!esRolValido(rolActor) || !esRolValido(rolNuevo)) return false;
  if (rolActualObjetivo !== null && !esRolValido(rolActualObjetivo)) return false;
  if (rolActor === 'admin') return true;
  if (rolActor === 'gestor') {
    return rolNuevo === 'usuario' && (rolActualObjetivo === null || rolActualObjetivo === 'usuario');
  }
  return false;
}

module.exports = {
  ROLES,
  esRolValido,
  esAdministrativo,
  mismoUsuario,
  puedeReservarPara,
  puedeVerTodasLasReservas,
  puedeVerReservasDe,
  puedeBloquear,
  puedeGestionarUsuarios,
  puedeAsignarRol,
};
