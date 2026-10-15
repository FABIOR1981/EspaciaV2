'use strict';
/**
 * GitHub simulado en memoria (API de contenidos). Solo para pruebas.
 * antesDelPut(): gancho para simular que otra persona guardó justo antes.
 */
function crearGitHubSimulado({ usuarios = [], existe = true } = {}) {
  const estado = { existe, version: 1, contenido: { version: 1, usuarios }, peticiones: [], antesDelPut: null };

  const sha = () => `sha-${estado.version}`;
  const base64 = () => Buffer.from(JSON.stringify(estado.contenido), 'utf-8').toString('base64');
  const respuesta = (status, datos) => ({ status, ok: status >= 200 && status < 300, json: async () => datos });

  async function fetchSimulado(url, opciones = {}) {
    const metodo = opciones.method || 'GET';
    estado.peticiones.push({ url, metodo, opciones });

    if (metodo === 'GET') {
      if (!estado.existe) return respuesta(404, { message: 'Not Found' });
      return respuesta(200, { content: base64(), sha: sha() });
    }

    if (estado.antesDelPut) {
      const gancho = estado.antesDelPut;
      estado.antesDelPut = null;
      gancho(estado);
    }
    const cuerpo = JSON.parse(opciones.body);
    if (estado.existe && cuerpo.sha !== sha()) return respuesta(409, { message: 'sha no coincide' });
    estado.contenido = JSON.parse(Buffer.from(cuerpo.content, 'base64').toString('utf-8'));
    estado.existe = true;
    estado.version += 1;
    return respuesta(200, { content: { sha: sha() } });
  }

  return { estado, fetchSimulado };
}

module.exports = { crearGitHubSimulado };
