// Guarda la sesión en esta pestaña del navegador (se borra al cerrarla). Nunca se guarda la clave.

const CLAVE = 'espaciav2.sesion';

export function guardar(sesion) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
  } catch {
    /* sin almacenamiento disponible: la sesión vive solo en memoria */
  }
}

export function leer() {
  try {
    const sesion = JSON.parse(sessionStorage.getItem(CLAVE));
    if (!sesion || !sesion.token || sesion.venceEn <= Date.now()) {
      borrar();
      return null;
    }
    return sesion;
  } catch {
    return null;
  }
}

export function borrar() {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada que borrar */
  }
}
