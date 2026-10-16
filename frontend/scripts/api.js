// Cliente de la API de EspaciaV2. Todas las respuestas tienen la forma { ok, estado, datos | error }.

const CODIGOS_SESION_INVALIDA = ['TOKEN_INVALIDO', 'TOKEN_VENCIDO', 'SESION_INVALIDA'];

export function crearApi({ obtenerToken, alSesionInvalida, alDebeCambiarClave }) {
  async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
    const token = obtenerToken();
    let respuesta;
    try {
      respuesta = await fetch(`/api${ruta}`, {
        method: metodo,
        headers: {
          ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      return { ok: false, estado: 0, error: { codigo: 'SIN_CONEXION', mensaje: 'No hay conexión. Revisá tu internet e intentá de nuevo.' } };
    }

    let datos = null;
    try {
      datos = await respuesta.json();
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    if (respuesta.ok) return { ok: true, estado: respuesta.status, datos };

    const error = (datos && datos.error) || { codigo: 'ERROR', mensaje: 'Ocurrió un error inesperado. Intentá de nuevo.' };
    if (respuesta.status === 401 && CODIGOS_SESION_INVALIDA.includes(error.codigo)) alSesionInvalida(error.codigo);
    if (respuesta.status === 403 && error.codigo === 'DEBE_CAMBIAR_CLAVE') alDebeCambiarClave();
    return { ok: false, estado: respuesta.status, error, detalle: datos && datos.detalle };
  }

  const q = encodeURIComponent;
  return {
    reglas: () => pedir('/reglas'),
    ingresar: (usuario, clave) => pedir('/ingresar', { metodo: 'POST', cuerpo: { usuario, clave } }),
    cambiarClave: (claveActual, claveNueva) => pedir('/clave', { metodo: 'POST', cuerpo: { claveActual, claveNueva } }),
    agenda: (fecha) => pedir(`/reservas?fecha=${q(fecha)}`),
    misReservas: (desde, hasta) => pedir(`/reservas?desde=${q(desde)}&hasta=${q(hasta)}`),
    todasLasReservas: (desde, hasta) => pedir(`/reservas?desde=${q(desde)}&hasta=${q(hasta)}&todas=1`),
    reservar: (datos) => pedir('/reservas', { metodo: 'POST', cuerpo: datos }),
    cancelar: (id) => pedir(`/reservas?id=${q(id)}`, { metodo: 'DELETE' }),
    usuarios: () => pedir('/usuarios'),
    crearUsuario: (datos) => pedir('/usuarios', { metodo: 'POST', cuerpo: datos }),
    editarUsuario: (id, cambios) => pedir(`/usuarios?id=${q(id)}`, { metodo: 'PATCH', cuerpo: cambios }),
    reiniciarClave: (id) => pedir(`/usuarios?id=${q(id)}&accion=reiniciar-clave`, { metodo: 'POST', cuerpo: {} }),
    bloqueos: (desde, hasta) => pedir(`/bloqueos?desde=${q(desde)}&hasta=${q(hasta)}`),
    crearBloqueo: (datos) => pedir('/bloqueos', { metodo: 'POST', cuerpo: datos }),
  };
}
