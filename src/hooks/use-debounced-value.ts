import { useEffect, useState } from 'react';

/**
 * O valor só muda `delay` ms depois da última mudança: a consulta do @ da tela
 * "Editar perfil" (bloco 9) sai uma vez para várias teclas.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
