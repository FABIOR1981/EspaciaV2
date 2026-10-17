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
 *
 * CLAVE INICIAL (decisión de Fabio): los usuarios comunes reciben "<usuario>1234567", fácil de dictar y de recordar.
 * Como es predecible, VENCE a los 7 días (reglas.claveInicial.diasDeVigencia). Gestión y administración reciben una
 * clave aleatoria que no vence por fecha. Las cuentas migradas de Espacia que siguen con la clave inicial vencen en
 * reglas.claveInicial.vencimientoLegado. Una clave inicial vencida no permite ingresar: hay que reiniciarla.
 *
 * `ahora` es { fecha: 'AAAA-MM-DD', minutos } en hora de Montevideo (lo entrega la capa HTTP).
 */

const {
  puedeGestionarUsuarios,
  puedeAsignarRol,
  esRolValido,
  mismoUsuario,
} = require('./permisos');
const contrasenas = require('./contrasenas');
const { sumarDias } = require('./reglas_de_negocio');

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

// ---------- Espacios habilitados ----------

/**
 * Espacios (consultorios) habilitados para una persona. Un usuario común solo ve y reserva en estos;
 * administración y gestión pueden reservarle en cualquier otro (contingencias).
 * Compatibilidad: el dato se llamaba "consPref" en Espacia y en los primeros archivos de V2; se sigue leyendo
 * y se reemplaza por "espHabil" la próxima vez que se guarda a esa persona.
 */
function habilitadosDe(usuario, reglas) {
  const valido = (x) => Array.isArray(x) && x.length > 0 && x.every((n) => Number.isInteger(n) && n >= 1 && n <= reglas.espacios.cantidad);
  if (valido(usuario.espHabil)) return [...usuario.espHabil];
  if (valido(usuario.consPref)) return [...usuario.consPref];
  return Array.from({ length: reglas.espacios.cantidad }, (_, i) => i + 1);
}

// ---------- Clave inicial: vigencia ----------

/**
 * Último día en que sirve la clave inicial de un usuario, o null si no vence.
 * - Sin obligación de cambiar la clave: null.
 * - claveInicialVenceEl === null: clave aleatoria que no vence por fecha.
 * - claveInicialVenceEl con fecha: esa fecha (inclusive).
 * - sin el campo (cuentas migradas de Espacia): la fecha general de reglas.claveInicial.vencimientoLegado.
 */
function ultimoDiaClaveInicial(reglas, usuario) {
  if (!usuario.requiereCambioPass) return null;
  if (usuario.claveInicialVenceEl === null) return null;
  if (typeof usuario.claveInicialVenceEl === 'string') return usuario.claveInicialVenceEl;
  return (reglas.claveInicial && reglas.claveInicial.vencimientoLegado) || null;
}

function claveInicialVencida(reglas, usuario, ahora) {
  const ultimoDia = ultimoDiaClaveInicial(reglas, usuario);
  return Boolean(ultimoDia) && ahora.fecha > ultimoDia;
}

function vistaUsuario(u, reglas, ahora) {
  const hasta = ultimoDiaClaveInicial(reglas, u);
  return {
    id: u.id,
    nombre: u.nombre,
    rol: u.rol,
    espHabil: habilitadosDe(u, reglas),
    activo: u.activo,
    requiereCambioPass: u.requiereCambioPass,
    claveInicialHasta: hasta,
    claveInicialVencida: Boolean(hasta) && ahora.fecha > hasta,
  };
}

/** Clave inicial y vencimiento que corresponden a un perfil. */
function nuevaClaveInicial(reglas, ahora, usuarioId, rol) {
  if (rol === 'usuario') {
    return {
      claveTemporal: contrasenas.claveInicialSimple(usuarioId),
      claveInicialVenceEl: sumarDias(ahora.fecha, reglas.claveInicial.diasDeVigencia),
    };
  }
  return { claveTemporal: contrasenas.generarClaveTemporal(), claveInicialVenceEl: null };
}

function buscar(lista, id) {
  return lista.findIndex((u) => mismoUsuario(u.id, id));
}

function consultoriosPorDefecto(reglas) {
  return Array.from({ length: reglas.espacios.cantidad }, (_, i) => i + 1);
}

/** @returns {number[]|null} preferencias normalizadas, o null si son inválidas */
function normalizarPreferencias(espHabil, reglas) {
  if (!Array.isArray(espHabil) || espHabil.length === 0) return null;
  const validos = espHabil.every((c) => Number.isInteger(c) && c >= 1 && c <= reglas.espacios.cantidad);
  return validos ? [...new Set(espHabil)].sort((a, b) => a - b) : null;
}

function sinPermiso() {
  return fallo('NO_PUEDE_GESTIONAR_USUARIOS', 'No tiene permiso para gestionar usuarios.', 403);
}

// ---------- Ingreso y sesión ----------

const CREDENCIALES_INVALIDAS = () => fallo('CREDENCIALES_INVALIDAS', 'Usuario o clave incorrectos.', 401);

/**
 * Ingreso. El mensaje es el mismo si el usuario no existe, está inactivo o la clave es incorrecta,
 * y el tiempo de respuesta tampoco los distingue. Solo quien acierta la clave inicial vencida
 * recibe un aviso específico, para saber que debe pedir un reinicio.
 */
async function autenticar({ reglas, almacen, id, clave, ahora }) {
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

  if (claveInicialVencida(reglas, usuario, ahora)) {
    return fallo('CLAVE_INICIAL_VENCIDA', 'Tu clave inicial venció. Pedile a la administración que la reinicie.', 403);
  }

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
    espHabil: habilitadosDe(usuario, reglas),
    requiereCambioPass: Boolean(usuario.requiereCambioPass),
  };
}

/**
 * Comprueba contra el archivo de usuarios que la persona de un token sigue activa, y devuelve su
 * rol ACTUAL (no el que dice el token). Así una baja o un cambio de rol se aplican de inmediato.
 */
async function validarSesionContraUsuarios({ reglas, almacen, sesion }) {
  const usuarios = await almacen.leer();
  const usuario = usuarios[buscar(usuarios, sesion.id)];
  if (!usuario || !usuario.activo) return fallo('SESION_INVALIDA', 'La sesión ya no es válida.', 401);
  return {
    ok: true,
    sesion: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, espHabil: habilitadosDe(usuario, reglas) },
    requiereCambioPass: Boolean(usuario.requiereCambioPass),
  };
}

// ---------- Administración de usuarios ----------

async function listarUsuarios({ reglas, almacen, sesion, ahora }) {
  if (!puedeGestionarUsuarios(sesion.rol)) return sinPermiso();
  const usuarios = await almacen.leer();
  return {
    ok: true,
    usuarios: usuarios
      .map((u) => vistaUsuario(u, reglas, ahora))
      .sort((a, b) => a.id.localeCompare(b.id, 'es', { sensitivity: 'base' })),
  };
}

async function crearUsuario({ reglas, almacen, sesion, datos, ahora }) {
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

  let espHabil = consultoriosPorDefecto(reglas);
  if (datos.espHabil !== undefined) {
    espHabil = normalizarPreferencias(datos.espHabil, reglas);
    if (!espHabil) return fallo('ESPACIOS_INVALIDOS', 'Los espacios habilitados no son válidos.');
  }

  const { claveTemporal, claveInicialVenceEl } = nuevaClaveInicial(reglas, ahora, id, datos.rol);
  const usuario = {
    id,
    nombre,
    rol: datos.rol,
    espHabil,
    activo: true,
    requiereCambioPass: true,
    claveInicialVenceEl,
    contrasena: await contrasenas.generarHash(claveTemporal),
  };

  return conErroresDeNegocio(async () => {
    await almacen.actualizar((lista) => {
      if (buscar(lista, id) !== -1) throw new ErrorDeNegocio('USUARIO_REPETIDO', 'Ya existe un usuario con ese identificador.', 409);
      return [...lista, usuario];
    }, `Alta del usuario ${id} por ${sesion.id}`);
    // La clave inicial se muestra una sola vez; no se guarda en ningún lado.
    return { ok: true, usuario: vistaUsuario(usuario, reglas, ahora), claveTemporal, venceEl: claveInicialVenceEl };
  });
}

/** Solo se pueden cambiar: nombre, rol, espHabil y activo. Cualquier otro campo se ignora. */
async function editarUsuario({ reglas, almacen, sesion, id, cambios, ahora }) {
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
  if (cambios.espHabil !== undefined) {
    const espHabil = normalizarPreferencias(cambios.espHabil, reglas);
    if (!espHabil) return fallo('ESPACIOS_INVALIDOS', 'Los espacios habilitados no son válidos.');
    nuevos.espHabil = espHabil;
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
      delete editado.consPref; // nombre antiguo del dato
      editado.espHabil = nuevos.espHabil || habilitadosDe(actual, reglas);
      // Si alguien todavía no estrenó su clave inicial simple y pasa a gestión o administración,
      // esa clave predecible deja de servir: hay que reiniciarla para recibir una aleatoria.
      if (cambiaSuRol && rolFinal !== 'usuario' && actual.requiereCambioPass && actual.claveInicialVenceEl !== null) {
        editado.claveInicialVenceEl = sumarDias(ahora.fecha, -1);
      }
      lista[i] = editado;
      return lista;
    }, `Edición del usuario ${id} por ${sesion.id}`);
    return { ok: true, usuario: vistaUsuario(editado, reglas, ahora) };
  });
}

async function reiniciarClave({ reglas, almacen, sesion, id, ahora }) {
  if (!puedeGestionarUsuarios(sesion.rol)) return sinPermiso();

  // El tipo de clave depende del perfil de la persona; se lee antes y se vuelve a comprobar al guardar.
  const usuarios = await almacen.leer();
  const objetivo = usuarios[buscar(usuarios, id)];
  if (!objetivo) return fallo('USUARIO_NO_ENCONTRADO', 'El usuario no existe.', 404);

  const { claveTemporal, claveInicialVenceEl } = nuevaClaveInicial(reglas, ahora, objetivo.id, objetivo.rol);
  const nuevoHash = await contrasenas.generarHash(claveTemporal);

  return conErroresDeNegocio(async () => {
    await almacen.actualizar((lista) => {
      const i = buscar(lista, id);
      if (i === -1) throw new ErrorDeNegocio('USUARIO_NO_ENCONTRADO', 'El usuario no existe.', 404);
      // Mismas reglas que para editar: el gestor solo trabaja con usuarios comunes.
      if (!puedeAsignarRol(sesion.rol, lista[i].rol, lista[i].rol)) {
        throw new ErrorDeNegocio('NO_PUEDE_ASIGNAR_ROL', 'No tiene permiso para modificar a ese usuario.', 403);
      }
      if (lista[i].rol !== objetivo.rol) {
        throw new ErrorDeNegocio('CAMBIO_CONCURRENTE', 'El perfil de la persona cambió mientras se reiniciaba. Intente de nuevo.', 409);
      }
      lista[i] = { ...lista[i], contrasena: nuevoHash, requiereCambioPass: true, claveInicialVenceEl };
      return lista;
    }, `Reinicio de clave del usuario ${id} por ${sesion.id}`);
    return { ok: true, claveTemporal, venceEl: claveInicialVenceEl };
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
      const { claveInicialVenceEl, ...resto } = lista[i];
      lista[i] = { ...resto, contrasena: nuevoHash, requiereCambioPass: false };
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
  ultimoDiaClaveInicial,
};
