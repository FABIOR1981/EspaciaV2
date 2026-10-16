// Pantalla de ingreso, cambio de clave obligatorio y formulario de cambio de clave.

import { el } from './utilidades.js';

const MARCA = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0F7B6C"/><rect x="7" y="7" width="8" height="11" rx="2" fill="#fff"/><rect x="17" y="7" width="8" height="6" rx="2" fill="#BFD3D3"/><rect x="17" y="15" width="8" height="10" rx="2" fill="#BFD3D3"/><rect x="7" y="20" width="8" height="5" rx="2" fill="#BFD3D3"/></svg>`;

export function crearMarca() {
  const marca = el('a', { clase: 'marca', href: '#agenda', 'aria-label': 'Espacia, ir a la agenda' });
  marca.innerHTML = MARCA;
  marca.append(document.createTextNode('Espacia'));
  return marca;
}

// Motivo gráfico: una grilla de horarios. [columna, fila, alto, tipo]
const BLOQUES_MOTIVO = [
  [1, 1, 3, 'o'], [2, 2, 2, 'p'], [3, 1, 2, 'o'], [4, 3, 3, 'o'], [5, 1, 2, 'o'],
  [1, 5, 2, 'p'], [3, 4, 3, 'o'], [2, 6, 3, 'o'], [5, 4, 2, 'p'], [4, 7, 2, 'o'], [1, 8, 1, 'o'], [5, 7, 2, 'o'],
];

function crearMotivo() {
  const motivo = el('div', { clase: 'motivo', 'aria-hidden': 'true' });
  for (const [columna, fila, alto, tipo] of BLOQUES_MOTIVO) {
    const bloque = el('span', { clase: tipo === 'p' ? 'm-propio' : 'm-ocupado' });
    bloque.style.gridColumn = String(columna);
    bloque.style.gridRow = `${fila} / span ${alto}`;
    motivo.append(bloque);
  }
  return motivo;
}

function mostrarError(nodo, error, detalle) {
  nodo.replaceChildren(error.mensaje);
  if (detalle && detalle.length) nodo.append(el('p', { clase: 'detalle-tecnico' }, detalle.join(' · ')));
  nodo.hidden = false;
}

export function crearPantallaIngreso({ api, mensajeInicial, alIngresar }) {
  const usuario = el('input', { id: 'ingreso-usuario', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const clave = el('input', { id: 'ingreso-clave', type: 'password', autocomplete: 'current-password', required: true });
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  if (mensajeInicial) {
    mensaje.textContent = mensajeInicial;
    mensaje.hidden = false;
  }
  const boton = el('button', { clase: 'boton boton-primario boton-ancho', type: 'submit' }, 'Ingresar');

  const formulario = el(
    'form',
    {
      novalidate: true,
      enSubmit: async (evento) => {
        evento.preventDefault();
        mensaje.hidden = true;
        if (!usuario.value.trim() || !clave.value) {
          mostrarError(mensaje, { mensaje: 'Escribí tu usuario y tu clave.' });
          return;
        }
        boton.disabled = true;
        boton.textContent = 'Ingresando…';
        const r = await api.ingresar(usuario.value.trim(), clave.value);
        boton.disabled = false;
        boton.textContent = 'Ingresar';
        if (!r.ok) {
          mostrarError(mensaje, r.error, r.detalle);
          clave.select();
          return;
        }
        alIngresar(r.datos);
      },
    },
    mensaje,
    el('div', { clase: 'campo' }, el('label', { for: 'ingreso-usuario' }, 'Usuario'), usuario),
    el('div', { clase: 'campo' }, el('label', { for: 'ingreso-clave' }, 'Clave'), clave),
    boton
  );

  return el(
    'div',
    { clase: 'ingreso' },
    el(
      'section',
      { clase: 'ingreso-panel' },
      crearMarca(),
      el('div', {}, el('h1', { clase: 'ingreso-titular' }, 'Tu consultorio, a tu hora.'), el('p', { clase: 'ingreso-bajada' }, 'Mirá qué horarios están libres y reservá en pocos toques.')),
      crearMotivo()
    ),
    el(
      'section',
      { clase: 'ingreso-formulario' },
      el('div', { clase: 'ingreso-tarjeta' }, el('h2', {}, 'Ingresar'), el('p', { clase: 'intro' }, 'Usá el usuario y la clave que te dio Espacia.'), formulario)
    )
  );
}

/**
 * Formulario de cambio de clave. Se usa en la pantalla obligatoria y en la ventana "Cambiar clave".
 * @param {{api: object, textoBoton: string, alExito: () => void, alCancelar?: () => void}} opciones
 */
export function crearFormularioClave({ api, textoBoton, alExito, alCancelar }) {
  const actual = el('input', { id: 'clave-actual', type: 'password', autocomplete: 'current-password', required: true });
  const nueva = el('input', { id: 'clave-nueva', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const repetida = el('input', { id: 'clave-repetida', type: 'password', autocomplete: 'new-password', required: true });
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  const boton = el('button', { clase: 'boton boton-primario', type: 'submit' }, textoBoton);

  const validar = () => {
    if (!actual.value) return 'Escribí tu clave actual.';
    if (nueva.value.length < 8) return 'La clave nueva debe tener al menos 8 caracteres.';
    if (nueva.value === actual.value) return 'La clave nueva debe ser distinta de la actual.';
    if (nueva.value !== repetida.value) return 'Las dos claves nuevas no coinciden.';
    return null;
  };

  return el(
    'form',
    {
      novalidate: true,
      enSubmit: async (evento) => {
        evento.preventDefault();
        mensaje.hidden = true;
        const problema = validar();
        if (problema) {
          mostrarError(mensaje, { mensaje: problema });
          return;
        }
        boton.disabled = true;
        const r = await api.cambiarClave(actual.value, nueva.value);
        boton.disabled = false;
        if (!r.ok) {
          mostrarError(mensaje, r.error, r.detalle);
          return;
        }
        alExito();
      },
    },
    mensaje,
    el('div', { clase: 'campo' }, el('label', { for: 'clave-actual' }, 'Clave actual'), actual),
    el('div', { clase: 'campo' }, el('label', { for: 'clave-nueva' }, 'Clave nueva'), nueva, el('span', { clase: 'campo-ayuda' }, 'Mínimo 8 caracteres.')),
    el('div', { clase: 'campo' }, el('label', { for: 'clave-repetida' }, 'Repetí la clave nueva'), repetida),
    el(
      'div',
      { clase: 'hoja-acciones' },
      boton,
      alCancelar ? el('button', { clase: 'boton boton-secundario', type: 'button', enClick: alCancelar }, 'Cancelar') : null
    )
  );
}

export function crearPantallaCambioObligatorio({ api, nombre, alExito, alSalir }) {
  return el(
    'div',
    { clase: 'ingreso' },
    el(
      'section',
      { clase: 'ingreso-panel' },
      crearMarca(),
      el('div', {}, el('h1', { clase: 'ingreso-titular' }, 'Un último paso.'), el('p', { clase: 'ingreso-bajada' }, 'Elegí una clave que solo vos conozcas.')),
      crearMotivo()
    ),
    el(
      'section',
      { clase: 'ingreso-formulario' },
      el(
        'div',
        { clase: 'ingreso-tarjeta' },
        el('h2', {}, `Hola, ${nombre.split(' ')[0]}`),
        el('p', { clase: 'intro' }, 'Por seguridad, tenés que cambiar tu clave antes de continuar.'),
        crearFormularioClave({ api, textoBoton: 'Guardar y continuar', alExito }),
        el('p', { clase: 'ingreso-pie' }, el('button', { clase: 'boton boton-texto', type: 'button', enClick: alSalir }, 'Salir'))
      )
    )
  );
}
