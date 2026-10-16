// "Mis reservas": las reservas próximas de la persona, agrupadas por día.

import { el, ahoraEn, sumarDias, fechaLarga, capitalizar, rangoHoras, nombreSala, colorSala } from './utilidades.js';
import { abrirHojaDetalle } from './hojas_reservas.js';

export function crearVistaMisReservas({ api, reglas, sesion, irAAgenda }) {
  const nodo = el('section', { clase: 'mis-reservas', 'aria-label': 'Mis reservas' });
  let activa = false;

  async function cargar() {
    nodo.replaceChildren(el('h1', {}, 'Mis reservas'), el('p', { clase: 'intro', role: 'status' }, 'Cargando…'));
    const hoy = ahoraEn(reglas.zonaHoraria);
    const r = await api.misReservas(hoy.fecha, sumarDias(hoy.fecha, Math.max(reglas.reserva.maxSemanasAdelante, 12) * 7));
    if (!activa) return;
    if (!r.ok) {
      nodo.replaceChildren(
        el('h1', {}, 'Mis reservas'),
        el('div', { clase: 'mensaje-error', role: 'alert' }, r.error.mensaje),
        el('button', { clase: 'boton boton-primario', type: 'button', enClick: cargar }, 'Reintentar')
      );
      return;
    }

    // Las de hoy que ya terminaron no se muestran.
    const proximas = r.datos.reservas
      .filter((x) => x.fecha > hoy.fecha || x.finMin > hoy.minutos)
      .sort((a, b) => (a.fecha === b.fecha ? a.inicioMin - b.inicioMin : a.fecha < b.fecha ? -1 : 1));

    const contenido = [el('h1', {}, 'Mis reservas'), el('p', { clase: 'intro' }, 'Tus próximas reservas.')];
    if (proximas.length === 0) {
      contenido.push(
        el('div', { clase: 'vacio' }, el('p', {}, 'No tenés reservas próximas.'), el('button', { clase: 'boton boton-primario', type: 'button', enClick: irAAgenda }, 'Reservar un horario'))
      );
    } else {
      const porDia = new Map();
      for (const x of proximas) porDia.set(x.fecha, [...(porDia.get(x.fecha) || []), x]);
      for (const [fecha, lista] of porDia) {
        const grupo = el('div', { clase: 'grupo-fecha' }, el('h2', {}, capitalizar(fechaLarga(fecha))));
        for (const x of lista) {
          const fila = el(
            'div',
            { clase: 'reserva-fila' },
            el('span', { clase: 'reserva-hora' }, rangoHoras(x.inicioMin, x.finMin)),
            el('span', { clase: 'reserva-sala' }, nombreSala(reglas, x.consultorio)),
            el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => abrirHojaDetalle({ reglas, sesion, api, reserva: x, alCancelada: cargar }) }, 'Ver o cancelar')
          );
          fila.style.setProperty('--sala-color', colorSala(x.consultorio));
          grupo.append(fila);
        }
        contenido.push(grupo);
      }
    }
    nodo.replaceChildren(...contenido);
  }

  return {
    nodo,
    activar() { activa = true; cargar(); },
    desactivar() { activa = false; },
    destruir() { activa = false; },
  };
}
