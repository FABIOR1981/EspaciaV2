'use strict';
/** Almacén de usuarios en memoria, con la misma forma que el de GitHub. Solo para pruebas. */
function crearAlmacenEnMemoria(usuariosIniciales = []) {
  let usuarios = structuredClone(usuariosIniciales);
  const mensajes = [];
  return {
    mensajes,
    estado: () => structuredClone(usuarios),
    leer: async () => structuredClone(usuarios),
    actualizar: async (cambiar, mensaje) => {
      const nuevos = cambiar(structuredClone(usuarios));
      usuarios = structuredClone(nuevos);
      mensajes.push(mensaje);
      return structuredClone(nuevos);
    },
  };
}
module.exports = { crearAlmacenEnMemoria };
