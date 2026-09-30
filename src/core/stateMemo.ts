/** Memos that belong to one base. A second base (docs/20: a rival's) has buildings, roads and targets with the same ids
 *  and the same counts as the player's, so a memo keyed on those alone would hand one base the other's answer. Each state
 *  gets its own table, made on first use and gone with the state. */
export function perState<V>(make: () => V): (s: object) => V {
  const tables = new WeakMap<object, V>();
  return (s) => {
    let v = tables.get(s);
    if (v === undefined) tables.set(s, v = make());
    return v;
  };
}
