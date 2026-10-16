'use strict';
/**
 * Casos de uso de usuarios de EspaciaV2: ingresar, alta, edición, cambio y reinicio de clave.
 *
 * No habla con GitHub: recibe un "almacén" con la forma
 *   leer() -> usuarios            actualizar(cambiar, mensaje) -> usuarios nuevos
 * (en producción es el de github_usuarios.js; en las pruebas, uno en memoria).
 *
 * Todas las funciones devuelven { ok: true, ... } o { ok: false, codigo, mensaje, estado }.
 * Nunca se devuelve el hash de la contraseña.
 */

const {
  puedeGestionarUsuarios,
  puedeAsignarRol,
  esRolValido,
  mismoUsuario,
} = require('./permisos');
const contrasenas = require('./contrasenas');

// SUPUESTO (a confirmar): identificadores solo con letras y números, de 3 a 20 caracteres
// (todos los usuarios actuales de Espacia cumplen: 4 a 10 caracteres alfanuméricos).
const REGEX_ID = /^[A-Za-z0-9]{3,20}$/;
const LARGO_MAXIMO_NOMBRE = 60;

class ErrorDeNegocio extends Error {
  constructor(codigo, mensaje, estado) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

function fallo(codigo, mensaje, estado = 400) {
  return { ok: false, codigo, mensaje, estado };
}

/** Ejecuta una acción y convierte los ErrorDeNegocio en resultados; el resto de errores se propagan. */
async function conErroresDeNegocio(accion) {
  try {
    return await accion();
  } catch (e) {
    if (e instanceof ErrorDeNegocio) return fallo(e.codigo, e.message, e.estado);
    throw e;
  }
}

function vistaUsuario(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    consPref: u.consPref,
    activo: u.activo,
    requiereCambioPass: u.requiereCambioPass,
  };
}

function buscar(lista, id) {
  return lista.findIndex((u) => mismoUsuario(u.id, id));
}

function consultoriosPorDefecto(reglas) {
  return Array.from({ length: reglas.espacios.cantidad }, (_, i) => i + 1);
}

/** @returns {number[]|null} preferencias normalizadas, o null si son inválidas */
function normalizarPreferencias(consPref, reglas) {
  if (!Array.isArray(consPref) || consPref.length === 0) return null;
  const validos = consPref.every((c) => Number.isInteger(c) && c >= 1 && c <= reglas.espacios.cantidad);
  return validos ? [...new Set(consPref)].sort((a, b) => a - b) : null;
}

function sinPermiso() {
  return fallo('NO_PUEDE_GESTIONAR_USUARIOS', 'No tiene permiso para gestionar usuarios.', 403);
}

// ---------- Ingreso y sesión ----------

const CREDENCIALES_INVALIDAS = () => fallo('CREDENCIALES_INVALIDAS', 'Usuario o clave incorrectos.', 401);

/**
 * Ingreso. El mensaje es el mismo si el usuario no existe, está inactivo o la clave es incorrecta,
 * y el tiempo de respuesta tampoco los distingue.
 */
async function autenticar({ almacen, id, clave }) {
  if (typeof id !== 'string' || typeof clave !== 'string' || !id.trim() || !clave) {
    await contrasenas.verificacionFalsa(clave);
    return CREDENCIALES_INVALIDAS();
  }

  const usuarios = await almacen.leer();
  const usuario = usuarios[buscar(usuarios, id)];
  if (!usuario) {
    await contrasenas.verificacionFalsa(clave);
    return CREDENCIALES_INVALIDAS();
  }

  const verificacion = await contrasenas.verificarClave(clave, usuario.contrasena);
  if (!verificacion.ok || !usuario.activo) return CREDENCIALES_INVALIDAS();

  if (verificacion.necesitaActualizar) {
    // Reemplaza el hash antiguo por uno con sal. Si falla, igual se permite el ingreso.
    try {
      const nuevoHash = await contrasenas.generarHash(clave);
      const hashViejo = usuario.contrasena;
      await almacen.actualizar((lista) => {
        const i = buscar(lista, usuario.id);
        if (i === -1 || lista[i].contrasena !== hashViejo) throw new ErrorDeNegocio('CAMBIO_CONCURRENTE', 'La clave cambió.', 409);
        lista[i] = { ...lista[i], contrasena: nuevoHash };
        return lista;
      }, `Actualización de seguridad de la clave de ${usuario.id}`);
    } catch {
      /* no impide el ingreso */
    }
  }

  return {
    ok: true,
    sesion: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
    consPref: Array.isArray(usuario.consPref) ? usuario.consPref : [],
    requiereCambioPass: Boolean(usuario.requiereCambioPass),
  };
}

/**
 * Comprueba contra el archivo de usuarios que la persona de un token sigue activa, y devuelve su
 * rol ACTUAL (no el que dice el token). Así una baja o un cambio de rol se aplican de inmediato.
 */
async function validarSesionContraUsuarios({ almacen, sesion }) {
  const usuarios = await almacen.leer();
  const usuario = usuarios[buscar(usuarios, sesion.id)];
  if (!usuario || !usuario.activo) return fallo('SESION_INVALIDA', 'La sesión ya no es válida.', 401);
  return {
    ok: true,
    sesion: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
    requiereCambioPass: Boolean(usuario.requiereCambioPass),
  };
}

// ---------- Administración de usuarios ----------

async function listarUsuarios({ almacen, sesion }) {
  if (!puedeGestionarUsuarios(sesion.rol)) return sinPermiso();
  const usuarios = await almacen.leer();
  return {
    ok: true,
    usuarios: usuarios.map(vistaUsuario).sort((a, b) => a.id.localeCompare(b.id, 'es', { sensitivity: 'base' })),
  };
}

async function crearUsuario({ reglas, almacen, sesion, datos }) {
  if (!puedeGestionarUsuarios(sesion.rol)) return sinPermiso();

  const id = typeof datos.id === 'string' ? datos.id.trim() : '';
  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  if (!REGEX_ID.test(id)) {
    return fallo('ID_INVALIDO', 'El usuario debe tener de 3 a 20 letras o números, sin espacios.');
  }
  if (!nombre || nombre.length > LARGO_MAXIMO_NOMBRE) {
    return fallo('NOMBRE_INVALIDO', `El nombre es obligatorio y no puede superar ${LARGO_MAXIMO_NOMBRE} caracteres.`);
  }
  if (!esRolValido(datos.rol)) return fallo('ROL_INVALIDO', 'El rol indicado no existe.');
  if (!puedeAsignarRol(sesion.rol, null, datos.rol)) {
    return fallo('NO_PUEDE_ASIGNAR_ROL', 'No tiene permiso para crear usuarios con ese rol.', 403);
  }

  let consPref = consultoriosPorDefecto(reglas);
  if (datos.consPref !== undefined) {
    consPref = normalizarPreferencias(datos.consPref, reglas);
    if (!consPref) return fallo('PREFERENCIAS_INVALIDAS', 'Las preferencias de consultorio no son válidas.');
  }

  const claveTemporal = contrasenas.generarClaveTemporal();
  const usuario = {
    id,
    nombre,
    rol: datos.rol,
    consPref,
    activo: true,
    requiereCambioPass: true,
    contrasena: await contrasenas.generarHash(claveTemporal),
  };

  return conErroresDeNegocio(async () => {
    await almacen.actualizar((lista) => {
      if (buscar(lista, id) !== -1) throw new ErrorDeNegocio('USUARIO_REPETIDO', 'Ya existe un usuario con ese identificador.', 409);
      return [...lista, usuario];
    }, `Alta del usuario ${id} por ${sesion.id}`);
    // La clave temporal se muestra una sola vez; no se guarda en ningún lado.
    return { ok: true, usuario: vistaUsuario(usuario), claveTemporal };
  });
}

/** Solo se pueden cambiar: nombre, rol, consPref y activo. Cualquier otro campo se ignora. */
async function editarUsuario({ reglas, almacen, sesion, id, cambios }) {
  if (!puedeGestionarUsuarios(sesion.rol)) return sinPermiso();

  const nuevos = {};
  if (cambios.nombre !== undefined) {
    const nombre = typeof cambios.nombre === 'string' ? cambios.nombre.trim() : '';
    if (!nombre || nombre.length > LARGO_MAXIMO_NOMBRE) {
      return fallo('NOMBRE_INVALIDO', `El nombre es obligatorio y no puede superar ${LARGO_MAXIMO_NOMBRE} caracteres.`);
    }
    nuevos.nombre = nombre;
  }
  if (cambios.rol !== undefined) {
    if (!esRolValido(cambios.rol)) return fallo('ROL_INVALIDO', 'El rol indicado no existe.');
    nuevos.rol = cambios.rol;
  }
  if (cambios.consPref !== undefined) {
    const consPref = normalizarPreferencias(cambios.consPref, reglas);
    if (!consPref) return fallo('PREFERENCIAS_INVALIDAS', 'Las preferencias de consultorio no son válidas.');
    nuevos.consPref = consPref;
  }
  if (cambios.activo !== undefined) {
    if (typeof cambios.activo !== 'boolean') return fallo('ACTIVO_INVALIDO', 'El estado activo debe ser verdadero o falso.');
    nuevos.activo = cambios.activo;
  }

  return conErroresDeNegocio(async () => {
    let editado;
    await almacen.actualizar((lista) => {
      const i = buscar(lista, id);
      if (i === -1) throw new ErrorDeNegocio('USUARIO_NO_ENCONTRADO', 'El usuario no existe.', 404);
      const actual = lista[i];
      const rolFinal = nuevos.rol !== undefined ? nuevos.rol : actual.rol;

      if (!puedeAsignarRol(sesion.rol, actual.rol, rolFinal)) {
        throw new ErrorDeNegocio('NO_PUEDE_ASIGNAR_ROL', 'No tiene permiso para modificar a ese usuario o asignar ese rol.', 403);
      }
      // SUPUESTO (a confirmar): nadie puede quitarse el acceso ni cambiarse el rol a sí mismo,
      // lo que además impide dejar el sistema sin administradores.
      const cambiaSuRol = nuevos.rol !== undefined && nuevos.rol !== actual.rol;
      if (mismoUsuario(sesion.id, actual.id) && (nuevos.activo === false || cambiaSuRol)) {
        throw new ErrorDeNegocio('NO_PUEDE_MODIFICARSE_A_SI_MISMO', 'No puede desactivarse ni cambiarse el rol a sí mismo.', 403);
      }

      editado = { ...actual, ...nuevos };
      lista[i] = editado;
      return lista;
    }, `Edición del usuario ${id} por ${sesion.id}`);
    return { ok: true, usuario: vistaUsuario(editado) };
  });
}

async function reiniciarClave({ almacen, sesion, id }) {
  if (!puedeGestionarUsuarios(sesion.rol)) return sinPermiso();

  const claveTemporal = contrasenas.generarClaveTemporal();
  const nuevoHash = await contrasenas.generarHash(claveTemporal);

  return conErroresDeNegocio(async () => {
    await almacen.actualizar((lista) => {
      const i = buscar(lista, id);
      if (i === -1) throw new ErrorDeNegocio('USUARIO_NO_ENCONTRADO', 'El usuario no existe.', 404);
      // Mismas reglas que para editar: el gestor solo trabaja con usuarios comunes.
      if (!puedeAsignarRol(sesion.rol, lista[i].rol, lista[i].rol)) {
        throw new ErrorDeNegocio('NO_PUEDE_ASIGNAR_ROL', 'No tiene permiso para modificar a ese usuario.', 403);
      }
      lista[i] = { ...lista[i], contrasena: nuevoHash, requiereCambioPass: true };
      return lista;
    }, `Reinicio de clave del usuario ${id} por ${sesion.id}`);
    return { ok: true, claveTemporal };
  });
}

/** Cambio de la propia clave. Exige la clave actual. */
async function cambiarMiClave({ almacen, sesion, claveActual, claveNueva }) {
  const fortaleza = contrasenas.validarFortalezaClave(claveNueva);
  if (!fortaleza.ok) return fallo(fortaleza.codigo, fortaleza.mensaje, 400);

  const usuarios = await almacen.leer();
  const usuario = usuarios[buscar(usuarios, sesion.id)];
  if (!usuario || !usuario.activo) return fallo('SESION_INVALIDA', 'La sesión ya no es válida.', 401);

  const actual = await contrasenas.verificarClave(claveActual, usuario.contrasena);
  if (!actual.ok) return fallo('CLAVE_ACTUAL_INCORRECTA', 'La clave actual no es correcta.', 401);

  const igual = await contrasenas.verificarClave(claveNueva, usuario.contrasena);
  if (igual.ok) return fallo('CLAVE_IGUAL_A_LA_ACTUAL', 'La clave nueva debe ser distinta de la actual.', 400);

  const nuevoHash = await contrasenas.generarHash(claveNueva);
  const hashViejo = usuario.contrasena;

  return conErroresDeNegocio(async () => {
    await almacen.actualizar((lista) => {
      const i = buscar(lista, usuario.id);
      if (i === -1 || lista[i].contrasena !== hashViejo) {
        throw new ErrorDeNegocio('CAMBIO_CONCURRENTE', 'La clave cambió mientras se guardaba. Intente de nuevo.', 409);
      }
      lista[i] = { ...lista[i], contrasena: nuevoHash, requiereCambioPass: false };
      return lista;
    }, `Cambio de clave del usuario ${usuario.id}`);
    return { ok: true };
  });
}

module.exports = {
  autenticar,
  validarSesionContraUsuarios,
  listarUsuarios,
  crearUsuario,
  editarUsuario,
  reiniciarClave,
  cambiarMiClave,
};
