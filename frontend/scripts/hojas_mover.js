// Ventana para mover una reserva a otro día, hora, duración o consultorio (sigue siendo la misma reserva).

import {
  el, reemplazarHijos, ahoraEn, sumarDias, fechaLarga, minutosAHora, rangoHoras, horarioDelDia, nombreSala,
} from './utilidades.js';
import { abrirHoja, mostrarAviso } from './hojas.js';
import { ocupadosDe, cabeEn } from './hojas_reservas.js';

const esAdministrativo = (rol) => rol === 'admin' || rol === 'gestor';

export function abrirHojaMover({ reglas, sesion, api, reserva, alMovida }) {
  const administrativo = esAdministrativo(sesion.rol);
  const hoy = () => ahoraEn(reglas.zonaHoraria);
  const duraciones = reglas.duracionesMinutos;
  const minimo = Math.min(...duraciones);
  const duracionOriginal = reserva.finMin - reserva.inicioMin;

  // Consultorios elegibles: un usuario, solo sus espacios habilitados (más el actual); administración y gestión, todos.
  const todas = Array.from({ length: reglas.espacios.cantidad }, (_, i) => i + 1);
  const habilitadas = Array.isArray(sesion.espHabil) && sesion.espHabil.length ? sesion.espHabil : todas;
  const elegibles = administrativo ? todas : todas.filter((n) => habilitadas.includes(n) || n === reserva.consultorio);

  const limiteMax = sesion.rol === 'admin' ? sumarDias(hoy().fecha, 365) : sumarDias(hoy().fecha, reglas.reserva.maxSemanasAdelante * 7);
  const campoFecha = el('input', { id: 'mover-fecha', type: 'date', value: reserva.fecha, min: administrativo ? sumarDias(hoy().fecha, -60) : hoy().fecha, max: limiteMax });
  const campoSala = el('select', { id: 'mover-sala' }, elegibles.map((n) => el('option', { value: n, selected: n === reserva.consultorio }, nombreSala(reglas, n))));
  const campoInicio = el('select', { id: 'mover-inicio' });
  const opciones = el('div', { clase: 'opciones', role: 'radiogroup' });
  const estado = el('p', { clase: 'campo-ayuda', role: 'status' });
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  const boton = el('button', { clase: 'boton boton-primario', type: 'submit', disabled: true }, 'Mover reserva');

  let delDia = []; // reservas del día elegido (según lo que esta persona puede ver)
  let cargado = false;
  let peticion = 0;

  const horario = () => horarioDelDia(reglas, campoFecha.value);
  const ocupados = () => ocupadosDe(delDia.filter((r) => r.id !== reserva.id), Number(campoSala.value));
  const cabe = (inicio, duracion) => cabeEn(ocupados(), horario(), hoy(), !administrativo, campoFecha.value, inicio, duracion);

  function dibujarHoras() {
    const h = horario();
    mensaje.hidden = true;
    if (!campoFecha.value) { reemplazarHijos(campoInicio); reemplazarHijos(opciones); estado.textContent = 'Elegí un día.'; return actualizarBoton(); }
    if (!h) { reemplazarHijos(campoInicio); reemplazarHijos(opciones); estado.textContent = 'Ese día no hay atención.'; return actualizarBoton(); }

    const previo = Number(campoInicio.value) || reserva.inicioMin;
    const inicios = [];
    for (let m = h.inicio; m + minimo <= h.fin; m += reglas.tramoMinutos) if (cabe(m, minimo)) inicios.push(m);
    reemplazarHijos(campoInicio, inicios.map((m) => el('option', { value: m, selected: m === previo }, minutosAHora(m))));
    if (!inicios.includes(previo) && inicios.length) campoInicio.selectedIndex = 0;
    estado.textContent = inicios.length ? '' : 'No hay horarios libres en ese consultorio ese día.';
    dibujarDuraciones();
    return undefined;
  }

  function dibujarDuraciones() {
    const inicio = Number(campoInicio.value);
    const elegida = opciones.querySelector('input:checked');
    const previa = elegida ? Number(elegida.value) : duracionOriginal;
    reemplazarHijos(opciones);
    if (!campoInicio.value) return actualizarBoton();
    let marcada = false;
    for (const duracion of duraciones) {
      const disponible = cabe(inicio, duracion);
      const marcar = disponible && !marcada && (duracion === previa || !cabe(inicio, previa));
      if (marcar) marcada = true;
      opciones.append(
        el('label', { clase: 'opcion' },
          el('input', { type: 'radio', name: 'duracion-mover', value: duracion, checked: marcar, disabled: !disponible, enChange: actualizarBoton }),
          el('span', { clase: 'opcion-cuerpo' }, el('strong', {}, `${duracion} min`), el('span', {}, disponible ? `hasta ${minutosAHora(inicio + duracion)}` : 'No hay tiempo libre')))
      );
    }
    return actualizarBoton();
  }

  function actualizarBoton() {
    const elegida = opciones.querySelector('input:checked');
    const inicio = Number(campoInicio.value);
    const hayCambio = elegida && campoFecha.value && campoInicio.value && (
      campoFecha.value !== reserva.fecha || Number(campoSala.value) !== reserva.consultorio || inicio !== reserva.inicioMin || Number(elegida.value) !== duracionOriginal
    );
    boton.disabled = !cargado || !hayCambio;
  }

  async function cargarDia() {
    const mia = ++peticion;
    cargado = false;
    boton.disabled = true;
    estado.textContent = 'Consultando horarios…';
    if (!campoFecha.value || !horario()) { delDia = []; cargado = true; dibujarHoras(); return; }
    const r = await api.agenda(campoFecha.value);
    if (mia !== peticion) return;
    delDia = r.ok ? r.datos.reservas : [];
    cargado = true;
    if (!r.ok) { mensaje.textContent = r.error.mensaje; mensaje.hidden = false; }
    dibujarHoras();
  }

  campoFecha.addEventListener('change', cargarDia);
  campoSala.addEventListener('change', dibujarHoras);
  campoInicio.addEventListener('change', dibujarDuraciones);

  const formulario = el(
    'form',
    {
      novalidate: true,
      enSubmit: async (evento) => {
        evento.preventDefault();
        mensaje.hidden = true;
        const elegida = opciones.querySelector('input:checked');
        if (!elegida) return;
        boton.disabled = true;
        boton.textContent = 'Moviendo…';
        const destino = { consultorio: Number(campoSala.value), fecha: campoFecha.value, hora: minutosAHora(Number(campoInicio.value)), duracion: Number(elegida.value) };
        const r = await api.mover(reserva.id, destino);
        boton.textContent = 'Mover reserva';
        if (r.ok) {
          mostrarAviso(`Reserva movida: ${nombreSala(reglas, r.datos.reserva.consultorio)}, ${fechaLarga(r.datos.reserva.fecha)}, ${rangoHoras(r.datos.reserva.inicioMin, r.datos.reserva.finMin)}.`);
          hoja.cerrar();
          alMovida();
          return;
        }
        mensaje.replaceChildren(r.error.mensaje);
        mensaje.hidden = false;
        if (r.error.codigo === 'HORARIO_OCUPADO') cargarDia(); // actualiza lo que está libre
        else actualizarBoton();
      },
    },
    el('p', { clase: 'campo-ayuda' }, `Ahora: ${nombreSala(reglas, reserva.consultorio)}, ${fechaLarga(reserva.fecha)}, ${rangoHoras(reserva.inicioMin, reserva.finMin)}. Sigue siendo la misma reserva.`),
    mensaje,
    el('div', { clase: 'campo' }, el('label', { for: 'mover-fecha' }, 'Día'), campoFecha),
    el('div', { clase: 'campo' }, el('label', { for: 'mover-sala' }, 'Consultorio'), campoSala),
    el('div', { clase: 'campo' }, el('label', { for: 'mover-inicio' }, 'Hora de inicio'), campoInicio, estado),
    el('fieldset', { clase: 'campo' }, el('legend', {}, 'Duración'), opciones),
    el('div', { clase: 'hoja-acciones' }, boton, el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => hoja.cerrar() }, 'Volver'))
  );

  const hoja = abrirHoja({ titulo: 'Mover reserva', cuerpo: formulario });
  cargarDia();
}
