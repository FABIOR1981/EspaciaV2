// Ventanas emergentes (hojas) y avisos.

import { el, icono } from './utilidades.js';

export function mostrarAviso(texto, tipo = 'ok') {
  const contenedor = document.getElementById('avisos');
  const aviso = el('div', { clase: tipo === 'error' ? 'aviso aviso-error' : 'aviso', role: tipo === 'error' ? 'alert' : 'status' }, texto);
  contenedor.append(aviso);
  setTimeout(() => aviso.remove(), tipo === 'error' ? 7000 : 4000);
}

const abiertas = []; // pila de ventanas abiertas: solo se ve la de arriba

/** Abre una ventana modal. En celular se muestra como hoja desde abajo. */
export function abrirHoja({ titulo, cuerpo, alCerrar }) {
  const idTitulo = `hoja-titulo-${Math.random().toString(36).slice(2, 8)}`;
  const dialogo = el(
    'dialog',
    { clase: 'hoja', 'aria-labelledby': idTitulo },
    el(
      'header',
      { clase: 'hoja-cabecera' },
      el('h2', { id: idTitulo }, titulo),
      el('button', { clase: 'boton-icono', type: 'button', 'aria-label': 'Cerrar', enClick: () => dialogo.close() }, icono('cerrar'))
    ),
    el('div', { clase: 'hoja-cuerpo' }, cuerpo)
  );
  dialogo.addEventListener('close', () => {
    const posicion = abiertas.indexOf(dialogo);
    if (posicion >= 0) abiertas.splice(posicion, 1);
    const debajo = abiertas[abiertas.length - 1];
    if (debajo) delete debajo.dataset.oculta; // vuelve a verse la ventana que estaba debajo
    dialogo.remove();
    if (alCerrar) alCerrar();
  });
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) dialogo.close(); // clic fuera de la hoja
  });
  for (const previa of abiertas) previa.dataset.oculta = 'true'; // la ventana anterior se esconde mientras esta está abierta
  abiertas.push(dialogo);
  document.body.append(dialogo);
  dialogo.showModal();
  return { cerrar: () => dialogo.close(), dialogo };
}
