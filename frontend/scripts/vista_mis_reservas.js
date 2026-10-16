// "Mis reservas" (usuario común) o "Reservas" (administración y gestión: todas las reservas próximas).

import { el, reemplazarHijos, ahoraEn, sumarDias, fechaLarga, capitalizar, rangoHoras, nombreSala, colorSala } from './utilidades.js';
import { abrirHojaDetalle } from './hojas_reservas.js';

export function crearVistaMisReservas({ api, reglas, sesion, irAAgenda }) {
  const administrativo = sesion.rol === 'admin' || sesion.rol === 'gestor';
  const titulo = administrativo ? 'Reservas' : 'Mis reservas';
  const nodo = el('section', { clase: 'mis-reservas', 'aria-label': titulo });
  let activa = false;
  let reservas = [];

  // Filtros (solo administración y gestión)
  const buscador = el('input', { id: 'reservas-buscar', type: 'text', placeholder: 'Buscar por nombre', autocomplete: 'off', 'aria-label': 'Buscar por nombre' });
  const selectorSala = el(
    'select',
    { id: 'reservas-sala', 'aria-label': 'Consultorio' },
    el('option', { value: '' }, 'Todos los consultorios'),
    Array.from({ length: reglas.espacios.cantidad }, (_, i) => el('option', { value: i + 1 }, nombreSala(reglas, i + 1)))
  );
  const casillaMias = el('input', { type: 'checkbox', id: 'reservas-solo-mias' });
  const resumen = el('p', { clase: 'campo-ayuda', 'aria-live': 'polite' });
  const lista = el('div', { clase: 'reservas-lista' });
  const filtros = administrativo
    ? el(
        'div',
        { clase: 'filtros' },
        el('div', { clase: 'campo' }, buscador),
        el('div', { clase: 'campo' }, selectorSala),
        el('label', { clase: 'casilla' }, casillaMias, ' Solo las mías')
      )
    : null;

  const sala = () => (selectorSala.value ? Number(selectorSala.value) : null);

  function dibujarLista() {
    const filtro = buscador.value.trim().toLowerCase();
    const visibles = reservas.filter(
      (x) =>
        (!filtro || (x.titularNombre || '').toLowerCase().includes(filtro)) &&
        (!sala() || x.consultorio === sala()) &&
        (!casillaMias.checked || String(x.titularId).toLowerCase() === sesion.id.toLowerCase())
    );
    if (administrativo) resumen.textContent = `${visibles.length} de ${reservas.length} reservas`;

    if (visibles.length === 0) {
      reemplazarHijos(
        lista,
        reservas.length === 0
          ? el('div', { clase: 'vacio' }, el('p', {}, administrativo ? 'No hay reservas próximas.' : 'No tenés reservas próximas.'), el('button', { clase: 'boton boton-primario', type: 'button', enClick: irAAgenda }, 'Reservar un horario'))
          : el('div', { clase: 'vacio' }, el('p', {}, 'No hay reservas con esos filtros.'))
      );
      return;
    }

    const porDia = new Map();
    for (const x of visibles) porDia.set(x.fecha, [...(porDia.get(x.fecha) || []), x]);
    const grupos = [];
    for (const [fecha, items] of porDia) {
      const grupo = el('div', { clase: 'grupo-fecha' }, el('h2', {}, capitalizar(fechaLarga(fecha))));
      for (const x of items) {
        const fila = el(
          'div',
          { clase: 'reserva-fila' },
          el('span', { clase: 'reserva-hora' }, rangoHoras(x.inicioMin, x.finMin)),
          el('span', { clase: 'reserva-sala' }, nombreSala(reglas, x.consultorio), administrativo && x.titularNombre ? ` · ${x.titularNombre}` : ''),
          el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => abrirHojaDetalle({ reglas, sesion, api, reserva: x, alCancelada: cargar }) }, 'Ver o cancelar')
        );
        fila.style.setProperty('--sala-color', colorSala(x.consultorio));
        grupo.append(fila);
      }
      grupos.push(grupo);
    }
    reemplazarHijos(lista, grupos);
  }

  async function cargar() {
    reemplazarHijos(nodo, el('h1', {}, titulo), el('p', { clase: 'intro', role: 'status' }, 'Cargando…'));
    const hoy = ahoraEn(reglas.zonaHoraria);
    const hasta = sumarDias(hoy.fecha, Math.max(reglas.reserva.maxSemanasAdelante, 12) * 7);
    const r = await (administrativo ? api.todasLasReservas(hoy.fecha, hasta) : api.misReservas(hoy.fecha, hasta));
    if (!activa) return;
    if (!r.ok) {
      reemplazarHijos(
        nodo,
        el('h1', {}, titulo),
        el('div', { clase: 'mensaje-error', role: 'alert' }, r.error.mensaje),
        el('button', { clase: 'boton boton-primario', type: 'button', enClick: cargar }, 'Reintentar')
      );
      return;
    }

    // Las de hoy que ya terminaron no se muestran.
    reservas = r.datos.reservas
      .filter((x) => x.fecha > hoy.fecha || x.finMin > hoy.minutos)
      .sort((a, b) => (a.fecha === b.fecha ? a.inicioMin - b.inicioMin || a.consultorio - b.consultorio : a.fecha < b.fecha ? -1 : 1));

    reemplazarHijos(
      nodo,
      el('h1', {}, titulo),
      el('p', { clase: 'intro' }, administrativo ? 'Todas las reservas próximas.' : 'Tus próximas reservas.'),
      filtros,
      administrativo ? resumen : null,
      lista
    );
    dibujarLista();
  }

  if (administrativo) {
    buscador.addEventListener('input', dibujarLista);
    selectorSala.addEventListener('change', dibujarLista);
    casillaMias.addEventListener('change', dibujarLista);
  }

  return {
    nodo,
    activar() { activa = true; cargar(); },
    desactivar() { activa = false; },
    destruir() { activa = false; },
  };
}
