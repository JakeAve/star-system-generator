const PREFIX = "sc:seed:";

export function saveSystem(data) {
  if (data?.seed == null) return;
  try {
    localStorage.setItem(`${PREFIX}${data.seed}`, JSON.stringify(data));
  } catch { /* storage unavailable */ }
}

export function loadSystem(id) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function listSeeds() {
  const results = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) results.push(JSON.parse(raw));
        } catch { /* skip malformed entry */ }
      }
    }
  } catch { /* storage unavailable */ }
  return results;
}

export function removeSystem(id) {
  try {
    localStorage.removeItem(`${PREFIX}${id}`);
  } catch { /* storage unavailable */ }
}
