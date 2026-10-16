// Ventanas de gestión de usuarios: alta y edición, clave temporal y reinicio de clave.

import { el, reemplazarHijos, fechaLarga } from './utilidades.js';
import { abrirHoja, mostrarAviso } from './hojas.js';
import { etiquetaRol } from './utilidades.js';

const mismoUsuario = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Roles que la persona puede asignar (el gestor solo trabaja con usuarios comunes). */
export function rolesAsignables(rolActor) {
  return rolActor === 'admin' ? ['usuario', 'gestor', 'admin'] : ['usuario'];
}

/** ¿Puede esta sesión administrar a este usuario? */
export function puedeAdministrar(sesion, usuario) {
  return sesion.rol === 'admin' || (sesion.rol === 'gestor' && usuario.rol === 'usuario');
}

function selectorConsultorios(reglas, elegidos) {
  const grupo = el('div', { clase: 'opciones opciones-compactas' });
  for (let n = 1; n <= reglas.espacios.cantidad; n += 1) {
    grupo.append(
      el(
        'label',
        { clase: 'opcion' },
        el('input', { type: 'checkbox', name: 'consultorio', value: n, checked: elegidos.includes(n) }),
        el('span', { clase: 'opcion-cuerpo' }, el('strong', {}, `${n}`))
      )
    );
  }
  return grupo;
}

const leerElegidos = (grupo) => [...grupo.querySelectorAll('input:checked')].map((i) => Number(i.value));

/** Muestra la clave inicial UNA sola vez (y hasta cuándo sirve, si vence). */
export function abrirHojaClaveTemporal({ nombre, claveTemporal, motivo, venceEl }) {
  const aviso = el(
    'p',
    { clase: 'campo-ayuda' },
    venceEl
      ? `Sirve hasta el ${fechaLarga(venceEl)}. Tendrá que cambiarla al ingresar; si no la usa a tiempo, habrá que reiniciarla.`
      : 'Se muestra una sola vez. Pasásela a la persona por un medio seguro; tendrá que cambiarla al ingresar.'
  );
  const botonCopiar = el('button', { clase: 'boton boton-secundario', type: 'button' }, 'Copiar clave');
  botonCopiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(claveTemporal);
      botonCopiar.textContent = 'Copiada';
    } catch {
      botonCopiar.textContent = 'Seleccioná y copiá a mano';
    }
  });
  const hoja = abrirHoja({
    titulo: motivo === 'alta' ? 'Usuario creado' : 'Clave reiniciada',
    cuerpo: [
      el('p', {}, `Clave inicial de ${nombre}:`),
      el('p', { clase: 'clave-temporal', 'aria-label': 'Clave temporal' }, claveTemporal),
      aviso,
      el('div', { clase: 'hoja-acciones' }, botonCopiar, el('button', { clase: 'boton boton-primario', type: 'button', enClick: () => hoja.cerrar() }, 'Listo')),
    ],
  });
}

/** Alta (usuario = null) o edición de un usuario. */
export function abrirHojaUsuario({ reglas, sesion, api, usuario, alGuardado }) {
  const esAlta = !usuario;
  const esUnoMismo = !esAlta && mismoUsuario(usuario.id, sesion.id);
  const roles = rolesAsignables(sesion.rol);

  const campoId = esAlta ? el('input', { id: 'usuario-id', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 20 }) : null;
  const campoNombre = el('input', { id: 'usuario-nombre', type: 'text', autocomplete: 'off', maxlength: 60, value: usuario ? usuario.nombre : '' });
  const campoRol = el('select', { id: 'usuario-rol', disabled: esUnoMismo || roles.length === 1 }, roles.map((r) => el('option', { value: r, selected: usuario ? usuario.rol === r : r === 'usuario' }, etiquetaRol(r))));
  const consultorios = selectorConsultorios(reglas, usuario ? usuario.consPref : Array.from({ length: reglas.espacios.cantidad }, (_, i) => i + 1));
  const campoActivo = esAlta ? null : el('input', { id: 'usuario-activo', type: 'checkbox', checked: usuario.activo, disabled: esUnoMismo });
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  const boton = el('button', { clase: 'boton boton-primario', type: 'submit' }, esAlta ? 'Crear usuario' : 'Guardar cambios');

  const mostrarError = (texto) => {
    mensaje.textContent = texto;
    mensaje.hidden = false;
  };

  const formulario = el(
    'form',
    {
      novalidate: true,
      enSubmit: async (evento) => {
        evento.preventDefault();
        mensaje.hidden = true;
        const nombre = campoNombre.value.trim();
        const elegidos = leerElegidos(consultorios);
        if (esAlta && !/^[A-Za-z0-9]{3,20}$/.test(campoId.value.trim())) return mostrarError('El usuario debe tener de 3 a 20 letras o números, sin espacios.');
        if (!nombre) return mostrarError('Escribí el nombre.');
        if (elegidos.length === 0) return mostrarError('Elegí al menos un consultorio.');

        boton.disabled = true;
        let r;
        if (esAlta) {
          r = await api.crearUsuario({ id: campoId.value.trim(), nombre, rol: campoRol.value, consPref: elegidos });
        } else {
          const cambios = {};
          if (nombre !== usuario.nombre) cambios.nombre = nombre;
          if (!campoRol.disabled && campoRol.value !== usuario.rol) cambios.rol = campoRol.value;
          if (JSON.stringify(elegidos) !== JSON.stringify([...usuario.consPref].sort((a, b) => a - b))) cambios.consPref = elegidos;
          if (!campoActivo.disabled && campoActivo.checked !== usuario.activo) cambios.activo = campoActivo.checked;
          if (Object.keys(cambios).length === 0) {
            hoja.cerrar();
            return undefined;
          }
          r = await api.editarUsuario(usuario.id, cambios);
        }
        boton.disabled = false;
        if (!r.ok) return mostrarError(r.error.mensaje);
        hoja.cerrar();
        alGuardado();
        if (esAlta) abrirHojaClaveTemporal({ nombre: r.datos.usuario.nombre, claveTemporal: r.datos.claveTemporal, motivo: 'alta', venceEl: r.datos.venceEl });
        else mostrarAviso('Cambios guardados.');
        return undefined;
      },
    },
    mensaje,
    esAlta ? el('div', { clase: 'campo' }, el('label', { for: 'usuario-id' }, 'Usuario'), campoId, el('span', { clase: 'campo-ayuda' }, 'Con este nombre ingresa. De 3 a 20 letras o números, sin espacios.')) : el('dl', { clase: 'datos' }, el('dt', {}, 'Usuario'), el('dd', {}, usuario.id)),
    el('div', { clase: 'campo' }, el('label', { for: 'usuario-nombre' }, 'Nombre'), campoNombre),
    el('div', { clase: 'campo' }, el('label', { for: 'usuario-rol' }, 'Perfil'), campoRol, esUnoMismo ? el('span', { clase: 'campo-ayuda' }, 'No podés cambiar tu propio perfil.') : null),
    el('fieldset', { clase: 'campo' }, el('legend', {}, 'Consultorios que usa'), consultorios),
    campoActivo
      ? el('div', { clase: 'campo' }, el('label', { clase: 'casilla' }, campoActivo, ' Usuario activo'), el('span', { clase: 'campo-ayuda' }, esUnoMismo ? 'No podés desactivarte a vos mismo.' : 'Si lo desactivás, pierde el acceso de inmediato.'))
      : null,
    el('div', { clase: 'hoja-acciones' }, boton, el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => hoja.cerrar() }, 'Cancelar'))
  );

  const hoja = abrirHoja({ titulo: esAlta ? 'Nuevo usuario' : 'Editar usuario', cuerpo: formulario });
}

/** Confirmación y reinicio de clave. */
export function abrirHojaReinicio({ api, usuario }) {
  const mensaje = el('div', { clase: 'mensaje-error', role: 'alert', hidden: true });
  const zona = el('div', { clase: 'hoja-acciones' });
  const confirmar = el('button', { clase: 'boton boton-peligro', type: 'button' }, 'Sí, reiniciar clave');
  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    const r = await api.reiniciarClave(usuario.id);
    if (!r.ok) {
      confirmar.disabled = false;
      mensaje.textContent = r.error.mensaje;
      mensaje.hidden = false;
      return;
    }
    hoja.cerrar();
    abrirHojaClaveTemporal({ nombre: usuario.nombre, claveTemporal: r.datos.claveTemporal, motivo: 'reinicio', venceEl: r.datos.venceEl });
  });
  reemplazarHijos(zona, confirmar, el('button', { clase: 'boton boton-secundario', type: 'button', enClick: () => hoja.cerrar() }, 'No, volver'));
  const hoja = abrirHoja({
    titulo: 'Reiniciar clave',
    cuerpo: [el('p', {}, `¿Reiniciar la clave de ${usuario.nombre}? Su clave actual dejará de servir; recibirá una clave inicial y tendrá que elegir una nueva al ingresar.`), mensaje, zona],
  });
}
