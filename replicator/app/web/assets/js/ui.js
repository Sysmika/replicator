'use strict';
// Helper común para armar elementos. El texto siempre va como textContent (nada de HTML de terceros).
const UI = {
  el(tag, props = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const h of hijos) if (h != null && h !== false) n.append(h);
    return n;
  },
};
